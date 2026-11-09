-- 0008 — Admin job-detail surface (Lovable parity).
--
-- Adds the columns the Lovable admin job-detail page needed but that
-- haven't yet been ported into Listd-NEXT:
--
--   - `jobs.admin_notes`            — admin-only working notes, distinct
--                                     from the client-facing
--                                     `special_instructions`. Editable from
--                                     the admin job-detail page.
--   - `jobs.access_method`          — keys / tenant present / lockbox / etc.
--   - `jobs.access_collection`      — where to pick keys up from (free text:
--                                     "Andrews Clifton", "Office reception").
--   - `jobs.access_parking_notes`   — free text parking guidance for the
--                                     attending clerk.
--   - `jobs.job_ref_number`         — sequential reference behind the
--                                     human-readable `LST-YYYY-NNNN` display
--                                     format. Single global sequence; the
--                                     year segment comes from `created_at`
--                                     so the display matches the booking
--                                     year regardless of sequence drift.
--
-- Apply via Supabase Dashboard → SQL Editor (idempotent on re-run).

ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS admin_notes text,
  ADD COLUMN IF NOT EXISTS access_method text,
  ADD COLUMN IF NOT EXISTS access_collection text,
  ADD COLUMN IF NOT EXISTS access_parking_notes text;

-- Sequence for the LST-YYYY-NNNN display ref. Starts at 1000 so the very
-- first backfilled row reads as `LST-YYYY-1000` (looks professional, leaves
-- room if we ever want to retro-import historic data into a lower band).
CREATE SEQUENCE IF NOT EXISTS public.job_ref_seq
  START WITH 1000
  INCREMENT BY 1
  NO CYCLE;

ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS job_ref_number integer;

-- Backfill any rows missing a ref. New rows get one via the default below.
UPDATE public.jobs
   SET job_ref_number = nextval('public.job_ref_seq')
 WHERE job_ref_number IS NULL;

ALTER TABLE public.jobs
  ALTER COLUMN job_ref_number SET DEFAULT nextval('public.job_ref_seq'),
  ALTER COLUMN job_ref_number SET NOT NULL;

-- Unique so the display ref is a real identifier admins can paste into
-- search and trust to resolve to a single row.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'jobs_job_ref_number_key'
  ) THEN
    ALTER TABLE public.jobs
      ADD CONSTRAINT jobs_job_ref_number_key UNIQUE (job_ref_number);
  END IF;
END $$;

-- Helpful index for the admin search-by-ref experience.
CREATE INDEX IF NOT EXISTS jobs_job_ref_number_idx
  ON public.jobs (job_ref_number);
