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
import { OnboardingIntentHome } from '@/components/onboarding/OnboardingIntentHome'
import { HomeRecentArticlesSection } from '@/components/articles/HomeRecentArticlesSection'
import { ErrorBoundary } from '@/components/error/ErrorBoundary'
import { DashboardRecentArticlesFallback } from '@/components/error/SectionErrorFallback'
import Link from 'next/link'
import { PenSquare, BookOpen, Wallet, TrendingUp } from 'lucide-react'
import {
  DASHBOARD_HOME_BROWSE_CARD,
  DASHBOARD_HOME_EARNINGS_CARD,
  DASHBOARD_HOME_RECENT_ARTICLES_HEADING,
  DASHBOARD_HOME_VIEW_ALL_LABEL,
  DASHBOARD_HOME_WALLET_CARD,
  DASHBOARD_HOME_WELCOME_SUBTITLE,
  DASHBOARD_HOME_WRITE_CARD,
} from '@/lib/copy/dashboard-home'
import Navigation from '@/components/landing/Navigation'
import { cardVariants } from '@/components/ui/card'
import { cn } from '@/lib/utils'

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

const actionTileClassName = cn(
  cardVariants({ variant: 'action' }),
  'group block'
)

export default function HomePage() {
  const { user, isAuthenticated, isLoading } = useAuth()

  const hasWallet = !!user?.stellarAddress
  const showOnboarding = isAuthenticated && user && !user.onboardingCompleted

  if (isAuthenticated && isLoading) {
    return <HomeLoadingShell />
  }

  if (isAuthenticated && user) {
    if (showOnboarding) {
      return (
        <div className="min-h-screen bg-background">
          <AppNavigation />
          <OnboardingIntentHome />
        </div>
      )
    }

    return (
      <div className="min-h-screen bg-background">
        <AppNavigation />
        <div className="pt-24 pb-8">
          <div className="max-w-6xl mx-auto px-4">
            <div className="mb-8">
              <h1 className="text-3xl font-bold text-foreground mb-2">
                Welcome back, {user.name || user.username || user.email}
              </h1>
              <p className="text-muted-foreground">
                {DASHBOARD_HOME_WELCOME_SUBTITLE}
              </p>
            </div>

            <p className="text-sm font-medium text-muted-foreground mb-3">
              Quick actions
            </p>
            <div className="grid md:grid-cols-3 gap-4 mb-12">
              <Link href="/write" className={actionTileClassName}>
                <div className="flex items-center mb-3">
                  <div className="p-2.5 bg-blue-100 dark:bg-blue-950/50 rounded-lg group-hover:bg-blue-200 dark:group-hover:bg-blue-950/70 transition-colors">
                    <PenSquare className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                  </div>
                  <h3 className="text-base font-semibold ml-3">
                    {DASHBOARD_HOME_WRITE_CARD.title}
                  </h3>
                </div>
                <p className="text-sm text-muted-foreground">
                  {DASHBOARD_HOME_WRITE_CARD.description}
                </p>
              </Link>

              <Link href="/articles" className={actionTileClassName}>
                <div className="flex items-center mb-3">
                  <div className="p-2.5 bg-green-100 dark:bg-green-950/50 rounded-lg group-hover:bg-green-200 dark:group-hover:bg-green-950/70 transition-colors">
                    <BookOpen className="w-5 h-5 text-green-800 dark:text-green-400" />
                  </div>
                  <h3 className="text-base font-semibold ml-3">
                    {DASHBOARD_HOME_BROWSE_CARD.title}
                  </h3>
                </div>
                <p className="text-sm text-muted-foreground">
                  {DASHBOARD_HOME_BROWSE_CARD.description}
                </p>
              </Link>

              {hasWallet ? (
                <Link
                  href="/dashboard/earnings"
                  className={actionTileClassName}
                >
                  <div className="flex items-center mb-3">
                    <div className="p-2.5 bg-purple-100 dark:bg-purple-950/50 rounded-lg group-hover:bg-purple-200 dark:group-hover:bg-purple-950/70 transition-colors">
                      <TrendingUp className="w-5 h-5 text-purple-600 dark:text-purple-400" />
                    </div>
                    <h3 className="text-base font-semibold ml-3">
                      {DASHBOARD_HOME_EARNINGS_CARD.title}
                    </h3>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {DASHBOARD_HOME_EARNINGS_CARD.description}
                  </p>
                </Link>
              ) : (
                <Link href="/dashboard/wallet" className={actionTileClassName}>
                  <div className="flex items-center mb-3">
                    <div className="p-2.5 bg-amber-100 dark:bg-amber-950/50 rounded-lg group-hover:bg-amber-200 dark:group-hover:bg-amber-950/70 transition-colors">
                      <Wallet className="w-5 h-5 text-amber-600 dark:text-amber-400" />
                    </div>
                    <h3 className="text-base font-semibold ml-3">
                      {DASHBOARD_HOME_WALLET_CARD.title}
                    </h3>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {DASHBOARD_HOME_WALLET_CARD.description}
                  </p>
                </Link>
              )}
            </div>

            {/* Recent Articles */}
            <div>
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-xl font-bold text-foreground">
                  {DASHBOARD_HOME_RECENT_ARTICLES_HEADING}
                </h2>
                <Link
                  href="/articles"
                  className="text-sm text-primary hover:text-primary/80 font-medium"
                >
                  {DASHBOARD_HOME_VIEW_ALL_LABEL}
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
