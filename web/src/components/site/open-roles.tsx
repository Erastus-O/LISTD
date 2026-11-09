import Link from 'next/link'
import { Icon } from '@/components/listd/icon'
import { loadOpenVacancies } from '@/lib/careers'

/** About page careers block: live vacancies from /admin/careers. */
export async function OpenRoles() {
  const vacancies = await loadOpenVacancies()

  if (vacancies.length === 0) {
    return (
      <div className="ld-empty">
        <div className="ic">
          <Icon name="users" size={28} />
        </div>
        <h3>No open roles right now</h3>
        <p>
          We post every vacancy here first. Check back soon, or follow LISTD on Instagram, TikTok or
          Facebook to hear about new roles.
        </p>
      </div>
    )
  }

  return (
    <div className="s-grid">
      {vacancies.slice(0, 3).map((v) => (
        <Link key={v.id} href={`/careers/${v.slug ?? v.id}`} className="s-ccard">
          <b>{v.title}</b>
          <span className="s-muted">
            {[v.location, v.employmentType].filter(Boolean).join(' · ')}
          </span>
        </Link>
      ))}
      <Link className="ld-link" href="/careers">
        View all open roles
      </Link>
    </div>
  )
}
