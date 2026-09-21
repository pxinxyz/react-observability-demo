/**
 * One-shot codemod: make Vercel's serverless functions resolvable at runtime.
 *
 * Background. Vercel transpiles each `api/*.ts` to `api/*.js` individually — it
 * strips types but does not bundle and does not rewrite ESM to CJS. Node then
 * resolves the module graph itself, under ESM rules, which require every
 * relative specifier to name a real file with its extension. A bare `./catalog`
 * or a directory like `../simulator` is not resolvable.
 *
 * This rewrites runtime relative specifiers to their emitted `.js` paths:
 *   '../simulator' -> '../simulator/index.js'   (directory: uses its index)
 *   './_lib/http'  -> './_lib/http.js'          (file: appends the extension)
 *
 * Type-only imports are erased by the transpiler and would not strictly need
 * this, but rewriting them too keeps the rule uniform and costs nothing.
 */
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'

const ROOTS = ['api', 'simulator']
const files = []

function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walk(full)
    else if (entry.endsWith('.ts')) files.push(full)
  }
}

for (const root of ROOTS) walk(root)

// Matches `from './x'` and `import './x'`, including inside multi-line imports,
// because the `from '...'` clause itself always sits on one line.
const SPECIFIER = /(\bfrom\s*|^\s*import\s*)(['"])(\.\.?\/[^'"]*)\2/gm

let changed = 0

for (const file of files) {
  const source = readFileSync(file, 'utf8')

  const rewritten = source.replace(SPECIFIER, (match, prefix, quote, spec) => {
    if (spec.endsWith('.js') || spec.endsWith('.mjs')) return match

    const base = resolve(dirname(file), spec)
    // A specifier that names a directory resolves to that directory's index.
    const target = existsSync(base) && statSync(base).isDirectory() ? `${spec}/index.js` : `${spec}.js`

    return `${prefix}${quote}${target}${quote}`
  })

  if (rewritten !== source) {
    writeFileSync(file, rewritten)
    changed += 1
    console.log(`rewrote ${file}`)
  }
}

console.log(`\n${changed} file(s) changed of ${files.length} scanned`)
