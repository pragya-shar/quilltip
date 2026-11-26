# Payments v2 specification

Status: final for implementation (review findings resolved on PR #438).
Network scope: Stellar **testnet** only. A later mainnet release needs no
contract redesign. It does need a dependency upgrade, a security review, key
custody changes and a reviewed network-guard change
([section 8.5](v2/08-testing-and-deployment.md#85-mainnet-release-differences)).

This specification defines the v2 contracts, the payment protocol for
prepaid tabs, and the application integration. Implementation sessions build
from it without further design decisions. Words in **MUST**, **MUST NOT** and
**SHOULD** carry their RFC 2119 meaning.

## Documents

| #   | Document                                                  | Covers                                                                                         |
| --- | --------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| 1   | [Architecture and toolchain](v2/01-architecture.md)       | Contract set, boundaries, crate layout, pins, identifiers, shared conventions, errors          |
| 2   | [Core contract](v2/02-core-contract.md)                   | Article registry, direct and batch tips, splits, storage, events                               |
| 3   | [Tab contract and protocol](v2/03-tab-contract.md)        | Prepaid tab, session keys, vouchers, receipts, settlement, claims, withdrawal                  |
| 4   | [Article NFT contract](v2/04-nft-contract.md)             | Threshold mint, royalties, transfer                                                            |
| 5   | [Flows and administration](v2/05-flows-and-admin.md)      | End-to-end sequences, roles, pause, upgrade, key custody                                       |
| 6   | [Application integration](v2/06-app-integration.md)       | Transaction lifecycle, Convex schema and functions, indexer, client, env, migration            |
| 7   | [Security and recovery](v2/07-security-and-recovery.md)   | Threat model, invariants, edge cases, failure recovery                                         |
| 8   | [Testing and deployment](v2/08-testing-and-deployment.md) | Test plan, testnet deployment, evidence, mainnet differences, feature map, removals, issue map |

## Summary

- **Three contracts and a treasury account.**
  - `quilltip-core`: article registry plus direct tipping.
  - `quilltip-tab`: prepaid multi-payee tab with off-chain signed vouchers and batched settlement.
  - `quilltip-article-nft`: OpenZeppelin `non_fungible` + `royalties`.
  - Treasury: a classic Stellar account that receives the platform fee.
- **Fee:** a constant 250 basis points. `fee = floor(gross × 250 / 10,000)`, and `net = gross − fee`. Writers receive `net`, and the treasury receives `fee`.
- **Identifiers:** article, highlight and content identifiers travel in contract arguments and contract events. Soroban transactions cannot carry a memo.
- **Verification and indexing:** both use Stellar RPC (`getTransaction`, `getEvents`). The app stops depending on Horizon.
- **Settlement:** settlement runs from a Convex action that holds a testnet-only settler key, on every deployment that accepts tab tips. A hosted relayer can replace it behind the same interface.
  - Convex countersigns each accepted voucher, so writers can settle their own vouchers.
  - Pause never blocks settlement or exits.
- **Network guard:** every new script and server action stays behind the network guard in `scripts/lib/network-guard.ts` and `convex/lib/networkGuard.ts`.

## Measured feasibility

All figures come from throwaway builds of the contracts in this design, run on
2026-11-26:

- `soroban-sdk` 28.0.0, OpenZeppelin `stellar-*` =0.8.0, Rust 1.94.1, target `wasm32v1-none`.
- The SDK test environment enforced mainnet per-transaction limits.
- An independent review reproduced the event and write-entry figures.
- Instruction counts are native-mode. The same contract registered as Wasm used about 35% more instructions.

| Measurement                                                      | Result                                                                                                                                                                                      |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Compile: sdk 28.0.0 + OpenZeppelin 0.8.0 → `wasm32v1-none`       | Pass for Tab-, NFT- and Core-shaped contracts. These builds were not shaken by the CLI, so the optimised sizes are not yet known ([section 1.3](v2/01-architecture.md#13-dependency-pins)). |
| `settle`, 32 vouchers, all parties distinct, ed25519 verify each | 33.3 M instructions native (45.0 M as Wasm), 130 write entries, 13,696 event bytes                                                                                                          |
| `settle_own`, 32 vouchers, two ed25519 verifies each             | 47.1 M instructions native, 13,696 event bytes                                                                                                                                              |
| `settle`, 38 vouchers / 39 vouchers                              | 16,264 event bytes, fits / rejected (over 16,384)                                                                                                                                           |
| Batch tip, 10 items, 24 transfers, with highlights               | 6.4 M instructions, 37 write entries, 12,024 event bytes                                                                                                                                    |
| Batch tip, 15 items, with highlights                             | Rejected: 16,620 event bytes                                                                                                                                                                |
| Bad signature in a `settle` batch                                | The whole transaction aborts (host trap)                                                                                                                                                    |

**Caps.** For both batch paths, the binding per-transaction limit is the
16,384-byte contract-events budget, not CPU or storage. The caps
(`MAX_SETTLE_BATCH = 32`, `MAX_BATCH_ITEMS = 10`, `MAX_BATCH_TRANSFERS = 24`)
keep 16% to 26% headroom. Resource tests ([section 8](v2/08-testing-and-deployment.md))
re-measure each cap on the CLI-built Wasm.

## Decision record

| Decision                             | Choice                                                                                     | Section |
| ------------------------------------ | ------------------------------------------------------------------------------------------ | ------- |
| Registry and tipping                 | One contract (`quilltip-core`)                                                             | 1       |
| SDK line                             | `soroban-sdk` 28.0.0 with OpenZeppelin =0.8.0. Release gate before mainnet.                | 1       |
| Fee                                  | Constant `FEE_BPS = 250`. Changing it needs a contract upgrade.                            | 2       |
| Tip history                          | Events and Convex only. One cumulative `i128` per (article, token) on chain.               | 2       |
| Tab token                            | One token per Tab instance. A second asset gets a second instance.                         | 3       |
| Replay-protection state              | Temporary storage that lives for the session-key lifetime plus grace                       | 3       |
| Settlement access                    | `settler` role, plus `settle_own` for writers with a Convex countersignature               | 3       |
| Pause scope                          | Pause blocks new funds and keys. Settlement, claims and exits always run.                  | 1, 3    |
| Author change                        | Two single-signer steps (`propose_author`, `accept_author`)                                | 2       |
| Tab and splits                       | Tab tips only for articles without splits. Tab tips do not count toward the NFT threshold. | 3, 4    |
| Royalty                              | Fixed at mint. The setters always fail.                                                    | 4       |
| Tab fee                              | Computed on the cumulative amount paid per pair                                            | 3       |
| Content hash                         | SHA-256 of RFC 8785 canonical article bytes, also used as the Arweave body                 | 1       |
| Writer payout from tabs              | Pull-based `claim`. Anyone may trigger it; funds go only to the recipient.                 | 3       |
| NFT threshold                        | Gross cumulative total of direct tips in one configured token, read from Core              | 4       |
| Client SDKs                          | `@stellar/stellar-sdk` 17.4.x, then Stellar Wallets Kit 2.8.x, as two issues               | 6       |
| Settler and acceptor keys on testnet | Convex environment variables, testnet only, on every deployment that accepts tab tips      | 5, 6    |
