// Makes Next.js load a page's chunk scripts after the first contentful paint.
//
// Next.js 16.4 has no option for this: the App Router writes every chunk as
// `<script async>` in the head, the browser runs them before its first frame,
// and they compete with the stylesheet and fonts on slow connections. This
// script edits the two production App Router runtimes (Turbopack builds) so
// that:
// 1. the root chunks are listed in the URL of one small loader script
//    (public/hydrate-after-paint.js) instead of being written as scripts;
// 2. every other chunk script is written inert, as
//    `<script type="text/plain" data-hydrate-after-paint="...">`.
// The loader starts the real scripts after the first contentful paint, in
// the same order. See docs/performance/page-load.md.
//
// It runs before `next build` (package.json), changes nothing when already
// applied, and fails when Next.js is not the version it was written for or a
// pattern does not match exactly once, so an upgrade cannot skip it silently.
// QUILLTIP_HYDRATE_AFTER_PAINT=false at run time restores Next.js's behaviour.
import { readFileSync, writeFileSync } from 'fs'
import { createRequire } from 'module'
import path from 'path'

export const NEXT_VERSION = '16.4.6'
export const MARKER = 'QUILLTIP_HYDRATE_AFTER_PAINT'

const RUNTIMES = [
  'dist/compiled/next-server/app-page-turbo.runtime.prod.js',
  'dist/compiled/next-server/app-page-turbo-experimental.runtime.prod.js',
]

const ENABLED = `"false"!==process.env.${MARKER}`

/** Applies both edits to one runtime's source. Throws when a pattern does not match exactly once. */
export function patchRuntime(source: string, file = 'runtime'): string {
  if (source.includes(MARKER)) return source

  // 1. getRequiredScripts: `...l=()=>{...preinit(...)}}return[l,c]}` lists the
  //    root chunks (d), asset prefix (t), query string (a), SRI manifest (n).
  const required =
    /function (\w+)\((\w),(\w),(\w),(\w),(\w),(\w),(\w)\)\{var \w;let (\w),(\w)=\[\],(\w)=\{src:"",crossOrigin:\4\},(\w)=\(\(null==\(\w=\2\.rootMainFilesTree\)\?void 0:\w\[\8\]\)\|\|\2\.rootMainFiles\)\.map\(\w+\);[\s\S]*?return\[\9,\11\]\}/g
  const requiredMatches = [...source.matchAll(required)]
  if (requiredMatches.length !== 1)
    throw new Error(
      `${file}: getRequiredScripts found ${requiredMatches.length} times, expected 1`
    )
  const [whole, , , prefix, crossOrigin, sri, query, , , l, , c, files] =
    requiredMatches[0]!
  const withLoader = whole.replace(
    new RegExp(`return\\[${l},${c}\\]\\}$`),
    `if(!${sri}&&${ENABLED})return[()=>{},{src:\`\${${prefix}}/hydrate-after-paint.js?c=\${encodeURIComponent(${files}.map(e=>\`\${${prefix}}/_next/\`+e+${query}).join(" "))}\`,crossOrigin:${crossOrigin}}];return[${l},${c}]}`
  )
  source = source.replace(whole, withLoader)

  // 2. React DOM's pushScriptImpl: `function to(e,t){e.push(th("script"));var
  //    r,n=null,a=null;for(r in t)if(W.call(t,r))...` writes script resources.
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
    `function ${fn}(e,t){if(${ENABLED}&&!0===t.async&&"string"==typeof t.src&&-1!==t.src.indexOf("/_next/static/chunks/")){var qt={};for(var qk in t)${has}.call(t,qk)&&"src"!==qk&&"async"!==qk&&(qt[qk]=t[qk]);qt.type="text/plain",qt["data-hydrate-after-paint"]=t.src,t=qt}e.push(${tag}("script"));`
  )
  if (!source.includes(pushWhole.replace(`function ${fn}(e,t){`, '')))
    throw new Error(`${file}: pushScriptImpl edit failed`)
  return source
}

function main() {
  const require = createRequire(import.meta.url)
  const pkgPath = require.resolve('next/package.json', {
    paths: [process.cwd()],
  })
  const root = path.dirname(pkgPath)
  const version = (
    JSON.parse(readFileSync(pkgPath, 'utf8')) as { version: string }
  ).version
  if (version !== NEXT_VERSION) {
    console.error(
      `scripts/next/hydrate-after-paint.ts was written for Next.js ${NEXT_VERSION}, found ${version}. Check the patterns against the new runtime and update NEXT_VERSION.`
    )
    process.exit(1)
  }
  for (const relative of RUNTIMES) {
    const file = path.join(root, relative)
    const before = readFileSync(file, 'utf8')
    const after = patchRuntime(before, relative)
    if (after === before) {
      console.log(`hydrate-after-paint: ${relative} already patched`)
      continue
    }
    writeFileSync(file, after)
    console.log(`hydrate-after-paint: patched ${relative}`)
  }
}

if (import.meta.main) main()
