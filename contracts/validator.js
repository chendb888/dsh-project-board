/**
 * 共享契约校验器（contracts/validator.js）
 *
 * 纯 ESM，零业务依赖（仅 node:crypto）。项目一（建模器）与项目二（看板）
 * 共同 import 本模块，保证同一套校验规则，杜绝两边规则漂移。
 *
 * 职责：
 *  - validateBlueprint：校验 blueprint v1/v2（schema + DAG + layout 规则）
 *  - detectCycle：任务依赖环检测
 *  - computeDigest：规范化序列化后的 sha256 摘要（乐观锁）
 *  - defaultLayout：为无 layout 的 v1 蓝图生成兼容默认布局
 */

import { createHash } from 'node:crypto'

/** 契约版本 */
export const BLUEPRINT_VERSION = 2

/** 已注册的 viz 组件类型；未知→运行时 fallback checklist，但写入时校验 */
export const VIZ_TYPES = new Set([
  'progress-cards',
  'entity-grid',
  'dependency-dag',
  'checklist',
  'kanban-lanes',
  'asset-browser',
])

/** 任务状态枚举 */
export const TASK_STATUSES = new Set(['pending', 'running', 'done', 'blocked'])

/** span 枚举 */
export const SPANS = new Set(['full', 'half', 'third'])

/** 错误码 → 缺省消息 */
const ERROR_DEFAULTS = {
  INVALID_SCHEMA: '字段缺失或类型错误',
  DUPLICATE_ID: 'id 重复',
  DANGLING_REF: '引用不存在',
  CYCLE_DETECTED: '依赖成环',
  EVIDENCE_REQUIRED: 'done 任务必须附证据',
  INVALID_LAYOUT: '布局配置非法',
  ORPHAN_SECTION: '板块未被任何 region 包含',
  INVALID_VIZ: '未知的 viz 类型',
  PATH_ESCAPE: '路径逃逸（禁止 ../ 或绝对路径）',
}

/**
 * 规范化序列化：递归按键排序、排除 digest 字段。
 * 保证字段顺序不同的等价对象得到相同摘要。
 */
function canonicalize(value) {
  if (value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map(canonicalize)
  const out = {}
  for (const key of Object.keys(value).sort()) {
    if (key === 'digest') continue
    out[key] = canonicalize(value[key])
  }
  return out
}

/** 计算蓝图摘要（排除 digest 字段本身） */
export function computeDigest(blueprint) {
  const canonical = canonicalize(blueprint)
  const json = JSON.stringify(canonical)
  const hash = createHash('sha256').update(json, 'utf8').digest('hex')
  return `sha256:${hash}`
}

/** 是否合法相对路径（无 ../ 逃逸、非绝对、非空） */
function isSafeRelativePath(path) {
  if (typeof path !== 'string' || path.length === 0) return false
  if (path.startsWith('/') || path.startsWith('\\')) return false
  if (/^[a-zA-Z]:[\\/]/.test(path)) return false
  const parts = path.replace(/\\/g, '/').split('/')
  return !parts.includes('..')
}

function fail(errors, code, path, message) {
  errors.push({ code, path, message: message || ERROR_DEFAULTS[code] || code })
}

function isNonEmptyString(value, max) {
  return typeof value === 'string' && value.length > 0 && (max === undefined || value.length <= max)
}

/** 可选字符串：缺省或空串或不超过 max 长度均合法 */
function isOptionalString(value, max) {
  return value === undefined || (typeof value === 'string' && value.length <= max)
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/**
 * 依赖环检测（DFS 三色标记）。
 * @param tasks 任务数组（需含 id 与 dependsOn）
 * @returns 环路径数组（如 ['t-1','t-2','t-1']），无环返回 null
 */
export function detectCycle(tasks) {
  const byId = new Map(tasks.map(t => [t.id, t]))
  const WHITE = 0, GRAY = 1, BLACK = 2
  const color = new Map()
  const stack = []
  const onStack = new Set()

  function visit(id) {
    color.set(id, GRAY)
    stack.push(id)
    onStack.add(id)
    const task = byId.get(id)
    for (const dep of (task && task.dependsOn) || []) {
      const c = color.get(dep) ?? WHITE
      if (c === GRAY && onStack.has(dep)) {
        const start = stack.indexOf(dep)
        return [...stack.slice(start), dep]
      }
      if (c === WHITE) {
        const found = visit(dep)
        if (found) return found
      }
    }
    stack.pop()
    onStack.delete(id)
    color.set(id, BLACK)
    return null
  }

  for (const task of tasks) {
    if ((color.get(task.id) ?? WHITE) === WHITE) {
      const found = visit(task.id)
      if (found) return found
    }
  }
  return null
}

/**
 * 校验蓝图（v1 兼容：无 layout 时自动补默认布局）。
 * @param input 任意输入
 * @returns { ok:true, value } 或 { ok:false, errors: [{code,path,message}] }
 */
export function validateBlueprint(input) {
  const errors = []
  if (!isRecord(input)) {
    return { ok: false, errors: [{ code: 'INVALID_SCHEMA', path: '$', message: '蓝图必须是对象' }] }
  }

  const version = input.version
  if (version !== 1 && version !== 2) {
    fail(errors, 'INVALID_SCHEMA', '$.version', `version 必须为 1 或 2，得到 ${String(version)}`)
    return { ok: false, errors }
  }

  // ---- project ----
  const project = input.project
  if (!isRecord(project)) {
    fail(errors, 'INVALID_SCHEMA', '$.project')
  } else {
    if (!isNonEmptyString(project.name, 120)) fail(errors, 'INVALID_SCHEMA', '$.project.name')
    if (!isNonEmptyString(project.domain, 80)) fail(errors, 'INVALID_SCHEMA', '$.project.domain')
    if (!isNonEmptyString(project.objective, 500)) fail(errors, 'INVALID_SCHEMA', '$.project.objective')
    if (!Number.isSafeInteger(project.createdAt) || project.createdAt < 0) fail(errors, 'INVALID_SCHEMA', '$.project.createdAt')
    if (project.confirmedAt !== null && !Number.isSafeInteger(project.confirmedAt)) fail(errors, 'INVALID_SCHEMA', '$.project.confirmedAt')
  }

  // ---- sections ----
  const sections = Array.isArray(input.sections) ? input.sections : null
  if (sections === null) {
    fail(errors, 'INVALID_SCHEMA', '$.sections')
  } else {
    const secIds = new Set()
    sections.forEach((sec, i) => {
      const p = `$.sections[${i}]`
      if (!isRecord(sec)) return fail(errors, 'INVALID_SCHEMA', p)
      if (!isNonEmptyString(sec.id) || !/^sec-/.test(sec.id)) fail(errors, 'INVALID_SCHEMA', `${p}.id`, 'id 需 sec- 前缀')
      else if (secIds.has(sec.id)) fail(errors, 'DUPLICATE_ID', `${p}.id`)
      else secIds.add(sec.id)
      if (!isNonEmptyString(sec.title, 80)) fail(errors, 'INVALID_SCHEMA', `${p}.title`)
      if (!isOptionalString(sec.description, 500)) fail(errors, 'INVALID_SCHEMA', `${p}.description`)
      if (!Number.isSafeInteger(sec.order) || sec.order < 0) fail(errors, 'INVALID_SCHEMA', `${p}.order`)
    })
  }

  // ---- tasks ----
  const tasks = Array.isArray(input.tasks) ? input.tasks : null
  const taskIds = new Set()
  if (tasks === null) {
    fail(errors, 'INVALID_SCHEMA', '$.tasks')
  } else if (tasks.length < 1) {
    fail(errors, 'INVALID_SCHEMA', '$.tasks', '至少 1 个任务')
  } else if (tasks.length > 200) {
    fail(errors, 'INVALID_SCHEMA', '$.tasks', '任务数超过 200 上限')
  } else {
    tasks.forEach((task, i) => {
      const p = `$.tasks[${i}]`
      if (!isRecord(task)) return fail(errors, 'INVALID_SCHEMA', p)
      if (!isNonEmptyString(task.id) || !/^t-/.test(task.id)) fail(errors, 'INVALID_SCHEMA', `${p}.id`, 'id 需 t- 前缀')
      else if (taskIds.has(task.id)) fail(errors, 'DUPLICATE_ID', `${p}.id`)
      else taskIds.add(task.id)

      // sectionId 引用存在性（或 null 扁平模式）
      if (task.sectionId !== null) {
        if (sections && !sections.some(s => s.id === task.sectionId)) {
          fail(errors, 'DANGLING_REF', `${p}.sectionId`, `sectionId ${String(task.sectionId)} 不存在`)
        }
      }
      if (!isNonEmptyString(task.title, 120)) fail(errors, 'INVALID_SCHEMA', `${p}.title`)
      if (!isOptionalString(task.description, 1000)) fail(errors, 'INVALID_SCHEMA', `${p}.description`)
      if (!Array.isArray(task.dependsOn)) fail(errors, 'INVALID_SCHEMA', `${p}.dependsOn`)
      else task.dependsOn.forEach((dep, j) => {
        if (!taskIds.has(dep) && !tasks.some(t => t.id === dep)) {
          fail(errors, 'DANGLING_REF', `${p}.dependsOn[${j}]`, `依赖 ${String(dep)} 不存在`)
        }
      })
      if (!isNonEmptyString(task.acceptance, 2000)) fail(errors, 'INVALID_SCHEMA', `${p}.acceptance`)
      if (task.scope !== undefined && (!Array.isArray(task.scope) || task.scope.some(s => typeof s !== 'string'))) {
        fail(errors, 'INVALID_SCHEMA', `${p}.scope`)
      }
      if (task.estimateMinutes !== null && task.estimateMinutes !== undefined && !(Number.isFinite(task.estimateMinutes) && task.estimateMinutes > 0)) {
        fail(errors, 'INVALID_SCHEMA', `${p}.estimateMinutes`)
      }
      if (!TASK_STATUSES.has(task.status)) fail(errors, 'INVALID_SCHEMA', `${p}.status`, `status 需为 ${[...TASK_STATUSES].join('|')}`)
      // done ⇒ evidence 必填
      if (task.status === 'done') {
        const ev = task.evidence
        if (!isRecord(ev) || !isNonEmptyString(ev.summary) || !Number.isSafeInteger(ev.at)) {
          fail(errors, 'EVIDENCE_REQUIRED', `${p}.evidence`, 'done 任务必须附有效证据（summary 非空 + at 时间戳）')
        } else if (ev.kind === 'test' && (!isNonEmptyString(ev.command) || !Number.isInteger(ev.exitCode))) {
          fail(errors, 'EVIDENCE_REQUIRED', `${p}.evidence`, 'kind=test 的证据必须附 command（非空）与 exitCode（整数）')
        }
      }
    })

    // DAG 环检测（仅在无 DANGLING_REF 时进行，避免环检测读到不存在的节点）
    if (!errors.some(e => e.code === 'DANGLING_REF')) {
      const cycle = detectCycle(tasks)
      if (cycle) fail(errors, 'CYCLE_DETECTED', '$.tasks', `依赖成环：${cycle.join(' → ')}`)
    }
  }

  // ---- layout ----
  let layout = input.layout
  if (version === 1 || layout === undefined) {
    // v1 兼容：自动补默认布局
    layout = defaultLayout({ sections, tasks })
  }
  validateLayout(layout, sections, errors)

  if (errors.length > 0) return { ok: false, errors }

  // 组装规范化输出
  const value = { ...input, version: BLUEPRINT_VERSION, layout }
  return { ok: true, value }
}

function validateLayout(layout, sections, errors) {
  if (!isRecord(layout)) {
    return fail(errors, 'INVALID_LAYOUT', '$.layout')
  }
  if (!['pipeline', 'grid', 'tree', 'kanban', 'custom'].includes(layout.kind)) {
    fail(errors, 'INVALID_LAYOUT', '$.layout.kind')
  }
  const regions = Array.isArray(layout.regions) ? layout.regions : null
  if (!regions || regions.length < 1) {
    return fail(errors, 'INVALID_LAYOUT', '$.layout.regions', '至少 1 个 region')
  }

  const secIds = new Set((sections || []).map(s => s.id))
  const regionIds = new Set()
  const covered = new Set()

  regions.forEach((region, i) => {
    const p = `$.layout.regions[${i}]`
    if (!isRecord(region)) return fail(errors, 'INVALID_LAYOUT', p)
    if (!isNonEmptyString(region.id) || !/^r-/.test(region.id)) fail(errors, 'INVALID_LAYOUT', `${p}.id`, 'id 需 r- 前缀')
    else if (regionIds.has(region.id)) fail(errors, 'DUPLICATE_ID', `${p}.id`)
    else regionIds.add(region.id)

    if (!isNonEmptyString(region.title, 80)) fail(errors, 'INVALID_LAYOUT', `${p}.title`)
    if (!Array.isArray(region.sectionIds)) fail(errors, 'INVALID_LAYOUT', `${p}.sectionIds`)
    else region.sectionIds.forEach((sid, j) => {
      if (!secIds.has(sid)) fail(errors, 'DANGLING_REF', `${p}.sectionIds[${j}]`, `sectionId ${String(sid)} 不存在`)
      else covered.add(sid)
    })
    if (!VIZ_TYPES.has(region.viz)) fail(errors, 'INVALID_VIZ', `${p}.viz`, `viz 需为 ${[...VIZ_TYPES].join('|')}`)
    if (!SPANS.has(region.span)) fail(errors, 'INVALID_LAYOUT', `${p}.span`)
    if (!Array.isArray(region.codeRoots)) fail(errors, 'INVALID_LAYOUT', `${p}.codeRoots`)
    else region.codeRoots.forEach((root, j) => {
      if (!isSafeRelativePath(root)) fail(errors, 'PATH_ESCAPE', `${p}.codeRoots[${j}]`)
    })
    if (region.assetRoots !== undefined) {
      if (!Array.isArray(region.assetRoots)) fail(errors, 'INVALID_LAYOUT', `${p}.assetRoots`)
      else region.assetRoots.forEach((root, j) => {
        if (!isSafeRelativePath(root)) fail(errors, 'PATH_ESCAPE', `${p}.assetRoots[${j}]`)
      })
    }
  })

  // 孤儿板块检查：每个 section 至少被一个 region 包含（仅在 sections 非空时）
  if (sections && sections.length > 0) {
    for (const sec of sections) {
      if (!covered.has(sec.id)) {
        fail(errors, 'ORPHAN_SECTION', '$.layout.regions', `板块 ${sec.id} 未被任何 region 包含`)
      }
    }
  }
}

/** 为无 layout 的 v1 蓝图生成兼容默认布局 */
export function defaultLayout(blueprint) {
  const sections = blueprint.sections || []
  return {
    kind: 'tree',
    regions: [{
      id: 'r-all',
      title: '全部任务',
      sectionIds: sections.map(s => s.id),
      viz: 'checklist',
      span: 'full',
      codeRoots: [],
      assetRoots: [],
    }],
    focus: { rule: 'first-incomplete' },
    detailPanel: { tabs: ['artifacts', 'code', 'history', 'guide'], codePreview: true, guidePlaceholder: true },
  }
}

/**
 * 质量闸门（t-m1-quality，REQ-13 / R1）：结构合法≠分解得好。
 * 只产警告（warnings），不硬拒绝——由建模器/用户在 confirm 前评审。
 * @param blueprint 已通过 validateBlueprint 的蓝图
 * @param contextBudget 模型上下文窗口 token 数；缺省跳过上下文粒度检查
 * @returns { warnings: [{code, path, message}] }
 */
export function qualityCheck(blueprint, contextBudget = null) {
  const warnings = []
  const tasks = (blueprint && blueprint.tasks) || []

  // 粒度失衡：最大/最小 estimateMinutes 比值 > 10（大任务小任务严重失衡）
  const estimates = tasks.filter(t => t.estimateMinutes != null && t.estimateMinutes > 0).map(t => t.estimateMinutes)
  if (estimates.length >= 2) {
    const maxE = Math.max(...estimates)
    const minE = Math.min(...estimates)
    if (minE > 0 && maxE / minE > 10) {
      warnings.push({ code: 'GRANULARITY_VARIANCE', path: '$.tasks', message: `任务粒度失衡：最大/最小 estimateMinutes 比值 ${(maxE / minE).toFixed(1)} > 10` })
    }
  }

  // 上下文粒度：contextEstimate 超预算 70% 且未拆子任务 → 标记（REQ-13）
  if (contextBudget != null && contextBudget > 0) {
    const budget = Math.round(contextBudget * 0.7)
    for (const t of tasks) {
      if (t.contextEstimate != null && t.contextEstimate > budget && (!Array.isArray(t.subtasks) || t.subtasks.length === 0)) {
        warnings.push({ code: 'CONTEXT_OVER_BUDGET', path: `$.tasks[${t.id}]`, message: `任务 ${t.id} 上下文占用 ${t.contextEstimate} 超预算 ${budget}，但未拆子任务` })
      }
    }
  }

  // 验收可测：acceptance 缺少可验证动作词
  const ACTION_WORDS = /通过|运行|测试|校验|编译|渲染|生成|返回|拒绝|崩溃|可见|全绿|exit|schema|断言|不崩溃|存在|拒绝/
  for (const t of tasks) {
    if (typeof t.acceptance === 'string' && t.acceptance.length > 0 && !ACTION_WORDS.test(t.acceptance)) {
      warnings.push({ code: 'ACCEPTANCE_NOT_MEASURABLE', path: `$.tasks[${t.id}].acceptance`, message: '验收标准缺少可验证动作词（通过/运行/测试/校验/可见/拒绝…）' })
    }
  }

  return { warnings }
}
