'use client'

import { useState, type ReactNode } from 'react'
import { firstPage } from './firstPage'

/**
 * A pushed screen: an article, a shared line, a writer's page, search, the
 * editor, You, the line pager. It hides the phone bar (CSS reads the
 * marker, so this works with no script), and it slides in only when it was
 * reached by navigation inside the application, never on a first load:
 * nothing animates in front of public content. Its URL, browser back
 * and the system edge swipe are the browser's own; the place underneath
 * gets its scroll position back on return.
 */
export function PushedScreen({ children }: { children: ReactNode }) {
  // The server and the first render agree (no slide); a screen mounted
  // after the first page reads true and slides in.
  const [arrived] = useState(firstPage.shown)
  return (
    <div className="qt-pushed" data-arrived={arrived || undefined}>
      <span data-shell-chrome="pushed" hidden />
      {children}
    </div>
  )
}
