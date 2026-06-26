import type { ComponentProps } from 'react'
import { FileText } from 'lucide-react'
import { RouteEmptyState } from '@/components/ui/route-empty-state'

type RouteEmptyStateActionProp = ComponentProps<
  typeof RouteEmptyState
>['action']

const hrefAction: RouteEmptyStateActionProp = {
  label: 'Start a draft',
  href: '/write',
}

const buttonAction: RouteEmptyStateActionProp = {
  label: 'Clear filters',
  onClick: () => undefined,
}

const ambiguousActionInput = {
  label: 'Ambiguous action',
  href: '/articles',
  onClick: () => undefined,
}

// @ts-expect-error RouteEmptyState actions must not provide href and onClick together.
export const ambiguousAction: RouteEmptyStateActionProp = ambiguousActionInput

export function RouteEmptyStateTypeExamples() {
  return (
    <>
      <RouteEmptyState
        icon={FileText}
        title="No drafts"
        description="Saved drafts appear here."
        action={hrefAction}
      />
      <RouteEmptyState
        icon={FileText}
        title="No results"
        description="Try a different search."
        action={buttonAction}
      />
    </>
  )
}
