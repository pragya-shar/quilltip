'use client'

import { useState } from 'react'
import Link from 'next/link'
import { X } from 'lucide-react'
import { SETTINGS_PATH } from '@/lib/navigation/siteNavigation'

const storageKey = (userId: string) =>
  `quilltip:handle-banner-dismissed:${userId}`

function readDismissed(userId: string) {
  try {
    return window.sessionStorage.getItem(storageKey(userId)) === '1'
  } catch {
    return false
  }
}

/**
 * On a writer's own page while they still have the handle Quilltip generated.
 * Dismissing hides it for this browser session; it returns until they choose.
 */
export function HandleSetupBanner({ userId }: { userId: string }) {
  const [dismissed, setDismissed] = useState(() => readDismissed(userId))
  if (dismissed) return null
  return (
    <aside className="handle-banner" aria-labelledby="handle-banner-title">
      <div>
        <p id="handle-banner-title" className="handle-banner-title">
          Choose a handle so readers can find you
        </p>
        <p className="handle-banner-text">
          Your link is still the one we generated. Pick a handle you can share.
        </p>
      </div>
      <Link className="handle-banner-action" href={SETTINGS_PATH}>
        Choose a handle
      </Link>
      <button
        type="button"
        className="handle-banner-dismiss"
        aria-label="Dismiss handle reminder"
        onClick={() => {
          try {
            window.sessionStorage.setItem(storageKey(userId), '1')
          } catch {
            // Storage can be blocked; hiding for this page view is enough.
          }
          setDismissed(true)
        }}
      >
        <X size={18} aria-hidden />
      </button>
    </aside>
  )
}
