-- M3 #5 — Storage RLS for the `tenant-signatures` private bucket.
--
-- The bucket itself is created via Supabase Dashboard. This file adds the
-- RLS policies. Apply via Supabase Dashboard → SQL Editor (idempotent).
--
-- File-path convention: `<jobId>/<filename>` (matches `generated-reports`).
--
-- Tenants are NOT authenticated users — they sign via the token-based
-- `/tenant/portal` flow. So the **upload** path is server-only: the
-- token-verification route handler uploads via the service-role client
-- (which bypasses RLS). No `INSERT` policy here intentionally — keeps
-- arbitrary authenticated users from writing into other tenants' folders.

-- Clerks read signatures for their assigned jobs.
DROP POLICY IF EXISTS "Clerks can view tenant signatures for their jobs" ON storage.objects;
CREATE POLICY "Clerks can view tenant signatures for their jobs"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'tenant-signatures'
  AND EXISTS (
    SELECT 1 FROM public.jobs
    WHERE jobs.id::text = (storage.foldername(name))[1]
      AND jobs.clerk_id = auth.uid()
  )
);

-- Clients read signatures for their own jobs.
DROP POLICY IF EXISTS "Clients can view tenant signatures for their jobs" ON storage.objects;
CREATE POLICY "Clients can view tenant signatures for their jobs"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'tenant-signatures'
  AND EXISTS (
    SELECT 1 FROM public.jobs
    WHERE jobs.id::text = (storage.foldername(name))[1]
      AND jobs.client_id = auth.uid()
  )
);

-- Org members read for their org's jobs.
DROP POLICY IF EXISTS "Org members can view org tenant signatures" ON storage.objects;
CREATE POLICY "Org members can view org tenant signatures"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'tenant-signatures'
  AND EXISTS (
    SELECT 1
    FROM public.jobs j
    JOIN public.organisation_members om
      ON om.organisation_id = j.organisation_id
     AND om.user_id = auth.uid()
     AND om.status = 'active'
    WHERE j.id::text = (storage.foldername(name))[1]
  )
);

-- Admins manage everything.
DROP POLICY IF EXISTS "Admins can manage all tenant signatures" ON storage.objects;
CREATE POLICY "Admins can manage all tenant signatures"
ON storage.objects FOR ALL
TO authenticated
USING (
  bucket_id = 'tenant-signatures'
  AND has_role(auth.uid(), 'admin'::app_role)
)
WITH CHECK (
  bucket_id = 'tenant-signatures'
  AND has_role(auth.uid(), 'admin'::app_role)
);
