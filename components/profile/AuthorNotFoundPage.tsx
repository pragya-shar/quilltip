'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback } from 'react'
import SearchInput from '@/components/articles/SearchInput'
import { FailurePageShell } from '@/components/error/FailurePageShell'
import AppNavigation from '@/components/layout/AppNavigation'
import { SiteFooter } from '@/components/layout/SiteFooter'
import { Button } from '@/components/ui/button'
import { AuthorNotFoundIllustration } from '@/components/profile/AuthorNotFoundIllustration'

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
    <div className="flex min-h-screen flex-col bg-background">
      <AppNavigation />
      <main className="flex flex-1 flex-col">
        <FailurePageShell
          className="flex-1 py-12"
          illustration={<AuthorNotFoundIllustration />}
          heading={
            <h1 className="font-display text-2xl font-medium tracking-[-0.01em] text-foreground sm:text-3xl">
              Profile unavailable
            </h1>
          }
          description={
            <>
              <p>
                No writer profile exists for{' '}
                <span className="font-medium text-foreground">@{username}</span>
                .
              </p>
              <p className="mt-2">
                Check the spelling or search for their articles.
              </p>
            </>
          }
          actionsClassName="flex w-full flex-col items-stretch gap-4 sm:flex-col"
          actions={
            <>
              <div className="w-full text-left">
                <label
                  id="author-not-found-search-label"
                  htmlFor="author-not-found-search"
                  className="mb-2 block text-sm font-medium text-foreground"
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
              <Button asChild size="lg" className="w-full sm:w-auto sm:mx-auto">
                <Link href="/articles">Browse articles</Link>
              </Button>
              <Link
                href="/"
                className="text-center text-sm font-medium text-primary underline-offset-4 transition-colors hover:underline sm:mx-auto"
              >
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
