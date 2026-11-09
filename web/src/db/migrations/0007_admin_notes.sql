-- 0007 — Admin notes column on profiles.
--
-- Generic admin internal-notes field shared by client + clerk detail pages
-- (Lovable historically had `useSaveClientAdminNotes` for clients and
-- inline notes for clerks; we collapse to one column on `profiles`).
--
-- Apply via Supabase Dashboard → SQL Editor.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS admin_notes text;
