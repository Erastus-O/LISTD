-- 0009 — Report Templates (Lovable port of `ReportTemplateManager.tsx`).
--
-- Storage for admin-curated inspection report templates. Each template
-- holds a nested `structure` (areas → items) used as the starting point
-- when a clerk opens the inspection wizard.
--
-- Apply via Supabase Dashboard → SQL Editor (idempotent on re-run).

CREATE TABLE IF NOT EXISTS public.report_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  -- Shape: [{ "name": "Kitchen", "items": [{ "name": "Oven" }, ...] }, ...]
  -- Stored as jsonb so Postgres can validate + index any subfields we want
  -- to query later (e.g. items count). Validated against a Zod schema at
  -- the API boundary.
  structure jsonb NOT NULL DEFAULT '[]'::jsonb,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS report_templates_active_idx
  ON public.report_templates (is_active);
CREATE INDEX IF NOT EXISTS report_templates_created_at_idx
  ON public.report_templates (created_at DESC);

ALTER TABLE public.report_templates ENABLE ROW LEVEL SECURITY;

-- Admins manage everything.
DROP POLICY IF EXISTS "Admins can manage report templates" ON public.report_templates;
CREATE POLICY "Admins can manage report templates"
ON public.report_templates FOR ALL
TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role))
WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

-- Clerks need to read active templates so the inspection wizard can use
-- them as a starting structure.
DROP POLICY IF EXISTS "Clerks can read active report templates" ON public.report_templates;
CREATE POLICY "Clerks can read active report templates"
ON public.report_templates FOR SELECT
TO authenticated
USING (
  is_active = true
  AND has_role(auth.uid(), 'clerk'::app_role)
);
