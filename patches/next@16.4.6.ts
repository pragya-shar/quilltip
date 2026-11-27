// Patch for next@16.4.6: on four public routes, start the page's chunk
// scripts after the first contentful paint.
//
// What: two edits to the production App Router runtimes that `next build` and
// `next start` use (Turbopack builds):
// 1. getRequiredScripts: the root chunks are listed in the URL of one small
//    loader, public/hydrate-after-paint.js, instead of being written as
//    `<script async>` and `preinit` scripts. The loader is preinit'd, so
//    React writes it in <head>. Its URL carries the loader's version
//    (`?v=`), so it is served with a long cache lifetime (vercel.json). The
//    bootstrap script Next.js requires is the same URL with a `#b` fragment:
//    React keeps the two apart (with the same URL it merges them and writes
//    only the late bootstrap tag), and the browser fetches the URL once.
//    When the copy runs, the loader has already run and it does nothing;
// 2. React DOM's pushScriptImpl: that loader tag is written without `async`,
//    so it runs before the body is parsed and painted, and holds a press made
//    right after the first paint. Every other chunk script is written inert,
//    as `<script type="text/plain" data-hydrate-after-paint="...">`.
// The loader adds them all as real async scripts after the first contentful
// paint, in the same order (or sooner: see the loader).
//
// Where: only for the routes in FIRST_LOAD_ROUTES (`/`, `/login`, `/articles`
// and the article page), read from Next.js's request store, and only in a
// server whose own code turned it on: instrumentation.ts sets
// REGISTRATION on globalThis at startup. A checkout without this patch has no
// such registration, so a runtime left patched in node_modules (after a branch
// switch) keeps Next.js's output there. Every other page, `next dev`, and a
// build with subresource integrity keep Next.js's output too.
// QUILLTIP_HYDRATE_AFTER_PAINT=false at server start restores it everywhere:
// instrumentation.ts then does not register, which is exactly the state of a
// checkout without the patch.
//
// The script writes each patched runtime to a new file and renames it over
// the installed one, so the file in bun's shared download cache, which a
// hardlinked install shares with node_modules, is never changed.
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
import {
  chmodSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from 'fs'
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

/** Set on globalThis by instrumentation.ts; the patched runtime needs it. */
/**
 * Set on globalThis by instrumentation.ts to the loader's version (a hash of
 * public/hydrate-after-paint.js); the patched runtime needs it, and puts it in
 * the loader's URL so the loader can be cached for good.
 */
export const REGISTRATION = 'quilltip.hydrateAfterPaint.loader'
const VERSION = `globalThis[Symbol.for("${REGISTRATION}")]`
const ENABLED = `"string"==typeof ${VERSION}`
/** Chunk script paths: Next.js's, and Vercel's immutable assets. */
const CHUNK_PATHS = ['/_next/static/chunks/', '/_next/static/immutable/chunks/']
const IS_CHUNK = CHUNK_PATHS.map(
  (chunkPath) => `-1!==t.src.indexOf("${chunkPath}")`
).join('||')
/** The loader's path; its tag is written without `async`. */
const LOADER_PATH = '/hydrate-after-paint.js?'
// The request's work store (route, and a flag this patch sets on it). The
// runtime loads the same external module for its own use.
const STORE = `(()=>{try{return require("next/dist/server/app-render/work-async-storage.external.js").workAsyncStorage.getStore()}catch(e){}})()`
const FLAG = '__quilltipHydrateAfterPaint'

/** Applies both edits to one runtime's source. Throws when a pattern does not match exactly once. */
export function patchRuntime(source: string, file = 'runtime'): string {
  if (source.includes(REGISTRATION)) return source
  // Patched by an earlier version (every version writes this loader URL).
  if (source.includes(LOADER_PATH))
    throw new Error(
      `${file}: patched by an earlier version of this patch. Reinstall Next.js (rm -rf node_modules/next, \`bun pm cache rm\`, bun install) and run the patch again.`
    )
  // An earlier version of this patch (before the registration and the blocking
  // loader) edited the file in place. Its edits cannot be stacked.
  if (source.includes(MARKER))
    throw new Error(
      `${file}: patched by an earlier version of this patch. Reinstall Next.js (rm -rf node_modules/next, \`bun pm cache rm\`, bun install) and run the patch again.`
    )

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
  const [whole, , , prefix, crossOrigin, sri, query, nonce, , l, , c, files] =
    requiredMatches[0]!
  // React DOM's module, as the original preinit calls name it.
  const reactDom = whole.match(/(\w+)\.preinit\(/)?.[1]
  if (!reactDom) throw new Error(`${file}: preinit call not found`)
  const routes = JSON.stringify(ROUTES)
  const withLoader = whole.replace(
    new RegExp(`return\\[${l},${c}\\]\\}$`),
    `var qs=${STORE};if(!${sri}&&${ENABLED}&&qs&&${routes}.indexOf(qs.route)!==-1){qs.${FLAG}=!0;var qsrc=\`\${${prefix}}/hydrate-after-paint.js?v=\${encodeURIComponent(${VERSION})}&c=\${encodeURIComponent(${files}.map(e=>\`\${${prefix}}/_next/\`+e+${query}).join(" "))}\`;return[()=>{${reactDom}.preinit(qsrc,{as:"script",nonce:${nonce},crossOrigin:${crossOrigin}})},{src:qsrc+"#b",crossOrigin:${crossOrigin}}]}return[${l},${c}]}`
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
    `function ${fn}(e,t){if(${ENABLED}&&!0===t.async&&"string"==typeof t.src){var qs=${STORE};if(qs&&qs.${FLAG}){var qt={},qk;if(-1!==t.src.indexOf("${LOADER_PATH}")){for(qk in t)${has}.call(t,qk)&&"async"!==qk&&(qt[qk]=t[qk]);t=qt}else if(${IS_CHUNK}){for(qk in t)${has}.call(t,qk)&&"src"!==qk&&"async"!==qk&&(qt[qk]=t[qk]);qt.type="text/plain",qt["data-hydrate-after-paint"]=t.src,t=qt}}}e.push(${tag}("script"));`
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

/**
 * Writes `content` to a new file beside `file` and renames it over `file`.
 * The installed file gets a new inode, so a hardlinked copy (bun's shared
 * download cache on Linux) keeps its content.
 */
export function replaceFile(file: string, content: string) {
  const temporary = `${file}.quilltip-${process.pid}`
  writeFileSync(temporary, content)
  chmodSync(temporary, statSync(file).mode)
  renameSync(temporary, file)
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
    replaceFile(file, after)
    console.log(`next patch: patched ${relative}`)
  }
}

if (import.meta.main) main()
