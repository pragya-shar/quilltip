/**
 * The password rule, the same on the server (convex/auth.ts) and in the
 * forms: at least PASSWORD_MIN_LENGTH characters, any characters, spaces
 * included. Length is what makes a password hard to guess; a rule about
 * letter kinds makes it harder to remember, not to guess. The upper bound
 * only keeps hashing bounded: a passphrase of many words fits easily.
 */
export const PASSWORD_MIN_LENGTH = 8
export const PASSWORD_MAX_LENGTH = 256

/** Whether a new password meets the rule. */
export function passwordMeetsRule(password: string): boolean {
  return (
    password.length >= PASSWORD_MIN_LENGTH &&
    password.length <= PASSWORD_MAX_LENGTH
  )
}

/** What is wrong with a new password, in the forms' words; null when it
 * meets the rule. */
export function passwordRuleMessage(password: string): string | null {
  if (password.length < PASSWORD_MIN_LENGTH)
    return `Use at least ${PASSWORD_MIN_LENGTH} characters.`
  if (password.length > PASSWORD_MAX_LENGTH)
    return `Use at most ${PASSWORD_MAX_LENGTH} characters.`
  return null
}

/** For password managers that generate one: the same rule. */
export const PASSWORD_RULES_ATTRIBUTE = `minlength: ${PASSWORD_MIN_LENGTH}; maxlength: ${PASSWORD_MAX_LENGTH};`
