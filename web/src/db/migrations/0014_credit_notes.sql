-- 0014 — Credit notes (Phase 8 of the inbuilt invoice generator).
--
-- Credit notes are full inverse invoices: same line items, same tax
-- model, same PDF pipeline. Rather than a parallel table, we add two
-- columns to `invoices` and lean on a discriminator:
--
--   - kind                 'invoice' | 'credit_note'   (default 'invoice')
--   - parent_invoice_id    FK to the invoices.id this credit note offsets
--
-- A new `credit_note_numbering` table mirrors `invoice_numbering` and
-- allocates CN-YYYY-NNNNN references atomically per year.
--
-- The audit trail keeps `category = 'billing'`; new actions use the
-- `credit_note.*` namespace so the trail is filterable by entity.
--
-- Apply via Supabase Dashboard → SQL Editor (idempotent on re-run).

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'invoice';

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS parent_invoice_id uuid;

ALTER TABLE public.invoices
  DROP CONSTRAINT IF EXISTS invoices_kind_check;

ALTER TABLE public.invoices
  ADD CONSTRAINT invoices_kind_check
  CHECK (kind IN ('invoice', 'credit_note'));

-- Credit notes MUST point at a parent invoice; regular invoices must NOT.
-- Enforced at the DB level so the page handlers can trust the shape.
ALTER TABLE public.invoices
  DROP CONSTRAINT IF EXISTS invoices_parent_kind_check;

ALTER TABLE public.invoices
  ADD CONSTRAINT invoices_parent_kind_check
  CHECK (
    (kind = 'credit_note' AND parent_invoice_id IS NOT NULL)
    OR (kind = 'invoice' AND parent_invoice_id IS NULL)
  );

ALTER TABLE public.invoices
  DROP CONSTRAINT IF EXISTS invoices_parent_invoice_id_fkey;

ALTER TABLE public.invoices
  ADD CONSTRAINT invoices_parent_invoice_id_fkey
  FOREIGN KEY (parent_invoice_id)
  REFERENCES public.invoices(id)
  ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS invoices_parent_invoice_idx
  ON public.invoices (parent_invoice_id)
  WHERE parent_invoice_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS invoices_kind_idx
  ON public.invoices (kind);

-- Per-year credit-note numbering. Same atomic INSERT … ON CONFLICT DO
-- UPDATE … RETURNING pattern as invoice_numbering. Year resets to 1 on
-- the first issue of January (matches invoice numbering convention).
CREATE TABLE IF NOT EXISTS public.credit_note_numbering (
  year integer PRIMARY KEY,
  next_number integer NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.credit_note_numbering ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can manage credit note numbering"
  ON public.credit_note_numbering;

CREATE POLICY "Admins can manage credit note numbering"
  ON public.credit_note_numbering
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);
