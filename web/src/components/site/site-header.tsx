'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import Image from 'next/image'
import { Icon } from '@/components/listd/icon'
import { useSession } from '@/lib/use-session'

type MenuLink = {
  href: string
  icon?: string
  color?: string
  title: string
  desc: string
  badge?: string
}

const SERVICES: MenuLink[] = [
  { href: '/#services', icon: 'inventory', color: 'inventory', title: 'Inventory', desc: 'Inspection and full schedule of condition' },
  { href: '/#services', icon: 'check-in', color: 'checkin', title: 'Check-In', desc: 'Tenant walk-through and sign-off' },
  { href: '/#services', icon: 'inspection', color: 'midterm', title: 'Mid-Term', desc: 'Condition inspection during the tenancy' },
  { href: '/#services', icon: 'check-out', color: 'checkout', title: 'Check-Out', desc: 'End-of-tenancy condition and sign-off' },
  { href: '/#services', icon: 'settings', color: 'repairs', title: 'Repairs & Maintenance', desc: 'A fixed quote before any work starts', badge: 'New' },
  { href: '/#cleaning', icon: 'cleaning', color: 'cleaning', title: 'Cleaning', desc: 'Standard, Deep, End of Tenancy and Office' },
  { href: '/contact', icon: 'plus', title: 'More services coming soon', desc: 'Tell us what you need next' },
]

const PLATFORM: MenuLink[] = [
  { href: '/how-it-works', title: 'How it works', desc: 'From booking to signed-off report' },
  { href: '/service-tiers', title: 'Pricing', desc: 'Rate card, scheduling and portfolio pricing' },
  { href: '/about#trust', title: 'Trust & safety', desc: 'Vetting, secure payment and disputes' },
]

const SOLUTIONS: MenuLink[] = [
  { href: '/for-clients', icon: 'home', title: 'Letting agents', desc: 'Every job tracked, every report consistent' },
  { href: '/for-clients', icon: 'key', title: 'Landlords', desc: 'Professional evidence, pay per service' },
  { href: '/for-clients', icon: 'users', title: 'Property managers', desc: 'One standard across your portfolio' },
  { href: '/for-clerks', icon: 'verified-pro', title: 'Pro Clerks', desc: 'Inventory and inspection work near you' },
  { href: '/for-cleaners', icon: 'cleaning', title: 'Pro Cleaners and Pro Trades', desc: 'Cleaning, repairs and maintenance' },
]

const COMPANY: MenuLink[] = [
  { href: '/about', icon: 'flag', title: 'About LISTD', desc: 'Our mission and values' },
  { href: '/careers', icon: 'users', title: 'Careers', desc: 'See open roles' },
  { href: '/contact', icon: 'chat', title: 'Contact', desc: 'Talk to the team or book a demo' },
]

const DRAWER: Array<{ heading: string; links: Array<{ href: string; icon: string; title: string }> }> = [
  { heading: 'Services', links: SERVICES.map((s) => ({ href: s.href, icon: s.icon as string, title: s.title })) },
  {
    heading: 'Platform',
    links: [
      { href: '/how-it-works', icon: 'activity', title: 'How it works' },
      { href: '/service-tiers', icon: 'pound', title: 'Pricing' },
      { href: '/for-clerks', icon: 'verified-pro', title: 'For Pros' },
      { href: '/about', icon: 'flag', title: 'About' },
      { href: '/contact', icon: 'chat', title: 'Contact' },
    ],
  },
]

function MenuItem({ item, onPick }: { item: MenuLink; onPick: () => void }) {
  return (
    <Link href={item.href} onClick={onPick}>
      {item.icon && (
        <span
          className={`tile${item.color ? '' : ' plain'}`}
          style={item.color ? ({ '--c': `var(--service-${item.color})` } as React.CSSProperties) : undefined}
        >
          <Icon name={item.icon} size={18} />
        </span>
      )}
      <span>
        <b>
          {item.title}
          {item.badge && (
            <>
              {' '}
              <span className="ld-badge ld-badge-brand" style={{ height: 20, fontSize: 11 }}>
                {item.badge}
              </span>
            </>
          )}
        </b>
        <span className="d">{item.desc}</span>
      </span>
    </Link>
  )
}

function Dropdown({
  id,
  label,
  open,
  onToggle,
  narrow,
  children,
}: {
  id: string
  label: string
  open: boolean
  onToggle: () => void
  narrow?: boolean
  children: React.ReactNode
}) {
  return (
    <div className="s-mi">
      <button className="s-mbtn" type="button" aria-expanded={open} aria-controls={id} onClick={onToggle}>
        {label} <Icon name="chevron-down" size={16} />
      </button>
      <div className={`s-pop${narrow ? ' narrow' : ''}`} id={id} hidden={!open}>
        {children}
      </div>
    </div>
  )
}

export function SiteHeader() {
  const pathname = usePathname()
  const { user, loading } = useSession()
  const [menu, setMenu] = useState<string | null>(null)
  const [drawer, setDrawer] = useState(false)
  const headerRef = useRef<HTMLElement>(null)

  const close = () => {
    setMenu(null)
    setDrawer(false)
  }

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!headerRef.current?.contains(e.target as Node)) setMenu(null)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') close()
    }
    document.addEventListener('click', onDocClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('click', onDocClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [])

  const toggle = (id: string) => setMenu((m) => (m === id ? null : id))
  const current = (href: string) => (pathname === href ? 'page' : undefined)

  return (
    <>
      <div className="s-ann">
        <div className="s-wrap">
          <div className="s-in">
            <span>
              <b>New:</b> Cleaning is now on LISTD in Bristol, Birmingham &amp; London. Coming to your
              area soon. Standard, Deep, End of Tenancy and Office, with a fixed quote before you pay.
            </span>
            <Link href="/#cleaning">See cleaning</Link>
          </div>
        </div>
      </div>

      <header className="s-hdr" id="top" ref={headerRef}>
        <div className="s-wrap">
          <div className="s-in">
            <Link className="s-brand" href="/" aria-label="listd home" onClick={close}>
              <Image className="s-header-logo" src="/images/listd-horizontal.png" width={119} height={36} alt="listd" priority />
            </Link>
            <nav className="s-menu" aria-label="Main">
              <Dropdown id="m-services" label="Services" open={menu === 'services'} onToggle={() => toggle('services')}>
                <div>
                  <h6>Property services</h6>
                  {SERVICES.map((s) => (
                    <MenuItem key={s.title} item={s} onPick={close} />
                  ))}
                </div>
                <div className="side">
                  <h6>Platform</h6>
                  {PLATFORM.map((s) => (
                    <MenuItem key={s.title} item={s} onPick={close} />
                  ))}
                </div>
              </Dropdown>
              <Dropdown id="m-sol" label="Solutions" narrow open={menu === 'sol'} onToggle={() => toggle('sol')}>
                <div>
                  <h6>Who it&rsquo;s for</h6>
                  {SOLUTIONS.map((s) => (
                    <MenuItem key={s.title} item={s} onPick={close} />
                  ))}
                </div>
              </Dropdown>
              <Link className={`s-mbtn${pathname === '/service-tiers' ? ' is-current' : ''}`} href="/service-tiers" aria-current={current('/service-tiers')}>
                Pricing
              </Link>
              <Link className={`s-mbtn${pathname === '/for-clerks' ? ' is-current' : ''}`} href="/for-clerks" aria-current={current('/for-clerks')}>
                For Pros
              </Link>
              <Dropdown id="m-co" label="Company" narrow open={menu === 'co'} onToggle={() => toggle('co')}>
                <div>
                  {COMPANY.map((s) => (
                    <MenuItem key={s.title} item={s} onPick={close} />
                  ))}
                </div>
              </Dropdown>
            </nav>

            <div className="s-hdr-act">
              <Link className="ld-btn ld-btn-ghost s-hide-sm" href="/contact">
                Talk to us
              </Link>
              {/* Signed-out buttons show while the session loads, so the header never jumps. */}
              {!loading && user ? (
                <Link className="ld-btn ld-btn-primary" href="/post-signin">
                  Dashboard
                </Link>
              ) : (
                <>
                  <Link className="ld-btn ld-btn-secondary s-hide-sm" href="/auth">
                    Log in
                  </Link>
                  <Link className="ld-btn ld-btn-primary" href="/auth?tab=signup">
                    Get started
                  </Link>
                </>
              )}
              <button
                className="ld-iconbtn s-burger"
                type="button"
                aria-label={drawer ? 'Close menu' : 'Open menu'}
                aria-expanded={drawer}
                aria-controls="drawer"
                onClick={() => setDrawer((d) => !d)}
              >
                <Icon name="menu" size={22} />
              </button>
            </div>
          </div>
        </div>

        <div className="s-drawer" id="drawer" hidden={!drawer}>
          <div className="s-wrap">
            <div className="s-in">
              {DRAWER.map((group) => (
                <div key={group.heading} style={{ display: 'contents' }}>
                  <h6>{group.heading}</h6>
                  {group.links.map((l) => (
                    <Link key={l.title} href={l.href} onClick={close}>
                      <Icon name={l.icon} size={20} /> {l.title}
                    </Link>
                  ))}
                </div>
              ))}
              <Link href={user ? '/post-signin' : '/auth'} onClick={close}>
                <Icon name="user" size={20} /> {user ? 'Dashboard' : 'Log in'}
              </Link>
            </div>
          </div>
        </div>
      </header>
    </>
  )
}
