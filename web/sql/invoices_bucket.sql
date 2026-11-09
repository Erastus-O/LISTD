-- Storage bucket for inbuilt invoice PDFs.
--
-- File-path convention: `<invoiceId>/<reference>-<isoZ>.pdf` (e.g.
-- `<uuid>/INV-2026-00012-2026-05-15T10-22-00Z.pdf`). Re-issues land at a
-- fresh key — original is retained per HMRC 6-year record-keeping
-- requirement (mirrors the generated-reports supersede + retain pattern).
--
-- Apply via Supabase Dashboard → SQL Editor (idempotent on re-run).

INSERT INTO storage.buckets (id, name, public)
VALUES ('invoices', 'invoices', false)
ON CONFLICT (id) DO NOTHING;

-- Admins manage everything (create / read / delete on void).
DROP POLICY IF EXISTS "Admins can manage all invoice PDFs" ON storage.objects;
CREATE POLICY "Admins can manage all invoice PDFs"
ON storage.objects FOR ALL
TO authenticated
USING (
  bucket_id = 'invoices'
  AND has_role(auth.uid(), 'admin'::app_role)
)
WITH CHECK (
  bucket_id = 'invoices'
  AND has_role(auth.uid(), 'admin'::app_role)
);

-- Clients can read PDFs for invoices addressed to them.
DROP POLICY IF EXISTS "Clients can view their invoice PDFs" ON storage.objects;
CREATE POLICY "Clients can view their invoice PDFs"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'invoices'
  AND EXISTS (
    SELECT 1 FROM public.invoices i
    WHERE i.id::text = (storage.foldername(name))[1]
      AND i.client_id = auth.uid()
  )
);

-- Org members can read PDFs for invoices addressed to their org.
DROP POLICY IF EXISTS "Org members can view org invoice PDFs" ON storage.objects;
CREATE POLICY "Org members can view org invoice PDFs"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'invoices'
  AND EXISTS (
    SELECT 1 FROM public.invoices i
    JOIN public.organisation_members om
      ON om.organisation_id = i.organisation_id
     AND om.user_id = auth.uid()
     AND om.status = 'active'
    WHERE i.id::text = (storage.foldername(name))[1]
  )
);
