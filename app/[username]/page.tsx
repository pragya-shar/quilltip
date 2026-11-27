import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import { ProfilePageClient } from '@/components/profile/ProfilePageClient'
import {
  getPublicProfile,
  getPublicProfileArticles,
  movedPublicPath,
} from '@/lib/seo/publicContent'
import { parseProfilePage } from '@/lib/profile/profileArticles'
import { parseProfileTab } from '@/lib/profile/profileTab'
import {
  SITE_NAME,
  profilePath,
  toMetaDescription,
} from '@/lib/seo/siteMetadata'

interface ProfilePageProps {
  params: Promise<{
    username: string
  }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

export async function generateMetadata({
  params,
}: ProfilePageProps): Promise<Metadata> {
  const { username } = await params
  const profile = await getPublicProfile(username)
  // Unknown writer (null) or backend unreachable (undefined): site defaults.
  // The page renders not-found.tsx; proxy.ts sets the 404 status.
  if (!profile) return {}

  const displayName = profile.name || profile.username
  const description = toMetaDescription(
    profile.bio?.trim() || `Articles by ${displayName} on ${SITE_NAME}.`
  )
  const url = profilePath(profile.username)
  const images = profile.avatar ? [{ url: profile.avatar }] : undefined

  return {
    title: `${displayName} · ${SITE_NAME}`,
    description,
    alternates: { canonical: url },
    openGraph: {
      type: 'profile',
      siteName: SITE_NAME,
      title: displayName,
      description,
      url,
      images,
      username: profile.username,
    },
    twitter: {
      card: 'summary',
      title: displayName,
      description,
      images: images?.map((image) => image.url),
    },
  }
}

export default async function ProfilePage({
  params,
  searchParams,
}: ProfilePageProps) {
  const { username } = await params
  const query = await searchParams
  const page = parseProfilePage(query.page)
  const onArticlesTab = parseProfileTab(firstValue(query.tab)) === 'articles'
  // Render the writer and their first articles in the HTML. These reads are
  // anonymous, so they show only what any reader can see; the browser then
  // takes over with live queries. `undefined` (backend unreachable) falls back
  // to loading in the browser. Both reads start together, because the page
  // now waits for them before its first byte (#428): the handle lookup is
  // exact, so a found writer has this username, and the articles are dropped
  // when the writer is missing or moved.
  const [profile, articles] = await Promise.all([
    getPublicProfile(username),
    onArticlesTab ? getPublicProfileArticles(username, page) : undefined,
  ])
  if (profile === null) {
    const moved = await movedPublicPath(username, undefined, query)
    // Temporary: writers can switch back to an earlier handle.
    if (moved) redirect(moved)
    notFound()
  }
  const initialArticles = profile ? articles : undefined
  return (
    <ProfilePageClient
      username={username}
      initialProfile={profile}
      initialArticles={initialArticles}
    />
  )
}

function firstValue(value: string | string[] | undefined): string | null {
  return (Array.isArray(value) ? value[0] : value) ?? null
}

export const dynamic = 'force-dynamic'
export const dynamicParams = true
