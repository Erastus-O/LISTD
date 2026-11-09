import Link from 'next/link'
import { ExternalLink } from 'lucide-react'

/**
 * Apply CTAs for a vacancy. `applyPath` (the LISTD-hosted application page,
 * /careers/<slug>#apply) renders the primary "Apply now" button; the
 * Indeed / LinkedIn posting links the admin saved render as outbound
 * alternatives that deep-link into those platforms' flows. A role with no
 * route at all shows an "opening soon" note instead of a dead end.
 */
export function ApplyButtons({
  indeedUrl,
  linkedinUrl,
  applyPath,
  compact = false,
}: {
  indeedUrl?: string
  linkedinUrl?: string
  /** Internal LISTD application page for this role. */
  applyPath?: string
  compact?: boolean
}) {
  if (!applyPath && !indeedUrl && !linkedinUrl) {
    return (
      <p className="text-sm text-muted-foreground italic">
        Applications opening soon.
      </p>
    )
  }
  const base = compact
    ? 'inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium transition-all duration-300 hover:-translate-y-0.5'
    : 'inline-flex items-center gap-2 px-6 py-3 text-sm font-medium transition-all duration-300 hover:-translate-y-0.5 hover:shadow-lg'
  return (
    <div className="flex flex-wrap gap-3">
      {applyPath && (
        <Link
          href={applyPath}
          className={`${base} bg-primary text-primary-foreground hover:shadow-primary/20`}
        >
          Apply now
        </Link>
      )}
      {indeedUrl && (
        <a
          href={indeedUrl}
          target="_blank"
          rel="noopener noreferrer"
          className={`${base} ${
            applyPath
              ? 'border border-primary bg-transparent text-primary hover:bg-primary/5'
              : 'bg-primary text-primary-foreground hover:shadow-primary/20'
          }`}
        >
          Apply on Indeed
          <ExternalLink className={compact ? 'h-3 w-3' : 'h-3.5 w-3.5'} />
        </a>
      )}
      {linkedinUrl && (
        <a
          href={linkedinUrl}
          target="_blank"
          rel="noopener noreferrer"
          className={`${base} border border-primary bg-transparent text-primary hover:bg-primary/5`}
        >
          Apply on LinkedIn
          <ExternalLink className={compact ? 'h-3 w-3' : 'h-3.5 w-3.5'} />
        </a>
      )}
    </div>
  )
}
