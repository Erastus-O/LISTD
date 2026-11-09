/**
 * Legal document versions. Bump the version string (and the matching date on
 * the public policy page) whenever the wording changes materially — that's how
 * we record *which* version a user consented to at signup.
 *
 * Plain module (no `server-only`) so the signup form can stamp the version into
 * the consent record client-side and the settings pages can render it.
 */
export const PRIVACY_POLICY_VERSION = '2026-02-01'

/** Human-friendly label shown alongside the version id. */
export const PRIVACY_POLICY_LABEL = 'February 2026'

export const TERMS_VERSION = '2026-02-01'
