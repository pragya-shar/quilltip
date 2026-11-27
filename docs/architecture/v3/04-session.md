# 4. Persistent session

The balance, the wallet link and the device key persist across navigation,
reloads and return visits. No screen asks the reader to connect a wallet to
see their own state.

## 4.1 Why state resets in v2

The providers are already mounted once, in `app/layout.tsx` →
`components/providers/Providers.tsx`. The resets come from what they hold:

1. **The wallet connection is in memory only.** `createWalletAdapter`
   (`lib/stellar/v2/wallet.ts`) keeps `connection` in a closure. After a
   reload it is `null`, and `useStellarWallet` reports `isConnected: false`
   until the reader opens the picker again. The adapter stores no wallet id or
   address (it only migrates the legacy `selectedWalletId` key). The
   wallet restore of section 4.3 replaces this.
2. **The wallet runtime starts inactive on every load.**
   `WalletActivationProvider` holds `isWalletActive` in React state, `false`
   at start; `WalletRuntime` loads only after a component calls
   `activateWallet()`. Until then every gate reads the inactive stub.
3. **Tab state is built per mount.** Each tab surface creates its own
   `TabServices` and context (`TabTipActionLive`, `TabHomeLive`,
   `CollectPanelLive`). On every mount, `useDeviceKey` reads IndexedDB and
   binds key ids, and `useLedgerClock` reads the latest ledger from RPC and
   polls it every 60 s. Availability stays `loading` until both answer, so
   each navigation to an article shows a loading tip control.
4. **Reads need a verified address.** Every tab query starts from
   `verifiedStellarAddress(user)`. Without it, or after an address change,
   the reader's own balance is not shown.
5. **Per-page RPC reads.** Wallet funds, Tab limits and the claimable amount
   are read from RPC by the surface that shows them, with no cache.

## 4.2 The session runtime

One provider, `SessionProvider` (`components/providers/SessionProvider.tsx`,
package P6), mounted in `Providers.tsx` inside `ConvexAuthProvider`, replaces
`WalletActivationProvider` and `WalletProvider`. It lives for the page load
and is never remounted by navigation.

| Part     | Source                                                                                                                 | Loaded                                      | Kept                                       |
| -------- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- | ------------------------------------------ |
| Account  | `balance.session` (reactive, keyed by the signed-in user)                                                              | At sign-in, by Convex                       | Convex subscription for the page load      |
| Snapshot | `localStorage` `quilltip:session:v1:<userId>` (balance and limits only)                                                | First render, synchronously                 | Rewritten on each `balance.session` change |
| Device   | Session key store (IndexedDB `quilltip-tab`, v2 format, non-extractable)                                               | Once, after sign-in                         | In memory; re-read after a key operation   |
| Wallet   | Verified address from `balance.session`; remembered choice from `readRememberedWallet`; `useWallet` once the kit loads | First render (remembered choice), no prompt | Module state for the page load             |
| Clock    | `balance.session.ledger` (from the indexer cursor and the settler)                                                     | With `balance.session`                      | Estimated forward between updates          |
| Outbox   | IndexedDB `quilltip-session`, store `outbox` (section 1.9)                                                             | Once, after sign-in                         | Until each entry is answered               |

`useSession()` returns the combined `SessionState`
([interfaces](interfaces.md#i2-headless-hooks)). `useBalance`, `useTip`,
`useActivity` and `useEarnings` read from it; none of them creates services
or reads RPC on mount.

### First paint

- Signed in, snapshot present: the balance renders from the snapshot with
  `stale: true` on the first frame (the UI may dim it), then from Convex.
- The tip control is ready when `balance.session`, the device key and
  `tipContext` are present. On client navigation all three are already in
  memory (the session for the page load; `tipContext` is subscribed by the
  tip control and returns in one Convex round trip, about 50 ms on a warm
  socket).
- The snapshot holds no keys, signatures or addresses beyond the account
  address, and is deleted at sign-out.

### Ledger clock

v2 read the latest ledger from RPC in every surface. v3 serves it from
Convex: `balance.session.ledger = { sequence, closedAt }` from
`chainCursor.lastLedger` and its close time, updated by the indexer and the
settler. The client advances it by elapsed time (5 s per ledger), as v2's
`estimateLedgerTime` does. Key expiry and withdrawal dates need ledger
precision of minutes, not seconds.

## 4.3 Wallet restore

Built on `overhaul/v2` (issue 562, PR 569) and taken by merge; v3 adds no
second mechanism. What it builds:

- **Remembered choice, per reader.** While a reader is signed in, the last
  wallet choice is kept in `localStorage` under
  `quilltip:wallet:v1:<user ID>` as `{ walletId, address }`, nothing else
  (no network, no secret). `lib/wallet/remembered-wallet.ts` holds it:
  `readRememberedWallet(storage, userId)` is a small synchronous read with no
  wallet code, usable at first paint without loading the wallet kit. A
  malformed record, or one that names a wallet Quilltip does not offer, is
  removed and nothing is selected.
- **Silent or nothing.** Where the wallet runtime is loaded, the app
  reconnects the remembered wallet only through a read that cannot prompt,
  and only when the wallet still reports the remembered address. Otherwise
  the wallet stays disconnected and the wallet controls show "Last used:
  <wallet>, <address>" and wait for the reader. Which wallets can restore
  silently is a catalog property (`silentRestore`); `docs/wallets.md` lists
  each wallet's behaviour.
- **One signing gate.** `signTransaction` checks the account and the network
  again before every signature, so a restored connection is an ordinary
  connection. The stored address is never used to sign.
- **Disconnect and sign-out.** Disconnect forgets the reader's choice (and
  the wallet kit's copy) and ends a WalletConnect session. Sign-out, or
  another reader signing in, forgets the previous reader's choice; the
  sign-in pages forget every reader's choice while signed out.
- **Hook state.** `useWallet` gains `isRestoring` (the silent check is
  running; it does not set `isLoading`, so nothing that waits on the wallet
  waits on the restore) and `lastUsed` (`{ walletId, walletName, address }`
  when the remembered wallet did not reconnect).
- No Convex change, and no change to `app/layout.tsx` or `hooks/tab/`.

What v3 adds on top:

1. **"Wallet linked" without the kit.** The session runtime derives
   `SessionState.wallet` from three sources and loads no wallet code to do
   it: the account's verified address from `balance.session.wallet`
   (`users.stellarAddress`, the same on every device), the remembered choice
   from `readRememberedWallet(localStorage, userId)`, and, once the wallet
   runtime is loaded, `useWallet`'s `isConnected`, `isRestoring` and
   `lastUsed`. Routing rule R6 ([section 1.1](01-tip-pipeline.md#11-routing))
   needs only the verified address; the wallet route's confirm step shows the
   remembered wallet's name when one exists.
2. **A balance tip never waits on wallet state.** The balance route uses the
   device key and `balance.session` only. It never reads `isLoading`,
   `isRestoring` or the connection, and the tip control is ready while the
   wallet is restoring, disconnected or not installed.

### Sign-in transition

A guard that redirects before `useConvexAuth` reports the new session after
sign-in is tracked as issue 575 on `overhaul/v2`; v3 takes the fix by merge
and designs no second one. The session runtime treats `auth: 'loading'` as
neither signed in nor signed out, so it neither clears nor writes per-user
state during that transition.

## 4.4 Server state keyed by the user

Every v3 read takes the user from `getAuthUserId` and finds the reader's Tab
account with `tabAccounts.by_user`, not with `verifiedStellarAddress`:

- `balance.session`, `activity.mine`, `earnings.mine` and `balance.tipContext`
  work with no wallet connected and no wallet extension installed.
- One **account address** per user and epoch: the address that owns the
  user's Tab accounts (`tabAccounts.readerAddress`, one per token). It is the
  verified wallet address today, and the passkey account address for
  passkey users ([document 5](05-accounts.md)). Changing it needs a zero
  balance; `balance.session.accountAddress` exposes it.
- The writer's earnings follow `authorId` (the user), as v2's `authorEarnings`
  already does; the per-address `tabVouchers.by_writer` scans are replaced
  by `by_author`.

## 4.5 Devices

One session key per device and account address.

- **Spend bound.** Each key is registered with `spend_limit` equal to the
  Tab's `max_balance` ([contracts C1](contracts.md#decisions)), and tips are
  bounded by the cent limits in Convex (section 1.3). A deposit needs a new
  key only when the key's remaining headroom is below the deposit; that
  deposit then uses `open_session`.
- **One key, several Tabs.** With one Tab per token, the device key is
  registered in each Tab the reader funds, by the first deposit into it.
- **Lifetime.** 90 days (`MAX_KEY_LIFETIME`). When the key has less than 14
  days left, the next deposit uses `open_session` with a new key, so renewal
  rides on an approval the reader is already giving. If no deposit happens,
  the route falls to `device-setup` one day before expiry.
- **New device.** The first balance tip on a device routes to `device-setup`
  (R5): one approval registers the device key; the tip follows from the
  balance. Convex verifies the registration by hash (section 2.4), so the
  wait after approval is one ledger.
- **List and remove.** `balance.session.devices` lists keys with a label
  (`navigator.userAgentData` brand or a parsed user agent, stored at
  declaration), the last use and the expiry. `balance.forgetDevice({ keyId })`
  stops acceptance under the key at once (v2 `revokedInApp`), needs no
  wallet, and the device deletes its local key if it is this device. On-chain
  `revoke_key` is optional ("Remove everywhere" in settings) and costs one
  approval.
- **Lost device.** A key alone cannot pay: `settle` is settler-only and
  accepts only vouchers Convex accepted, and Convex accepts only for the
  signed-in user. Forgetting the device in the app ends it.

## 4.6 Sign-out

1. Close the Convex auth session (Convex Auth `signOut`).
2. Delete the snapshot and the outbox entries of that user.
3. Keep the device key in IndexedDB. It is bound to the account address and
   is useless without that user's session (4.5). The next sign-in of the
   same user on this device tips at once.
4. The wallet choice is forgotten by the v2 wallet restore (section 4.3):
   the reader's `quilltip:wallet:v1:<user ID>` record and the kit's copy are
   removed and WalletConnect sessions end.
5. Settings offer "Remove this device" (4.5) for a shared computer.

## 4.7 Multi-device consistency

All writes go through Convex mutations, so two devices of one reader see each
other's tips through the same reactive queries. A pair is
`(reader, keyId, writer)` and each device has its own key, so two devices
tipping the same writer at once write two different pairs: both are
accepted and both settle. The only shared pair is two browser tabs on one
device (one key); `balance.send` serialises them, and the second re-signs
(`BALANCE_PAIR_CHANGED`, section 1.8) after the v2 local ledger's re-read
(`decideStepTwo`). Each reader still has one Tab balance, so the two devices
draw on the same `available`, which `balance.send` checks inside the
accepting mutation.

## 4.8 Tests

- Wallet restore: the v2 suites of issue 562 (`e2e/wallet-restore.spec.ts`,
  `scripts/wallet/remembered-wallet.test.ts`, `scripts/wallet/wallet-adapter.test.ts`)
  run on `overhaul/v3` after the merge. v3 adds: `SessionState.wallet` is
  derived without loading the kit; the tip control is ready while
  `isRestoring` is true and with the wallet disconnected; a balance tip
  completes with no wallet installed.
- Component: `SessionProvider` mounts once across a client navigation
  (render count); the tip control is `ready` on the first render after
  navigation; the snapshot renders before Convex answers and is replaced.
- `convex-test`: `balance.session` for a user with no verified wallet returns
  a `none` balance, not null; for a user with a changed wallet address it
  still returns the account.
- Playwright (phone viewport, local backend): tip, navigate to another
  article, tip again with no loading state; reload, tip again with no
  connect prompt; sign out and in, tip at once; second browser context as a
  second device goes through `device-setup` once.
