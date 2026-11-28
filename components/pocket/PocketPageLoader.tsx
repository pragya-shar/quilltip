'use client'

import { useCallback, useEffect, useState, type ComponentType } from 'react'
import { Button } from '@/system/components/Button'
import { Notice } from '@/system/components/Notice'
import { PocketPlaceholder } from './PocketPlaceholder'

/**
 * The balance on /pocket, loaded after the page has rendered: the server
 * HTML holds its placeholder (the same space it shows while auth loads),
 * and the balance and the money layer behind it load with import(), so no
 * payments code beyond the store is in the page's first load. A failed
 * load says so, with Try again.
 */
export function PocketPageLoader() {
  const [Page, setPage] = useState<ComponentType | null>(null)
  const [failed, setFailed] = useState(false)
  const load = useCallback(() => {
    setFailed(false)
    import('./PocketPage').then(
      (module) => setPage(() => module.PocketPage),
      () => setFailed(true)
    )
  }, [])
  useEffect(() => load(), [load])
  if (Page) return <Page />
  if (failed)
    return (
      <Notice
        tone="info"
        title="The balance did not load"
        action={
          <Button variant="quiet" onClick={load}>
            Try again
          </Button>
        }
      >
        Your money is safe. Reading works as usual.
      </Notice>
    )
  return <PocketPlaceholder />
}
