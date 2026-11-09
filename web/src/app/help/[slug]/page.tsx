import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { requireSession } from '@/lib/dal'
import { loadGuide } from '@/lib/guides'

type Props = { params: Promise<{ slug: string }> }

export async function generateMetadata({ params }: Props) {
  const { slug } = await params
  return { title: `Help · ${slug.charAt(0).toUpperCase() + slug.slice(1)}` }
}

export const dynamic = 'force-dynamic'

/**
 * Renders a single guide. RBAC: a user can only read a guide if their
 * role(s) overlap with the guide's `visibleTo` list (admins see all).
 * The loader returns null for both "no such slug" and "role denied" —
 * we surface both as 404 rather than 403 because exposing existence is
 * a minor leak and admins can already see everything anyway.
 *
 * Markdown is rendered via `react-markdown` with `remark-gfm` (tables,
 * task lists, strikethrough, auto-links). `react-markdown` defaults to
 * disallowing raw HTML, which is what we want for content that may be
 * edited by anyone with repo access.
 */
export default async function HelpDetailPage({ params }: Props) {
  const session = await requireSession()
  const { slug } = await params
  const guide = await loadGuide(slug, session.roles)
  if (!guide) notFound()

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6 px-6 py-10">
      <Link
        href="/help"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        All guides
      </Link>

      <header className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight">
          {guide.title}
        </h1>
        <p className="text-sm text-muted-foreground">{guide.summary}</p>
        {guide.updated && (
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
            Last updated {guide.updated}
          </p>
        )}
      </header>

      <article className="prose prose-sm max-w-none dark:prose-invert">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>
          {guide.content}
        </ReactMarkdown>
      </article>
    </div>
  )
}
