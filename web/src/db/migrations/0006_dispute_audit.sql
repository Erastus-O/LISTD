-- 0006 — Dispute audit category.
--
-- Adds `'dispute'` to `audit_event_category` so the dispute resolve handler
-- can write an audit row alongside each transition. Closes the residual
-- audit-events gap for dispute resolution (was previously "logged by
-- destination table only" — `disputes.resolved_by` / `resolved_at` capture
-- who/when but the unified `audit_events` view didn't include them).
--
-- Apply via Supabase Dashboard → SQL Editor.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'audit_event_category'
      AND e.enumlabel = 'dispute'
  ) THEN
    ALTER TYPE audit_event_category ADD VALUE 'dispute';
  END IF;
END $$;
