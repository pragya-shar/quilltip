// Patch for next@16.4.6: on four public routes, start the page's chunk
// scripts after the first contentful paint.
//
// What: two edits to the production App Router runtimes that `next build` and
// `next start` use (Turbopack builds):
// 1. getRequiredScripts: the root chunks are listed in the URL of one small
//    loader, public/hydrate-after-paint.js, instead of being written as
//    `<script async>` and `preinit` scripts;
// 2. React DOM's pushScriptImpl: every other chunk script is written inert,
//    as `<script type="text/plain" data-hydrate-after-paint="...">`.
// The loader adds them all as real async scripts after the first contentful
// paint, in the same order (or sooner: see the loader).
//
// Where: only for the routes in FIRST_LOAD_ROUTES (`/`, `/login`, `/articles`
// and the article page), read from Next.js's request store. Every other page,
// `next dev`, and a build with subresource integrity keep Next.js's output.
// QUILLTIP_HYDRATE_AFTER_PAINT=false restores it everywhere (read when a page
// renders, so set it at build time for prerendered pages too).
//
// Why: Next.js 16.4 has no option for when its chunk scripts load. On the
// load Lighthouse observes, Chrome runs them before the first frame, so
// simulated mobile LCP carries all of their bytes and evaluation; on a slow
// connection they share the bandwidth with the stylesheet and fonts.
// See docs/performance/next-patch.md for the measurements, the upstream
// status, and how to carry the patch through an upgrade or remove it.
//
// Why a script and not a unified diff: both runtimes are minified onto one
// line each, so a diff would carry the whole files (about 1.6 MB) and could
// not be reviewed. This script makes the same two edits, refuses any other
// Next.js version, and fails when a pattern does not match exactly once, so
// an upgrade fails the build instead of skipping the patch silently. It runs
// before `next build` (package.json, vercel.json) and changes nothing when
// the runtimes are already patched.
import { readFileSync, writeFileSync } from 'fs'
import { createRequire } from 'module'
import path from 'path'
import { FIRST_LOAD_ROUTES } from '../scripts/perf/first-load'

export const NEXT_VERSION = '16.4.6'
export const MARKER = 'QUILLTIP_HYDRATE_AFTER_PAINT'
export const ROUTES: readonly string[] = FIRST_LOAD_ROUTES

export const RUNTIMES = [
  'dist/compiled/next-server/app-page-turbo.runtime.prod.js',
  'dist/compiled/next-server/app-page-turbo-experimental.runtime.prod.js',
]

const ENABLED = `"false"!==process.env.${MARKER}`
// The request's work store (route, and a flag this patch sets on it). The
// runtime loads the same external module for its own use.
const STORE = `(()=>{try{return require("next/dist/server/app-render/work-async-storage.external.js").workAsyncStorage.getStore()}catch(e){}})()`
const FLAG = '__quilltipHydrateAfterPaint'

/** Applies both edits to one runtime's source. Throws when a pattern does not match exactly once. */
export function patchRuntime(source: string, file = 'runtime'): string {
  if (source.includes(MARKER)) return source

  // 1. getRequiredScripts: `function rt(e,t,r,n,a,i,s){...return[l,c]}` with
  //    the root chunks (d), asset prefix (t), cross-origin (r), SRI manifest
  //    (n) and query string (a).
  const required =
    /function (\w+)\((\w),(\w),(\w),(\w),(\w),(\w),(\w)\)\{var \w;let (\w),(\w)=\[\],(\w)=\{src:"",crossOrigin:\4\},(\w)=\(\(null==\(\w=\2\.rootMainFilesTree\)\?void 0:\w\[\8\]\)\|\|\2\.rootMainFiles\)\.map\(\w+\);[\s\S]*?return\[\9,\11\]\}/g
  const requiredMatches = [...source.matchAll(required)]
  if (requiredMatches.length !== 1)
    throw new Error(
      `${file}: getRequiredScripts found ${requiredMatches.length} times, expected 1`
    )
  const [whole, , , prefix, crossOrigin, sri, query, , , l, , c, files] =
    requiredMatches[0]!
  const routes = JSON.stringify(ROUTES)
  const withLoader = whole.replace(
    new RegExp(`return\\[${l},${c}\\]\\}$`),
    `var qs=${STORE};if(!${sri}&&${ENABLED}&&qs&&${routes}.indexOf(qs.route)!==-1){qs.${FLAG}=!0;return[()=>{},{src:\`\${${prefix}}/hydrate-after-paint.js?c=\${encodeURIComponent(${files}.map(e=>\`\${${prefix}}/_next/\`+e+${query}).join(" "))}\`,crossOrigin:${crossOrigin}}]}return[${l},${c}]}`
  )
  source = source.replace(whole, withLoader)

  // 2. React DOM's pushScriptImpl: `function to(e,t){e.push(th("script"));var
  //    r,n=null,a=null;for(r in t)if(W.call(t,r))...` writes script resources.
  //    Only on a request whose loader was written (step 1), so a chunk script
  //    is never inert without a loader to start it.
  const push =
    /function (\w+)\(e,t\)\{e\.push\((\w+)\("script"\)\);var r,n=null,a=null;for\(r in t\)if\((\w+)\.call\(t,r\)\)/g
  const pushMatches = [...source.matchAll(push)]
  if (pushMatches.length !== 1)
    throw new Error(
      `${file}: pushScriptImpl found ${pushMatches.length} times, expected 1`
    )
  const [pushWhole, fn, tag, has] = pushMatches[0]!
  source = source.replace(
    `function ${fn}(e,t){e.push(${tag}("script"));`,
    `function ${fn}(e,t){if(${ENABLED}&&!0===t.async&&"string"==typeof t.src&&-1!==t.src.indexOf("/_next/static/chunks/")){var qs=${STORE};if(qs&&qs.${FLAG}){var qt={};for(var qk in t)${has}.call(t,qk)&&"src"!==qk&&"async"!==qk&&(qt[qk]=t[qk]);qt.type="text/plain",qt["data-hydrate-after-paint"]=t.src,t=qt}}e.push(${tag}("script"));`
  )
  if (!source.includes(pushWhole.replace(`function ${fn}(e,t){`, '')))
    throw new Error(`${file}: pushScriptImpl edit failed`)
  return source
}

/** The installed Next.js package directory and version. */
export function installedNext(cwd = process.cwd()) {
  const require = createRequire(import.meta.url)
  const pkgPath = require.resolve('next/package.json', { paths: [cwd] })
  const version = (
    JSON.parse(readFileSync(pkgPath, 'utf8')) as { version: string }
  ).version
  return { root: path.dirname(pkgPath), version }
}

function main() {
  const { root, version } = installedNext()
  if (version !== NEXT_VERSION) {
    console.error(
      `patches/next@${NEXT_VERSION}.ts was written for Next.js ${NEXT_VERSION}, found ${version}. See docs/performance/next-patch.md, "Upgrading Next.js".`
    )
    process.exit(1)
  }
  for (const relative of RUNTIMES) {
    const file = path.join(root, relative)
    const before = readFileSync(file, 'utf8')
    const after = patchRuntime(before, relative)
    if (after === before) {
      console.log(`next patch: ${relative} already patched`)
      continue
    }
    writeFileSync(file, after)
    console.log(`next patch: patched ${relative}`)
  }
}

if (import.meta.main) main()
