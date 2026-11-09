-- 0038 — Job site events (arrival check-in, running-late, no-access).
--
-- First build slice of the Service Delivery & User Protection Framework
-- (Docs/LISTD_Service_Delivery_and_Protection_Framework.md §14 items 1, 3, 4):
--
--   * `job_site_events` — one row per on-site event filed by the assigned
--     pro (clerk OR cleaner):
--       - kind 'arrival'      — check-in with server timestamp, optional
--                               geolocation (lat/lng/accuracy) and optional
--                               doorstep photo. The evidence that defeats
--                               "no-show" claims and feeds the live map pin.
--       - kind 'running_late' — honest ETA flag; halves lateness penalties
--                               per framework §5.A2.
--       - kind 'no_access'    — structured aborted-visit report (reason,
--                               wait window, contact attempts, photos);
--                               the B1 evidence bundle.
--     Photos go to the existing private `job-photos` bucket under
--     `<jobId>/…`, so data-retention + DSAR sweeps already cover them.
--
--   * Widens the 0018 `job-photos` storage policies so an assigned CLEANER
--     can read/write their job's photos too (the INSERT policy only checked
--     `clerk_id`, yet the cleaner completion flow already uploads there).
--
-- Apply via Supabase Dashboard → SQL Editor. Idempotent.

-- ── 1. job_site_events ──────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.job_site_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  actor_user_id uuid NOT NULL,
  actor_role text NOT NULL,
  kind text NOT NULL,
  -- Free-text context, any kind.
  note text,
  -- running_late only: minutes until expected arrival.
  eta_minutes integer,
  -- no_access only: reason category.
  reason text,
  -- no_access only: on-site wait window (framework requires >= 30 min).
  wait_from timestamptz,
  wait_until timestamptz,
  -- no_access only: [{ "at": iso, "method": "call|sms|message" }, ...]
  contact_attempts jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- arrival (and optionally no_access): geolocation where granted.
  latitude double precision,
  longitude double precision,
  accuracy_m double precision,
  -- Storage paths in the `job-photos` bucket ("<jobId>/…").
  photo_paths jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT job_site_events_kind_check
    CHECK (kind IN ('arrival', 'running_late', 'no_access')),
  CONSTRAINT job_site_events_actor_role_check
    CHECK (actor_role IN ('clerk', 'cleaner', 'admin')),
  CONSTRAINT job_site_events_reason_check
    CHECK (reason IS NULL OR reason IN (
      'no_keys', 'keyholder_absent', 'wrong_address', 'wrong_access_code',
      'property_unsafe', 'tenant_refused', 'other'
    )),
  CONSTRAINT job_site_events_eta_check
    CHECK (eta_minutes IS NULL OR (eta_minutes > 0 AND eta_minutes <= 480))
);

CREATE INDEX IF NOT EXISTS job_site_events_job_created_idx
  ON public.job_site_events (job_id, created_at DESC);

CREATE INDEX IF NOT EXISTS job_site_events_kind_created_idx
  ON public.job_site_events (kind, created_at DESC);

ALTER TABLE public.job_site_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins manage all site events"
  ON public.job_site_events;
CREATE POLICY "Admins manage all site events"
  ON public.job_site_events
  FOR ALL
  TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS "Assigned pros insert site events"
  ON public.job_site_events;
CREATE POLICY "Assigned pros insert site events"
  ON public.job_site_events
  FOR INSERT
  TO authenticated
  WITH CHECK (
    actor_user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.jobs
      WHERE jobs.id = job_site_events.job_id
        AND (jobs.clerk_id = auth.uid() OR jobs.cleaner_id = auth.uid())
    )
  );

DROP POLICY IF EXISTS "Job parties read site events"
  ON public.job_site_events;
CREATE POLICY "Job parties read site events"
  ON public.job_site_events
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.jobs
      WHERE jobs.id = job_site_events.job_id
        AND (
          jobs.clerk_id = auth.uid()
          OR jobs.cleaner_id = auth.uid()
          OR jobs.client_id = auth.uid()
        )
    )
  );

-- ── 2. job-photos policies: include the assigned cleaner ────────────
-- Same policy names as 0018 so this cleanly replaces them.

DROP POLICY IF EXISTS "Clerks read their job's photos" ON storage.objects;
CREATE POLICY "Clerks read their job's photos"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'job-photos'
    AND EXISTS (
      SELECT 1 FROM public.jobs
      WHERE jobs.id::text = split_part(storage.objects.name, '/', 1)
        AND (
          jobs.clerk_id = auth.uid()
          OR jobs.cleaner_id = auth.uid()
          OR jobs.client_id = auth.uid()
        )
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
        AND (jobs.clerk_id = auth.uid() OR jobs.cleaner_id = auth.uid())
    )
  );
