import type { AppRouterInstance } from 'next/dist/shared/lib/app-router-context.shared-runtime'
import { toast } from 'sonner'
import { TIP_MIN_CENTS, TIP_MAX_CENTS, TIP_MAX_USD } from '@/lib/constants'
import { redirectToLoginForTip } from '@/lib/tip/redirectToLoginForTip'
import type { PendingTipIntent } from '@/lib/tip/pendingTipIntent'

export type TipAmountFormState = {
  selectedAmount: number | null
  customAmount: string
  message?: string
}

export type ValidateTipAmountResult =
  | { ok: true; amountCents: number }
  | { ok: false }

export function validateTipAmountForm({
  selectedAmount,
  customAmount,
  message,
}: TipAmountFormState): ValidateTipAmountResult {
  const amountCents = selectedAmount || parseFloat(customAmount) * 100

  if (!amountCents || amountCents < TIP_MIN_CENTS) {
    toast.error('Please select or enter a valid amount')
    return { ok: false }
  }

  if (amountCents > TIP_MAX_CENTS) {
    toast.error(`Maximum tip amount is $${TIP_MAX_USD.toFixed(2)}`)
    return { ok: false }
  }

  if (message !== undefined && message.length > 500) {
    toast.error('Message must be 500 characters or less')
    return { ok: false }
  }

  return { ok: true, amountCents }
}

export function signInToTip(
  router: AppRouterInstance,
  returnPath: string,
  form: TipAmountFormState,
  intent: PendingTipIntent
): void {
  const validation = validateTipAmountForm(form)
  if (!validation.ok) return

  const message = form.message?.trim()
  redirectToLoginForTip(router, returnPath, {
    ...intent,
    amountCents: validation.amountCents,
    ...(message ? { message } : {}),
  })
}
