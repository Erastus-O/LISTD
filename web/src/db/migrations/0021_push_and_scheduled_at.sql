-- 0021 — Structured appointment timestamps + Web Push subscriptions.
--
-- Two pieces of foundation for "your inspection starts in 2 hours" style
-- reminders to clerks via the mobile PWA:
--
--   1. `jobs.scheduled_at timestamptz` — a precise moment for the
--      inspection start. `scheduled_date` (date-only) + `preferred_time_slot`
--      (free-text) is fine for human display but unusable for a cron that
--      needs to ask "which jobs start in the next N minutes". This column
--      is nullable for back-compat: existing rows stay NULL until either
--      a clerk/admin enters a structured time, or the booking flow is
--      updated to capture one at create time.
--
--   2. `push_subscriptions` — Web Push API endpoints stored per user, per
--      device. The Mobile clerk PWA registers here on opt-in; the
--      appointment-reminders-soon cron and any future ad-hoc push sites
--      read from it. UNIQUE on `endpoint` because the browser already
--      treats endpoint as the dedup key, and a single user can have
--      multiple endpoints (one per browser/device install).
--
-- Apply via Supabase Dashboard → SQL Editor (idempotent on re-run).

-- ── 1. jobs.scheduled_at ───────────────────────────────────────────────

ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS scheduled_at timestamptz;

-- Indexed for the soon-reminders cron's range query
-- (`scheduled_at BETWEEN now()+window_start AND now()+window_end`).
-- Partial index keeps it small — we only ever query rows with a non-null
-- value and an active status.
CREATE INDEX IF NOT EXISTS jobs_scheduled_at_idx
  ON public.jobs (scheduled_at)
  WHERE scheduled_at IS NOT NULL;

COMMENT ON COLUMN public.jobs.scheduled_at IS
  'Precise inspection start (UTC). Powers minute-window cron queries. Nullable for back-compat — rows pre-dating migration 0021 stay NULL until manually updated. The legacy scheduled_date + preferred_time_slot columns are kept for display.';

-- NOTE: Intentionally no backfill SQL here. The `preferred_time_slot`
-- column is free-text ("morning", "between 2 and 4 pm", "asap") and
-- parsing it server-side would silently coerce ambiguous data into
-- precise timestamps. Better to leave NULL and let the booking flow +
-- admin tooling supply structured values going forward. If a one-shot
-- backfill is later wanted, do it via a manual SQL session with the
-- specific patterns the data actually contains.

-- ── 2. push_subscriptions ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.push_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- The Web Push endpoint URL — opaque to us, dedup key on the browser
  -- side. e.g. https://fcm.googleapis.com/wp/send/... for Chrome.
  endpoint text NOT NULL,
  -- Crypto material the Web Push server uses to encrypt payloads.
  -- `p256dh` is the user-agent's ECDH public key; `auth` is a 16-byte
  -- shared secret. Both are base64url strings sized < 256 bytes.
  p256dh text NOT NULL,
  auth text NOT NULL,
  -- Free-form context: 'mobile-clerk-pwa', 'desktop-chrome', etc.
  -- Lets us roll out push by surface without a separate column per app.
  source text NOT NULL DEFAULT 'mobile-clerk-pwa',
  -- UA at registration time. Diagnostic only — used when investigating
  -- a "this clerk isn't getting pushes" support ticket.
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  last_error text,
  last_error_at timestamptz
);

-- Unique on endpoint: the browser will reissue the same endpoint on
-- re-subscribe, so this lets us upsert cleanly on opt-in without ever
-- duplicating a row.
CREATE UNIQUE INDEX IF NOT EXISTS push_subscriptions_endpoint_uniq
  ON public.push_subscriptions (endpoint);

-- Fan-out queries hit "all endpoints for this user" first.
CREATE INDEX IF NOT EXISTS push_subscriptions_user_id_idx
  ON public.push_subscriptions (user_id);

ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;

-- Users manage their own subscriptions.
DROP POLICY IF EXISTS "Users insert own push subscriptions" ON public.push_subscriptions;
CREATE POLICY "Users insert own push subscriptions"
  ON public.push_subscriptions FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users read own push subscriptions" ON public.push_subscriptions;
CREATE POLICY "Users read own push subscriptions"
  ON public.push_subscriptions FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users delete own push subscriptions" ON public.push_subscriptions;
CREATE POLICY "Users delete own push subscriptions"
  ON public.push_subscriptions FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- Admins read everything for support / dashboards.
DROP POLICY IF EXISTS "Admins read all push subscriptions" ON public.push_subscriptions;
CREATE POLICY "Admins read all push subscriptions"
  ON public.push_subscriptions FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

-- Service role bypasses RLS — the cron sender writes `last_used_at` /
-- `last_error` on every send attempt without needing an UPDATE policy.
