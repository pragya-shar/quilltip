'use client'

import { useUserByUsername } from '@/hooks/convex'
import { useEffect } from 'react'
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
import { ReadingUnavailable } from '@/components/articles/ReadingUnavailable'
import { ProfileNftsTabContent } from '@/components/profile/ProfileNftsTabContent'
import { AuthorNotFoundPage } from '@/components/profile/AuthorNotFoundPage'
import { ProfilePageLoadingSkeleton } from '@/components/profile/ProfilePageLoadingSkeleton'
import Link from 'next/link'
import { CollectionShell } from '@/components/library/CollectionShell'
import { HandleSetupBanner } from '@/components/profile/HandleSetupBanner'
import { UserAvatar } from '@/components/ui/user-avatar'
import { isGeneratedHandle } from '@/lib/profile/handleRules'
import {
  parseProfilePage,
  type ProfileArticlesPage,
} from '@/lib/profile/profileArticles'
import { SETTINGS_PATH } from '@/lib/navigation/siteNavigation'
import type { FunctionReturnType } from 'convex/server'
import type { api } from '@/convex/_generated/api'
import { Skeleton } from '@/components/ui/skeleton'
import '@/components/library/library.css'
import '@/components/articles/reading-room.css'
import '@/components/profile/public-profile.css'
import { NorthEastArrow } from '@/components/ui/NorthEastArrow'

export type PublicProfile = FunctionReturnType<
  typeof api.users.getUserByUsername
>

export function ProfilePageClient({
  username,
  initialProfile,
  initialArticles,
  unavailableRetryHref,
}: {
  username: string
  /** From the server render; undefined when the backend was unreachable. */
  initialProfile?: PublicProfile
  initialArticles?: ProfileArticlesPage
  /**
   * Set when the server could not read the writer or their articles in time:
   * until the live query answers, that part shows a fallback that reads
   * without scripts.
   */
  unavailableRetryHref?: string
}) {
  const pathname = usePathname()
  const router = useRouter()
  const searchParams = useSearchParams()
  const { user: currentUser, isLoading: authLoading } = useAuth()
  const page = parseProfilePage(searchParams?.get('page') ?? null)
  const nftOwnedPage = parseProfilePage(
    searchParams?.get('nftOwnedPage') ?? null
  )
  const nftMintedPage = parseProfilePage(
    searchParams?.get('nftMintedPage') ?? null
  )

  // Live results replace the server-rendered profile as soon as they arrive.
  const liveUser = useUserByUsername(username)
  const user = liveUser === undefined ? initialProfile : liveUser
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

  // The page renders without waiting for sign-in; own-profile actions appear
  // once auth resolves.
  // The server could not read the writer in time. Outside LoadingRegion,
  // which hides its fallback from assistive technology.
  if (user === undefined && unavailableRetryHref) {
    const unavailable = (
      <ReadingUnavailable
        what="This writer’s page"
        retryHref={unavailableRetryHref}
        headingLevel={1}
      />
    )
    return activeTab === 'nfts' ? (
      <div className="profile-page min-h-screen">
        <AppNavigation />
        {unavailable}
      </div>
    ) : (
      <CollectionShell>{unavailable}</CollectionShell>
    )
  }

  if (user === undefined) {
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
        {/* Own-profile actions appear once sign-in resolves. The row keeps its
            height for every visitor so the server-rendered page does not move. */}
        <div className="writer-eyebrow-row">
          <span className="eyebrow">Writer</span>
          {isOwnProfile && (
            <Link className="writer-edit" href={SETTINGS_PATH}>
              Edit profile
            </Link>
          )}
        </div>
        <div className="writer-identity">
          <UserAvatar
            src={user.avatar}
            alt=""
            name={profileDisplayName}
            className="writer-avatar"
            fallbackClassName="writer-avatar-fallback"
          />
          <h1>{profileDisplayName}</h1>
        </div>
        {user.bio?.trim() && <p className="writer-biography">{user.bio}</p>}
        <h2>Articles</h2>
        <ProfileArticlesTabContent
          key={user._id}
          username={user.username}
          page={page}
          isOwnProfile={isOwnProfile}
          displayName={profileDisplayName}
          initialData={initialArticles}
          unavailableRetryHref={unavailableRetryHref}
        />
        <Link className="library-browse" href={`/${user.username}?tab=nfts`}>
          NFT collection <NorthEastArrow />
        </Link>
        {/* Fixed to the viewport, so it does not push the page down. */}
        {isOwnProfile && isGeneratedHandle(user.username) && (
          <HandleSetupBanner userId={user._id} />
        )}
      </main>
    </CollectionShell>
  )
}
