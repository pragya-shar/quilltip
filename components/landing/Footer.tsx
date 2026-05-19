'use client'

import { Heart, PenTool } from 'lucide-react'
import { Reveal } from '@/components/landing/Reveal'
import { LegalLinks } from '@/components/legal/LegalLinks'

export default function Footer() {
  const currentYear = new Date().getFullYear()

  return (
    <footer className="bg-spotlight text-spotlight-foreground relative overflow-hidden">
      {/* Background decoration */}
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_30%,color-mix(in_oklab,var(--spotlight-foreground)_6%,transparent),transparent_50%)]" />

      <div className="container mx-auto max-w-7xl px-8 relative z-10">
        {/* Main Footer Content */}
        <div className="py-16">
          {/* Brand Section */}
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
              Empowering writers with blockchain-powered micro-tipping on
              Stellar testnet. Practice with free test XLM today.
            </p>
          </Reveal>
        </div>

        <Reveal className="py-8 border-t border-spotlight-border space-y-4">
          <div className="flex justify-center">
            <LegalLinks linkClassName="text-spotlight-muted hover:text-spotlight-foreground text-[13px]" />
          </div>
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
