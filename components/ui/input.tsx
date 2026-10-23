import * as React from 'react'

import { cn } from '@/lib/utils'

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<'input'>>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          'font-ui flex h-9 w-full rounded-[var(--ui-radius)] border border-ui-input bg-ui-surface text-ui-foreground px-3 py-1 text-base shadow-none transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-ui-foreground placeholder:text-ui-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ui-ring aria-invalid:border-ui-danger aria-invalid:ring-ui-danger/30 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm',
          className
        )}
        ref={ref}
        {...props}
      />
    )
  }
)
Input.displayName = 'Input'

export { Input }
