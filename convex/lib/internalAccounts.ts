import type { Id } from '../_generated/dataModel'
import type { MutationCtx } from '../_generated/server'
import { normalizeEmail } from './email'

/**
 * Internal (staff) account classification for usage metrics.
 *
 * `INTERNAL_ACCOUNT_EMAIL_DOMAINS` on the Convex deployment lists email
 * domains, comma-separated. A new account whose email domain equals one of
 * them, ignoring case, gets `users.isTestAccount`. Subdomains do not match:
 * `example.com` does not cover `team.example.com`. Empty or unset classifies
 * nothing.
 */
export const INTERNAL_DOMAINS_ENV = 'INTERNAL_ACCOUNT_EMAIL_DOMAINS'

const DOMAIN =
  /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/

// Checked before lower-casing: some non-ASCII letters lower-case to ASCII
// (the Kelvin sign becomes "k"), so a look-alike could otherwise match.
const ASCII = /^[\x21-\x7e]+$/

/** A lower-case domain, or null when the value is not a plain domain name. */
export function normalizeDomain(value: string): string | null {
  const trimmed = value.trim().replace(/^@/, '')
  if (!ASCII.test(trimmed)) return null
  const domain = trimmed.toLowerCase()
  return DOMAIN.test(domain) ? domain : null
}

/** The configured domains. Entries that are not plain domains are ignored. */
export function internalAccountDomains(
  raw: string | undefined = process.env[INTERNAL_DOMAINS_ENV]
): Set<string> {
  const domains = new Set<string>()
  for (const entry of (raw ?? '').split(',')) {
    const domain = normalizeDomain(entry)
    if (domain) domains.add(domain)
  }
  return domains
}

/**
 * The lower-case domain of an email, or null when it is not an email or its
 * domain is not a plain ASCII domain name.
 */
export function emailDomain(rawEmail: string | undefined): string | null {
  if (!rawEmail || !normalizeEmail(rawEmail)) return null
  const trimmed = rawEmail.trim()
  return normalizeDomain(trimmed.slice(trimmed.lastIndexOf('@') + 1))
}

export function isInternalAccountEmail(
  rawEmail: string | undefined,
  domains: Set<string> = internalAccountDomains()
): boolean {
  const domain = emailDomain(rawEmail)
  return !!domain && domains.has(domain)
}

/**
 * Called once when an account is created. Sets the flag for a configured
 * domain and never clears it, so an operator's manual choice stays.
 */
export async function classifyNewAccount(
  ctx: MutationCtx,
  userId: Id<'users'>,
  rawEmail: string | undefined
): Promise<boolean> {
  if (!isInternalAccountEmail(rawEmail)) return false
  const user = await ctx.db.get(userId)
  if (!user || user.isTestAccount === true) return false
  await ctx.db.patch(userId, { isTestAccount: true, updatedAt: Date.now() })
  return true
}
