import { useId, type ReactNode, type Ref } from 'react'
import { cn } from '@/lib/utils'
import type { PaymentTone } from './payment-types'

type HeadingLevel = 2 | 3 | 4 | 5 | 6

interface PaymentPanelProps {
  tone: PaymentTone
  icon: ReactNode
  title: ReactNode
  /** Renders the title as a heading; otherwise a paragraph. */
  headingLevel?: HeadingLevel
  titleRef?: Ref<HTMLHeadingElement & HTMLParagraphElement>
  children?: ReactNode
  actions?: ReactNode
  /** `status` for notices that appear on their own; omit inside a live region. */
  role?: 'status' | 'alert'
  /** Plays the entrance once, for a state reached after mount. */
  enter?: boolean
  className?: string
  'data-state'?: string
}

/**
 * The one container every kit message uses: a tinted surface with a full
 * hairline border, a leading icon, a title, a detail and optional actions.
 */
export function PaymentPanel({
  tone,
  icon,
  title,
  headingLevel,
  titleRef,
  children,
  actions,
  role,
  enter = false,
  className,
  'data-state': dataState,
}: PaymentPanelProps) {
  const Title = headingLevel ? (`h${headingLevel}` as const) : 'p'
  const detailId = useId()
  return (
    <div
      className={cn('pay-panel', className)}
      data-tone={tone}
      data-enter={enter ? '' : undefined}
      data-state={dataState}
      role={role}
    >
      <span className="pay-panel-icon" aria-hidden="true">
        {icon}
      </span>
      <div className="pay-panel-body">
        <Title
          ref={titleRef}
          className="pay-panel-title"
          tabIndex={headingLevel ? -1 : undefined}
          // A focused result title reads its detail as the description.
          aria-describedby={headingLevel && children ? detailId : undefined}
        >
          {title}
        </Title>
        {children ? (
          <div className="pay-panel-detail" id={detailId}>
            {children}
          </div>
        ) : null}
        {actions ? <div className="pay-panel-actions">{actions}</div> : null}
      </div>
    </div>
  )
}
