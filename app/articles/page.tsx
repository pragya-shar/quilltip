'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { usePathname, useSearchParams, useRouter } from 'next/navigation'
import AppNavigation from '@/components/layout/AppNavigation'
import SearchInput from '@/components/articles/SearchInput'
import { ArticlesBrowseContent } from '@/components/articles/ArticlesBrowseContent'
import {
  buildArticlesBrowseScrollStorageKey,
  writeBrowseScrollY,
} from '@/lib/articles/browseListScrollStorage'

export default function ArticlesPage() {
  const [searchTerm, setSearchTerm] = useState('')
  const didSaveOnNavigateRef = useRef(false)

  const pathname = usePathname()
  const searchParams = useSearchParams()
  const router = useRouter()

  const searchString = searchParams?.toString() ?? ''
  const scrollStorageKey = buildArticlesBrowseScrollStorageKey(
    pathname,
    searchString
  )

  useEffect(() => {
    const previous = history.scrollRestoration
    history.scrollRestoration = 'manual'
    return () => {
      history.scrollRestoration = previous
    }
  }, [])

  useEffect(() => {
    const onPageHide = () => {
      // If we already saved right before a click navigation, don't overwrite it.
      if (didSaveOnNavigateRef.current) return
      writeBrowseScrollY(scrollStorageKey, window.scrollY)
    }
    window.addEventListener('pagehide', onPageHide)
    return () => {
      window.removeEventListener('pagehide', onPageHide)
    }
  }, [scrollStorageKey])

  const saveBrowseScrollPosition = useCallback(() => {
    didSaveOnNavigateRef.current = true
    writeBrowseScrollY(scrollStorageKey, window.scrollY)
  }, [scrollStorageKey])

  const currentPage = parseInt(searchParams?.get('page') || '1')
  const tag = searchParams?.get('tag') || undefined
  const author = searchParams?.get('author') || undefined
  const urlSearch = searchParams?.get('search') || undefined

  // Sync searchTerm with URL parameter
  useEffect(() => {
    setSearchTerm(urlSearch || '')
  }, [urlSearch])

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
    <div className="min-h-screen bg-background">
      <AppNavigation />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-24 pb-12">
        {/* Page Header */}
        <div className="mb-8">
          <h1 className="text-4xl font-bold text-foreground mb-2">
            All Articles
          </h1>
          <p className="text-lg text-muted-foreground">
            Discover stories, thinking, and expertise from writers on Quilltip
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
            <span className="text-sm text-muted-foreground">Filtering by:</span>
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
                  className="ml-2 hover:text-primary-foreground/80"
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
                  className="ml-2 hover:text-primary-foreground/80"
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
                  className="ml-2 hover:text-primary-foreground/80"
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

        <ArticlesBrowseContent
          currentPage={currentPage}
          tag={tag}
          author={author}
          urlSearch={urlSearch}
          scrollStorageKey={scrollStorageKey}
          onArticleNavigate={saveBrowseScrollPosition}
        />
      </main>
    </div>
  )
}
