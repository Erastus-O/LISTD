-- 0039 — Property media + dwelling type + mobile item write-ups.
--
-- Three unrelated-looking changes that all serve one goal: let a Pro judge
-- a posting from the job card, and finish the whole write-up on the phone.
--
--   1. `properties.image_url` — the client-supplied photo of the property.
--      Renders as the thumbnail on the Available / My Jobs cards in both
--      apps. Bytes live in a new PRIVATE `property-photos` bucket; the URL
--      is re-signed server-side before it reaches a browser, same pattern
--      as `job-photos`.
--
--   2. `properties.dwelling_type` — flat / house / maisonette / …. The
--      existing `property_type` enum only ever held bed COUNT ('2_bed'),
--      which is why the job screens read "2_bed · 2 bed · unfurnished".
--      Plain `text` (not an enum) so admin-defined types don't need a
--      migration, matching the 0023 decision for `inspection_type`.
--      Nullable: pre-existing properties simply have no answer yet.
--
--   3. `inspection_capture_items` — the item-level write-up the mobile PWA
--      now collects (description + condition narrative per item, e.g.
--      "Sofa"), which until now could only be typed on the desktop
--      `/inspect` form. Photos stay in `inspection_captures`, joined by
--      (room_id, item_name); this table carries the prose and lets an item
--      exist with NO photo (walls, ceilings — noted but not always shot).
--      `inspection_rooms` / `_items` remain the submitted-report tables;
--      these rows are the pre-submit working copy.
--
-- Apply via Supabase Dashboard → SQL Editor. Idempotent.

-- ── 1. Property media + dwelling type ───────────────────────────────

ALTER TABLE public.properties
  ADD COLUMN IF NOT EXISTS image_url text;

ALTER TABLE public.properties
  ADD COLUMN IF NOT EXISTS dwelling_type text;

INSERT INTO storage.buckets (id, name, public)
VALUES ('property-photos', 'property-photos', false)
ON CONFLICT (id) DO NOTHING;

-- Writes are scoped to the uploader's own folder ("<userId>/…"), the same
-- shape as the `avatars` bucket. We key on the uploader rather than the
-- property because the booking flow uploads the photo BEFORE the property
-- row exists.
DROP POLICY IF EXISTS "Owners write their property photos" ON storage.objects;
CREATE POLICY "Owners write their property photos"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'property-photos'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS "Owners read their property photos" ON storage.objects;
CREATE POLICY "Owners read their property photos"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'property-photos'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS "Owners replace their property photos" ON storage.objects;
CREATE POLICY "Owners replace their property photos"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'property-photos'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS "Admins manage all property photos" ON storage.objects;
CREATE POLICY "Admins manage all property photos"
  ON storage.objects FOR ALL
  TO authenticated
  USING (
    bucket_id = 'property-photos'
    AND has_role(auth.uid(), 'admin'::app_role)
  )
  WITH CHECK (
    bucket_id = 'property-photos'
    AND has_role(auth.uid(), 'admin'::app_role)
  );

-- Pros never read this bucket through RLS: the job feeds mint a signed URL
-- with the service-role client, so a clerk browsing Available Jobs sees the
-- thumbnail without gaining any standing read grant on the bucket.

-- ── 2. Mobile item write-ups ────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.inspection_capture_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  room_id uuid NOT NULL REFERENCES public.inspection_rooms_map(id) ON DELETE CASCADE,
  item_name text NOT NULL,
  item_order integer NOT NULL DEFAULT 0,
  -- What the item is (colour, size, brand). Maps to
  -- `inspection_items.description` at submit.
  description text,
  -- Free-text condition narrative. Maps to
  -- `inspection_items.condition_notes` at submit. Deliberately NOT the
  -- 4-value check that constrains `inspection_captures.condition` —
  -- "minor scratch top-left, otherwise good order" doesn't fit an enum.
  condition_notes text,
  -- Set when the text was drafted by the vision model, so QA can weight
  -- an AI-drafted line differently from one the clerk typed.
  ai_drafted boolean NOT NULL DEFAULT false,
  -- Clerk removed a template item for this room (e.g. no dishwasher).
  -- Soft-delete so re-seeding the template doesn't resurrect it.
  removed boolean NOT NULL DEFAULT false,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- One row per item per room. Case-insensitive so "Sofa" and "sofa" don't
-- split into two items — the capture→item join is case-insensitive too.
CREATE UNIQUE INDEX IF NOT EXISTS inspection_capture_items_room_name_key
  ON public.inspection_capture_items (room_id, lower(item_name));

CREATE INDEX IF NOT EXISTS inspection_capture_items_job_idx
  ON public.inspection_capture_items (job_id);

ALTER TABLE public.inspection_capture_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Clerks manage capture items for their jobs"
  ON public.inspection_capture_items;
CREATE POLICY "Clerks manage capture items for their jobs"
  ON public.inspection_capture_items
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.jobs
      WHERE jobs.id = inspection_capture_items.job_id
        AND jobs.clerk_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.jobs
      WHERE jobs.id = inspection_capture_items.job_id
        AND jobs.clerk_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Clients read capture items for their jobs"
  ON public.inspection_capture_items;
CREATE POLICY "Clients read capture items for their jobs"
  ON public.inspection_capture_items
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.jobs
      WHERE jobs.id = inspection_capture_items.job_id
        AND jobs.client_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Admins manage all capture items"
  ON public.inspection_capture_items;
CREATE POLICY "Admins manage all capture items"
  ON public.inspection_capture_items
  FOR ALL
  TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));
