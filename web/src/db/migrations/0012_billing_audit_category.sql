-- 0012 — Billing audit category.
--
-- Adds `'billing'` to `audit_event_category` so the inbuilt invoice
-- generator's lifecycle handlers can write audit rows alongside their
-- mutations (issue / send / payment / void / overdue).
--
-- Apply via Supabase Dashboard → SQL Editor (idempotent on re-run).

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'audit_event_category'
      AND e.enumlabel = 'billing'
  ) THEN
    ALTER TYPE audit_event_category ADD VALUE 'billing';
  END IF;
END $$;
