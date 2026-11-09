-- 0017 — Xero external-id columns (closes Xero provider integration).
--
-- The Xero provider dual-writes: invoices created via the provider live
-- in Xero (source of truth for line items, status, PDF) AND in our local
-- `invoices` table (so list/detail pages don't round-trip Xero per row).
-- These columns are the linking keys.
--
--   - invoices.xero_invoice_id          UUID returned by Xero on POST /Invoices
--   - invoice_payments.xero_payment_id  UUID returned by Xero on POST /Payments
--   - tax_rates.xero_tax_type           Xero TaxType string (e.g. 'OUTPUT2'),
--                                       maps LISTD tax codes onto Xero's
--                                       per-org tax library. Admin sets via
--                                       /admin/settings/tax.
--
-- Indexes scoped to NOT NULL so they don't bloat for the inbuilt provider
-- (which never populates these).
--
-- Apply via Supabase Dashboard → SQL Editor (idempotent on re-run).

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS xero_invoice_id text;

ALTER TABLE public.invoices
  DROP CONSTRAINT IF EXISTS invoices_xero_invoice_id_key;

ALTER TABLE public.invoices
  ADD CONSTRAINT invoices_xero_invoice_id_key UNIQUE (xero_invoice_id);

CREATE INDEX IF NOT EXISTS invoices_xero_idx
  ON public.invoices (xero_invoice_id)
  WHERE xero_invoice_id IS NOT NULL;

ALTER TABLE public.invoice_payments
  ADD COLUMN IF NOT EXISTS xero_payment_id text;

ALTER TABLE public.invoice_payments
  DROP CONSTRAINT IF EXISTS invoice_payments_xero_payment_id_key;

ALTER TABLE public.invoice_payments
  ADD CONSTRAINT invoice_payments_xero_payment_id_key UNIQUE (xero_payment_id);

CREATE INDEX IF NOT EXISTS invoice_payments_xero_idx
  ON public.invoice_payments (xero_payment_id)
  WHERE xero_payment_id IS NOT NULL;

ALTER TABLE public.tax_rates
  ADD COLUMN IF NOT EXISTS xero_tax_type text;
