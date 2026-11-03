'use client'

import { useUserByUsername } from '@/hooks/convex'
import { use, useEffect } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { LoadingRegion } from '@/components/a11y/LoadingRegion'
import { useStaleLoading } from '@/hooks/useStaleLoading'
import {
  buildProfileTabHref,
  isLegacyCreatorTab,
  parseProfileTab,
  profileTabUrlIsCanonical,
} from '@/lib/profile/profileTab'
import {
  getDashboardTabPath,
  parseLegacyProfileCreatorTab,
} from '@/lib/dashboard/dashboardTab'
import { useAuth } from '@/components/providers/AuthContext'
import AppNavigation from '@/components/layout/AppNavigation'
import { SiteFooter } from '@/components/layout/SiteFooter'
import ProfileHeader from '@/components/profile/ProfileHeader'
import { ProfileArticlesTabContent } from '@/components/profile/ProfileArticlesTabContent'
import { ProfileNftsTabContent } from '@/components/profile/ProfileNftsTabContent'
import { AuthorNotFoundPage } from '@/components/profile/AuthorNotFoundPage'
import { ProfilePageLoadingSkeleton } from '@/components/profile/ProfilePageLoadingSkeleton'
import Link from 'next/link'
import { CollectionShell } from '@/components/library/CollectionShell'
import { Skeleton } from '@/components/ui/skeleton'
import '@/components/library/library.css'
import '@/components/articles/reading-room.css'
import '@/components/profile/public-profile.css'

interface ProfilePageProps {
  params: Promise<{
    username: string
  }>
}

export default function ProfilePage({ params }: ProfilePageProps) {
  const { username } = use(params)
  const pathname = usePathname()
  const router = useRouter()
  const searchParams = useSearchParams()
  const { user: currentUser, isLoading: authLoading } = useAuth()
  const parsePositivePage = (raw: string | null) => {
    const n = parseInt(raw || '1', 10)
    return Number.isSafeInteger(n) && n >= 1 ? n : 1
  }
  const page = parsePositivePage(searchParams?.get('page') ?? null)
  const nftOwnedPage = parsePositivePage(
    searchParams?.get('nftOwnedPage') ?? null
  )
  const nftMintedPage = parsePositivePage(
    searchParams?.get('nftMintedPage') ?? null
  )

  const user = useUserByUsername(username)
  const { isStale, reset: resetStale } = useStaleLoading(user === undefined)

  const profilePending = user === undefined
  const isOwnProfile = Boolean(user && currentUser?._id === user._id)
  const rawTab = searchParams?.get('tab') ?? null
  const activeTab = parseProfileTab(rawTab)

  useEffect(() => {
    if (authLoading || profilePending) return

    const legacyTab = parseLegacyProfileCreatorTab(rawTab)
    if (legacyTab) {
      if (isOwnProfile) {
        router.replace(getDashboardTabPath(legacyTab))
      } else {
        router.replace(
          buildProfileTabHref(
            pathname,
            new URLSearchParams(searchParams?.toString() ?? ''),
            'articles'
          )
        )
      }
      return
    }

    if (profileTabUrlIsCanonical(rawTab)) return
    router.replace(
      buildProfileTabHref(
        pathname,
        new URLSearchParams(searchParams?.toString() ?? ''),
        parseProfileTab(rawTab)
      )
    )
  }, [
    authLoading,
    isOwnProfile,
    pathname,
    profilePending,
    rawTab,
    router,
    searchParams,
  ])

  if (user === null) {
    return <AuthorNotFoundPage username={username} />
  }

  if (authLoading || user === undefined) {
    const loading = (
      <LoadingRegion
        label="profile"
        isLoading
        isStale={isStale}
        onRetry={() => {
          resetStale()
          router.refresh()
        }}
        fallback={
          activeTab === 'nfts' ? (
            <ProfilePageLoadingSkeleton />
          ) : (
            <main className="collection-page" aria-hidden>
              <Skeleton className="mt-12 h-5 w-20" />
              <Skeleton className="mt-5 h-14 w-72 max-w-full" />
              <Skeleton className="mt-5 h-5 w-full max-w-xl" />
              <Skeleton className="mt-12 h-24 w-full" />
            </main>
          )
        }
      >
        <div />
      </LoadingRegion>
    )

    return activeTab === 'nfts' ? (
      <div className="profile-page min-h-screen">
        <AppNavigation />
        {loading}
      </div>
    ) : (
      <CollectionShell>{loading}</CollectionShell>
    )
  }

  if (isLegacyCreatorTab(rawTab)) {
    return null
  }

  const profileDisplayName = user.name || user.username

  if (activeTab === 'nfts') {
    return (
      <div className="profile-page flex min-h-screen flex-col">
        <AppNavigation />
        <main className="profile-folio flex-1">
          <Link className="profile-action" href={`/${user.username}`}>
            ← Writer page
          </Link>
          <ProfileHeader user={user} isOwnProfile={isOwnProfile} />
          <ProfileNftsTabContent
            key={user._id}
            userId={user._id}
            username={user.username}
            nftOwnedPage={nftOwnedPage}
            nftMintedPage={nftMintedPage}
            isOwnProfile={isOwnProfile}
            displayName={profileDisplayName}
          />
        </main>
        <SiteFooter variant="default" />
      </div>
    )
  }

  return (
    <CollectionShell>
      <main className="collection-page writer-collection">
        <Link className="back" href="/articles">
          ← Articles
        </Link>
        <span className="eyebrow">Writer</span>
        <h1>{profileDisplayName}</h1>
        {user.bio?.trim() && <p className="writer-biography">{user.bio}</p>}
        <h2>Articles</h2>
        <ProfileArticlesTabContent
          key={user._id}
          username={user.username}
          page={page}
          isOwnProfile={isOwnProfile}
          displayName={profileDisplayName}
        />
        <Link className="library-browse" href={`/${user.username}?tab=nfts`}>
          {isOwnProfile ? 'Profile photo and NFT collection' : 'NFT collection'}{' '}
          ↗
        </Link>
      </main>
    </CollectionShell>
  )
}

export const dynamic = 'force-dynamic'
export const dynamicParams = true
