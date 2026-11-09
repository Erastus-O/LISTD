// Ported from the prototype: website/index.html.
import type { CSSProperties } from 'react'
import Link from 'next/link'
import { Icon } from '@/components/listd/icon'
import { LevelEstimator } from '@/components/site/level-estimator'
import { CleanersSection } from './cleaners-section'

export function ProsView() {
  return (
    <>

  <section className="s-phead tint s-wrap"><div className="s-in s-procta">
    <span className="s-kicker">For property professionals</span><h1 className="s-h1">Work that comes to you. Pay that’s protected.</h1><p className="s-lead">Join the LISTD Pro network as a Pro Clerk, Pro Cleaner or Pro Trades, or more than one. Accept open jobs in your area, or take jobs LISTD sends straight to you, each with a clear brief. Move through three levels in every role as you complete jobs and keep ratings high. You’re paid weekly once the client approves the finished job.</p>
    <div className="s-actions"><Link href="/auth?tab=signup&role=clerk" className="ld-btn ld-btn-primary ld-btn-lg">Become a Pro</Link></div>
    <span className="s-fine">Verification takes 24–48 hours. Start accepting jobs as soon as you’re approved. Weekly payouts are being confirmed before launch.</span>
  </div></section>
  <section className="s-sec s-wrap">
    <div className="s-in">
      <div className="s-head"><h2 className="s-h2">Everything you need to do great work</h2></div>
      <div className="s-grid s-g3">
        <div className="s-svcard" style={{ '--c': 'var(--service-inventory)' } as CSSProperties}><span className="ic"><Icon name="inventory" size={24} /></span><h3>Structured workflows</h3><p>Guided, evidence-based workflows for inventories, check-ins, mid-terms, check-outs, repairs and cleaning, with built-in standards and condition ratings.</p></div>
        <div className="s-svcard" style={{ '--c': 'var(--live)' } as CSSProperties}><span className="ic"><Icon name="star" size={24} /></span><h3>Level progression</h3><p>Three levels in every role. Start at Level 1, with a closer LISTD review on your first 5 jobs, and move up as you complete jobs and keep high ratings.</p></div>
        <div className="s-svcard" style={{ '--c': 'var(--accent)' } as CSSProperties}><span className="ic"><Icon name="escrow" size={24} /></span><h3>Secure payments</h3><p>The client’s payment is secured when they book. You’re paid weekly once the client approves the finished job.</p></div>
        <div className="s-svcard" style={{ '--c': 'var(--service-checkin)' } as CSSProperties}><span className="ic"><Icon name="users" size={24} /></span><h3>Build your reputation</h3><p>Earn ratings and reviews from clients. Higher levels earn a higher hourly rate, set by LISTD for each role and level.</p></div>
        <div className="s-svcard" style={{ '--c': 'var(--service-midterm)' } as CSSProperties}><span className="ic"><Icon name="file" size={24} /></span><h3>Professional standards</h3><p>Clear expectations before you start, so you know exactly what’s required on every job.</p></div>
        <div className="s-svcard" style={{ '--c': 'var(--service-cleaning)' } as CSSProperties}><span className="ic"><Icon name="camera" size={24} /></span><h3>Mobile-first tools</h3><p>Complete jobs on any device with photo capture, digital signatures and offline-ready forms.</p></div>
      </div>
    </div>
  </section>
  <section className="s-band s-wrap s-sec">
    <div className="s-in s-split">
      <div style={{ display: 'grid', gap: 'var(--space-4)' } as CSSProperties}><span className="s-kicker">Pro progression levels</span><h2 className="s-h2">Your performance sets your access</h2><p className="s-lead">Every role has three levels, unlocked by completed jobs and ratings in that role. Your badge shows both, for example “Pro Clerk · Level 3”. LISTD sets the hourly rate for each role and level. Your first 5 jobs in each role get a closer LISTD review and carry a “New to LISTD” badge; experienced Pros can move up faster once they pass.</p><LevelEstimator /></div>
      <div className="s-levels">
        <div className="s-lv"><span className="tag">L1</span><div><b>Level 1</b><span>Clerk: inspections up to 2 bedrooms · Cleaner: Standard home cleans · Trades: approved trade work</span></div><span className="j">On approval</span></div>
        <div className="s-lv"><span className="tag">L2</span><div><b>Level 2</b><span>Clerk: up to 4 bedrooms · Cleaner: adds End of Tenancy and Office · Trades: higher rate</span></div><span className="j">10+ jobs · 4.5★</span></div>
        <div className="s-lv"><span className="tag">L3</span><div><b>Level 3</b><span>Clerk: every property size · Cleaner: all cleans, including Deep · Trades: top rate</span></div><span className="j">30+ jobs · 4.7★</span></div>
      </div>
    </div>
  </section>
  <section className="s-sec s-wrap" style={{ paddingBottom: '0' } as CSSProperties}>
    <div className="s-in">
      <div className="s-head"><span className="s-kicker">Pro roles</span><h2 className="s-h2">Choose your roles</h2><p className="s-lead">Hold one role or several. Every Pro provides photo ID, right to work, a basic DBS check and public liability insurance.</p></div>
      <div className="s-grid s-g3">
        <div className="s-svcard" style={{ '--c': 'var(--service-inventory)' } as CSSProperties}><span className="ic"><Icon name="inventory" size={24} /></span><h3>Pro Clerk</h3><p>Inventories, check-ins, mid-terms and check-outs. Also needs professional indemnity insurance.</p></div>
        <div className="s-svcard" style={{ '--c': 'var(--service-cleaning)' } as CSSProperties}><span className="ic"><Icon name="cleaning" size={24} /></span><h3>Pro Cleaner</h3><p>Standard, Deep, End of Tenancy and Office cleans, each to a room-by-room checklist.</p></div>
        <div className="s-svcard" style={{ '--c': 'var(--service-repairs)' } as CSSProperties}><span className="ic"><Icon name="settings" size={24} /></span><h3>Pro Trades</h3><p>Repairs and maintenance. Also needs any trade certificates the law requires for the work.</p></div>
      </div>
    </div>
  </section>
  <CleanersSection />
    </>
  )
}
