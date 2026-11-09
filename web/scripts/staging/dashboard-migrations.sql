-- Objects production got through the Supabase dashboard during M-Pre, recorded in
-- no migration (see the note at the top of 0001). Staging only. Safe to re-run.

ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS recycle_stage integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS is_recycled_urgent boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS public.upsell_notifications_sent (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL,
  rule_name text NOT NULL,
  sent_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (job_id, rule_name)
);

CREATE TABLE IF NOT EXISTS public.notification_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  channel text NOT NULL DEFAULT 'email',
  subject text,
  body text NOT NULL,
  status text NOT NULL DEFAULT 'queued',
  created_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  error_message text
);

CREATE TABLE IF NOT EXISTS public.notification_automation_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  setting_key text NOT NULL UNIQUE,
  value numeric NOT NULL DEFAULT 0,
  label text NOT NULL,
  category text NOT NULL DEFAULT 'general',
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);
