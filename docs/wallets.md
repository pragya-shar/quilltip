# Stellar wallets

Quilltip connects wallets through Stellar Wallets Kit 2.8.0, the newest
release (October 2026). This page lists the main Stellar wallets, what each
can do for Quilltip on testnet, and which ones the app offers. The code that
reads it is `lib/stellar/wallet-catalog.ts` (one entry per wallet),
`lib/stellar/v2/wallet.ts` (the adapter) and `lib/stellar/v2/wallet-errors.ts`
(one error mapping per wallet).

Every v2 flow and the address proof sign as the **transaction source** only
(spec section 6.1, step 4). A wallet therefore needs transaction signing,
including Soroban `invokeHostFunction` envelopes, on Stellar testnet. Message
signing is optional: without it the address proof signs a challenge
transaction instead. Auth-entry signing is not used.

## Offered

| Wallet                      | Kind                          | Kit module | Soroban tx       | Message (SEP-53) | Auth entry | Testnet                                        | Reports network | Needs from the page                                  |
| --------------------------- | ----------------------------- | ---------- | ---------------- | ---------------- | ---------- | ---------------------------------------------- | --------------- | ---------------------------------------------------- |
| Varial (formerly Freighter) | Extension                     | `varial`   | Yes              | Yes              | Yes        | Yes (Mainnet, Testnet, Futurenet, custom)      | Yes             | Injected API (`window.stellar`); site on allow list  |
| xBull                       | Extension, or web wallet      | `xbull`    | Yes              | Yes              | No         | Yes (passphrase sent with each request)        | No              | `window.xBullSDK`, or a pop-up to `wallet.xbull.app` |
| Rabet                       | Extension                     | `rabet`    | Unverified       | No               | No         | Yes (`sign(xdr, 'testnet')`)                   | No              | `window.rabet`                                       |
| Hana                        | Extension                     | `hana`     | Unverified       | Yes              | Yes        | Unverified (passphrase sent with each request) | No              | `window.hanaWallet.stellar`                          |
| Scopuly                     | Extension, paired with an app | `scopuly`  | Unverified       | Yes              | Yes        | Yes                                            | Yes             | `window.scopuly`                                     |
| D'CENT                      | Extension and in-app browser  | `dcent`    | Yes (per D'CENT) | Yes              | Yes        | Yes                                            | Yes             | `window.stellar` + `window.dcentStellarProvider`     |
| Albedo                      | Web wallet                    | `albedo`   | Yes              | No (not SEP-53)  | No         | Yes (`network` on each request)                | No              | A pop-up to `albedo.link`; an iframe (`frame-src`)   |

"Unverified" means the wallet's documentation does not say, and no testnet
run with the real wallet has been made yet. The manual checks in issue #493
cover these.

Checked with a real wallet so far (issue #512): Varial (Freighter extension)
in Chrome on testnet. The picker detects it, it shows the wrong-network state
when the wallet is on Mainnet, connect and the address proof pass, and no
content security policy violation appears.

**Locked and refusal**, as each wallet reports them (after the kit turns
every error into `{ code, message }`):

| Wallet  | Locked                                                                 | Refused                                                                                                  |
| ------- | ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Varial  | -1 "The wallet is locked. Unlock Varial and try again."; or no address | -4 "The user rejected this request."                                                                     |
| xBull   | Not documented                                                         | "Request rejected from the wallet"; closing its window ends the stream empty ("no elements in sequence") |
| Rabet   | `isUnlocked()` false; text not documented                              | Text not documented                                                                                      |
| Hana    | Not documented                                                         | Not documented                                                                                           |
| Scopuly | `{ error: { code, message } }`; values not documented                  | Same shape                                                                                               |
| D'CENT  | No address: "Getting the address from D'CENT is not allowed…"          | `{ error }`; values not documented                                                                       |
| Albedo  | Not applicable (web wallet)                                            | -4 "Action request was rejected by the user." Closing its window sends nothing                           |

### What Quilltip does for each

- **One error mapping.** `classifyWalletError` checks the wallet's own rules
  (`WALLET_ERROR_RULES`), then shared ones, and returns one of: `no-wallet`,
  `locked`, `wrong-network`, `rejected`, `unsupported`, `popup-blocked`,
  `timeout`, `wrong-account`, `cancelled` or `failed`. The copy names the
  wallet and the fix.
- **Network.** Wallets that report their network are refused before any
  prompt when they are not on testnet. For wallets that cannot (xBull, Rabet,
  Hana, Albedo), the adapter checks the returned signature: a signature by the
  connected key that does not verify over the testnet transaction hash was
  made for another network. The tip is refused ("Switch your wallet to
  Testnet … Nothing was sent.") and nothing is submitted.
- **Web wallets.** xBull without its extension and Albedo open their own
  window. A blocked pop-up fails at once with `popup-blocked`; a window the
  reader closes fails as `rejected` a second later, because Albedo never
  answers a closed window.
- **Capabilities.** A wallet that cannot sign what a request needs fails with
  `unsupported` before it is prompted: a Soroban envelope for a wallet that
  signs classic transactions only, or a message for Rabet and Albedo (the
  address proof then signs a transaction).
- **Picker.** Three groups: "In this browser" (installed extensions), "No
  install needed" (xBull's web wallet, Albedo) and "Not installed" (install
  links). The picker opens without any extension, so a reader can always use
  a web wallet.

### Albedo over http

The kit and earlier Quilltip code treated Albedo as HTTPS-only. Albedo's
source requires `https:` only for its `wallet_redirect` callback. Checked on
27 November 2026 against `albedo.link` from `http://127.0.0.1` and
`https://127.0.0.1` (a local self-signed origin): both showed Albedo's request
screen, and both received `-4 "Action request was rejected by the user."` on
Reject. Albedo is therefore offered on http pages too. Approving needs an
Albedo account and was not run. The picker keeps a generic "unavailable here"
state, with the reason, for wallets that need HTTPS.

## Not offered

| Wallet                                 | Why                                                                                                                                                                                                                                                                                                                                                            |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| LOBSTR signer extension                | It has no Stellar testnet: the kit drops the network passphrase and the extension signs for mainnet. Quilltip would refuse every signature. Worth adding when mainnet is in scope.                                                                                                                                                                             |
| HOT Wallet                             | The kit module reports Stellar mainnet and sends no network with a signing request. It also needs `global` and `Buffer` polyfills. A scoped polyfill is possible, but the wallet still could not sign testnet transactions.                                                                                                                                    |
| MetaMask (`@metamask/connect-stellar`) | Mainnet (`stellar:pubnet`) only.                                                                                                                                                                                                                                                                                                                               |
| Ledger                                 | The kit signs the bare transaction hash unless the app passes `nonBlindTx`, and the Stellar app has blind signing off by default since v6.0.0. The module needs the kit's own account chooser to know which path signs, and a `Buffer` polyfill. The Ledger Stellar app does parse Soroban calls, so a clear-signing path is possible; see "Hardware wallets". |
| Trezor                                 | Trezor firmware 2.12.4 and Connect 10.0.1 can sign `invokeHostFunction`, but the kit's Trezor converter has no Soroban fields and pins Connect `10.0.0-beta.1`. It also needs a manifest with a contact email, Trezor's Connect pop-up and iframe in the content security policy, and a `Buffer` polyfill.                                                     |
| Klever, OneKey, Bitget                 | In the kit with no extra setup, but their testnet support is not documented. Candidates once checked.                                                                                                                                                                                                                                                          |
| Fordefi, Cactus Link                   | Institutional custody extensions that need an organisation account.                                                                                                                                                                                                                                                                                            |
| GHOSTSIG                               | Beta passkey web wallet. Soroban calls are signed without being decoded (a checkbox).                                                                                                                                                                                                                                                                          |
| Solar                                  | No dApp connection and no release since February 2022.                                                                                                                                                                                                                                                                                                         |

### Hardware wallets

Ledger could be offered without a policy change: WebUSB needs a secure
context (production is HTTPS) and the default `Permissions-Policy` already
allows `usb` for the site. It would need:

1. A `Buffer` polyfill scoped to the Ledger module's chunk.
2. An account step: the kit's `getAddresses()` fills the paths the module
   signs with; Quilltip's picker does not call it today.
3. Signing with `nonBlindTx: true`, so the device shows the contract call
   instead of a hash, and a clear message when the device refuses
   (`0x6C66`, blind signing off; `0x6985`, refused).

That is a separate change with a real device to test on. Trezor needs a kit
release whose converter supports Soroban.

## WalletConnect

Mobile wallets (Varial, LOBSTR, Scopuly and others on a phone) connect over
WalletConnect when `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` holds a Reown
project ID. Unset or blank turns it off; a value that is not 32 lowercase
hexadecimal characters stops the build, the dev server and the wallet
(`lib/stellar/v2/walletconnect-gate.ts`).

### Dependency decision

Quilltip does **not** use the kit's WalletConnect module. It has its own
module, `lib/stellar/v2/walletconnect-module.ts`, on
`@walletconnect/sign-client` 2.23.0 (the version the kit uses).

- **zod.** Reown AppKit pins zod 3.22.4 in every release up to the latest
  (2.0.0). Zod 3 has a high-severity advisory with no zod 3 fix
  (GHSA-mrhx-c7xc-m3w5, fixed in 4.6.6), so letting AppKit keep zod 3 would
  fail the dependency audit. The app's override resolves it to zod 4.6.7,
  which behaves the same for AppKit's schemas except one rule: zod 4 refuses
  an object whose `z.any()` field is absent, and zod 3 accepted it (3 of 2,586
  generated inputs differ; `scripts/security/compatibility/reown-zod.test.ts`).
  AppKit's only zod code is its embedded email and social login. The sign
  client has no zod. With Quilltip's module, AppKit is never loaded, so no
  zod-dependent code runs; the override stays only for the audit, because
  the kit still installs AppKit.
- **Size.** The sign client adds about 141 KB gzipped, loaded only when a
  reader chooses a mobile wallet; the kit's module with AppKit adds about
  567 KB.
- **Connections.** The kit's module starts the sign client and AppKit when it
  is constructed, which opens a relay connection whenever the picker lists
  wallets. Quilltip's module connects only when a reader chooses it, with
  WalletConnect telemetry off.
- **Pairing step.** Quilltip draws its own: a QR code on a computer, an
  "Open in your wallet app" link on a phone, a copy button, and a way back.

### Behaviour

| Event                                            | App state                                              |
| ------------------------------------------------ | ------------------------------------------------------ |
| Pairing approved on the phone, `stellar:testnet` | Connected; the network is checked on each signature    |
| Paired, but the wallet offers mainnet only       | `wrong-network`; the session is closed                 |
| The phone declines the pairing (5000)            | `rejected`                                             |
| The pairing proposal expires (5 minutes)         | `timeout`                                              |
| The reader goes back or closes the picker        | Not an error; the pairing stops                        |
| A live session from earlier                      | Reused without a new code                              |
| The phone ends the session, or it expires        | The app disconnects; a later request is `disconnected` |
| Disconnect in Quilltip                           | The session is ended on the phone too                  |
| A request refused on the phone (5000, 4001)      | `rejected`                                             |
| "Please switch to … in Varial Settings"; 5100    | `wrong-network`                                        |
| A signature made for mainnet                     | `wrong-network`, nothing sent                          |
| No `stellar_signMessage` in the session          | `unsupported`; the address proof signs a transaction   |
| No `stellar_signXDR` in the session; 5101        | `unsupported`                                          |
| The phone never answers a request                | `timeout` after 5 minutes                              |

Every request names `stellar:testnet` and signs as the source account only.
Deep links use the `wc:` URI, which Android hands to an installed wallet; on
iOS a wallet's own universal link is more reliable and is not used yet.

### Content security policy

With a project ID only: `connect-src wss://relay.walletconnect.org` (the
relay) and `frame-src https://verify.walletconnect.org
https://verify.walletconnect.com` (Verify registers the page's origin from a
hidden iframe; the client tries both hosts). No Reown AppKit, API, font,
image or analytics host is allowed.

### Checked against the real relay

With the project ID, from `http://localhost:3124` and the app's own content
security policy: the page connected to `wss://relay.walletconnect.org`,
loaded the Verify attestation frame from `verify.walletconnect.org`, and
showed the pairing code, with no console error and no policy violation. No
other WalletConnect or Reown host was contacted. Approving on a phone was not
part of this check.

### Licence and plan

`@walletconnect/sign-client` 2.23 is distributed under the WalletConnect
Community License. It requires a commercial licence above 500 monthly active
users or 2,500,000 monthly remote processing calls; it counts a user as a
unique account that authenticates and connects to the app in 30 days. The
Reown pricing page counts its 500 Starter users as sign-in-with-wallet or
embedded-wallet users, which Quilltip does not use. Quilltip uses its own
Stellar RPC and no Reown RPC.

### Reown project settings

Allowed origins. Once a domain is listed, only listed domains can use the
project, and Verify marks a pairing verified when the page's origin matches
the metadata URL, which the app sets to its own origin. No file or DNS record
is needed on the domain:

- Production: `https://www.quilltip.me` (`https://quilltip.me` redirects to it).
- Integration preview (`overhaul/v2` branch alias):
  `https://quilltip-git-overhaul-v2-pragya-sharmas-projects-a6320130.vercel.app`.
  Per-deployment preview URLs change with each build and are not listed.
- Local development: `http://localhost:3000` and `http://127.0.0.1:3000`, plus
  any other port a developer runs on (for example `http://localhost:3124`).

## Sources

- Stellar Wallets Kit 2.8.0 source and docs:
  <https://github.com/Creit-Tech/Stellar-Wallets-Kit/tree/v2.8.0/src>,
  <https://stellarwalletskit.dev>
- Varial: <https://docs.varialwallet.com>,
  <https://github.com/stellar/freighter>
- xBull: <https://github.com/Creit-Tech/xBull-Wallet-Connect>,
  <https://github.com/Creit-Tech/xBull-Wallet>
- Albedo: <https://github.com/stellar-expert/albedo>
- LOBSTR signer extension: <https://github.com/Lobstrco/signer-extension-api>
- Rabet: <https://docs.rabet.io>
- Scopuly: <https://extension.scopuly.com/docs/provider-api/>
- D'CENT: <https://dev-docs.dcentwallet.com/in-app-browser/stellar-network>
- OneKey: <https://developer.onekey.so/en/connect-to-software/provider/stellar/api-reference>
- HOT Wallet: <https://www.npmjs.com/package/@hot-wallet/sdk>
- MetaMask: <https://github.com/MetaMask/connect-stellar>
- Ledger Stellar app: <https://github.com/LedgerHQ/app-stellar>
- Trezor: <https://github.com/trezor/trezor-firmware>,
  <https://github.com/trezor/trezor-suite>
- Fordefi: <https://docs.fordefi.com/user-guide/work-with-dapps/stellar-dapps.md>
- GHOSTSIG: <https://ghostsig.dev>
- Solar: <https://github.com/satoshipay/solar>
