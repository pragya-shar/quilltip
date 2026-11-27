import type { Metadata } from 'next'
import { cookies, headers } from 'next/headers'
import '@/components/today/today.css'
import { readToday, todayReadKey } from '@/components/today/data'
import {
  FINISHED_COOKIE,
  parseFinishedCookie,
} from '@/components/today/finished'
import { TodayView } from '@/components/today/TodayView'
import { NONCE_HEADER } from '@/lib/security/contentSecurityPolicy'
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
export default async function TodayPage() {
  const [cookieStore, headerList] = await Promise.all([cookies(), headers()])
  const finished = parseFinishedCookie(cookieStore.get(FINISHED_COOKIE)?.value)
  const data = await readToday(...todayReadKey(Date.now(), finished))
  return (
    <TodayView data={data} nonce={headerList.get(NONCE_HEADER) ?? undefined} />
  )
}
