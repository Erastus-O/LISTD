// Ported from the prototype: website/index.html.
import type { CSSProperties } from 'react'
import { Icon } from '@/components/listd/icon'
import { OpenRoles } from '@/components/site/open-roles'

export function AboutView() {
  return (
    <>

  <section className="s-phead tint s-wrap"><div className="s-in"><span className="s-kicker">About LISTD</span><h1 className="s-h1" style={{ maxWidth: '16ch' } as CSSProperties}>Controlled infrastructure, not gig-economy chaos</h1><p className="s-lead">LISTD brings professional standards to UK property services. We connect letting agents and landlords with verified Pros for inventories, inspections, repairs and maintenance, and cleaning through one structured service standard: consistent quality, clear fixed prices and secure payment.</p></div></section>
  <section className="s-sec s-wrap" style={{ paddingTop: 'var(--space-8)' } as CSSProperties}>
    <div className="s-in">
      <div className="s-head"><h2 className="s-h2">What we stand for</h2></div>
      <div className="s-values">
        <div className="s-value" style={{ '--t': 'var(--service-inventory-subtle)', '--c': 'var(--accent)' } as CSSProperties}><span className="ic"><Icon name="verified-pro" size={22} /></span><h3>Verified professionals</h3><p>Every Pro passes ID, right to work, DBS and insurance checks, and their first 5 jobs in each role get a closer LISTD review.</p></div>
        <div className="s-value" style={{ '--t': 'var(--warning-subtle)', '--c': 'var(--live)' } as CSSProperties}><span className="ic"><Icon name="escrow" size={22} /></span><h3>Secure payments</h3><p>Payment is secured when the client books and released to the Pro when the client approves the finished job.</p></div>
        <div className="s-value" style={{ '--t': 'var(--service-midterm-subtle)', '--c': 'var(--service-midterm)' } as CSSProperties}><span className="ic"><Icon name="flag" size={22} /></span><h3>Fair dispute resolution</h3><p>A structured process with admin oversight. Every party is heard, evidence is reviewed and resolutions are documented.</p></div>
        <div className="s-value" style={{ '--t': 'var(--service-checkin-subtle)', '--c': 'var(--service-checkin)' } as CSSProperties}><span className="ic"><Icon name="eye" size={22} /></span><h3>Full transparency</h3><p>Every action is timestamped and tracked. Clients and Pros have complete visibility into job progress.</p></div>
        <div className="s-value" style={{ '--t': 'var(--service-checkout-subtle)', '--c': 'var(--service-checkout)' } as CSSProperties}><span className="ic"><Icon name="warning" size={22} /></span><h3>Strikes &amp; accountability</h3><p>Pros who fall below standards receive strikes with clear severity levels. Persistent issues lead to suspension.</p></div>
        <div className="s-value" style={{ '--t': 'var(--service-cleaning-subtle)', '--c': 'var(--service-cleaning)' } as CSSProperties}><span className="ic"><Icon name="lock" size={22} /></span><h3>Non-circumvention</h3><p>All parties agree to operate within the platform, protecting the network and fair pay for everyone.</p></div>
      </div>
    </div>
  </section>
  <section className="s-sec s-wrap" id="trust" style={{ background: 'var(--surface)' } as CSSProperties}>
    <div className="s-in">
      <div className="s-head"><span className="s-kicker">Trust &amp; safety</span><h2 className="s-h2">Every layer protects every party</h2></div>
      <ul className="s-trustlist">
        <li><Icon name="user" size={20} /> Identity verification for all users</li><li><Icon name="file" size={20} /> Right to work and basic DBS checks for Pros</li><li><Icon name="escrow" size={20} /> Public liability insurance; professional indemnity for Pro Clerks; trade certificates for Pro Trades</li><li><Icon name="star" size={20} /> Performance-based level progression</li><li><Icon name="chat" size={20} /> Client review and rating system</li><li><Icon name="flag" size={20} /> Admin-managed dispute resolution</li><li><Icon name="pound" size={20} /> Payment secured at booking, released on approval</li><li><Icon name="lock" size={20} /> Non-circumvention agreements</li><li><Icon name="activity" size={20} /> Real-time job status tracking</li><li><Icon name="clock" size={20} /> Audit trail on every action</li>
      </ul>
    </div>
  </section>
  <section className="s-sec s-wrap" id="careers">
    <div className="s-in s-split">
      <div style={{ display: 'grid', gap: 'var(--space-4)' } as CSSProperties}><span className="s-kicker">Careers</span><h2 className="s-h2">Help build the UK’s most trusted property services platform</h2><p className="s-lead">We hire people who care about transparency, evidence and doing right by clients, Pros and tenants.</p></div>
      <OpenRoles />
    </div>
  </section>
    </>
  )
}
