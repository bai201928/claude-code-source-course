import assert from 'node:assert/strict'
import path from 'node:path'
import test from 'node:test'
import {
  InstructionCatalog,
  InstructionPipeline,
  StaleInstructionRevisionError,
  type InstructionSource,
} from './instructions.ts'

const root = path.resolve('instruction-fixture')

test('orders selected sources from managed through request-only dynamic', () => {
  const catalog = new InstructionCatalog([
    source('project', 'project', 'repo/CLAUDE.md'),
    source('managed', 'managed', 'managed/CLAUDE.md'),
    source('user', 'user', 'user/CLAUDE.md'),
    source('local', 'local', 'repo/CLAUDE.local.md'),
  ])
  const projected = new InstructionPipeline().project(
    catalog.snapshot(),
    path.join(root, 'src/app.ts'),
    [source('turn', 'dynamic', 'dynamic/turn.md')],
  )
  assert.deepEqual(projected.instructions.map(item => item.kind), [
    'managed', 'user', 'project', 'local', 'dynamic',
  ])
})

test('filters conditional prefixes and paths outside the source scope', () => {
  const catalog = new InstructionCatalog([
    source('java', 'project', 'repo/java.md', { pathPrefixes: ['src/java'] }),
    source('docs', 'project', 'repo/docs.md', { pathPrefixes: ['docs'] }),
    source('nested', 'project', 'nested/CLAUDE.md', { scopeRoot: path.join(root, 'packages') }),
  ])
  const report = new InstructionPipeline().project(
    catalog.snapshot(), path.join(root, 'src/java/App.java'),
  ).report
  assert.deepEqual(report.sourceIds, ['java'])
  assert.equal(report.outOfScopeCount, 2)
})

test('rejects untrusted external content but accepts explicit approval', () => {
  const catalog = new InstructionCatalog([
    source('external-no', 'project', 'external/no.md', { trust: 'untrusted' }),
    source('external-yes', 'project', 'external/yes.md', { trust: 'approved' }),
  ])
  const result = new InstructionPipeline().project(catalog.snapshot(), path.join(root, 'a.ts'))
  assert.deepEqual(result.report.sourceIds, ['external-yes'])
  assert.equal(result.report.untrustedCount, 1)
})

test('deduplicates normalized paths deterministically', () => {
  const catalog = new InstructionCatalog([
    source('user-copy', 'user', 'repo/SHARED.md'),
    source('project-copy', 'project', 'repo/shared.md'),
  ])
  const result = new InstructionPipeline().project(catalog.snapshot(), path.join(root, 'a.ts'))
  assert.deepEqual(result.report.sourceIds, ['project-copy'])
  assert.equal(result.report.deduplicatedCount, 1)
})

test('old snapshots remain immutable after catalog publication', () => {
  const catalog = new InstructionCatalog([source('old', 'project', 'repo/old.md')])
  const old = catalog.snapshot()
  catalog.publish(0, [source('new', 'project', 'repo/new.md')])
  assert.deepEqual(old.sources.map(item => item.id), ['old'])
  assert.equal(Object.isFrozen(old.sources), true)
})

test('stale catalog writers and stale request projections fail explicitly', () => {
  const catalog = new InstructionCatalog([source('old', 'project', 'repo/old.md')])
  const projected = new InstructionPipeline().project(catalog.snapshot(), path.join(root, 'a.ts'))
  catalog.publish(0, [source('new', 'project', 'repo/new.md')])
  assert.throws(() => catalog.publish(0, []), StaleInstructionRevisionError)
  assert.throws(() => catalog.assertCurrent(projected.catalogRevision), StaleInstructionRevisionError)
})

test('dynamic instructions are request-only and reports contain no content', () => {
  const catalog = new InstructionCatalog([source('base', 'project', 'repo/base.md')])
  const result = new InstructionPipeline().project(
    catalog.snapshot(), path.join(root, 'a.ts'), [source('delta', 'dynamic', 'dynamic/delta.md')],
  )
  assert.equal(result.instructions.some(item => item.content === 'secret-delta'), true)
  assert.equal(JSON.stringify(result.report).includes('secret-delta'), false)
  assert.deepEqual(catalog.snapshot().sources.map(item => item.id), ['base'])
})

function source(
  id: string,
  kind: InstructionSource['kind'],
  relativePath: string,
  overrides: Partial<InstructionSource> = {},
): InstructionSource {
  return {
    id,
    kind,
    filePath: path.join(root, relativePath),
    scopeRoot: root,
    trust: 'trusted',
    content: id === 'delta' ? 'secret-delta' : `${id} content`,
    ...overrides,
  }
}
