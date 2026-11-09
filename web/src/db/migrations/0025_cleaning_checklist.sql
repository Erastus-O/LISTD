-- 0025 — Cleaning completion artifact.
--
-- A cleaner completes a cleaning job by working through the per-level checklist
-- and attaching before/after photos. We store that submission as a single
-- jsonb document on the job:
--   { checkedTasks: number[], notes: string, photos: string[],
--     completedAt: string }
-- (photo values are paths in the private `job-photos` Storage bucket.)
--
-- Apply via Supabase Dashboard → SQL Editor. Idempotent.

ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS cleaning_checklist jsonb DEFAULT '{}'::jsonb;
