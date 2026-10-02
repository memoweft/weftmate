// V1 §2's only display-state authority. It consumes public lifecycle metadata
// and produces a compact presentation state; raw errors and source data never
// enter this module.
export const MOD_DISPLAY_STATES = Object.freeze({
  creating: Object.freeze({ id: 'creating', label: '创建中', tone: 'warn', transient: true }),
  updating: Object.freeze({ id: 'updating', label: '更新中', tone: 'warn', transient: true }),
  starting: Object.freeze({ id: 'starting', label: '正在启动', tone: 'warn', transient: true }),
  stopping: Object.freeze({ id: 'stopping', label: '正在停止', tone: 'warn', transient: true }),
  running: Object.freeze({ id: 'running', label: '运行中', tone: 'ok', transient: false }),
  stopped: Object.freeze({ id: 'stopped', label: '已停止', tone: 'neutral', transient: false }),
  failed: Object.freeze({ id: 'failed', label: '遇到问题', tone: 'err', transient: false }),
  interrupted: Object.freeze({ id: 'interrupted', label: '已中断', tone: 'warn', transient: false }),
  blocked: Object.freeze({ id: 'blocked', label: '缺少必需能力', tone: 'err', transient: false }),
  uncreated: Object.freeze({ id: 'uncreated', label: '尚未创建', tone: 'neutral', transient: false }),
})

export function deriveModState(project = {}, detail = {}) {
  const activeVersionId = project.activeVersionId ?? project.active_version_id ?? null
  const update = detail.update ?? project.update ?? {}
  const updateStatus = update.status
  const health = project.health ?? project.actualState ?? project.actual_state ?? detail.health ?? detail.run?.status ?? null
  const desired = project.desiredState ?? project.desired_state ?? null
  if (['pending', 'running'].includes(updateStatus)) return activeVersionId ? MOD_DISPLAY_STATES.updating : MOD_DISPLAY_STATES.creating
  if (health === 'starting') return MOD_DISPLAY_STATES.starting
  if (health === 'stopping') return MOD_DISPLAY_STATES.stopping
  if (health === 'healthy' || health === 'running') return MOD_DISPLAY_STATES.running
  if (health === 'blocked' || project.stopReason === 'blocked_missing_capabilities' || project.stop_reason === 'blocked_missing_capabilities') return MOD_DISPLAY_STATES.blocked
  if (desired === 'stopped') return MOD_DISPLAY_STATES.stopped
  if (health === 'failed' || health === 'needs-review' || update.lastError || detail.recentError || detail.hasRecentError === true) return MOD_DISPLAY_STATES.failed
  if (health === 'interrupted') return MOD_DISPLAY_STATES.interrupted
  return MOD_DISPLAY_STATES.uncreated
}
