'use client'

import { useAuth } from '@/components/providers/AuthContext'
import { useQuery } from 'convex/react'
import { api } from '@/convex/_generated/api'
import Navigation from '@/components/landing/Navigation'
import AppNavigation from '@/components/layout/AppNavigation'
import HeroSection from '@/components/landing/HeroSection'
import FeaturesSection from '@/components/landing/FeaturesSection'
import HowItWorksSection from '@/components/landing/HowItWorksSection'
import FAQSection from '@/components/landing/FAQSection'
import Footer from '@/components/landing/Footer'
import { OnboardingDialog } from '@/components/onboarding/OnboardingDialog'
import ArticleGrid from '@/components/articles/ArticleGrid'
import Link from 'next/link'
import { PenSquare, BookOpen, Wallet, TrendingUp, Loader2 } from 'lucide-react'
import { ArticleForDisplay } from '@/types/index'

export default function HomePage() {
  const { user, isAuthenticated } = useAuth()

  // Fetch recent articles for the dashboard (only when authenticated)
  const result = useQuery(
    api.articles.listArticles,
    isAuthenticated ? { limit: 6 } : 'skip'
  )

  const recentArticles: ArticleForDisplay[] =
    result?.articles.map((article) => ({
      id: article._id,
      slug: article.slug,
      title: article.title,
      excerpt: article.excerpt || null,
      coverImage: article.coverImage || null,
      publishedAt: article.publishedAt ? new Date(article.publishedAt) : null,
      author: {
        id: article.author?.id as string,
        name: article.author?.name || null,
        username: article.author?.username || '',
        avatar: article.author?.avatar || null,
      },
      tags: (article.tags || []).map((tagName, index) => ({
        id: `tag-${index}`,
        name: tagName,
        slug: tagName.toLowerCase().replace(/\s+/g, '-'),
      })),
    })) || []

  const hasWallet = !!user?.stellarAddress
  const showOnboarding = isAuthenticated && user && !user.onboardingCompleted

  if (isAuthenticated && user) {
    return (
      <div className="min-h-screen bg-gray-50">
        <AppNavigation />
        {showOnboarding && <OnboardingDialog />}
        <div className="pt-24 pb-8">
          <div className="max-w-6xl mx-auto px-4">
            <div className="mb-8">
              <h1 className="text-3xl font-bold text-gray-900 mb-2">
                Welcome back, {user.name || user.username || user.email}
              </h1>
              <p className="text-gray-600">
                Ready to read or write your next story?
              </p>
            </div>

            <div className="grid md:grid-cols-3 gap-6 mb-12">
              <Link
                href="/write"
                className="group p-6 bg-white rounded-xl shadow-sm hover:shadow-md transition-shadow border border-gray-100"
              >
                <div className="flex items-center mb-4">
                  <div className="p-3 bg-blue-100 rounded-lg group-hover:bg-blue-200 transition-colors">
                    <PenSquare className="w-6 h-6 text-blue-600" />
                  </div>
                  <h3 className="text-lg font-semibold ml-3">Write Article</h3>
                </div>
                <p className="text-gray-600">
                  Create a new story with our powerful editor
                </p>
              </Link>

              <Link
                href="/articles"
                className="group p-6 bg-white rounded-xl shadow-sm hover:shadow-md transition-shadow border border-gray-100"
              >
                <div className="flex items-center mb-4">
                  <div className="p-3 bg-green-100 rounded-lg group-hover:bg-green-200 transition-colors">
                    <BookOpen className="w-6 h-6 text-green-600" />
                  </div>
                  <h3 className="text-lg font-semibold ml-3">
                    Browse Articles
                  </h3>
                </div>
                <p className="text-gray-600">
                  Discover stories and tip the writers you love
                </p>
              </Link>

              {hasWallet ? (
                <Link
                  href={`/${user.username}?tab=earnings`}
                  className="group p-6 bg-white rounded-xl shadow-sm hover:shadow-md transition-shadow border border-gray-100"
                >
                  <div className="flex items-center mb-4">
                    <div className="p-3 bg-purple-100 rounded-lg group-hover:bg-purple-200 transition-colors">
                      <TrendingUp className="w-6 h-6 text-purple-600" />
                    </div>
                    <h3 className="text-lg font-semibold ml-3">
                      Your Earnings
                    </h3>
                  </div>
                  <p className="text-gray-600">
                    Track tips received and article performance
                  </p>
                </Link>
              ) : (
                <Link
                  href="/guide"
                  className="group p-6 bg-white rounded-xl shadow-sm hover:shadow-md transition-shadow border border-gray-100"
                >
                  <div className="flex items-center mb-4">
                    <div className="p-3 bg-amber-100 rounded-lg group-hover:bg-amber-200 transition-colors">
                      <Wallet className="w-6 h-6 text-amber-600" />
                    </div>
                    <h3 className="text-lg font-semibold ml-3">
                      Set Up Wallet
                    </h3>
                  </div>
                  <p className="text-gray-600">
                    Connect a Stellar wallet to send and receive tips
                  </p>
                </Link>
              )}
            </div>

            {/* Recent Articles */}
            <div>
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-xl font-bold text-gray-900">
                  Recent Articles
                </h2>
                <Link
                  href="/articles"
                  className="text-sm text-blue-600 hover:text-blue-800 font-medium"
                >
                  View all
                </Link>
              </div>
              {result === undefined ? (
                <div className="flex justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
                </div>
              ) : (
                <ArticleGrid articles={recentArticles} />
              )}
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-white via-gray-50 to-white">
      <Navigation />
      <HeroSection />
      <FeaturesSection />
      <HowItWorksSection />
      <FAQSection />
      <Footer />
    </div>
  )
}
