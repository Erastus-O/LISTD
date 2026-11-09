-- 0019 — Clerk mobile telemetry (Mobile Phase 7).
--
-- Append-only log of mobile-PWA health snapshots: queue depth, queue
-- bytes, oldest-queued age, retry counts, last-error strings. Lets us
-- spot offline-queue regressions in prod (the iOS aggressive-eviction
-- case is the load-bearing one) without piping every payload through
-- the audit log, which is compliance-oriented and would drown in noise.
--
-- Lives in its own table rather than `audit_events` because:
--   - High volume (every clerk pings on layout-mount + after each drain
--     + a 30-min heartbeat — `audit_events` would balloon).
--   - Different retention story: we'd prune telemetry after ~90 days
--     while keeping audit events forever.
--   - Different RLS: clerks insert their own rows; admins read all.
--
-- No update path — rows are immutable once written. Migrations to add
-- new payload fields should land as new JSONB keys, not column changes.
--
-- Apply via Supabase Dashboard → SQL Editor (idempotent on re-run).

CREATE TABLE IF NOT EXISTS public.clerk_telemetry (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clerk_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- Free-form event name: 'queue_snapshot' | 'drain_result' | 'heartbeat'
  -- plus future additions. Indexed for "all drain failures this week"
  -- style admin queries.
  event text NOT NULL,
  -- All the actual data lives here. Documented shape per event:
  --   queue_snapshot: { items: int, bytes: int, oldestQueuedAt: ms|null,
  --                     storageUsage: int|null, storageQuota: int|null }
  --   drain_result:   { attempted, succeeded, failed, errored, lastErrors: string[] }
  --   heartbeat:      { ts: ms, online: bool, visibilityState: string }
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Snapshot of the client's user-agent so we can tell iOS from Android
  -- regressions apart. Not for fingerprinting — purely diagnostic.
  user_agent text,
  -- App-version string the client self-reports (env build hash). Useful
  -- when reading "did this regression land in release X?" Nullable so
  -- pre-deploy clients still ping.
  app_version text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS clerk_telemetry_clerk_created_idx
  ON public.clerk_telemetry (clerk_id, created_at DESC);
CREATE INDEX IF NOT EXISTS clerk_telemetry_event_created_idx
  ON public.clerk_telemetry (event, created_at DESC);

ALTER TABLE public.clerk_telemetry ENABLE ROW LEVEL SECURITY;

-- Clerks can insert their own telemetry rows.
DROP POLICY IF EXISTS "Clerks insert own telemetry" ON public.clerk_telemetry;
CREATE POLICY "Clerks insert own telemetry"
  ON public.clerk_telemetry FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = clerk_id);

-- Clerks can read their own rows (debugging "what did my last drain log?").
DROP POLICY IF EXISTS "Clerks read own telemetry" ON public.clerk_telemetry;
CREATE POLICY "Clerks read own telemetry"
  ON public.clerk_telemetry FOR SELECT
  TO authenticated
  USING (auth.uid() = clerk_id);

-- Admins read all telemetry (the admin dashboard surface that
-- consumes this will land alongside 7.4/7.5).
DROP POLICY IF EXISTS "Admins read all telemetry" ON public.clerk_telemetry;
CREATE POLICY "Admins read all telemetry"
  ON public.clerk_telemetry FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));
