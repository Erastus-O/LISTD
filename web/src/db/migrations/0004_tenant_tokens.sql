-- M3 #1–4 — Tenant portal token lifecycle.
--
-- Each row is one issued token. Rotation appends a new row with
-- `rotated_from_id` pointing at the previous row (so the prior token can
-- be honoured for a 5-minute grace window per the M3 #1 spec, then the
-- old row's `revoked_at` is set). Revocation = non-null `revoked_at`.
--
-- The legacy `tenant_details.tenant_token` text column is **left in place**
-- for back-compat with the existing portal placeholders. New flows resolve
-- through `tenant_tokens`. The legacy column can be retired in a later
-- milestone once nothing reads it.
--
-- Apply via `npm run db:migrate` or paste into Supabase Dashboard SQL Editor.

CREATE TABLE IF NOT EXISTS "tenant_tokens" (
  "id"                    uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "job_id"                uuid NOT NULL REFERENCES "jobs"("id"),
  "tenant_detail_id"      uuid REFERENCES "tenant_details"("id"),
  "token"                 text NOT NULL,
  "scope"                 text[] DEFAULT ARRAY[]::text[] NOT NULL,
  "issued_at"             timestamp with time zone DEFAULT now() NOT NULL,
  "issued_by"             uuid,
  "expires_at"            timestamp with time zone NOT NULL,
  "revoked_at"            timestamp with time zone,
  "revoked_by"            uuid,
  "revoked_reason"        text,
  "rotated_from_id"       uuid REFERENCES "tenant_tokens"("id"),
  "rotated_at"            timestamp with time zone,
  "last_used_at"          timestamp with time zone,
  "last_used_ip"          text,
  "last_used_user_agent"  text,
  "created_at"            timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at"            timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "tenant_tokens_token_key" UNIQUE ("token")
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "tenant_tokens_job_idx"
  ON "tenant_tokens" ("job_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tenant_tokens_expires_idx"
  ON "tenant_tokens" ("expires_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tenant_tokens_rotated_from_idx"
  ON "tenant_tokens" ("rotated_from_id");
--> statement-breakpoint

ALTER TABLE "tenant_tokens" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

DROP POLICY IF EXISTS "Admins can manage all tenant tokens" ON "tenant_tokens";
CREATE POLICY "Admins can manage all tenant tokens"
  ON "tenant_tokens" AS PERMISSIVE FOR ALL
  TO public
  USING (has_role(auth.uid(), 'admin'::app_role));
--> statement-breakpoint

DROP POLICY IF EXISTS "Clerks can view tenant tokens for their jobs" ON "tenant_tokens";
CREATE POLICY "Clerks can view tenant tokens for their jobs"
  ON "tenant_tokens" AS PERMISSIVE FOR SELECT
  TO public
  USING (EXISTS (
    SELECT 1 FROM jobs
    WHERE jobs.id = tenant_tokens.job_id
      AND jobs.clerk_id = auth.uid()
  ));
--> statement-breakpoint

DROP POLICY IF EXISTS "Clients can view tenant tokens for their jobs" ON "tenant_tokens";
CREATE POLICY "Clients can view tenant tokens for their jobs"
  ON "tenant_tokens" AS PERMISSIVE FOR SELECT
  TO public
  USING (EXISTS (
    SELECT 1 FROM jobs
    WHERE jobs.id = tenant_tokens.job_id
      AND jobs.client_id = auth.uid()
  ));
