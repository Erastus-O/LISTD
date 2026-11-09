// Ported from the prototype: website/index.html.
import type { CSSProperties } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { Icon } from '@/components/listd/icon'
import { HeroPreview } from '@/components/site/hero-preview'
import { ClientsSection } from './clients-section'

export function HomeView() {
  return (
    <>

  <section className="s-hero s-wrap">
    <div className="s-in">
      <h1 className="s-h1">Every property<br />service. <em>One platform.</em></h1>
      <p className="s-lead">Book inventories, check-ins, mid-term inspections, check-outs, repairs and maintenance, and cleaning with verified Pros. Track every job in real time. Your payment is secured when you book and released to the Pro when you approve the finished job.</p>
      <div className="s-actions" style={{ justifyContent: 'center' } as CSSProperties}>
        <Link href="/auth?tab=signup" className="ld-btn ld-btn-primary ld-btn-lg">Book a service <Icon name="arrow-right" size={20} /></Link>
        <Link href="/for-clerks" className="ld-btn ld-btn-secondary ld-btn-lg">Become a Pro</Link>
      </div>
      <div className="s-trust"><span><Icon name="check" size={16} /> No subscription</span><span><Icon name="check" size={16} /> Pay per service</span><span><Icon name="check" size={16} /> Book in under two minutes</span><span><Icon name="location" size={16} /> Bristol, Birmingham &amp; London. Coming to your area soon.</span></div>

      <HeroPreview />
    </div>
  </section>

  <section className="s-backed s-wrap" aria-label="Supported by">
    <div className="s-in"><span className="lab">Supported by · Part of the Tech Adoption for Growth programme</span><span className="s-logo"><Image src="/images/logo-techspark.png" width="536" height="112" alt="techSPARK, all things tech in the west" /></span></div>
  </section>

  <section className="s-sec s-wrap">
    <div className="s-in">
      <div className="s-head">
        <span className="s-kicker">Book. Connect. Track. Deliver.</span>
        <h2 className="s-h2"><span className="s-stage-book">Book.</span> <span className="s-stage-connect">Connect.</span><br /><span className="s-stage-track">Track.</span> <span className="s-stage-deliver">Deliver.</span></h2>
        <p className="s-lead">LISTD runs the whole job in one place, so nobody chases a clerk, a photo or a payment again.</p>
      </div>
      <div className="s-life">
        <div><span className="n">Stage 1</span><h3>Book</h3><div className="s-stage-pills"><span className="ld-pill" style={{ '--c': 'var(--status-booked)' } as CSSProperties}><i></i>Booked</span></div><p>Choose a property, one or more services and when you need them. It takes under two minutes.</p>
          <div className="s-mini"><div className="row"><b>Check-Out · Standard</b><span>Fixed quote agreed</span></div><div className="row"><span>14 Clifton Road, BS8</span></div><div className="row"><span>Fri 24 Oct</span><b>10:00</b></div></div></div>
        <div><span className="n">Stage 2</span><h3>Connect</h3><div className="s-stage-pills"><span className="ld-pill" style={{ '--c': 'var(--status-accepted)' } as CSSProperties}><i></i>Accepted</span></div><p>Your job goes to verified Pros near you. You’re notified as soon as one accepts.</p>
          <div className="s-ping"><Icon name="verified-pro" size={18} /><span><b>Sam R.</b> accepted · Pro Clerk · Level 3</span></div><div className="s-ping"><Icon name="bell" size={18} /><span>Confirmation sent 09:40</span></div></div>
        <div className="hot"><span className="n">Stage 3</span><h3>Track</h3><div className="s-stage-pills"><span className="ld-pill" style={{ '--c': 'var(--status-progress)' } as CSSProperties}><i></i>In progress</span><span className="ld-pill" style={{ '--c': 'var(--status-awaiting)' } as CSSProperties}><i></i>LISTD review</span></div><p>Follow progress live. Start photos, activity logs and evidence arrive as the Pro works, then LISTD reviews the work before it reaches you.</p>
          <div className="s-mini" style={{ background: 'var(--surface)' } as CSSProperties}><ol className="ld-rail" style={{ '--n': '4' } as CSSProperties} aria-label="Example job progress"><li className="done"><i></i></li><li className="done"><i></i></li><li className="current"><i></i></li><li className="todo"><i></i></li></ol><div className="row"><b>Kitchen · 9 of 14 items</b><span className="ld-pill" style={{ '--c': 'var(--status-progress)', height: '24px', fontSize: '12px' } as CSSProperties}><i></i>In progress</span></div></div></div>
        <div><span className="n">Stage 4</span><h3>Deliver</h3><div className="s-stage-pills"><span className="ld-pill" style={{ '--c': 'var(--status-awaiting)' } as CSSProperties}><i></i>Ready to approve</span><span className="ld-pill" style={{ '--c': 'var(--status-signed)' } as CSSProperties}><i></i>Approved</span></div><p>When the job is ready to approve, check the evidence and approve the finished job. Payment is then released to the Pro.</p>
          <div className="s-mini"><div className="row"><b>Ready to approve</b><span className="ld-pill" style={{ '--c': 'var(--status-signed)', height: '24px', fontSize: '12px' } as CSSProperties}><i></i>Approved</span></div><div className="row"><span>86 photos · 14 rooms</span><b>Approved · Pro paid</b></div></div></div>
      </div>
    </div>
  </section>

  <ClientsSection />

  <section className="s-sec s-wrap" id="services" style={{ background: 'var(--surface)' } as CSSProperties}>
    <div className="s-in">
      <div className="s-head left" style={{ maxWidth: 'none', display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'end', gap: 'var(--space-4)' } as CSSProperties}>
        <div style={{ display: 'grid', gap: '12px' } as CSSProperties}><span className="s-kicker">One platform, every service</span><h2 className="s-h2">Book it all in one place</h2></div>
        <div className="s-actions"><Link href="/auth?tab=signup" className="ld-btn ld-btn-primary">Book a service</Link><Link href="/service-tiers" className="ld-btn ld-btn-secondary">See pricing</Link></div>
      </div>
      <div className="s-grid s-g3">
        <div className="s-svcard" style={{ '--c': 'var(--service-inventory)' } as CSSProperties}><span className="ic"><Icon name="inventory" size={24} /></span><h3>Inventory</h3><p>A full inspection and schedule of condition of the property and its contents, with timestamped photo evidence.</p></div>
        <div className="s-svcard" style={{ '--c': 'var(--service-checkin)' } as CSSProperties}><span className="ic"><Icon name="check-in" size={24} /></span><h3>Check-In</h3><p>A walk-through with the tenant as they move in, recorded room by room and signed off on any device.</p></div>
        <div className="s-svcard" style={{ '--c': 'var(--service-midterm)' } as CSSProperties}><span className="ic"><Icon name="inspection" size={24} /></span><h3>Mid-Term</h3><p>A condition inspection during the tenancy, compared with the earlier report, so issues are caught early.</p></div>
        <div className="s-svcard" style={{ '--c': 'var(--service-checkout)' } as CSSProperties}><span className="ic"><Icon name="check-out" size={24} /></span><h3>Check-Out</h3><p>End-of-tenancy property condition, compared item by item with the check-in or inventory, and signed off.</p></div>
        <div className="s-svcard" style={{ '--c': 'var(--service-repairs)' } as CSSProperties}><span className="ic"><Icon name="settings" size={24} /></span><h3>Repairs &amp; Maintenance <span className="ld-badge ld-badge-brand" style={{ verticalAlign: 'middle' } as CSSProperties}>New</span></h3><p>Report damage with photos. Get a fixed task price when the job is clear, or a diagnostic visit, credited against the repair, when it isn’t. A vetted Pro carries out the work.</p></div>
        <div className="s-svcard" id="cleaning" style={{ '--c': 'var(--service-cleaning)' } as CSSProperties}><span className="ic"><Icon name="cleaning" size={24} /></span><h3>Cleaning</h3><p>Domestic, commercial, deep, end of tenancy, Airbnb and carpet cleaning by vetted Pro Cleaners. An estimate as you book, then a fixed quote before you pay.</p></div>
        <div className="s-svcard" style={{ '--c': 'var(--border-strong)' } as CSSProperties}><span className="ic"><Icon name="plus" size={24} /></span><h3>More services coming soon</h3><p>We’re adding services across Bristol, Birmingham &amp; London. Coming to your area soon. <Link href="/contact" className="ld-link">Tell us what you need</Link>.</p></div>
      </div>
      <div className="s-service-chips">
        <p><b>Also available:</b> <span className="ld-badge">Domestic Cleaning</span><span className="ld-badge">Commercial Cleaning</span><span className="ld-badge">Airbnb Cleaning</span><span className="ld-badge">Carpet Cleaning</span><span className="ld-badge">Repairs, Handyman &amp; Maintenance</span><span className="ld-badge">Inventory Services (Inventory, Check-In, Check-Out, Mid-Term Inspection)</span></p>
        <p><b>Coming soon:</b> <span>Mobile Car Wash <small className="ld-badge">Coming soon</small></span><span>Exterior Cleaning <small className="ld-badge">Coming soon</small></span><span>Pressure Washing <small className="ld-badge">Coming soon</small></span><span>Property Photography <small className="ld-badge">Coming soon</small></span></p>
      </div>
    </div>
  </section>

  <section className="s-sec s-wrap">
    <div className="s-in">
      <div className="s-head"><span className="s-kicker">Clear by design</span><h2 className="s-h2">The numbers that matter</h2></div>
      <div className="s-facts">
        <div className="s-fact"><span className="v">Fixed</span><span className="k">Every inspection has a fixed quote before you book. No subscription.</span></div>
        <div className="s-fact"><span className="v">2 days</span><span className="k">Priority: within two working days, when a Pro is available, with a fixed quote. It changes when the job happens, never how well it’s done.</span></div>
        <div className="s-fact"><span className="v num">24–48h</span><span className="k">To verify a new Pro before they can accept jobs.</span></div>
        <div className="s-fact"><span className="v num">3</span><span className="k">Levels in every Pro role, unlocked by completed jobs and ratings.</span></div>
      </div>
    </div>
  </section>

  <section className="s-band s-wrap s-sec">
    <div className="s-in s-split">
      <div style={{ display: 'grid', gap: 'var(--space-5)' } as CSSProperties}>
        <span className="s-kicker">For property professionals</span>
        <h2 className="s-h2">Join the LISTD Pro network</h2>
        <p className="s-lead">Work as a Pro Clerk, Pro Cleaner or Pro Trades. Accept open jobs in your area, build your reputation and get paid weekly once the client approves the finished job.</p>
        <div className="s-actions"><Link href="/for-clerks" className="ld-btn ld-btn-accent ld-btn-lg">Become a Pro <Icon name="arrow-right" size={20} /></Link></div>
      </div>
      <figure className="s-proimg">
        <Image src="/images/pros-cleaner.jpg" width="1100" height="734" alt="A smiling LISTD cleaning professional in a blue polo and gloves, kneeling with a spray bottle and cloth in a bright hallway" />
        <div className="s-pi-chip s-pi-tl"><span className="ld-badge ld-badge-success"><Icon name="check" size={12} /> Verified Pro</span><span className="ld-level"><span aria-hidden="true"><i className="on"></i><i className="on"></i><i className="on"></i></span>Pro Cleaner · Level 3</span></div>
        <div className="s-pi-chip s-pi-br"><span className="ld-eyebrow">New job nearby</span><b>Deep clean · Redland, BS6</b><span className="s-fine">1.8 miles · payment secured</span></div>
        <figcaption>Three roles, three levels in each.</figcaption>
      </figure>
    </div>
  </section>

  <section className="s-sec s-wrap" id="service-businesses">
    <div className="s-in">
      <div className="s-head"><span className="s-kicker">For service businesses</span><h2 className="s-h2">Run your service business on LISTD</h2><p className="s-lead">Your team, your jobs and your revenue in one place. Take jobs from local agents, landlords and hosts, and let your staff check in on site.</p><Link href="/contact" className="ld-btn ld-btn-primary">Ask us how</Link></div>
    </div>
  </section>

  <section className="s-sec s-wrap" id="faq">
    <div className="s-in">
      <div className="s-head"><span className="s-kicker">Questions</span><h2 className="s-h2">Frequently asked questions</h2></div>
      <div className="s-faq"><div className="s-acc" data-acc>
        <div><button type="button" aria-expanded="true">Do I need a subscription? <Icon name="chevron-down" size={18} className="ch" /></button><div className="s-acc-body">No. LISTD is pay per service. Create a free client account, add your properties and pay for each job you book.</div></div>
        <div><button type="button" aria-expanded="false">How are Pros vetted? <Icon name="chevron-down" size={18} className="ch" /></button><div className="s-acc-body" hidden>Every Pro provides photo ID, right to work, a basic DBS check and public liability insurance. Pro Clerks also hold professional indemnity insurance, and Pro Trades hold any legally required trade certificates. Each Pro’s first 5 jobs in a role get a closer LISTD review. Verification takes 24–48 hours.</div></div>
        <div><button type="button" aria-expanded="false">When is my payment released? <Icon name="chevron-down" size={18} className="ch" /></button><div className="s-acc-body" hidden>Your payment is secured when you book. It is released to the Pro only when you approve the finished job.</div></div>
        <div><button type="button" aria-expanded="false">How is the price worked out? <Icon name="chevron-down" size={18} className="ch" /></button><div className="s-acc-body" hidden>Every booking gets the same standard of service. Inspections have a fixed price by property size, plus one furnishing adjustment. Any date within two working days is Priority, when a Pro is available, with the adjustment confirmed in your quote. Priority changes when the job happens, never how well it’s done. Extra rooms are each a visible line. Cleaning and repairs are quoted separately, and you always see a fixed quote before you pay.</div></div>
        <div><button type="button" aria-expanded="false">What if I disagree with a report? <Icon name="chevron-down" size={18} className="ch" /></button><div className="s-acc-body" hidden>Add comments before you approve, or raise a dispute. Our structured process has admin oversight: evidence is reviewed and every resolution is documented.</div></div>
        <div><button type="button" aria-expanded="false">Which areas do you cover? <Icon name="chevron-down" size={18} className="ch" /></button><div className="s-acc-body" hidden>Bristol, Birmingham &amp; London. Coming to your area soon, so <Link href="/contact" className="ld-link">tell us where you are</Link>.</div></div>
      </div></div>
    </div>
  </section>
    </>
  )
}
