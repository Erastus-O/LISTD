// Ported from the prototype: website/index.html.
import type { CSSProperties } from 'react'
import Image from 'next/image'
import { Icon } from '@/components/listd/icon'

export function ClientsSection() {
  return (
    <>
  <section className="s-sec s-wrap" style={{ paddingTop: '0' } as CSSProperties} id="clients">
    <div className="s-in" style={{ display: 'grid', gap: 'var(--space-24)' } as CSSProperties}>
      <div className="s-split">
        <div>
          <span className="s-kicker">Evidence-based delivery</span>
          <h2 className="s-h2" style={{ marginTop: '12px' } as CSSProperties}>Reports that hold up in a deposit dispute</h2>
          <div className="s-acc" data-acc>
            <div><button type="button" aria-expanded="true"><Icon name="camera" size={20} /> Timestamped photo evidence <Icon name="chevron-down" size={18} className="ch" /></button><div className="s-acc-body">Every photo carries its room, item and time, from start photos to completion. Nothing is added later without a record.</div></div>
            <div><button type="button" aria-expanded="false"><Icon name="inventory" size={20} /> Structured condition ratings <Icon name="chevron-down" size={18} className="ch" /></button><div className="s-acc-body" hidden>Every report rates every item from New to Very poor, and includes close-ups and scale references on any damage, whatever the scheduling option.</div></div>
            <div><button type="button" aria-expanded="false"><Icon name="signature" size={20} /> Digital sign-off and audit trail <Icon name="chevron-down" size={18} className="ch" /></button><div className="s-acc-body" hidden>Clients approve digitally and tenants sign where the service needs it. Every action is timestamped, so every report is dispute-ready.</div></div>
          </div>
        </div>
        <article className="s-report" aria-label="Example check-out report">
          <header>Example report · Check-out · Living room · Item 4.2 Carpet</header>
          <div className="s-report-photos">
            <figure className="ld-evid"><div className="ld-evid-img"><Image src="/images/listd-carpet-check-in.jpg" width="640" height="480" alt="Carpet near the window in the illustrative check-in record" /><span className="ld-evid-stamp"><i></i>Check-in · 3 Mar 2026, 10:14</span></div><figcaption><span className="ld-badge ld-badge-success">Good</span></figcaption></figure>
            <figure className="ld-evid"><div className="ld-evid-img"><Image src="/images/listd-carpet-check-out.jpg" width="640" height="480" alt="Close-up of the carpet stain in the illustrative check-out record" /><span className="ld-evid-stamp"><i></i>Check-out · 2 Sep 2026, 11:02</span><span className="ld-evid-flag s-report-ring" aria-label="Stain marked"></span><span className="s-report-scale">3 cm</span></div><figcaption><span className="ld-badge ld-badge-warning">Fair</span></figcaption></figure>
          </div>
          <p>Pro note: Light grey stain approx. 3 cm, near window. Not present at check-in.</p>
          <footer><span>86 photos · 14 rooms · Signed off digitally</span><small>Example shown for illustration.</small></footer>
        </article>
      </div>

      <div className="s-split rev">
        <div>
          <span className="s-kicker">Secure workflow</span>
          <h2 className="s-h2" style={{ marginTop: '12px' } as CSSProperties}>Payment secured until the work is done</h2>
          <div className="s-acc" data-acc>
            <div><button type="button" aria-expanded="true"><Icon name="escrow" size={20} /> Secured when you book <Icon name="chevron-down" size={18} className="ch" /></button><div className="s-acc-body">You agree a fixed quote before you book. Payment is secured, and the Pro is paid once you approve the finished job.</div></div>
            <div><button type="button" aria-expanded="false"><Icon name="check" size={20} /> Released when you approve the finished job <Icon name="chevron-down" size={18} className="ch" /></button><div className="s-acc-body" hidden>Check the evidence, comment and approve. Payment is then released to the Pro, with a receipt on record.</div></div>
            <div><button type="button" aria-expanded="false"><Icon name="flag" size={20} /> A structured, fair dispute process <Icon name="chevron-down" size={18} className="ch" /></button><div className="s-acc-body" hidden>Disputes have admin oversight. Every party is heard, evidence is reviewed and the resolution is documented.</div></div>
          </div>
        </div>
        <div className="s-visual warm">
          <div className="s-float">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px', flexWrap: 'wrap' } as CSSProperties}><span className="ld-eyebrow">Secure payment · LJ-2041</span><span className="ld-tier ld-tier-core">Standard</span></div>
            <div className="s-escrow">
              <div className="step"><span className="dot" style={{ '--c': 'var(--info-fill)' } as CSSProperties}><Icon name="pound" size={18} /></span><div><b>Quote agreed and payment secured</b><span>21 Oct, 09:40 · job booked</span></div></div>
              <div className="step"><span className="dot" style={{ '--c': 'var(--live)' } as CSSProperties}><Icon name="camera" size={18} /></span><div><b>Work delivered</b><span>24 Oct, 12:18 · report submitted</span></div><span className="ld-badge ld-badge-warning">Review</span></div>
              <div className="step"><span className="dot" style={{ '--c': 'var(--success-fill)' } as CSSProperties}><Icon name="check" size={18} /></span><div><b>Approved by client</b><span>When you approve the finished job</span></div></div>
              <div className="step"><span className="dot" style={{ '--c': 'var(--success-fill)' } as CSSProperties}><Icon name="check" size={18} /></span><div><b>Pro paid</b><span>Finished job approved</span></div></div>
            </div>
            <span className="s-fine">Example job shown for illustration.</span>
          </div>
        </div>
      </div>

      <div className="s-split">
        <div>
          <span className="s-kicker">Verified professionals</span>
          <h2 className="s-h2" style={{ marginTop: '12px' } as CSSProperties}>Only vetted Pros reach your properties</h2>
          <div className="s-acc" data-acc>
            <div><button type="button" aria-expanded="true"><Icon name="verified-pro" size={20} /> ID, right to work, DBS and insurance <Icon name="chevron-down" size={18} className="ch" /></button><div className="s-acc-body">Every Pro provides photo ID, right to work, a basic DBS check and public liability insurance before accessing live jobs. Pro Clerks also hold professional indemnity insurance, and Pro Trades hold the trade certificates the law requires.</div></div>
            <div><button type="button" aria-expanded="false"><Icon name="star" size={20} /> Three roles, three levels each <Icon name="chevron-down" size={18} className="ch" /></button><div className="s-acc-body" hidden>Pros work as a Pro Clerk, Pro Cleaner or Pro Trades, and can hold more than one role. Each role has three levels, unlocked by completed jobs and ratings. A Pro’s first 5 jobs in each role get a closer LISTD review.</div></div>
            <div><button type="button" aria-expanded="false"><Icon name="warning" size={20} /> Strikes and accountability <Icon name="chevron-down" size={18} className="ch" /></button><div className="s-acc-body" hidden>Pros who fall below standards receive strikes with clear severity levels. Persistent issues lead to temporary or permanent suspension.</div></div>
          </div>
        </div>
        <div className="s-visual sky">
          <div className="s-float">
            <div className="s-probadge"><span className="ld-avatar ld-avatar-lg"><span role="img" aria-label="Example Pro">SR</span><span className="v" title="Verified Pro"><Icon name="check" size={10} /></span></span><div><b style={{ fontSize: '17px' } as CSSProperties}>Sam R.</b><div><span className="ld-level"><span aria-hidden="true"><i className="on"></i><i className="on"></i><i className="on"></i></span>Pro Clerk · Level 3</span></div></div></div>
            <ul className="s-checks"><li><Icon name="success" size={18} /> Identity verified</li><li><Icon name="success" size={18} /> Right to work and basic DBS on file</li><li><Icon name="success" size={18} /> Public liability and professional indemnity insurance</li><li><Icon name="success" size={18} /> Standards check passed</li></ul>
            <span className="s-fine">Example Pro profile.</span>
          </div>
        </div>
      </div>
    </div>
  </section>

    </>
  )
}
