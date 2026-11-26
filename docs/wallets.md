# Stellar wallets

QuillTip connects wallets through Stellar Wallets Kit 2.8.0, the newest
release (October 2026). This page lists the main Stellar wallets, what each
can do for QuillTip on testnet, and which ones the app offers. The code that
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

### What QuillTip does for each

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

The kit and earlier QuillTip code treated Albedo as HTTPS-only. Albedo's
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
| LOBSTR signer extension                | It has no Stellar testnet: the kit drops the network passphrase and the extension signs for mainnet. QuillTip would refuse every signature. Worth adding when mainnet is in scope.                                                                                                                                                                             |
| HOT Wallet                             | The kit module reports Stellar mainnet and sends no network with a signing request. It also needs `global` and `Buffer` polyfills. A scoped polyfill is possible, but the wallet still could not sign testnet transactions.                                                                                                                                    |
| MetaMask (`@metamask/connect-stellar`) | Mainnet (`stellar:pubnet`) only.                                                                                                                                                                                                                                                                                                                               |
| Ledger                                 | The kit signs the bare transaction hash unless the app passes `nonBlindTx`, and the Stellar app has blind signing off by default since v6.0.0. The module needs the kit's own account chooser to know which path signs, and a `Buffer` polyfill. The Ledger Stellar app does parse Soroban calls, so a clear-signing path is possible; see "Hardware wallets". |
| Trezor                                 | Trezor firmware 2.12.4 and Connect 10.0.1 can sign `invokeHostFunction`, but the kit's Trezor converter has no Soroban fields and pins Connect `10.0.0-beta.1`. It also needs a manifest with a contact email, Trezor's Connect pop-up and iframe in the content security policy, and a `Buffer` polyfill.                                                     |
| Klever, OneKey, Bitget                 | In the kit with no extra setup, but their testnet support is not documented. Candidates once checked.                                                                                                                                                                                                                                                          |
| Fordefi, Cactus Link                   | Institutional custody extensions that need an organisation account.                                                                                                                                                                                                                                                                                            |
| GHOSTSIG                               | Beta passkey web wallet. Soroban calls are signed without being decoded (a checkbox).                                                                                                                                                                                                                                                                          |
| Solar                                  | No dApp connection and no release since February 2022.                                                                                                                                                                                                                                                                                                         |
| Mobile wallets over WalletConnect      | Kept off by `lib/stellar/v2/walletconnect-gate.ts`. See below.                                                                                                                                                                                                                                                                                                 |

### Hardware wallets

Ledger could be offered without a policy change: WebUSB needs a secure
context (production is HTTPS) and the default `Permissions-Policy` already
allows `usb` for the site. It would need:

1. A `Buffer` polyfill scoped to the Ledger module's chunk.
2. An account step: the kit's `getAddresses()` fills the paths the module
   signs with; QuillTip's picker does not call it today.
3. Signing with `nonBlindTx: true`, so the device shows the contract call
   instead of a hash, and a clear message when the device refuses
   (`0x6C66`, blind signing off; `0x6985`, refused).

That is a separate change with a real device to test on. Trezor needs a kit
release whose converter supports Soroban.

## WalletConnect

Mobile wallets (Varial mobile, LOBSTR mobile, Scopuly and others) connect
through the kit's WalletConnect module, which loads Reown AppKit 1.8.21 and
`@walletconnect/sign-client` 2.23.0. Enabling it needs:

- A Reown project ID (owner action) and app metadata. The module requests
  `stellar:pubnet` unless it is given
  `allowedChains: [WalletConnectTargetChain.TESTNET]`.
- AppKit's email and social login turned off (`appKitOptions.features`, and
  in the Reown dashboard). Reown's only zod code is that login's frame
  messages. Under the app's zod 4 override they parse as under zod 3 except
  one case: zod 4 refuses an object whose `z.any()` field is absent, so a
  frame answer with no payload would be dropped and its request would never
  settle (`scripts/security/compatibility/reown-zod.test.ts`).
- Relay and verification hosts in `connect-src` and `frame-src`
  (`wss://relay.walletconnect.org`, `https://verify.walletconnect.org`,
  Reown's API and pulse hosts), and image hosts for the wallet list.
- Lazy loading on choice: the module adds about 567 KB gzipped (2.0 MB
  minified) to the wallet chunk, against 68 KB for the kit and the seven
  offered modules.
- Session handling: the kit keeps WalletConnect sessions across reloads and
  handles `session_delete` only. Expiry, `session_update` and a wallet on the
  wrong network need app code and tests.

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
