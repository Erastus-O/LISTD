import Link from 'next/link'
import { unstable_cache } from 'next/cache'
import { inArray } from 'drizzle-orm'
import { platformSettings, withServiceRole } from '@/db'
import Image from 'next/image'

const SOCIAL_KEYS = [
  'instagram_url',
  'facebook_url',
  'linkedin_url',
  'tiktok_url',
  'x_url',
  'whatsapp_url',
] as const

type SocialKey = (typeof SOCIAL_KEYS)[number]

const SOCIAL_LABEL: Record<SocialKey, string> = {
  instagram_url: 'Instagram',
  facebook_url: 'Facebook',
  linkedin_url: 'LinkedIn',
  tiktok_url: 'TikTok',
  x_url: 'X',
  whatsapp_url: 'WhatsApp',
}

/** Shown when the admin hasn't set a URL under Settings. */
const SOCIAL_DEFAULTS: Partial<Record<SocialKey, string>> = {
  instagram_url: 'https://www.instagram.com/listd_pro',
  tiktok_url: 'https://www.tiktok.com/@listdpro',
  facebook_url: 'https://www.facebook.com/Listd.Pro',
}

// Cached so a build doesn't open one DB connection per static page.
const fetchSocialLinks = unstable_cache(
  async (): Promise<Partial<Record<SocialKey, string>>> => {
    // RLS bypass intentional: these values are public-facing anyway.
    try {
      const rows = await withServiceRole(async (tx) =>
        tx
          .select({ key: platformSettings.key, value: platformSettings.value })
          .from(platformSettings)
          .where(inArray(platformSettings.key, [...SOCIAL_KEYS]))
      )
      const map: Partial<Record<SocialKey, string>> = {}
      for (const r of rows) {
        if (r.value) map[r.key as SocialKey] = r.value
      }
      return map
    } catch (err) {
      console.warn('[footer] fetchSocialLinks failed; using defaults:', err)
      return {}
    }
  },
  ['footer-social-links'],
  { revalidate: 3600, tags: ['platform-settings'] }
)

const COLUMNS: Array<{ heading: string; links: Array<{ label: string; href: string }> }> = [
  {
    heading: 'Services',
    links: [
      { label: 'Inventory', href: '/#services' },
      { label: 'Check-In', href: '/#services' },
      { label: 'Mid-Term', href: '/#services' },
      { label: 'Check-Out', href: '/#services' },
      { label: 'Repairs & Maintenance', href: '/#services' },
      { label: 'Cleaning', href: '/#cleaning' },
      { label: 'More services coming soon', href: '/contact' },
    ],
  },
  {
    heading: 'Platform',
    links: [
      { label: 'How it works', href: '/how-it-works' },
      { label: 'Pricing', href: '/service-tiers' },
      { label: 'Trust & safety', href: '/about#trust' },
      { label: 'FAQ', href: '/#faq' },
    ],
  },
  {
    heading: "Who it's for",
    links: [
      { label: 'Clients', href: '/for-clients' },
      { label: 'Pros', href: '/for-clerks' },
      { label: 'Service businesses', href: '/#service-businesses' },
    ],
  },
  {
    heading: 'Company',
    links: [
      { label: 'About', href: '/about' },
      { label: 'Careers', href: '/careers' },
      { label: 'Contact', href: '/contact' },
    ],
  },
]

export async function SiteFooter() {
  const stored = await fetchSocialLinks()
  const social = SOCIAL_KEYS.flatMap((key) => {
    const url = stored[key] ?? SOCIAL_DEFAULTS[key]
    return url ? [{ key, url, label: SOCIAL_LABEL[key] }] : []
  })

  return (
    <footer className="s-foot s-wrap">
      <div className="s-in">
        <div className="top">
          <div>
            <Image className="s-footer-logo" src="/images/listd-footer.jpeg" width={136} height={48} alt="listd" />
            <p className="tag">Book. Connect. Track. Deliver.</p>
          </div>
          <div className="cols">
            {COLUMNS.map((col) => (
              <div key={col.heading}>
                <h6>{col.heading}</h6>
                <ul>
                  {col.links.map((l) => (
                    <li key={l.label}>
                      <Link href={l.href}>{l.label}</Link>
                    </li>
                  ))}
                  {col.heading === 'Company' && (
                    <li>
                      <Link href="/terms">Terms</Link> · <Link href="/privacy">Privacy</Link> ·{' '}
                      <Link href="/cookies">Cookies</Link>
                    </li>
                  )}
                </ul>
              </div>
            ))}
          </div>
        </div>
        <p className="s-company">LISTD Inventory Limited</p>
        <div className="bot">
          <span>
            {`© ${new Date().getFullYear()} LISTD · Bristol, Birmingham & London. Coming to your area soon.`}
          </span>
          <span>
            <span className="sel">support@listd.co.uk</span>
            {social.map((s) => (
              <span key={s.key}>
                {' · '}
                <a href={s.url} target="_blank" rel="noopener noreferrer">
                  {s.label}
                </a>
              </span>
            ))}
          </span>
        </div>
      </div>
    </footer>
  )
}
