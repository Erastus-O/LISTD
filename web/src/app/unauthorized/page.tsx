import Link from 'next/link'

export const metadata = {
  title: 'Unauthorized',
}

export default function UnauthorizedPage() {
  return (
    <main className="flex flex-1 items-center justify-center px-6 py-24">
      <div className="max-w-md space-y-6 text-center">
        <p className="text-sm font-medium uppercase tracking-widest text-destructive">
          403
        </p>
        <h1 className="text-4xl font-display font-light text-foreground">
          You don’t have access to that page
        </h1>
        <p className="text-muted-foreground">
          If this looks wrong, contact support or sign in with a different
          account.
        </p>
        <div className="flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
          <Link
            href="/"
            className="bg-primary px-6 py-3 text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            Home
          </Link>
          <Link
            href="/auth"
            className="border border-input px-6 py-3 hover:bg-accent hover:text-accent-foreground transition-colors"
          >
            Sign in
          </Link>
        </div>
      </div>
    </main>
  )
}
