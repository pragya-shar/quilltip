import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '@/lib/utils'

const badgeVariants = cva(
  'font-ui inline-flex items-center rounded-[var(--ui-radius)] border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ui-ring focus:ring-offset-2',
  {
    variants: {
      variant: {
        default:
          'border-transparent bg-ui-primary text-ui-primary-foreground shadow-none hover:bg-ui-primary/80',
        secondary:
          'border-transparent bg-ui-muted text-ui-foreground hover:bg-ui-muted/80',
        destructive:
          'border-transparent bg-ui-danger text-ui-danger-foreground shadow-none hover:bg-ui-danger/80',
        success:
          'border-transparent bg-ui-success text-ui-success-foreground hover:bg-ui-success/80',
        warning:
          'border-transparent bg-ui-warning text-ui-warning-foreground hover:bg-ui-warning/80',
        info: 'border-transparent bg-ui-info text-ui-info-foreground hover:bg-ui-info/80',
        collectible:
          'border-transparent bg-ui-collectible text-ui-collectible-foreground hover:bg-ui-collectible/80',
        'collectible-muted':
          'border-transparent bg-ui-muted text-ui-collectible-foreground hover:bg-ui-muted/80',
        'collectible-emphasis':
          'border-transparent bg-ui-collectible text-ui-collectible-foreground hover:bg-ui-collectible/80',
        outline: 'border-ui-border text-ui-foreground',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  }
)

export interface BadgeProps
  extends
    React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props} />
  )
}

export { Badge, badgeVariants }
