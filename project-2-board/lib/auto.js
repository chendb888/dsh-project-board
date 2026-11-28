/** 零模型自动模式：确定性扫描仓库生成蓝图 + 按文件/测试/TODO 自动判定进度，减少对大模型依赖。 */
import { readFileSync, existsSync, readdirSync, statSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, basename, extname } from 'node:path'
import { Worker } from 'node:worker_threads'
import { TEMPLATES, detectTemplate, pdfTasks } from './spd.js'

/** 全量同步 off-main-thread（worker），返回 {statuses,changed}，防阻塞 */
export function fullSyncAsync(cwd) {
  return new Promise(res => {
    try {
      const w = new Worker(new URL('./sync-worker.js', import.meta.url), { workerData: { cwd } })
      w.on('message', m => { res(m || { statuses: null, changed: 0 }); try { w.terminate() } catch {} })
      w.on('error', () => { res({ statuses: null, changed: 0 }); try { w.terminate() } catch {} })
    } catch { res({ statuses: null, changed: 0 }) }
  })
}

const SKIP = new Set(['node_modules', '.git', 'dist', 'build', '.dsh-project', 'coverage', '.next', 'out', 'dist-publish'])
const isDir = p => { try { return statSync(p).isDirectory() } catch { return false } }
const walk = (root, rel, depth, out, pred) => {
  if (depth > 4) return
  let es = []
  try { es = readdirSync(join(root, rel)) } catch { return }
  for (const e of es) {
    if (SKIP.has(e)) continue
    const r = rel ? rel + '/' + e : e
    const p = join(root, r)
    if (isDir(p)) walk(root, r, depth + 1, out, pred)
    else if (pred(r, e)) out.push(r)
  }
}
const loc = p => { try { return readFileSync(p, 'utf8').split('\n').length } catch { return 0 } }

/** 确定性生成蓝图（无模型）：文档/测试/模块/TODO 四类任务 */
export function autoBlueprint(root, opts = {}) {
  const template = opts.template || detectTemplate(root)
  const cfg = TEMPLATES[template] || TEMPLATES.default
  const sections = [
    { id: 'sec-auto-doc', title: '文档', order: 1 },
    { id: 'sec-auto-test', title: '测试', order: 2 },
    { id: 'sec-auto-mod', title: '模块', order: 3 },
    { id: 'sec-auto-todo', title: '待办(TODO)', order: 4 },
    { id: 'sec-auto-pdf', title: 'PDF', order: 5 },
  ]
  const tasks = []
  let n = 0
  const add = (sectionId, title, scope, status, est) => { n++; tasks.push({ id: 'auto-' + n, sectionId, title, description: scope.join(', '), dependsOn: [], acceptance: '', scope, estimateMinutes: est, status }) }

  if (cfg.doc) {
    const docs = []; walk(root, '', 0, docs, (r, e) => /\.md$/i.test(e) && !/node_modules/.test(r))
    docs.slice(0, 40).forEach(r => add('sec-auto-doc', '文档 ' + basename(r), [r], existsSync(join(root, r)) ? 'done' : 'pending', Math.max(1, Math.ceil(loc(join(root, r)) / 200))))
  }
  if (cfg.test) {
    const tests = []; walk(root, '', 0, tests, (r, e) => /\.(test|spec)\.[a-z]+$/i.test(e))
    tests.slice(0, 40).forEach(r => add('sec-auto-test', '测试 ' + basename(r), [r], existsSync(join(root, r)) ? 'done' : 'pending', 5))
  }

  const mods = []
  for (const mr of cfg.modRoots) { if (isDir(join(root, mr))) { try { readdirSync(join(root, mr)).forEach(e => { if (isDir(join(root, mr, e)) && !SKIP.has(e)) mods.push(mr + '/' + e) }) } catch {} } }
  if (!mods.length && cfg.modRoots.length && isDir(root)) { try { readdirSync(root).forEach(e => { if (isDir(join(root, e)) && !SKIP.has(e) && !e.startsWith('.')) mods.push(e) }) } catch {} }
  mods.slice(0, 24).forEach(r => add('sec-auto-mod', '模块 ' + basename(r), [r], 'pending', 15))

  if (cfg.todo) {
    const todos = []
    const srcs = []; walk(root, '', 0, srcs, (r, e) => /\.(js|ts|jsx|tsx|mjs|py|go|rs|java|c|cpp|cs|vue|svelte)$/.test(e))
    for (const r of srcs.slice(0, 60)) {
      try {
        const lines = readFileSync(join(root, r), 'utf8').split('\n')
        lines.forEach((ln, i) => { const m = ln.match(/(?:TODO|FIXME)[:\s]+(.{4,60})/); if (m && todos.length < 30) todos.push({ r, line: i + 1, text: m[1].trim() }) })
      } catch {}
    }
    todos.forEach(t => add('sec-auto-todo', '待办 ' + t.text, [t.r + ':' + t.line], 'pending', 10))
  }

  pdfTasks(root).slice(0, 40).forEach(pt => add('sec-auto-pdf', pt.title, pt.scope, 'pending', pt.est))

  return { project: { name: basename(root) }, sections, tasks, template, generatedBy: 'auto-no-model' }
}

/** 确定性同步进度：文档/测试=存在即done；TODO=注释消失即done；模块=有文件且近期改动=running */
export function autoSync(root, bp) {
  const now = Date.now()
  const testFiles = []; walk(root, '', 0, testFiles, (r, e) => /\.(test|spec)\.[a-z]+$/i.test(e))
  let changed = 0
  for (const t of bp.tasks || []) {
    const sec = t.sectionId || ''
    const isAuto = sec.startsWith('sec-auto')
    if (t.status === 'running' && !isAuto) continue // 不覆盖真实运行中任务
    const scope = t.scope || []
    let status = t.status
    const isDocLike = /doc|test|pdf/.test(sec) || /^(文档|测试|PDF)/.test(t.title || '')
    const isTodo = /todo/.test(sec) || /^待办/.test(t.title || '')
    if (isDocLike) {
      status = scope.length && scope.every(s => existsSync(join(root, String(s).split(':')[0]))) ? 'done' : 'pending'
    } else if (isTodo) {
      const [file] = String(scope[0] || '').split(':')
      let still = false
      try { still = readFileSync(join(root, file), 'utf8').includes((t.title || '').replace(/^待办 /, '')) } catch { still = false }
      status = still ? 'pending' : 'done'
    } else if (scope.length) {
      const first = String(scope[0]).split(':')[0]
      const p = join(root, first)
      if (isDir(p)) {
        let recent = false, count = 0, innerTest = false
        try { readdirSync(p).forEach(e => { count++; if (/\.(test|spec)\.[a-z]+$/i.test(e)) innerTest = true; try { if (now - statSync(join(p, e)).mtimeMs < 30 * 60000) recent = true } catch {} }) } catch {}
        const covered = innerTest || testFiles.some(tf => tf.includes(basename(first)))
        const built = ['dist', 'build', 'out'].some(x => isDir(join(p, x)))
        status = count === 0 ? 'pending' : (covered || built) ? 'done' : recent ? 'running' : (t.status === 'done' ? 'done' : 'pending')
      } else {
        status = scope.every(s => existsSync(join(root, String(s).split(':')[0]))) ? 'done' : (t.status === 'done' ? 'done' : 'pending')
      }
    }
    if (status !== t.status) { t.status = status; changed++ }
  }
  return changed
}

export function registerAutoRoutes(ctx, loadBp, saveBp) {
  const send = (res, c, o) => { res.statusCode = c; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(o)) }
  const reg = (p, h) => { try { ctx.webServer.register({ kind: 'exact', path: p, handler: h }) } catch {} }
  const body = req => new Promise(r => { let s = ''; req.on('data', c => s += c); req.on('end', () => { try { r(JSON.parse(s || '{}')) } catch { r({}) } }) })

  reg('/project-board/api/auto-init', async (req, res) => {
    const { root, force, template } = await body(req)
    if (!root || !isDir(root)) return send(res, 400, { error: 'bad-root' })
    const bpPath = join(root, '.dsh-project', 'blueprint.json')
    if (existsSync(bpPath) && !force) return send(res, 200, { ok: true, existed: true })
    const bp = autoBlueprint(root, { template })
    mkdirSync(join(root, '.dsh-project'), { recursive: true })
    writeFileSync(bpPath, JSON.stringify(bp, null, 2) + '\n', 'utf8')
    send(res, 200, { ok: true, tasks: bp.tasks.length })
  })

  reg('/project-board/api/sync-config', async (req, res) => {
    const u = new URL(req.url, 'http://x')
    const root = u.searchParams.get('root')
    if (req.method === 'POST') {
      const { root: r2, enabled } = await body(req)
      const rr = r2 || root
      if (!rr) return send(res, 400, { error: 'bad-root' })
      mkdirSync(join(rr, '.dsh-project'), { recursive: true })
      writeFileSync(join(rr, '.dsh-project', 'sync-config.json'), JSON.stringify({ enabled: enabled !== false }) + '\n', 'utf8')
      return send(res, 200, { ok: true, enabled: enabled !== false })
    }
    if (!root) return send(res, 400, { error: 'bad-root' })
    let enabled = true
    try { enabled = JSON.parse(readFileSync(join(root, '.dsh-project', 'sync-config.json'), 'utf8')).enabled !== false } catch {}
    send(res, 200, { enabled })
  })

  reg('/project-board/api/auto-sync', async (req, res) => {
    const { root } = await body(req)
    if (!root) return send(res, 400, { error: 'bad-root' })
    const bpPath = join(root, '.dsh-project', 'blueprint.json')
    if (!existsSync(bpPath)) return send(res, 404, { error: 'no-blueprint' })
    const r = await fullSyncAsync(root)
    send(res, 200, { ok: true, changed: r.changed, statuses: r.statuses })
  })
}