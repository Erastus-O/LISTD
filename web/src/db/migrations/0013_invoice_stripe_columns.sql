-- 0013 — Stripe pay-by-link columns on invoice_payments.
--
-- Phase 6 of the inbuilt invoice generator (see
-- Docs/LISTD_Invoice_Generator_Plan.md §13). Adds two text columns
-- carrying the Stripe Checkout session + payment-intent ids so the
-- webhook handler can:
--   1. Idempotently locate an existing payment row on retry
--   2. Surface a "View in Stripe" link from the admin invoice detail
--
-- Also extends the `method` check constraint to allow 'stripe'.
--
-- Apply via Supabase Dashboard → SQL Editor (idempotent on re-run).

ALTER TABLE public.invoice_payments
  ADD COLUMN IF NOT EXISTS stripe_checkout_session_id text,
  ADD COLUMN IF NOT EXISTS stripe_payment_intent_id text;

-- Helpful index for webhook idempotency lookups: when a retry fires we
-- look up by checkout_session_id, not invoice_id.
CREATE INDEX IF NOT EXISTS invoice_payments_stripe_session_idx
  ON public.invoice_payments (stripe_checkout_session_id)
  WHERE stripe_checkout_session_id IS NOT NULL;

-- Replace the method check to allow 'stripe'. Drop-then-add because
-- Postgres has no ALTER CONSTRAINT for check semantics.
ALTER TABLE public.invoice_payments
  DROP CONSTRAINT IF EXISTS invoice_payments_method_check;

ALTER TABLE public.invoice_payments
  ADD CONSTRAINT invoice_payments_method_check
  CHECK (method IN ('bank_transfer', 'card', 'cash', 'stripe', 'other'));
