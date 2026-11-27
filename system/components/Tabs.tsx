'use client'

import { useId, useRef, type KeyboardEvent } from 'react'
import { cx } from '../cx'

/** The DOM id of a tab, for a panel's aria-labelledby. */
export function tabId(base: string, id: string): string {
  return `${base}-tab-${id}`
}

export type TabItem = {
  id: string
  label: string
  /** The id of the panel this tab shows. Omit when the tab navigates. */
  panelId?: string
}

type TabsProps = {
  items: readonly TabItem[]
  value: string
  onChange: (id: string) => void
  /** What the set of tabs is, for screen readers: "Feed". */
  label: string
  /** tabs: words with an underline (a feed). segmented: a pill group (a
   * choice inside a screen). */
  variant?: 'tabs' | 'segmented'
  className?: string
  /** A stable base for tab ids, when a panel must name its tab. */
  idBase?: string
}

/**
 * Tabs or a segmented control. Arrow keys move and select (right-to-left
 * aware), Home and End jump; only the selected tab is in the Tab order.
 * Each tab is at least 44 px tall.
 */
export function Tabs({
  items,
  value,
  onChange,
  label,
  variant = 'tabs',
  className,
  idBase,
}: TabsProps) {
  const list = useRef<HTMLDivElement>(null)
  const auto = useId()
  const base = idBase ?? auto
  const move = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const rtl = getComputedStyle(event.currentTarget).direction === 'rtl'
    const step = { ArrowRight: rtl ? -1 : 1, ArrowLeft: rtl ? 1 : -1 }[
      event.key as 'ArrowRight' | 'ArrowLeft'
    ]
    let next: number
    if (step !== undefined) next = (index + step + items.length) % items.length
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = items.length - 1
    else return
    event.preventDefault()
    const item = items[next]
    if (!item) return
    onChange(item.id)
    list.current
      ?.querySelectorAll<HTMLButtonElement>('[role="tab"]')
      [next]?.focus()
  }
  return (
    <div
      ref={list}
      role="tablist"
      aria-label={label}
      className={cx('qt-tabs', className)}
      data-variant={variant}
    >
      {items.map((item, index) => {
        const selected = item.id === value
        return (
          <button
            key={item.id}
            type="button"
            role="tab"
            id={tabId(base, item.id)}
            aria-selected={selected}
            aria-controls={item.panelId}
            tabIndex={selected ? 0 : -1}
            className="qt-tabs__tab"
            onClick={() => onChange(item.id)}
            onKeyDown={(event) => move(event, index)}
          >
            {item.label}
          </button>
        )
      })}
    </div>
  )
}
