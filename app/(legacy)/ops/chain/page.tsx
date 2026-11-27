import type { Metadata } from 'next'
import '@/components/account/account.css'
import '@/components/ops/ops.css'
import { ChainIndexerStatusPage } from '@/components/ops/ChainIndexerStatusPage'
import { SITE_NAME } from '@/lib/seo/siteMetadata'

export const metadata: Metadata = {
  title: `Chain indexer · ${SITE_NAME}`,
  robots: { index: false, follow: false },
}

export default ChainIndexerStatusPage
