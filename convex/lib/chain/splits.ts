/**
 * Co-author split rules (docs/architecture/v2/02-core-contract.md, section
 * 2.1). Pure: Convex prepare functions and the client form share them, and
 * Core enforces the same rules on chain.
 *
 * 1. `splits` is empty, or has 2 to `MAX_SPLIT_RECIPIENTS` entries.
 * 2. When non-empty: the first recipient is the author, every share is above
 *    zero, the shares sum to 10,000 basis points, recipients are distinct and
 *    none is the treasury.
 */
import { StrKey } from '@stellar/stellar-sdk'

export const MAX_SPLIT_RECIPIENTS = 5
export const SPLIT_BPS_TOTAL = 10_000

export type Split = { recipient: string; bps: number }

export type SplitProblemCode =
  | 'TOO_FEW'
  | 'TOO_MANY'
  | 'FIRST_NOT_AUTHOR'
  | 'INVALID_ADDRESS'
  | 'NOT_POSITIVE'
  | 'NOT_INTEGER'
  | 'DUPLICATE'
  | 'TREASURY'
  | 'SUM'

export type SplitProblem = {
  code: SplitProblemCode
  /** Row the problem belongs to; absent for list-level problems. */
  index?: number
  message: string
}

function isAddress(value: string): boolean {
  return StrKey.isValidEd25519PublicKey(value) || StrKey.isValidContract(value)
}

/** Every rule the splits break, in row order. An empty list is valid. */
export function splitProblems(
  splits: readonly Split[],
  opts: { author: string; treasury?: string | null }
): SplitProblem[] {
  if (splits.length === 0) return []
  const problems: SplitProblem[] = []
  if (splits.length > MAX_SPLIT_RECIPIENTS) {
    problems.push({
      code: 'TOO_MANY',
      message: `Share tips with at most ${MAX_SPLIT_RECIPIENTS - 1} co-authors.`,
    })
  }
  if (splits.length < 2) {
    problems.push({
      code: 'TOO_FEW',
      message: 'Add at least one co-author, or turn sharing off.',
    })
  }
  if (splits[0]?.recipient !== opts.author) {
    problems.push({
      code: 'FIRST_NOT_AUTHOR',
      index: 0,
      message: 'The first share must be yours.',
    })
  }
  const seen = new Set<string>()
  let total = 0
  splits.forEach((split, index) => {
    if (!isAddress(split.recipient)) {
      problems.push({
        code: 'INVALID_ADDRESS',
        index,
        message:
          'This isn’t a valid Stellar address. Copy it again from the co-author’s wallet.',
      })
    } else if (seen.has(split.recipient)) {
      problems.push({
        code: 'DUPLICATE',
        index,
        message: 'This address is already in the list.',
      })
    } else if (opts.treasury && split.recipient === opts.treasury) {
      problems.push({
        code: 'TREASURY',
        index,
        message: 'This address cannot receive a share.',
      })
    }
    seen.add(split.recipient)
    if (!Number.isInteger(split.bps)) {
      problems.push({
        code: 'NOT_INTEGER',
        index,
        message: 'Use at most two decimal places.',
      })
    } else if (split.bps <= 0) {
      problems.push({
        code: 'NOT_POSITIVE',
        index,
        message: 'Each share must be more than 0%.',
      })
    }
    total += split.bps
  })
  if (total !== SPLIT_BPS_TOTAL) {
    problems.push({
      code: 'SUM',
      message: `Shares add up to ${bpsToPercent(total)}%. They must add up to 100%.`,
    })
  }
  return problems
}

/**
 * Parses a percentage with at most two decimals ("12.5", "40") into basis
 * points. Returns null for anything else.
 */
export function percentToBps(text: string): number | null {
  // Accept a trailing percent sign, as in "25%".
  const trimmed = text.trim().replace(/\s*%$/, '')
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(trimmed)) return null
  const [whole, fraction = ''] = trimmed.split('.')
  const bps = Number(whole) * 100 + Number(fraction.padEnd(2, '0'))
  return bps <= SPLIT_BPS_TOTAL ? bps : null
}

/** Basis points as a percentage string without trailing zeros. */
export function bpsToPercent(bps: number): string {
  const sign = bps < 0 ? '-' : ''
  const abs = Math.abs(Math.trunc(bps))
  const whole = Math.floor(abs / 100)
  const fraction = String(abs % 100)
    .padStart(2, '0')
    .replace(/0+$/, '')
  return `${sign}${whole}${fraction ? `.${fraction}` : ''}`
}
