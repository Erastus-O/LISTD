type Props = {
  title: string
  /** Path to the source file in the Lovable repo, e.g. `pages/admin/AdminClerks.tsx` */
  port?: string
}

export function PlaceholderPage({ title, port }: Props) {
  return (
    <main className="flex flex-1 items-center justify-center px-6 py-24">
      <div className="max-w-xl space-y-4 text-center">
        <p className="text-xs font-medium uppercase tracking-widest text-primary">
          M-Pre: pending port
        </p>
        <h1 className="text-3xl font-display font-light text-foreground">
          {title}
        </h1>
        {port && (
          <p className="text-sm text-muted-foreground">
            Source:{' '}
            <code className="rounded bg-muted px-2 py-0.5 font-mono text-xs">
              {port}
            </code>
          </p>
        )}
      </div>
    </main>
  )
}
