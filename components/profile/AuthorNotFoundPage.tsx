'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback } from 'react'
import SearchInput from '@/components/articles/SearchInput'
import { FailurePageShell } from '@/components/error/FailurePageShell'
import AppNavigation from '@/components/layout/AppNavigation'
import { SiteFooter } from '@/components/layout/SiteFooter'

type AuthorNotFoundPageProps = {
  username: string
}

export function AuthorNotFoundPage({ username }: AuthorNotFoundPageProps) {
  const router = useRouter()

  const handleSearchChange = useCallback(
    (search: string) => {
      const trimmed = search.trim()
      if (!trimmed) return
      router.push(`/articles?search=${encodeURIComponent(trimmed)}&page=1`)
    },
    [router]
  )

  return (
    <div className="failure-profile flex min-h-screen flex-col bg-ui-surface font-ui text-ui-foreground">
      <AppNavigation />
      <main className="flex flex-1 flex-col">
        <FailurePageShell
          label="Writer not found"
          heading={<h1 className="failure-heading">Profile unavailable</h1>}
          description={
            <>
              <p>
                No writer profile exists for{' '}
                <span className="font-semibold text-ui-foreground">
                  @{username}
                </span>
                .
              </p>
              <p className="mt-2">
                Check the spelling or search for their articles.
              </p>
            </>
          }
          actions={
            <>
              <div className="w-full text-left">
                <label
                  id="author-not-found-search-label"
                  htmlFor="author-not-found-search"
                  className="failure-search-label"
                >
                  Search for articles
                </label>
                <SearchInput
                  id="author-not-found-search"
                  value=""
                  onChange={handleSearchChange}
                  placeholder="Search articles and writers..."
                  className="w-full"
                />
              </div>
              <Link href="/articles" className="failure-action">
                Browse articles
              </Link>
              <Link href="/" className="failure-link">
                Go home
              </Link>
            </>
          }
        />
      </main>
      <SiteFooter variant="default" />
    </div>
  )
}
