import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

const directories: string[] = []
const bunExecutable = spawnSync(
  'bun',
  ['-e', 'process.stdout.write(process.execPath)'],
  { encoding: 'utf8' }
).stdout
const advisory = {
  id: 123,
  url: 'https://github.com/advisories/GHSA-aaaa-bbbb-cccc',
  title: 'Untrusted input reaches the parser',
  severity: 'high',
  vulnerable_versions: '<2.0.0',
}

function runAudit(
  report: unknown,
  exceptions: unknown = [],
  live?: { status: number; stdout: string }
) {
  const directory = mkdtempSync(join(tmpdir(), 'quilltip-audit-'))
  directories.push(directory)
  writeFileSync(join(directory, 'report.json'), JSON.stringify(report))
  writeFileSync(join(directory, 'exceptions.json'), JSON.stringify(exceptions))
  writeFileSync(
    join(directory, 'bun.lock'),
    JSON.stringify({
      lockfileVersion: 1,
      packages: { parser: ['parser@1.0.0', '', {}] },
    })
  )
  if (live)
    writeFileSync(
      join(directory, 'bun'),
      '#!/bin/sh\nprintf %s "$AUDIT_TEST_STDOUT"\nexit "$AUDIT_TEST_STATUS"\n',
      { mode: 0o755 }
    )
  const result = spawnSync(
    bunExecutable,
    [
      resolve('scripts/security/audit.ts'),
      ...(live ? [] : ['--report', join(directory, 'report.json')]),
      '--exceptions',
      join(directory, 'exceptions.json'),
      '--lockfile',
      join(directory, 'bun.lock'),
    ],
    {
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${directory}${delimiter}${process.env.PATH}`,
        AUDIT_TEST_STDOUT: live?.stdout,
        AUDIT_TEST_STATUS: live?.status.toString(),
      },
    }
  )
  return { status: result.status, output: result.stdout + result.stderr }
}

afterEach(() =>
  directories.splice(0).forEach((path) => rmSync(path, { recursive: true }))
)

describe('dependency audit CLI', () => {
  it('fails an unreviewed high finding and identifies the installed version', () => {
    const result = runAudit({ parser: [advisory] })
    expect(result.status).toBe(1)
    expect(result.output).toContain(
      'BLOCK high parser@1.0.0 GHSA-aaaa-bbbb-cccc'
    )
  })
  it('allows only a current reviewed exception for the exact advisory and version', () => {
    const result = runAudit({ parser: [advisory] }, [
      {
        advisory: 'GHSA-aaaa-bbbb-cccc',
        package: 'parser',
        version: '1.0.0',
        severity: 'high',
        vulnerableVersions: '<2.0.0',
        owner: 'pragya-shar',
        reviewedBy: 'Codex',
        expires: new Date(Date.now() + 86400000).toISOString().slice(0, 10),
        reason:
          'Parser is used only with checked-in developer-controlled configuration.',
        evidence: 'docs/security/dependency-audit.md#parser',
      },
    ])
    expect(result.status).toBe(0)
    expect(result.output).toContain(
      'EXCEPT high parser@1.0.0 GHSA-aaaa-bbbb-cccc'
    )
  })

  it.each([
    { version: '0.9.0' },
    { advisory: 'GHSA-dddd-eeee-ffff' },
    { severity: 'critical' },
    { vulnerableVersions: '<1.5.0' },
  ])('does not apply an expired or mismatched exception: %j', (change) => {
    const result = runAudit({ parser: [advisory] }, [
      {
        advisory: 'GHSA-aaaa-bbbb-cccc',
        package: 'parser',
        version: '1.0.0',
        severity: 'high',
        vulnerableVersions: '<2.0.0',
        owner: 'pragya-shar',
        reviewedBy: 'Codex',
        expires: new Date(Date.now() + 86400000).toISOString().slice(0, 10),
        reason: 'Only checked-in configuration reaches the parser.',
        evidence: 'docs/security/dependency-audit.md#parser',
        ...change,
      },
    ])
    expect(result.status).toBe(1)
    expect(result.output).toContain('BLOCK high parser@1.0.0')
  })

  it.each([null, [], { parser: [{}] }, { error: 'Registry unavailable' }])(
    'fails closed on malformed registry data: %j',
    (report) => {
      const result = runAudit(report)
      expect(result.status).toBe(1)
      expect(result.output).toContain('Dependency audit failed:')
    }
  )

  it('reports moderate findings without blocking', () => {
    const result = runAudit({ parser: [{ ...advisory, severity: 'moderate' }] })
    expect(result.status).toBe(0)
    expect(result.output).toContain('1 moderate')
  })

  it('fails closed if an advisory range is invalid', () => {
    const result = runAudit({
      parser: [{ ...advisory, vulnerable_versions: 'unknown' }],
    })
    expect(result.status).toBe(1)
    expect(result.output).toContain('Dependency audit failed:')
  })

  it('fails closed if an advisory cannot be matched to the lockfile', () => {
    const result = runAudit({ absent: [advisory] })
    expect(result.status).toBe(1)
    expect(result.output).toContain('Dependency audit failed:')
  })

  it('accepts an empty successful registry report', () => {
    expect(runAudit({}).status).toBe(0)
  })

  it('rejects incomplete exception metadata', () => {
    const result = runAudit({ parser: [advisory] }, [{ package: 'parser' }])
    expect(result.status).toBe(1)
    expect(result.output).toContain('Dependency audit failed:')
  })

  it.each([
    { status: 2, stdout: '{}' },
    { status: 1, stdout: '{}' },
    { status: 1, stdout: '' },
    { status: 0, stdout: JSON.stringify({ parser: [advisory] }) },
    { status: 0, stdout: 'registry unavailable' },
  ])(
    'fails closed when the registry command fails or contradicts the report: %j',
    (live) => {
      const result = runAudit({}, [], live)
      expect(result.status).toBe(1)
      expect(result.output).toContain('Dependency audit failed:')
    }
  )

  it('blocks a critical finding even when another version of the package is reviewed', () => {
    const result = runAudit({ parser: [{ ...advisory, severity: 'critical' }] })
    expect(result.status).toBe(1)
    expect(result.output).toContain('BLOCK critical parser@1.0.0')
  })

  it('rejects expired exceptions even when the finding has disappeared', () => {
    const result = runAudit({}, [
      {
        advisory: 'GHSA-aaaa-bbbb-cccc',
        package: 'parser',
        version: '1.0.0',
        vulnerableVersions: '<2.0.0',
        severity: 'high',
        owner: 'pragya-shar',
        reviewedBy: 'Codex',
        expires: '2000-01-01',
        reason: 'Only checked-in configuration.',
        evidence: 'docs/security/dependency-audit.md',
      },
    ])
    expect(result.status).toBe(1)
    expect(result.output).toContain('expired')
  })
  it('rejects duplicate or stale reviewed exceptions', () => {
    const exception = {
      advisory: 'GHSA-aaaa-bbbb-cccc',
      package: 'parser',
      version: '1.0.0',
      vulnerableVersions: '<2.0.0',
      severity: 'high',
      owner: 'pragya-shar',
      reviewedBy: 'Codex',
      expires: new Date(Date.now() + 86400000).toISOString().slice(0, 10),
      reason: 'Only checked-in configuration.',
      evidence: 'docs/security/dependency-audit.md',
    }
    expect(
      runAudit({ parser: [advisory] }, [exception, exception]).status
    ).toBe(1)
    expect(runAudit({}, [exception]).status).toBe(1)
  })
})
