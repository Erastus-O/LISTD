'use client'

import { useEffect, useRef } from 'react'
import { ExternalLink } from 'lucide-react'

type Props = {
  embedCode: string
  reviewLink: string
}

declare global {
  interface Window {
    Trustpilot?: {
      loadFromElement: (el: Element, async: boolean) => void
    }
  }
}

export function TrustpilotWidget({ embedCode, reviewLink }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!embedCode) return
    let cancelled = false
    let attempts = 0
    const MAX_ATTEMPTS = 50 // ≈ 5s total at 100ms intervals

    const tryLoad = () => {
      if (cancelled) return
      const widget = containerRef.current?.querySelector('.trustpilot-widget')
      if (widget && window.Trustpilot) {
        window.Trustpilot.loadFromElement(widget, true)
        return
      }
      // Bootstrap script (loaded via next/script in app/layout.tsx) may not
      // be ready yet on initial render. Retry briefly.
      attempts++
      if (attempts < MAX_ATTEMPTS) {
        setTimeout(tryLoad, 100)
      }
    }

    tryLoad()
    return () => {
      cancelled = true
    }
  }, [embedCode])

  return (
    <section className="s-sec s-wrap">
      <div className="s-in">
        <div className="flex flex-col md:flex-row md:items-end justify-between mb-10 gap-4">
          <div className="flex items-center gap-2">
            <svg
              viewBox="0 0 24 24"
              className="w-5 h-5"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path
                d="M12 2l2.4 7.4H22l-6 4.4 2.3 7.2L12 16.6 5.7 21l2.3-7.2-6-4.4h7.6L12 2z"
                fill="#00B67A"
              />
            </svg>
            <span className="s-kicker">Reviews on Trustpilot</span>
          </div>

          {reviewLink && (
            <a
              href={reviewLink}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 text-sm text-primary hover:underline underline-offset-4"
            >
              Leave a review on Trustpilot
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          )}
        </div>

        {embedCode ? (
          <div
            ref={containerRef}
            className="w-full"
            dangerouslySetInnerHTML={{ __html: embedCode }}
          />
        ) : (
          <div className="border border-dashed border-border rounded-lg p-12 text-center">
            <p className="text-sm font-medium text-foreground mb-1">
              Trustpilot widget enabled but no embed code provided.
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              An admin can add a Trustpilot widget embed code in the Settings
              panel.
            </p>
          </div>
        )}
      </div>
    </section>
  )
}
