import { ICON_SPRITE } from './icon-sprite'

/** Design-system icon. Needs <IconSprite /> once on the page (root layout). */
export function Icon({
  name,
  size = 20,
  className,
}: {
  name: string
  size?: number
  className?: string
}) {
  return (
    <svg
      className={`ld-icon${className ? ` ${className}` : ''}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <use href={`#i-${name}`} />
    </svg>
  )
}

export function IconSprite() {
  return <div hidden dangerouslySetInnerHTML={{ __html: ICON_SPRITE }} />
}

export function Logo({
  white = false,
  size,
}: {
  white?: boolean
  size?: number
}) {
  return (
    <span
      className={`ld-logo${white ? ' ld-logo-white' : ''}`}
      style={size ? { fontSize: size } : undefined}
    >
      listd
    </span>
  )
}
