-- 0015 — Recurring invoice templates (Phase 8 of the invoice generator).
--
-- A template captures everything needed to mint a draft invoice on a
-- schedule: who to bill, line items, tax rate, day-of-month or weekly
-- cadence. The cron at /api/cron/issue-recurring runs daily, finds
-- templates whose `next_run_at` is in the past, mints + issues a draft,
-- and advances `next_run_at` per the cadence.
--
-- Line items are stored as a JSONB snapshot rather than a child table.
-- Each line carries description / quantity / unit_price / tax_rate_id /
-- job_id (latter usually null for recurring). The shape mirrors the
-- `InvoiceLineItemDraft` TS type so the same `computeLineRows` helper
-- on the inbuilt provider can consume it directly.
--
-- Apply via Supabase Dashboard → SQL Editor (idempotent on re-run).

CREATE TABLE IF NOT EXISTS public.recurring_invoice_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Recipient
  client_id uuid NOT NULL,
  organisation_id uuid,
  -- Schedule
  cadence text NOT NULL,                  -- 'monthly' | 'weekly' | 'quarterly'
  -- For monthly/quarterly: day of month (1-28). For weekly: ignored.
  day_of_month integer,
  -- For weekly: 0=Sun … 6=Sat. For monthly/quarterly: ignored.
  day_of_week integer,
  -- Optional ISO date the schedule stops. NULL = open-ended.
  ends_on date,
  -- Optional ISO date when the schedule first activates. Defaults to today.
  starts_on date NOT NULL DEFAULT (now() AT TIME ZONE 'UTC')::date,
  -- The next time the cron should fire. Pre-computed at create time and
  -- after every fire so the cron just selects WHERE next_run_at <= today.
  next_run_at date NOT NULL,
  -- Snapshot of the draft contents.
  notes text,
  line_items jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- Whether to immediately call `issueInvoice` after creating the draft.
  -- 'draft' = leave for admin to review; 'issued' = auto-issue; 'sent' = auto-issue + send.
  auto_action text NOT NULL DEFAULT 'issued',
  active boolean NOT NULL DEFAULT true,
  last_run_at timestamptz,
  last_invoice_id uuid,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT recurring_cadence_check
    CHECK (cadence IN ('monthly', 'weekly', 'quarterly')),
  CONSTRAINT recurring_auto_action_check
    CHECK (auto_action IN ('draft', 'issued', 'sent')),
  CONSTRAINT recurring_day_of_month_check
    CHECK (day_of_month IS NULL OR (day_of_month >= 1 AND day_of_month <= 28)),
  CONSTRAINT recurring_day_of_week_check
    CHECK (day_of_week IS NULL OR (day_of_week >= 0 AND day_of_week <= 6))
);

CREATE INDEX IF NOT EXISTS recurring_invoice_templates_client_idx
  ON public.recurring_invoice_templates (client_id);

CREATE INDEX IF NOT EXISTS recurring_invoice_templates_next_run_idx
  ON public.recurring_invoice_templates (next_run_at)
  WHERE active = true;

ALTER TABLE public.recurring_invoice_templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can manage recurring templates"
  ON public.recurring_invoice_templates;

CREATE POLICY "Admins can manage recurring templates"
  ON public.recurring_invoice_templates
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "Clients can view their own recurring templates"
  ON public.recurring_invoice_templates;

CREATE POLICY "Clients can view their own recurring templates"
  ON public.recurring_invoice_templates
  FOR SELECT
  TO authenticated
  USING (client_id = auth.uid());
