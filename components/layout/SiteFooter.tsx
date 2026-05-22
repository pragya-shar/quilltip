'use client'

import { Heart, PenTool } from 'lucide-react'
import { Reveal } from '@/components/landing/Reveal'
import { FooterNav } from '@/components/layout/FooterNav'
import { TESTNET_PRACTICE_NOTE } from '@/lib/copy/network-status'
import { cn } from '@/lib/utils'

type SiteFooterProps = {
  variant?: 'landing' | 'default'
}

export function SiteFooter({ variant = 'default' }: SiteFooterProps) {
  const currentYear = new Date().getFullYear()
  const isLanding = variant === 'landing'

  if (isLanding) {
    return (
      <footer className="bg-spotlight text-spotlight-foreground relative overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_30%,color-mix(in_oklab,var(--spotlight-foreground)_6%,transparent),transparent_50%)]" />

        <div className="container mx-auto max-w-7xl px-8 relative z-10">
          <div className="py-16">
            <Reveal className="text-center">
              <div className="flex items-center gap-3 mb-4 justify-center">
                <div className="w-9 h-9 bg-card rounded-lg border border-border flex items-center justify-center shadow-sm">
                  <PenTool className="w-5 h-5 text-foreground" />
                </div>
                <h3 className="text-2xl font-display font-medium tracking-[-0.01em]">
                  Quilltip
                </h3>
              </div>
              <p className="text-spotlight-muted text-[15px] leading-relaxed max-w-2xl mx-auto">
                {TESTNET_PRACTICE_NOTE}
              </p>
            </Reveal>
          </div>

          <Reveal className="py-8 border-t border-spotlight-border space-y-6">
            <FooterNav variant="landing" className="max-w-3xl mx-auto" />
            <div className="flex items-center justify-center gap-2 text-spotlight-muted text-[13px]">
              <span>© {currentYear} Quilltip. Built with</span>
              <Heart className="w-4 h-4 text-destructive fill-current animate-pulse" />
              <span>for writers everywhere</span>
            </div>
          </Reveal>
        </div>
      </footer>
    )
  }

  return (
    <footer className={cn('border-t border-border bg-background mt-auto')}>
      <div className="container mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-10 space-y-6">
        <div className="max-w-3xl">
          <p className="text-sm text-muted-foreground leading-relaxed">
            {TESTNET_PRACTICE_NOTE}
          </p>
        </div>
        <FooterNav variant="default" className="max-w-3xl" />
        <p className="text-sm text-muted-foreground">
          © {currentYear} Quilltip. All rights reserved.
        </p>
      </div>
    </footer>
  )
}
