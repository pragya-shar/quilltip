/**
 * The parts of Bun's runtime API that scripts/ci uses. The repository has no
 * Bun type package; these scripts run only under Bun.
 */
declare namespace Bun {
  type ResolveArgs = { path: string; importer: string }
  type ResolveResult = { path: string; external?: boolean } | undefined
  type PluginBuilder = {
    onResolve(
      options: { filter: RegExp },
      callback: (args: ResolveArgs) => ResolveResult
    ): void
  }
  type BuildConfig = {
    entrypoints: string[]
    target?: 'browser' | 'bun' | 'node'
    packages?: 'bundle' | 'external'
    metafile?: boolean
    throw?: boolean
    define?: Record<string, string>
    plugins?: { name: string; setup(build: PluginBuilder): void }[]
  }
  type BuildOutput = {
    success: boolean
    logs: unknown[]
    outputs: { path: string; text(): Promise<string> }[]
    metafile?: { inputs: Record<string, unknown> }
  }
  function build(config: BuildConfig): Promise<BuildOutput>
  function serve(options: unknown): unknown
  function file(path: string): { text(): Promise<string> }
  class Glob {
    constructor(pattern: string)
    scanSync(options: { cwd: string }): IterableIterator<string>
  }
  const YAML: { parse(text: string): unknown }
}

interface ImportMeta {
  /** True when this file is the entry point Bun was started with. */
  readonly main: boolean
}
