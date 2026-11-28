import type { Metadata } from 'next'
import { EmptyState } from '@/system/components/EmptyState'
import { Heading } from '@/system/components/Heading'
import { ShelfIcon } from '@/system/icons'

export const metadata: Metadata = {
  title: 'Shelf',
  robots: { index: false, follow: false },
}

/**
 * The Shelf place: reading, lines you tipped, lines you kept. A placeholder
 * until the Shelf surface replaces this page (and deletes /library).
 */
export default function ShelfPage() {
  return (
    <div className="qt-page qt-placeholder">
      <Heading level={1} variant="title">
        Shelf
      </Heading>
      <EmptyState
        icon={ShelfIcon}
        title="What you read, tip and keep shows up here."
      />
    </div>
  )
}
