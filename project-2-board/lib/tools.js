/**
 * 看板工具（t-m2-tools）：task_claim / task_done
 *
 * 守卫在 Host 侧代码强制（对应货运险 ADR-09：安全规则由代码强制）。
 * 工具写蓝图文件（结构离线镜像 + 状态快照）；运行时状态由投影从 tool/call 事件折叠。
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { computeDigest, validateBlueprint, defaultLayout, qualityCheck } from '../../contracts/validator.js'
import { generateExplanation, askContext } from '../../project-3-guide/lib/guide.js?v=2'

function blueprintPath(cwd) {
  return join(cwd, '.dsh-project', 'blueprint.json')
}

function loadBlueprint(cwd) {
  if (!cwd) return null
  const p = blueprintPath(cwd)
  if (!existsSync(p)) return null
  try { return JSON.parse(readFileSync(p, 'utf8')) } catch { return null }
}

function saveBlueprint(cwd, bp) {
  bp.digest = computeDigest(bp)
  writeFileSync(blueprintPath(cwd), JSON.stringify(bp, null, 2) + '\n', 'utf8')
}

function cwdOf(exec) {
  const cwd = exec.agent && exec.agent.session && exec.agent.session.header ? exec.agent.session.header.cwd : undefined
  if (!cwd) return undefined
  try {
    const a = JSON.parse(readFileSync(join(cwd, '.dsh-project', 'active.json'), 'utf8'))
    if (a && a.root) return a.root
  } catch { /* 无 active.json → 会话 cwd */ }
  return cwd
}

function taskError(code, message) {
  const e = new Error(`${code}: ${message}`)
  e.code = code
  return e
}

/** task_claim：三重守卫（蓝图确认 / 依赖 done / 并发上限）+ 写文件标 running */
export function createClaimTool(ctx) {
  const maxParallel = 1
  // 入口 index.js 可能被 Host 缓存；借动态重载的 tools.js 副作用注册建模器工具（幂等，重复忽略）
  try { ctx.tools.register(createInitTool(ctx)) } catch {}
  try { ctx.tools.register(createBootstrapTool(ctx)) } catch {}
  try { ctx.tools.register(createGuideTool(ctx)) } catch {}
  try { ctx.tools.register(createGuideAskTool(ctx)) } catch {}
  try { ctx.tools.register(createTaskAddTool(ctx)) } catch {}
  try { ctx.tools.register(createSwitchTool(ctx)) } catch {}
  return {
    name: 'task_claim',
    description: '领取下一个可做任务并标记 running。守卫：蓝图已确认（confirmedAt≠null）、所有 dependsOn 已 done、同时 running 不超过上限。失败返回结构化错误。',
    parameters: {
      type: 'object',
      properties: {
        taskId: { type: 'string', description: '要领取的任务 id（如 t-m2-tools）' },
      },
      required: ['taskId'],
      additionalProperties: false,
    },
    output: {
      schema: { type: 'object' },
      render: (_args, value) => [{ type: 'text', text: `已领取 ${value.taskId} → running` }],
    },
    async execute(args, exec) {
      const cwd = cwdOf(exec)
      const bp = loadBlueprint(cwd)
      if (!bp) throw taskError('NO_BLUEPRINT', '项目无蓝图：先 project_init 或手写 .dsh-project/blueprint.json')
      if (!bp.project || bp.project.confirmedAt == null) throw taskError('BLUEPRINT_UNCONFIRMED', '蓝图未确认（confirmedAt=null），拒绝领取')
      const task = (bp.tasks || []).find(t => t.id === args.taskId)
      if (!task) throw taskError('UNKNOWN_TASK', `任务 ${args.taskId} 不存在`)
      if (task.status === 'running') throw taskError('ALREADY_RUNNING', `任务 ${args.taskId} 已 running`)
      const notDone = (task.dependsOn || []).filter(d => {
        const dt = (bp.tasks || []).find(t => t.id === d)
        return !dt || dt.status !== 'done'
      })
      if (notDone.length > 0) throw taskError('DEPS_NOT_READY', `依赖未完成：${notDone.join(', ')}`)
      const running = (bp.tasks || []).filter(t => t.status === 'running').length
      if (running >= maxParallel) throw taskError('CONCURRENCY_LIMIT', `并发超限：已有 ${running} 个 running（上限 ${maxParallel}）`)
      task.status = 'running'
      saveBlueprint(cwd, bp)
      return { taskId: args.taskId, status: 'running', startedAt: Date.now() }
    },
  }
}

/** task_done：证据门（done 必附 evidence）+ 写文件标 done/blocked/pending */
export function createDoneTool(ctx) {
  return {
    name: 'task_done',
    description: '标记任务完成/阻塞/回到等待。done 必须附 evidence（kind 与 summary 非空；kind=test 需 command+exitCode）。',
    parameters: {
      type: 'object',
      properties: {
        taskId: { type: 'string', description: '任务 id' },
        status: { type: 'string', enum: ['done', 'blocked', 'pending'], description: 'done/blocked/pending' },
        evidence: { type: 'object', description: 'done 必填：{kind: files|test|command|manual, summary, files?, command?, exitCode?, at}' },
        reason: { type: 'string', description: 'blocked/pending 的原因说明' },
      },
      required: ['taskId', 'status'],
      additionalProperties: false,
    },
    output: {
      schema: { type: 'object' },
      render: (_args, value) => [{ type: 'text', text: `任务 ${value.taskId} → ${value.status}` }],
    },
    async execute(args, exec) {
      const cwd = cwdOf(exec)
      const bp = loadBlueprint(cwd)
      if (!bp) throw taskError('NO_BLUEPRINT', '项目无蓝图')
      const task = (bp.tasks || []).find(t => t.id === args.taskId)
      if (!task) throw taskError('UNKNOWN_TASK', `任务 ${args.taskId} 不存在`)
      if (args.status === 'done') {
        const ev = args.evidence
        if (!ev || !ev.summary) throw taskError('EVIDENCE_REQUIRED', 'done 必须附 evidence.summary（非空）')
        if (ev.kind === 'test' && (!ev.command || !Number.isInteger(ev.exitCode))) throw taskError('EVIDENCE_REQUIRED', 'kind=test 的证据必须附 command 与 exitCode')
        task.status = 'done'
        task.evidence = { ...ev, at: ev.at || Date.now() }
      } else if (args.status === 'blocked') {
        task.status = 'blocked'
        task.blockReason = args.reason || null
      } else {
        task.status = 'pending'
        task.blockReason = null
        task.evidence = null
      }
      saveBlueprint(cwd, bp)
      return { taskId: args.taskId, status: args.status, endedAt: Date.now() }
    },
  }
}

/** project_init（项目一·建模器）：接收 Agent 的结构化分解，校验+补布局+落盘蓝图（confirmedAt=null 待人工确认） */
export function createInitTool(ctx) {
  return {
    name: 'project_init',
    description: '领域无关建模器：把 Agent 对项目的结构化分解（板块→任务树+依赖+验收+scope+估算）校验并落盘为 .dsh-project/blueprint.json。返回 digest 与规模；蓝图待人工确认后才可 task_claim。',
    parameters: {
      type: 'object',
      properties: {
        blueprint: { type: 'object', description: '{project:{name},sections:[{id,title}],tasks:[{id,sectionId,title,description,dependsOn,acceptance,scope,estimateMinutes,estimateTokens}],layout?}' },
      },
      required: ['blueprint'],
      additionalProperties: false,
    },
    output: { schema: { type: 'object' }, render: (_a, v) => [{ type: 'text', text: `蓝图已落盘：${v.tasks} 任务 / ${v.sections} 板块 · ${v.digest}` }] },
    async execute(args, exec) {
      const cwd = cwdOf(exec)
      if (!cwd) throw taskError('NO_CWD', '无法确定项目根目录')
      const bp = args.blueprint || {}
      bp.version = bp.version || 1
      bp.project = bp.project || {}
      bp.project.name = bp.project.name || '未命名项目'
      bp.project.domain = bp.project.domain || 'generic'
      bp.project.objective = bp.project.objective || bp.project.name
      bp.project.createdAt = Number.isSafeInteger(bp.project.createdAt) ? bp.project.createdAt : Date.now()
      bp.project.confirmedAt = null
      bp.sections = (bp.sections || []).map((s, i) => ({ order: i + 1, ...s }))
      bp.tasks = (bp.tasks || []).map(t => ({ status: 'pending', evidence: null, dependsOn: [], scope: [], acceptance: t.title, ...t }))
      if (!bp.layout) bp.layout = defaultLayout(bp)
      const v = validateBlueprint(bp)
      const errors = Array.isArray(v) ? v : (v && v.errors) || []
      if (errors.length) throw taskError('INVALID_BLUEPRINT', errors.map(e => e.message || e).join('; '))
      const warnings = qualityCheck(bp, 100000) || []
      mkdirSync(join(cwd, '.dsh-project'), { recursive: true })
      // REQ-09 结构变更审批：已确认蓝图的结构变更→提案，待人工批准，不直接覆盖
      const existing = loadBlueprint(cwd)
      if (existing && existing.project && existing.project.confirmedAt != null) {
        const pdir = join(cwd, '.dsh-project', 'proposals')
        mkdirSync(pdir, { recursive: true })
        const id = 'prop-' + Date.now()
        writeFileSync(join(pdir, id + '.json'), JSON.stringify({ id, status: 'pending', at: Date.now(), blueprint: bp }, null, 2), 'utf8')
        return { proposalId: id, pending: true, tasks: bp.tasks.length, sections: bp.sections.length, warnings }
      }
      saveBlueprint(cwd, bp)
      return { digest: bp.digest, tasks: bp.tasks.length, sections: bp.sections.length, warnings }
    },
  }
}

const SCAN_IGNORE = new Set(['node_modules', '.git', 'dist', '.dsh-project', 'coverage', 'build', '.next', '.cache'])
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'x'
const DOCS = ['00_总目录与基线', '01_需求规格', '02_概要设计', '03_业务流程', '04_数据设计', '05_数据字典', '06_接口设计', '07_详细设计', '08_可视化设计', '09_上下文粒度', '10_安全设计', '11_界面设计', '12_测试规格', '13_实施计划', '14_评审决议', '15_任务编排']

/** project_bootstrap：扫描全项目文件→自动结构化看板；docFirst 时先排设计文档引导任务 */
export function createBootstrapTool(ctx) {
  return {
    name: 'project_bootstrap',
    description: '扫描整个项目找设计文档：有文档→标记完成并做模块分解/开发任务；无文档→只排 16 份设计文档引导任务（顺序依赖），不做任何分解/开发任务，直到文档完成。落盘蓝图待人工确认。',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: '项目名（默认取目录名）' },
        docFirst: { type: 'boolean', description: '是否文档先行引导（默认 true）' },
      },
      additionalProperties: false,
    },
    output: { schema: { type: 'object' }, render: (_a, v) => [{ type: 'text', text: `已结构化 ${v.files} 文件 → ${v.sections} 板块 / ${v.tasks} 任务${v.docFirst ? '（含设计文档引导）' : ''}` }] },
    async execute(args, exec) {
      const cwd = cwdOf(exec)
      if (!cwd) throw taskError('NO_CWD', '无法确定项目根目录')
      const files = []
      const walk = (d, base) => {
        for (const e of readdirSync(d, { withFileTypes: true })) {
          if (e.name.startsWith('.') || SCAN_IGNORE.has(e.name)) continue
          const rel = base ? base + '/' + e.name : e.name
          if (e.isDirectory()) walk(join(d, e.name), rel)
          else files.push(rel)
        }
      }
      walk(cwd, '')
      // 分组：top=一级目录，sub=二级目录
      const groups = {}
      for (const f of files) {
        const seg = f.split('/')
        const top = seg.length > 1 ? seg[0] : '(root)'
        const sub = seg.length > 2 ? seg[1] : '(files)'
        const key = top + '/' + sub
        ;(groups[key] = groups[key] || { top, sub, files: [] }).files.push(f)
      }
      const designDocs = files.filter(f => /(^|\/)(docs?|design|设计)\//i.test(f) && /\.md$/i.test(f))
      const hasDocs = designDocs.length > 0
      const docSec = { id: 'sec-docbase', title: hasDocs ? '设计文档（已存在）' : '设计文档基线（先行·必须完成）', order: 1 }
      let sections, tasks
      if (hasDocs) {
        // 评估文档完整性：对照 16 文档结构，已有=done，缺失=待补齐（门控后续）
        const base = (f) => f.split('/').pop()
        const present = [], missing = []
        DOCS.forEach((d, i) => {
          const num = d.slice(0, 2), kw = d.slice(3)
          const hit = designDocs.find(f => base(f).includes(num + '_') || base(f).includes(kw) || base(f).includes(kw.slice(0, 2)))
          if (hit) present.push({ d, hit })
          else missing.push(d)
        })
        // 旧文档充分（覆盖≥10/16 或数量≥16）→ 信任旧文档直接使用，不强行补齐
        if (present.length >= 10 || designDocs.length >= 16) missing.length = 0
        const docTasks = present.map(({ d, hit }) => ({ id: 't-doc-' + slug(d), sectionId: 'sec-docbase', title: d, description: '现有设计文档', acceptance: '设计文档评审通过', dependsOn: [], scope: [hit], status: 'done', evidence: { kind: 'files', summary: '现有设计文档', files: [hit], at: Date.now() } }))
        const missTasks = missing.map((d, i) => ({ id: 't-doc-' + slug(d), sectionId: 'sec-docbase', title: d + '（补齐）', description: '旧文档缺失，需补齐', acceptance: '文档评审通过并冻结', dependsOn: i > 0 ? ['t-doc-' + slug(missing[i - 1])] : [], scope: ['docs/baseline/' + d + '.md'], status: 'pending', evidence: null }))
        const lastDocDep = missing.length ? ['t-doc-' + slug(missing[missing.length - 1])] : (present.length ? ['t-doc-' + slug(present[present.length - 1].d)] : [])
        const planSec = { id: 'sec-plan', title: '理解·分解·开发计划' }
        const planTasks = [
          { id: 't-plan-read', sectionId: 'sec-plan', title: '读设计文档·理解项目现状', description: '通读（含补齐后的）设计文档，核对已实现/未实现', acceptance: '输出现状摘要（已完成/待办/风险）', dependsOn: lastDocDep, scope: designDocs, status: 'pending', evidence: null },
          { id: 't-plan-decompose', sectionId: 'sec-plan', title: '按文档分解任务', description: '依据 SRS/SAD/ORC 分解为板块→任务树', acceptance: 'project_init 落盘结构化蓝图', dependsOn: ['t-plan-read'], scope: [], status: 'pending', evidence: null },
          { id: 't-plan-dev', sectionId: 'sec-plan', title: '定制后续开发计划', description: '排定剩余开发顺序/估算/里程碑', acceptance: '开发计划确认', dependsOn: ['t-plan-decompose'], scope: [], status: 'pending', evidence: null },
        ]
        const tops = [...new Set(Object.values(groups).map(g => g.top))]
        const modSecs = tops.map(t => ({ id: 'sec-' + slug(t), title: t === '(root)' ? '根目录' : t }))
        let modTasks = Object.entries(groups).map(([key, g]) => ({ id: 't-' + slug(key), sectionId: 'sec-' + slug(g.top), title: g.sub === '(files)' ? (g.top === '(root)' ? '根文件' : g.top) : g.sub, description: g.files.length + ' 个文件', acceptance: '该模块全部文件结构化入库并可下钻', dependsOn: ['t-plan-dev'], scope: g.files, status: 'pending', evidence: null }))
        if (modTasks.length > 180) modTasks = modTasks.slice(0, 180)
        sections = [docSec, planSec, ...modSecs]
        tasks = [...docTasks, ...missTasks, ...planTasks, ...modTasks]
      } else {
        // 无设计文档：只排引导任务，禁止任何分解/开发任务
        sections = [docSec]
        tasks = DOCS.map((d, i) => ({ id: 't-doc-' + slug(d), sectionId: 'sec-docbase', title: d, description: '设计文档 ' + d, acceptance: '文档评审通过并冻结', dependsOn: i > 0 ? ['t-doc-' + slug(DOCS[i - 1])] : [], scope: ['docs/baseline/' + d + '.md'], status: 'pending', evidence: null }))
      }
      sections.forEach((s, i) => { s.order = i + 1 })
      const bp = {
        version: 1,
        project: { name: args.name || cwd.split(/[\\/]/).pop() || '项目', domain: 'generic', objective: '全项目结构化白盒看板', createdAt: Date.now(), confirmedAt: null },
        sections, tasks,
      }
      bp.layout = defaultLayout(bp)
      const v = validateBlueprint(bp)
      const errors = Array.isArray(v) ? v : (v && v.errors) || []
      if (errors.length) throw taskError('INVALID_BLUEPRINT', errors.map(e => e.message || e).join('; '))
      mkdirSync(join(cwd, '.dsh-project'), { recursive: true })
      // 保护原项目：已确认蓝图不被覆盖→走提案待人工批准
      const existing = loadBlueprint(cwd)
      if (existing && existing.project && existing.project.confirmedAt != null) {
        const pdir = join(cwd, '.dsh-project', 'proposals')
        mkdirSync(pdir, { recursive: true })
        const id = 'prop-' + Date.now()
        writeFileSync(join(pdir, id + '.json'), JSON.stringify({ id, status: 'pending', at: Date.now(), blueprint: bp }, null, 2), 'utf8')
        return { proposalId: id, pending: true, files: files.length, sections: sections.length, tasks: tasks.length, hasDocs, designDocs: designDocs.length }
      }
      saveBlueprint(cwd, bp)
      return { digest: bp.digest, files: files.length, sections: sections.length, tasks: tasks.length, hasDocs, designDocs: designDocs.length }
    },
  }
}

/** guide_explain（项目三·导游）：只读旁路生成因果解说，质量门+预算，落盘 explanations */
export function createGuideTool(ctx) {
  return {
    name: 'guide_explain',
    description: '项目三导游：对指定任务读取代码上下文，调本地/云端模型生成因果解说（为什么/权衡/关联），经质量门后落盘 .dsh-project/explanations/<taskId>.json。只读旁路，不改代码。',
    parameters: {
      type: 'object',
      properties: {
        taskId: { type: 'string', description: '任务 id' },
        provider: { type: 'string', description: 'local|cloud（默认 local）' },
        baseURL: { type: 'string', description: '模型 OpenAI 兼容 baseURL（默认本地 8080）' },
        model: { type: 'string', description: '模型 id' },
      },
      required: ['taskId'],
      additionalProperties: false,
    },
    output: { schema: { type: 'object' }, render: (_a, v) => [{ type: 'text', text: `导游解说 ${v.taskId}：${v.passed ? '通过质量门' : '未过质量门'} · ${v.entries} 条 · ${v.tokens} tok` }] },
    async execute(args, exec) {
      const cwd = cwdOf(exec)
      if (!cwd) throw taskError('NO_CWD', '无法确定项目根目录')
      const bp = loadBlueprint(cwd)
      if (!bp) throw taskError('NO_BLUEPRINT', '项目无蓝图')
      const cfg = {}
      if (args.provider) cfg.provider = args.provider
      if (args.baseURL) cfg.baseURL = args.baseURL
      if (args.model) cfg.model = args.model
      try {
        return await generateExplanation(cwd, args.taskId, bp, cfg)
      } catch (e) {
        throw taskError('GUIDE_FAILED', String(e.message || e))
      }
    },
  }
}

/** guide_ask（项目三 V2.2 交互式）：对当前选中卡/代码/层级即问即答 */
export function createGuideAskTool(ctx) {
  return {
    name: 'guide_ask',
    description: '项目三导游交互问答：用户问什么答什么。paths=当前选中卡/代码/层级的文件列表，question=用户问题（语音/文字）。只读旁路。',
    parameters: {
      type: 'object',
      properties: {
        question: { type: 'string', description: '用户问题' },
        paths: { type: 'object', description: '当前上下文文件路径数组' },
        title: { type: 'string', description: '当前选中节点标题' },
      },
      required: ['question'],
      additionalProperties: false,
    },
    output: { schema: { type: 'object' }, render: (_a, v) => [{ type: 'text', text: v.answer || '' }] },
    async execute(args, exec) {
      const cwd = cwdOf(exec)
      if (!cwd) throw taskError('NO_CWD', '无法确定项目根目录')
      const paths = Array.isArray(args.paths) ? args.paths : []
      return await askContext(cwd, paths, args.question, args.title, {})
    },
  }
}

/** task_add：运行时向当前活跃项目加任意任务（任意项目+任意任务） */
export function createTaskAddTool(ctx) {
  return {
    name: 'task_add',
    description: '向当前活跃项目蓝图追加任意任务（可新建板块）。任务立即进入看板（投影折叠 task_add）。',
    parameters: {
      type: 'object',
      properties: {
        taskId: { type: 'string', description: '任务 id（t- 前缀）' },
        sectionId: { type: 'string', description: '板块 id（sec- 前缀；不存在则新建）' },
        sectionTitle: { type: 'string', description: '新板块标题' },
        title: { type: 'string', description: '任务标题' },
        description: { type: 'string' },
        acceptance: { type: 'string' },
        dependsOn: { type: 'object', description: '依赖任务 id 数组' },
        scope: { type: 'object', description: '文件路径数组' },
        estimateMinutes: { type: 'integer' },
      },
      required: ['taskId', 'title'],
      additionalProperties: false,
    },
    output: { schema: { type: 'object' }, render: (_a, v) => [{ type: 'text', text: `已加任务 ${v.taskId}` }] },
    async execute(args, exec) {
      const cwd = cwdOf(exec)
      if (!cwd) throw taskError('NO_CWD', '无法确定项目根目录')
      const bp = loadBlueprint(cwd)
      if (!bp) throw taskError('NO_BLUEPRINT', '项目无蓝图，先 project_bootstrap/init')
      if ((bp.tasks || []).some(t => t.id === args.taskId)) throw taskError('DUPLICATE_TASK', args.taskId)
      const sid = args.sectionId || 'sec-adhoc'
      if (!(bp.sections || []).some(s => s.id === sid)) bp.sections = [...(bp.sections || []), { id: sid, title: args.sectionTitle || sid, order: (bp.sections || []).length + 1 }]
      bp.tasks = [...(bp.tasks || []), { id: args.taskId, sectionId: sid, title: args.title, description: args.description || '', acceptance: args.acceptance || args.title, dependsOn: args.dependsOn || [], scope: args.scope || [], estimateMinutes: args.estimateMinutes || null, status: 'pending', evidence: null }]
      saveBlueprint(cwd, bp)
      return { taskId: args.taskId, sectionId: sid }
    },
  }
}

/** project_switch：把看板/工具指向当前对话真正在做的项目（解决"当前对话非本项目"） */
export function createSwitchTool(ctx) {
  return {
    name: 'project_switch',
    description: '设置活跃项目根：在会话 cwd 写 .dsh-project/active.json={root}，看板与 task_* 工具随即跟随该项目。root 省略=恢复会话 cwd。',
    parameters: {
      type: 'object',
      properties: { root: { type: 'string', description: '目标项目绝对路径；省略恢复默认' } },
      additionalProperties: false,
    },
    output: { schema: { type: 'object' }, render: (_a, v) => [{ type: 'text', text: `活跃项目：${v.root}` }] },
    async execute(args, exec) {
      const sessionCwd = exec.agent && exec.agent.session && exec.agent.session.header ? exec.agent.session.header.cwd : undefined
      if (!sessionCwd) throw taskError('NO_CWD', '无法确定会话目录')
      const dir = join(sessionCwd, '.dsh-project')
      mkdirSync(dir, { recursive: true })
      const root = args.root || sessionCwd
      writeFileSync(join(dir, 'active.json'), JSON.stringify({ root, at: Date.now() }, null, 2), 'utf8')
      return { root }
    },
  }
}
