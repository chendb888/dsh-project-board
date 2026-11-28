/**
 * 项目看板投影（projectBoard unit）
 *
 * 架构（D2 定案）：不写会话日志自定义事件。
 * - 蓝图结构（sections/tasks/layout）来自 <cwd>/.dsh-project/blueprint.json，init 时同步读取；
 * - 任务运行时状态从 tool/call 事件（task_claim/task_done）折叠重建；
 * - 产物从 tool/result（write/edit 的 path）归组；活动流从 tool/call+tool/result 配对。
 *
 * 纯同步 fold；无关事件返回同引用（Object.is 门控）。
 */

import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { autoSync } from './auto.js'

/** 无估算/无实测时的默认单任务分钟数（保证 ETA 不为空，V1.4 修复「还需 —」） */
const DEFAULT_TASK_MIN = 10

/** 极简 schema：满足 ProjectionDefinition 的 .parse 契约（v1 由本模块自控形状） */
const passthroughSchema = { parse: (value) => value }

/** 去掉蓝图 digest 字段（运行时不需要） */
function stripDigest(blueprint) {
  if (!blueprint || typeof blueprint !== 'object') return null
  const { digest, ...rest } = blueprint
  return rest
}

function loadBlueprint(cwd) {
  if (!cwd) return null
  const p = join(cwd, '.dsh-project', 'blueprint.json')
  if (!existsSync(p)) return null
  try {
    return JSON.parse(readFileSync(p, 'utf8'))
  } catch {
    return null
  }
}

/** 每任务实耗/用量/状态持久化（跨会话准确，唔使靠估） */
function loadMetrics(cwd) {
  if (!cwd || process.env.DSH_PROJECTION_NO_PERSIST) return {}
  try { return JSON.parse(readFileSync(join(cwd, '.dsh-project', 'metrics.json'), 'utf8')) || {} } catch { return {} }
}
function saveMetrics(cwd, taskId, rec) {
  if (!cwd || !taskId || process.env.DSH_PROJECTION_NO_PERSIST) return
  try {
    const dir = join(cwd, '.dsh-project'); mkdirSync(dir, { recursive: true })
    const all = loadMetrics(cwd)
    all[taskId] = { ...(all[taskId] || {}), ...rec }
    writeFileSync(join(dir, 'metrics.json'), JSON.stringify(all, null, 2) + '\n', 'utf8')
  } catch {}
}

/** 同步开关（.dsh-project/sync-config.json {enabled}，默认开） */
function syncEnabled(cwd) {
  try { return JSON.parse(readFileSync(join(cwd, '.dsh-project', 'sync-config.json'), 'utf8')).enabled !== false } catch { return true }
}
/** 全量对齐＋降频＋防阻塞：worker 线程做全量 autoSync（≥5s 节流），事件路径廉价合并 worker 全量结果 */
import { Worker } from 'node:worker_threads'
const FULL_INTERVAL = 5000
let lastFull = 0
let workerBusy = false
let cachedStatuses = null
function runFullSyncWorker(cwd) {
  if (workerBusy || Date.now() - lastFull < FULL_INTERVAL) return
  workerBusy = true
  try {
    const w = new Worker(new URL('./sync-worker.js', import.meta.url), { workerData: { cwd } })
    w.on('message', (m) => { workerBusy = false; lastFull = Date.now(); if (m && m.statuses) cachedStatuses = m.statuses; try { w.terminate() } catch {} })
    w.on('error', () => { workerBusy = false; try { w.terminate() } catch {} })
    w.on('exit', () => { workerBusy = false })
  } catch { workerBusy = false }
}
function applyAutoSync(state) {
  if (process.env.DSH_PROJECTION_NO_PERSIST) return state
  if (!state.cwd || !state.blueprint || !syncEnabled(state.cwd)) return state
  runFullSyncWorker(state.cwd)
  if (!cachedStatuses) return state
  const tasks = { ...state.tasks }
  let changed = false
  for (const id of Object.keys(tasks)) {
    const st = cachedStatuses[id]
    if (st && tasks[id].status !== 'running' && st !== tasks[id].status) { tasks[id] = { ...tasks[id], status: st }; changed = true }
  }
  return changed ? { ...state, tasks } : state
}

/** 活跃项目根：会话 cwd 下 .dsh-project/active.json 指向真正在做的项目（解决"当前对话非本项目"） */
export function activeRoot(cwd) {
  if (!cwd) return cwd
  try {
    const a = JSON.parse(readFileSync(join(cwd, '.dsh-project', 'active.json'), 'utf8'))
    if (a && a.root) return a.root
  } catch { /* 无 active.json → 用会话 cwd */ }
  return cwd
}

function initTasks(blueprint) {
  const tasks = {}
  for (const t of (blueprint && blueprint.tasks) || []) {
    tasks[t.id] = {
      status: t.status || 'pending',
      startedAt: null,
      endedAt: null,
      evidence: t.evidence || null,
      warning: null,
      spinLevel: 'normal',
      blockReason: null,
      estimateMinutes: t.estimateMinutes || null,
      contextEstimate: t.contextEstimate || null,
    }
  }
  return tasks
}

/** 规范化依赖/范围为数组（兼容误传的字符索引对象 {0:'a',1:'b'}） */
function asArray(v) {
  if (Array.isArray(v)) return v
  if (v && typeof v === 'object') {
    const keys = Object.keys(v).filter(k => /^\d+$/.test(k)).sort((a, b) => +a - +b)
    if (keys.length) { const s = keys.map(k => v[k]).join(''); return s ? [s] : [] }
    return []
  }
  if (typeof v === 'string' && v) return [v]
  return []
}

/** 从工具名+参数提取一个可读目标（当前动作展示用） */
function extractTarget(name, args) {
  if (!args) return null
  if (name === 'write' || name === 'edit' || name === 'read') return args.file_path || args.path || null
  if (name === 'bash' || name === 'pwsh') return null
  if (name === 'glob' || name === 'grep') return args.pattern || null
  if (args.taskId) return args.taskId
  if (args.file_path) return args.file_path
  return null
}

function applyToolCall(state, event) {
  const { callId, name, arguments: argsStr } = event.data || {}
  let args = null
  try { args = argsStr ? JSON.parse(argsStr) : null } catch { args = null }

  if (name === 'task_add' && args && args.taskId) {
    if (state.tasks[args.taskId]) return state
    const bp = state.blueprint || { sections: [], tasks: [] }
    const sections = (bp.sections || []).some(s => s.id === args.sectionId) ? bp.sections : [...(bp.sections || []), { id: args.sectionId || 'sec-adhoc', title: args.sectionTitle || args.sectionId || '临时板块', order: (bp.sections || []).length + 1 }]
    const nt = { id: args.taskId, sectionId: args.sectionId || 'sec-adhoc', title: args.title || args.taskId, description: args.description || '', acceptance: args.acceptance || '', dependsOn: asArray(args.dependsOn), scope: asArray(args.scope), estimateMinutes: args.estimateMinutes || null }
    return {
      ...state,
      blueprint: { ...bp, sections, tasks: [...(bp.tasks || []), nt] },
      tasks: { ...state.tasks, [args.taskId]: { status: 'pending', estimateMinutes: nt.estimateMinutes, startedAt: null, endedAt: null, spinLevel: 'normal' } },
    }
  }

  if (name === 'task_claim' && args && args.taskId) {
    const task = state.tasks[args.taskId]
    if (!task) return state
    return {
      ...state,
      tasks: { ...state.tasks, [args.taskId]: { ...task, status: 'running', startedAt: event.time || Date.now(), endedAt: null, blockReason: null, spinLevel: 'normal', spinSeq: [] } },
    }
  }

  if (name === 'task_done' && args && args.taskId) {
    const task = state.tasks[args.taskId]
    if (!task) return state
    const status = args.status || 'done'
    const now = event.time || Date.now()
    const next = { ...task, status, endedAt: now }
    if (status === 'done' && task.startedAt) next.elapsedMs = Math.max(0, now - task.startedAt)
    if (status === 'done') next.evidence = args.evidence || null
    if (status === 'blocked') next.blockReason = args.reason || null
    if (status === 'pending') { next.blockReason = null; next.startedAt = null; next.evidence = null }

    let durations = state.durations
    if (status === 'done' && task.startedAt) {
      durations = [...state.durations.slice(-19), Math.max(0, now - task.startedAt)]
    }
    saveMetrics(state.cwd, args.taskId, { status, startedAt: next.startedAt, endedAt: next.endedAt, elapsedMs: next.elapsedMs != null ? next.elapsedMs : (task.startedAt ? Math.max(0, now - task.startedAt) : 0), tokensUsed: (state.tokens || {})[args.taskId] || 0 })
    return { ...state, tasks: { ...state.tasks, [args.taskId]: next }, durations }
  }

  // 其他工具调用 → 记入 pending（等待 result 配对）；并即刻记入活动流（running，最新即时可见）
  return {
    ...state,
    pendingCalls: { ...state.pendingCalls, [callId]: { tool: name, target: extractTarget(name, args), t0: event.time } },
    activity: [...state.activity.slice(-63), { callId, tool: name, target: extractTarget(name, args), t0: event.time, t1: null, error: false, plus: null, minus: null }],
  }
}

function applyToolResult(state, event) {
  const { message } = event.data || {}
  const callId = message && message.source && message.source.callId
  if (!callId) return state

  const pending = state.pendingCalls[callId]
  let next = state

  if (pending) {
    // 活动流（最近 64 条）；编辑类捕获 diff 数字供编辑卡
    let plus = null, minus = null
    if (pending.tool === 'edit' || pending.tool === 'write') {
      const txt = Array.isArray(message.content) ? message.content.filter(b => b && b.type === 'text').map(b => b.text).join(' ') : ''
      const m = txt.match(/\+\s*(\d+)\s*[-−]\s*(\d+)/)
      if (m) { plus = +m[1]; minus = +m[2] }
    }
    const item = { callId, tool: pending.tool, target: pending.target, t0: pending.t0, t1: event.time, error: message.isError === true, plus, minus }
    const exists = next.activity.some(a => a.callId === callId)
    next = { ...next, activity: exists ? next.activity.map(a => a.callId === callId ? item : a) : [...next.activity.slice(-63), item] }
    const remaining = Object.fromEntries(Object.entries(state.pendingCalls).filter(([id]) => id !== callId))
    next = { ...next, pendingCalls: remaining }

    // 产物归组：write/edit 的 path；无 running 任务 → unclaimed（R6）
    if (pending.tool === 'write' || pending.tool === 'edit') {
      const path = pending.target
      if (path) {
        const runningId = Object.keys(state.tasks).find(id => state.tasks[id].status === 'running')
        if (runningId) {
          const list = (state.artifacts[runningId] || []).slice(-31)
          next = { ...next, artifacts: { ...state.artifacts, [runningId]: [...list, { path, callId, at: event.time }] } }
        } else {
          next = { ...next, unclaimed: [...(state.unclaimed || []).slice(-31), { path, callId, at: event.time }] }
        }
      }
    }

    // 打转检测（REQ-07）：同工具同目标≥3 → 标琥珀+列出序列；只提示不干预
    if (pending.tool && pending.target) {
      const key = pending.tool + '|' + pending.target
      const prev = (state.spins || {})[key] || { count: 0, seq: [] }
      const seq = [...prev.seq.slice(-7), { tool: pending.tool, target: pending.target, at: event.time }]
      const count = prev.count + 1
      next = { ...next, spins: { ...(state.spins || {}), [key]: { count, seq } } }
      if (count >= 3) {
        const rid = Object.keys(next.tasks).find(id => next.tasks[id].status === 'running')
        if (rid) next = { ...next, tasks: { ...next.tasks, [rid]: { ...next.tasks[rid], spinLevel: 'warn', spinSeq: seq } } }
      }
    }
  }
  return next
}

/** 折叠 assistant/message：捕获最近一段助手文本作为"下一步意图"素材（R3） */
function applyAssistantMessage(state, event) {
  const content = event.data && event.data.message && event.data.message.content
  if (!Array.isArray(content)) return state
  const text = content.filter(b => b && b.type === 'text' && typeof b.text === 'string').map(b => b.text).join(' ').trim()
  if (!text) return state
  return { ...state, lastIntentText: text.slice(0, 300), messages: [...(state.messages || []).slice(-49), { role: 'assistant', text: text.slice(0, 2000), at: event.time }] }
}

function applyUserMessage(state, event) {
  const content = event.data && event.data.message && event.data.message.content
  const text = Array.isArray(content) ? content.filter(b => b && b.type === 'text' && typeof b.text === 'string').map(b => b.text).join(' ').trim() : (typeof content === 'string' ? content : '')
  if (!text) return state
  return { ...state, messages: [...(state.messages || []).slice(-49), { role: 'user', text: text.slice(0, 2000), at: event.time }] }
}

/** 累计 token 消耗到当前 running 任务：仅 assistant/message、按消息 id 去重、用单条 input+output，避免重复/累计膨胀 */
function captureUsage(state, event) {
  const d = event.data || {}
  const msg = d.message || null
  const u = d.usage || (msg && msg.usage) || null
  if (!u) return state
  const mid = (msg && (msg.id || msg.messageId)) || null
  const seen = state._usageIds || []
  if (mid && seen.includes(mid)) return state
  const tok = (u.inputTokens || u.input_tokens || 0) + (u.outputTokens || u.output_tokens || 0) || u.totalTokens || u.total_tokens || 0
  if (!tok) return state
  const sessionTokens = ((state.sessionTokens || 0) + tok)
  const sessionStart = state.sessionStart || (typeof event.time === 'number' ? event.time : Date.now())
  const rid = Object.keys(state.tasks).find(id => state.tasks[id].status === 'running')
  const tokens = rid ? { ...(state.tokens || {}), [rid]: ((state.tokens || {})[rid] || 0) + tok } : (state.tokens || {})
  return { ...state, sessionTokens, sessionStart, _usageIds: [...seen.slice(-199), mid].filter(Boolean), tokens }
}

function computeCounts(tasks) {
  const counts = { total: 0, done: 0, running: 0, blocked: 0, pending: 0 }
  for (const id of Object.keys(tasks)) {
    counts.total++
    const s = tasks[id].status
    if (s === 'done') counts.done++
    else if (s === 'running') counts.running++
    else if (s === 'blocked') counts.blocked++
    else counts.pending++
  }
  return counts
}

function computeEta(tasks, durations) {
  const remainingTasks = Object.values(tasks).filter(t => t.status === 'pending' || t.status === 'blocked')
  if (remainingTasks.length === 0) return { ms: 0, confidence: 'none', lowMs: 0, highMs: 0 }
  const mean = durations.length >= 3 ? durations.reduce((a, b) => a + b, 0) / durations.length : null
  let total = 0
  let hasEstimate = false
  let hasMeasured = false
  for (const t of remainingTasks) {
    if (t.estimateMinutes != null && t.estimateMinutes > 0) { total += t.estimateMinutes * 60000; hasEstimate = true }
    else if (mean != null) { total += mean; hasMeasured = true }
    else { total += DEFAULT_TASK_MIN * 60000; hasEstimate = true }
  }
  const confidence = hasMeasured && hasEstimate ? 'mixed' : hasMeasured ? 'measured' : 'estimated'
  return { ms: total, confidence, lowMs: total * 0.5, highMs: total * 1.5 }
}

/** 下一步意图（R3）：running 任务 + 最近助手文本 */
function computeNextIntent(state) {
  const runningId = Object.keys(state.tasks).find(id => state.tasks[id].status === 'running')
  if (runningId && state.lastIntentText) return { text: state.lastIntentText, taskId: runningId }
  return null
}

/** 任务内进度（R4）：running 任务已产出文件数 */
function computeTaskProgress(state) {
  const out = {}
  for (const id of Object.keys(state.tasks)) {
    if (state.tasks[id].status === 'running') {
      out[id] = { files: (state.artifacts[id] || []).length }
    }
  }
  return out
}

function computeCurrentAction(state) {
  // 最近一个 running 工具的 pending/activity
  const last = state.activity[state.activity.length - 1]
  if (!last) return null
  const runningTask = Object.keys(state.tasks).find(id => state.tasks[id].status === 'running')
  return { tool: last.tool, target: last.target, taskId: runningTask || null, elapsedMs: last.t1 - last.t0 }
}

function computeOverview(state) {
  const blueprint = state.blueprint
  if (!blueprint || !blueprint.layout) return { nodes: [], edges: [], focusRegionId: null }
  const regions = blueprint.layout.regions || []
  const nodes = regions.map(r => {
    const ids = r.sectionIds || []
    const tasksInRegion = (blueprint.tasks || []).filter(t => ids.includes(t.sectionId))
    const done = tasksInRegion.filter(t => state.tasks[t.id] && state.tasks[t.id].status === 'done').length
    const total = tasksInRegion.length
    const hasRunning = tasksInRegion.some(t => state.tasks[t.id] && state.tasks[t.id].status === 'running')
    const hasBlocked = tasksInRegion.some(t => state.tasks[t.id] && state.tasks[t.id].status === 'blocked')
    const status = hasRunning ? 'running' : hasBlocked ? 'blocked' : (total > 0 && done === total) ? 'done' : 'pending'
    const pct = total > 0 ? Math.round((done / total) * 100) : 0
    return { id: r.id, title: r.title, progress: { done, total }, pct, status, viz: r.viz, span: r.span }
  })
  // region 级依赖边（聚合 task.dependsOn）
  const regionOfTask = {}
  for (const r of regions) for (const sid of r.sectionIds || []) regionOfTask[sid] = r.id
  const edges = []
  for (const t of blueprint.tasks || []) {
    const from = regionOfTask[t.sectionId]
    for (const dep of (Array.isArray(t.dependsOn) ? t.dependsOn : [])) {
      const depTask = (blueprint.tasks || []).find(x => x.id === dep)
      const to = depTask ? regionOfTask[depTask.sectionId] : null
      if (from && to && from !== to) {
        const key = from + '>' + to
        if (!edges.some(e => e.key === key)) edges.push({ key, source: from, target: to })
      }
    }
  }
  const runningTask = Object.keys(state.tasks).find(id => state.tasks[id].status === 'running')
  let focusRegionId = null
  if (runningTask) {
    const t = (blueprint.tasks || []).find(x => x.id === runningTask)
    if (t) focusRegionId = regionOfTask[t.sectionId] || null
  }
  return { nodes, edges, focusRegionId }
}

function computeView(state) {
  const counts = computeCounts(state.tasks)
  const eta = computeEta(state.tasks, state.durations)
  const currentAction = computeCurrentAction(state)
  const overview = computeOverview(state)
  return {
    v: 1,
    cwd: state.cwd || null,
    blueprint: state.blueprint,
    tasks: state.tasks,
    artifacts: state.artifacts,
    unclaimed: state.unclaimed || [],
    counts,
    eta,
    taskEta: computeTaskEta(state),
    taskMetrics: computeTaskMetrics(state),
    currentAction,
    nextIntent: computeNextIntent(state),
    taskProgress: computeTaskProgress(state),
    overview,
    activity: state.activity,
    messages: state.messages || [],
    sessionUsage: { tokens: state.sessionTokens || 0, elapsedMs: state.sessionStart ? Math.max(0, Date.now() - state.sessionStart) : 0 },
    fileConsistent: true,
  }
}

/** 每任务预计等待（REQ-17）：done=0；running=剩余估计；pending=估算或实测均值 */
function computeTaskEta(state) {
  const mean = state.durations.length >= 3 ? state.durations.reduce((a, b) => a + b, 0) / state.durations.length : null
  const out = {}
  for (const id of Object.keys(state.tasks)) {
    const t = state.tasks[id]
    if (t.status === 'done') { out[id] = { ms: 0, confidence: 'none' }; continue }
    const est = t.estimateMinutes != null && t.estimateMinutes > 0 ? t.estimateMinutes * 60000 : null
    const fallback = DEFAULT_TASK_MIN * 60000
    if (t.status === 'running') {
      const elapsed = t.startedAt ? Date.now() - t.startedAt : 0
      const base = est != null ? est : (mean != null ? mean : fallback)
      out[id] = { ms: Math.max(0, base - elapsed), confidence: est != null ? 'estimated' : mean != null ? 'measured' : 'estimated' }
    } else {
      out[id] = est != null ? { ms: est, confidence: 'estimated' } : mean != null ? { ms: mean, confidence: 'measured' } : { ms: fallback, confidence: 'estimated' }
    }
  }
  return out
}

/** 每任务时间/TOKEN 指标：done=实耗；running=已耗+还需+预估；pending=预估 */
const DEFAULT_TOKENS = 20000
function computeTaskMetrics(state) {
  const eta = computeTaskEta(state)
  const out = {}
  for (const id of Object.keys(state.tasks)) {
    const t = state.tasks[id]
    const elapsed = t.elapsedMs != null ? t.elapsedMs : (t.startedAt ? ((t.endedAt || Date.now()) - t.startedAt) : 0)
    const used = (state.tokens || {})[id] || 0
    const est = t.estimateTokens || (t.estimateMinutes ? t.estimateMinutes * 2000 : null)
    out[id] = {
      elapsedMs: t.status === 'pending' ? 0 : elapsed,
      remainingMs: t.status === 'done' ? 0 : (eta[id] ? eta[id].ms : null),
      tokensUsed: used,
      tokensEst: est,
    }
  }
  return out
}

export const projectBoardProjection = {
  key: 'projectBoard',
  stateVersion: 12,
  stateSchema: passthroughSchema,
  init(header) {
    const root = activeRoot(header && header.cwd)
    const blueprint = loadBlueprint(root)
    const metrics = loadMetrics(root)
    const tasks = initTasks(blueprint)
    const tokens = {}
    for (const id of Object.keys(tasks)) {
      const m = metrics[id]
      if (m) {
        tasks[id] = { ...tasks[id], status: m.status || tasks[id].status, startedAt: m.startedAt || null, endedAt: m.endedAt || null, elapsedMs: m.elapsedMs != null ? m.elapsedMs : tasks[id].elapsedMs }
        if (m.tokensUsed) tokens[id] = m.tokensUsed
      }
    }
    return {
      v: 1,
      cwd: root || null,
      blueprint: stripDigest(blueprint),
      tasks,
      activity: [],
      pendingCalls: {},
      artifacts: {},
      unclaimed: [],
      spins: {},
      durations: [],
      tokens,
      messages: [],
      lastIntentText: null,
    }
  },
  apply(state, event) {
    let next
    switch (event.type) {
      case 'tool/call': next = applyToolCall(state, event); break
      case 'tool/result': next = applyToolResult(state, event); break
      case 'user': next = applyUserMessage(state, event); break
      case 'assistant/message': next = captureUsage(applyAssistantMessage(state, event), event); break
      case 'step/end': next = state; break
      case 'turn/start': next = Object.keys(state.pendingCalls).length === 0 ? state : { ...state, pendingCalls: {} }; break
      case 'turn/end': next = Object.keys(state.pendingCalls).length === 0 ? state : { ...state, pendingCalls: {} }; break
      default: next = state
    }
    if (event.type === 'tool/result' || event.type === 'turn/end' || event.type === 'assistant/message') next = applyAutoSync(next)
    return next
  },
  wire: {
    viewSchema: passthroughSchema,
    view(state) { return computeView(state) },
  },
}
