# Payments v2 specification

Status: draft for review. Network scope: Stellar **testnet** only. A later
mainnet release changes configuration, keys and review gates, not this design
([section 8](v2/08-testing-and-deployment.md#85-mainnet-release-differences)).

This specification defines the v2 contracts, the payment protocol for
prepaid tabs, and the application integration. Implementation sessions build
from it without further design decisions. Words in **MUST**, **MUST NOT** and
**SHOULD** carry their RFC 2119 meaning.

## Documents

| #   | Document                                                  | Covers                                                                                |
| --- | --------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| 1   | [Architecture and toolchain](v2/01-architecture.md)       | Contract set, boundaries, crate layout, pins, identifiers, shared conventions, errors |
| 2   | [Core contract](v2/02-core-contract.md)                   | Article registry, direct and batch tips, splits, storage, events                      |
| 3   | [Tab contract and protocol](v2/03-tab-contract.md)        | Prepaid tab, session keys, vouchers, receipts, settlement, claims, withdrawal         |
| 4   | [Article NFT contract](v2/04-nft-contract.md)             | Threshold mint, royalties, transfer                                                   |
| 5   | [Flows and administration](v2/05-flows-and-admin.md)      | End-to-end sequences, roles, pause, upgrade, key custody                              |
| 6   | [Application integration](v2/06-app-integration.md)       | Transaction lifecycle, Convex schema and functions, indexer, client, env, migration   |
| 7   | [Security and recovery](v2/07-security-and-recovery.md)   | Threat model, invariants, edge cases, failure recovery                                |
| 8   | [Testing and deployment](v2/08-testing-and-deployment.md) | Test plan, testnet deployment, evidence, mainnet differences, feature map, removals   |

## Summary

- **Three contracts and a treasury account.**
  - `quilltip-core`: article registry plus direct tipping.
  - `quilltip-tab`: prepaid multi-payee tab with off-chain signed vouchers and batched settlement.
  - `quilltip-article-nft`: OpenZeppelin `non_fungible` + `royalties`.
  - Treasury: a classic Stellar account that receives the platform fee.
- **Fee:** a constant 250 basis points. `fee = floor(gross × 250 / 10,000)`, and `net = gross − fee`. Writers receive `net`, and the treasury receives `fee`.
- **Identifiers:** article, highlight and content identifiers travel in contract arguments and contract events. Soroban transactions cannot carry a memo.
- **Verification and indexing:** both use Stellar RPC (`getTransaction`, `getEvents`). The app stops depending on Horizon.
- **Settlement:** on testnet, settlement runs from a Convex action that holds a testnet-only settler key. A hosted relayer can replace it behind the same interface.
- **Network guard:** every new script and server action stays behind the network guard in `scripts/lib/network-guard.ts` and `convex/lib/networkGuard.ts`.

## Measured feasibility

All figures come from a throwaway build of the contracts in this design, run on
2026-11-26 with `soroban-sdk` 28.0.0, OpenZeppelin `stellar-*` =0.8.0, Rust
1.94.1, target `wasm32v1-none`. The SDK test environment enforces mainnet
per-transaction limits. Section numbers refer to the linked documents.

| Measurement                                                                   | Result                                                                                                      |
| ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Compile: sdk 28.0.0 + OpenZeppelin 0.8.0 → `wasm32v1-none`                    | Pass for a Tab-shaped contract (56,390 bytes) and an NFT-shaped contract (124,959 bytes), before `wasm-opt` |
| `settle`, 32 vouchers, every reader and writer distinct (ed25519 verify each) | 33.3 M instructions, 130 write entries, 26,204 write bytes, 13,696 event bytes                              |
| `settle`, 36 vouchers                                                         | 15,408 event bytes. Fits.                                                                                   |
| `settle`, 40 vouchers                                                         | Rejected: events 17,120 > 16,384 bytes                                                                      |
| Batch tip, 10 items, one recipient each                                       | 4.4 M instructions, 23 write entries, 10,320 event bytes                                                    |
| Batch tip, 15 items                                                           | 15,480 event bytes. Fits.                                                                                   |
| Batch tip, 16 items                                                           | Rejected: events 16,512 > 16,384 bytes                                                                      |
| Voucher payload                                                               | 404 bytes (XDR `ScVal::Map`, section 3)                                                                     |

The binding per-transaction limit for both batch paths is the 16,384-byte
contract-events budget, not CPU or storage. The caps in this specification
(`MAX_SETTLE_BATCH = 32`, `MAX_BATCH_ITEMS = 10`, `MAX_BATCH_TRANSFERS = 24`)
keep about 20% headroom. Resource tests ([section 8](v2/08-testing-and-deployment.md))
re-measure each cap on the real contracts.

## Decision record

| Decision                | Choice                                                                        | Section |
| ----------------------- | ----------------------------------------------------------------------------- | ------- |
| Registry and tipping    | One contract (`quilltip-core`)                                                | 1       |
| SDK line                | `soroban-sdk` 28.0.0 with OpenZeppelin =0.8.0. Release gate before mainnet.   | 1       |
| Fee                     | Constant `FEE_BPS = 250`. Changing it needs a contract upgrade.               | 2       |
| Tip history             | Events and Convex only. One cumulative `i128` per (article, token) on chain.  | 2       |
| Tab token               | One token per Tab instance. A second asset gets a second instance.            | 3       |
| Replay-protection state | Temporary storage that lives for the session-key lifetime plus grace          | 3       |
| Settlement access       | `settler` role, plus a writer self-settle path while the key is valid         | 3       |
| Writer payout from tabs | Pull-based `claim`. Anyone may trigger it; funds go only to the recipient.    | 3       |
| NFT threshold           | Gross cumulative total of the article in one configured token, read from Core | 4       |
| Client SDKs             | `@stellar/stellar-sdk` 17.4.x and Stellar Wallets Kit 2.8.x                   | 6       |
| Settler key on testnet  | Convex environment variable, testnet only                                     | 5, 6    |
