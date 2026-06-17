import { Check, Circle } from 'lucide-react'
import { getPasswordRuleStatuses } from '@/lib/validations/password-rules'

export const PASSWORD_REQUIREMENTS_ID = 'password-requirements'

// "all" keeps removals announced when satisfied rules leave the list.
const passwordRequirementsLiveProps = {
  'aria-live': 'polite',
  'aria-relevant': 'all',
} as const

type PasswordRequirementsProps = {
  password: string
  highlightFailures?: boolean
}

export function PasswordRequirements({
  password,
  highlightFailures = false,
}: PasswordRequirementsProps) {
  const rules = getPasswordRuleStatuses(password)
  const unmetRules = rules.filter((rule) => !rule.met)
  const hasInput = password.length > 0
  const allMet = unmetRules.length === 0

  if (allMet && hasInput) {
    return (
      <p
        id={PASSWORD_REQUIREMENTS_ID}
        {...passwordRequirementsLiveProps}
        className="mt-2 flex items-center gap-2 text-sm text-success-foreground"
      >
        <Check className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span>Password meets requirements</span>
      </p>
    )
  }

  if (hasInput || highlightFailures) {
    return (
      <ul
        id={PASSWORD_REQUIREMENTS_ID}
        {...passwordRequirementsLiveProps}
        className="mt-2 space-y-1"
      >
        {unmetRules.map((rule) => (
          <li
            key={rule.id}
            className="flex items-center gap-2 text-sm text-destructive"
          >
            <Circle
              className="h-3.5 w-3.5 shrink-0 text-destructive"
              aria-hidden="true"
            />
            <span>{rule.label}</span>
          </li>
        ))}
      </ul>
    )
  }

  return (
    <ul
      id={PASSWORD_REQUIREMENTS_ID}
      {...passwordRequirementsLiveProps}
      className="mt-2 space-y-1"
    >
      {rules.map((rule) => (
        <li
          key={rule.id}
          className="flex items-center gap-2 text-sm text-muted-foreground"
        >
          <Circle
            className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
            aria-hidden="true"
          />
          <span>{rule.label}</span>
        </li>
      ))}
    </ul>
  )
}
