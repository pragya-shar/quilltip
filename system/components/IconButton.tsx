'use client'

import { AppLink as Link } from './AppLink'
import type { ButtonHTMLAttributes, Ref } from 'react'
import { cx } from '../cx'
import { Icon, type IconGlyph } from './Icon'
import { Spinner } from './Spinner'

type Common = {
  icon: IconGlyph
  /** The accessible name. Required: an icon alone has no words. */
  label: string
  /** plain: no fill. sunk: a quiet round fill. action: the ink fill. */
  variant?: 'plain' | 'sunk' | 'action'
  loading?: boolean
  /** Shown but not usable now, and still focusable: `aria-disabled`, a
   * press does nothing. A string is the reason, heard after the name
   * ("Add an image. Not available yet"). A caller's own `aria-disabled`
   * counts too. */
  unavailable?: boolean | string
  className?: string
  ref?: Ref<HTMLButtonElement & HTMLAnchorElement>
}

type AsButton = Common &
  Omit<
    ButtonHTMLAttributes<HTMLButtonElement>,
    'children' | 'className' | 'aria-label'
  > & { href?: undefined }

type AsLink = Common & { href: string; onClick?: () => void }

export type IconButtonProps = AsButton | AsLink

/** A 44 px control with one icon and a required name. */
export function IconButton(props: IconButtonProps) {
  const {
    icon,
    label,
    variant = 'plain',
    loading,
    unavailable,
    className,
    ref,
  } = props
  const data = {
    className: cx('qt-icon-button', className),
    'data-variant': variant,
    'aria-label':
      typeof unavailable === 'string' && unavailable
        ? `${label}. ${unavailable}`
        : label,
  }
  const glyph = loading ? <Spinner /> : <Icon icon={icon} size={24} />
  if (props.href !== undefined) {
    return (
      <Link href={props.href} onClick={props.onClick} ref={ref} {...data}>
        {glyph}
      </Link>
    )
  }
  const {
    icon: _i,
    label: _l,
    variant: _v,
    loading: _lo,
    unavailable: _u,
    className: _c,
    ref: _r,
    href: _h,
    type = 'button',
    onClick,
    'aria-disabled': callerDisabled,
    ...rest
  } = props
  // Busy, unavailable, or marked so by the caller: focusable, inert to presses.
  const blocked =
    Boolean(loading) ||
    Boolean(unavailable) ||
    callerDisabled === true ||
    callerDisabled === 'true'
  return (
    <button
      {...rest}
      {...data}
      ref={ref}
      type={type}
      aria-busy={loading || undefined}
      aria-disabled={blocked || undefined}
      onClick={blocked ? (event) => event.preventDefault() : onClick}
    >
      {glyph}
    </button>
  )
}
