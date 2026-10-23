'use client'

import { motion } from 'motion/react'
import { type LandingFeature } from '@/lib/landing/features'
import { FeatureTitleLink } from '@/components/landing/FeatureTitleLink'

export function FeatureRow({ feature }: { feature: LandingFeature }) {
  return (
    <motion.div className="flex items-start gap-4">
      <div className="shrink-0 w-10 h-10 rounded-full bg-card border-2 border-border flex items-center justify-center">
        <feature.icon className="w-4 h-4 text-muted-foreground" />
      </div>
      <div className="min-w-0 flex-1">
        <h3 className="text-[15px] font-semibold leading-snug">
          <FeatureTitleLink feature={feature} />
        </h3>
        <p className="text-[13px] text-muted-foreground leading-relaxed mt-0.5">
          {feature.description}
        </p>
      </div>
    </motion.div>
  )
}
