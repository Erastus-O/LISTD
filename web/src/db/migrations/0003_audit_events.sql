-- M1 #22 Package A.1 — Audit-events table.
--
-- Append-only audit trail for state transitions per PRD §7 Pillar 4
-- (Defensibility by Default). See Docs/M1-Audit-Events-Review.md for
-- the full design + 18-site wiring plan.
--
-- Apply via `npm run db:migrate` (preferred) or paste into Supabase
-- Dashboard → SQL Editor.

CREATE TYPE "public"."audit_event_category" AS ENUM (
  'job_lifecycle',
  'verification',
  'impersonation',
  'pricing_override',
  'strike',
  'platform_setting',
  'tenant_portal_access'
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "audit_events" (
  "id"             uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "category"       "audit_event_category" NOT NULL,
  "action"         text NOT NULL,
  "actor_user_id"  uuid,
  "target_type"    text,
  "target_id"      text,
  "payload"        jsonb DEFAULT '{}'::jsonb NOT NULL,
  "ip_address"     text,
  "user_agent"     text,
  "created_at"     timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "audit_events_target_idx"
  ON "audit_events" ("target_type", "target_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_events_actor_idx"
  ON "audit_events" ("actor_user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_events_created_at_idx"
  ON "audit_events" ("created_at");
--> statement-breakpoint

ALTER TABLE "audit_events" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

-- Admins read everything.
DROP POLICY IF EXISTS "Admins can view all audit events" ON "audit_events";
CREATE POLICY "Admins can view all audit events"
  ON "audit_events" AS PERMISSIVE FOR SELECT
  TO public
  USING (has_role(auth.uid(), 'admin'::app_role));
--> statement-breakpoint

-- Authenticated users see rows where they were the actor.
DROP POLICY IF EXISTS "Users can view their own audit events" ON "audit_events";
CREATE POLICY "Users can view their own audit events"
  ON "audit_events" AS PERMISSIVE FOR SELECT
  TO public
  USING (auth.uid() = actor_user_id);
--> statement-breakpoint

-- No INSERT / UPDATE / DELETE policies. Writes happen via service-role only
-- (lib/audit.ts → withServiceRole). Append-only by design.
