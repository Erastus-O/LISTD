-- 0032: per-organisation control over who pays for a worker's posts.
--
-- 'owner_link' (default): when a worker posts a job it stays draft and a
--   secure Stripe payment link is sent to the org owner(s) to publish it.
-- 'worker_pays': the worker completes the checkout themselves (legacy
--   behaviour).
--
-- Existing organisations adopt the default ('owner_link') automatically via
-- the NOT NULL DEFAULT, matching "the default option is the payment link
-- until the client selects otherwise".

ALTER TABLE "organisations"
  ADD COLUMN IF NOT EXISTS "worker_post_payment_mode" text NOT NULL DEFAULT 'owner_link';
