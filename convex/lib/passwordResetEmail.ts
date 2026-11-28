import { Email } from '@convex-dev/auth/providers/Email'
import { internal } from '../_generated/api'
import type { ActionCtx } from '../_generated/server'

// Password reset codes are emailed through Resend's HTTP API, so no SDK is
// needed. Configure on the Convex deployment:
//   AUTH_RESEND_KEY   Resend API key (required for reset emails)
//   AUTH_EMAIL_FROM   e.g. "Quilltip <no-reply@your-domain>" (verified sender)
//   SITE_URL          app origin used for the reset link
// Without AUTH_RESEND_KEY the reset flow reports that email is unavailable.
// Delivery runs in a scheduled action, so a request for an existing account
// returns as quickly as one for an unknown email.

export const RESET_CODE_TTL_S = 15 * 60
export const RESET_CODE_LENGTH = 8
export const RESET_UNAVAILABLE = 'PASSWORD_RESET_UNAVAILABLE'

export function passwordResetConfigured(): boolean {
  return Boolean(process.env.AUTH_RESEND_KEY)
}

export function generateResetCode(): string {
  const bytes = new Uint32Array(RESET_CODE_LENGTH)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (n) => String(n % 10)).join('')
}

export function resetLink(code: string): string {
  const origin = (process.env.SITE_URL ?? 'http://localhost:3000').replace(
    /\/$/,
    ''
  )
  // The link carries only the code, in the fragment so it never reaches
  // server or proxy logs; the email address is never in a URL.
  return `${origin}/reset-password#code=${encodeURIComponent(code)}`
}

export function resetEmailText(code: string): string {
  return [
    'Someone asked to reset the password for this Quilltip account.',
    '',
    `Your reset code is ${code}. It expires in ${RESET_CODE_TTL_S / 60} minutes and works once.`,
    '',
    `Reset your password: ${resetLink(code)}`,
    '',
    'If you did not ask for this, ignore this email. Your password stays the same.',
  ].join('\n')
}

export async function deliverResetEmail(to: string, code: string) {
  const key = process.env.AUTH_RESEND_KEY
  if (!key) throw new Error(RESET_UNAVAILABLE)
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: process.env.AUTH_EMAIL_FROM ?? 'Quilltip <onboarding@resend.dev>',
      to: [to],
      subject: 'Your Quilltip password reset code',
      text: resetEmailText(code),
    }),
  })
  if (!response.ok) {
    throw new Error(`Reset email failed with status ${response.status}`)
  }
}

export const ResendPasswordReset = Email({
  id: 'resend-password-reset',
  maxAge: RESET_CODE_TTL_S,
  async generateVerificationToken() {
    return generateResetCode()
  },
  // Convex Auth passes the action context as a second argument.
  async sendVerificationRequest({ identifier: to, token }, ...rest: unknown[]) {
    const ctx = rest[0] as ActionCtx
    await ctx.scheduler.runAfter(0, internal.passwordReset.sendResetEmail, {
      to,
      code: token,
    })
  },
})
