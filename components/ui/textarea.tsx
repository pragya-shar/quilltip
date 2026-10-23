import * as React from 'react'

import { cn } from '@/lib/utils'

const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.ComponentProps<'textarea'>
>(({ className, ...props }, ref) => {
  return (
    <textarea
      className={cn(
        'font-ui flex min-h-[60px] w-full rounded-[var(--ui-radius)] border border-ui-input bg-ui-surface text-ui-foreground px-3 py-2 text-base shadow-none placeholder:text-ui-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ui-ring aria-invalid:border-ui-danger aria-invalid:ring-ui-danger/30 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm',
        className
      )}
      ref={ref}
      {...props}
    />
  )
})
Textarea.displayName = 'Textarea'

export { Textarea }
