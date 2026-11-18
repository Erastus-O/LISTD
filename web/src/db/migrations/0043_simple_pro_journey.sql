-- 0043: the simplified Pro journey.
--
--   * LISTD approval: a Pro's accept waits for LISTD before the address, access
--     codes and contacts unlock and the brief is sent. Jobs already past the job
--     board are treated as approved, so nothing in flight changes.
--   * Job messages: Pro <-> LISTD (and, when switched on, client <-> LISTD).
--     There is no direct Pro-to-client channel; LISTD relays.
--   * Check-out: a second on-site event with a photo of the building.
--   * Requotes: photo or video evidence on a change order.
--
-- Additive only. Safe to re-run.

-- ── LISTD approval of accepted jobs ──────────────────────────────────────
ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS listd_approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS listd_approved_by uuid,
  -- 'manual' | 'auto' (the Pro's level met the auto-approve setting)
  ADD COLUMN IF NOT EXISTS listd_approval_mode text,
  ADD COLUMN IF NOT EXISTS brief_sent_at timestamptz;

UPDATE public.jobs
   SET listd_approved_at = coalesce(accepted_at, updated_at, now()),
       listd_approval_mode = 'legacy'
 WHERE listd_approved_at IS NULL
   AND status NOT IN ('draft', 'pending', 'published', 'cancelled');

CREATE INDEX IF NOT EXISTS jobs_awaiting_listd_idx
  ON public.jobs (accepted_at)
  WHERE listd_approved_at IS NULL AND status = 'accepted';

-- ── Job messages ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.job_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  -- Which conversation: 'pro' is the Pro and LISTD, 'client' is the client and LISTD.
  channel text NOT NULL CHECK (channel IN ('pro', 'client')),
  sender_id uuid,
  -- 'listd' for admins, else the sender's side of the channel. NULL sender = system (the brief).
  sender_side text NOT NULL CHECK (sender_side IN ('listd', 'pro', 'client', 'system')),
  body text NOT NULL CHECK (length(body) BETWEEN 1 AND 4000),
  -- Storage paths in the private `job-photos` bucket ("<jobId>/messages/…").
  attachment_paths jsonb NOT NULL DEFAULT '[]'::jsonb,
  read_by_listd_at timestamptz,
  read_by_party_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS job_messages_job_channel_idx ON public.job_messages (job_id, channel, created_at);
CREATE INDEX IF NOT EXISTS job_messages_unread_listd_idx ON public.job_messages (created_at) WHERE read_by_listd_at IS NULL AND sender_side IN ('pro', 'client');
-- Server-side only (withServiceRole): RLS on, no policies.
ALTER TABLE public.job_messages ENABLE ROW LEVEL SECURITY;

-- ── Check-out ────────────────────────────────────────────────────────────
ALTER TABLE public.job_site_events DROP CONSTRAINT IF EXISTS job_site_events_kind_check;
ALTER TABLE public.job_site_events ADD CONSTRAINT job_site_events_kind_check
  CHECK (kind IN ('arrival', 'running_late', 'no_access', 'check_out'));
ALTER TABLE public.job_site_events DROP CONSTRAINT IF EXISTS job_site_events_actor_role_check;
ALTER TABLE public.job_site_events ADD CONSTRAINT job_site_events_actor_role_check
  CHECK (actor_role IN ('clerk', 'cleaner', 'trades', 'admin'));

-- ── Requote evidence ─────────────────────────────────────────────────────
ALTER TABLE public.change_orders
  -- Photos and videos in `job-photos` ("<jobId>/requotes/…").
  ADD COLUMN IF NOT EXISTS evidence_paths jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS decided_at timestamptz;
