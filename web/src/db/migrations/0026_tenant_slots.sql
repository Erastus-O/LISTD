-- 0026 — Tenant-selected inspection slots.
--
-- After a clerk accepts a job, the tenant picks one or more 30-minute slots
-- within the timeframe the client chose at booking (jobs.preferred_time_slot =
-- morning/afternoon/evening). We store the tenant's choice as a jsonb document
-- on the job:
--   { slots: string[] (e.g. ["09:00","09:30"]), selectedAt: string,
--     tenantDetailId: string|null }
--
-- Apply via Supabase Dashboard → SQL Editor. Idempotent.

ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS tenant_selected_slots jsonb DEFAULT '{}'::jsonb;
