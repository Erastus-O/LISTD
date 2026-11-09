'use client'

/**
 * View-only renderer for the business insurance certificate. Shows the
 * rasterised image from the auth-gated route with no download affordance:
 * right-click is suppressed, the image isn't draggable and doesn't take
 * pointer events, and text selection is disabled. This deters casual saving
 * (there's no PDF and no download button) but cannot stop a screenshot.
 */
export function InsuranceCertView() {
  return (
    <figure
      className="relative select-none overflow-hidden rounded-lg border border-border bg-white shadow-sm"
      onContextMenu={(e) => e.preventDefault()}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- intentionally a
          plain <img> from an auth-gated route; next/image would expose a
          fetchable optimiser URL and caching we don't want here. */}
      <img
        src="/api/compliance/insurance"
        alt="LISTD Professional Indemnity & Public Liability insurance certificate"
        draggable={false}
        className="pointer-events-none block h-auto w-full"
      />
    </figure>
  )
}
