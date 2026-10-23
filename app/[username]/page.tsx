'use client'

import { useUserByUsername, useUserStats } from '@/hooks/convex'
import { use, useEffect } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { LoadingRegion } from '@/components/a11y/LoadingRegion'
import { useStaleLoading } from '@/hooks/useStaleLoading'
import {
  buildProfileTabHref,
  isLegacyCreatorTab,
  parseProfileTab,
  profileTabUrlIsCanonical,
  type ProfileTabId,
} from '@/lib/profile/profileTab'
import {
  getDashboardTabPath,
  parseLegacyProfileCreatorTab,
} from '@/lib/dashboard/dashboardTab'
import { useAuth } from '@/components/providers/AuthContext'
import AppNavigation from '@/components/layout/AppNavigation'
import { SiteFooter } from '@/components/layout/SiteFooter'
import ProfileHeader from '@/components/profile/ProfileHeader'
import { ProfileTabBar } from '@/components/profile/ProfileTabBar'
import { ProfileArticlesTabContent } from '@/components/profile/ProfileArticlesTabContent'
import { ProfileNftsTabContent } from '@/components/profile/ProfileNftsTabContent'
import { AuthorNotFoundPage } from '@/components/profile/AuthorNotFoundPage'
import { ProfilePageLoadingSkeleton } from '@/components/profile/ProfilePageLoadingSkeleton'
import { BookOpen, Image } from 'lucide-react'
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
  const page = Math.max(parseInt(searchParams?.get('page') || '1', 10) || 1, 1)
  const parsePositivePage = (raw: string | null) => {
    const n = parseInt(raw || '1', 10)
    return Number.isFinite(n) && n >= 1 ? n : 1
  }
  const nftOwnedPage = parsePositivePage(
    searchParams?.get('nftOwnedPage') ?? null
  )
  const nftMintedPage = parsePositivePage(
    searchParams?.get('nftMintedPage') ?? null
  )

  const user = useUserByUsername(username)
  const { isStale, reset: resetStale } = useStaleLoading(user === undefined)

  const userStats = useUserStats(user?._id)

  const isOwnProfile = currentUser?.username === username
  const rawTab = searchParams?.get('tab') ?? null
  const activeTab = parseProfileTab(rawTab)

  useEffect(() => {
    if (authLoading) return

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
  }, [authLoading, isOwnProfile, pathname, rawTab, router, searchParams])

  if (user === null) {
    return <AuthorNotFoundPage username={username} />
  }

  if (authLoading || user === undefined) {
    return (
      <div className="profile-page min-h-screen">
        <AppNavigation />
        <LoadingRegion
          label="profile"
          isLoading
          isStale={isStale}
          onRetry={() => {
            resetStale()
            router.refresh()
          }}
          fallback={<ProfilePageLoadingSkeleton />}
        >
          <div />
        </LoadingRegion>
      </div>
    )
  }

  if (!authLoading && isLegacyCreatorTab(rawTab)) {
    return null
  }

  const profileDisplayName = user.name || user.username

  const userWithStats = {
    id: user._id,
    username: user.username,
    name: user.name,
    bio: user.bio,
    avatar: user.avatar,
    createdAt: new Date(user.createdAt),
    articleCount: userStats?.articleCount ?? null,
    totalEarnings: userStats?.totalEarnings || 0,
    tipsReceivedCount: userStats?.tipsReceivedCount || 0,
    nftsOwned: user.nftsOwned || 0,
    nftsCreated: user.nftsCreated || 0,
  }

  const tabs = [
    {
      id: 'articles' as ProfileTabId,
      label: 'Articles',
      icon: BookOpen,
      count: userWithStats.articleCount,
    },
    {
      id: 'nfts' as ProfileTabId,
      label: 'NFTs',
      icon: Image,
      count: userWithStats.nftsOwned,
    },
  ]

  return (
    <div className="profile-page flex min-h-screen flex-col">
      <AppNavigation />

      <main className="profile-folio flex-1">
        <div>
          <ProfileHeader user={userWithStats} isOwnProfile={isOwnProfile} />
        </div>

        <ProfileTabBar
          tabs={tabs}
          activeTab={activeTab}
          getHref={(tabId) =>
            buildProfileTabHref(
              pathname,
              new URLSearchParams(searchParams?.toString() ?? ''),
              tabId
            )
          }
        />

        <div>
          {activeTab === 'articles' && (
            <div>
              <ProfileArticlesTabContent
                key={username}
                username={username}
                page={page}
                basePath={`/${username}`}
                isOwnProfile={isOwnProfile}
                displayName={profileDisplayName}
              />
            </div>
          )}

          {activeTab === 'nfts' && (
            <ProfileNftsTabContent
              userId={user._id}
              username={username}
              nftOwnedPage={nftOwnedPage}
              nftMintedPage={nftMintedPage}
              isOwnProfile={isOwnProfile}
              displayName={profileDisplayName}
            />
          )}
        </div>
      </main>
      <SiteFooter variant="default" />
    </div>
  )
}

export const dynamic = 'force-dynamic'
export const dynamicParams = true
