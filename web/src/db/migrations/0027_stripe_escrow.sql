-- 0027 — Stripe Connect escrow.
--
-- Pre-pay-at-booking + pay-the-clerk-on-acceptance, using Stripe Connect:
--   1. Client pays the quoted price at booking → funds HELD on the platform
--      balance (no destination yet — the marketplace clerk isn't known until
--      someone accepts). The job stays `draft` until the charge succeeds.
--   2. A clerk accepts + does the inspection.
--   3. Admin approves the report in QA → the held funds are TRANSFERRED to the
--      accepting clerk's connected account (their clerk payout), platform keeps
--      the margin.
--   4. Cancel before release → refund the client.
--
-- Apply via Supabase Dashboard → SQL Editor. Idempotent.

-- Clerk (profiles) Stripe Connect (Express) account state.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS stripe_account_id text,
  ADD COLUMN IF NOT EXISTS stripe_charges_enabled boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS stripe_payouts_enabled boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS stripe_details_submitted boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS stripe_onboarding_status text DEFAULT 'none';

-- One escrow row per paid job. Amounts are in minor units (pence).
CREATE TABLE IF NOT EXISTS public.escrow_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL,
  client_user_id uuid NOT NULL,
  clerk_id uuid,
  currency text NOT NULL DEFAULT 'gbp',
  gross_amount integer NOT NULL,        -- what the client pays
  clerk_amount integer NOT NULL,        -- net transferred to the clerk on release
  platform_fee integer NOT NULL,        -- gross - clerk
  status text NOT NULL DEFAULT 'pending', -- pending|held|released|refunded|failed|disputed
  stripe_checkout_session_id text,
  stripe_payment_intent text,
  stripe_charge_id text,
  stripe_transfer_id text,
  stripe_refund_id text,
  transfer_group text,
  held_at timestamptz,
  released_at timestamptz,
  refunded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS escrow_job_idx ON public.escrow_transactions (job_id);
CREATE INDEX IF NOT EXISTS escrow_status_idx ON public.escrow_transactions (status);
CREATE INDEX IF NOT EXISTS escrow_session_idx ON public.escrow_transactions (stripe_checkout_session_id);
CREATE INDEX IF NOT EXISTS escrow_pi_idx ON public.escrow_transactions (stripe_payment_intent);

ALTER TABLE public.escrow_transactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins manage all escrow" ON public.escrow_transactions;
CREATE POLICY "Admins manage all escrow" ON public.escrow_transactions
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS "Clients read own escrow" ON public.escrow_transactions;
CREATE POLICY "Clients read own escrow" ON public.escrow_transactions
  FOR SELECT TO authenticated
  USING (client_user_id = auth.uid());

DROP POLICY IF EXISTS "Clerks read assigned escrow" ON public.escrow_transactions;
CREATE POLICY "Clerks read assigned escrow" ON public.escrow_transactions
  FOR SELECT TO authenticated
  USING (clerk_id = auth.uid());
