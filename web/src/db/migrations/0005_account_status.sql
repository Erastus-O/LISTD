-- 0005 — Account status surface (real data for /admin/clients status column).
--
-- Adds:
--   * profiles.account_status with check constraint + index for filter lookups
--   * profiles.deleted_at to support the soft-delete flow
--   * audit_event_category enum value 'account_status'
--
-- Apply via Supabase Dashboard → SQL Editor or `npm run db:migrate`.

-- 1. Add the column with a permissive default so existing rows back-fill to
--    'active' transparently.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS account_status text NOT NULL DEFAULT 'active';

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

-- 2. Constrain the value space. We keep the check generous to allow future
--    statuses without a migration; the dropdown enforces the active set in UI.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'profiles_account_status_check'
  ) THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_account_status_check
      CHECK (account_status IN ('active', 'suspended', 'deleted'));
  END IF;
END $$;

-- 3. Index for the /admin/clients status filter.
CREATE INDEX IF NOT EXISTS profiles_account_status_idx
  ON public.profiles (account_status);

-- 4. Extend the audit-event category enum with `account_status` so the new
--    `/api/admin/clients/[id]/account-status` handler can write its rows.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'audit_event_category'
      AND e.enumlabel = 'account_status'
  ) THEN
    ALTER TYPE audit_event_category ADD VALUE 'account_status';
  END IF;
END $$;
