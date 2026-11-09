// Ported from the prototype: website/index.html.
import type { CSSProperties } from 'react'
import { Icon } from '@/components/listd/icon'
import { ContactForm } from '@/components/site/contact-form'

export function ContactView() {
  return (
    <>

  <section className="s-phead tint s-wrap"><div className="s-in"><span className="s-kicker">Contact</span><h1 className="s-h1">How can we help?</h1><p className="s-lead">Questions, a demo, or ready to get started: we’re here.</p></div></section>
  <section className="s-wrap" style={{ paddingBlock: 'var(--space-6) var(--space-24)' } as CSSProperties}>
    <div className="s-in s-split" style={{ alignItems: 'start' } as CSSProperties}>
      <div style={{ display: 'grid', gap: 'var(--space-4)' } as CSSProperties}>
        <div className="s-grid s-g2">
          <div className="s-ccard"><span className="ic"><Icon name="chat" size={20} /></span><b>Email support</b><span className="v" data-copy-src>support@listd.co.uk</span><span className="s-fine">Reply within 24–48 hours</span><button className="s-copy" type="button" data-copy>Copy email</button></div>
          <div className="s-ccard"><span className="ic"><Icon name="users" size={20} /></span><b>Follow LISTD</b><span className="s-muted">News, new areas and Pro opportunities.</span><div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' } as CSSProperties}><a className="ld-link" href="https://www.instagram.com/listd_pro" target="_blank" rel="noopener noreferrer">Instagram @listd_pro</a><a className="ld-link" href="https://www.tiktok.com/@listdpro" target="_blank" rel="noopener noreferrer">TikTok listdpro</a><a className="ld-link" href="https://www.facebook.com/Listd.Pro" target="_blank" rel="noopener noreferrer">Facebook Listd.Pro</a></div></div>
          <div className="s-ccard"><span className="ic"><Icon name="calendar" size={20} /></span><b>Book a walkthrough</b><span className="s-muted">A free 15-minute platform demo. No commitment.</span><a className="ld-link" href="https://outlook.office365.com/book/listd" target="_blank" rel="noopener noreferrer">Choose a time</a></div>
          <div className="s-ccard"><span className="ic"><Icon name="location" size={20} /></span><b>Service area</b><span className="s-muted">Bristol · South West · Birmingham. Coming to your area soon.</span><span className="s-fine">Every service in Bristol and the South West. Cleaning in Birmingham, with inspections and repairs coming soon.</span></div>
        </div>
      </div>
      <ContactForm />
    </div>
  </section>
    </>
  )
}
