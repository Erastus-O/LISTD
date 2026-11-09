-- M3 #5/#6 — Storage RLS for the `generated-reports` private bucket.
--
-- The bucket itself is created via Supabase Dashboard. This file adds the
-- RLS policies that control who can read / write the PDFs inside it.
-- Apply via Supabase Dashboard → SQL Editor (idempotent on re-run).
--
-- File-path convention: `<jobId>/<filename>` — i.e. the first path segment
-- is the LISTD job UUID. All policies key off that segment to scope access
-- to the right caller.

-- Clerks can manage (read / insert / update / delete) reports for jobs
-- they're assigned to. Folder = job_id; check the clerks_id matches via the
-- jobs table.
DROP POLICY IF EXISTS "Clerks can manage generated reports for their jobs" ON storage.objects;
CREATE POLICY "Clerks can manage generated reports for their jobs"
ON storage.objects FOR ALL
TO authenticated
USING (
  bucket_id = 'generated-reports'
  AND EXISTS (
    SELECT 1 FROM public.jobs
    WHERE jobs.id::text = (storage.foldername(name))[1]
      AND jobs.clerk_id = auth.uid()
  )
)
WITH CHECK (
  bucket_id = 'generated-reports'
  AND EXISTS (
    SELECT 1 FROM public.jobs
    WHERE jobs.id::text = (storage.foldername(name))[1]
      AND jobs.clerk_id = auth.uid()
  )
);

-- Clients can read reports for their own jobs. (No insert/update/delete —
-- clients don't generate report files.)
DROP POLICY IF EXISTS "Clients can view generated reports for their jobs" ON storage.objects;
CREATE POLICY "Clients can view generated reports for their jobs"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'generated-reports'
  AND EXISTS (
    SELECT 1 FROM public.jobs
    WHERE jobs.id::text = (storage.foldername(name))[1]
      AND jobs.client_id = auth.uid()
  )
);

-- Org members can read reports for their org's jobs.
DROP POLICY IF EXISTS "Org members can view org generated reports" ON storage.objects;
CREATE POLICY "Org members can view org generated reports"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'generated-reports'
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

-- Admins can manage everything.
DROP POLICY IF EXISTS "Admins can manage all generated reports" ON storage.objects;
CREATE POLICY "Admins can manage all generated reports"
ON storage.objects FOR ALL
TO authenticated
USING (
  bucket_id = 'generated-reports'
  AND has_role(auth.uid(), 'admin'::app_role)
)
WITH CHECK (
  bucket_id = 'generated-reports'
  AND has_role(auth.uid(), 'admin'::app_role)
);
