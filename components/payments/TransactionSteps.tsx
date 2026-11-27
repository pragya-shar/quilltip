import { Check } from 'lucide-react'
import { STEP_LABEL } from '@/lib/copy/payment-states'
import { WALLET_STEPS } from '@/lib/payments/ui-state'
import { PaymentSpinner } from './PaymentSpinner'
import type { ClientStep } from './payment-types'

type Step = ClientStep | 'checking'

/**
 * The four steps of a wallet-signed transaction: check, approve, send,
 * confirm. Done steps show a tick, the current one turns, later ones wait.
 */
export function TransactionSteps({ current }: { current: Step }) {
  const at = WALLET_STEPS.indexOf(current)
  return (
    <ol className="pay-steps" aria-label="Progress">
      {WALLET_STEPS.map((step, index) => {
        const state =
          index < at ? 'done' : index === at ? 'current' : 'upcoming'
        return (
          <li
            key={step}
            data-step={state}
            aria-current={state === 'current' ? 'step' : undefined}
          >
            <span className="pay-step-marker" aria-hidden="true">
              {state === 'done' ? (
                <Check />
              ) : state === 'current' ? (
                <PaymentSpinner />
              ) : null}
            </span>
            <span className="pay-step-label">
              {STEP_LABEL[step]}
              {state === 'done' ? (
                <span className="sr-only"> (done)</span>
              ) : null}
            </span>
          </li>
        )
      })}
    </ol>
  )
}
