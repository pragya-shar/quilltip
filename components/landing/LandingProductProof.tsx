'use client'

import { useListArticles } from '@/hooks/convex'
import { mapListArticlesToDisplay } from '@/lib/articles/mapListArticleToDisplay'
import {
  HERO_PROOF_SECTION_LABEL,
  resolveHeroProofMode,
} from '@/lib/landing/hero-proof-fallback'
import { LandingProofArticleCard } from '@/components/landing/LandingProofArticleCard'
import { LandingProofSkeleton } from '@/components/landing/LandingProofSkeleton'
import { LandingProofScreenshotFallback } from '@/components/landing/LandingProofScreenshotFallback'

export function LandingProductProof() {
  const result = useListArticles({ limit: 2 })
  const mode = resolveHeroProofMode(
    result?.articles.length,
    result === undefined
  )

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
