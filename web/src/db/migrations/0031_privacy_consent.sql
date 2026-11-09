-- 0031: record which Privacy Policy version each user consented to.
--
-- Going forward, signup stamps these via user_metadata → bootstrapUser. This
-- migration adds the columns and backfills existing accounts: we treat their
-- account-creation moment as the consent date against the policy in force at
-- launch (2026-02-01). The dormant terms_agreed_at is stamped for the same
-- cohort so the in-app consent surface has a date to show.

ALTER TABLE "profiles"
  ADD COLUMN IF NOT EXISTS "privacy_policy_version" text,
  ADD COLUMN IF NOT EXISTS "privacy_policy_accepted_at" timestamp with time zone;

UPDATE "profiles"
  SET
    "privacy_policy_accepted_at" = COALESCE("privacy_policy_accepted_at", "created_at"),
    "privacy_policy_version"     = COALESCE("privacy_policy_version", '2026-02-01'),
    "terms_agreed_at"            = COALESCE("terms_agreed_at", "created_at")
  WHERE "privacy_policy_accepted_at" IS NULL;
