-- 0018 — Inspection captures + room completion (Mobile Phase 2).
--
-- The mobile PWA needs three things this migration provides:
--   1. A `job-photos` storage bucket clerks can upload directly to via
--      Supabase signed-upload URLs (no proxy through the API).
--   2. A `room_completed_at` flag on `inspection_rooms_map` so the
--      capture overview can show progress and the submit-gate can
--      check completion.
--   3. A new `inspection_captures` table holding one row per photo:
--      item name, condition, caption, storage URL, plus a client-
--      supplied `client_uuid` for idempotency (the offline queue in
--      Phase 3 will replay captures on reconnect; the unique
--      constraint dedupes retries).
--
-- All policies admin-or-owner-clerk. Captures inherit visibility from
-- the parent job — if the clerk owns the job they can read/write
-- captures for it.
--
-- Apply via Supabase Dashboard → SQL Editor (idempotent on re-run).

-- ── 1. Storage bucket ───────────────────────────────────────────────

INSERT INTO storage.buckets (id, name, public)
VALUES ('job-photos', 'job-photos', false)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "Clerks read their job's photos" ON storage.objects;
CREATE POLICY "Clerks read their job's photos"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'job-photos'
    AND EXISTS (
      SELECT 1 FROM public.jobs
      WHERE jobs.id::text = split_part(storage.objects.name, '/', 1)
        AND (jobs.clerk_id = auth.uid() OR jobs.client_id = auth.uid())
    )
  );

DROP POLICY IF EXISTS "Clerks write to their job's photos" ON storage.objects;
CREATE POLICY "Clerks write to their job's photos"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'job-photos'
    AND EXISTS (
      SELECT 1 FROM public.jobs
      WHERE jobs.id::text = split_part(storage.objects.name, '/', 1)
        AND jobs.clerk_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Admins manage all job photos" ON storage.objects;
CREATE POLICY "Admins manage all job photos"
  ON storage.objects FOR ALL
  TO authenticated
  USING (
    bucket_id = 'job-photos'
    AND has_role(auth.uid(), 'admin'::app_role)
  )
  WITH CHECK (
    bucket_id = 'job-photos'
    AND has_role(auth.uid(), 'admin'::app_role)
  );

-- ── 2. Room completion flag ─────────────────────────────────────────

ALTER TABLE public.inspection_rooms_map
  ADD COLUMN IF NOT EXISTS room_completed_at timestamptz;

-- ── 3. Inspection captures ──────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.inspection_captures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  room_id uuid NOT NULL REFERENCES public.inspection_rooms_map(id) ON DELETE CASCADE,
  -- Client-supplied uuid for idempotency. The mobile app generates
  -- this BEFORE the photo upload begins, so a retry on the same
  -- capture (after a network drop) finds the existing row and
  -- short-circuits. Unique so a malformed retry can never insert
  -- twice.
  client_uuid uuid NOT NULL,
  item_name text,
  condition text,
  caption text,
  -- Public-style URL emitted by Supabase storage. The reader gates
  -- via storage RLS, not via URL secrecy.
  photo_url text NOT NULL,
  position integer NOT NULL DEFAULT 0,
  captured_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT inspection_captures_client_uuid_key UNIQUE (client_uuid),
  CONSTRAINT inspection_captures_condition_check
    CHECK (condition IS NULL OR condition IN ('good','fair','poor','damaged'))
);

CREATE INDEX IF NOT EXISTS inspection_captures_job_idx
  ON public.inspection_captures (job_id);

CREATE INDEX IF NOT EXISTS inspection_captures_room_idx
  ON public.inspection_captures (room_id, position);

ALTER TABLE public.inspection_captures ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Clerks manage captures for their jobs"
  ON public.inspection_captures;
CREATE POLICY "Clerks manage captures for their jobs"
  ON public.inspection_captures
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.jobs
      WHERE jobs.id = inspection_captures.job_id
        AND jobs.clerk_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.jobs
      WHERE jobs.id = inspection_captures.job_id
        AND jobs.clerk_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Clients read captures for their jobs"
  ON public.inspection_captures;
CREATE POLICY "Clients read captures for their jobs"
  ON public.inspection_captures
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.jobs
      WHERE jobs.id = inspection_captures.job_id
        AND jobs.client_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Admins manage all captures"
  ON public.inspection_captures;
CREATE POLICY "Admins manage all captures"
  ON public.inspection_captures
  FOR ALL
  TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));
