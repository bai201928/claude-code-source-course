import { randomUUID } from 'node:crypto'

export type WorkItemStatus = 'pending' | 'in_progress' | 'completed'

export type ClaimLease = Readonly<{
  ownerId: string
  token: string
  generation: number
  heartbeatAt: number
  expiresAt: number
}>

export type WorkItem = Readonly<{
  id: string
  subject: string
  blockerIds: readonly string[]
  status: WorkItemStatus
  revision: number
  lease?: ClaimLease
}>

export type ClaimResult =
  | Readonly<{ ok: true; item: WorkItem; lease: ClaimLease }>
  | Readonly<{
      ok: false
      reason: 'not_found' | 'blocked' | 'claimed' | 'completed' | 'stale_revision'
      blockerIds?: readonly string[]
      item?: WorkItem
    }>

export type Clock = Readonly<{ now(): number }>

const systemClock: Clock = Object.freeze({ now: () => Date.now() })

/**
 * WorkItemStore owns durable coordination records. Runtime executions live in
 * RuntimeExecutionRegistry and are intentionally not fields on WorkItem.
 */
export class WorkItemStore {
  readonly #items = new Map<string, WorkItem>()
  readonly #clock: Clock
  readonly #newToken: () => string

  constructor(options: Readonly<{ clock?: Clock; newToken?: () => string }> = {}) {
    this.#clock = options.clock ?? systemClock
    this.#newToken = options.newToken ?? randomUUID
  }

  create(input: Readonly<{ id: string; subject: string; blockerIds?: readonly string[] }>): WorkItem {
    requireText(input.id, 'work item id')
    requireText(input.subject, 'work item subject')
    if (this.#items.has(input.id)) throw new Error(`duplicate work item: ${input.id}`)
    const blockerIds = Object.freeze([...(input.blockerIds ?? [])])
    if (new Set(blockerIds).size !== blockerIds.length) {
      throw new Error(`duplicate blocker on work item: ${input.id}`)
    }
    if (blockerIds.includes(input.id)) throw new Error('work item cannot block itself')
    const item = freezeWorkItem({
      id: input.id,
      subject: input.subject,
      blockerIds,
      status: 'pending',
      revision: 1,
    })
    this.#items.set(item.id, item)
    return item
  }

  get(id: string): WorkItem | undefined {
    return this.#items.get(id)
  }

  list(): readonly WorkItem[] {
    return Object.freeze([...this.#items.values()])
  }

  claim(
    id: string,
    ownerId: string,
    ttlMs: number,
    expectedRevision?: number,
  ): ClaimResult {
    requireText(ownerId, 'claim owner')
    requirePositive(ttlMs, 'claim ttl')
    let item = this.#items.get(id)
    if (!item) return Object.freeze({ ok: false, reason: 'not_found' })
    item = this.#expireIfNeeded(item)
    if (expectedRevision !== undefined && item.revision !== expectedRevision) {
      return Object.freeze({ ok: false, reason: 'stale_revision', item })
    }
    if (item.status === 'completed') {
      return Object.freeze({ ok: false, reason: 'completed', item })
    }
    const blockerIds = item.blockerIds.filter(blockerId => {
      const blocker = this.#items.get(blockerId)
      return blocker !== undefined && blocker.status !== 'completed'
    })
    if (blockerIds.length > 0) {
      return Object.freeze({
        ok: false,
        reason: 'blocked',
        blockerIds: Object.freeze(blockerIds),
        item,
      })
    }
    if (item.lease && item.lease.ownerId !== ownerId) {
      return Object.freeze({ ok: false, reason: 'claimed', item })
    }
    const now = this.#clock.now()
    const lease = freezeLease({
      ownerId,
      token: item.lease?.token ?? this.#newToken(),
      generation: item.lease?.generation ?? item.revision + 1,
      heartbeatAt: now,
      expiresAt: now + ttlMs,
    })
    const updated = freezeWorkItem({
      ...item,
      status: 'in_progress',
      revision: item.revision + 1,
      lease,
    })
    this.#items.set(id, updated)
    return Object.freeze({ ok: true, item: updated, lease })
  }

  heartbeat(id: string, token: string, ttlMs: number): WorkItem {
    requirePositive(ttlMs, 'heartbeat ttl')
    const item = this.#requireActiveLease(id, token)
    const now = this.#clock.now()
    const updated = freezeWorkItem({
      ...item,
      revision: item.revision + 1,
      lease: freezeLease({ ...item.lease!, heartbeatAt: now, expiresAt: now + ttlMs }),
    })
    this.#items.set(id, updated)
    return updated
  }

  complete(id: string, token: string): WorkItem {
    const item = this.#requireActiveLease(id, token)
    const updated = freezeWorkItem({
      ...item,
      status: 'completed',
      revision: item.revision + 1,
      lease: undefined,
    })
    this.#items.set(id, updated)
    return updated
  }

  release(id: string, token: string): WorkItem {
    const item = this.#requireActiveLease(id, token)
    const updated = freezeWorkItem({
      ...item,
      status: 'pending',
      revision: item.revision + 1,
      lease: undefined,
    })
    this.#items.set(id, updated)
    return updated
  }

  reclaimExpired(): readonly string[] {
    const reclaimed: string[] = []
    for (const [id, item] of this.#items) {
      const updated = this.#expireIfNeeded(item)
      if (updated !== item) reclaimed.push(id)
    }
    return Object.freeze(reclaimed)
  }

  #expireIfNeeded(item: WorkItem): WorkItem {
    if (!item.lease || item.lease.expiresAt > this.#clock.now()) return item
    const updated = freezeWorkItem({
      ...item,
      status: 'pending',
      revision: item.revision + 1,
      lease: undefined,
    })
    this.#items.set(item.id, updated)
    return updated
  }

  #requireActiveLease(id: string, token: string): WorkItem {
    const found = this.#items.get(id)
    if (!found) throw new Error(`unknown work item: ${id}`)
    const item = this.#expireIfNeeded(found)
    if (!item.lease || item.lease.token !== token) {
      throw new Error(`stale or missing lease: ${id}`)
    }
    return item
  }
}

export type RuntimeExecutionStatus = 'running' | 'completed' | 'failed' | 'cancelled'
export type CancellationOwnership = 'linked' | 'detached'

export type RuntimeExecution = Readonly<{
  id: string
  workItemId: string
  ownerId: string
  mode: 'foreground' | 'background'
  cancellation: CancellationOwnership
  status: RuntimeExecutionStatus
  revision: number
  startedAt: number
  endedAt?: number
  failureType?: string
}>

export type RuntimeExecutionHandle = Readonly<{
  execution: RuntimeExecution
  signal: AbortSignal
  done: Promise<RuntimeExecution>
  cancel(reason?: string): void
}>

/** Runtime executions own AbortControllers; WorkItemStore never does. */
export class RuntimeExecutionRegistry {
  readonly #executions = new Map<string, RuntimeExecution>()
  readonly #controllers = new Map<string, AbortController>()
  readonly #clock: Clock

  constructor(clock: Clock = systemClock) {
    this.#clock = clock
  }

  launch(
    input: Readonly<{
      id: string
      workItemId: string
      ownerId: string
      mode: 'foreground' | 'background'
      cancellation?: CancellationOwnership
      parentSignal?: AbortSignal
      run(signal: AbortSignal): Promise<void>
    }>,
  ): RuntimeExecutionHandle {
    requireText(input.id, 'execution id')
    if (this.#executions.has(input.id)) throw new Error(`duplicate execution: ${input.id}`)
    const cancellation = input.cancellation ?? 'linked'
    const controller = new AbortController()
    const initial = freezeExecution({
      id: input.id,
      workItemId: input.workItemId,
      ownerId: input.ownerId,
      mode: input.mode,
      cancellation,
      status: 'running',
      revision: 1,
      startedAt: this.#clock.now(),
    })
    this.#executions.set(input.id, initial)
    this.#controllers.set(input.id, controller)

    const onParentAbort = () => controller.abort(input.parentSignal?.reason)
    if (cancellation === 'linked' && input.parentSignal) {
      if (input.parentSignal.aborted) onParentAbort()
      else input.parentSignal.addEventListener('abort', onParentAbort, { once: true })
    }

    const done = Promise.resolve()
      .then(() => input.run(controller.signal))
      .then(
        () => this.#finish(input.id, controller.signal.aborted ? 'cancelled' : 'completed'),
        error =>
          this.#finish(
            input.id,
            controller.signal.aborted ? 'cancelled' : 'failed',
            error instanceof Error ? error.name : typeof error,
          ),
      )
      .finally(() => {
        input.parentSignal?.removeEventListener('abort', onParentAbort)
        this.#controllers.delete(input.id)
      })

    return Object.freeze({
      execution: initial,
      signal: controller.signal,
      done,
      cancel: (reason = 'execution cancelled') => controller.abort(new Error(reason)),
    })
  }

  get(id: string): RuntimeExecution | undefined {
    return this.#executions.get(id)
  }

  cancel(id: string, reason = 'execution cancelled'): boolean {
    const controller = this.#controllers.get(id)
    if (!controller) return false
    controller.abort(new Error(reason))
    return true
  }

  #finish(id: string, status: Exclude<RuntimeExecutionStatus, 'running'>, failureType?: string) {
    const current = this.#executions.get(id)
    if (!current || current.status !== 'running') return current!
    const updated = freezeExecution({
      ...current,
      status,
      revision: current.revision + 1,
      endedAt: this.#clock.now(),
      ...(failureType ? { failureType } : {}),
    })
    this.#executions.set(id, updated)
    return updated
  }
}

export type TeamMemberStatus = 'active' | 'stopping' | 'stopped'
export type TeamMember = Readonly<{
  agentId: string
  displayName: string
  role: string
  status: TeamMemberStatus
  revision: number
}>

export type TeamSnapshot = Readonly<{
  teamId: string
  revision: number
  leaderId: string
  members: readonly TeamMember[]
}>

export class TeamDirectory {
  readonly #teams = new Map<string, TeamSnapshot>()

  create(teamId: string, leader: Readonly<{ agentId: string; displayName: string; role: string }>): TeamSnapshot {
    requireText(teamId, 'team id')
    if (this.#teams.has(teamId)) throw new Error(`duplicate team: ${teamId}`)
    const member = freezeMember({ ...leader, status: 'active', revision: 1 })
    const team = freezeTeam({ teamId, revision: 1, leaderId: leader.agentId, members: [member] })
    this.#teams.set(teamId, team)
    return team
  }

  addMember(
    teamId: string,
    member: Readonly<{ agentId: string; displayName: string; role: string }>,
  ): TeamSnapshot {
    const team = this.require(teamId)
    if (team.members.some(item => item.agentId === member.agentId)) {
      throw new Error(`duplicate team member: ${member.agentId}`)
    }
    if (team.members.some(item => item.displayName === member.displayName)) {
      throw new Error(`duplicate team display name: ${member.displayName}`)
    }
    const updated = freezeTeam({
      ...team,
      revision: team.revision + 1,
      members: [...team.members, freezeMember({ ...member, status: 'active', revision: 1 })],
    })
    this.#teams.set(teamId, updated)
    return updated
  }

  setMemberStatus(teamId: string, agentId: string, status: TeamMemberStatus): TeamSnapshot {
    const team = this.require(teamId)
    let found = false
    const members = team.members.map(member => {
      if (member.agentId !== agentId) return member
      found = true
      return freezeMember({ ...member, status, revision: member.revision + 1 })
    })
    if (!found) throw new Error(`unknown team member: ${agentId}`)
    const updated = freezeTeam({ ...team, revision: team.revision + 1, members })
    this.#teams.set(teamId, updated)
    return updated
  }

  get(teamId: string): TeamSnapshot | undefined {
    return this.#teams.get(teamId)
  }

  require(teamId: string): TeamSnapshot {
    const team = this.#teams.get(teamId)
    if (!team) throw new Error(`unknown team: ${teamId}`)
    return team
  }

  hasMember(teamId: string, agentId: string): boolean {
    return this.require(teamId).members.some(member => member.agentId === agentId)
  }
}

export type MailboxEnvelope<T = unknown> = Readonly<{
  messageId: string
  teamId: string
  senderId: string
  recipientId: string
  kind: string
  sequence: number
  sentAt: number
  payload: T
  deliveryCount: number
  acknowledgedAt?: number
}>

export type MailboxSendResult<T = unknown> = Readonly<{
  duplicate: boolean
  envelope: MailboxEnvelope<T>
}>

/** At-least-once mailbox: unacknowledged messages are deliberately redelivered. */
export class AcknowledgedMailbox {
  readonly #messages = new Map<string, MailboxEnvelope>()
  readonly #nextSequence = new Map<string, number>()
  readonly #clock: Clock

  constructor(clock: Clock = systemClock) {
    this.#clock = clock
  }

  send<T>(input: Readonly<{
    messageId: string
    teamId: string
    senderId: string
    recipientId: string
    kind: string
    payload: T
  }>): MailboxSendResult<T> {
    const existing = this.#messages.get(input.messageId)
    if (existing) {
      if (
        existing.teamId !== input.teamId ||
        existing.senderId !== input.senderId ||
        existing.recipientId !== input.recipientId ||
        existing.kind !== input.kind
      ) {
        throw new Error(`mailbox message id collision: ${input.messageId}`)
      }
      return Object.freeze({ duplicate: true, envelope: existing as MailboxEnvelope<T> })
    }
    const sequence = (this.#nextSequence.get(input.recipientId) ?? 0) + 1
    this.#nextSequence.set(input.recipientId, sequence)
    const envelope = freezeEnvelope({
      ...input,
      sequence,
      sentAt: this.#clock.now(),
      deliveryCount: 0,
    })
    this.#messages.set(input.messageId, envelope)
    return Object.freeze({ duplicate: false, envelope })
  }

  receive(recipientId: string, limit = Number.MAX_SAFE_INTEGER): readonly MailboxEnvelope[] {
    requirePositive(limit, 'mailbox receive limit')
    const pending = [...this.#messages.values()]
      .filter(message => message.recipientId === recipientId && message.acknowledgedAt === undefined)
      .sort((left, right) => left.sequence - right.sequence)
      .slice(0, limit)
    const delivered = pending.map(message => {
      const updated = freezeEnvelope({ ...message, deliveryCount: message.deliveryCount + 1 })
      this.#messages.set(message.messageId, updated)
      return updated
    })
    return Object.freeze(delivered)
  }

  acknowledge(messageId: string, recipientId: string): MailboxEnvelope {
    const message = this.#messages.get(messageId)
    if (!message || message.recipientId !== recipientId) {
      throw new Error(`mailbox message not owned by recipient: ${messageId}`)
    }
    if (message.acknowledgedAt !== undefined) return message
    const updated = freezeEnvelope({ ...message, acknowledgedAt: this.#clock.now() })
    this.#messages.set(messageId, updated)
    return updated
  }
}

export type ShutdownRequestStatus = 'pending' | 'approved' | 'rejected' | 'completed'
export type ShutdownRequest = Readonly<{
  requestId: string
  teamId: string
  requesterId: string
  targetId: string
  status: ShutdownRequestStatus
  revision: number
  createdAt: number
  respondedAt?: number
}>

export class ShutdownCoordinator {
  readonly #requests = new Map<string, ShutdownRequest>()
  readonly #teams: TeamDirectory
  readonly #clock: Clock

  constructor(teams: TeamDirectory, clock: Clock = systemClock) {
    this.#teams = teams
    this.#clock = clock
  }

  request(input: Readonly<{ requestId: string; teamId: string; requesterId: string; targetId: string }>) {
    if (this.#requests.has(input.requestId)) throw new Error(`duplicate shutdown request: ${input.requestId}`)
    if (!this.#teams.hasMember(input.teamId, input.requesterId)) throw new Error('shutdown requester is not a team member')
    if (!this.#teams.hasMember(input.teamId, input.targetId)) throw new Error('shutdown target is not a team member')
    const request = freezeShutdown({
      ...input,
      status: 'pending',
      revision: 1,
      createdAt: this.#clock.now(),
    })
    this.#requests.set(request.requestId, request)
    return request
  }

  respond(requestId: string, responderId: string, approved: boolean): ShutdownRequest {
    const request = this.#requests.get(requestId)
    if (!request) throw new Error(`unknown shutdown request: ${requestId}`)
    if (request.status !== 'pending') throw new Error(`shutdown request already answered: ${requestId}`)
    if (request.targetId !== responderId) throw new Error('only the shutdown target can respond')
    const updated = freezeShutdown({
      ...request,
      status: approved ? 'approved' : 'rejected',
      revision: request.revision + 1,
      respondedAt: this.#clock.now(),
    })
    this.#requests.set(requestId, updated)
    if (approved) this.#teams.setMemberStatus(request.teamId, request.targetId, 'stopping')
    return updated
  }

  complete(requestId: string): ShutdownRequest {
    const request = this.#requests.get(requestId)
    if (!request || request.status !== 'approved') {
      throw new Error(`shutdown request is not approved: ${requestId}`)
    }
    this.#teams.setMemberStatus(request.teamId, request.targetId, 'stopped')
    const updated = freezeShutdown({ ...request, status: 'completed', revision: request.revision + 1 })
    this.#requests.set(requestId, updated)
    return updated
  }
}

export type Schedule = Readonly<{
  scheduleId: string
  workItemId: string
  nextRunAt: number
  intervalMs?: number
  revision: number
}>

export type ScheduledTrigger = Readonly<{
  triggerId: string
  scheduleId: string
  workItemId: string
  scheduledFor: number
  observedAt: number
  outcome: 'due' | 'missed'
}>

export type DurableSchedulerState = Readonly<{
  revision: number
  schedules: readonly Schedule[]
  pending: readonly ScheduledTrigger[]
}>

/**
 * A persistence-neutral scheduler state machine. Persist exportState() after
 * every mutation. Stable trigger IDs let downstream effects deduplicate a
 * redelivery; they do not make external side effects exactly-once.
 */
export class DurableScheduler {
  readonly #schedules = new Map<string, Schedule>()
  readonly #pending = new Map<string, ScheduledTrigger>()
  readonly #missedAfterMs: number
  #revision = 0

  constructor(options: Readonly<{ missedAfterMs?: number; state?: DurableSchedulerState }> = {}) {
    this.#missedAfterMs = options.missedAfterMs ?? 60_000
    if (this.#missedAfterMs < 0) throw new Error('missedAfterMs must not be negative')
    if (options.state) {
      this.#revision = options.state.revision
      for (const schedule of options.state.schedules) this.#schedules.set(schedule.scheduleId, freezeSchedule(schedule))
      for (const trigger of options.state.pending) this.#pending.set(trigger.triggerId, freezeTrigger(trigger))
    }
  }

  schedule(input: Readonly<{ scheduleId: string; workItemId: string; nextRunAt: number; intervalMs?: number }>): Schedule {
    requireText(input.scheduleId, 'schedule id')
    if (this.#schedules.has(input.scheduleId)) throw new Error(`duplicate schedule: ${input.scheduleId}`)
    if (input.intervalMs !== undefined) requirePositive(input.intervalMs, 'schedule interval')
    const schedule = freezeSchedule({ ...input, revision: 1 })
    this.#schedules.set(schedule.scheduleId, schedule)
    this.#revision++
    return schedule
  }

  poll(now: number): readonly ScheduledTrigger[] {
    const due: ScheduledTrigger[] = [...this.#pending.values()]
    for (const schedule of this.#schedules.values()) {
      if (schedule.nextRunAt > now) continue
      const triggerId = `${schedule.scheduleId}@${schedule.nextRunAt}`
      if (this.#pending.has(triggerId)) continue
      const trigger = freezeTrigger({
        triggerId,
        scheduleId: schedule.scheduleId,
        workItemId: schedule.workItemId,
        scheduledFor: schedule.nextRunAt,
        observedAt: now,
        outcome: now - schedule.nextRunAt > this.#missedAfterMs ? 'missed' : 'due',
      })
      this.#pending.set(triggerId, trigger)
      this.#revision++
      due.push(trigger)
    }
    return Object.freeze(due.sort((left, right) => left.scheduledFor - right.scheduledFor))
  }

  commit(triggerId: string, completedAt: number): void {
    const trigger = this.#pending.get(triggerId)
    if (!trigger) throw new Error(`unknown pending trigger: ${triggerId}`)
    const schedule = this.#schedules.get(trigger.scheduleId)
    if (!schedule) throw new Error(`trigger schedule is missing: ${trigger.scheduleId}`)
    this.#pending.delete(triggerId)
    if (schedule.intervalMs === undefined) {
      this.#schedules.delete(schedule.scheduleId)
    } else {
      this.#schedules.set(
        schedule.scheduleId,
        freezeSchedule({
          ...schedule,
          nextRunAt: completedAt + schedule.intervalMs,
          revision: schedule.revision + 1,
        }),
      )
    }
    this.#revision++
  }

  exportState(): DurableSchedulerState {
    return Object.freeze({
      revision: this.#revision,
      schedules: Object.freeze([...this.#schedules.values()]),
      pending: Object.freeze([...this.#pending.values()]),
    })
  }
}

export type WorkCoordinatorTrace = Readonly<{
  type: string
  entityId: string
  status: string
  revision: number
  relatedCount: number
}>

export function metadataTrace(
  type: string,
  entityId: string,
  status: string,
  revision: number,
  relatedCount = 0,
): WorkCoordinatorTrace {
  return Object.freeze({ type, entityId, status, revision, relatedCount })
}

function freezeWorkItem(value: Omit<WorkItem, 'blockerIds'> & { blockerIds: readonly string[] }): WorkItem {
  return Object.freeze({ ...value, blockerIds: Object.freeze([...value.blockerIds]) })
}

function freezeLease(value: ClaimLease): ClaimLease {
  return Object.freeze({ ...value })
}

function freezeExecution(value: RuntimeExecution): RuntimeExecution {
  return Object.freeze({ ...value })
}

function freezeMember(value: TeamMember): TeamMember {
  return Object.freeze({ ...value })
}

function freezeTeam(value: Omit<TeamSnapshot, 'members'> & { members: readonly TeamMember[] }): TeamSnapshot {
  return Object.freeze({ ...value, members: Object.freeze([...value.members]) })
}

function freezeEnvelope<T>(value: MailboxEnvelope<T>): MailboxEnvelope<T> {
  return Object.freeze({ ...value })
}

function freezeShutdown(value: ShutdownRequest): ShutdownRequest {
  return Object.freeze({ ...value })
}

function freezeSchedule(value: Schedule): Schedule {
  return Object.freeze({ ...value })
}

function freezeTrigger(value: ScheduledTrigger): ScheduledTrigger {
  return Object.freeze({ ...value })
}

function requireText(value: string, label: string): void {
  if (!value.trim()) throw new Error(`${label} must not be empty`)
}

function requirePositive(value: number, label: string): void {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${label} must be positive`)
}
