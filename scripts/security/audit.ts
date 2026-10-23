import { readFileSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { parseArgs } from 'node:util'
import JSON5 from 'json5'
import { satisfies, validRange } from 'semver'
import { z } from 'zod'

const advisorySchema = z.object({
  id: z.number().int().positive(),
  url: z
    .string()
    .regex(
      /^https:\/\/github\.com\/advisories\/GHSA-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}$/
    ),
  title: z.string().min(1),
  severity: z.enum(['low', 'moderate', 'high', 'critical']),
  vulnerable_versions: z
    .string()
    .refine(
      (value) => validRange(value) !== null,
      'Invalid advisory version range'
    ),
})
const reportSchema = z.record(z.string().min(1), z.array(advisorySchema).min(1))
const exceptionSchema = z
  .object({
    advisory: z.string().regex(/^GHSA-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}$/),
    package: z.string().min(1),
    version: z.string().min(1),
    vulnerableVersions: z
      .string()
      .refine((value) => validRange(value) !== null),
    severity: z.enum(['high', 'critical']),
    owner: z.string().trim().min(1),
    reviewedBy: z.string().trim().min(1),
    expires: z.iso.date(),
    reason: z.string().trim().min(1),
    evidence: z.string().trim().min(1),
  })
  .strict()
const lockSchema = z.object({
  lockfileVersion: z.union([z.literal(1), z.literal(3)]),
  packages: z.record(z.string(), z.array(z.unknown()).min(1)),
})

try {
  const { values } = parseArgs({
    options: {
      report: { type: 'string' },
      output: { type: 'string' },
      lockfile: { type: 'string', default: 'bun.lock' },
      exceptions: { type: 'string', default: 'security/audit-exceptions.json' },
    },
  })
  const reportPath = values.report
  let reportText: string
  let scanStatus: number | undefined
  if (reportPath) {
    reportText = readFileSync(reportPath, 'utf8')
  } else {
    const result = spawnSync('bun', ['audit', '--json'], {
      encoding: 'utf8',
      timeout: 120_000,
      maxBuffer: 16 * 1024 * 1024,
    })
    if (
      result.error ||
      result.signal ||
      (result.status !== 0 && result.status !== 1)
    ) {
      throw new Error(
        `Registry scan could not complete: ${result.error?.message ?? result.stderr}`
      )
    }
    reportText = result.stdout
    scanStatus = result.status
  }
  const outputPath = values.output
  if (outputPath) writeFileSync(outputPath, reportText)
  const report = reportSchema.parse(JSON.parse(reportText))
  if (
    scanStatus !== undefined &&
    scanStatus !== (Object.keys(report).length ? 1 : 0)
  ) {
    throw new Error('Registry exit status contradicts its report')
  }
  const lock = lockSchema.parse(
    JSON5.parse(readFileSync(values.lockfile, 'utf8'))
  )
  const exceptions = z
    .array(exceptionSchema)
    .parse(JSON.parse(readFileSync(values.exceptions, 'utf8')))
  const today = new Date().toISOString().slice(0, 10)
  const exceptionKeys = new Set<string>()
  for (const exception of exceptions) {
    if (exception.expires <= today) {
      throw new Error(
        `Exception ${exception.advisory} is expired (${exception.expires})`
      )
    }
    const key = JSON.stringify([
      exception.advisory,
      exception.package,
      exception.version,
      exception.vulnerableVersions,
      exception.severity,
    ])
    if (exceptionKeys.has(key))
      throw new Error(
        `Duplicate exception ${exception.advisory} for ${exception.package}`
      )
    exceptionKeys.add(key)
  }
  const usedExceptions = new Set<z.infer<typeof exceptionSchema>>()
  const counts = { low: 0, moderate: 0, high: 0, critical: 0 }
  for (const advisories of Object.values(report)) {
    for (const advisory of advisories) counts[advisory.severity]++
  }
  console.log(
    `Registry records: ${counts.critical} critical, ${counts.high} high, ${counts.moderate} moderate, ${counts.low} low`
  )
  let blocked = 0
  for (const [name, advisories] of Object.entries(report)) {
    for (const advisory of advisories) {
      if (!['high', 'critical'].includes(advisory.severity)) continue
      const id = advisory.url.split('/').at(-1)!
      const versions = new Set<string>()
      for (const entry of Object.values(lock.packages)) {
        const resolution = entry[0]
        if (
          typeof resolution !== 'string' ||
          !resolution.startsWith(`${name}@`)
        )
          continue
        const version = resolution.slice(name.length + 1)
        if (!satisfies(version, advisory.vulnerable_versions)) continue
        versions.add(version)
      }
      if (!versions.size)
        throw new Error(
          `Advisory ${id} for ${name} has no affected version in bun.lock`
        )
      for (const version of versions) {
        const exception = exceptions.find(
          (entry) =>
            entry.advisory === id &&
            entry.package === name &&
            entry.version === version &&
            entry.severity === advisory.severity &&
            entry.vulnerableVersions === advisory.vulnerable_versions
        )
        if (exception) {
          usedExceptions.add(exception)
          console.log(
            `EXCEPT ${advisory.severity} ${name}@${version} ${id}: ${exception.reason} (owner: ${exception.owner}, expires: ${exception.expires})`
          )
          continue
        }
        console.error(
          `BLOCK ${advisory.severity} ${name}@${version} ${id}: ${advisory.title}`
        )
        blocked++
      }
    }
  }
  if (usedExceptions.size !== exceptions.length) {
    throw new Error(
      'Stale or unmatched audit exceptions must be removed or re-reviewed'
    )
  }
  process.exitCode = blocked ? 1 : 0
} catch (error) {
  console.error(
    'Dependency audit failed:',
    error instanceof Error ? error.message : error
  )
  process.exitCode = 1
}
