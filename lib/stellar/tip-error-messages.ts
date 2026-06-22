export type TipFailureMessage = {
  title: string
  detail?: string
}

function rawMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  return 'Something went wrong'
}

/**
 * Maps wallet, Stellar, and Convex errors to inline dialog copy.
 */
export function formatTipFailureMessage(error: unknown): TipFailureMessage {
  const raw = rawMessage(error)
  const lower = raw.toLowerCase()

  if (
    lower.includes('user declined') ||
    lower.includes('rejected') ||
    lower.includes('cancelled') ||
    lower.includes('canceled')
  ) {
    return {
      title: 'Wallet prompt was dismissed',
      detail:
        'Approve the transaction in your wallet when you are ready to send the tip.',
    }
  }

  if (raw.includes('Transaction failed on the network')) {
    return {
      title: 'Transaction failed on the network',
      detail:
        'The network did not accept this transaction. Check your balance and try again.',
    }
  }

  if (raw.includes('Transaction timeout')) {
    return {
      title: 'Confirmation timed out',
      detail: raw,
    }
  }

  if (raw.startsWith('Transaction failed') || raw.includes('errorResult')) {
    return {
      title: 'Transaction could not be confirmed',
      detail: raw.length > 320 ? `${raw.slice(0, 317)}...` : raw,
    }
  }

  if (raw.includes('Please wait') && raw.includes('before tipping')) {
    return {
      title: 'Tip cooldown',
      detail: raw,
    }
  }

  if (raw.includes('already linked to a different tip')) {
    return {
      title: 'This transaction is already used',
      detail: raw,
    }
  }

  if (raw.includes('Not authenticated')) {
    return {
      title: 'Session expired',
      detail: 'Sign in again and retry.',
    }
  }

  return {
    title: 'Tip could not be completed',
    detail: raw.length > 280 ? `${raw.slice(0, 277)}...` : raw,
  }
}
