'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { usePathname, useSearchParams, useRouter } from 'next/navigation'
import AppNavigation from '@/components/layout/AppNavigation'
import { SiteFooter } from '@/components/layout/SiteFooter'
import SearchInput from '@/components/articles/SearchInput'
import { ArticlesBrowseContent } from '@/components/articles/ArticlesBrowseContent'
import { ArticlesBrowseDiscoveryHeader } from '@/components/articles/ArticlesBrowseDiscoveryHeader'
import { buildArticlesBrowseHref } from '@/lib/articles/buildArticlesBrowseHref'
import {
  parseBrowseSort,
  parseBrowseView,
} from '@/lib/articles/browseDiscovery'
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
  const view = parseBrowseView(searchParams?.get('view'))
  const sort = parseBrowseSort(searchParams?.get('sort'))

  useEffect(() => {
    setSearchTerm(urlSearch || '')
  }, [urlSearch])

  const handleSearchChange = (search: string) => {
    router.push(
      buildArticlesBrowseHref({
        search,
        page: 1,
        sourceParams: searchParams,
      })
    )
  }

  const clearFilters = () => {
    router.push('/articles')
  }

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <AppNavigation />

      <main className="flex-1 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-24 pb-12 w-full">
        <div className="mb-8">
          <h1 className="text-4xl font-bold text-foreground mb-2">
            All Articles
          </h1>
          <p className="text-lg text-muted-foreground">
            Discover stories, thinking, and expertise from writers on Quilltip
          </p>
        </div>

        <div className="mb-6 max-w-md">
          <label
            htmlFor="articles-browse-search"
            className="mb-2 block text-sm font-medium text-foreground"
          >
            Search articles
          </label>
          <SearchInput
            id="articles-browse-search"
            value={searchTerm}
            onChange={handleSearchChange}
            placeholder="Search articles by title or excerpt..."
          />
        </div>

        <ArticlesBrowseDiscoveryHeader
          view={view}
          sort={sort}
          activeTag={tag}
        />

        {(tag || author || urlSearch) && (
          <div className="mb-6 flex items-center gap-2 flex-wrap">
            <span className="text-sm text-muted-foreground">Filtering by:</span>
            {tag && (
              <span className="inline-flex items-center px-3 py-1 rounded-full text-sm bg-brand-blue text-white">
                Tag: {tag}
                <button
                  onClick={() => {
                    router.push(
                      buildArticlesBrowseHref({
                        tag: '',
                        page: 1,
                        sourceParams: searchParams,
                      })
                    )
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
                    router.push(
                      buildArticlesBrowseHref({
                        author: '',
                        page: 1,
                        sourceParams: searchParams,
                      })
                    )
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
                    router.push(
                      buildArticlesBrowseHref({
                        search: '',
                        page: 1,
                        sourceParams: searchParams,
                      })
                    )
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
          view={view}
          sort={sort}
          scrollStorageKey={scrollStorageKey}
          onArticleNavigate={saveBrowseScrollPosition}
        />
      </main>
      <SiteFooter variant="default" />
    </div>
  )
}
