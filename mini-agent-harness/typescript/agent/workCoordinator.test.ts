import assert from 'node:assert/strict'
import {
  AcknowledgedMailbox,
  DurableScheduler,
  RuntimeExecutionRegistry,
  ShutdownCoordinator,
  TeamDirectory,
  WorkItemStore,
  metadataTrace,
  type Clock,
} from './workCoordinator.ts'

class ManualClock implements Clock {
  value = 1_000
  now() { return this.value }
  advance(ms: number) { this.value += ms }
}

function waitForAbort(signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(signal.reason)
  return new Promise((_, reject) =>
    signal.addEventListener('abort', () => reject(signal.reason), { once: true }),
  )
}

const tests: Array<readonly [string, () => void | Promise<void>]> = []
const test = (name: string, run: () => void | Promise<void>) => tests.push([name, run])

test('work item records stay separate from runtime execution state', () => {
  const store = new WorkItemStore({ newToken: () => 'lease-1' })
  const item = store.create({ id: 'work-1', subject: 'Research source' })
  assert.equal(item.status, 'pending')
  assert.equal('outputFile' in item, false)
  assert.equal('abortController' in item, false)
})

test('blockers are checked atomically with claim', () => {
  const store = new WorkItemStore({ newToken: () => 'lease' })
  const blocker = store.create({ id: 'a', subject: 'First' })
  store.create({ id: 'b', subject: 'Second', blockerIds: ['a'] })
  const denied = store.claim('b', 'worker', 100)
  assert.deepEqual(denied, {
    ok: false,
    reason: 'blocked',
    blockerIds: ['a'],
    item: store.get('b'),
  })
  const first = store.claim('a', 'worker', 100)
  assert.equal(first.ok, true)
  if (first.ok) store.complete(blocker.id, first.lease.token)
  assert.equal(store.claim('b', 'worker', 100).ok, true)
})

test('one live lease fences a competing owner', () => {
  const store = new WorkItemStore({ newToken: () => 'lease-1' })
  store.create({ id: 'work', subject: 'Owned work' })
  assert.equal(store.claim('work', 'worker-a', 100).ok, true)
  const denied = store.claim('work', 'worker-b', 100)
  assert.equal(denied.ok, false)
  if (!denied.ok) assert.equal(denied.reason, 'claimed')
})

test('heartbeat extends lease and expiry reclaims with stale-token fencing', () => {
  const clock = new ManualClock()
  const tokens = ['lease-a', 'lease-b']
  const store = new WorkItemStore({ clock, newToken: () => tokens.shift()! })
  store.create({ id: 'work', subject: 'Recoverable work' })
  const claimed = store.claim('work', 'worker-a', 100)
  assert.equal(claimed.ok, true)
  if (!claimed.ok) return
  clock.advance(90)
  store.heartbeat('work', claimed.lease.token, 100)
  clock.advance(101)
  assert.deepEqual(store.reclaimExpired(), ['work'])
  const reclaimed = store.claim('work', 'worker-b', 100)
  assert.equal(reclaimed.ok, true)
  assert.throws(() => store.complete('work', claimed.lease.token), /stale or missing lease/)
})

test('expected revision rejects a stale claimant', () => {
  const store = new WorkItemStore({ newToken: () => 'lease' })
  const original = store.create({ id: 'work', subject: 'Versioned work' })
  store.claim('work', 'worker', 100, original.revision)
  const stale = store.claim('work', 'worker', 100, original.revision)
  assert.equal(stale.ok, false)
  if (!stale.ok) assert.equal(stale.reason, 'stale_revision')
})

test('linked child follows parent cancellation', async () => {
  const parent = new AbortController()
  const registry = new RuntimeExecutionRegistry()
  const handle = registry.launch({
    id: 'exec-linked', workItemId: 'work', ownerId: 'worker', mode: 'background',
    parentSignal: parent.signal,
    run: waitForAbort,
  })
  parent.abort(new Error('parent stopped'))
  assert.equal((await handle.done).status, 'cancelled')
})

test('detached child survives parent and still has an explicit owner cancel', async () => {
  const parent = new AbortController()
  const registry = new RuntimeExecutionRegistry()
  const handle = registry.launch({
    id: 'exec-detached', workItemId: 'work', ownerId: 'worker', mode: 'background',
    cancellation: 'detached', parentSignal: parent.signal,
    run: waitForAbort,
  })
  parent.abort()
  assert.equal(handle.signal.aborted, false)
  assert.equal(registry.cancel('exec-detached'), true)
  assert.equal((await handle.done).status, 'cancelled')
})

test('team identity and shutdown use a correlated handshake', () => {
  const teams = new TeamDirectory()
  teams.create('team', { agentId: 'lead', displayName: 'team-lead', role: 'lead' })
  teams.addMember('team', { agentId: 'worker', displayName: 'researcher', role: 'research' })
  const shutdown = new ShutdownCoordinator(teams)
  shutdown.request({ requestId: 'shutdown-1', teamId: 'team', requesterId: 'lead', targetId: 'worker' })
  const approved = shutdown.respond('shutdown-1', 'worker', true)
  assert.equal(approved.status, 'approved')
  assert.equal(teams.require('team').members.find(member => member.agentId === 'worker')?.status, 'stopping')
  shutdown.complete('shutdown-1')
  assert.equal(teams.require('team').members.find(member => member.agentId === 'worker')?.status, 'stopped')
})

test('mailbox deduplicates IDs and redelivers until explicit ack', () => {
  const mailbox = new AcknowledgedMailbox()
  const input = {
    messageId: 'msg-1', teamId: 'team', senderId: 'lead', recipientId: 'worker',
    kind: 'work', payload: { secret: 'payload-stays-out-of-trace' },
  }
  assert.equal(mailbox.send(input).duplicate, false)
  assert.equal(mailbox.send(input).duplicate, true)
  assert.equal(mailbox.receive('worker')[0]?.deliveryCount, 1)
  assert.equal(mailbox.receive('worker')[0]?.deliveryCount, 2)
  mailbox.acknowledge('msg-1', 'worker')
  assert.equal(mailbox.receive('worker').length, 0)
})

test('mailbox sequence is stable and message ID collision fails closed', () => {
  const mailbox = new AcknowledgedMailbox()
  mailbox.send({ messageId: 'm1', teamId: 't', senderId: 'a', recipientId: 'r', kind: 'text', payload: 'one' })
  mailbox.send({ messageId: 'm2', teamId: 't', senderId: 'b', recipientId: 'r', kind: 'text', payload: 'two' })
  assert.deepEqual(mailbox.receive('r').map(message => message.sequence), [1, 2])
  assert.throws(
    () => mailbox.send({ messageId: 'm1', teamId: 't', senderId: 'x', recipientId: 'r', kind: 'text', payload: 'other' }),
    /collision/,
  )
})

test('scheduler restores one stable missed trigger until commit', () => {
  const scheduler = new DurableScheduler({ missedAfterMs: 50 })
  scheduler.schedule({ scheduleId: 'daily', workItemId: 'work', nextRunAt: 100 })
  const first = scheduler.poll(200)
  assert.equal(first[0]?.outcome, 'missed')
  const recovered = new DurableScheduler({ missedAfterMs: 50, state: scheduler.exportState() })
  const redelivered = recovered.poll(250)
  assert.equal(redelivered[0]?.triggerId, 'daily@100')
  recovered.commit('daily@100', 250)
  assert.equal(recovered.poll(300).length, 0)
})

test('recurring schedule advances from completion and trace stays metadata-only', () => {
  const scheduler = new DurableScheduler()
  scheduler.schedule({ scheduleId: 'repeat', workItemId: 'work', nextRunAt: 100, intervalMs: 30 })
  scheduler.poll(100)
  scheduler.commit('repeat@100', 110)
  assert.equal(scheduler.poll(139).length, 0)
  assert.equal(scheduler.poll(140)[0]?.triggerId, 'repeat@140')
  const trace = metadataTrace('work.claimed', 'work', 'in_progress', 2, 1)
  assert.equal(JSON.stringify(trace).includes('payload'), false)
  assert.deepEqual(Object.keys(trace), ['type', 'entityId', 'status', 'revision', 'relatedCount'])
})

let passed = 0
for (const [name, run] of tests) {
  await run()
  passed++
  console.log(`ok ${passed} - ${name}`)
}
console.log(`WorkCoordinator: ${passed}/${tests.length} passed`)
