import { Email } from '@convex-dev/auth/providers/Email'

// Password reset codes are emailed through Resend's HTTP API, so no SDK is
// needed. Configure on the Convex deployment:
//   AUTH_RESEND_KEY   Resend API key (required for reset emails)
//   AUTH_EMAIL_FROM   e.g. "QuillTip <no-reply@your-domain>" (verified sender)
//   SITE_URL          app origin used for the reset link
// Without AUTH_RESEND_KEY the reset flow reports that email is unavailable.

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
  // The link carries only the code; the email address is never in a URL.
  return `${origin}/reset-password?code=${encodeURIComponent(code)}`
}

export function resetEmailText(code: string): string {
  return [
    'Someone asked to reset the password for this QuillTip account.',
    '',
    `Your reset code is ${code}. It expires in ${RESET_CODE_TTL_S / 60} minutes and works once.`,
    '',
    `Reset your password: ${resetLink(code)}`,
    '',
    'If you did not ask for this, ignore this email. Your password stays the same.',
  ].join('\n')
}

export const ResendPasswordReset = Email({
  id: 'resend-password-reset',
  maxAge: RESET_CODE_TTL_S,
  async generateVerificationToken() {
    return generateResetCode()
  },
  async sendVerificationRequest({ identifier: to, token }) {
    const key = process.env.AUTH_RESEND_KEY
    if (!key) throw new Error(RESET_UNAVAILABLE)
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: process.env.AUTH_EMAIL_FROM ?? 'QuillTip <onboarding@resend.dev>',
        to: [to],
        subject: 'Your QuillTip password reset code',
        text: resetEmailText(token),
      }),
    })
    if (!response.ok) {
      throw new Error(`Reset email failed with status ${response.status}`)
    }
  },
})
