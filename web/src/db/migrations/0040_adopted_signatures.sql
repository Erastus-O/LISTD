-- 0040 — Adopted signatures (DocuSign-style) for tenant, client and clerk.
--
-- Every party signed by typing their name into a text box. The PDF
-- signature page was already built to embed a signature IMAGE for the
-- clerk and the client (`signed-pdf.ts` has drawn them since M3 #6) —
-- but nothing anywhere ever wrote those columns, so the image path was
-- dead code and all three parties rendered as italic text.
--
-- This adds the missing half: signers now adopt a mark — their typed
-- name set in a handwriting face, or one drawn with a finger/mouse —
-- which is captured as a PNG and stored.
--
--   1. `generated_reports.tenant_signature_url` — the tenant's mark.
--      `tenant_signature` (the typed name) stays and is still the
--      identity check against `tenant_details.full_name`; the image is
--      the visual signature, exactly as DocuSign separates the two.
--      The clerk and client already have their URL columns
--      (`inspection_reports.clerk_signature_url`, `jobs.client_signature_url`).
--
--   2. A private `signatures` bucket. Uploads run through the SERVICE
--      ROLE from the sign endpoints, never browser-direct: a tenant
--      signs with a portal token and has no Supabase auth identity to
--      write under, and we want the bytes validated (PNG magic, size
--      cap) before they land. Reads are signed server-side when a PDF is
--      rendered. No `authenticated` policies are granted as a result —
--      there is no path by which one signer could fetch another's mark.
--
-- Signing mode is recorded in the object KEY (`…/drawn-<ts>.png` vs
-- `…/styled-<ts>.png`) rather than a column: it's evidential context for
-- a dispute, it never needs querying, and the audit_events row written
-- at signing carries it too.
--
-- Apply via Supabase Dashboard → SQL Editor. Idempotent.

-- ── 1. Tenant signature image ───────────────────────────────────────

ALTER TABLE public.generated_reports
  ADD COLUMN IF NOT EXISTS tenant_signature_url text;

-- ── 2. Signature storage ────────────────────────────────────────────

INSERT INTO storage.buckets (id, name, public)
VALUES ('signatures', 'signatures', false)
ON CONFLICT (id) DO NOTHING;

-- Admins can inspect a signature from the dashboard when a signature is
-- disputed. Everything else goes through the service role.
DROP POLICY IF EXISTS "Admins manage all signatures" ON storage.objects;
CREATE POLICY "Admins manage all signatures"
  ON storage.objects FOR ALL
  TO authenticated
  USING (
    bucket_id = 'signatures'
    AND has_role(auth.uid(), 'admin'::app_role)
  )
  WITH CHECK (
    bucket_id = 'signatures'
    AND has_role(auth.uid(), 'admin'::app_role)
  );
