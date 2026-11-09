import Image from 'next/image'

type Size = 'sm' | 'md' | 'lg' | 'xl'

type Props = {
  /** Public URL of the profile photo (`profiles.avatar_url`) — null falls
   *  back to initials. */
  url: string | null
  /** Display name; used for alt text + initials fallback. */
  name: string | null
  /** Optional fallback identifier if `name` is empty (e.g. an email). */
  emailFallback?: string | null
  size?: Size
}

const SIZE_PX: Record<Size, number> = {
  sm: 28,
  md: 40,
  lg: 64,
  xl: 96,
}

const SIZE_TEXT: Record<Size, string> = {
  sm: 'text-[11px]',
  md: 'text-sm',
  lg: 'text-lg',
  xl: 'text-2xl',
}

/**
 * Round profile avatar shared across UserPill (top-bar, sm), admin detail
 * headers (lg), and the upload widget (xl). Falls back to initials in the
 * brand primary colour when no photo is set.
 *
 * `unoptimized` skips next/image optimisation for Supabase storage URLs
 * (no `remotePatterns` config required); same pattern as the existing
 * inspection photo uploader.
 */
export function ProfileAvatar({
  url,
  name,
  emailFallback,
  size = 'md',
}: Props) {
  const px = SIZE_PX[size]
  return (
    <span
      className={`relative inline-flex shrink-0 overflow-hidden rounded-full bg-primary font-semibold text-primary-foreground ${SIZE_TEXT[size]}`}
      style={{ width: px, height: px }}
    >
      {url ? (
        <Image
          src={url}
          alt={name ?? 'Profile photo'}
          fill
          sizes={`${px}px`}
          className="object-cover"
          unoptimized
        />
      ) : (
        <span className="flex h-full w-full items-center justify-center">
          {computeInitials(name, emailFallback ?? null)}
        </span>
      )}
    </span>
  )
}

function computeInitials(
  name: string | null,
  email: string | null
): string {
  const fromName = (name ?? '').trim()
  if (fromName) {
    const parts = fromName.split(/\s+/).filter(Boolean)
    const first = parts[0]?.[0] ?? ''
    const last = parts.length > 1 ? parts[parts.length - 1][0] : ''
    return (first + last).toUpperCase() || '?'
  }
  const fromEmail = (email ?? '').trim()
  if (fromEmail) return fromEmail[0]!.toUpperCase()
  return '?'
}
