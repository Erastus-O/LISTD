-- 0029 — Operational logging for troubleshooting (payment / application / error).
--
-- Structured logs are written to `app_logs` (queryable, indexed, short-lived),
-- and a daily cron (/api/cron/export-logs) rolls each channel's previous-day
-- rows into NDJSON files in the private `logs` bucket, then prunes the table.
-- This gives a tiered setup: Vercel runtime logs (live) → app_logs (queryable)
-- → daily bucket archives (durable).

CREATE TABLE IF NOT EXISTS public.app_logs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ts            timestamptz NOT NULL DEFAULT now(),
  level         text NOT NULL DEFAULT 'info',          -- debug | info | warn | error
  channel       text NOT NULL DEFAULT 'application',   -- payment | application | error
  event         text,                                  -- short machine name, e.g. escrow.released
  message       text,
  context       jsonb NOT NULL DEFAULT '{}'::jsonb,     -- structured detail (secrets redacted app-side)
  request_id    text,
  actor_user_id uuid,
  route         text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT app_logs_level_check   CHECK (level   IN ('debug','info','warn','error')),
  CONSTRAINT app_logs_channel_check CHECK (channel IN ('payment','application','error'))
);

CREATE INDEX IF NOT EXISTS app_logs_channel_ts_idx ON public.app_logs (channel, ts DESC);
CREATE INDEX IF NOT EXISTS app_logs_level_ts_idx   ON public.app_logs (level, ts DESC);
CREATE INDEX IF NOT EXISTS app_logs_ts_idx         ON public.app_logs (ts DESC);

-- RLS: admins can read; writes only happen via the service-role logger (which
-- bypasses RLS), so there is intentionally no INSERT policy for end users.
ALTER TABLE public.app_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admins read app logs" ON public.app_logs;
CREATE POLICY "Admins read app logs" ON public.app_logs
  FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));

-- Private bucket for the daily NDJSON rollups.
INSERT INTO storage.buckets (id, name, public)
VALUES ('logs', 'logs', false)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "Admins read log files" ON storage.objects;
CREATE POLICY "Admins read log files" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'logs' AND has_role(auth.uid(), 'admin'::app_role));
