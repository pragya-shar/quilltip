/**
 * Client entry point for the testnet-only guard. The source of truth lives in
 * convex/lib/networkGuard.ts so Convex, Next.js, and scripts share one check.
 * Scripts should call `assertScriptTestnetOnly` from scripts/lib/network-guard.ts,
 * which reads the process environment.
 */
export * from '../../convex/lib/networkGuard'
