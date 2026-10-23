'use client'

import * as React from 'react'
import * as CheckboxPrimitive from '@radix-ui/react-checkbox'
import { Check } from 'lucide-react'

import { cn } from '@/lib/utils'

const Checkbox = React.forwardRef<
  React.ElementRef<typeof CheckboxPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root>
>(({ className, ...props }, ref) => (
  <CheckboxPrimitive.Root
    ref={ref}
    className={cn(
      'font-ui peer h-4 w-4 shrink-0 rounded-[var(--ui-radius)] border border-ui-input bg-ui-surface shadow-none focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ui-ring aria-invalid:border-ui-danger aria-invalid:ring-ui-danger/30 disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:border-ui-primary data-[state=indeterminate]:border-ui-primary data-[state=indeterminate]:bg-ui-primary data-[state=indeterminate]:text-ui-primary-foreground data-[state=checked]:bg-ui-primary data-[state=checked]:text-ui-primary-foreground',
      className
    )}
    {...props}
  >
    <CheckboxPrimitive.Indicator
      className={cn('flex items-center justify-center text-current')}
    >
      <Check className="h-4 w-4" />
    </CheckboxPrimitive.Indicator>
  </CheckboxPrimitive.Root>
))
Checkbox.displayName = CheckboxPrimitive.Root.displayName

export { Checkbox }
