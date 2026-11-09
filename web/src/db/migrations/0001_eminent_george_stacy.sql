-- M0 Reconciliation — schema extensions per Docs/LISTD_M0_Tasks.md (#1, #2, #3).
--
-- Hand-trimmed from drizzle-kit's generated diff. Drizzle's baseline meta
-- snapshot pre-dates the manual cron-related migrations applied to Supabase
-- via the Dashboard during M-Pre (notification_automation_settings,
-- notification_queue, upsell_notifications_sent, jobs.recycle_stage,
-- jobs.is_recycled_urgent), so a fresh `db:generate` re-emits CREATE/ADD
-- statements for those. They have been removed below — only genuine M0
-- column adds remain.
--
-- After applying this migration the meta snapshot (0001_snapshot.json) will
-- correctly reflect the live state for both batches.

-- ── profiles ─────────────────────────────────────────────────────────────
ALTER TABLE "profiles" ADD COLUMN "role_subtype" text;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "terms_of_business_signed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "coverage_areas" text[];--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "service_types_offered" text[];--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "vehicle_details" text;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "languages" text[];--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "emergency_contact_name" text;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "emergency_contact_phone" text;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "dbs_certificate_url" text;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "qualification" text;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "insurance_details" text;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "insurance_expiry" date;--> statement-breakpoint

-- ── organisations ────────────────────────────────────────────────────────
ALTER TABLE "organisations" ADD COLUMN "billing_address" text;--> statement-breakpoint
ALTER TABLE "organisations" ADD COLUMN "vat_number" text;--> statement-breakpoint
ALTER TABLE "organisations" ADD COLUMN "company_reg_number" text;--> statement-breakpoint
ALTER TABLE "organisations" ADD COLUMN "logo_url" text;--> statement-breakpoint

-- ── notification_preferences ─────────────────────────────────────────────
ALTER TABLE "notification_preferences" ADD COLUMN "sms_job_updates" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD COLUMN "sms_payment_updates" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD COLUMN "whatsapp_opt_in" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD COLUMN "email_midterm_reminder" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD COLUMN "email_checkout_reminder" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD COLUMN "email_next_service_prompt" boolean DEFAULT true NOT NULL;
