-- 0041 - Structured report actions and AI executive summaries.
--
-- Action flags live on both the mobile working copy and the submitted
-- inspection item so the clerk's explicit intent survives QA and PDF
-- regeneration. The summary is stored on the submitted inspection report;
-- its JSON shape is versioned by application code and remains nullable for
-- reports created before this migration.

ALTER TABLE public.inspection_capture_items
  ADD COLUMN IF NOT EXISTS action_type text,
  ADD COLUMN IF NOT EXISTS action_comment text;

ALTER TABLE public.inspection_capture_items
  DROP CONSTRAINT IF EXISTS inspection_capture_items_action_type_check;

ALTER TABLE public.inspection_capture_items
  ADD CONSTRAINT inspection_capture_items_action_type_check
  CHECK (action_type IS NULL OR action_type IN ('maintenance', 'cleaning'));

ALTER TABLE public.inspection_items
  ADD COLUMN IF NOT EXISTS action_type text,
  ADD COLUMN IF NOT EXISTS action_comment text;

ALTER TABLE public.inspection_items
  DROP CONSTRAINT IF EXISTS inspection_items_action_type_check;

ALTER TABLE public.inspection_items
  ADD CONSTRAINT inspection_items_action_type_check
  CHECK (action_type IS NULL OR action_type IN ('maintenance', 'cleaning'));

ALTER TABLE public.inspection_reports
  ADD COLUMN IF NOT EXISTS executive_summary jsonb,
  ADD COLUMN IF NOT EXISTS executive_summary_generated_at timestamptz;
