-- 0036 — Assigned promo codes.
--
-- promo_codes.assigned_client_ids: when set (non-empty), the code is
-- PRIVATE to those client accounts — it auto-applies on their bookings
-- (prefilled on the review step, still removable) and validates for no one
-- else, even with the code string in hand. NULL/empty = public code any
-- client can type.
--
-- Apply via Supabase Dashboard → SQL Editor. Idempotent.

ALTER TABLE public.promo_codes
  ADD COLUMN IF NOT EXISTS assigned_client_ids uuid[];

-- Auto-apply lookup: "codes assigned to client X" uses array containment.
CREATE INDEX IF NOT EXISTS promo_codes_assigned_idx
  ON public.promo_codes USING gin (assigned_client_ids)
  WHERE assigned_client_ids IS NOT NULL;
