/**
 * HTTP 路由（t-m2-routes）：只读文件预览 / 蓝图读 / 解说占位读 + 同源校验。
 * 文件限项目内 + 256KB + NUL 检测；路径逃逸 403。
 */

import { readFileSync, existsSync, statSync, writeFileSync, readdirSync, mkdirSync } from 'node:fs'
import { join, resolve, relative, isAbsolute } from 'node:path'
import { computeDigest } from '../../contracts/validator.js'
import { generateExplanation, askContext } from '../../project-3-guide/lib/guide.js?v=2'

const MAX_BYTES = 256 * 1024

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = ''
    req.on('data', (c) => { data += c; if (data.length > 1e6) reject(new Error('body-too-large')) })
    req.on('end', () => { try { resolve(JSON.parse(data || '{}')) } catch { resolve({}) } })
    req.on('error', reject)
  })
}

function sameOrigin(req) {
  const origin = req.headers.origin
  if (!origin) return true // 同源 GET 通常不带 Origin
  try {
    return new URL(origin).host === req.headers.host
  } catch {
    return false
  }
}

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj)
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
  res.end(body)
}

function query(req) {
  try {
    return new URL(req.url, 'http://localhost').searchParams
  } catch {
    return new URLSearchParams()
  }
}

/** 校验 path 在 root 内（禁 ../ 与绝对路径逃逸） */
function safeJoin(root, path) {
  if (!root || !path) return null
  if (isAbsolute(path)) return null
  const abs = resolve(root, path)
  const rel = relative(resolve(root), abs)
  if (rel.startsWith('..') || isAbsolute(rel)) return null
  return abs
}

export function registerRoutes(ctx) {
  const reg = (path, handler) => ctx.effect(() => {
    try {
      return ctx.webServer.register({ kind: 'exact', path, handler })
    } catch {
      // 路由已存在（重载/泄漏）：保留已有注册，避免重复报错
      return () => {}
    }
  })

  // 蓝图读
  reg('/project-board/api/blueprint', (req, res) => {
    if (!sameOrigin(req)) return sendJson(res, 403, { error: 'cross-origin' })
    const root = query(req).get('root')
    const p = root ? join(root, '.dsh-project', 'blueprint.json') : null
    if (!p || !existsSync(p)) return sendJson(res, 404, { error: 'no-blueprint' })
    try {
      const bp = JSON.parse(readFileSync(p, 'utf8'))
      return sendJson(res, 200, { blueprint: bp, digest: bp.digest || null, consistent: true })
    } catch {
      return sendJson(res, 500, { error: 'parse-error' })
    }
  })

  // 只读文件预览
  reg('/project-board/api/file', (req, res) => {
    if (!sameOrigin(req)) return sendJson(res, 403, { error: 'cross-origin' })
    const q = query(req)
    const abs = safeJoin(q.get('root'), q.get('path'))
    if (!abs) return sendJson(res, 403, { error: 'path-escape' })
    if (!existsSync(abs)) return sendJson(res, 404, { error: 'not-found' })
    try {
      const st = statSync(abs)
      if (st.size > MAX_BYTES) return sendJson(res, 200, { content: null, truncated: true, binary: false })
      const buf = readFileSync(abs)
      if (buf.includes(0)) return sendJson(res, 200, { content: null, truncated: false, binary: true })
      return sendJson(res, 200, { content: buf.toString('utf8'), truncated: false, binary: false })
    } catch {
      return sendJson(res, 500, { error: 'read-error' })
    }
  })

  // 只读目录列表（V1.1 点入代码架构）
  reg('/project-board/api/list', (req, res) => {
    if (!sameOrigin(req)) return sendJson(res, 403, { error: 'cross-origin' })
    const q = query(req)
    const abs = safeJoin(q.get('root'), q.get('path') || '')
    if (!abs) return sendJson(res, 403, { error: 'path-escape' })
    if (!existsSync(abs)) return sendJson(res, 404, { error: 'not-found' })
    try {
      const entries = readdirSync(abs, { withFileTypes: true })
        .filter(d => !d.name.startsWith('.') && d.name !== 'node_modules')
        .map(d => ({ name: d.name, isDir: d.isDirectory() }))
        .sort((a, b) => (a.isDir === b.isDir ? a.name.localeCompare(b.name) : a.isDir ? -1 : 1))
      return sendJson(res, 200, { entries })
    } catch {
      return sendJson(res, 500, { error: 'list-error' })
    }
  })

  // 解说占位读（二期产出 explanations/<taskId>.json）
  reg('/project-board/api/explanation', (req, res) => {
    if (!sameOrigin(req)) return sendJson(res, 403, { error: 'cross-origin' })
    const q = query(req)
    const root = q.get('root')
    const taskId = q.get('taskId')
    if (!root || !taskId) return sendJson(res, 400, { error: 'missing-params' })
    const p = join(root, '.dsh-project', 'explanations', taskId + '.json')
    if (!existsSync(p)) return sendJson(res, 404, { error: 'no-explanation' })
    try {
      return sendJson(res, 200, JSON.parse(readFileSync(p, 'utf8')))
    } catch {
      return sendJson(res, 500, { error: 'parse-error' })
    }
  })

  // 人工确认蓝图草案（仅人工触发；写 confirmedAt + 重算 digest）
  reg('/project-board/api/confirm', async (req, res) => {
    if (!sameOrigin(req)) return sendJson(res, 403, { error: 'cross-origin' })
    if (req.method !== 'POST') return sendJson(res, 405, { error: 'method-not-allowed' })
    const body = await readBody(req)
    const root = body.root
    if (!root) return sendJson(res, 400, { error: 'missing-root' })
    const p = join(root, '.dsh-project', 'blueprint.json')
    if (!existsSync(p)) return sendJson(res, 404, { error: 'no-blueprint' })
    try {
      const bp = JSON.parse(readFileSync(p, 'utf8'))
      if (body.digest && bp.digest && body.digest !== bp.digest) return sendJson(res, 409, { error: 'digest-conflict', currentDigest: bp.digest })
      bp.project = bp.project || {}
      bp.project.confirmedAt = Date.now()
      bp.digest = computeDigest(bp)
      writeFileSync(p, JSON.stringify(bp, null, 2) + '\n', 'utf8')
      return sendJson(res, 200, { confirmedAt: bp.project.confirmedAt, digest: bp.digest })
    } catch {
      return sendJson(res, 500, { error: 'confirm-error' })
    }
  })

  // 导游生成（项目三，UI 按钮触发；只读旁路）
  reg('/project-board/api/guide', async (req, res) => {
    if (!sameOrigin(req)) return sendJson(res, 403, { error: 'cross-origin' })
    if (req.method !== 'POST') return sendJson(res, 405, { error: 'method-not-allowed' })
    const body = await readBody(req)
    const { root, taskId } = body
    if (!root || !taskId) return sendJson(res, 400, { error: 'missing-params' })
    const p = join(root, '.dsh-project', 'blueprint.json')
    if (!existsSync(p)) return sendJson(res, 404, { error: 'no-blueprint' })
    try {
      const bp = JSON.parse(readFileSync(p, 'utf8'))
      const r = await generateExplanation(root, taskId, bp, body.config || {})
      return sendJson(res, 200, r)
    } catch (e) {
      return sendJson(res, 500, { error: 'guide-failed', message: String(e.message || e) })
    }
  })

  // 人工重开 done→running（REQ-09，仅人工触发）
  reg('/project-board/api/reopen', async (req, res) => {
    if (!sameOrigin(req)) return sendJson(res, 403, { error: 'cross-origin' })
    if (req.method !== 'POST') return sendJson(res, 405, { error: 'method-not-allowed' })
    const body = await readBody(req)
    const { root, taskId } = body
    if (!root || !taskId) return sendJson(res, 400, { error: 'missing-params' })
    const p = join(root, '.dsh-project', 'blueprint.json')
    if (!existsSync(p)) return sendJson(res, 404, { error: 'no-blueprint' })
    try {
      const bp = JSON.parse(readFileSync(p, 'utf8'))
      const t = (bp.tasks || []).find(x => x.id === taskId)
      if (!t) return sendJson(res, 404, { error: 'unknown-task' })
      if (t.status !== 'done') return sendJson(res, 409, { error: 'not-done' })
      t.status = 'running'; t.evidence = null
      bp.digest = computeDigest(bp)
      writeFileSync(p, JSON.stringify(bp, null, 2) + '\n', 'utf8')
      return sendJson(res, 200, { taskId, status: 'running' })
    } catch { return sendJson(res, 500, { error: 'reopen-error' }) }
  })

  // 结构变更提案（REQ-09）：读/批准/拒绝，人工闸门
  reg('/project-board/api/proposals', async (req, res) => {
    if (!sameOrigin(req)) return sendJson(res, 403, { error: 'cross-origin' })
    const q = query(req)
    const root = q.get('root')
    if (!root) return sendJson(res, 400, { error: 'missing-root' })
    const pdir = join(root, '.dsh-project', 'proposals')
    if (req.method === 'GET') {
      if (!existsSync(pdir)) return sendJson(res, 200, { proposals: [] })
      const list = readdirSync(pdir).filter(f => f.endsWith('.json')).map(f => { try { const p = JSON.parse(readFileSync(join(pdir, f), 'utf8')); return { id: p.id, status: p.status, at: p.at, tasks: (p.blueprint.tasks || []).length } } catch { return null } }).filter(Boolean)
      return sendJson(res, 200, { proposals: list })
    }
    if (req.method !== 'POST') return sendJson(res, 405, { error: 'method-not-allowed' })
    const body = await readBody(req)
    const { id, action } = body
    const pf = join(pdir, (id || '') + '.json')
    if (!id || !existsSync(pf)) return sendJson(res, 404, { error: 'no-proposal' })
    try {
      const p = JSON.parse(readFileSync(pf, 'utf8'))
      if (action === 'approve') {
        const bp = p.blueprint
        bp.project.confirmedAt = Date.now()
        bp.digest = computeDigest(bp)
        writeFileSync(join(root, '.dsh-project', 'blueprint.json'), JSON.stringify(bp, null, 2) + '\n', 'utf8')
        p.status = 'approved'
      } else if (action === 'reject') p.status = 'rejected'
      else return sendJson(res, 400, { error: 'bad-action' })
      writeFileSync(pf, JSON.stringify(p, null, 2), 'utf8')
      return sendJson(res, 200, { id, status: p.status })
    } catch { return sendJson(res, 500, { error: 'proposal-error' }) }
  })

  // 面板内蓝图编辑（改任务标题）
  reg('/project-board/api/task-edit', async (req, res) => {
    if (!sameOrigin(req)) return sendJson(res, 403, { error: 'cross-origin' })
    if (req.method !== 'POST') return sendJson(res, 405, { error: 'method-not-allowed' })
    const body = await readBody(req)
    const { root, taskId, title } = body
    if (!root || !taskId || !title) return sendJson(res, 400, { error: 'missing-params' })
    const p = join(root, '.dsh-project', 'blueprint.json')
    if (!existsSync(p)) return sendJson(res, 404, { error: 'no-blueprint' })
    try {
      const bp = JSON.parse(readFileSync(p, 'utf8'))
      const t = (bp.tasks || []).find(x => x.id === taskId)
      if (!t) return sendJson(res, 404, { error: 'unknown-task' })
      t.title = title
      bp.digest = computeDigest(bp)
      writeFileSync(p, JSON.stringify(bp, null, 2) + '\n', 'utf8')
      return sendJson(res, 200, { taskId, title })
    } catch { return sendJson(res, 500, { error: 'edit-error' }) }
  })

  // 焦点上下文注入（V2.3）：记录当前选中卡/文档/层级，供主输入框提问时 Agent 读取
  reg('/project-board/api/focus', async (req, res) => {
    if (!sameOrigin(req)) return sendJson(res, 403, { error: 'cross-origin' })
    const q = query(req)
    if (req.method === 'GET') {
      const root = q.get('root')
      const p = join(root || '', '.dsh-project', 'focus.json')
      if (!root || !existsSync(p)) return sendJson(res, 404, { error: 'no-focus' })
      try { return sendJson(res, 200, JSON.parse(readFileSync(p, 'utf8'))) } catch { return sendJson(res, 500, { error: 'parse' }) }
    }
    if (req.method !== 'POST') return sendJson(res, 405, { error: 'method-not-allowed' })
    const body = await readBody(req)
    if (!body.root) return sendJson(res, 400, { error: 'missing-root' })
    const dir = join(body.root, '.dsh-project')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'focus.json'), JSON.stringify({ node: body.node || null, at: Date.now() }, null, 2), 'utf8')
    return sendJson(res, 200, { ok: true })
  })

  // 导游交互式问答（项目三 V2.2：问什么答什么，上下文=当前选中卡/代码/层级）
  reg('/project-board/api/ask', async (req, res) => {
    if (!sameOrigin(req)) return sendJson(res, 403, { error: 'cross-origin' })
    if (req.method !== 'POST') return sendJson(res, 405, { error: 'method-not-allowed' })
    const body = await readBody(req)
    const { root, question, paths, title } = body
    if (!root || !question) return sendJson(res, 400, { error: 'missing-params' })
    try {
      const r = await askContext(root, paths || [], question, title, body.config || {})
      return sendJson(res, 200, r)
    } catch (e) {
      return sendJson(res, 500, { error: 'ask-failed', message: String(e.message || e) })
    }
  })
}
