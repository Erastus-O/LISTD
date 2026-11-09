// Ported from the prototype: website/index.html.
import type { CSSProperties } from 'react'
import Link from 'next/link'
import { Icon } from '@/components/listd/icon'

export function CleanersSection() {
  return (
    <>
  <section className="s-sec s-wrap" id="cleaners">
    <div className="s-in">
      <div className="s-head"><span className="s-kicker" style={{ color: 'var(--service-cleaning-text)' } as CSSProperties}>For Pro Cleaners</span><h2 className="s-h2">Cleaning jobs that come to you</h2><p className="s-lead">Set your coverage postcodes in Bristol, the South West or Birmingham and accept open cleans nearby. Every clean has a room-by-room checklist, so you always know what “done” looks like.</p></div>
      <div className="s-cleans">
        <div className="s-clean"><span className="k">Pro Cleaner · Level 1</span><h3>Standard Home Cleaning</h3><p>A stated checklist: worktops, hob and sink, bathrooms, floors, dusting and bins.</p></div>
        <div className="s-clean"><span className="k">Pro Cleaner · Level 2</span><h3>End of Tenancy &amp; Office</h3><p>End of tenancy to a check-out standard, including oven, fridge and inside cupboards. Office cleans to an agreed floor area and frequency.</p></div>
        <div className="s-clean"><span className="k">Pro Cleaner · Level 3</span><h3>Deep Cleaning</h3><p>Everything, including behind furniture, descaling, appliances inside and out, and interior windows.</p></div>
      </div>
      <div className="s-grid s-g4" style={{ marginTop: 'var(--space-8)' } as CSSProperties}>
        <div className="s-ccard"><span className="ic"><Icon name="location" size={20} /></span><b>Work in your area</b><span className="s-muted">Choose your postcodes and accept the jobs that suit you.</span></div>
        <div className="s-ccard"><span className="ic"><Icon name="camera" size={20} /></span><b>Proof of work</b><span className="s-muted">Before and after photos protect you and the client.</span></div>
        <div className="s-ccard"><span className="ic"><Icon name="pound" size={20} /></span><b>Transparent pay</b><span className="s-muted">An hourly rate for your role and level, set by LISTD. You see the fee before you accept and are paid weekly once the client approves.</span></div>
        <div className="s-ccard"><span className="ic"><Icon name="verified-pro" size={20} /></span><b>Vetted &amp; trusted</b><span className="s-muted">Photo ID, right to work, basic DBS and public liability insurance make your professionalism stand out.</span></div>
      </div>
      <div className="s-actions" style={{ justifyContent: 'center', marginTop: 'var(--space-10)' } as CSSProperties}><Link href="/auth?tab=signup&role=clerk" className="ld-btn ld-btn-primary ld-btn-lg">Apply to join</Link></div>
    </div>
  </section>
    </>
  )
}
