import { chromium } from '@playwright/test'
import { writeFileSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'

const BASE = process.env.BASE_URL || 'http://localhost:3100'
const PAGES = [
  { name: 'home', path: '/' },
  { name: 'articles', path: '/articles' },
  { name: 'guide', path: '/guide' },
]

function formatEntry(entry) {
  return `[${entry.type}] ${entry.text}`
}

async function main() {
  const browser = await chromium.launch()
  const context = await browser.newContext()
  const results = []
  let articlePath = null

  for (const pageDef of PAGES) {
    const page = await context.newPage()
    const entries = []
    page.on('console', (msg) => {
      entries.push({
        type: msg.type(),
        text: msg.text(),
      })
    })

    await page.goto(`${BASE}${pageDef.path}`, {
      waitUntil: 'networkidle',
      timeout: 60_000,
    })
    await page.waitForTimeout(2000)

    results.push({
      name: pageDef.name,
      path: pageDef.path,
      url: page.url(),
      entries,
    })
    await page.close()
  }

  const articlesProbe = await context.newPage()
  await articlesProbe.goto(`${BASE}/articles`, {
    waitUntil: 'networkidle',
    timeout: 60_000,
  })
  const articleLink = articlesProbe.locator('main a[href^="/"]').nth(1)
  const href = await articleLink.getAttribute('href').catch(() => null)
  await articlesProbe.close()

  if (
    href &&
    href.startsWith('/') &&
    href.split('/').filter(Boolean).length >= 2
  ) {
    articlePath = href
  }

  if (articlePath) {
    const page = await context.newPage()
    const entries = []
    page.on('console', (msg) => {
      entries.push({ type: msg.type(), text: msg.text() })
    })
    await page.goto(`${BASE}${articlePath}`, {
      waitUntil: 'networkidle',
      timeout: 60_000,
    })
    await page.waitForTimeout(2000)
    results.push({
      name: 'article_detail',
      path: articlePath,
      url: page.url(),
      entries,
    })
    await page.close()
  }

  await browser.close()

  const devPattern = /development|dev mode|devtools|development build/i
  const summary = results.map((r) => {
    const devMatches = r.entries.filter((e) => devPattern.test(e.text))
    const warnings = r.entries.filter((e) => e.type === 'warning')
    const errors = r.entries.filter((e) => e.type === 'error')
    return { ...r, devMatches, warnings, errors }
  })

  const branch = process.env.GIT_BRANCH || 'unknown'
  const date = new Date().toISOString()

  const label = process.env.ENG224_BASELINE_LABEL || 'BEFORE'
  let md = `# ENG-224 Console Baseline (${label})\n\n`
  md += `- **Captured:** ${date}\n`
  md += `- **Branch:** ${branch}\n`
  md += `- **Build:** production (\`bun run build\` + \`bun run start\`)\n`
  md += `- **Base URL:** ${BASE}\n\n`
  md += `## Summary\n\n`

  const anyDev = summary.some((s) => s.devMatches.length > 0)
  md += anyDev
    ? `**Development-related console messages found** on ${summary
        .filter((s) => s.devMatches.length > 0)
        .map((s) => s.name)
        .join(', ')}.\n\n`
    : `**No messages matching "development" / "dev mode" / "development build"** in automated capture. Check manually in DevTools — filter Console by \`development\`.\n\n`

  for (const s of summary) {
    md += `### ${s.name} (\`${s.path}\`)\n\n`
    md += `- URL: ${s.url}\n`
    md += `- Total console messages: ${s.entries.length}\n`
    md += `- Warnings: ${s.warnings.length}\n`
    md += `- Errors: ${s.errors.length}\n`
    md += `- Development-pattern matches: ${s.devMatches.length}\n\n`

    if (s.devMatches.length > 0) {
      md += `**Matches (ENG-224 target):**\n\n`
      for (const m of s.devMatches) {
        md += `- ${formatEntry(m)}\n`
      }
      md += `\n`
    }

    if (s.warnings.length > 0 && s.warnings.length <= 15) {
      md += `**All warnings:**\n\n`
      for (const w of s.warnings) {
        md += `- ${formatEntry(w)}\n`
      }
      md += `\n`
    } else if (s.warnings.length > 15) {
      md += `**First 10 warnings:**\n\n`
      for (const w of s.warnings.slice(0, 10)) {
        md += `- ${formatEntry(w)}\n`
      }
      md += `\n_(+ ${s.warnings.length - 10} more warnings)_\n\n`
    }
  }

  md += `## Manual check (recommended)\n\n`
  md += `1. Run \`bun run build && PORT=3100 bun run start\`\n`
  md += `2. Open each page in Chrome → DevTools → Console\n`
  md += `3. Filter: \`development\`\n`
  md += `4. Copy exact warning text into "After" doc for comparison\n\n`
  md += `## After fix\n\n`
  md += `Re-run the same steps and save as \`ENG-224-console-baseline-AFTER.md\` on Desktop.\n`
  md += `Pass = development-mode warning gone on: home, articles, guide, article detail.\n`

  const desktopPath = join(
    homedir(),
    'Desktop',
    `ENG-224-console-baseline-${label}.md`
  )
  writeFileSync(desktopPath, md, 'utf8')
  console.log(`Wrote ${desktopPath}`)
  console.log(
    JSON.stringify(
      {
        anyDev,
        pages: summary.map((s) => ({
          name: s.name,
          devMatches: s.devMatches.length,
          warnings: s.warnings.length,
        })),
      },
      null,
      2
    )
  )
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
