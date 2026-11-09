-- 0020 — Appointment reminder idempotency log.
--
-- The `/api/cron/appointment-reminders` cron runs once a day. We need a
-- de-dupe key so that:
--   - if the cron retries within the same UTC day (Vercel's automatic
--     retry-on-failure), recipients aren't reminded twice;
--   - if a job's scheduled_date is rescheduled into a window that's
--     already been processed, we don't fire the reminder again for the
--     same (job, kind) pair.
--
-- `kind` is free-form so future variants (e.g. 'two_hour_before' once we
-- have structured time slots) can coexist without schema changes. The
-- (job_id, kind) UNIQUE constraint is the safety net behind the cron's
-- "skip if already sent" pre-check — even if the pre-check races, the
-- unique index rejects the duplicate insert.
--
-- Apply via Supabase Dashboard → SQL Editor (idempotent on re-run).

CREATE TABLE IF NOT EXISTS public.appointment_reminders_sent (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  kind text NOT NULL,
  recipient_count integer NOT NULL DEFAULT 0,
  email_sent_count integer NOT NULL DEFAULT 0,
  email_skipped_count integer NOT NULL DEFAULT 0,
  sent_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS appointment_reminders_sent_job_kind_uniq
  ON public.appointment_reminders_sent (job_id, kind);

CREATE INDEX IF NOT EXISTS appointment_reminders_sent_sent_at_idx
  ON public.appointment_reminders_sent (sent_at DESC);

ALTER TABLE public.appointment_reminders_sent ENABLE ROW LEVEL SECURITY;

-- Admins read everything (used by future admin dashboards).
DROP POLICY IF EXISTS "Admins read all appointment reminders" ON public.appointment_reminders_sent;
CREATE POLICY "Admins read all appointment reminders"
  ON public.appointment_reminders_sent FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

-- Service role bypasses RLS so the cron inserts without an explicit
-- INSERT policy.
