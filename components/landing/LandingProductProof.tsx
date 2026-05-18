'use client'

import Image from 'next/image'
import Link from 'next/link'
import { ArrowRight } from 'lucide-react'
import { useListArticles } from '@/hooks/convex'
import { mapListArticlesToDisplay } from '@/lib/articles/mapListArticleToDisplay'
import {
  HERO_PROOF_FALLBACK_CAPTION,
  HERO_PROOF_SCREENSHOT,
  HERO_PROOF_SECTION_LABEL,
  resolveHeroProofMode,
} from '@/lib/landing/hero-proof-fallback'
import { LandingProofArticleCard } from '@/components/landing/LandingProofArticleCard'

function LandingProofSkeleton() {
  return (
    <div className="flex flex-col gap-2" aria-hidden>
      <div className="h-[72px] animate-pulse rounded-lg border border-border bg-muted/50" />
      <div className="hidden h-[72px] animate-pulse rounded-lg border border-border bg-muted/50 sm:block" />
    </div>
  )
}

function LandingProofScreenshotFallback() {
  return (
    <Link
      href="/articles"
      className="focus-ring block overflow-hidden rounded-xl border border-border bg-card shadow-[var(--card-shadow)] transition-shadow hover:shadow-md"
    >
      <Image
        src={HERO_PROOF_SCREENSHOT.src}
        alt={HERO_PROOF_SCREENSHOT.alt}
        width={HERO_PROOF_SCREENSHOT.width}
        height={HERO_PROOF_SCREENSHOT.height}
        priority
        className="h-auto w-full object-cover object-top"
      />
      <p className="border-t border-border px-4 py-3 text-left text-[12px] text-muted-foreground">
        {HERO_PROOF_FALLBACK_CAPTION}
        <span className="ml-1 font-medium text-foreground">Browse articles</span>
        <ArrowRight className="ml-0.5 inline h-3 w-3" aria-hidden />
      </p>
    </Link>
  )
}

export function LandingProductProof() {
  const result = useListArticles({ limit: 2 })
  const mode = resolveHeroProofMode(result?.articles.length, result === undefined)

  return (
    <div
      data-testid="landing-product-proof"
      className="mt-6 w-full max-w-md text-left"
    >
      <h2 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {HERO_PROOF_SECTION_LABEL}
      </h2>

      <div className="mt-3">
        {mode === 'loading' ? <LandingProofSkeleton /> : null}

        {mode === 'live' && result ? (
          <div className="flex flex-col gap-2">
            {mapListArticlesToDisplay(result.articles)
              .slice(0, 2)
              .map((article, index) => (
                <div
                  key={article.id}
                  className={index === 1 ? 'hidden sm:block' : undefined}
                >
                  <LandingProofArticleCard
                    article={article}
                    priority={index === 0}
                  />
                </div>
              ))}
          </div>
        ) : null}

        {mode === 'screenshot' ? <LandingProofScreenshotFallback /> : null}
      </div>
    </div>
  )
}
