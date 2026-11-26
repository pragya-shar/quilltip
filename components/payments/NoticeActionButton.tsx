import { Button } from '@/components/ui/button'
import type { NoticeAction } from './payment-types'

/**
 * The one action a notice or result offers: a link or a button. Primary when
 * it is the next step on its surface, outline otherwise.
 */
export function NoticeActionButton({
  action,
  label,
  emphasis = 'secondary',
}: {
  action: NoticeAction
  label: string
  emphasis?: 'primary' | 'secondary'
}) {
  const variant =
    (action.emphasis ?? emphasis) === 'primary' ? 'default' : 'outline'
  if (action.href) {
    return (
      <Button asChild variant={variant} className="pay-action">
        <a href={action.href}>{label}</a>
      </Button>
    )
  }
  return (
    <Button
      type="button"
      variant={variant}
      className="pay-action"
      onClick={action.onClick}
    >
      {label}
    </Button>
  )
}
