import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { ProfilePageClient } from '@/components/profile/ProfilePageClient'
import { getPublicProfile } from '@/lib/seo/publicContent'
import {
  SITE_NAME,
  profilePath,
  toMetaDescription,
} from '@/lib/seo/siteMetadata'

interface ProfilePageProps {
  params: Promise<{
    username: string
  }>
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

export default async function ProfilePage({ params }: ProfilePageProps) {
  const { username } = await params
  if ((await getPublicProfile(username)) === null) notFound()
  return <ProfilePageClient username={username} />
}

export const dynamic = 'force-dynamic'
export const dynamicParams = true
