'use client'

import { PushedHeader } from '@/shell/PushedHeader'

/** A task screen's Close: it stores something first (here, a marker in
 * session storage) and never waits past the bound, then leaves. */
export function CloseHeaderDemo({ slow = false }: { slow?: boolean }) {
  return (
    <PushedHeader
      fallbackHref="/shelf"
      backLabel={slow ? 'Close (slow to store)' : 'Close the editor'}
      variant="close"
      onBack={async () => {
        try {
          sessionStorage.setItem('gallery-close', slow ? 'slow' : 'stored')
        } catch {
          // Storage blocked: the demo still leaves.
        }
        if (slow) await new Promise((resolve) => setTimeout(resolve, 5000))
      }}
    />
  )
}
