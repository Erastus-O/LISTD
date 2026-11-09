-- 0016 — Shareable report links (closes M1 #13).
--
-- Tenant tokens (table 0004) are scoped to the tenant portal: they grant
-- view + sign + download to a specific tenant on a specific job. Share
-- tokens are different — admin issues them so any third party (e.g. the
-- landlord's accountant, an insurer) can fetch a report PDF without an
-- account.
--
-- Design decisions:
--   - Separate table (not a flag on tenant_tokens) — different lifecycle,
--     different scope set, different issuance flow.
--   - One token grants exactly one action: "fetch the signed PDF for job X".
--     No portal navigation, no sign action, no other surface.
--   - Optional `max_views` cap (NULL = unlimited) for the "this client
--     accountant only needs to look once" use case.
--   - `expires_at` is required — admins set a TTL at issue time (1d /
--     7d / 30d / 90d picker on the UI).
--
-- The public route at `/reports/share/[token]` consumes this row,
-- validates expiry / revocation / view-cap, increments view_count, then
-- streams a fresh Supabase signed URL for the PDF (so the storage path
-- itself is never exposed in the share URL).
--
-- Apply via Supabase Dashboard → SQL Editor (idempotent on re-run).

CREATE TABLE IF NOT EXISTS public.report_share_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  token text NOT NULL UNIQUE,
  -- Free-text label so the admin can tell two outstanding shares apart in
  -- the management list ("for John at Foxtons", "insurer copy", …).
  label text,
  expires_at timestamptz NOT NULL,
  -- Optional view cap. NULL = unlimited until expires_at.
  max_views integer,
  view_count integer NOT NULL DEFAULT 0,
  last_viewed_at timestamptz,
  last_viewed_ip text,
  last_viewed_user_agent text,
  revoked_at timestamptz,
  revoked_by uuid,
  revoked_reason text,
  issued_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT report_share_max_views_positive
    CHECK (max_views IS NULL OR max_views > 0)
);

CREATE INDEX IF NOT EXISTS report_share_tokens_job_idx
  ON public.report_share_tokens (job_id);

CREATE INDEX IF NOT EXISTS report_share_tokens_active_idx
  ON public.report_share_tokens (job_id, expires_at)
  WHERE revoked_at IS NULL;

ALTER TABLE public.report_share_tokens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can manage report share tokens"
  ON public.report_share_tokens;

CREATE POLICY "Admins can manage report share tokens"
  ON public.report_share_tokens
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- The public-share resolver runs via service-role; no anon SELECT policy
-- is granted. (Tokens are unguessable; access is gated by application
-- logic in the resolver.)
