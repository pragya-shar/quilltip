import { HugeiconsIcon, type IconSvgElement } from '@hugeicons/react'

export type IconGlyph = IconSvgElement

type IconProps = {
  icon: IconGlyph
  /** Pixel size; 24 by default, 20 inside dense rows. */
  size?: 16 | 20 | 24 | 28 | 32
  /** Only for an icon that stands alone and is not inside a labelled control. */
  label?: string
  className?: string
}

/**
 * An icon from the vocabulary in system/icons.ts. Decorative by default:
 * the control around it carries the name. It draws in currentColor.
 */
export function Icon({ icon, size = 24, label, className }: IconProps) {
  return (
    <HugeiconsIcon
      icon={icon}
      size={size}
      strokeWidth={1.5}
      color="currentColor"
      className={className}
      aria-hidden={label ? undefined : true}
      aria-label={label}
      role={label ? 'img' : undefined}
      focusable={false}
    />
  )
}
