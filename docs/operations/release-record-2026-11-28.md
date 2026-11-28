# Release record: payments v2 on the live site, 2026-11-28

Payments v2 went live on the Quilltip site on 2026-11-28, on **Stellar
testnet**. Testnet XLM has no monetary value. It took three windows on the
live Convex deployment, each run under an owner-approved window
([cutover runbook](payments-v2-cutover.md), section 5.0.3). Times are UTC.
The live contract set is recorded in
[v2-testnet-deployment.md](../contracts/v2-testnet-deployment.md), section
"Contract set: live".

## Window 1 (10:15 to 13:15): release 1, v2 switched on, then off

- Release 1: tag `payments-v2-cutover.1` at `f84018dd`. A snapshot was taken
  before any change.
- 10:27:44: backend pushed. 10:29:25: #655 merged into `main` (`61fd9b13`).
  By 10:33 the site was promoted and its health check passed.
- Stage 3: live contract IDs, epoch `testnet-2026-11-28` and start ledger
  `5966155` set. 11:42: `SETTLEMENT_ENABLED=true`.
- Stage 4: 52 tips, 109 passage tips and 6 NFT records labelled as v1; the
  claim record checks were clean.
- 11:48:15: v1 frozen; the drain reached 0. Stage 5A rebuilt 5 of 5 writer
  rows.
- 12:15:42: `CHAIN_V2_ENABLED=true`.
- **Settler key refused.** From 11:47, every settler run failed with
  `TAB_SETTLER_UNAVAILABLE`: the saved `TAB_SETTLER_SECRET` was not a valid
  seed. v2 had been switched on without first reading a successful settler
  run. 12:25:07: `CHAIN_V2_ENABLED=false`. The rest of the release stayed
  live.
- Not applied: the optional v1 cleanup (`legacyTipCleanup:run`,
  `authorEarningsBackfill:run`). Its dry runs would have changed most v1
  rows and the stored earnings, so it needs review first.

Between windows 1 and 2 the settler key was rotated on 2026-11-28
([v2-testnet-deployment.md](../contracts/v2-testnet-deployment.md),
"Settler key rotation").

## Window 2 (14:54 to 15:54): v2 switched on, then off

- 14:55:42: `CHAIN_V2_ENABLED=true`. Direct, passage and batch tips were
  confirmed.
- **Acceptor key refused.** The first tab tip refused with
  `TAB_ACCEPTOR_UNAVAILABLE`: the saved `TAB_ACCEPTOR_SECRET` was not usable. Before the switch-on, no check showed this: the config refresh
  treated an invalid acceptor secret as acceptance being off.
- 15:01:14: `CHAIN_V2_ENABLED=false`.

Fixes merged before window 3: one successful settler run and a checked
acceptor key are required before the switch-on (#684), and tab tips are
offered only while the settlement keys are ready (#693).

## Window 3 (17:27 to 18:27): release 2, v2 on

- Release 2: tag `payments-v2-cutover.2` at `0c644569`. A snapshot was taken
  first. The dry run showed two new indexes (on `tabOutsideEvents`) and none
  deleted.
- 17:29:31: backend pushed. Then `chain/config:refreshChainConfig` ran. The
  readiness gate reports `config_missing` until the first refresh after a
  push (runbook, section 5.0.2).
- `chain/tabReadiness:read`: not ready, with one cause, `acceptor_malformed`.
- 17:31: #695 merged into `main` (`080ab46b`).
- The acceptor secret was saved again. 17:37:47: readiness ready, with no
  cause.
- 17:38:12: `CHAIN_V2_ENABLED=true`. The public chain config and
  `/api/health` report `"tabReady": true`.
- The section 7.1 flow checks then continued from the tab tip.

## What changed in the runbook

- Stage 3: one healthy settler run (`tabSettler:settleDue`) and an acceptor
  check (`chain/config:checkAcceptor`) are read before stage 6. The two tab
  secrets are copied without being printed, and their format is checked in
  the dashboard.
- Section 5.0.2: after each backend push, refresh the chain config and read
  `chain/tabReadiness:read`. Switch v2 on only when it reports ready with no
  cause.
