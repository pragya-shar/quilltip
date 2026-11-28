'use client'

import { AppLink as Link } from './AppLink'
import {
  useId,
  type ButtonHTMLAttributes,
  type ReactNode,
  type Ref,
} from 'react'
import { cx } from '../cx'
import { Icon, type IconGlyph } from './Icon'
import { Spinner } from './Spinner'

export type ButtonVariant = 'primary' | 'secondary' | 'quiet' | 'danger'

type Common = {
  variant?: ButtonVariant
  /** m: 48 px, the default. l: 56 px, the one main action of a screen. */
  size?: 'm' | 'l'
  /** Fills the width of its container. */
  block?: boolean
  icon?: IconGlyph
  /** Busy: the label stays (no width jump), a spinner shows, presses are ignored. */
  loading?: boolean
  /** Shown but not usable now, and still focusable: `aria-disabled`, a
   * press does nothing. A string is the reason, given as the button's
   * description. A caller's own `aria-disabled` counts too. */
  unavailable?: boolean | string
  className?: string
  children: ReactNode
  ref?: Ref<HTMLButtonElement & HTMLAnchorElement>
}

type AsButton = Common &
  Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'className'> & {
    href?: undefined
  }

type AsLink = Common & {
  /** Renders a link that looks like a button: navigation, not an action. */
  href: string
  onClick?: () => void
  disabled?: undefined
  type?: undefined
}

export type ButtonProps = AsButton | AsLink

/**
 * A labelled action. One primary per screen; secondary for the rest; quiet
 * for low-weight actions inside rows and sheets; danger to retry or confirm
 * a failure. Every size keeps a hit area of at least 44 px.
 */
export function Button(props: ButtonProps) {
  const {
    variant = 'secondary',
    size = 'm',
    block,
    icon,
    loading,
    unavailable,
    className,
    children,
    ref,
  } = props
  const reasonId = useId()
  const reason =
    typeof unavailable === 'string' && unavailable ? unavailable : null
  const inner = (
    <>
      {loading ? <Spinner /> : icon ? <Icon icon={icon} size={20} /> : null}
      <span className="qt-button__label">{children}</span>
    </>
  )
  const data = {
    className: cx('qt-button', className),
    'data-variant': variant,
    'data-size': size,
    'data-block': block || undefined,
    'data-loading': loading || undefined,
  }
  if (props.href !== undefined) {
    return (
      <Link href={props.href} onClick={props.onClick} ref={ref} {...data}>
        {inner}
      </Link>
    )
  }
  const {
    variant: _v,
    size: _s,
    block: _b,
    icon: _i,
    loading: _l,
    unavailable: _u,
    className: _c,
    children: _ch,
    ref: _r,
    href: _h,
    type = 'button',
    onClick,
    disabled,
    'aria-disabled': callerDisabled,
    'aria-describedby': callerDescribedBy,
    ...rest
  } = props
  // Busy, unavailable, or marked so by the caller: it stays focusable (focus
  // is not lost) but ignores presses.
  const blocked =
    Boolean(loading) ||
    Boolean(unavailable) ||
    callerDisabled === true ||
    callerDisabled === 'true'
  const describedBy =
    [callerDescribedBy, reason ? reasonId : null].filter(Boolean).join(' ') ||
    undefined
  return (
    <>
      <button
        {...rest}
        {...data}
        ref={ref}
        type={type}
        disabled={disabled}
        aria-busy={loading || undefined}
        aria-disabled={blocked || undefined}
        aria-describedby={describedBy}
        onClick={blocked ? (event) => event.preventDefault() : onClick}
      >
        {inner}
      </button>
      {reason ? (
        <span id={reasonId} className="qt-visually-hidden">
          {reason}
        </span>
      ) : null}
    </>
  )
}
