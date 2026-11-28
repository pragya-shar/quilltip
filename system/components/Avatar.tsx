/* eslint-disable @next/next/no-img-element -- avatars are small, sized and lazy; next/image adds nothing here */
import { cx } from '../cx'
import { avatarSrc } from '../media/avatarSource'

type AvatarProps = {
  /** The person's name. Initials and the tint come from it. */
  name: string
  /** A square image. Drawn only from this deployment's storage or a
   * same-site path (system/media/avatarSource.ts); otherwise initials. */
  src?: string | null
  size?: 24 | 30 | 42 | 56
  /** decorative: the name is already written beside it. */
  decorative?: boolean
  className?: string
}

/** Initials from a name: "Tomás Reyes" → "TR", "noor" → "N". */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/u).filter(Boolean)
  const first = Array.from(words[0] ?? '?')[0] ?? '?'
  const last = words.length > 1 ? (Array.from(words.at(-1)!)[0] ?? '') : ''
  return `${first}${last}`.toLocaleUpperCase()
}

/** One of six quiet tints, fixed for a name. */
function tint(name: string): number {
  let hash = 0
  for (const char of name) hash = (hash * 31 + char.codePointAt(0)!) >>> 0
  return hash % 6
}

/** A person: their image, or their initials on a quiet tint. */
export function Avatar({
  name,
  src,
  size = 42,
  decorative,
  className,
}: AvatarProps) {
  const image = avatarSrc(src)
  return (
    <span
      className={cx('qt-avatar', className)}
      data-size={size}
      data-tint={tint(name)}
      role={decorative ? undefined : 'img'}
      aria-label={decorative ? undefined : name}
      aria-hidden={decorative || undefined}
    >
      {image ? (
        <img
          src={image}
          alt=""
          width={size}
          height={size}
          loading="lazy"
          decoding="async"
          // The image host learns nothing about the page it is shown on.
          referrerPolicy="no-referrer"
        />
      ) : (
        <span aria-hidden="true">{initials(name)}</span>
      )}
    </span>
  )
}
