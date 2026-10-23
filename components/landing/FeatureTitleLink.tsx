'use client'

import { LandingHashLink } from '@/components/landing/LandingHashLink'
import { type LandingFeature } from '@/lib/landing/features'

export function FeatureTitleLink({ feature }: { feature: LandingFeature }) {
  return (
    <LandingHashLink
      href={feature.href}
      className="focus-ring rounded-sm text-[15px] font-semibold text-foreground hover:underline underline-offset-2"
    >
      {feature.title}
    </LandingHashLink>
  )
}
