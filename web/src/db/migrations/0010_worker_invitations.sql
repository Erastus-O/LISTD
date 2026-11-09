-- 0010 — Client organisation workers.
--
-- Lets a client invite staff members ("workers") into their organisation.
-- Workers share the same `client` Supabase auth role but carry
-- `organisation_members.org_role = 'worker'`. The `client` org_role is
-- reserved for the org owner.
--
-- New columns:
--   - `profiles.password_must_change`     — forces a password reset on
--                                           first login. Set to true when
--                                           an admin/owner creates a user
--                                           with a temp password.
--
-- Apply via Supabase Dashboard → SQL Editor (idempotent on re-run).

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS password_must_change boolean NOT NULL DEFAULT false;

-- Standardise org_role values. Existing rows use 'staff' / 'client'; we
-- normalise so the worker flow has a stable check vocabulary. The check
-- constraint allows any historical value plus the new ones — DB stays
-- permissive, app layer enforces the canonical names.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'organisation_members_org_role_check'
  ) THEN
    ALTER TABLE public.organisation_members
      ADD CONSTRAINT organisation_members_org_role_check
      CHECK (org_role IN ('owner', 'admin', 'worker', 'client', 'staff'));
  END IF;
END $$;

-- Helpful index: members lookups by user_id (worker dashboard reads its
-- own membership row).
CREATE INDEX IF NOT EXISTS organisation_members_user_idx
  ON public.organisation_members (user_id);
