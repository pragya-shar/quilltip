'use client'

import { notFound } from 'next/navigation'
import {
  useListArticles,
  useNFTsByOwner,
  useUserByUsername,
  useUserMintedNFTs,
  useUserStats,
} from '@/hooks/convex'
import { mapListArticlesToDisplay } from '@/lib/articles/mapListArticleToDisplay'
import { useState, useEffect } from 'react'
import { useSearchParams } from 'next/navigation'
import { useAuth } from '@/components/providers/AuthContext'
import AppNavigation from '@/components/layout/AppNavigation'
import ProfileHeader from '@/components/profile/ProfileHeader'
import ArticleGrid from '@/components/articles/ArticleGrid'
import Pagination from '@/components/articles/Pagination'
import { EarningsDashboard } from '@/components/dashboard/EarningsDashboard'
import { WalletSettings } from '@/components/stellar'
import {
  BookOpen,
  DollarSign,
  Image,
  ChartBar,
  Trophy,
  Wallet,
} from 'lucide-react'

interface ProfilePageProps {
  params: Promise<{
    username: string
  }>
}

type TabType = 'articles' | 'nfts' | 'earnings' | 'stats' | 'wallet'

export default function ProfilePage({ params }: ProfilePageProps) {
  const searchParams = useSearchParams()
  const { user: currentUser } = useAuth()
  const [username, setUsername] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<TabType>('articles')
  const [localWalletAddress, setLocalWalletAddress] = useState<
    string | null | undefined
  >()
  const page = parseInt(searchParams?.get('page') || '1', 10)

  // Get username from params
  useEffect(() => {
    params.then((p) => setUsername(p.username))
  }, [params])

  // Fetch user profile
  const user = useUserByUsername(username ?? undefined)

  // Sync local wallet address with user data
  useEffect(() => {
    if (user?.stellarAddress !== localWalletAddress) {
      setLocalWalletAddress(user?.stellarAddress)
    }
  }, [user?.stellarAddress, localWalletAddress])

  // Fetch user stats
  const userStats = useUserStats(user?._id)

  // Fetch user's articles
  const articlesData = useListArticles(
    username && activeTab === 'articles'
      ? {
          author: username,
          page,
          limit: 9,
        }
      : 'skip'
  )

  // Fetch user's NFTs
  const userNFTs = useNFTsByOwner(
    user && activeTab === 'nfts' ? user._id : undefined
  )

  const mintedNFTs = useUserMintedNFTs(
    user && activeTab === 'nfts' ? user._id : undefined
  )

  // Check if this is the current user's profile
  const isOwnProfile = currentUser?.username === username

  // Loading state
  if (username === null) {
    return (
      <div className="min-h-screen bg-background">
        <AppNavigation />
        <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-24 pb-12">
          <div className="animate-pulse">
            <div className="h-32 bg-muted rounded-lg mb-8"></div>
            <div className="grid grid-cols-3 gap-6">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-64 bg-muted rounded-lg"></div>
              ))}
            </div>
          </div>
        </main>
      </div>
    )
  }

  // Check if user exists
  if (username && user === null) {
    notFound()
  }

  // Show loading while data is being fetched
  if (!user) {
    return (
      <div className="min-h-screen bg-background">
        <AppNavigation />
        <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-24 pb-12">
          <div className="animate-pulse">
            <div className="h-32 bg-muted rounded-lg mb-8"></div>
            <div className="grid grid-cols-3 gap-6">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-64 bg-muted rounded-lg"></div>
              ))}
            </div>
          </div>
        </main>
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
    <div className="min-h-screen bg-background">
      <AppNavigation />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-24 pb-12">
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
                onClick={() => setActiveTab(tab.id)}
                className={`
                  flex items-center gap-2 py-3 px-1 border-b-2 font-medium text-sm transition-colors
                  ${
                    activeTab === tab.id
                      ? 'border-brand-blue text-brand-blue'
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
              {articlesData?.articles && articlesData.articles.length > 0 ? (
                <>
                  <ArticleGrid
                    articles={mapListArticlesToDisplay(articlesData.articles)}
                  />

                  {/* Pagination */}
                  {articlesData.totalPages && articlesData.totalPages > 1 && (
                    <div className="mt-12">
                      <Pagination
                        currentPage={page}
                        totalPages={articlesData.totalPages}
                        basePath={`/${username}`}
                      />
                    </div>
                  )}

                  {/* Results Summary */}
                  <div className="mt-4 text-center text-sm text-muted-foreground">
                    Showing {(page - 1) * 9 + 1} -{' '}
                    {Math.min(page * 9, articlesData.total)} of{' '}
                    {articlesData.total} articles
                  </div>
                </>
              ) : (
                <div className="bg-card rounded-lg shadow-[var(--card-shadow)] border border-border p-12 text-center">
                  <BookOpen className="w-12 h-12 text-muted-foreground/50 mx-auto mb-4" />
                  <p className="text-muted-foreground text-lg">
                    {isOwnProfile
                      ? "You haven't"
                      : `${user.name || user.username} hasn't`}{' '}
                    published any articles yet.
                  </p>
                </div>
              )}
            </div>
          )}

          {/* NFTs Tab */}
          {activeTab === 'nfts' && (
            <div className="space-y-8">
              {/* Owned NFTs */}
              {userNFTs && userNFTs.length > 0 && (
                <div>
                  <h3 className="text-xl font-semibold mb-4 flex items-center gap-2">
                    <Trophy className="w-5 h-5 text-yellow-500" />
                    Owned NFTs
                  </h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {userNFTs.map((nft) => (
                      <div
                        key={nft._id}
                        className="bg-card rounded-lg shadow-[var(--card-shadow)] border border-border p-4"
                      >
                        <div className="aspect-video bg-gradient-to-br from-purple-400 to-pink-400 rounded-lg mb-4 flex items-center justify-center">
                          <Image
                            className="w-12 h-12 text-white"
                            aria-label="NFT"
                          />
                        </div>
                        <h4 className="font-semibold text-foreground truncate">
                          {nft.article?.title || 'Untitled'}
                        </h4>
                        <p className="text-sm text-muted-foreground mt-1">
                          Token ID: {nft.tokenId.slice(0, 8)}...
                        </p>
                        <p className="text-xs text-muted-foreground/80 mt-2">
                          Minted by @{nft.minter?.username || 'unknown'}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Minted NFTs */}
              {mintedNFTs && mintedNFTs.length > 0 && (
                <div>
                  <h3 className="text-xl font-semibold mb-4">Minted NFTs</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {mintedNFTs.map((nft) => (
                      <div
                        key={nft._id}
                        className="bg-card rounded-lg shadow-[var(--card-shadow)] border border-border p-4"
                      >
                        <div className="aspect-video bg-gradient-to-br from-blue-400 to-green-400 rounded-lg mb-4 flex items-center justify-center">
                          <Image
                            className="w-12 h-12 text-white"
                            aria-label="NFT"
                          />
                        </div>
                        <h4 className="font-semibold text-foreground truncate">
                          {nft.article?.title || 'Untitled'}
                        </h4>
                        <p className="text-sm text-muted-foreground mt-1">
                          Token ID: {nft.tokenId.slice(0, 8)}...
                        </p>
                        <p className="text-xs text-muted-foreground/80 mt-2">
                          Owner: @{nft.currentOwnerInfo?.username || 'unknown'}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {(!userNFTs || userNFTs.length === 0) &&
                (!mintedNFTs || mintedNFTs.length === 0) && (
                  <div className="bg-card rounded-lg shadow-[var(--card-shadow)] border border-border p-12 text-center">
                    <Image
                      className="w-12 h-12 text-muted-foreground/50 mx-auto mb-4"
                      aria-label="No NFTs"
                    />
                    <p className="text-muted-foreground text-lg">
                      {isOwnProfile
                        ? "You don't"
                        : `${user.name || user.username} doesn't`}{' '}
                      have any NFTs yet.
                    </p>
                  </div>
                )}
            </div>
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
                    ? 'Manage your Stellar wallet for sending and receiving tips on the network.'
                    : 'View wallet address for sending tips to this user.'}
                </p>
              </div>

              {/* Wallet Settings */}
              <div className="max-w-2xl">
                <WalletSettings
                  walletAddress={localWalletAddress ?? user?.stellarAddress}
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
    </div>
  )
}

// Configure dynamic behavior
export const dynamic = 'force-dynamic'
export const dynamicParams = true
