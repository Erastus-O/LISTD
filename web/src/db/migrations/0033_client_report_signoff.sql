-- 0033: client report sign-off & acknowledgement.
--
-- client_signature_name        — typed name when the CLIENT signs the report
--                                 (client-signoff services, e.g. Fire Safety, EPC).
-- client_report_acknowledged_at — when the client confirmed they read & received
--                                 a TENANT-signed report (recorded for audit;
--                                 admin is notified at the same time).

ALTER TABLE "jobs"
  ADD COLUMN IF NOT EXISTS "client_signature_name" text,
  ADD COLUMN IF NOT EXISTS "client_report_acknowledged_at" timestamp with time zone;
