'use client'

import Link from 'next/link'
import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react'
import { cx } from '../cx'
import { MoreIcon } from '../icons'
import { Icon, type IconGlyph } from './Icon'

export type MenuItem = {
  id: string
  label: string
  icon?: IconGlyph
  /** danger: an action that removes or ends something. */
  tone?: 'default' | 'danger'
} & (
  | { onSelect: () => void; href?: undefined }
  | { href: string; onSelect?: undefined }
)

type MenuProps = {
  /** The trigger's accessible name: "More actions". */
  label: string
  items: readonly MenuItem[]
  /** Icon for the trigger; "more" by default. */
  icon?: IconGlyph
  className?: string
}

/**
 * A short list of actions behind one button. Arrow keys move, Enter
 * chooses, Escape and Tab close, focus returns to the button. It opens
 * below the button, or above it when there is no room, aligned to the
 * button's end edge (right-to-left aware).
 */
export function Menu({ label, items, icon = MoreIcon, className }: MenuProps) {
  const menuId = useId()
  const [open, setOpen] = useState<false | 'first' | 'last'>(false)
  const [above, setAbove] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const list = useRef<HTMLDivElement>(null)

  const entries = () =>
    Array.from(
      list.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []
    )

  useLayoutEffect(() => {
    if (!open || !list.current || !trigger.current) return
    const room =
      window.innerHeight - trigger.current.getBoundingClientRect().bottom
    setAbove(room < list.current.offsetHeight + 16)
    const all = entries()
    ;(open === 'last' ? all.at(-1) : all[0])?.focus()
  }, [open])

  useEffect(() => {
    if (!open) return
    const onDown = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', onDown)
    return () => document.removeEventListener('pointerdown', onDown)
  }, [open])

  const close = () => {
    setOpen(false)
    trigger.current?.focus()
  }

  const onListKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const all = entries()
    const at = all.indexOf(document.activeElement as HTMLElement)
    const go = (index: number) =>
      all[(index + all.length) % all.length]?.focus()
    if (event.key === 'ArrowDown') go(at + 1)
    else if (event.key === 'ArrowUp') go(at - 1)
    else if (event.key === 'Home') go(0)
    else if (event.key === 'End') go(all.length - 1)
    else if (event.key === 'Escape') close()
    else if (event.key === 'Tab') {
      setOpen(false)
      return
    } else return
    event.preventDefault()
  }

  return (
    <div className={cx('qt-menu', className)} ref={root}>
      <button
        ref={trigger}
        type="button"
        className="qt-icon-button"
        data-variant="plain"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={Boolean(open)}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((now) => (now ? false : 'first'))}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault()
            setOpen(event.key === 'ArrowUp' ? 'last' : 'first')
          }
        }}
      >
        <Icon icon={icon} size={24} />
      </button>
      {open ? (
        <div
          ref={list}
          id={menuId}
          role="menu"
          tabIndex={-1}
          aria-label={label}
          className="qt-menu__list"
          data-side={above ? 'top' : 'bottom'}
          onKeyDown={onListKey}
        >
          {items.map((item) => {
            const inner = (
              <>
                {item.icon ? <Icon icon={item.icon} size={20} /> : null}
                <span>{item.label}</span>
              </>
            )
            const common = {
              role: 'menuitem',
              tabIndex: -1,
              className: 'qt-menu__item',
              'data-tone': item.tone ?? 'default',
            } as const
            return item.href !== undefined ? (
              <Link
                key={item.id}
                {...common}
                href={item.href}
                onClick={() => setOpen(false)}
              >
                {inner}
              </Link>
            ) : (
              <button
                key={item.id}
                {...common}
                type="button"
                onClick={() => {
                  close()
                  item.onSelect()
                }}
              >
                {inner}
              </button>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}
