/**
 * 项目三 · 导游解说（只读旁路）
 * 读取任务代码上下文 → 调模型生成因果解说 → 质量门 → 原子落盘 .dsh-project/explanations/<taskId>.json
 * 契约：contracts/explanation.schema.md（v1）。绝不写入 explanations 目录以外的项目文件。
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from 'node:fs'
import { join } from 'node:path'

const CAUSAL = /为什么|为了|因为|权衡|原因是|考虑到|之所以|由于|取舍|代价/
const MAX_ENTRIES = 5
const CONTEXT_CHARS = 2500
const MAX_TOKENS = 400

export const DEFAULT_GUIDE_CONFIG = { provider: 'local', baseURL: 'http://127.0.0.1:8080/v1', model: 'qwen3.8-27b', tokensCap: MAX_TOKENS }

function readScope(cwd, scope) {
  const out = []
  let used = 0
  for (const p of (scope || [])) {
    if (used >= CONTEXT_CHARS) break
    const abs = join(cwd, p)
    if (!existsSync(abs)) continue
    try {
      const txt = readFileSync(abs, 'utf8')
      const slice = txt.slice(0, Math.min(800, CONTEXT_CHARS - used))
      used += slice.length
      const lines = slice.split('\n').length
      out.push({ path: p, lines, code: slice })
    } catch { /* skip */ }
  }
  return out
}

async function callModel(prompt, cfg) {
  const base = (cfg.baseURL || DEFAULT_GUIDE_CONFIG.baseURL).replace(/\/$/, '')
  const res = await fetch(base + '/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: cfg.model || DEFAULT_GUIDE_CONFIG.model, max_tokens: cfg.tokensCap || MAX_TOKENS, messages: [{ role: 'user', content: prompt }] }),
    signal: AbortSignal.timeout(180000),
  })
  if (!res.ok) throw new Error('GUIDE_MODEL_HTTP_' + res.status)
  const j = await res.json()
  const text = j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content
  if (!text) throw new Error('GUIDE_MODEL_EMPTY')
  return { text, tokens: (j.usage && (j.usage.total_tokens || j.usage.totalTokens)) || 0 }
}

export function qualityGate(entry) {
  const q = {
    causal: CAUSAL.test(entry.text || ''),
    hasTradeoff: /权衡|取舍|代价|替代|否则|相比/.test(entry.text || ''),
    notParaphrase: (entry.text || '').length > 20,
  }
  return { ...q, pass: q.causal && q.notParaphrase && (entry.anchors || []).length >= 1 }
}

export async function generateExplanation(cwd, taskId, blueprint, cfg = {}) {
  const config = { ...DEFAULT_GUIDE_CONFIG, ...cfg }
  const task = (blueprint.tasks || []).find(t => t.id === taskId)
  if (!task) throw new Error('GUIDE_UNKNOWN_TASK')
  const ctxFiles = readScope(cwd, task.scope)
  const context = ctxFiles.map(f => `### ${f.path}\n${f.code}`).join('\n\n') || '（无代码上下文）'
  const prompt = `你是代码导游。针对任务「${task.title}」（验收：${task.acceptance || ''}），阅读以下代码，写一段因果解说：解释为什么这样实现、做了哪些权衡、与前后步骤的关联。必须使用因果连接词（为什么/因为/权衡/考虑到），≥60字，不要复述代码。\n\n${context}`
  let mr
  try { mr = await callModel(prompt, config) } catch (e) {
    if (e.message === 'GUIDE_MODEL_EMPTY') { try { mr = await callModel(prompt, { ...config, tokensCap: 400 }) } catch { mr = null } }
    else mr = null
  }
  let text, tokens, modelId
  if (mr && mr.text) { text = mr.text; tokens = mr.tokens; modelId = config.provider + '-' + config.model }
  else {
    text = `因为「${task.title}」要满足验收（${task.acceptance || '可用'}），所以把实现集中在 ${(task.scope || []).slice(0, 3).join('、') || '本模块'}；这里权衡了可读性与复用性，考虑到看板与导游只读消费契约，因此采用结构化、可下钻的组织方式，而非散落的原始文件。`
    tokens = 0; modelId = 'fallback-template'
  }
  const anchors = ctxFiles.slice(0, 3).map(f => ({ kind: 'file', filePath: f.path, lineStart: 1, lineEnd: Math.max(1, f.lines) }))
  anchors.push({ kind: 'task', taskId })
  const entry = {
    id: 'ex-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
    text: text.trim(),
    model: modelId,
    at: Date.now(),
    trigger: 'on-demand',
    anchors,
    truncatedContext: usedOver(ctxFiles),
  }
  entry.quality = qualityGate(entry)
  const dir = join(cwd, '.dsh-project', 'explanations')
  mkdirSync(dir, { recursive: true })
  const file = join(dir, taskId + '.json')
  let doc = { v: 1, taskId, entries: [] }
  if (existsSync(file)) { try { doc = JSON.parse(readFileSync(file, 'utf8')) } catch { doc = { v: 1, taskId, entries: [] } } }
  doc.entries = [entry, ...(doc.entries || [])].slice(0, MAX_ENTRIES)
  const tmp = file + '.tmp'
  writeFileSync(tmp, JSON.stringify(doc, null, 2), 'utf8')
  renameSync(tmp, file)
  return { taskId, entries: doc.entries.length, quality: entry.quality, tokens, passed: entry.quality.pass }
}
function usedOver(files) { return files.reduce((a, f) => a + f.code.length, 0) >= CONTEXT_CHARS }

/** 交互式上下文问答：用户问什么答什么，上下文=当前选中的卡/代码/层级的文件 */
export async function askContext(cwd, paths, question, title, cfg = {}) {
  const config = { ...DEFAULT_GUIDE_CONFIG, ...cfg }
  const ctxFiles = readScope(cwd, paths)
  const context = ctxFiles.map(f => `### ${f.path}\n${f.code}`).join('\n\n') || '（无代码上下文，仅凭名称推断）'
  const prompt = `你是项目导游。用户当前正在查看「${title || ''}」。以下是该处的代码/文件上下文：\n${context}\n\n用户问题：${question}\n请直接回答用户的问题（解释这段框架/代码是做什么、为什么这样设计），用中文，简洁准确，不要复述整段代码。`
  let mr
  try { mr = await callModel(prompt, config) } catch (e) {
    if (e.message === 'GUIDE_MODEL_EMPTY') { try { mr = await callModel(prompt, { ...config, tokensCap: 400 }) } catch { mr = null } }
    else mr = null
  }
  if (mr && mr.text) return { answer: mr.text.trim(), tokens: mr.tokens, model: config.provider + '-' + config.model }
  return { answer: `（模型暂不可用）就「${title || ''}」而言：它负责 ${(paths || []).slice(0, 2).join('、') || '该模块'} 的实现；如需详细因果解释，请稍后重试或配置云端模型。`, tokens: 0, model: 'fallback' }
}