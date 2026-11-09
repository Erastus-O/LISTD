-- 0037 — LISTD-hosted job applications.
--
-- Each vacancy (admin-posted on /admin/careers, stored in platform_settings)
-- gets a public page at /careers/<slug> with an application form. The admin
-- pastes that URL into Indeed / LinkedIn as the "apply on company website"
-- link, so applicants arriving from those boards complete the application ON
-- LISTD. Applications land here; CVs go to the private `job-applications`
-- storage bucket (service-role access only — admins view via short-lived
-- signed URLs).
--
-- Apply via Supabase Dashboard → SQL Editor. Idempotent.

CREATE TABLE IF NOT EXISTS public.job_applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vacancy_id text NOT NULL,        -- Vacancy.id from the platform_settings blob
  vacancy_title text NOT NULL,     -- snapshot: survives the vacancy being deleted
  full_name text NOT NULL,
  email text NOT NULL,
  phone text,
  linkedin_url text,
  cover_note text,
  cv_path text,                    -- storage object path in `job-applications`
  status text NOT NULL DEFAULT 'new',  -- new | reviewed | shortlisted | rejected
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS job_applications_vacancy_idx
  ON public.job_applications (vacancy_id, created_at DESC);

ALTER TABLE public.job_applications ENABLE ROW LEVEL SECURITY;

-- Applicants are anonymous visitors: inserts run through the public API via
-- the service role (which bypasses RLS). Admins manage everything else.
DROP POLICY IF EXISTS "Admins manage job applications" ON public.job_applications;
CREATE POLICY "Admins manage job applications" ON public.job_applications
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

-- Private CV bucket. No client-side policies at all — uploads and signed
-- URLs both go through the service role.
INSERT INTO storage.buckets (id, name, public)
VALUES ('job-applications', 'job-applications', false)
ON CONFLICT (id) DO UPDATE SET public = false;
