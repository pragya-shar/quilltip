'use client'

import { motion } from 'framer-motion'
import { LucideIcon } from 'lucide-react'

interface WalletStepCardProps {
  step: number
  icon: LucideIcon
  title: string
  description: string
  isLast?: boolean
  children?: React.ReactNode
}

export function WalletStepCard({
  step,
  icon: Icon,
  title,
  description,
  isLast = false,
  children,
}: WalletStepCardProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: step * 0.1 }}
      className="relative flex gap-6"
    >
      {/* Timeline track */}
      <div className="flex flex-col items-center pt-1.5">
        <div className="w-2.5 h-2.5 rounded-full bg-primary shrink-0 ring-4 ring-background" />
        {!isLast && <div className="w-px flex-1 bg-border mt-1" />}
      </div>

      {/* Content */}
      <div className={`flex-1 min-w-0 ${!isLast ? 'pb-8' : 'pb-2'}`}>
        <div className="flex items-start gap-3 mb-1.5">
          <Icon className="w-5 h-5 text-muted-foreground shrink-0 mt-0.5" />
          <h3 className="text-lg font-semibold text-foreground leading-snug">
            {title}
          </h3>
        </div>
        <p className="text-sm text-muted-foreground leading-relaxed pl-8">
          {description}
        </p>
        {children && <div className="mt-3 pl-8">{children}</div>}
      </div>
    </motion.div>
  )
}
