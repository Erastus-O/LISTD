-- 0011 — Inbuilt invoice generator (Phase 0 foundation).
--
-- Schema for the first-party billing surface. The platform setting
-- `invoice_provider` toggles between this inbuilt provider and Xero;
-- the schema below only powers `invoice_provider = 'inbuilt'`.
--
-- See Docs/LISTD_Invoice_Generator_Plan.md for the architectural rationale.
--
-- Apply via Supabase Dashboard → SQL Editor (idempotent on re-run).

-- ── Tax rates library ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.tax_rates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  rate numeric(5,4) NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  is_default boolean NOT NULL DEFAULT false,
  applies_to text NOT NULL DEFAULT 'domestic',
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS tax_rates_default_idx
  ON public.tax_rates (is_default)
  WHERE is_default = true;

-- Seed default UK rates. ON CONFLICT lets the migration re-run safely.
INSERT INTO public.tax_rates (code, name, rate, is_active, is_default, applies_to)
VALUES
  ('vat_standard', 'Standard rate VAT', 0.2000, true, true, 'domestic'),
  ('vat_reduced',  'Reduced rate VAT', 0.0500, true, false, 'domestic'),
  ('vat_zero',     'Zero-rated',       0.0000, true, false, 'domestic'),
  ('vat_exempt',   'Exempt',           0.0000, true, false, 'domestic'),
  ('reverse_charge', 'Reverse charge', 0.0000, true, false, 'domestic')
ON CONFLICT (code) DO NOTHING;

ALTER TABLE public.tax_rates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can manage tax rates" ON public.tax_rates;
CREATE POLICY "Admins can manage tax rates"
ON public.tax_rates FOR ALL
TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role))
WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

-- All authenticated users need to read rates so invoice surfaces (admin
-- + client + worker) can resolve a `tax_rate_id` to its display name.
DROP POLICY IF EXISTS "Authenticated users can read active tax rates" ON public.tax_rates;
CREATE POLICY "Authenticated users can read active tax rates"
ON public.tax_rates FOR SELECT
TO authenticated
USING (is_active = true);

-- ── Numbering sequence (per-year reset) ──────────────────────────────
CREATE TABLE IF NOT EXISTS public.invoice_numbering (
  year integer PRIMARY KEY,
  next_number integer NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.invoice_numbering ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can manage numbering" ON public.invoice_numbering;
CREATE POLICY "Admins can manage numbering"
ON public.invoice_numbering FOR ALL
TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role))
WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

-- ── Invoices ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reference text UNIQUE,
  status text NOT NULL DEFAULT 'draft',
  client_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  organisation_id uuid REFERENCES public.organisations(id) ON DELETE SET NULL,
  issue_date date,
  due_date date,
  subtotal numeric(12,2) NOT NULL DEFAULT 0,
  tax_total numeric(12,2) NOT NULL DEFAULT 0,
  total numeric(12,2) NOT NULL DEFAULT 0,
  paid_total numeric(12,2) NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'GBP',
  notes text,
  -- jsonb snapshot of tax rows at issue time. Shape:
  --   [{ "rateId": "...", "code": "vat_standard", "rate": 0.20,
  --      "base": 100.00, "tax": 20.00 }]
  -- Snapshotting (rather than recomputing on read) means a future rate
  -- change can't retroactively alter issued invoices.
  tax_summary jsonb NOT NULL DEFAULT '[]'::jsonb,
  pdf_url text,
  issued_at timestamptz,
  sent_at timestamptz,
  paid_at timestamptz,
  voided_at timestamptz,
  void_reason text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT invoices_status_check
    CHECK (status IN ('draft', 'issued', 'sent', 'paid', 'overdue', 'void'))
);

CREATE INDEX IF NOT EXISTS invoices_client_idx ON public.invoices (client_id);
CREATE INDEX IF NOT EXISTS invoices_org_idx ON public.invoices (organisation_id);
CREATE INDEX IF NOT EXISTS invoices_status_idx ON public.invoices (status);
CREATE INDEX IF NOT EXISTS invoices_issue_date_idx ON public.invoices (issue_date DESC);

ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can manage all invoices" ON public.invoices;
CREATE POLICY "Admins can manage all invoices"
ON public.invoices FOR ALL
TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role))
WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS "Clients can view their own invoices" ON public.invoices;
CREATE POLICY "Clients can view their own invoices"
ON public.invoices FOR SELECT
TO authenticated
USING (auth.uid() = client_id);

DROP POLICY IF EXISTS "Org members can view org invoices" ON public.invoices;
CREATE POLICY "Org members can view org invoices"
ON public.invoices FOR SELECT
TO authenticated
USING (
  organisation_id IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM public.organisation_members om
    WHERE om.organisation_id = invoices.organisation_id
      AND om.user_id = auth.uid()
      AND om.status = 'active'
  )
);

-- ── Invoice line items ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.invoice_line_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  job_id uuid REFERENCES public.jobs(id) ON DELETE SET NULL,
  description text NOT NULL,
  quantity numeric(10,2) NOT NULL DEFAULT 1,
  unit_price numeric(12,2) NOT NULL,
  tax_rate_id uuid REFERENCES public.tax_rates(id) ON DELETE RESTRICT,
  line_subtotal numeric(12,2) NOT NULL,
  line_tax numeric(12,2) NOT NULL DEFAULT 0,
  position integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS invoice_line_items_invoice_idx
  ON public.invoice_line_items (invoice_id, position);
CREATE INDEX IF NOT EXISTS invoice_line_items_job_idx
  ON public.invoice_line_items (job_id);

ALTER TABLE public.invoice_line_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can manage all line items" ON public.invoice_line_items;
CREATE POLICY "Admins can manage all line items"
ON public.invoice_line_items FOR ALL
TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role))
WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS "Recipients can view line items" ON public.invoice_line_items;
CREATE POLICY "Recipients can view line items"
ON public.invoice_line_items FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.invoices i
    WHERE i.id = invoice_line_items.invoice_id
      AND (
        i.client_id = auth.uid()
        OR (
          i.organisation_id IS NOT NULL
          AND EXISTS (
            SELECT 1 FROM public.organisation_members om
            WHERE om.organisation_id = i.organisation_id
              AND om.user_id = auth.uid()
              AND om.status = 'active'
          )
        )
      )
  )
);

-- ── Invoice payments ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.invoice_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  paid_amount numeric(12,2) NOT NULL,
  paid_at date NOT NULL DEFAULT CURRENT_DATE,
  method text NOT NULL DEFAULT 'bank_transfer',
  reference text,
  recorded_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT invoice_payments_method_check
    CHECK (method IN ('bank_transfer', 'card', 'cash', 'other'))
);

CREATE INDEX IF NOT EXISTS invoice_payments_invoice_idx
  ON public.invoice_payments (invoice_id, paid_at DESC);

ALTER TABLE public.invoice_payments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can manage all payments" ON public.invoice_payments;
CREATE POLICY "Admins can manage all payments"
ON public.invoice_payments FOR ALL
TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role))
WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS "Recipients can view payments" ON public.invoice_payments;
CREATE POLICY "Recipients can view payments"
ON public.invoice_payments FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.invoices i
    WHERE i.id = invoice_payments.invoice_id
      AND (
        i.client_id = auth.uid()
        OR (
          i.organisation_id IS NOT NULL
          AND EXISTS (
            SELECT 1 FROM public.organisation_members om
            WHERE om.organisation_id = i.organisation_id
              AND om.user_id = auth.uid()
              AND om.status = 'active'
          )
        )
      )
  )
);

-- ── Denormalised pointer on jobs ────────────────────────────────────
-- Surface the invoice on the admin Job Detail without joining through
-- line items. Nullable: a job may exist without an invoice (draft jobs,
-- cancelled jobs, etc).
ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS invoice_id uuid REFERENCES public.invoices(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS jobs_invoice_idx ON public.jobs (invoice_id);
