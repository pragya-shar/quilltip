/**
 * What a wallet can spend in native XLM: its balance minus the account
 * reserve and open selling liabilities. Shown in the "Not enough XLM"
 * notice (docs/design-system/payment-states.md, "Amounts"). For display
 * only; the token contract decides on chain.
 */
import type { rpc } from '@stellar/stellar-sdk'

/** Testnet and mainnet base reserve: 0.5 XLM per entry, in stroops. */
export const BASE_RESERVE_STROOPS = BigInt(5_000_000)

type Num = bigint | number | string | { toString(): string }

/** The fields of an `AccountEntry` this reads (SDK 17 plain objects). */
export type AccountEntryLike = {
  balance: Num
  numSubEntries: Num
  ext?: {
    type?: unknown
    v1?: {
      liabilities?: { selling?: Num }
      ext?: { v2?: { numSponsoring?: Num; numSponsored?: Num } }
    }
  }
}

function big(value: Num | undefined): bigint {
  if (value === undefined || value === null) return BigInt(0)
  try {
    return BigInt(value.toString())
  } catch {
    return BigInt(0)
  }
}

/** Spendable stroops for an account entry; never below zero. */
export function spendableStroops(entry: AccountEntryLike): bigint {
  const v1 = entry.ext?.v1
  const v2 = v1?.ext?.v2
  const entries =
    BigInt(2) +
    big(entry.numSubEntries) +
    big(v2?.numSponsoring) -
    big(v2?.numSponsored)
  const spendable =
    big(entry.balance) -
    entries * BASE_RESERVE_STROOPS -
    big(v1?.liabilities?.selling)
  return spendable > BigInt(0) ? spendable : BigInt(0)
}

/** Spendable stroops for an address, or null when RPC cannot say. */
export async function spendableBalance(
  server: Pick<rpc.Server, 'getAccountEntry'>,
  address: string
): Promise<string | null> {
  try {
    const entry = (await server.getAccountEntry(
      address
    )) as unknown as AccountEntryLike
    return spendableStroops(entry).toString()
  } catch {
    return null
  }
}
