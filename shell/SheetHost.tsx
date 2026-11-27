'use client'

import { useEffect, useRef } from 'react'
import { usePathname } from 'next/navigation'
import { Sheet } from '@/system/components/Sheet'
import { appHistory } from './appHistory'
import { firstPage } from './firstPage'
import { PocketBody } from './pocket/PocketBody'
import { PocketPanel } from './pocket/PocketPanel'
import { sheetFor } from './sheetRegistry'
import { declaredSheet } from './sheets'
import { LazySheet } from './sheets/LazySheet'
import { sheetStack } from './sheetStack'
import { useSheets } from './useSheets'
import { useWide } from './useWide'

/**
 * Renders the sheet stack, mounted once in the shell beside the content.
 * Each entry stays mounted through its exit animation. On a desktop the
 * Pocket is a right panel instead of a sheet.
 */
export function SheetHost() {
  const entries = useSheets()
  const wide = useWide()
  // Mounted once with the shell: from now on, pages arrive by navigation.
  useEffect(() => firstPage.markShown(), [])
  useEffect(() => {
    const onPop = () => appHistory.popstate()
    window.addEventListener('popstate', onPop, true)
    return () => window.removeEventListener('popstate', onPop, true)
  }, [])
  // A change of path after the first page is an in-app navigation.
  const pathname = usePathname()
  const firstPath = useRef(pathname)
  const lastPath = useRef(pathname)
  useEffect(() => {
    if (pathname !== firstPath.current) firstPage.markNavigated()
    appHistory.arrive(pathname, window.history.length)
    // The place changed: sheets over the old one close.
    if (pathname !== lastPath.current) sheetStack.closeAll()
    lastPath.current = pathname
  }, [pathname])
  return (
    <>
      {entries.map((entry) => {
        const close = () => sheetStack.close(entry.id)
        switch (entry.id) {
          case 'pocket':
            return wide ? (
              <PocketPanel key={entry.key} open={entry.open} onClose={close} />
            ) : (
              <Sheet
                key={entry.key}
                open={entry.open}
                onClose={close}
                title="Balance"
              >
                <PocketBody />
              </Sheet>
            )
          default: {
            // A sheet registered by loaded code, else one declared to load
            // on demand (shell/sheets), else nothing.
            const Registered = sheetFor(entry.id)
            if (Registered)
              return (
                <Registered
                  key={entry.key}
                  open={entry.open}
                  onClose={close}
                  props={entry.props}
                />
              )
            return declaredSheet(entry.id) ? (
              <LazySheet
                key={entry.key}
                id={entry.id}
                open={entry.open}
                onClose={close}
                props={entry.props}
              />
            ) : null
          }
        }
      })}
    </>
  )
}
