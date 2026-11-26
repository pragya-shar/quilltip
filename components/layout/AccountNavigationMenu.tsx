'use client'

import { lazy, Suspense, useState } from 'react'
import { cn } from '@/lib/utils'
import { AccountMenuTriggerContent } from './AccountMenuTriggerContent'
import type {
  AccountMenuHandoff,
  AccountNavigationMenuProps,
} from './accountMenu'

export type { AccountMenuUser } from './accountMenu'

const AccountMenuDropdown = lazy(() =>
  import('./AccountMenuDropdown').then((mod) => ({
    default: mod.AccountMenuDropdown,
  }))
)

/**
 * The signed-in writer's menu. The trigger shows their photo (or initial);
 * screen readers hear "Account menu".
 *
 * The dropdown (Radix menu and positioning code) loads only when a signed-in
 * writer's header renders, so it is not part of any page's first load. Until
 * it arrives, the same trigger shows. If it has focus or is pressed in that
 * time, the real trigger takes the focus over and the menu opens as it would
 * have (from the keyboard, with the first item focused).
 */
export function AccountNavigationMenu(props: AccountNavigationMenuProps) {
  const [handoff, setHandoff] = useState<AccountMenuHandoff>({
    focused: false,
    open: null,
  })
  return (
    <Suspense
      fallback={
        <button
          type="button"
          className={cn('app-account-trigger', props.triggerClassName)}
          aria-label="Account menu"
          aria-haspopup="menu"
          aria-expanded={false}
          data-state="closed"
          onFocus={() => setHandoff((h) => ({ ...h, focused: true }))}
          onBlur={() => setHandoff((h) => ({ ...h, focused: false }))}
          onClick={(event) =>
            setHandoff({
              focused: true,
              // A click from Enter or Space has no pointer position (detail 0).
              open: event.detail === 0 ? 'keyboard' : 'pointer',
            })
          }
        >
          <AccountMenuTriggerContent user={props.user} />
        </button>
      }
    >
      <AccountMenuDropdown {...props} handoff={handoff} />
    </Suspense>
  )
}
