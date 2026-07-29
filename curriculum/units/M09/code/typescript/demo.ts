import { LifecycleCoordinator } from './lifecycle-coordinator.ts'

const manager = new LifecycleCoordinator({
  prepare: () => ({ recoveryHint: 'claude --resume session-42' }),
  onFailsafe: request => console.log(`failsafe for ${request.reason}`),
})

manager.register('transcript', 'critical', async () => {
  console.log('flush transcript')
})
manager.register('mcp', 'resource', async () => {
  console.log('close MCP')
})
manager.register('analytics', 'best-effort', async () => {
  console.log('flush analytics')
})

const report = await manager.shutdown({
  reason: 'user-exit',
  exitCode: 0,
  overallBudgetMs: 500,
  tierBudgetMs: { critical: 200, resource: 150, 'best-effort': 100 },
})
console.log(JSON.stringify(report, null, 2))
