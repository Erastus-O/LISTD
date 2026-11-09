'use client'

import { useEffect, useRef, useState } from 'react'
import { Icon } from '@/components/listd/icon'

type Step = 'done' | 'current' | 'todo'

type Preview = {
  key: string
  k: string
  label: string
  tab: string
  icon: string
  title: string
  points: string[]
  addr: string
  date: string
  tier: 'priority' | 'standard' | null
  clean?: string
  status: [string, string]
  steps: Step[]
  pro: { initials: string; name: string; level: number; role: string; isNew?: boolean } | null
  btn: string
}

// Example jobs, illustrative only (no live data).
const PREVIEWS: Preview[] = [
  { key: 'inventory', k: 'inventory', label: 'Inventory', tab: 'Inventory', icon: 'inventory', title: 'A full schedule of condition, before anyone moves in', points: ['Every item rated from New to Very poor', 'Timestamped photos, with close-ups and scale references on any damage', 'Approve the report when you’re happy'], addr: 'Flat 3, 22 Amhurst Rd, London E8', date: '21 Oct 2026, 09:00', tier: 'priority', status: ['Ready to approve', 'awaiting'], steps: ['done', 'done', 'done', 'done', 'current', 'todo'], pro: { initials: 'PS', name: 'Priya S.', level: 3, role: 'Pro Clerk' }, btn: 'Review report' },
  { key: 'check-in', k: 'checkin', label: 'Check-In', tab: 'Check-In', icon: 'check-in', title: 'Tenant walk-through, signed off', points: ['Walk the tenant through every room on move-in day', 'Meter readings with photo evidence', 'Tenant signs off on any device'], addr: '9 Gloucester Rd, Bristol BS7', date: '27 Oct 2026, 11:30', tier: 'standard', status: ['Accepted', 'accepted'], steps: ['done', 'done', 'todo', 'todo', 'todo', 'todo'], pro: { initials: 'JM', name: 'Jordan M.', level: 1, role: 'Pro Clerk', isNew: true }, btn: 'Add access notes' },
  { key: 'mid-term', k: 'midterm', label: 'Mid-Term Inspection', tab: 'Mid-Term', icon: 'inspection', title: 'Condition checks during the tenancy', points: ['Compared with the check-in or inventory', 'Repairs and cleaning needs flagged with photos', 'Shared report for landlord and agent'], addr: '18 Lordship Lane, London SE22', date: '3 Nov 2026, 14:00', tier: 'standard', status: ['Booked', 'booked'], steps: ['current', 'todo', 'todo', 'todo', 'todo', 'todo'], pro: null, btn: 'Edit booking' },
  { key: 'check-out', k: 'checkout', label: 'Check-Out', tab: 'Check-Out', icon: 'check-out', title: 'End-of-tenancy condition, signed off', points: ['Compared item by item against the check-in or inventory', 'Damage shown close up with scale references', 'Payment released to the Pro when you approve the report'], addr: '14 Clifton Road, Bristol BS8', date: '24 Oct 2026, 10:00', tier: 'standard', status: ['In progress', 'progress'], steps: ['done', 'done', 'current', 'todo', 'todo', 'todo'], pro: { initials: 'SR', name: 'Sam R.', level: 3, role: 'Pro Clerk' }, btn: 'Track job' },
  { key: 'repairs', k: 'repairs', label: 'Repairs & Maintenance', tab: 'Repairs & Maintenance', icon: 'settings', title: 'A fixed task price, or a paid diagnosis', points: ['Report a repair with photos in minutes', 'Itemised quote, or a diagnostic visit credited to the repair', 'Before and after photos from a vetted Pro Trades'], addr: '7 Cotham Hill, Bristol BS6', date: '29 Oct 2026, 13:00', tier: null, clean: 'Fixed quote', status: ['Accepted', 'accepted'], steps: ['done', 'done', 'todo', 'todo', 'todo', 'todo'], pro: { initials: 'DO', name: 'Dami O.', level: 2, role: 'Pro Trades' }, btn: 'View quote' },
  { key: 'cleaning', k: 'cleaning', label: 'Cleaning', tab: 'Cleaning', icon: 'cleaning', title: 'Cleaning to a stated checklist, quoted before you pay', points: ['Standard, Deep, End of Tenancy or Office', 'Room-by-room checklist for the Pro Cleaner', 'Before and after photos on every job'], addr: '41 Moseley Rd, Birmingham B12', date: '25 Oct 2026, 08:30', tier: null, clean: 'Deep clean', status: ['Approved', 'signed'], steps: ['done', 'done', 'done', 'done', 'done', 'done'], pro: { initials: 'AK', name: 'Amara K.', level: 3, role: 'Pro Cleaner' }, btn: 'View photos' },
]

const STAGES = ['Booked', 'Accepted', 'In progress', 'LISTD review', 'Ready to approve', 'Approved']
const ROTATE_MS = 5200

const vars = (o: Record<string, string>) => o as React.CSSProperties

/** Home hero: service tabs with an example job card; auto-rotates until touched. */
export function HeroPreview() {
  const [index, setIndex] = useState(3)
  const [auto, setAuto] = useState(false)
  const [paused, setPaused] = useState(false)
  const tabs = useRef<Array<HTMLButtonElement | null>>([])

  useEffect(() => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduce) return
    const id = window.setTimeout(() => setAuto(true), 0)
    return () => window.clearTimeout(id)
  }, [])

  useEffect(() => {
    if (!auto || paused) return
    const id = window.setTimeout(() => setIndex((i) => (i + 1) % PREVIEWS.length), ROTATE_MS)
    return () => window.clearTimeout(id)
  }, [auto, paused, index])

  const pick = (i: number) => {
    setAuto(false)
    setIndex(i)
  }

  const s = PREVIEWS[index]
  const tierClass = s.tier === 'standard' ? 'core' : s.tier
  const tagStyle = vars({ '--t': `var(--service-${s.k}-subtle)`, '--tx': `var(--service-${s.k}-text)` })

  return (
    <div
      className="s-panel"
      onPointerEnter={() => setPaused(true)}
      onPointerLeave={() => setPaused(false)}
    >
      <div className="s-svctabs" role="tablist" aria-label="Choose a service to preview">
        {PREVIEWS.map((p, i) => (
          <button
            key={p.key}
            ref={(el) => {
              tabs.current[i] = el
            }}
            className={`s-tabbtn${auto && !paused && i === index ? ' is-auto' : ''}`}
            role="tab"
            type="button"
            aria-selected={i === index}
            tabIndex={i === index ? 0 : -1}
            style={vars({ '--c': `var(--service-${p.k})`, '--m-dur': `${ROTATE_MS}ms` })}
            onClick={() => pick(i)}
            onKeyDown={(e) => {
              const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0
              if (!d) return
              const n = (i + d + PREVIEWS.length) % PREVIEWS.length
              pick(n)
              tabs.current[n]?.focus()
            }}
          >
            <i>
              <Icon name={p.icon} size={16} />
            </i>
            {p.tab}
          </button>
        ))}
      </div>

      <div className="s-panel-card m-swap" key={s.key} role="tabpanel" aria-live="polite">
        <div className="copy">
          <span className="ld-tag" style={{ ...tagStyle, justifySelf: 'start' }}>
            <Icon name={s.icon} size={16} />
            {s.label}
          </span>
          <h3>{s.title}</h3>
          <ul>
            {s.points.map((p) => (
              <li key={p}>
                <Icon name="check" size={16} />
                <span>{p}</span>
              </li>
            ))}
          </ul>
        </div>
        <article className="ld-card ld-job" style={vars({ '--c': `var(--service-${s.k})` })}>
          <div className="ld-job-top">
            <span className="ld-tag" style={tagStyle}>
              <Icon name={s.icon} size={16} />
              {s.label}
            </span>
            <span className="ld-pill" style={vars({ '--c': `var(--status-${s.status[1]})` })}>
              <i aria-hidden="true" />
              {s.status[0]}
            </span>
          </div>
          <h3>{s.addr}</h3>
          <div className="ld-job-meta">
            <span>
              <Icon name="calendar" size={16} />
              {s.date}
            </span>
            {s.tier ? (
              <span className={`ld-tier ld-tier-${tierClass}`}>
                {s.tier === 'priority' ? 'Priority' : 'Standard'}
              </span>
            ) : (
              <span className="ld-badge">{s.clean}</span>
            )}
          </div>
          <ol className="ld-rail" style={vars({ '--n': '6' })} aria-label="Job progress">
            {s.steps.map((st, i) => (
              <li key={STAGES[i]} className={st} aria-current={st === 'current' ? 'step' : undefined}>
                <i aria-hidden="true" />
                <b>{STAGES[i]}</b>
              </li>
            ))}
          </ol>
          <div className="ld-card-foot">
            {s.pro ? (
              <div className="ld-job-pro">
                <span className="ld-avatar ld-avatar-sm">
                  <span role="img" aria-label={s.pro.name}>
                    {s.pro.initials}
                  </span>
                  <span className="v" title="Verified Pro">
                    <Icon name="check" size={10} />
                  </span>
                </span>
                <span>
                  <b>{s.pro.name}</b>
                  <span className="ld-level">
                    <span aria-hidden="true">
                      {[1, 2, 3].map((n) => (
                        <i key={n} className={n <= s.pro!.level ? 'on' : ''} />
                      ))}
                    </span>
                    {s.pro.role} · Level {s.pro.level}
                  </span>
                  {s.pro.isNew && (
                    <>
                      {' '}
                      <span className="ld-badge ld-badge-info">New to LISTD</span>
                    </>
                  )}
                </span>
              </div>
            ) : (
              <span className="s-fine">Finding a Pro</span>
            )}
            <span className="ld-btn ld-btn-secondary ld-btn-sm">{s.btn}</span>
          </div>
        </article>
      </div>
    </div>
  )
}
