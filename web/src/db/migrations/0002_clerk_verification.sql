-- M1 #5–6 — Clerk verification surface (per Docs/LISTD_M1_Tasks.md).
--
-- Hand-written rather than drizzle-kit generated to avoid the cron-baseline
-- noise documented in 0001. Adds 5 columns to `profiles`:
--   - `dbs_expiry`                       — date, drives the M1 #9 cron
--   - `government_id_url`                — text, Step-1 ID upload
--   - `government_id_expiry`             — date, optional (driver's licence)
--   - `verification_reviewed_at`         — timestamptz, when admin acted
--   - `verification_reviewed_by`         — uuid, admin user_id
--   - `verification_rejection_reason`    — text, populated on reject
--
-- Apply via: `npm run db:migrate` or paste into Supabase Dashboard SQL Editor.

ALTER TABLE "profiles" ADD COLUMN IF NOT EXISTS "dbs_expiry" date;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN IF NOT EXISTS "government_id_url" text;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN IF NOT EXISTS "government_id_expiry" date;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN IF NOT EXISTS "verification_reviewed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN IF NOT EXISTS "verification_reviewed_by" uuid;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN IF NOT EXISTS "verification_rejection_reason" text;
