import { Button } from '@/components/ui/button'
import type { NoticeAction } from './payment-types'

/** The one action a notice offers: a link or a button. */
export function NoticeActionButton({
  action,
  label,
}: {
  action: NoticeAction
  label: string
}) {
  if (action.href) {
    return (
      <Button asChild variant="outline" className="pay-action">
        <a href={action.href}>{label}</a>
      </Button>
    )
  }
  return (
    <Button
      type="button"
      variant="outline"
      className="pay-action"
      onClick={action.onClick}
    >
      {label}
    </Button>
  )
}
