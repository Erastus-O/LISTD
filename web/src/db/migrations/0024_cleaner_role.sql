-- 0024 — Cleaner role + cleaner job-assignment columns.
--
-- Introduces the new `cleaner` user role and the columns on `jobs` that a
-- cleaning job needs (mirrors the existing clerk-payout columns, but for the
-- cleaner who performs the clean). Cleaning jobs use `cleaner_id` (not
-- `clerk_id`); the clean level is stored on `jobs.inspection_type` as
-- `clean_light` / `clean_general` / `clean_deep` (column is already text — see
-- 0023), so no enum change is needed for the level.
--
-- Apply via Supabase Dashboard → SQL Editor. Idempotent (IF NOT EXISTS guards).
--
-- NOTE: `ALTER TYPE ... ADD VALUE` must be committed before the new value can
-- be used. The SQL Editor runs each statement in its own transaction, so this
-- is fine; if you wrap the whole file in an explicit BEGIN/COMMIT, run the
-- ALTER TYPE line on its own first.

-- 1) New role value on the app_role enum.
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'cleaner';

-- 2) Cleaner assignment + payout columns on jobs (mirror of the clerk set).
ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS cleaner_id uuid,
  ADD COLUMN IF NOT EXISTS cleaner_payout numeric DEFAULT '0',
  ADD COLUMN IF NOT EXISTS cleaner_final_payout numeric DEFAULT '0',
  ADD COLUMN IF NOT EXISTS cleaner_payout_locked boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS cleaner_payment_date timestamptz,
  ADD COLUMN IF NOT EXISTS cleaner_payout_breakdown jsonb DEFAULT '{}'::jsonb;

-- 3) Index for the cleaner's "my jobs" / marketplace queries.
CREATE INDEX IF NOT EXISTS jobs_cleaner_id_idx ON public.jobs (cleaner_id);
