export const PASSWORD_MIN_LENGTH = 8

export const PASSWORD_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/

export type PasswordRuleId = 'minLength' | 'uppercase' | 'lowercase' | 'digit'

export type PasswordRuleStatus = {
  id: PasswordRuleId
  label: string
  met: boolean
}

const PASSWORD_RULES: {
  id: PasswordRuleId
  label: string
  test: (password: string) => boolean
}[] = [
  {
    id: 'minLength',
    label: `At least ${PASSWORD_MIN_LENGTH} characters`,
    test: (password) => password.length >= PASSWORD_MIN_LENGTH,
  },
  {
    id: 'uppercase',
    label: 'One uppercase letter',
    test: (password) => /[A-Z]/.test(password),
  },
  {
    id: 'lowercase',
    label: 'One lowercase letter',
    test: (password) => /[a-z]/.test(password),
  },
  {
    id: 'digit',
    label: 'One number',
    test: (password) => /\d/.test(password),
  },
]

export function getPasswordRuleStatuses(
  password: string
): PasswordRuleStatus[] {
  return PASSWORD_RULES.map(({ id, label, test }) => ({
    id,
    label,
    met: test(password),
  }))
}

export function allPasswordRulesMet(password: string): boolean {
  return getPasswordRuleStatuses(password).every((rule) => rule.met)
}
