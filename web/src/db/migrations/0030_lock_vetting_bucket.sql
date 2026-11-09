-- 0030 — Lock down the clerk/cleaner vetting-documents bucket.
--
-- `clerk-documents` holds DBS (criminal-record), government ID, and insurance
-- documents — the platform's most sensitive data. Make the bucket private and
-- scope access tightly:
--   • owner (the clerk/cleaner) may upload/update their own docs — paths are
--     `<userId>/<docType>_<ts>.<ext>`, so the first path segment is their uid;
--   • read is limited to the owner OR an admin;
--   • delete is admin-only (the retention cron uses the service role, which
--     bypasses RLS).
--
-- Admins view these via short-lived signed URLs (service role), so making the
-- bucket private does not break the admin clerk-detail page.
--
-- NOTE: RLS policies are OR-combined. If a legacy permissive policy (e.g. a
-- "Public access" or "allow all authenticated" rule) exists on this bucket,
-- remove it in Supabase → Storage → Policies, or it will keep granting access.

INSERT INTO storage.buckets (id, name, public)
VALUES ('clerk-documents', 'clerk-documents', false)
ON CONFLICT (id) DO UPDATE SET public = false;

-- Owner can upload their own docs.
DROP POLICY IF EXISTS "Owner uploads vetting docs" ON storage.objects;
CREATE POLICY "Owner uploads vetting docs"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'clerk-documents'
    AND split_part(name, '/', 1) = auth.uid()::text
  );

-- Owner can replace their own docs (uploads use upsert).
DROP POLICY IF EXISTS "Owner updates vetting docs" ON storage.objects;
CREATE POLICY "Owner updates vetting docs"
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'clerk-documents'
    AND split_part(name, '/', 1) = auth.uid()::text
  );

-- Read: the owner or an admin only.
DROP POLICY IF EXISTS "Owner or admin reads vetting docs" ON storage.objects;
CREATE POLICY "Owner or admin reads vetting docs"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'clerk-documents'
    AND (
      split_part(name, '/', 1) = auth.uid()::text
      OR has_role(auth.uid(), 'admin'::app_role)
    )
  );

-- Delete: admins only.
DROP POLICY IF EXISTS "Admins delete vetting docs" ON storage.objects;
CREATE POLICY "Admins delete vetting docs"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'clerk-documents'
    AND has_role(auth.uid(), 'admin'::app_role)
  );
