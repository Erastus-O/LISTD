import Link from 'next/link'
import { Icon, Logo } from '@/components/listd/icon'

const POINTS = [
  'Book check-ins, check-outs, repairs and cleaning in minutes',
  'Pay securely and only sign off when you\u2019re happy',
  'Timestamped photo reports for every visit',
]

/**
 * Frame for the sign-in, sign-up and password screens: the prototype's photo
 * panel beside the form, under a slim top bar.
 */
export function AuthShell({
  homeHref,
  children,
}: {
  /** "Back to home" target; see marketingHomeHref() in lib/hosts. */
  homeHref: string
  children: React.ReactNode
}) {
  return (
    <div className="flex min-h-screen w-full flex-col">
      <header className="a-top">
        <div className="in">
          <Link href={homeHref} className="ld-logo no-underline" aria-label="listd home">
            listd
          </Link>
          <Link href={homeHref} className="ld-link ml-auto text-sm">
            Back to home
          </Link>
        </div>
      </header>
      <main className="a-auth flex-1">
        <aside className="a-authbrand">
          <div className="a-authglass">
            <Logo white size={40} />
            <h2>Every property service, one trusted record.</h2>
            <ul>
              {POINTS.map((p) => (
                <li key={p}>
                  <Icon name="check" size={18} />
                  <span>{p}</span>
                </li>
              ))}
            </ul>
          </div>
        </aside>
        <section className="a-authpanel">
          <div className="a-authcard">{children}</div>
        </section>
      </main>
    </div>
  )
}
