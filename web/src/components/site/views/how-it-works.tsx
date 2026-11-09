// Ported from the prototype: website/index.html.
import type { CSSProperties } from 'react'
import Link from 'next/link'
import { Icon } from '@/components/listd/icon'

export function HowItWorksView() {
  return (
    <>

  <section className="s-phead tint s-wrap"><div className="s-in"><span className="s-kicker">How it works</span><h1 className="s-h1" style={{ maxWidth: '16ch' } as CSSProperties}>From booking to approval</h1><p className="s-lead">Every step is structured, tracked and transparent, for clients and Pros alike.</p></div></section>
  <section className="s-sec s-wrap" style={{ paddingTop: 'var(--space-8)' } as CSSProperties}>
    <div className="s-in">
      <div className="s-steps">
        <div className="s-step"><div className="card"><div><b>Clifton Lettings</b><span className="s-fine">3 properties added</span></div></div><b className="k"><span>01</span>Create your account</b><p>Clients add company details and properties. Pros complete verification and set their coverage areas.</p></div>
        <div className="s-step"><div className="card"><div><span className="ld-tag" style={{ '--t': 'var(--service-checkout-subtle)', '--tx': 'var(--service-checkout-text)', height: '24px' } as CSSProperties}>Check-Out</span><b>Standard · £110</b></div></div><b className="k"><span>02</span>Book a service</b><p>Select the property, choose services and a scheduling option, and see your price before you submit.</p></div>
        <div className="s-step"><div className="card"><div><b>Sam R. accepted</b><span className="s-fine">Matched on location and availability</span></div></div><b className="k"><span>03</span>Accepted</b><p>Your job goes to verified Pros near you. You’re notified as soon as one accepts.</p></div>
        <div className="s-step"><div className="card"><div><b>Kitchen · 9 of 14 items</b><div className="ld-progress-bar"><i style={{ width: '64%', background: 'var(--live)' } as CSSProperties}></i></div></div></div><b className="k"><span>04</span>In progress</b><p>The Pro works through a structured workflow: start and completion photos, documentation and updates.</p></div>
        <div className="s-step"><div className="card"><div><b>Approved</b><span className="s-fine">£110.00 released on approval</span></div></div><b className="k"><span>05</span>LISTD review &amp; approval</b><p>LISTD reviews the work first. When it’s ready to approve, check the evidence and approve the finished job. Payment is then released to the Pro.</p></div>
      </div>
    </div>
  </section>
  <section className="s-sec s-wrap" style={{ background: 'var(--surface)' } as CSSProperties}>
    <div className="s-in s-split">
      <div style={{ display: 'grid', gap: 'var(--space-4)' } as CSSProperties}><span className="s-kicker">Your workflow as a client</span><h2 className="s-h2">Five steps, no chasing</h2>
        <ol className="s-checks" style={{ counterReset: 'none', fontSize: '16px', gap: '14px' } as CSSProperties}>
          <li><Icon name="home" size={20} /> Add properties with room counts and furnishing details</li>
          <li><Icon name="file" size={20} /> Choose services and a scheduling option</li>
          <li><Icon name="verified-pro" size={20} /> A verified Pro accepts and completes the work</li>
          <li><Icon name="signature" size={20} /> LISTD reviews the work, then you approve the finished job</li>
          <li><Icon name="escrow" size={20} /> Payment is released to the Pro</li>
        </ol>
        <div className="s-actions" style={{ marginTop: '8px' } as CSSProperties}><Link href="/auth?tab=signup" className="ld-btn ld-btn-primary ld-btn-lg">Create client account</Link></div>
      </div>
      <div className="s-visual">
        <article className="ld-card ld-job" style={{ '--c': 'var(--service-inventory)', '--t': 'var(--service-inventory-subtle)', '--tx': 'var(--service-inventory-text)' } as CSSProperties}>
          <div className="ld-job-top"><span className="ld-tag" style={{ '--c': 'var(--service-inventory)', '--t': 'var(--service-inventory-subtle)', '--tx': 'var(--service-inventory-text)' } as CSSProperties}><Icon name="inventory" size={16} />Inventory</span><span className="ld-pill" style={{ '--c': 'var(--status-awaiting)' } as CSSProperties}><i aria-hidden="true"></i>Ready to approve</span></div>
          <h3>Flat 3, 22 Pulteney St, Bath BA2</h3>
          <div className="ld-job-meta"><span><Icon name="calendar" size={16} />21 Oct 2026</span><span className="ld-tier ld-tier-priority">Priority</span></div>
          <div className="ld-card-foot"><span className="s-fine">Example job</span><Link href="/auth" className="ld-btn ld-btn-primary ld-btn-sm">Review report</Link></div>
        </article>
      </div>
    </div>
  </section>
    </>
  )
}
