import Link from 'next/link'
import { BookOpen, ChevronRight } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { requireSession } from '@/lib/dal'
import { listGuidesFor } from '@/lib/guides'

export const metadata = { title: 'Help · LISTD' }
export const dynamic = 'force-dynamic'

/**
 * Help-centre landing page. Lists every guide the caller can see based
 * on their role(s). Admins see all four; everyone else sees the one(s)
 * tied to their role(s).
 *
 * The index is intentionally minimal — title, summary, last-updated
 * date. Per-guide content lives at `/help/[slug]`. Keeping the index
 * a thin overview means returning users can skim and re-enter the
 * relevant guide in two clicks.
 */
export default async function HelpIndexPage() {
  const session = await requireSession()
  const guides = await listGuidesFor(session.roles)

  return (
    <div className="w-full space-y-8 px-6 py-10">
      <header className="space-y-2">
        <div className="inline-flex items-center gap-2 text-sm text-muted-foreground">
          <BookOpen className="h-4 w-4" />
          Help centre
        </div>
        <h1 className="text-3xl font-semibold tracking-tight">
          Guides for your role
        </h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Short, task-focused handbooks for everyday LISTD workflows.
          You only see guides relevant to your role: admins can see them all.
          Source files live in <code className="rounded bg-muted px-1 py-0.5 text-xs">Docs/guides/</code> and
          accept pull requests from anyone with repo access.
        </p>
      </header>

      {guides.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center text-sm text-muted-foreground">
            No guides match your role yet.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {guides.map((g) => (
            <Link
              key={g.slug}
              href={`/help/${g.slug}`}
              className="group block focus:outline-none"
            >
              <Card className="h-full transition-shadow group-hover:shadow-md">
                <CardContent className="space-y-2 p-6">
                  <div className="flex items-start justify-between gap-2">
                    <h2 className="text-base font-semibold">{g.title}</h2>
                    <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                  </div>
                  <p className="text-sm text-muted-foreground">{g.summary}</p>
                  {g.updated && (
                    <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                      Updated {g.updated}
                    </p>
                  )}
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
