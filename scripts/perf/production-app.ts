// Starts `next start` for the perf checks, unless PERF_BASE_URL points at a
// server that is already running. Resolves when the server answers /login.

import { spawn, type ChildProcess } from 'child_process'

export async function startProductionApp(
  port: number,
  baseUrl: string
): Promise<ChildProcess | undefined> {
  if (process.env.PERF_BASE_URL) return undefined
  const app = spawn('bunx', ['next', 'start', '-p', String(port)], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, NODE_ENV: 'production' },
  })
  app.stderr?.on('data', (chunk) => process.stderr.write(chunk))
  const deadline = Date.now() + 60_000
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/login`)
      if (response.ok) return app
    } catch {
      /* Not listening yet. */
    }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  app.kill()
  throw new Error(`The app did not start on ${baseUrl}`)
}
