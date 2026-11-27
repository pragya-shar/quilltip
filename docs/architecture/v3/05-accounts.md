# 5. Accounts without a wallet

A reader with no wallet creates an account with a passkey and tips. Existing
wallets stay supported as a way to fund the balance and as the wallet route.

Package: A1 ([work packages](work-packages.md#later-waves)). The core
packages do not depend on it; P6 ships the seam (section 5.1) with three
implementations, and A1 adds the fourth.

## 5.1 The wallet provider seam

`lib/wallet/provider.ts` (P6):

```ts
export type WalletKind = 'extension' | 'walletconnect' | 'injected' | 'passkey'

export type ContractCall = {
  contractId: string
  method: string
  args: xdr.ScVal[]
  /** Upper time bound, Unix seconds. */
  maxTime: number
}

export interface WalletProvider {
  readonly kind: WalletKind
  /**
   * Reads stored state; never prompts and never loads a wallet SDK. For
   * `extension`, `walletconnect` and `injected` this wraps the restore built
   * on `overhaul/v2` (`readRememberedWallet`, section 4.3).
   */
  restore(): Promise<{ status: 'none' } | { status: 'known'; address: string }>
  connect(): Promise<{ address: string }>
  disconnect(): Promise<void>
  /**
   * Signs and submits one contract call from `address`; resolves with the
   * transaction hash once the network accepted it for processing.
   * `self`: the provider builds, signs the envelope and sends through RPC.
   * `sponsored`: the provider signs Soroban auth entries and the fee sponsor
   * submits (section 5.3).
   */
  invoke(
    call: ContractCall,
    opts: { address: string; networkPassphrase: string }
  ): Promise<{ txHash: string }>
  readonly submitMode: 'self' | 'sponsored'
}
```

Every payment path that needs a signature calls `invoke`: the wallet route
(`Core.tip`), add funds (`Tab.deposit`, `open_session`), device setup
(`register_key`), withdrawal and revocation. After `invoke`, the caller
records the hash (`tipsV2.recordSubmitted` or `balance.recordTransaction`)
and the server verifies it ([section 2.4](02-instant-state.md#24-transactions-the-app-sends)).

| Implementation  | Package | Signs                                           | Submit      | Used when                                                         |
| --------------- | ------- | ----------------------------------------------- | ----------- | ----------------------------------------------------------------- |
| `extension`     | P6      | Envelope, through Stellar Wallets Kit           | `self`      | Desktop browser with an extension                                 |
| `walletconnect` | P6      | Envelope, through the v2 WalletConnect module   | `self`      | Phone browser with a phone wallet                                 |
| `injected`      | P6      | Envelope, through the wallet's in-page provider | `self`      | Inside a wallet's in-app browser: chosen automatically, no picker |
| `passkey`       | A1      | Soroban auth entries, with WebAuthn             | `sponsored` | Accounts created with a passkey                                   |

Provider choice: an account created with a passkey uses `passkey`; otherwise
the provider stored by the last connect (`quilltip:wallet:v1.kind`); in a
wallet's in-app browser, `injected`. The picker lists only the providers
that can work on the current device (no desktop extensions on a phone).

## 5.2 Passkey accounts

Mechanism (from the Stellar rails research, proven end to end on testnet):

- `smart-account-kit@0.10.0` in the browser, on the OpenZeppelin
  `stellar-accounts` v0.8.0 smart account with its WebAuthn verifier. The
  default context rule 0 holds the passkey; no policies at first.
- The browser only creates the passkey and signs Soroban auth entries. A
  Convex Node action with our sponsor key builds, pays for and submits every
  transaction (section 5.3).
- Every signed entry passes one context rule id per auth context:
  `Tab.open_session` and `Tab.deposit` have 2 contexts (the call and the
  token transfer), `Core.tip` has 3 with no splits. A wrong count fails with
  contract error 3014. `lib/wallet/passkey.ts` derives the count from the
  simulation's auth tree, not from a table.
- Convex keeps `credentialId → contractId` with the account's creation hash
  and ledger, so a new device signs in without an outside indexer.
- The kit and the deployed account code are not audited at this version.
  Testnet only; a mainnet release needs a review and balance caps.
- Balance tips stay on Tab vouchers signed by the device key (no prompt);
  smart-account session signers are not used for people.

What the v3 contracts need from it: nothing new. `Tab` and `Core` call
`require_auth()` on the reader or tipper address, which a contract account
satisfies through `__check_auth`. The Stellar Asset Contract moves balances of
contract addresses. The Tab account and its session keys work the same for a
`C…` reader.

### Creation (one sheet, two biometric prompts)

1. WebAuthn `create` (prompt 1) through `kit.createWallet(appName, userName,
{ autoSubmit: false })`, which returns the deploy payload.
2. `accounts.createPasskeyAccount({ attestation, deployPayload })` (Convex
   action, A1) verifies the attestation, creates the Convex user, signs them
   in (section 5.4), and submits the deploy with the sponsor key. The account address is set as the user's verified address
   (`users.stellarAddress`, method `passkey`): the server deployed it for this
   credential, so no message signature is needed.
3. On testnet, the sponsor funds practice money (section 5.5).
4. `Tab.open_session` signed by the passkey (prompt 2), submitted by the
   sponsor, registers the device key and deposits the practice money. From
   here every balance tip needs no prompt. Two prompts is the minimum: the
   account cannot exist and authorise in one transaction, and WebAuthn
   `create` signs nothing.

### Where passkeys do not work

Passkeys are unreliable in third-party WebViews (social apps' in-app
browsers). There the sheet offers "Open in your browser" for account
creation. In a wallet's in-app browser, the `injected` provider is used
instead of a passkey: the wallet's classic account is the reader. Detection
follows the rails research (for example `window.stellar.platform ===
'mobile'` for Varial and Freighter mobile, xBull's `cordova_iab`). There the
app still pays fees: it asks the wallet to sign auth entries when the wallet
supports it (`submitMode: 'sponsored'`), and otherwise the wallet signs the
envelope and pays (`self`).

## 5.3 Fee sponsor

A Convex action pays network fees for `sponsored` providers. It runs behind
the same network guard as every chain action (`assertBackendTestnet`, then
`SPONSOR_ENABLED=true`, and only then is `SPONSOR_SECRET` read).

```ts
// convex/sponsor.ts (A1)
export const prepare = mutation({
  args: { call: contractCallValidator }, // contract, method, args (XDR), maxTime
  returns: v.object({
    sponsorRequestId: v.id('sponsorRequests'),
    authEntries: v.array(v.string()),
    networkPassphrase: v.string(),
    validUntilLedger: v.number(),
  }),
})
export const submit = action({
  args: {
    sponsorRequestId: v.id('sponsorRequests'),
    signedAuthEntries: v.array(v.string()),
  },
  returns: v.object({ txHash: v.string() }),
})
```

- `prepare` simulates the call with the user's account as the authorising
  address and returns the auth entries to sign. `submit` builds the
  transaction with the sponsor account as source, attaches the signed
  entries, re-simulates (a WebAuthn signature is larger than the simulation
  placeholder), signs and sends.
- Allowlist: only calls to this deployment's Tab (`deposit`, `open_session`,
  `register_key`, `revoke_key`, `withdraw_now`, `withdraw_start`, `withdraw`),
  Core (`tip`) and the account factory; the authorising address must be the
  signed-in user's account address.
- Fee caps per call: 2,000,000 stroops for a first `open_session` (measured
  about 1,210,000 with the new account entry), 300,000 after.
- Limits: `SPONSOR_MAX_FEE_STROOPS` per transaction, `SPONSOR_DAILY_PER_USER`
  transactions per user, `SPONSOR_DAILY_BUDGET_STROOPS` in all; a refused
  request says so and the sheet offers no workaround.
- The sponsor account's balance alert follows the settler's.

## 5.4 Passkey sign-in

Decision: the passkey becomes an app sign-in method, and an account created
with a passkey needs no email or password.

- A Convex Auth credentials provider `passkey` verifies a WebAuthn assertion
  against the stored credential (`passkeyCredentials` table: user, credential
  id, public key, sign count, transports, created and last-used times).
- The same credential signs in and authorises the smart account. The relying
  party id is the site's domain, so passkeys made on one host do not work on
  another host: preview hosts use email sign-in.
- Email and password stay for existing accounts. A passkey account can add an
  email later, for recovery and for a second device without passkey sync.
- Recovery: synced passkeys (iCloud Keychain, Google Password Manager) cover
  device loss. An account with an unsynced passkey and no email has no
  recovery on testnet; the account screen says so once.

## 5.5 Funding without a wallet

- **Practice money (testnet only).** At account creation the sponsor
  transfers `PRACTICE_GRANT_CENTS` (default 500) of the default token from a
  testnet treasury account to the new account's address. The creation flow's
  second prompt is the `open_session` that registers the device key and
  deposits that amount, so practice money costs no extra prompt. One grant
  per credential, device hash and network address hash
  (`practiceGrants` table). Balance views label it "Practice money"; Convex
  records it as `tabAccounts.tipOnly` so the instant withdrawal does not
  include it.
- **Gift links (later, with the loops work).** On testnet a gift moves from
  the sender to a platform gift account at creation (a token transfer through
  the sender's provider). A claim transfers it from the gift account to the
  recipient's address; the recipient's next deposit (`open_session` for a new
  account) moves it into the balance, and Convex records it as `tipOnly`; an unclaimed
  gift returns after 14 days. Holding a sender's money for a recipient is a
  custody decision for any mainnet release.
- **Add funds from an exchange or card.** Not in v3. On testnet the funding
  sources are a wallet, practice money and gifts.

## 5.6 Tests (A1)

- WebAuthn attestation and assertion verification against fixture
  credentials; sign count regression is refused.
- Sponsor: allowlist (a call to another contract or method is refused, an
  authorising address other than the user's is refused), limits, the network
  guard order, re-simulation after signing.
- A smart account on the local network: `open_session`, a balance tip, a
  wallet-route `Core.tip`, settlement to a `C…` writer.
- Playwright with a virtual authenticator (Chromium CDP): create an account,
  receive practice money, tip, reload, tip again with no prompt.
