import { test } from 'node:test'
import assert from 'node:assert/strict'
import { checkPackageJson, isPinnedRange, parseWorkspaceGlobs } from './check-pinned-deps.mjs'

test('isPinnedRange accepts exact versions', () => {
  assert.equal(isPinnedRange('1.2.3'), true)
  assert.equal(isPinnedRange('0.10.0'), true)
  assert.equal(isPinnedRange('1.2.3-beta.1'), true)
  assert.equal(isPinnedRange('1.2.3+build.5'), true)
})

test('isPinnedRange accepts workspace:* and pinned workspace refs', () => {
  assert.equal(isPinnedRange('workspace:*'), true)
  assert.equal(isPinnedRange('workspace:1.2.3'), true)
})

test('isPinnedRange rejects ranges', () => {
  assert.equal(isPinnedRange('^1.2.3'), false)
  assert.equal(isPinnedRange('~1.2.3'), false)
  assert.equal(isPinnedRange('*'), false)
  assert.equal(isPinnedRange('>=1.2.3'), false)
  assert.equal(isPinnedRange('1.x'), false)
  assert.equal(isPinnedRange('latest'), false)
})

test('checkPackageJson passes on exact versions and workspace:*', () => {
  const pkg = {
    dependencies: { foo: '1.0.0', '@scope/bar': 'workspace:*' },
    devDependencies: { baz: '2.3.4' },
  }
  assert.deepEqual(checkPackageJson(pkg), [])
})

test('checkPackageJson flags caret, tilde, star, and >= ranges', () => {
  const pkg = {
    dependencies: { foo: '^1.0.0', bar: '~2.0.0' },
    devDependencies: { baz: '*', qux: '>=1.0.0' },
  }
  const violations = checkPackageJson(pkg)
  assert.equal(violations.length, 4)
  const names = violations.map((v) => v.name).sort()
  assert.deepEqual(names, ['bar', 'baz', 'foo', 'qux'])
})

test('checkPackageJson ignores missing dependency fields', () => {
  assert.deepEqual(checkPackageJson({}), [])
})

test('parseWorkspaceGlobs extracts globs from a packages: list', () => {
  const yaml = `packages:\n  - 'apps/*'\n  - 'packages/*'\n  - 'infrastructure'\n`
  assert.deepEqual(parseWorkspaceGlobs(yaml), ['apps/*', 'packages/*', 'infrastructure'])
})

test('parseWorkspaceGlobs ignores sibling settings after the packages list', () => {
  const yaml = `packages:
  - 'apps/*'
  - 'packages/*'
  - 'infrastructure'

saveExact: true
minimumReleaseAge: 1440
allowBuilds:
  esbuild: false
`
  assert.deepEqual(parseWorkspaceGlobs(yaml), ['apps/*', 'packages/*', 'infrastructure'])
})
