'use client'

import Link from 'next/link'
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
  const { icon, label, variant = 'plain', loading, className, ref } = props
  const data = {
    className: cx('qt-icon-button', className),
    'data-variant': variant,
    'aria-label': label,
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
    className: _c,
    ref: _r,
    href: _h,
    type = 'button',
    onClick,
    ...rest
  } = props
  return (
    <button
      {...rest}
      {...data}
      ref={ref}
      type={type}
      aria-busy={loading || undefined}
      aria-disabled={loading || undefined}
      onClick={loading ? (event) => event.preventDefault() : onClick}
    >
      {glyph}
    </button>
  )
}
