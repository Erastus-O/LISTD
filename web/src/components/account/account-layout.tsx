import Link from 'next/link'
import { ChevronRight, type LucideIcon } from 'lucide-react'
import { ProfileAvatar } from '@/components/role/profile-avatar'

/**
 * Shared layout for the account / settings pages (client, Pro, cleaner,
 * notification preferences). Server components; the forms they wrap keep
 * their own state.
 */

export type AccountStat = { label: string; value: string; icon: LucideIcon }

/** Brand header: avatar, name, email, role and optional stats. */
export function AccountHeader({
  name,
  email,
  avatarUrl,
  roleLabel,
  status,
  stats,
}: {
  name: string | null
  email: string | null
  avatarUrl: string | null
  roleLabel: string
  /** Optional chip next to the role (e.g. verification state). */
  status?: { label: string; tone: 'success' | 'warning' | 'muted' }
  stats?: AccountStat[]
}) {
  return (
    <section className="relative overflow-hidden rounded-3xl bg-(--teal-950) p-6 text-white sm:p-8">
      <div
        aria-hidden
        className="absolute inset-0 bg-[radial-gradient(circle_at_85%_0%,rgba(46,196,182,0.32),transparent_50%),radial-gradient(circle_at_0%_100%,rgba(230,205,174,0.12),transparent_45%)]"
      />
      <div
        aria-hidden
        className="absolute inset-0 bg-[radial-gradient(circle,rgba(255,255,255,0.06)_1px,transparent_1px)] bg-size-[28px_28px] mask-[linear-gradient(to_left,#000,transparent_70%)]"
      />

      <div className="relative flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-5">
          <span className="rounded-full ring-4 ring-white/10">
            <ProfileAvatar
              url={avatarUrl}
              name={name}
              emailFallback={email}
              size="lg"
            />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-white/10 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.18em] text-(--mint-300)">
                {roleLabel}
              </span>
              {status && <StatusChip {...status} />}
            </div>
            <h1 className="mt-2 truncate font-display text-3xl font-medium text-white sm:text-4xl">
              {name || 'Your account'}
            </h1>
            {email && (
              <p className="mt-0.5 truncate text-sm text-white/60">{email}</p>
            )}
          </div>
        </div>

        {stats && stats.length > 0 && (
          <dl className="grid grid-cols-3 gap-2 sm:gap-3">
            {stats.map(({ label, value, icon: Icon }) => (
              <div
                key={label}
                className="min-w-0 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 backdrop-blur-md sm:min-w-28"
              >
                <dt className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-white/55">
                  <Icon className="h-3.5 w-3.5 text-(--mint-300)" aria-hidden />
                  <span className="truncate">{label}</span>
                </dt>
                <dd className="mt-1 text-2xl font-semibold text-white">
                  {value}
                </dd>
              </div>
            ))}
          </dl>
        )}
      </div>
    </section>
  )
}

const CHIP_TONES = {
  success: 'bg-emerald-400/15 text-emerald-300',
  warning: 'bg-amber-400/15 text-amber-300',
  muted: 'bg-white/10 text-white/70',
} as const

function StatusChip({
  label,
  tone,
}: {
  label: string
  tone: keyof typeof CHIP_TONES
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${CHIP_TONES[tone]}`}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden />
      {label}
    </span>
  )
}

/**
 * Page frame: header on top, then a sticky in-page nav beside the sections
 * on wide screens. Also softens the app's square Card corners on these pages.
 */
export function AccountPage({
  header,
  nav,
  children,
}: {
  header: React.ReactNode
  nav: Array<{ id: string; label: string }>
  children: React.ReactNode
}) {
  return (
    <div className="w-full space-y-8 px-4 py-8 sm:px-6 sm:py-10 [&_[data-slot=card]]:rounded-2xl">
      {header}
      <div className="grid gap-8 xl:grid-cols-[200px_minmax(0,1fr)]">
        <nav
          aria-label="Settings sections"
          className="hidden xl:block"
        >
          <ul className="sticky top-24 space-y-0.5 border-l border-border">
            {nav.map((item) => (
              <li key={item.id}>
                <a
                  href={`#${item.id}`}
                  className="-ml-px block border-l-2 border-transparent py-1.5 pl-4 text-sm text-muted-foreground transition-colors hover:border-primary hover:text-foreground"
                >
                  {item.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
        <div className="min-w-0 space-y-10">{children}</div>
      </div>
    </div>
  )
}

/** One labelled group of settings: title + description beside its cards. */
export function AccountSection({
  id,
  title,
  description,
  children,
}: {
  id: string
  title: string
  description: string
  children: React.ReactNode
}) {
  return (
    <section
      id={id}
      aria-labelledby={`${id}-title`}
      className="grid scroll-mt-24 gap-4 border-t border-border pt-8 first:border-t-0 first:pt-0 lg:grid-cols-[240px_minmax(0,1fr)] lg:gap-10"
    >
      <div>
        <h2
          id={`${id}-title`}
          className="text-base font-semibold text-foreground"
        >
          {title}
        </h2>
        <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
          {description}
        </p>
      </div>
      <div className="min-w-0 space-y-4">{children}</div>
    </section>
  )
}

/** Card-style link to another settings page. */
export function SettingsLinkCard({
  href,
  icon: Icon,
  title,
  description,
}: {
  href: string
  icon: LucideIcon
  title: string
  description: string
}) {
  return (
    <Link
      href={href}
      className="group flex items-center gap-4 rounded-2xl border border-border bg-card p-5 shadow-sm transition-all hover:-translate-y-px hover:border-primary/40 hover:shadow-md"
    >
      <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
        <Icon className="h-5 w-5" aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-foreground">
          {title}
        </span>
        <span className="mt-0.5 block text-xs text-muted-foreground">
          {description}
        </span>
      </span>
      <ChevronRight
        className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5"
        aria-hidden
      />
    </Link>
  )
}

/** Label/value row for read-only details. */
export function DetailRow({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="grid grid-cols-[120px_minmax(0,1fr)] gap-3 border-b border-border/60 py-3 last:border-0">
      <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <span className="text-sm text-foreground">{children}</span>
    </div>
  )
}
