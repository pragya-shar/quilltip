/**
 * A fixture suite: a server that bundles real components with stand-in
 * services, and the Playwright spec (or config) that drives it. No secrets,
 * no backend. `scripts/run-fixture-e2e.ts` starts the server, waits for its
 * port and runs the specs.
 */
export type FixtureSuite = {
  /** Unique across all suites; `--suite <name>` selects it. */
  name: string
  /** Bun script that serves the fixture. */
  server: string
  /** Unique across all suites. */
  port: number
  /** Spec path or pattern (when `config` is not set). */
  spec: string
  /** A Playwright config of its own (projects, engines, widths). */
  config?: string
  /** Extra environment for the specs. */
  env: Record<string, string>
}
