'use client'

import { useEffect } from 'react'
import { Sheet } from '@/system/components/Sheet'
import { firstPage } from './firstPage'
import { PocketContent } from './pocket/PocketContent'
import { PocketPanel } from './pocket/PocketPanel'
import { sheetFor } from './sheetRegistry'
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
                hideTitle
              >
                <PocketContent />
              </Sheet>
            )
          default: {
            const Registered = sheetFor(entry.id)
            return Registered ? (
              <Registered
                key={entry.key}
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
