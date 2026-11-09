-- 0023 — Make booking (inspection) types admin-extensible.
--
-- `jobs.inspection_type` was a Postgres ENUM, which can't take new values at
-- runtime. Convert it to TEXT so admin-defined service types (stored in
-- platform_settings → `service_types`) can be used as a job's primary type.
-- `jobs.inspection_types` is already text[].
--
-- The built-in values (new_inventory, check_in, check_out, mid_term, interim)
-- remain valid text. The old `inspection_type` enum type is left in place
-- (now unused) to avoid disturbing anything that might reference it; it can be
-- dropped later with `DROP TYPE inspection_type;` once confirmed unused.
--
-- Apply via Supabase Dashboard → SQL Editor. Idempotent: re-running the ALTER
-- when the column is already text is a no-op error you can ignore.

ALTER TABLE public.jobs
  ALTER COLUMN inspection_type TYPE text USING inspection_type::text;
