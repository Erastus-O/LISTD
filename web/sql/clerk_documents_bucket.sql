-- M1 #6 — Storage bucket for clerk verification documents.
--
-- Private bucket (signed URLs only). Apply via Supabase Dashboard → SQL Editor.
-- Idempotent on re-run.

INSERT INTO storage.buckets (id, name, public)
VALUES ('clerk-documents', 'clerk-documents', false)
ON CONFLICT (id) DO NOTHING;

-- Authenticated users can upload only into their own user-id-prefixed folder.
DROP POLICY IF EXISTS "Clerks can upload their own verification docs" ON storage.objects;
CREATE POLICY "Clerks can upload their own verification docs"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'clerk-documents'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

DROP POLICY IF EXISTS "Clerks can replace their own verification docs" ON storage.objects;
CREATE POLICY "Clerks can replace their own verification docs"
ON storage.objects FOR UPDATE
TO authenticated
USING (
  bucket_id = 'clerk-documents'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

-- Clerks can view their own files (e.g. to preview after upload).
DROP POLICY IF EXISTS "Clerks can view their own verification docs" ON storage.objects;
CREATE POLICY "Clerks can view their own verification docs"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'clerk-documents'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

-- Admins can view all clerk documents (for the verification panel).
DROP POLICY IF EXISTS "Admins can view all clerk verification docs" ON storage.objects;
CREATE POLICY "Admins can view all clerk verification docs"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'clerk-documents'
  AND has_role(auth.uid(), 'admin'::app_role)
);
