// Ported from the prototype: website/index.html.
import type { CSSProperties } from 'react'
import Link from 'next/link'

export function CtaBand() {
  return (
    <>
<section className="s-wrap" style={{ paddingBlock: '0 var(--space-16)' } as CSSProperties}>
  <div className="s-in s-cta">
    <span className="s-kicker" style={{ color: 'var(--mint-300)' } as CSSProperties}>Get started</span>
    <h2 className="s-h2">Make every handover provable</h2>
    <p>Create a free client account and make your first booking in minutes. No subscription, pay per service.</p>
    <div className="s-actions" style={{ justifyContent: 'center' } as CSSProperties}><Link href="/auth?tab=signup" className="ld-btn ld-btn-accent ld-btn-lg">Book a service</Link><Link href="/contact" className="ld-btn ld-btn-secondary ld-btn-lg">Talk to us</Link></div>
  </div>
</section>
    </>
  )
}
