-- Storage bucket for user profile photos (`profiles.avatar_url` target).
--
-- Apply via Supabase Dashboard → SQL Editor (idempotent on re-run). Storage
-- buckets + storage RLS aren't tracked by Drizzle, so this lives outside
-- `src/db/migrations/`.
--
-- Public read so the top-bar `UserPill` can render `<img src=...>` directly
-- without a signed-URL hop on every page load. Writes are scoped to the
-- caller's own user-id-prefixed folder — same convention as the
-- organisation-logos bucket.

INSERT INTO storage.buckets (id, name, public)
VALUES ('avatars', 'avatars', true)
ON CONFLICT (id) DO NOTHING;

-- Anyone (incl. anon) can read avatars — they're embedded in admin views
-- of other users, audit-trail rows, etc.
DROP POLICY IF EXISTS "Anyone can view avatars" ON storage.objects;
CREATE POLICY "Anyone can view avatars"
ON storage.objects FOR SELECT
USING (bucket_id = 'avatars');

-- Authenticated users can write only into their own user-id-prefixed folder.
DROP POLICY IF EXISTS "Users can upload their own avatar" ON storage.objects;
CREATE POLICY "Users can upload their own avatar"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'avatars'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

DROP POLICY IF EXISTS "Users can update their own avatar" ON storage.objects;
CREATE POLICY "Users can update their own avatar"
ON storage.objects FOR UPDATE
TO authenticated
USING (
  bucket_id = 'avatars'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

DROP POLICY IF EXISTS "Users can delete their own avatar" ON storage.objects;
CREATE POLICY "Users can delete their own avatar"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'avatars'
  AND (storage.foldername(name))[1] = auth.uid()::text
);
