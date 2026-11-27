'use client'

import { Archive } from 'lucide-react'
import { ArweaveStatus } from '@/components/articles/ArweaveStatus'
import { DetailsSection } from '@/components/articles/DetailsSection'
import { isArweaveStatus } from '@/lib/arweave/types'

/**
 * The "Permanent Storage" section of the article details. It renders only for
 * a status the panel can describe, so no heading shows over an empty section.
 */
export function ArticleStorageSection({
  status,
  txId,
  url,
  timestamp,
}: {
  status?: string | null
  txId?: string | null
  url?: string | null
  timestamp?: number | null
}) {
  if (!isArweaveStatus(status)) return null
  return (
    <DetailsSection>
      <h4 className="reader-section-title">
        <Archive className="w-4 h-4 text-muted-foreground" />
        Permanent Storage
      </h4>
      <ArweaveStatus
        status={status}
        txId={txId ?? undefined}
        url={url ?? undefined}
        timestamp={timestamp ?? undefined}
      />
    </DetailsSection>
  )
}
