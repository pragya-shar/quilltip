'use client'

import { Heart } from 'lucide-react'
import { Reveal } from '@/components/landing/Reveal'
import { FooterNav } from '@/components/layout/FooterNav'
import { Logo } from '@/components/ui/Logo'
import { testnetBadgeLabel } from '@/lib/copy/network-status'
import { cn } from '@/lib/utils'

type SiteFooterProps = {
  variant?: 'landing' | 'default'
}

function NetworkBadge({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border border-border bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground',
        className
      )}
    >
      {testnetBadgeLabel()}
    </span>
  )
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
              <div className="flex justify-center mb-4">
                <Logo href={null} variant="onDark" size="lg" />
              </div>
              <div className="flex justify-center">
                <NetworkBadge className="border-spotlight-border bg-spotlight-muted/20 text-spotlight-muted" />
              </div>
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
          <NetworkBadge />
        </div>
        <FooterNav variant="default" className="max-w-3xl" />
        <p className="text-sm text-muted-foreground">
          © {currentYear} Quilltip. All rights reserved.
        </p>
      </div>
    </footer>
  )
}
