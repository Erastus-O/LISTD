-- 0022 — SMS delivery log.
--
-- Mirror of `email_logs` for SMS sends via Twilio. Powers the same
-- "what got sent, when, by which function, did it succeed" forensics
-- the admin dashboard already provides for email.
--
-- Schema choices:
--   - `recipient_phone` is the E.164 string we actually dialled
--     (post-normalisation by uk-phone.ts). Stored as text, not a
--     foreign key to profiles, so an opt-out-then-deleted user's
--     historical sends still resolve in the log.
--   - `twilio_message_sid` is the SM-prefixed string Twilio returns.
--     Indexed for "look up by SID" admin queries; also used by the
--     inbound webhook to correlate delivery-receipt updates if we
--     wire those later.
--   - `metadata jsonb` matches the email_logs convention — a free-form
--     bag callers can stash relevant context (jobId, kind, etc.) into.
--
-- Apply via Supabase Dashboard → SQL Editor (idempotent on re-run).

CREATE TABLE IF NOT EXISTS public.sms_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  function_name text NOT NULL,
  recipient_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  recipient_phone text NOT NULL,
  body text NOT NULL,
  -- 'sent' | 'failed' | 'skipped_opt_out' | 'skipped_no_phone'
  status text NOT NULL DEFAULT 'sent',
  twilio_message_sid text,
  error_code text,
  error_message text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sms_logs_recipient_user_idx
  ON public.sms_logs (recipient_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS sms_logs_recipient_phone_idx
  ON public.sms_logs (recipient_phone, created_at DESC);
CREATE INDEX IF NOT EXISTS sms_logs_twilio_sid_idx
  ON public.sms_logs (twilio_message_sid)
  WHERE twilio_message_sid IS NOT NULL;
CREATE INDEX IF NOT EXISTS sms_logs_status_created_idx
  ON public.sms_logs (status, created_at DESC);

ALTER TABLE public.sms_logs ENABLE ROW LEVEL SECURITY;

-- Admins read everything (same pattern as email_logs).
DROP POLICY IF EXISTS "Admins read all sms logs" ON public.sms_logs;
CREATE POLICY "Admins read all sms logs"
  ON public.sms_logs FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

-- Users read their own (so a clerk asking "did the reminder go?" has
-- a self-service path).
DROP POLICY IF EXISTS "Users read own sms logs" ON public.sms_logs;
CREATE POLICY "Users read own sms logs"
  ON public.sms_logs FOR SELECT
  TO authenticated
  USING (auth.uid() = recipient_user_id);

-- Service role bypasses RLS for inserts — every send writes a log row.
