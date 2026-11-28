'use client'

import { useEffect, useRef, useState } from 'react'
import { DoneIcon, FailIcon, InfoIcon } from '../icons'
import { dismissToast, toastDuration, type ToastItem } from '../toast'
import { Icon } from './Icon'

const GLYPH = { done: DoneIcon, failure: FailIcon, info: InfoIcon }

/**
 * One toast. It leaves on its own. Every tap passes through the card to
 * what is under it, except on its one action; focus on the action pauses
 * it (keyboard and screen reader), and so does a pointer resting on it.
 */
export function Toast({ item }: { item: ToastItem }) {
  const [paused, setPaused] = useState(false)
  const left = useRef(toastDuration(item))
  useEffect(() => {
    if (paused) return
    const started = Date.now()
    const id = window.setTimeout(() => dismissToast(item.id), left.current)
    return () => {
      window.clearTimeout(id)
      left.current -= Date.now() - started
    }
  }, [paused, item.id])
  return (
    <div
      className="qt-toast"
      data-tone={item.tone}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      <span className="qt-toast__glyph" aria-hidden="true">
        <Icon icon={GLYPH[item.tone]} size={20} />
      </span>
      <div className="qt-toast__text">
        <p className="qt-toast__title">{item.title}</p>
        {item.description ? (
          <p className="qt-toast__description">{item.description}</p>
        ) : null}
      </div>
      {item.action ? (
        <button
          type="button"
          className="qt-toast__action"
          onPointerEnter={() => setPaused(true)}
          onPointerLeave={() => setPaused(false)}
          onClick={() => {
            item.action?.onAction()
            dismissToast(item.id)
          }}
        >
          {item.action.label}
        </button>
      ) : null}
    </div>
  )
}
