'use client'

import { notFound } from 'next/navigation'
import { useUserByUsername, useUserStats } from '@/hooks/convex'
import { use, useState, useEffect } from 'react'
import { useSearchParams } from 'next/navigation'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/components/providers/AuthContext'
import AppNavigation from '@/components/layout/AppNavigation'
import { SiteFooter } from '@/components/layout/SiteFooter'
import ProfileHeader from '@/components/profile/ProfileHeader'
import { ProfileArticlesTabContent } from '@/components/profile/ProfileArticlesTabContent'
import { ProfileNftsTabContent } from '@/components/profile/ProfileNftsTabContent'
import { ProfilePageLoadingSkeleton } from '@/components/profile/ProfilePageLoadingSkeleton'
import { EarningsDashboard } from '@/components/dashboard/EarningsDashboard'
import { WalletSettings } from '@/components/stellar'
import { BookOpen, DollarSign, Image, ChartBar, Wallet } from 'lucide-react'

interface ProfilePageProps {
  params: Promise<{
    username: string
  }>
}

type TabType = 'articles' | 'nfts' | 'earnings' | 'stats' | 'wallet'

export default function ProfilePage({ params }: ProfilePageProps) {
  const { username } = use(params)
  const searchParams = useSearchParams()
  const router = useRouter()
  const { user: currentUser } = useAuth()
  const [activeTab, setActiveTab] = useState<TabType>('articles')
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

  const tabParamRaw = searchParams?.get('tab')
  const tabParam: TabType | null =
    tabParamRaw === 'articles' ||
    tabParamRaw === 'nfts' ||
    tabParamRaw === 'earnings' ||
    tabParamRaw === 'stats' ||
    tabParamRaw === 'wallet'
      ? tabParamRaw
      : null

  // Fetch user profile
  const user = useUserByUsername(username)

  const updateTabInUrl = (tab: TabType) => {
    const next = new URLSearchParams(searchParams?.toString())
    next.set('tab', tab)
    router.replace(`/${username}?${next.toString()}`, { scroll: false })
  }

  const handleTabClick = (tab: TabType) => {
    setActiveTab(tab)
    updateTabInUrl(tab)
  }

  // Sync local wallet address with user data
  useEffect(() => {
    if (user?.stellarAddress !== localWalletAddress) {
      setLocalWalletAddress(user?.stellarAddress)
    }
  }, [user?.stellarAddress, localWalletAddress])

  // Sync active tab from URL param
  useEffect(() => {
    if (tabParam && tabParam !== activeTab) {
      setActiveTab(tabParam)
    }
  }, [tabParam, activeTab])

  // Fetch user stats
  const userStats = useUserStats(user?._id)

  // Check if this is the current user's profile
  const isOwnProfile = currentUser?.username === username

  // Check if user exists
  if (user === null) {
    notFound()
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
      id: 'articles' as TabType,
      label: 'Articles',
      icon: BookOpen,
      count: userWithStats.articleCount,
    },
    {
      id: 'nfts' as TabType,
      label: 'NFTs',
      icon: Image,
      count: userWithStats.nftsOwned,
    },
    { id: 'wallet' as TabType, label: 'Wallet', icon: Wallet, count: null },
    ...(isOwnProfile
      ? [
          {
            id: 'earnings' as TabType,
            label: 'Earnings',
            icon: DollarSign,
            count: null,
          },
          {
            id: 'stats' as TabType,
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

      <main className="flex-1 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-24 pb-12 w-full">
        {/* Profile Header */}
        <div className="mb-8">
          <ProfileHeader user={userWithStats} isOwnProfile={isOwnProfile} />
        </div>

        {/* Tabs */}
        <div className="border-b border-border mb-8">
          <nav className="-mb-px flex space-x-8">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                data-tab={tab.id}
                onClick={() => handleTabClick(tab.id)}
                className={`
                  flex items-center gap-2 py-3 px-1 border-b-2 font-medium text-sm transition-colors
                  ${
                    activeTab === tab.id
                      ? 'border-brand-blue text-foreground dark:border-primary'
                      : 'border-transparent text-muted-foreground hover:text-foreground hover:border-border'
                  }
                `}
              >
                <tab.icon className="w-4 h-4" />
                <span>{tab.label}</span>
                {tab.count !== null && tab.count > 0 && (
                  <span className="ml-1 bg-muted text-muted-foreground px-2 py-0.5 rounded-full text-xs">
                    {tab.count}
                  </span>
                )}
              </button>
            ))}
          </nav>
        </div>

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
                displayName={user.name || user.username}
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
              displayName={user.name || user.username}
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
                    : `${user?.name}'s Wallet`}
                </h2>
                <p className="text-muted-foreground">
                  {isOwnProfile
                    ? 'Manage your Stellar testnet wallet for sending and receiving practice tips.'
                    : 'View and copy the wallet address, or tip this author from their articles.'}
                </p>
              </div>

              {/* Wallet Settings */}
              <div className="max-w-2xl">
                {!isOwnProfile ? (
                  <div className="mb-4">
                    <button
                      type="button"
                      className="focus-ring inline-flex w-full items-center justify-center rounded-lg bg-primary px-4 py-2.5 text-primary-foreground font-medium hover:bg-primary/90 transition-colors"
                      onClick={() => handleTabClick('articles')}
                    >
                      Tip this author from their articles
                    </button>
                  </div>
                ) : null}
                <WalletSettings
                  walletAddress={localWalletAddress ?? user?.stellarAddress}
                  profileUsername={username}
                  isOwnProfile={isOwnProfile}
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
