import Link from 'next/link'
import type { LucideIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'

type RouteEmptyStateLinkAction = {
  label: string
  href: string
  onClick?: never
}

type RouteEmptyStateButtonAction = {
  label: string
  onClick: () => void
  href?: never
}

type RouteEmptyStateAction =
  | RouteEmptyStateLinkAction
  | RouteEmptyStateButtonAction

type RouteEmptyStateProps = {
  icon: LucideIcon
  title: string
  description: string
  action?: RouteEmptyStateAction
  secondaryAction?: { label: string; href: string }
  className?: string
}

function isLinkAction(
  action: RouteEmptyStateAction
): action is RouteEmptyStateLinkAction {
  return typeof action.href === 'string'
}

export function RouteEmptyState({
  icon: Icon,
  title,
  description,
  action,
  secondaryAction,
  className,
}: RouteEmptyStateProps) {
  return (
    <div
      className={
        className ??
        'bg-card rounded-lg shadow-[var(--card-shadow)] border border-border p-8 sm:p-12 text-center'
      }
    >
      <Icon
        className="w-12 h-12 text-muted-foreground mx-auto mb-4"
        aria-hidden
      />
      <h3 className="text-lg font-semibold text-foreground mb-2">{title}</h3>
      <p className="text-muted-foreground max-w-md mx-auto">{description}</p>
      {(action || secondaryAction) && (
        <div className="mt-6 flex flex-col sm:flex-row gap-3 justify-center">
          {action && isLinkAction(action) ? (
            <Button asChild>
              <Link href={action.href}>{action.label}</Link>
            </Button>
          ) : action ? (
            <Button type="button" onClick={action.onClick}>
              {action.label}
            </Button>
          ) : null}
          {secondaryAction && (
            <Button variant="outline" asChild>
              <Link href={secondaryAction.href}>{secondaryAction.label}</Link>
            </Button>
          )}
        </div>
      )}
    </div>
  )
}
