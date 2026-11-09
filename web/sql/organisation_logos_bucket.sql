-- M1 #3 — Storage bucket for client organisation logos.
--
-- Storage buckets and storage RLS policies are not managed by Drizzle, so
-- this lives outside `src/db/migrations/`. Apply via Supabase Dashboard →
-- SQL Editor (one-time, idempotent on re-run).
--
-- Public read so logos can be embedded on invoices/reports without signed URLs;
-- writes are scoped per-user via the storage.foldername(name)[1] convention
-- used elsewhere in this codebase.

INSERT INTO storage.buckets (id, name, public)
VALUES ('organisation-logos', 'organisation-logos', true)
ON CONFLICT (id) DO NOTHING;

-- Anyone (including anon) can read logos — they're surfaced on public invoices.
DROP POLICY IF EXISTS "Anyone can view organisation logos" ON storage.objects;
CREATE POLICY "Anyone can view organisation logos"
ON storage.objects FOR SELECT
USING (bucket_id = 'organisation-logos');

-- Authenticated users can upload only into their own user-id-prefixed folder.
DROP POLICY IF EXISTS "Users can upload their own organisation logo" ON storage.objects;
CREATE POLICY "Users can upload their own organisation logo"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'organisation-logos'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

DROP POLICY IF EXISTS "Users can update their own organisation logo" ON storage.objects;
CREATE POLICY "Users can update their own organisation logo"
ON storage.objects FOR UPDATE
TO authenticated
USING (
  bucket_id = 'organisation-logos'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

DROP POLICY IF EXISTS "Users can delete their own organisation logo" ON storage.objects;
CREATE POLICY "Users can delete their own organisation logo"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'organisation-logos'
  AND (storage.foldername(name))[1] = auth.uid()::text
);
