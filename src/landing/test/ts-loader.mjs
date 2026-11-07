// Minimal `node --test` ESM loader for plain .ts modules with no type-only
// imports/exports (strips types via esbuild; no bundling, no deps beyond the
// esbuild already pulled in transitively by astro/vite).
import { transformSync } from 'esbuild'
import { readFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'

export function resolve(specifier, context, nextResolve) {
  if (specifier.endsWith('.ts')) {
    const url = context.parentURL ? new URL(specifier, context.parentURL) : pathToFileURL(specifier)
    return { url: url.href, shortCircuit: true }
  }
  return nextResolve(specifier, context)
}

export function load(url, context, nextLoad) {
  if (url.endsWith('.ts')) {
    const source = readFileSync(fileURLToPath(url), 'utf8')
    const { code } = transformSync(source, { loader: 'ts', format: 'esm' })
    return { format: 'module', source: code, shortCircuit: true }
  }
  return nextLoad(url, context)
}
