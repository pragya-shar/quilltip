'use client'

import { useState, useEffect } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { useQuery } from 'convex/react'
import { api } from '@/convex/_generated/api'
import AppNavigation from '@/components/layout/AppNavigation'
import ArticleGrid from '@/components/articles/ArticleGrid'
import Pagination from '@/components/articles/Pagination'
import SearchInput from '@/components/articles/SearchInput'
import { ArticleGridSkeleton } from '@/components/articles/ArticleCardSkeleton'
import { ArticleForDisplay } from '@/types/index'

export default function ArticlesPage() {
  const [searchTerm, setSearchTerm] = useState('')

  const searchParams = useSearchParams()
  const router = useRouter()

  const currentPage = parseInt(searchParams?.get('page') || '1')
  const tag = searchParams?.get('tag') || undefined
  const author = searchParams?.get('author') || undefined
  const urlSearch = searchParams?.get('search') || undefined

  // Use Convex query to fetch articles
  const result = useQuery(api.articles.listArticles, {
    page: currentPage,
    limit: 9,
    tag,
    author,
    search: urlSearch,
  })

  // Map Convex articles to expected ArticleCard format
  const articles: ArticleForDisplay[] =
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
        id: `tag-${index}`, // Generate temporary IDs for tag strings
        name: tagName,
        slug: tagName.toLowerCase().replace(/\s+/g, '-'),
      })),
    })) || []
  const pagination = result
    ? {
        page: result.page,
        limit: result.limit,
        totalCount: result.total,
        totalPages: result.totalPages || Math.ceil(result.total / result.limit),
        hasNextPage:
          result.page <
          (result.totalPages || Math.ceil(result.total / result.limit)),
        hasPreviousPage: result.page > 1,
      }
    : {
        page: 1,
        limit: 9,
        totalCount: 0,
        totalPages: 0,
        hasNextPage: false,
        hasPreviousPage: false,
      }
  const loading = result === undefined
  const error = null // Convex handles errors automatically

  // Sync searchTerm with URL parameter
  useEffect(() => {
    setSearchTerm(urlSearch || '')
  }, [urlSearch])

  const handlePageChange = (page: number) => {
    const params = new URLSearchParams(searchParams?.toString() || '')
    params.set('page', page.toString())
    router.push(`/articles?${params.toString()}`)
  }

  const handleSearchChange = (search: string) => {
    const params = new URLSearchParams(searchParams?.toString() || '')
    if (search.trim()) {
      params.set('search', search.trim())
    } else {
      params.delete('search')
    }
    params.set('page', '1') // Reset to first page when searching
    router.push(`/articles?${params.toString()}`)
  }

  const clearFilters = () => {
    router.push('/articles')
  }

  return (
    <div className="min-h-screen bg-brand-cream">
      <AppNavigation />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-24 pb-12">
        {/* Page Header */}
        <div className="mb-8">
          <h1 className="text-4xl font-bold text-gray-900 mb-2">
            All Articles
          </h1>
          <p className="text-lg text-gray-600">
            Discover stories, thinking, and expertise from writers on QuillTip
          </p>
        </div>

        {/* Search Input */}
        <div className="mb-6">
          <SearchInput
            value={searchTerm}
            onChange={handleSearchChange}
            placeholder="Search articles by title or excerpt..."
            className="max-w-md"
          />
        </div>

        {/* Active Filters */}
        {(tag || author || urlSearch) && (
          <div className="mb-6 flex items-center gap-2">
            <span className="text-sm text-gray-600">Filtering by:</span>
            {tag && (
              <span className="inline-flex items-center px-3 py-1 rounded-full text-sm bg-brand-blue text-white">
                Tag: {tag}
                <button
                  onClick={() => {
                    const params = new URLSearchParams(
                      searchParams?.toString() || ''
                    )
                    params.delete('tag')
                    params.set('page', '1')
                    router.push(`/articles?${params.toString()}`)
                  }}
                  className="ml-2 hover:text-gray-200"
                  aria-label="Remove tag filter"
                >
                  ×
                </button>
              </span>
            )}
            {author && (
              <span className="inline-flex items-center px-3 py-1 rounded-full text-sm bg-brand-blue text-white">
                Author: @{author}
                <button
                  onClick={() => {
                    const params = new URLSearchParams(
                      searchParams?.toString() || ''
                    )
                    params.delete('author')
                    params.set('page', '1')
                    router.push(`/articles?${params.toString()}`)
                  }}
                  className="ml-2 hover:text-gray-200"
                  aria-label="Remove author filter"
                >
                  ×
                </button>
              </span>
            )}
            {urlSearch && (
              <span className="inline-flex items-center px-3 py-1 rounded-full text-sm bg-brand-blue text-white">
                Search: &ldquo;{urlSearch}&rdquo;
                <button
                  onClick={() => {
                    const params = new URLSearchParams(
                      searchParams?.toString() || ''
                    )
                    params.delete('search')
                    params.set('page', '1')
                    router.push(`/articles?${params.toString()}`)
                  }}
                  className="ml-2 hover:text-gray-200"
                  aria-label="Remove search filter"
                >
                  ×
                </button>
              </span>
            )}
            <button
              onClick={clearFilters}
              className="text-sm text-brand-blue hover:text-brand-accent underline"
            >
              Clear all
            </button>
          </div>
        )}

        {/* Loading State */}
        {loading && <ArticleGridSkeleton count={9} />}

        {/* Error handling is done automatically by Convex */}

        {/* Articles Grid */}
        {!loading && !error && (
          <>
            <ArticleGrid articles={articles} />

            {/* Pagination */}
            {pagination.totalPages > 1 && (
              <div className="mt-12">
                <Pagination
                  currentPage={pagination.page}
                  totalPages={pagination.totalPages}
                  onPageChange={handlePageChange}
                />
              </div>
            )}

            {/* Results Summary */}
            {articles.length > 0 && (
              <div className="mt-4 text-center text-sm text-gray-600">
                Showing {(pagination.page - 1) * pagination.limit + 1} -{' '}
                {Math.min(
                  pagination.page * pagination.limit,
                  pagination.totalCount
                )}{' '}
                of {pagination.totalCount} articles
              </div>
            )}
          </>
        )}
      </main>
    </div>
  )
}
