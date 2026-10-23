import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const isObject = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
const nonempty = (value) => typeof value === 'string' && value.trim().length > 0
const advisoryURL =
  /^https:\/\/github\.com\/advisories\/GHSA-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}$/

/** Validate Bun's package-to-advisories JSON before applying narrowly reviewed exceptions. */
export function evaluateAudit(result, policy, now = new Date()) {
  if (result.error || ![0, 1].includes(result.status))
    throw new Error('Audit command failed')
  const report = JSON.parse(result.stdout)
  if (!isObject(report)) throw new Error('Unknown audit schema')
  const findings = []
  for (const [pkg, entries] of Object.entries(report)) {
    if (!nonempty(pkg) || !Array.isArray(entries) || !entries.length)
      throw new Error('Unknown audit package schema')
    for (const item of entries) {
      if (
        !isObject(item) ||
        !Number.isSafeInteger(item.id) ||
        item.id <= 0 ||
        !advisoryURL.test(item.url) ||
        !nonempty(item.title) ||
        !nonempty(item.vulnerable_versions) ||
        !['low', 'moderate', 'high', 'critical'].includes(item.severity)
      ) {
        throw new Error('Unknown audit advisory schema')
      }
      findings.push({ ...item, package: pkg })
    }
  }
  if (result.status !== (findings.length ? 1 : 0))
    throw new Error('Audit exit status contradicts report')
  if (
    !isObject(policy) ||
    policy.version !== 1 ||
    !Array.isArray(policy.exceptions)
  )
    throw new Error('Unknown exception policy schema')
  const keys = new Set()
  for (const entry of policy.exceptions) {
    if (
      !isObject(entry) ||
      !['package', 'reason', 'owner', 'evidence', 'vulnerableVersions'].every(
        (key) => nonempty(entry[key])
      ) ||
      !advisoryURL.test(entry.advisory) ||
      !/^\d{4}-\d{2}-\d{2}$/.test(entry.expires)
    ) {
      throw new Error('Incomplete audit exception')
    }
    const expiry = new Date(`${entry.expires}T00:00:00Z`)
    if (
      !Number.isFinite(expiry.getTime()) ||
      expiry.toISOString().slice(0, 10) !== entry.expires ||
      expiry <= now
    ) {
      throw new Error('Invalid or expired audit exception')
    }
    const key = `${entry.package}:${entry.advisory}:${entry.vulnerableVersions}`
    if (keys.has(key)) throw new Error('Duplicate audit exception')
    keys.add(key)
    if (
      !findings.some(
        (item) =>
          item.package === entry.package &&
          item.url === entry.advisory &&
          item.vulnerable_versions === entry.vulnerableVersions
      )
    ) {
      throw new Error('Stale or unmatched audit exception')
    }
  }
  const unreviewed = findings.filter(
    (item) =>
      !keys.has(`${item.package}:${item.url}:${item.vulnerable_versions}`)
  )
  if (unreviewed.length)
    throw new Error(
      `Unreviewed advisories:\n${unreviewed.map((item) => `${item.package}: ${item.url} (${item.severity})`).join('\n')}`
    )
  return findings
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    const policy = JSON.parse(
      readFileSync(
        new URL('../security/audit-exceptions.json', import.meta.url),
        'utf8'
      )
    )
    const result = spawnSync('bun', ['audit', '--json'], {
      encoding: 'utf8',
      timeout: 120_000,
      maxBuffer: 16 * 1024 * 1024,
    })
    const accepted = evaluateAudit(result, policy)
    console.log(
      `Dependency audit passed; ${accepted.length} explicitly reviewed advisories.`
    )
  } catch (error) {
    console.error(`Dependency audit failed: ${error.message}`)
    process.exitCode = 1
  }
}
