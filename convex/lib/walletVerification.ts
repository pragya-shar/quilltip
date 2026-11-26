/**
 * Which linked Stellar address counts. Tips, tip attribution and earnings use
 * only an address the user proved control of on the backend's network
 * (convex/walletLink.ts). Rules for addresses linked before proof:
 *
 * - They stay on the account and are shown to the owner as "not verified".
 * - They receive no new tips and are not used to credit new earnings until
 *   the owner verifies them (the wallet flows ask at the next connect).
 * - Tips and earnings already recorded stay where they are: confirmed tip
 *   rows are attributed by author ID, and credited earnings are never
 *   reversed by this rule.
 */

import type { Doc } from '../_generated/dataModel'
import { readChainEnv } from './chain/env'

type LinkedUser = Pick<
  Doc<'users'>,
  | 'stellarAddress'
  | 'stellarAddressVerifiedAt'
  | 'stellarAddressVerifiedNetwork'
>

/** The backend's network passphrase (testnet; the guard refuses others). */
export function walletNetworkPassphrase(): string {
  return readChainEnv().passphrase
}

/** True when `user` proved control of their linked address on this network. */
export function isStellarAddressVerified(
  user: LinkedUser | null | undefined,
  networkPassphrase: string = walletNetworkPassphrase()
): boolean {
  return (
    !!user?.stellarAddress &&
    typeof user.stellarAddressVerifiedAt === 'number' &&
    user.stellarAddressVerifiedNetwork === networkPassphrase
  )
}

/** The linked address when verified, otherwise null. */
export function verifiedStellarAddress(
  user: LinkedUser | null | undefined,
  networkPassphrase?: string
): string | null {
  return isStellarAddressVerified(user, networkPassphrase)
    ? (user!.stellarAddress as string)
    : null
}

/** Owner-facing state of the linked address. */
export type WalletLinkState = 'none' | 'unverified' | 'verified'

export function walletLinkState(
  user: LinkedUser | null | undefined,
  networkPassphrase?: string
): WalletLinkState {
  if (!user?.stellarAddress) return 'none'
  return isStellarAddressVerified(user, networkPassphrase)
    ? 'verified'
    : 'unverified'
}
