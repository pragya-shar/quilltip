'use client'

import Image from 'next/image'
import Link from 'next/link'
import { ArrowRight } from 'lucide-react'
import {
  HERO_PROOF_FALLBACK_CAPTION,
  HERO_PROOF_SCREENSHOT,
} from '@/lib/landing/hero-proof-fallback'

export function LandingProofScreenshotFallback() {
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
        <span className="ml-1 font-medium text-foreground">
          Browse articles
        </span>
        <ArrowRight className="ml-0.5 inline h-3 w-3" aria-hidden />
      </p>
    </Link>
  )
}
