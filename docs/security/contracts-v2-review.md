# Payments v2 contracts security review

Review date: 2026-11-26. Tracking issue: #421.

All contracts in scope run on Stellar **testnet**. This review covers testnet
use only. Mainnet needs the separate release steps in
[section 8.5](../architecture/v2/08-testing-and-deployment.md#85-mainnet-release-differences).

## Result

**Ready for testnet use.** The high and medium findings are fixed and merged.
The low and informational findings are accepted for testnet, with the reasons
below.

- Commit first reviewed: `c597e7a9cce450b35dd23952c25a9142c3950b8d`
- Commit of the final check: `78cd8ffca2c2b5af0c8bfc4d49543ef893bd5c20`

| Severity      | Found | Fixed | Accepted for testnet |
| ------------- | ----- | ----- | -------------------- |
| Critical      | 0     | 0     | 0                    |
| High          | 1     | 1     | 0                    |
| Medium        | 1     | 1     | 0                    |
| Low           | 3     | 0     | 3 (one partly fixed) |
| Informational | 9     | 0     | 9                    |

## Scope

- `contracts/shared`, `contracts/core`, `contracts/tab` and `contracts/article-nft`.
- Specification: [docs/architecture/v2](../architecture/v2/), mainly sections 2 to 5
  and the invariants and threat model in section 7.
- Out of scope:
  - Convex, the client and the indexer;
  - the v1 `tipping` contract;
  - the mainnet timelock and multisig setup.

## Method

- A reviewer that wrote none of these contracts read every source line against
  the specification.
- Separate passes covered Core, Tab, the article NFT, and cross-contract trust
  with upgrade paths.
- Each pass built an authorisation matrix of every entry point and its tests.
  Each pass also covered:
  - funds flow and conservation, arithmetic and rounding;
  - voucher domain separation and replay;
  - storage lifetime and archival, and batch bounds;
  - pause and upgrade powers of each role, and griefing;
  - events.
- Every suspected issue got a local proof-of-concept test. Those tests were
  run again on the final commit.
- Earlier correctness reviews were compared only after this review had formed
  its own findings.

## Checks run on the final commit

| Check                                              | Result                        |
| -------------------------------------------------- | ----------------------------- |
| `cargo test --workspace --locked`                  | Pass                          |
| Core property tests, 3 properties × 20,000 cases   | Pass                          |
| Tab property tests, 2 properties × 50,000 cases    | Pass                          |
| Fuzz `settle_vouchers`, 900 s                      | 340,017 runs, no failure      |
| Fuzz `voucher_decode`, 900 s                       | 17,400,265 runs, no failure   |
| `cargo clippy` (pedantic, at review start)         | No security-relevant warnings |
| CI: reproducible Wasm build, size gate, Wasm tests | Pass                          |
| CI: `cargo audit --deny warnings`                  | Pass                          |

The fuzz runs had no sanitizer: the sanitizer build does not link on macOS.
`cargo deny` and Scout were not run.

## Fixed findings

| Severity | Area      | Change                                                                                                                                                      | PR   |
| -------- | --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- |
| High     | Core      | The article ID is derived from the registering author's address and an app reference, so only that author can register it                                   | #479 |
| Medium   | All three | Only a current upgrader can grant, revoke or re-admin the `upgrader` role, and the last upgrader cannot be removed. This keeps upgrades behind the upgrader | #477 |

Spec updates are in #480 and #477.

## Accepted findings

| Severity      | Item                                                                                                                                                           | Reason accepted for testnet                                                                                                                                                                              |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Low           | Some admin calls do not extend the contract instance lifetime. Role calls in Tab and NFT were fixed in #477; pause, unpause, upgrade and admin transfer remain | Every user call extends the instance, and so does the weekly extend script. Fix before mainnet.                                                                                                          |
| Low           | Role entries start at the network minimum lifetime                                                                                                             | Each role check extends the entry to 90 days. A role entry that goes unused needs a restore, which transaction simulation adds automatically. Add role entries to the extend script. Fix before mainnet. |
| Low           | Core accepts its own address as a split recipient                                                                                                              | Only the article's author can set splits, and the app builds splits from linked user addresses. Fix before mainnet.                                                                                      |
| Informational | Tab accepts its own address as a writer or treasury                                                                                                            | Needs a voucher accepted by the app, or an admin action                                                                                                                                                  |
| Informational | A spec rule on which role may administer `settler` is not enforced on chain                                                                                    | Admin action only. Documented in section 5                                                                                                                                                               |
| Informational | Two event names are shared between Core and Tab                                                                                                                | Events carry the contract address. Indexers key by contract                                                                                                                                              |
| Informational | Tab and NFT constructors emit no configuration events                                                                                                          | Configuration is readable through views                                                                                                                                                                  |
| Informational | Key revocation is enforced by the app's acceptance, not by the contract                                                                                        | Matches the specified design, where the app's acceptance is required for writer settlement and the settler is an app key                                                                                 |
| Informational | Rotating the acceptor to the current key drops the previous key                                                                                                | Operational. The rotation procedure is documented                                                                                                                                                        |
| Informational | An author change does not emit a splits event                                                                                                                  | The author change event carries the new author                                                                                                                                                           |
| Informational | Build hygiene for test-only features                                                                                                                           | Release builds checked: no test-only exports                                                                                                                                                             |
| Informational | The fuzz harness does not build with a sanitizer on macOS                                                                                                      | Tooling only. Fuzz targets run without a sanitizer; Rust panics and assertions are still caught                                                                                                          |

## Residual risks

- **Single operator key:** on testnet one operator key holds the admin and
  upgrader roles, as the specification allows.
- **Trust in the app:** voucher acceptance, revocation and key-validity checks
  depend on the application backend.
- **Not covered here:** the off-chain components have their own reviews.
