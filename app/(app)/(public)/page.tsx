import type { Metadata } from 'next'
import { cookies, headers } from 'next/headers'
import '@/components/today/today.css'
import { readToday } from '@/components/today/data'
import {
  FINISHED_COOKIE,
  OPENED_COOKIE,
  skipList,
} from '@/components/today/finished'
import { TodayView } from '@/components/today/TodayView'
import { NONCE_HEADER } from '@/lib/security/contentSecurityPolicy'
import { retryHrefFor } from '@/shell/public/boundedRead'
import { SITE_NAME } from '@/lib/seo/siteMetadata'

const DESCRIPTION =
  'Read writing you can tip, down to the sentence. Today opens on an article already underway.'

// Static, so nothing about the page's head waits or streams. When the read
// does not answer, the view adds its own robots noindex tag (D21).
export const metadata: Metadata = {
  title: { absolute: SITE_NAME },
  description: DESCRIPTION,
  alternates: { canonical: '/' },
  openGraph: {
    type: 'website',
    url: '/',
    siteName: SITE_NAME,
    title: SITE_NAME,
    description: DESCRIPTION,
  },
  twitter: { card: 'summary', title: SITE_NAME, description: DESCRIPTION },
}

/**
 * Today (`/`): an article already underway, in the first response (D19,
 * D20). No loading.tsx and no Suspense above it: the page waits for the
 * opening for at most the public read limit (D21), then renders the
 * unreachable state, and streams nothing that only a script reveals.
 */
export default async function TodayPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const [cookieStore, headerList] = await Promise.all([cookies(), headers()])
  // Articles this browser opened or finished (D22), validated: ids only.
  const skip = skipList(
    cookieStore.get(FINISHED_COOKIE)?.value,
    cookieStore.get(OPENED_COOKIE)?.value
  )
  const data = await readToday(Date.now(), skip)
  return (
    <TodayView
      data={data}
      nonce={headerList.get(NONCE_HEADER) ?? undefined}
      retryHref={retryHrefFor('/', await searchParams)}
    />
  )
}
