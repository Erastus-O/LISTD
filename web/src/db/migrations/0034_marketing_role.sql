-- 0034: 'marketing' role — a restricted seat for the SEO agency.
--
-- Grants access to /admin/seo (meta editing) ONLY; every other admin page
-- and API rejects it. Accounts are created with
-- scripts/create-marketing-user.mjs.
--
-- Run as a standalone statement (ALTER TYPE ... ADD VALUE). Idempotent.

ALTER TYPE app_role ADD VALUE IF NOT EXISTS 'marketing';
