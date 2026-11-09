import { headers } from 'next/headers'
import Link from 'next/link'
import { marketingHomeHref } from '@/lib/hosts'

export default async function NotFound() {
  const homeHref = marketingHomeHref((await headers()).get('host'))
  return (
    <main className="flex flex-1 items-center justify-center px-6 py-24">
      <div className="max-w-md space-y-6 text-center">
        <p className="text-sm font-medium uppercase tracking-widest text-primary">
          404
        </p>
        <h1 className="text-4xl font-display font-light text-foreground">
          Page not found
        </h1>
        <p className="text-muted-foreground">
          The page you’re looking for doesn’t exist or has moved.
        </p>
        <Link
          href={homeHref}
          className="inline-block bg-primary px-6 py-3 text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          Back to home
        </Link>
      </div>
    </main>
  )
}
