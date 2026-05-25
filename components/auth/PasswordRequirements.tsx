import { Check, Circle } from 'lucide-react'
import { getPasswordRuleStatuses } from '@/lib/validations/password-rules'
import { cn } from '@/lib/utils'

export const PASSWORD_REQUIREMENTS_ID = 'password-requirements'

type PasswordRequirementsProps = {
  password: string
  highlightFailures?: boolean
}

export function PasswordRequirements({
  password,
  highlightFailures = false,
}: PasswordRequirementsProps) {
  const rules = getPasswordRuleStatuses(password)

  return (
    <ul
      id={PASSWORD_REQUIREMENTS_ID}
      aria-live="polite"
      className="mt-2 space-y-1"
    >
      {rules.map((rule) => (
        <li
          key={rule.id}
          className={cn(
            'flex items-center gap-2 text-sm',
            rule.met
              ? 'text-success-foreground'
              : highlightFailures
                ? 'text-destructive'
                : 'text-muted-foreground'
          )}
        >
          {rule.met ? (
            <Check className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          ) : (
            <Circle
              className={cn(
                'h-3.5 w-3.5 shrink-0',
                highlightFailures ? 'text-destructive' : 'text-muted-foreground'
              )}
              aria-hidden="true"
            />
          )}
          <span>{rule.label}</span>
        </li>
      ))}
    </ul>
  )
}
