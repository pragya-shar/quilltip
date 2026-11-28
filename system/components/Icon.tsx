import type { IconName } from '../iconGlyphs'
import { ICON_SPRITE_URL } from '../iconSpriteVersion'

export type IconGlyph = IconName

type IconProps = {
  icon: IconGlyph
  /** Pixel size; 24 by default, 20 inside dense rows. */
  size?: 16 | 20 | 24 | 28 | 32
  /** Only for an icon that stands alone and is not inside a labelled control. */
  label?: string
  className?: string
}

/**
 * An icon from the vocabulary in system/icons.ts, drawn from the sprite at
 * /icons.svg. Decorative by default: the control around it carries the
 * name. It draws in currentColor. Its box is set by its own size, so
 * nothing moves when the sprite arrives, and it draws with scripts off.
 */
export function Icon({ icon, size = 24, label, className }: IconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      className={className}
      aria-hidden={label ? undefined : true}
      aria-label={label}
      role={label ? 'img' : undefined}
      focusable={false}
    >
      <use href={`${ICON_SPRITE_URL}#qt-i-${icon}`} />
    </svg>
  )
}
