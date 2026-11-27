'use client'

import { useEffect, useRef, type ReactNode } from 'react'
import { Button } from '@/system/components/Button'
import { Icon } from '@/system/components/Icon'
import { Spinner } from '@/system/components/Spinner'
import { DoneIcon, FailIcon } from '@/system/icons'
import { focusDestination } from '@/system/inputModality'
import type { MoneyAct } from './source'

/**
 * The working part of a money sheet. With no act (the backend does not have
 * it yet), `unbuilt` says what will be possible and there is no button.
 * With one: its labelled button; once started, its status; then its result
 * or the reason it failed. Focus follows (system/README.md, rule 5): to the
 * status when it starts, to the result when it ends, read once by focus.
 */
export function MoneyActPanel({
  act,
  unbuilt,
  onDone,
}: {
  act: MoneyAct | null
  unbuilt: ReactNode
  onDone: () => void
}) {
  const message = useRef<HTMLParagraphElement>(null)
  const phase = act?.state.phase ?? 'none'
  useEffect(() => {
    if (phase === 'working' || phase === 'done' || phase === 'failed')
      focusDestination(message.current)
  }, [phase])
  if (!act) return <div className="qt-pocket__unbuilt">{unbuilt}</div>
  const state = act.state
  return (
    <div className="qt-pocket__act" data-phase={state.phase}>
      {state.phase === 'idle' ? (
        <Button variant="primary" size="l" block onClick={act.start}>
          {act.label}
        </Button>
      ) : (
        <p className="qt-pocket__act-message" ref={message} tabIndex={-1}>
          {state.phase === 'working' ? (
            <Spinner />
          ) : (
            <Icon
              icon={state.phase === 'done' ? DoneIcon : FailIcon}
              size={20}
            />
          )}
          <span>
            {state.phase === 'working'
              ? state.status
              : state.phase === 'done'
                ? state.result
                : state.reason}
          </span>
        </p>
      )}
      {state.phase === 'done' ? (
        <Button variant="secondary" block onClick={onDone}>
          Done
        </Button>
      ) : state.phase === 'failed' ? (
        <Button variant="secondary" block onClick={act.reset}>
          Try again
        </Button>
      ) : null}
    </div>
  )
}
