'use client'

import { useAuth } from '@/components/providers/AuthContext'
import AppNavigation from '@/components/layout/AppNavigation'
import HeroSection from '@/components/landing/HeroSection'

import dynamic from 'next/dynamic'

const LandingBelowFold = dynamic(
  () => import('@/components/landing/LandingBelowFold'),
  { ssr: false }
)
import { useLandingHashScroll } from '@/components/landing/useLandingHashScroll'
import { OnboardingDialog } from '@/components/onboarding/OnboardingDialog'
import { HomeRecentArticlesSection } from '@/components/articles/HomeRecentArticlesSection'
import { ErrorBoundary } from '@/components/error/ErrorBoundary'
import { DashboardRecentArticlesFallback } from '@/components/error/SectionErrorFallback'
import Link from 'next/link'
import { PenSquare, BookOpen, Wallet, TrendingUp } from 'lucide-react'
import Navigation from '@/components/landing/Navigation'

function HomeLoadingShell() {
  return (
    <div className="min-h-screen bg-background">
      <AppNavigation />
      <div className="pt-24 pb-8 max-w-6xl mx-auto px-4 animate-pulse">
        <div className="mb-8 space-y-3">
          <div className="h-9 w-64 rounded-lg bg-muted" />
          <div className="h-5 w-80 rounded-lg bg-muted" />
        </div>
        <div className="grid md:grid-cols-3 gap-6 mb-12">
          {[0, 1, 2].map((key) => (
            <div
              key={key}
              className="h-40 rounded-[var(--card-radius)] bg-muted"
            />
          ))}
        </div>
        <div className="h-7 w-40 rounded-lg bg-muted mb-6" />
        <div className="grid gap-4 md:grid-cols-2">
          {[0, 1].map((key) => (
            <div
              key={key}
              className="h-28 rounded-[var(--card-radius)] bg-muted"
            />
          ))}
        </div>
      </div>
    </div>
  )
}

function PublicLandingPage() {
  useLandingHashScroll()

  return (
    <div className="min-h-screen bg-gradient-to-b from-background via-muted/30 to-background">
      <Navigation />
      <HeroSection />
      <LandingBelowFold />
    </div>
  )
}

export default function HomePage() {
  const { user, isAuthenticated, isLoading } = useAuth()

  const hasWallet = !!user?.stellarAddress
  const showOnboarding = isAuthenticated && user && !user.onboardingCompleted

  if (isAuthenticated && isLoading) {
    return <HomeLoadingShell />
  }

  if (isAuthenticated && user) {
    return (
      <div className="min-h-screen bg-background">
        <AppNavigation />
        {showOnboarding && <OnboardingDialog />}
        <div className="pt-24 pb-8">
          <div className="max-w-6xl mx-auto px-4">
            <div className="mb-8">
              <h1 className="text-3xl font-bold text-foreground mb-2">
                Welcome back, {user.name || user.username || user.email}
              </h1>
              <p className="text-muted-foreground">
                Ready to read or write your next story?
              </p>
            </div>

            <div className="grid md:grid-cols-3 gap-6 mb-12">
              <Link
                href="/write"
                className="group p-6 bg-card rounded-[var(--card-radius)] shadow-[var(--card-shadow)] hover:shadow-md transition-shadow border border-border"
              >
                <div className="flex items-center mb-4">
                  <div className="p-3 bg-blue-100 dark:bg-blue-950/50 rounded-lg group-hover:bg-blue-200 dark:group-hover:bg-blue-950/70 transition-colors">
                    <PenSquare className="w-6 h-6 text-blue-600 dark:text-blue-400" />
                  </div>
                  <h3 className="text-lg font-semibold ml-3">Write Article</h3>
                </div>
                <p className="text-muted-foreground">
                  Create a new story with our powerful editor
                </p>
              </Link>

              <Link
                href="/articles"
                className="group p-6 bg-card rounded-[var(--card-radius)] shadow-[var(--card-shadow)] hover:shadow-md transition-shadow border border-border"
              >
                <div className="flex items-center mb-4">
                  <div className="p-3 bg-green-100 dark:bg-green-950/50 rounded-lg group-hover:bg-green-200 dark:group-hover:bg-green-950/70 transition-colors">
                    <BookOpen className="w-6 h-6 text-green-800 dark:text-green-400" />
                  </div>
                  <h3 className="text-lg font-semibold ml-3">
                    Browse Articles
                  </h3>
                </div>
                <p className="text-muted-foreground">
                  Discover stories and tip the writers you love
                </p>
              </Link>

              {hasWallet ? (
                <Link
                  href="/dashboard/earnings"
                  className="group p-6 bg-card rounded-[var(--card-radius)] shadow-[var(--card-shadow)] hover:shadow-md transition-shadow border border-border"
                >
                  <div className="flex items-center mb-4">
                    <div className="p-3 bg-purple-100 dark:bg-purple-950/50 rounded-lg group-hover:bg-purple-200 dark:group-hover:bg-purple-950/70 transition-colors">
                      <TrendingUp className="w-6 h-6 text-purple-600 dark:text-purple-400" />
                    </div>
                    <h3 className="text-lg font-semibold ml-3">
                      Your Earnings
                    </h3>
                  </div>
                  <p className="text-muted-foreground">
                    Track testnet tip activity and article performance
                  </p>
                </Link>
              ) : (
                <Link
                  href="/guide"
                  className="group p-6 bg-card rounded-[var(--card-radius)] shadow-[var(--card-shadow)] hover:shadow-md transition-shadow border border-border"
                >
                  <div className="flex items-center mb-4">
                    <div className="p-3 bg-amber-100 dark:bg-amber-950/50 rounded-lg group-hover:bg-amber-200 dark:group-hover:bg-amber-950/70 transition-colors">
                      <Wallet className="w-6 h-6 text-amber-600 dark:text-amber-400" />
                    </div>
                    <h3 className="text-lg font-semibold ml-3">
                      Set Up Testnet Wallet
                    </h3>
                  </div>
                  <p className="text-muted-foreground">
                    Connect a Stellar testnet wallet to send and receive
                    practice tips
                  </p>
                </Link>
              )}
            </div>

            {/* Recent Articles */}
            <div>
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-xl font-bold text-foreground">
                  Recent Articles
                </h2>
                <Link
                  href="/articles"
                  className="text-sm text-primary hover:text-primary/80 font-medium"
                >
                  View all
                </Link>
              </div>
              <ErrorBoundary fallback={<DashboardRecentArticlesFallback />}>
                <HomeRecentArticlesSection />
              </ErrorBoundary>
            </div>
          </div>
        </div>
      </div>
    )
  }

  return <PublicLandingPage />
}
