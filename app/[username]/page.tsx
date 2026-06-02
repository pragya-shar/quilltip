'use client'

import { useUserByUsername, useUserStats } from '@/hooks/convex'
import { use, useState, useEffect } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import {
  buildProfileTabHref,
  parseProfileTab,
  profileTabUrlIsCanonical,
  type ProfileTabId,
} from '@/lib/profile/profileTab'
import { useAuth } from '@/components/providers/AuthContext'
import AppNavigation from '@/components/layout/AppNavigation'
import { SiteFooter } from '@/components/layout/SiteFooter'
import ProfileHeader from '@/components/profile/ProfileHeader'
import { ProfileTabBar } from '@/components/profile/ProfileTabBar'
import { ProfileArticlesTabContent } from '@/components/profile/ProfileArticlesTabContent'
import { ProfileNftsTabContent } from '@/components/profile/ProfileNftsTabContent'
import { AuthorNotFoundPage } from '@/components/profile/AuthorNotFoundPage'
import { ProfilePageLoadingSkeleton } from '@/components/profile/ProfilePageLoadingSkeleton'
import { EarningsDashboard } from '@/components/dashboard/EarningsDashboard'
import { WalletSettings } from '@/components/stellar'
import { BookOpen, DollarSign, Image, ChartBar, Wallet } from 'lucide-react'

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
  const [localWalletAddress, setLocalWalletAddress] = useState<
    string | null | undefined
  >()
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

  // Fetch user profile
  const user = useUserByUsername(username)

  // Sync local wallet address with user data
  useEffect(() => {
    if (user?.stellarAddress !== localWalletAddress) {
      setLocalWalletAddress(user?.stellarAddress)
    }
  }, [user?.stellarAddress, localWalletAddress])

  // Fetch user stats
  const userStats = useUserStats(user?._id)

  // Check if this is the current user's profile
  const isOwnProfile = currentUser?.username === username
  const rawTab = searchParams?.get('tab') ?? null
  const activeTab = parseProfileTab(rawTab, authLoading ? false : isOwnProfile)

  useEffect(() => {
    if (authLoading) return
    if (profileTabUrlIsCanonical(rawTab, isOwnProfile)) return
    router.replace(
      buildProfileTabHref(
        pathname,
        new URLSearchParams(searchParams?.toString() ?? ''),
        parseProfileTab(rawTab, isOwnProfile)
      )
    )
  }, [authLoading, isOwnProfile, pathname, rawTab, router, searchParams])

  if (user === null) {
    return <AuthorNotFoundPage username={username} />
  }

  // Show loading while data is being fetched
  if (!user) {
    return (
      <div className="min-h-screen bg-background">
        <AppNavigation />
        <ProfilePageLoadingSkeleton />
      </div>
    )
  }

  const profileDisplayName = user.name || user.username

  // Prepare user data with stats
  const userWithStats = {
    id: user._id,
    username: user.username,
    name: user.name,
    bio: user.bio,
    avatar: user.avatar,
    createdAt: new Date(user.createdAt),
    articleCount: userStats?.articleCount || 0,
    totalEarnings: userStats?.totalEarnings || 0,
    tipsReceivedCount: userStats?.tipsReceivedCount || 0,
    nftsOwned: user.nftsOwned || 0,
    nftsCreated: user.nftsCreated || 0,
  }

  // Tab configuration
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
    {
      id: 'wallet' as ProfileTabId,
      label: 'Wallet',
      icon: Wallet,
      count: null,
    },
    ...(isOwnProfile
      ? [
          {
            id: 'earnings' as ProfileTabId,
            label: 'Earnings',
            icon: DollarSign,
            count: null,
          },
          {
            id: 'stats' as ProfileTabId,
            label: 'Stats',
            icon: ChartBar,
            count: null,
          },
        ]
      : []),
  ]

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <AppNavigation />

      <main className="flex-1 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-24 pb-12 w-full min-w-0">
        {/* Profile Header */}
        <div className="mb-8">
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

        {/* Tab Content */}
        <div>
          {/* Articles Tab */}
          {activeTab === 'articles' && (
            <div>
              <ProfileArticlesTabContent
                username={username}
                page={page}
                basePath={`/${username}`}
                isOwnProfile={isOwnProfile}
                displayName={profileDisplayName}
              />
            </div>
          )}

          {/* NFTs Tab */}
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

          {/* Earnings Tab (Only for own profile) */}
          {activeTab === 'earnings' && isOwnProfile && (
            <div>
              <EarningsDashboard />
            </div>
          )}

          {/* Stats Tab (Only for own profile) */}
          {activeTab === 'stats' && isOwnProfile && (
            <div className="space-y-6">
              {/* Overall Stats */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="bg-card rounded-lg shadow-[var(--card-shadow)] border border-border p-6">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-muted-foreground">
                      Total Articles
                    </span>
                    <BookOpen className="w-5 h-5 text-blue-500" />
                  </div>
                  <p className="text-3xl font-bold text-foreground">
                    {userWithStats.articleCount}
                  </p>
                </div>
                <div className="bg-card rounded-lg shadow-[var(--card-shadow)] border border-border p-6">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-muted-foreground">Tips Received</span>
                    <DollarSign className="w-5 h-5 text-green-500" />
                  </div>
                  <p className="text-3xl font-bold text-foreground">
                    {userWithStats.tipsReceivedCount}
                  </p>
                </div>
                <div className="bg-card rounded-lg shadow-[var(--card-shadow)] border border-border p-6">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-muted-foreground">NFTs Owned</span>
                    <Image
                      className="w-5 h-5 text-purple-500"
                      aria-label="NFTs"
                    />
                  </div>
                  <p className="text-3xl font-bold text-foreground">
                    {userWithStats.nftsOwned}
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Wallet Tab */}
          {activeTab === 'wallet' && (
            <div className="space-y-8">
              {/* Page Header */}
              <div className="mb-6">
                <h2 className="text-2xl font-bold text-foreground mb-2">
                  {isOwnProfile
                    ? 'Wallet Management'
                    : `${profileDisplayName}'s Wallet`}
                </h2>
                <p className="text-muted-foreground">
                  {isOwnProfile
                    ? 'Manage your Stellar testnet wallet for sending and receiving practice tips.'
                    : 'View and copy the wallet address, or tip this author from their articles.'}
                </p>
              </div>

              {/* Wallet Settings */}
              <div className="max-w-2xl">
                <WalletSettings
                  walletAddress={localWalletAddress ?? user.stellarAddress}
                  profileUsername={username}
                  isOwnProfile={isOwnProfile}
                  profileDisplayName={profileDisplayName}
                  onAddressChange={(address) => {
                    // Immediately update local state for instant UI feedback
                    setLocalWalletAddress(address || undefined)
                  }}
                />
              </div>
            </div>
          )}
        </div>
      </main>
      <SiteFooter variant="default" />
    </div>
  )
}

// Configure dynamic behavior
export const dynamic = 'force-dynamic'
export const dynamicParams = true
