-- 0035 — Promo codes.
--
-- Two kinds, both admin-generated and lifecycle-managed (validity window,
-- redemption cap, enable/disable):
--   'invoice_later' — the client bypasses payment at posting. The debt
--       accumulates and shows on their dashboard; a daily cron consolidates
--       last month's jobs into one invoice on the 1st, generates a Stripe
--       payment link, emails it, and nudges until paid. Clerks on these jobs
--       are paid at month end and see the amount due on their dashboard.
--   'discount' — percentage off, admin-scoped to specific service types
--       (empty scope = every service). Payment still happens at booking,
--       on the discounted total.
--
-- Jobs record which code they redeemed + the discount applied. For
-- invoice_later jobs, jobs.invoice_id being NULL = "not yet month-end
-- invoiced" (the cron sets it, same idempotency as escrow receipts).
--
-- Apply via Supabase Dashboard → SQL Editor. Idempotent.

CREATE TABLE IF NOT EXISTS public.promo_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  kind text NOT NULL DEFAULT 'discount',   -- 'discount' | 'invoice_later'
  percent_off integer,                     -- discount kind: 1..100
  service_types text[],                    -- discount scope; NULL/empty = all services
  starts_at timestamptz,                   -- NULL = active immediately
  expires_at timestamptz,                  -- NULL = never expires
  max_redemptions integer,                 -- NULL = unlimited
  redemption_count integer NOT NULL DEFAULT 0,
  enabled boolean NOT NULL DEFAULT true,
  notes text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS promo_codes_code_idx ON public.promo_codes (code);

ALTER TABLE public.promo_codes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins manage promo codes" ON public.promo_codes;
CREATE POLICY "Admins manage promo codes" ON public.promo_codes
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

-- Redemption stamp on the job itself (denormalised kind so the debt +
-- month-end queries never need the join).
ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS promo_code_id uuid,
  ADD COLUMN IF NOT EXISTS promo_kind text,
  ADD COLUMN IF NOT EXISTS promo_discount numeric;

CREATE INDEX IF NOT EXISTS jobs_promo_kind_idx ON public.jobs (promo_kind) WHERE promo_kind IS NOT NULL;
