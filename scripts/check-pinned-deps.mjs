#!/usr/bin/env node
// Fails if any workspace package.json declares a dependency/devDependency
// using a semver range (^, ~, *, >=, etc.) instead of an exact version.
// Internal `workspace:*` references are exempt.
//
// This enforces the repo's `.npmrc` `save-exact=true` policy going forward:
// new/changed dependencies must be pinned exactly so `pnpm-lock.yaml` is the
// only thing that can move a dependency version.

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const DEP_FIELDS = ['dependencies', 'devDependencies']

/**
 * Parses the simple `packages:\n  - 'glob'` list out of pnpm-workspace.yaml
 * without pulling in a YAML dependency. Supports plain dirs ("infrastructure")
 * and single-level globs ("packages/*").
 */
export function parseWorkspaceGlobs(yamlText) {
  const globs = []
  const lines = yamlText.split('\n')
  let inPackages = false
  for (const line of lines) {
    if (/^packages:\s*$/.test(line)) {
      inPackages = true
      continue
    }
    if (inPackages) {
      const match = line.match(/^\s*-\s*['"]?([^'"#]+?)['"]?\s*(#.*)?$/)
      if (match) {
        globs.push(match[1].trim())
      } else if (line.trim() !== '' && !line.startsWith(' ')) {
        // Left the packages: block.
        inPackages = false
      }
    }
  }
  return globs
}

export function resolveWorkspacePackageDirs(repoRoot) {
  const workspaceYamlPath = join(repoRoot, 'pnpm-workspace.yaml')
  const dirs = new Set([repoRoot])
  if (!existsSync(workspaceYamlPath)) {
    return [...dirs]
  }
  const globs = parseWorkspaceGlobs(readFileSync(workspaceYamlPath, 'utf8'))
  for (const glob of globs) {
    if (glob.endsWith('/*')) {
      const base = join(repoRoot, glob.slice(0, -2))
      if (!existsSync(base)) continue
      for (const entry of readdirSync(base)) {
        const full = join(base, entry)
        if (statSync(full).isDirectory()) {
          dirs.add(full)
        }
      }
    } else {
      const full = join(repoRoot, glob)
      if (existsSync(full)) {
        dirs.add(full)
      }
    }
  }
  return [...dirs]
}

// Exact version: optionally scoped/local file refs are NOT allowed here —
// only a plain exact semver (with optional prerelease/build metadata), or
// an internal `workspace:*` reference.
const EXACT_VERSION_RE = /^\d+\.\d+\.\d+(-[0-9A-Za-z-.]+)?(\+[0-9A-Za-z-.]+)?$/

export function isPinnedRange(range) {
  if (range === 'workspace:*') return true
  if (range.startsWith('workspace:')) {
    const rest = range.slice('workspace:'.length)
    return rest === '*' || EXACT_VERSION_RE.test(rest)
  }
  return EXACT_VERSION_RE.test(range)
}

/**
 * Returns a list of { name, range, field } violations for a parsed
 * package.json object.
 */
export function checkPackageJson(pkg) {
  const violations = []
  for (const field of DEP_FIELDS) {
    const deps = pkg[field]
    if (!deps) continue
    for (const [name, range] of Object.entries(deps)) {
      if (!isPinnedRange(range)) {
        violations.push({ name, range, field })
      }
    }
  }
  return violations
}

function main() {
  const packageDirs = resolveWorkspacePackageDirs(root)
  let hasViolations = false

  for (const dir of packageDirs) {
    const pkgJsonPath = join(dir, 'package.json')
    if (!existsSync(pkgJsonPath)) continue
    const pkg = JSON.parse(readFileSync(pkgJsonPath, 'utf8'))
    const violations = checkPackageJson(pkg)
    if (violations.length > 0) {
      hasViolations = true
      const relPath = pkgJsonPath.replace(root + '/', '')
      console.error(`\n${relPath}:`)
      for (const { name, range, field } of violations) {
        console.error(`  ${field}.${name}: "${range}" is not an exact version`)
      }
    }
  }

  if (hasViolations) {
    console.error(
      '\nDependencies must be pinned to exact versions (see .npmrc: save-exact=true).\n' +
        'Replace the ranges above with exact versions, or workspace:* for internal packages.'
    )
    process.exit(1)
  }

  console.log('check-pinned-deps: all dependency ranges are pinned.')
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main()
}
