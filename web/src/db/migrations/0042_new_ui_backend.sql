-- Backend for the new LISTD interface: rate card pricing, client approval with
-- weekly payouts, Pro roles and levels, quotes, repairs, training, rebates.
--
-- Additive only: new values, columns and tables. Nothing is dropped or rewritten,
-- so the current production app keeps working if this runs before it's retired.

-- ── Pro Trades ───────────────────────────────────────────────────────────
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'trades';

-- ── Jobs ─────────────────────────────────────────────────────────────────
ALTER TABLE public.jobs
  -- Services booked together share a group and one checkout.
  ADD COLUMN IF NOT EXISTS group_id uuid,
  -- Per-service details: clean type, add-ons, repair mode, same-visit flag, etc.
  ADD COLUMN IF NOT EXISTS scope jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS sched text,
  -- Workload behind the Pro fee; the fee is set when a Pro accepts (it depends on their level).
  ADD COLUMN IF NOT EXISTS pro_base jsonb,
  -- Level the job needs in its role (1 to 3).
  ADD COLUMN IF NOT EXISTS required_level integer,
  -- Client approval window: set when LISTD releases the work to the client.
  ADD COLUMN IF NOT EXISTS client_review_due_at timestamptz,
  ADD COLUMN IF NOT EXISTS approved_at timestamptz,
  -- 'client' | 'auto' (window closed; never treated as consent) | 'admin'
  ADD COLUMN IF NOT EXISTS approval_mode text,
  -- Set on approval; the weekly payout run pays jobs from here.
  ADD COLUMN IF NOT EXISTS payout_eligible_at timestamptz;

CREATE INDEX IF NOT EXISTS jobs_group_id_idx ON public.jobs (group_id) WHERE group_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS jobs_review_due_idx ON public.jobs (client_review_due_at) WHERE client_review_due_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS jobs_payout_eligible_idx ON public.jobs (payout_eligible_at) WHERE payout_eligible_at IS NOT NULL;

-- ── Properties ───────────────────────────────────────────────────────────
ALTER TABLE public.properties
  ADD COLUMN IF NOT EXISTS area_m2 integer,
  ADD COLUMN IF NOT EXISTS outbuildings boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS outdoor boolean NOT NULL DEFAULT false;

-- ── Negotiated portfolio rate (25+ jobs a month) ─────────────────────────
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS portfolio_pct numeric;

-- ── Versioned quotes ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.job_quotes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.jobs (id) ON DELETE CASCADE,
  version integer NOT NULL,
  lines jsonb NOT NULL,
  sub_p integer NOT NULL,
  tax_p integer NOT NULL DEFAULT 0,
  disc_p integer NOT NULL DEFAULT 0,
  total_p integer NOT NULL,
  -- Fixed fee for repairs; otherwise the job's pro_base sets it at acceptance.
  pro_fee_p integer,
  duration_min integer,
  exclusions text,
  -- Shown to the client on an updated quote.
  why text,
  status text NOT NULL DEFAULT 'ISSUED' CHECK (status IN ('ISSUED', 'ACCEPTED', 'SUPERSEDED', 'EXPIRED', 'REJECTED')),
  auto boolean NOT NULL DEFAULT false,
  decline_reason text,
  issued_by uuid,
  issued_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  accepted_at timestamptz,
  UNIQUE (job_id, version)
);
ALTER TABLE public.job_quotes ENABLE ROW LEVEL SECURITY;

-- ── Change orders (extra work: Pro proposes, LISTD prices, client approves and pays) ──
CREATE TABLE IF NOT EXISTS public.change_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.jobs (id) ON DELETE CASCADE,
  proposed_by uuid,
  description text NOT NULL,
  estimate_p integer,
  lines jsonb,
  total_p integer,
  pro_fee_p integer,
  -- A diagnosis fee already paid, credited once against the repair.
  credit_p integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'PROPOSED' CHECK (status IN ('PROPOSED', 'PRICED', 'APPROVED', 'PAID', 'REJECTED')),
  stripe_checkout_session_id text,
  stripe_charge_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  priced_at timestamptz,
  approved_at timestamptz,
  paid_at timestamptz
);
ALTER TABLE public.change_orders ENABLE ROW LEVEL SECURITY;

-- ── Pro roles and levels: three levels in each role ──────────────────────
CREATE TABLE IF NOT EXISTS public.pro_role_levels (
  user_id uuid NOT NULL,
  role text NOT NULL CHECK (role IN ('CLERK', 'CLEANER', 'TRADES')),
  level integer NOT NULL DEFAULT 1 CHECK (level BETWEEN 1 AND 3),
  -- Set when an admin passes the standards check early.
  standards_passed_at timestamptz,
  standards_passed_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, role)
);
ALTER TABLE public.pro_role_levels ENABLE ROW LEVEL SECURITY;

-- Existing Pros keep their work (client decision, 29 Oct 2026):
--   clerks: old 5 -> Level 3, old 4 -> Level 2, otherwise Level 1. Cleaners: capped at 3.
INSERT INTO public.pro_role_levels (user_id, role, level)
SELECT p.user_id, 'CLERK',
       CASE WHEN coalesce(p.clerk_level, 1) >= 5 THEN 3 WHEN coalesce(p.clerk_level, 1) = 4 THEN 2 ELSE 1 END
FROM public.profiles p
JOIN public.user_roles r ON r.user_id = p.user_id AND r.role = 'clerk'
ON CONFLICT (user_id, role) DO NOTHING;

INSERT INTO public.pro_role_levels (user_id, role, level)
SELECT p.user_id, 'CLEANER', LEAST(3, GREATEST(1, coalesce(p.clerk_level, 1)))
FROM public.profiles p
JOIN public.user_roles r ON r.user_id = p.user_id AND r.role = 'cleaner'
ON CONFLICT (user_id, role) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.level_applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  role text NOT NULL CHECK (role IN ('CLERK', 'CLEANER', 'TRADES')),
  from_level integer NOT NULL,
  to_level integer NOT NULL,
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED', 'WITHDRAWN')),
  note text,
  snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  decided_by uuid,
  decision_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz
);
ALTER TABLE public.level_applications ENABLE ROW LEVEL SECURITY;
-- One open application per Pro, per role.
CREATE UNIQUE INDEX IF NOT EXISTS level_applications_one_open
  ON public.level_applications (user_id, role) WHERE status = 'PENDING';

-- ── Training library ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.trainings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  description text,
  kind text NOT NULL CHECK (kind IN ('video', 'pdf', 'link')),
  url text NOT NULL,
  role text CHECK (role IN ('CLERK', 'CLEANER', 'TRADES')),
  -- 0 = optional; 1 to 3 = required before holding that level.
  level integer NOT NULL DEFAULT 0 CHECK (level BETWEEN 0 AND 3),
  minutes integer,
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'PUBLISHED', 'ARCHIVED')),
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.trainings ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.training_completions (
  training_id uuid NOT NULL REFERENCES public.trainings (id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  completed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (training_id, user_id)
);
ALTER TABLE public.training_completions ENABLE ROW LEVEL SECURITY;

-- ── Portfolio rebates, recorded by LISTD per client and month ────────────
CREATE TABLE IF NOT EXISTS public.client_rebates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL,
  month text NOT NULL,
  amount_p integer NOT NULL CHECK (amount_p > 0),
  recorded_by uuid,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (client_id, month)
);
ALTER TABLE public.client_rebates ENABLE ROW LEVEL SECURITY;

-- ── Weekly payout run log ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.payout_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  paid_count integer NOT NULL DEFAULT 0,
  skipped_count integer NOT NULL DEFAULT 0,
  paid_p integer NOT NULL DEFAULT 0,
  detail jsonb NOT NULL DEFAULT '[]'::jsonb
);
ALTER TABLE public.payout_runs ENABLE ROW LEVEL SECURITY;

-- New tables have RLS on with no policies: reachable only through the
-- server's privileged connection, after the API route has checked the caller.
