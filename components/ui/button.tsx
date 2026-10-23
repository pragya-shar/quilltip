import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '@/lib/utils'

const buttonVariants = cva(
  'font-ui inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-[var(--ui-radius)] text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ui-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        default:
          'bg-ui-primary text-ui-primary-foreground shadow-none hover:bg-ui-primary/90',
        destructive:
          'bg-ui-danger text-ui-danger-foreground shadow-none hover:bg-ui-danger/90',
        outline:
          'border border-ui-input bg-ui-surface text-ui-foreground shadow-none hover:bg-ui-accent hover:text-ui-accent-foreground',
        secondary:
          'bg-ui-muted text-ui-foreground shadow-none hover:bg-ui-muted/80',
        ghost:
          'text-ui-foreground hover:bg-ui-accent hover:text-ui-accent-foreground',
        link: 'text-ui-primary underline-offset-4 hover:underline',
      },
      size: {
        default: 'h-9 px-4 py-2',
        sm: 'h-8 rounded-[var(--ui-radius)] px-3 text-xs',
        lg: 'h-10 rounded-[var(--ui-radius)] px-8',
        icon: 'h-9 w-9',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  }
)

export interface ButtonProps
  extends
    React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button'
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    )
  }
)
Button.displayName = 'Button'

export { Button, buttonVariants }
