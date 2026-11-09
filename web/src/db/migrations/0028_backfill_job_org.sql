-- 0028 — Backfill jobs.organisation_id for org members' personal bookings.
--
-- Jobs created through the solo /book flow inherited the property's
-- organisation_id, which is NULL for a member's personal property. That left
-- an org owner's own jobs out of the org-scoped client dashboard (0 jobs / £0
-- spend despite a finished job). The job-create route now stamps the caller's
-- org at booking; this backfills existing rows the same way.
--
-- Idempotent: only touches rows where organisation_id IS NULL and the client
-- is an active org member. Re-running is a no-op.

UPDATE jobs j
SET organisation_id = (
      SELECT m.organisation_id
      FROM organisation_members m
      WHERE m.user_id = j.client_id
        AND m.status = 'active'
      ORDER BY CASE WHEN m.org_role = 'owner' THEN 0 ELSE 1 END
      LIMIT 1
    ),
    updated_at = now()
WHERE j.organisation_id IS NULL
  AND EXISTS (
    SELECT 1
    FROM organisation_members m
    WHERE m.user_id = j.client_id
      AND m.status = 'active'
  );
