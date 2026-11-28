/** Client 半：Windows 资源管理器式看板。
 *  左=编号任务树(含💬对话方块) 中=代码/文件资源管理器 右=导游+总览；对话上方常驻进度条。
 *  仅 require('react')；--dsw-alias-* 令牌。 */
window.__ModuleLoader__.load({
  id: '@local/dsh-project-board',
  factory(require) {
    const React = require('react')
    const { useState, useEffect, useLayoutEffect, useRef } = React
    const h = React.createElement
    let goChat = () => {}

    const C = { done: 'var(--dsw-alias-state-success-primary)', running: 'var(--dsw-alias-brand-primary)', blocked: 'var(--dsw-alias-state-error-primary)', pending: 'var(--dsw-alias-state-idle-primary)', warn: 'var(--dsw-alias-state-warn-primary)' }
    const STATUS = { pending: { label: '等待', color: C.pending }, running: { label: '进行中', color: C.running }, done: { label: '完成', color: C.done }, blocked: { label: '阻塞', color: C.blocked } }
    const si = (t) => (t && t.spinLevel && t.spinLevel !== 'normal') ? { label: '打转', color: C.warn } : (STATUS[(t || {}).status] || STATUS.pending)
    const fmtMs = (ms) => { if (ms == null) return '—'; const m = Math.round(ms / 60000); if (m < 1) return '<1m'; if (m < 60) return m + 'm'; return Math.floor(m / 60) + 'h' + (m % 60 ? (m % 60) + 'm' : '') }

    const T = {
      page: { display: 'grid', gridTemplateColumns: '280px minmax(0,1fr) 280px', gap: '10px', height: '100%', padding: '10px', boxSizing: 'border-box', background: 'var(--dsw-alias-bg-base)' },
      col: { display: 'flex', flexDirection: 'column', gap: '8px', minHeight: 0, overflowY: 'auto' },
      card: { border: '1px solid var(--dsw-alias-border-l1)', borderRadius: '8px', background: 'var(--dsw-alias-bg-layer-1)', padding: '8px' },
      h: { fontSize: '13px', fontWeight: 600, color: 'var(--dsw-alias-label-primary)', margin: '0 0 6px' },
      sub: { fontSize: '11px', color: 'var(--dsw-alias-label-secondary)' },
      bar: { display: 'flex', height: '7px', borderRadius: '4px', overflow: 'hidden', background: 'var(--dsw-alias-bg-layer-2)' },
      track: { height: '5px', borderRadius: '3px', background: 'var(--dsw-alias-bg-layer-2)', overflow: 'hidden' },
      chatTile: { display: 'flex', alignItems: 'center', gap: '8px', padding: '8px', borderRadius: '8px', cursor: 'pointer', border: '1px solid var(--dsw-alias-border-l1)', background: 'var(--dsw-alias-bg-layer-1)', fontSize: '13px', fontWeight: 600, color: 'var(--dsw-alias-label-primary)', marginBottom: '8px' },
      secHead: { display: 'flex', alignItems: 'center', gap: '6px', padding: '4px 2px', cursor: 'pointer' },
      secTitle: { fontSize: '12px', fontWeight: 600, color: 'var(--dsw-alias-label-primary)', flex: 1 },
      pct: { fontSize: '11px', color: 'var(--dsw-alias-label-secondary)', fontVariantNumeric: 'tabular-nums' },
      task: { display: 'flex', alignItems: 'center', gap: '6px', padding: '4px 6px', borderRadius: '6px', cursor: 'pointer', fontSize: '12px', color: 'var(--dsw-alias-label-primary)' },
      num: { width: '18px', height: '18px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '10px', flexShrink: 0, border: '1px solid var(--dsw-alias-border-l2)', color: 'var(--dsw-alias-label-secondary)', fontVariantNumeric: 'tabular-nums' },
      dot: { width: '7px', height: '7px', borderRadius: '50%', flexShrink: 0 },
      tTitle: { flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
      eta: { fontSize: '10px', color: 'var(--dsw-alias-label-secondary)', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' },
      code: { fontFamily: 'ui-monospace,monospace', fontSize: '11px', whiteSpace: 'pre-wrap', background: 'var(--dsw-alias-bg-base)', border: '1px solid var(--dsw-alias-border-l1)', borderRadius: '8px', padding: '8px', overflow: 'auto', color: 'var(--dsw-alias-label-primary)', flex: 1, minHeight: 0 },
      fileRow: { display: 'flex', gap: '6px', padding: '3px 6px', fontSize: '12px', color: 'var(--dsw-alias-label-primary)', cursor: 'pointer', borderRadius: '5px' },
      crumb: { fontSize: '11px', color: 'var(--dsw-alias-brand-primary)', cursor: 'pointer' },
      note: { fontSize: '11px', color: 'var(--dsw-alias-label-secondary)', border: '1px dashed var(--dsw-alias-border-l1)', borderRadius: '8px', padding: '8px' },
      dock: { display: 'flex', alignItems: 'center', gap: '8px', padding: '4px 10px', borderTop: '1px solid var(--dsw-alias-border-l1)', background: 'var(--dsw-alias-bg-layer-1)', fontSize: '12px', color: 'var(--dsw-alias-label-secondary)' },
      empty: { padding: '40px', textAlign: 'center', color: 'var(--dsw-alias-label-secondary)' },
      // V1.4 Windows Widgets 卡片网格
      wrap: { height: '100%', overflowY: 'auto', padding: '14px', boxSizing: 'border-box', background: 'var(--dsw-alias-bg-base)' },
      head: { display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '14px' },
      greet: { fontSize: '16px', fontWeight: 700, color: 'var(--dsw-alias-label-primary)' },
      grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))', gap: '12px' },
      tile: { position: 'relative', border: '1px solid var(--dsw-alias-border-l1)', borderRadius: '12px', background: 'var(--dsw-alias-bg-layer-1)', padding: '12px', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: '6px', minHeight: '150px' },
      tileNum: { position: 'absolute', top: '10px', right: '10px', minWidth: '22px', height: '22px', padding: '0 5px', borderRadius: '11px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '10px', fontWeight: 700, border: '1px solid var(--dsw-alias-border-l2)', color: 'var(--dsw-alias-label-secondary)', fontVariantNumeric: 'tabular-nums', background: 'var(--dsw-alias-bg-layer-2)', boxSizing: 'border-box' },
      tileTitle: { fontSize: '13px', fontWeight: 600, color: 'var(--dsw-alias-label-primary)', paddingRight: '28px', overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' },
      tileMeta: { display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', color: 'var(--dsw-alias-label-secondary)' },
      back: { display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '4px 10px', borderRadius: '8px', border: '1px solid var(--dsw-alias-border-l2)', background: 'var(--dsw-alias-bg-layer-1)', color: 'var(--dsw-alias-label-primary)', cursor: 'pointer', fontSize: '12px', marginBottom: '10px' },
    }
    const api = (view, p, params) => fetch(`/project-board/api/${p}?` + new URLSearchParams({ root: view.cwd || '', ...params })).then(r => r.json())
    const regionOf = (view, sectionId) => (view.blueprint.layout.regions || []).find(r => (r.sectionIds || []).includes(sectionId))
    // 运行中任务的内部完成度（0..0.9），用于把进行中进度同步到顶部总条
    const runInfo = (view) => {
      const id = Object.keys(view.tasks).find(k => view.tasks[k].status === 'running')
      if (!id) return null
      const t = view.tasks[id]
      const rem = (view.taskEta || {})[id] && view.taskEta[id].ms
      const elapsed = t.startedAt ? Date.now() - t.startedAt : 0
      let frac
      if (rem != null && rem > 0) frac = Math.min(0.9, elapsed / (elapsed + rem))
      else frac = ((view.taskProgress || {})[id] || { files: 0 }).files > 0 ? 0.5 : 0.1
      return { id, frac }
    }
    const blendedPct = (view) => {
      const c = view.counts || { total: 0, done: 0 }
      const ri = runInfo(view)
      return Math.round(((c.done + (ri ? ri.frac : 0)) / (c.total || 1)) * 100)
    }
    // 每 3s 触发重渲染，让运行中进度/ETA「时刻同步」
    const useTick = (ms) => { const [, set] = useState(0); useEffect(() => { const id = setInterval(() => set(x => x + 1), ms); return () => clearInterval(id) }, [ms]) }

    function OverallBar({ view }) {
      const c = view.counts || { total: 0, done: 0 }
      const total = c.total || 1
      const ri = runInfo(view)
      const pct = blendedPct(view)
      return h('div', null,
        h('div', { style: { display: 'flex', justifyContent: 'space-between', marginBottom: '4px' } }, h('span', { style: T.sub }, `总进度 ${c.done}/${total}`), h('span', { style: T.pct }, pct + '% · 还需 ' + fmtMs(view.eta && view.eta.ms))),
        h('div', { style: T.bar }, (view.blueprint.tasks || []).map(t => {
          const st = (view.tasks[t.id] || {}).status
          const w = (100 / total) + '%'
          if (st === 'running' && ri && ri.id === t.id) {
            return h('div', { key: t.id, style: { width: w, display: 'flex', background: C.pending } }, h('div', { style: { width: (ri.frac * 100) + '%', background: C.running } }))
          }
          return h('div', { key: t.id, style: { width: w, background: si(view.tasks[t.id]).color } })
        })),
      )
    }

    function LeftTree({ view, sel, onSel }) {
      const bp = view.blueprint
      const numOf = {}
      ;(bp.tasks || []).forEach((t, idx) => { numOf[t.id] = idx + 1 })
      return h('div', { style: T.col },
        h('div', { style: T.chatTile, onClick: goChat }, h('span', { style: T.num }, '0'), '💬 对话', h('span', { style: { marginLeft: 'auto', fontSize: '11px', color: 'var(--dsw-alias-label-secondary)' } }, '需输入时打开 →')),
        h('div', { style: { ...T.chatTile, background: sel == null ? 'var(--dsw-alias-bg-layer-2)' : 'var(--dsw-alias-bg-layer-1)' }, onClick: () => onSel(null) }, h('span', { style: T.num }, '📂'), '项目代码', h('span', { style: { marginLeft: 'auto', fontSize: '11px', color: 'var(--dsw-alias-label-secondary)' } }, '浏览全部 →')),
        h('div', { style: T.card }, h('h3', { style: T.h }, bp.project ? bp.project.name : '项目'), h(OverallBar, { view })),
        (bp.sections || []).map(s => {
          const st = (bp.tasks || []).filter(t => t.sectionId === s.id)
          const done = st.filter(t => (view.tasks[t.id] || {}).status === 'done').length
          const pct = st.length ? Math.round(done / st.length * 100) : 0
          return h('div', { key: s.id, style: T.card },
            h('div', { style: T.secHead }, h('span', { style: { fontSize: '11px', color: 'var(--dsw-alias-label-secondary)' } }, '📁'), h('span', { style: T.secTitle }, s.title), h('span', { style: T.pct }, `${done}/${st.length}·${pct}%`)),
            h('div', { style: { ...T.track, marginBottom: '6px' } }, h('div', { style: { height: '100%', width: pct + '%', background: C.done } })),
            st.map(t => {
              const rt = view.tasks[t.id] || {}
              const te = (view.taskEta || {})[t.id]
              return h('div', { key: t.id, style: { ...T.task, background: sel === t.id ? 'var(--dsw-alias-bg-layer-2)' : 'transparent' }, onClick: () => onSel(t.id) },
                h('span', { style: T.num, title: '任务编号（语音可说「看 N 号」）' }, numOf[t.id]),
                h('span', { style: { ...T.dot, background: si(rt).color } }),
                h('span', { style: T.tTitle, title: t.title }, t.title),
                h('span', { style: T.eta }, rt.status === 'done' ? '0' : fmtMs(te && te.ms)),
              )
            }),
          )
        }),
      )
    }

    function MiddleDetail({ view, sel }) {
      useTick(3000)
      const bp = view.blueprint
      const task = (bp.tasks || []).find(t => t.id === sel)
      const numOf = {}
      ;(bp.tasks || []).forEach((t, idx) => { numOf[t.id] = idx + 1 })
      const [path, setPath] = useState('')
      const [entries, setEntries] = useState([])
      const [file, setFile] = useState(null)
      const [code, setCode] = useState(null)
      const region = task ? regionOf(view, task.sectionId) : null
      const taskRoot = (region && (region.codeRoots || [])[0]) || (task && (task.scope || [])[0]) || ''
      const root = task ? taskRoot : (view.cwd || '')
      useEffect(() => { setPath(root); setFile(null); setCode(null) }, [sel])
      useEffect(() => { api(view, 'list', { path }).then(d => setEntries(d.entries || [])).catch(() => setEntries([])) }, [path, sel])
      const rt = task ? (view.tasks[task.id] || {}) : null
      const openFile = (name) => { const fp = path ? path + '/' + name : name; setFile(fp); setCode(null); api(view, 'file', { path: fp }).then(setCode).catch(() => setCode({ error: 'read' })) }
      const arts = task ? (view.artifacts[task.id] || []) : []
      return h('div', { style: T.col },
        task ? h('div', { style: T.card },
          h('h3', { style: T.h }, `${numOf[task.id]}号 · ${task.title}`),
          h('div', { style: T.sub }, '验收：' + (task.acceptance || '—')),
          h('div', { style: { ...T.sub, marginTop: '2px' } }, '状态：' + si(rt).label + (rt.evidence ? ' · 证据：' + (rt.evidence.summary || '') : '')),
        ) : h('div', { style: T.card },
          h('h3', { style: T.h }, '📂 项目代码'),
          h('div', { style: T.sub }, '浏览整个项目的目录结构，点击文件查看代码。'),
        ),
        h('div', { style: { ...T.card, flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 } },
          h('div', { style: { display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '6px', flexWrap: 'wrap' } },
            h('span', { style: T.crumb, onClick: () => { setPath(root); setFile(null) } }, '📂 根目录'),
            path ? h('span', { style: T.sub }, '/' + path) : null,
            file ? h('span', { style: T.crumb, onClick: () => setFile(null) }, '← ' + file) : null,
          ),
          !file
            ? h('div', { style: { overflowY: 'auto', flex: 1 } }, entries.map(e => h('div', { key: e.name, style: T.fileRow, onClick: () => e.isDir ? setPath(path ? path + '/' + e.name : e.name) : openFile(e.name) }, (e.isDir ? '📁 ' : '📄 ') + e.name)))
            : code == null ? h('div', { style: T.sub }, '加载中…')
              : code.binary ? h('div', { style: T.note }, '二进制，请在编辑器打开')
                : code.truncated ? h('div', { style: T.note }, '过大（>256KB），请在编辑器打开')
                  : h('pre', { style: T.code }, code.content || code.error || ''),
        ),
        arts.length ? h('div', { style: T.card }, h('h3', { style: T.h }, '本任务产物'), arts.map(a => h('div', { key: a.path, style: T.fileRow, onClick: () => openFile(a.path) }, '📄 ' + a.path))) : null,
      )
    }

    function RightGuide({ view }) {
      const c = view.counts || {}
      const cur = view.currentAction
      return h('div', { style: T.col },
        h('div', { style: T.card }, h('h3', { style: T.h }, '总览'),
          h('div', { style: T.sub }, `完成 ${c.done || 0} · 进行 ${c.running || 0} · 阻塞 ${c.blocked || 0} · 等待 ${c.pending || 0}`),
          h('div', { style: { ...T.sub, marginTop: '4px' } }, '当前：' + (cur ? cur.tool + (cur.target ? ' ' + cur.target : '') : '待命')),
          view.nextIntent ? h('div', { style: { ...T.sub, marginTop: '4px' } }, '意图：' + view.nextIntent.text) : null,
        ),
        h('div', { style: { ...T.card, flex: 1 } }, h('h3', { style: T.h }, '🧭 导游解说'),
          h('div', { style: T.note }, '二期接入：基于中间代码上下文，逐任务/文件生成因果解说。本地/云端模型可配。'),
        ),
      )
    }

    const roleOf = (p) => /^docs\//.test(p) ? '设计文档' : /contracts\//.test(p) ? '契约' : /\.test\./.test(p) ? '测试' : /validator/.test(p) ? '校验器' : /projection/.test(p) ? '投影' : /tools/.test(p) ? '工具' : /routes/.test(p) ? '路由' : /client/.test(p) ? '界面' : /index/.test(p) ? '入口' : /\.md$/.test(p) ? '文档' : '模块'
    // 按功能分组（结构化，而非原始 OS 目录）
    const groupFiles = (paths) => {
      const g = {}
      for (const p of (paths || [])) { const r = roleOf(p); (g[r] = g[r] || []).push({ kind: 'file', title: p.split('/').pop(), path: p }) }
      return Object.keys(g).map(k => ({ kind: 'group', title: k, children: g[k] }))
    }

    // 任意深度：把 scope 文件路径建成目录树（dir/file 叶子）
    function fileTree(paths) {
      const root = {}
      for (const p of (paths || [])) {
        const parts = p.split('/')
        let cur = root
        for (let i = 0; i < parts.length; i++) {
          const name = parts[i], last = i === parts.length - 1
          cur[name] = cur[name] || { title: name, kind: last ? 'file' : 'dir', path: parts.slice(0, i + 1).join('/'), children: {} }
          cur = cur[name].children
        }
      }
      const conv = (o) => Object.values(o).map(n => ({ ...n, children: conv(n.children) })).sort((a, b) => a.kind === b.kind ? a.title.localeCompare(b.title) : a.kind === 'dir' ? -1 : 1)
      return conv(root)
    }
    // 统一导航树：root→section→task→(subtask)→dir…→file，层数不限
    function buildTree(view, flat) {
      const bp = view.blueprint
      const numOf = {}
      ;(bp.tasks || []).forEach((t, i) => { numOf[t.id] = i + 1 })
      const tstat = (t) => ({ done: (view.tasks[t.id] || {}).status === 'done' ? 1 : 0, total: 1 })
      const sum = (arr) => arr.reduce((a, x) => ({ done: a.done + (x.stats ? x.stats.done : 0), total: a.total + (x.stats ? x.stats.total : 0) }), { done: 0, total: 0 })
      const withStatus = (n, st, tid) => { n.status = st; n.taskId = tid; (n.children || []).forEach(c => withStatus(c, st, tid)); return n }
      const taskNode = (t) => ({
        kind: 'task', id: t.id, num: numOf[t.id], title: t.title, desc: t.description, acceptance: t.acceptance,
        status: (view.tasks[t.id] || {}).status, stats: tstat(t),
        children: ((t.subtasks && t.subtasks.length)
          ? t.subtasks.map(st => ({ kind: 'subtask', title: st.title || st.id, stats: tstat(t), children: groupFiles(st.scope || t.scope || []) }))
          : groupFiles(t.scope || [])).map(n => withStatus(n, (view.tasks[t.id] || {}).status, t.id)),
      })
      const secNode = (s, si_) => { const ch = (bp.tasks || []).filter(t => t.sectionId === s.id).map(taskNode); return { kind: 'section', id: s.id, num: si_ + 1, title: s.title, desc: s.description, stats: sum(ch), children: ch } }
      const rootCh = flat ? (bp.tasks || []).map(taskNode) : (bp.sections || []).map(secNode).filter(s => s.children.length > 0)
      const root = { kind: 'root', title: bp.project ? bp.project.name : '项目', stats: sum(rootCh), children: rootCh }
      const numberTree = (n) => { (n.children || []).forEach((ch, i) => { if (ch.num == null) ch.num = (n.num != null ? n.num + '.' : '') + (i + 1); numberTree(ch) }) }
      numberTree(root)
      return root
    }
    const nodeColor = (n, view) => {
      if (n.status) return si({ status: n.status }).color
      if (n.stats && n.stats.total) return C.done
      return n.kind === 'file' ? 'var(--dsw-alias-label-secondary)' : 'var(--dsw-alias-brand-primary)'
    }
    const fmtTok = (n) => n >= 1000 ? Math.round(n / 1000) + 'k' : String(n || 0)
    const taskIdsOf = (n) => n.kind === 'task' ? [n.id] : n.taskId ? [n.taskId] : (n.children || []).flatMap(taskIdsOf)
    const TOOL_EST = { edit: 2, write: 2, read: 0.5, grep: 0.5, glob: 0.5, pwsh: 1, bash: 1, plugin_manager: 1, task_claim: 0.5, task_done: 0.5, task_add: 0.5 }
    const actMetric = (id, view) => {
      const a = (view.activity || []).find(x => x.callId === id)
      if (a) { const el = Math.max(0, (a.t1 || Date.now()) - (a.t0 || Date.now())); const em = TOOL_EST[a.tool] || 1; return { elapsedMs: el, remainingMs: a.t1 ? 0 : Math.max(0, em * 60000 - el), tokensUsed: 0, tokensEst: em * 2000 } }
      if (id === 'live' && view.currentAction) { const el = Math.max(0, Date.now() - (view.currentAction.t0 || Date.now())); return { elapsedMs: el, remainingMs: Math.max(0, 60000 - el), tokensUsed: 0, tokensEst: 2000 } }
      return null
    }
    const metricsOf = (n, view) => {
      const ids = taskIdsOf(n)
      const m = view.taskMetrics || {}
      return ids.reduce((a, id) => { const x = m[id] || actMetric(id, view) || {}; return { elapsed: a.elapsed + (x.elapsedMs || 0), remaining: a.remaining + (x.remainingMs || 0), used: a.used + (x.tokensUsed || 0), est: a.est + (x.tokensEst || 0) } }, { elapsed: 0, remaining: 0, used: 0, est: 0 })
    }
    const metricsLine = (n, view) => {
      const m = metricsOf(n, view)
      const allDone = n.stats && n.stats.total && n.stats.done >= n.stats.total
      if (n.kind === 'file') return ''
      if (allDone || n.status === 'done') return `耗 ${m.elapsed ? fmtMs(m.elapsed) : '–'} · ${m.used ? fmtTok(m.used) + ' tok' : (m.est ? '估' + fmtTok(m.est) + ' tok' : '–')}`
      if (n.status === 'running' || (n.stats && n.stats.done > 0 && !allDone)) return `还需 ${fmtMs(m.remaining)} · 已耗 ${fmtMs(m.elapsed)}/${fmtTok(m.used)}tok${m.est ? ' · 估' + fmtTok(m.est) + 'tok' : ''}`
      return `预估 ${fmtMs(m.remaining)}${m.est ? ' · 估' + fmtTok(m.est) + ' tok' : ''}`
    }
    const FolderIcon = () => h('svg', { width: 14, height: 14, viewBox: '0 0 16 16', 'aria-hidden': true }, h('path', { d: 'M2 4a1 1 0 0 1 1-1h3.2l1.3 1.4H13a1 1 0 0 1 1 1V12a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1z', fill: 'none', stroke: 'var(--dsw-alias-label-secondary)', strokeWidth: 1.2 }))
    const FileIcon = () => h('svg', { width: 14, height: 14, viewBox: '0 0 16 16', 'aria-hidden': true }, h('path', { d: 'M4 2h5l3 3v9H4z', fill: 'none', stroke: 'var(--dsw-alias-label-secondary)', strokeWidth: 1.2 }), h('path', { d: 'M9 2v3h3', fill: 'none', stroke: 'var(--dsw-alias-label-secondary)', strokeWidth: 1.2 }))
    const GroupIcon = () => h('svg', { width: 14, height: 14, viewBox: '0 0 16 16', 'aria-hidden': true }, h('rect', { x: 2, y: 2, width: 5, height: 5, rx: 1, fill: 'none', stroke: 'var(--dsw-alias-brand-primary)', strokeWidth: 1.2 }), h('rect', { x: 9, y: 2, width: 5, height: 5, rx: 1, fill: 'none', stroke: 'var(--dsw-alias-brand-primary)', strokeWidth: 1.2 }), h('rect', { x: 2, y: 9, width: 5, height: 5, rx: 1, fill: 'none', stroke: 'var(--dsw-alias-brand-primary)', strokeWidth: 1.2 }), h('rect', { x: 9, y: 9, width: 5, height: 5, rx: 1, fill: 'none', stroke: 'var(--dsw-alias-brand-primary)', strokeWidth: 1.2 }))
    const iconOf = (ch) => ch.kind === 'file' ? h(FileIcon) : ch.kind === 'group' ? h(GroupIcon) : h(FolderIcon)
    const TECH_CSS = `
.pb-page{position:relative;background:radial-gradient(1100px 380px at 50% -10%, color-mix(in srgb, var(--dsw-alias-brand-primary) 9%, transparent), transparent), var(--dsw-alias-bg-base);}
.pb-page::before{content:'';position:absolute;inset:0;pointer-events:none;background:repeating-linear-gradient(0deg, transparent 0 2px, color-mix(in srgb, var(--dsw-alias-label-primary) 2%, transparent) 2px 3px);}
.pb-hud{font-family:ui-monospace,monospace;letter-spacing:.5px;}
.pb-card{transition:box-shadow .2s,border-color .2s,transform .2s;box-shadow:0 0 0 1px color-mix(in srgb, var(--dsw-alias-brand-primary) 14%, transparent),0 2px 10px rgba(0,0,0,.35);}
.pb-card:hover{border-color:var(--dsw-alias-brand-primary);box-shadow:0 0 0 1px var(--dsw-alias-brand-primary),0 0 16px color-mix(in srgb, var(--dsw-alias-brand-primary) 30%, transparent);transform:translateY(-1px);}
.pb-led{animation:pb-pulse 1.2s ease-in-out infinite;}
@keyframes pb-pulse{0%,100%{opacity:1;}50%{opacity:.45;}}
.pb-run{background-image:linear-gradient(45deg, color-mix(in srgb, var(--dsw-alias-bg-base) 30%, transparent) 25%, transparent 25%, transparent 50%, color-mix(in srgb, var(--dsw-alias-bg-base) 30%, transparent) 50%, color-mix(in srgb, var(--dsw-alias-bg-base) 30%, transparent) 75%, transparent 75%);background-size:12px 12px;animation:pb-stripes .8s linear infinite;}
@keyframes pb-stripes{to{background-position:12px 0;}}
.pb-ring{filter:drop-shadow(0 0 6px color-mix(in srgb, var(--dsw-alias-brand-primary) 55%, transparent));}
`
    const TechStyle = () => h('style', null, TECH_CSS)

    const inline = (text, keyBase) => {
      const parts = String(text).split(/(\*\*[^*]+\*\*|`[^`]+`)/g).filter(Boolean)
      return parts.map((p, i) => {
        if (/^\*\*[^*]+\*\*$/.test(p)) return h('strong', { key: keyBase + '-' + i, style: { color: 'var(--dsw-alias-label-primary)', fontWeight: 700 } }, p.slice(2, -2))
        if (/^`[^`]+`$/.test(p)) return h('code', { key: keyBase + '-' + i, style: { fontFamily: 'ui-monospace,monospace', fontSize: '11px', background: 'var(--dsw-alias-bg-layer-2)', borderRadius: '4px', padding: '0 4px' } }, p.slice(1, -1))
        return h('span', { key: keyBase + '-' + i }, p)
      })
    }
    function Markdown({ text, bare }) {
      const lines = (text || '').split('\n')
      const out = []
      let inCode = false, buf = [], tbuf = [], key = 0
      const flush = () => { if (buf.length) { out.push(h('pre', { key: key++, style: { ...T.code, margin: '6px 0' } }, buf.join('\n'))); buf = [] } }
      const flushT = () => {
        if (!tbuf.length) return
        const rows = tbuf.map(l => l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim())).filter(r => !r.every(c => /^:?-{2,}:?$/.test(c)))
        tbuf = []
        if (!rows.length) return
        const n = Math.max(...rows.map(r => r.length))
        out.push(h('div', { key: key++, style: { display: 'grid', gridTemplateColumns: `repeat(${n},1fr)`, gap: '1px', background: 'var(--dsw-alias-border-l1)', border: '1px solid var(--dsw-alias-border-l1)', borderRadius: '6px', overflow: 'hidden', margin: '6px 0' } },
          rows.flatMap((r, ri) => Array.from({ length: n }, (_, ci) => h('div', { key: ri + '-' + ci, style: { background: ri === 0 ? 'var(--dsw-alias-bg-layer-2)' : 'var(--dsw-alias-bg-layer-1)', padding: '4px 8px', fontSize: '11px', fontWeight: ri === 0 ? 700 : 400, color: 'var(--dsw-alias-label-primary)' } }, inline(r[ci] || '', 't' + key + ri + ci))))))
      }
      for (const ln of lines) {
        if (ln.startsWith('```')) { flushT(); if (inCode) { flush(); inCode = false } else inCode = true; continue }
        if (inCode) { buf.push(ln); continue }
        if (/^\s*\|/.test(ln)) { tbuf.push(ln); continue }
        flushT()
        const mH = ln.match(/^(#{1,6})\s+(.*)/)
        if (mH) { const l = mH[1].length; out.push(h('div', { key: key++, style: { fontSize: l === 1 ? '18px' : l === 2 ? '15px' : '13px', fontWeight: 700, color: 'var(--dsw-alias-label-primary)', margin: '12px 0 6px' } }, inline(mH[2], 'h' + key))); continue }
        if (/^\s*(-{3,}|\*{3,})\s*$/.test(ln)) { out.push(h('hr', { key: key++, style: { border: 'none', borderTop: '1px solid var(--dsw-alias-border-l2)', margin: '10px 0' } })); continue }
        if (/^\s*>\s?/.test(ln)) { out.push(h('div', { key: key++, style: { borderLeft: '3px solid var(--dsw-alias-border-l2)', paddingLeft: '10px', margin: '4px 0', color: 'var(--dsw-alias-label-secondary)', fontSize: '12px', lineHeight: 1.7 } }, inline(ln.replace(/^\s*>\s?/, ''), 'q' + key))); continue }
        if (/^\s*[-*]\s+/.test(ln)) { out.push(h('div', { key: key++, style: { fontSize: '12px', color: 'var(--dsw-alias-label-primary)', paddingLeft: '14px', margin: '2px 0', lineHeight: 1.7 } }, '• ', inline(ln.replace(/^\s*[-*]\s+/, ''), 'b' + key))); continue }
        if (/^\s*\d+\.\s+/.test(ln)) { out.push(h('div', { key: key++, style: { fontSize: '12px', color: 'var(--dsw-alias-label-primary)', paddingLeft: '14px', margin: '2px 0', lineHeight: 1.7 } }, inline(ln, 'n' + key))); continue }
        if (ln.trim() === '') { out.push(h('div', { key: key++, style: { height: '6px' } })); continue }
        out.push(h('div', { key: key++, style: { fontSize: '12px', color: 'var(--dsw-alias-label-primary)', margin: '2px 0', lineHeight: 1.7 } }, inline(ln, 'p' + key)))
      }
      flushT()
      flush()
      return h('div', { style: bare ? { display: 'flex', flexDirection: 'column' } : { maxHeight: '60vh', overflowY: 'auto', border: '1px solid var(--dsw-alias-border-l1)', borderRadius: '8px', padding: '12px', background: 'var(--dsw-alias-bg-layer-1)' } }, out)
    }

    const collectPaths = (n) => n.kind === 'file' ? [n.path] : (n.children || []).flatMap(collectPaths)
    function Proposals({ view }) {
      const [list, setList] = useState([])
      const load = () => api(view, 'proposals', {}).then(d => setList((d.proposals || []).filter(p => p.status === 'pending'))).catch(() => setList([]))
      useEffect(() => { load() }, [])
      const act = (id, action) => fetch('/project-board/api/proposals', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ root: view.cwd, id, action }) }).then(() => location.reload())
      if (!list.length) return null
      return h('div', { style: { ...T.note, marginBottom: '10px', color: C.warn } }, list.map(p => h('div', { key: p.id, style: { display: 'flex', gap: '6px', alignItems: 'center', marginBottom: '4px' } },
        h('span', { style: { flex: 1 } }, `结构变更提案（${p.tasks} 任务）待人工批准`),
        h('button', { style: T.back, onClick: () => act(p.id, 'approve') }, '批准'),
        h('button', { style: T.back, onClick: () => act(p.id, 'reject') }, '拒绝'),
      )))
    }
    function ChatPanel({ view }) {
      const msgs = view.messages || []
      return h('div', { style: { width: '380px', flex: 'none', display: 'flex', flexDirection: 'column', border: '1px solid var(--dsw-alias-border-l2)', borderRadius: '12px', background: 'var(--dsw-alias-bg-layer-1)', minHeight: 0 } },
        h('div', { style: { padding: '10px', borderBottom: '1px solid var(--dsw-alias-border-l1)', display: 'flex', alignItems: 'center', gap: '8px' } }, h('span', { style: T.greet }, '💬 对话'), h('span', { style: { ...T.sub, marginLeft: 'auto' } }, '实时·放大')),
        h('div', { style: { flex: 1, overflowY: 'auto', padding: '10px', display: 'flex', flexDirection: 'column', gap: '8px' } },
          msgs.length ? msgs.map((m, i) => h('div', { key: i },
            h('div', { style: { ...T.sub, fontSize: '10px' } }, m.role === 'user' ? '你' : 'AI'),
            h('div', { style: { fontSize: '12px', color: m.role === 'user' ? 'var(--dsw-alias-brand-primary)' : 'var(--dsw-alias-label-primary)', lineHeight: 1.6, whiteSpace: 'pre-wrap' } }, m.text),
          )) : h('div', { style: T.sub }, '（暂无消息）'),
          view.currentAction ? h('div', { style: T.note }, '⠋ ' + view.currentAction.tool + (view.currentAction.target ? ' ' + view.currentAction.target : '')) : null,
        ),
        h('div', { style: { padding: '8px', borderTop: '1px solid var(--dsw-alias-border-l1)', fontSize: '10px', color: 'var(--dsw-alias-label-secondary)' } }, '用下方主输入框发送（文字/语音）'),
      )
    }
    const timeline = (view) => [
      ...(view.messages || []).map(m => ({ at: m.at, role: m.role, text: m.text })),
      ...(view.activity || []).map(a => ({ at: a.t1 || a.t0, role: 'tool', text: a.tool + (a.target ? ' ' + a.target : ''), tool: a.tool, path: a.target, plus: a.plus, minus: a.minus })),
    ].sort((a, b) => (a.at || 0) - (b.at || 0)).slice(-50)
    const flow = (view) => {
      const out = []; let run = null
      for (const m of timeline(view)) {
        if (m.role === 'tool' && /^(edit|write)/.test(m.tool || '')) {
          if (!run) { run = { type: 'edit', files: [], plus: 0, minus: 0 }; out.push(run) }
          run.files.push({ path: m.path, plus: m.plus, minus: m.minus })
          run.plus += m.plus || 0; run.minus += m.minus || 0
        } else { run = null; out.push(m) }
      }
      return out
    }
    const criticalSet = (view) => {
      const ts = view.blueprint.tasks || []; const byId = {}; ts.forEach(t => byId[t.id] = t)
      const memo = {}; const depth = (id) => { if (memo[id] != null) return memo[id]; const t = byId[id]; if (!t) return 0; const d = 1 + Math.max(0, ...(t.dependsOn || []).map(depth)); memo[id] = d; return d }
      let end = null, max = 0; ts.forEach(t => { const d = depth(t.id); if (d > max) { max = d; end = t.id } })
      const set = new Set(); let cur = end
      while (cur) { set.add(cur); const t = byId[cur]; cur = (t.dependsOn || []).slice().sort((a, b) => depth(b) - depth(a))[0] }
      return set
    }
    const burn = (view) => {
      const doneTs = Object.values(view.tasks).filter(t => t.endedAt).sort((a, b) => a.endedAt - b.endedAt)
      const total = (view.blueprint.tasks || []).length
      const pts = []; let done = 0
      const start = doneTs.length ? doneTs[0].endedAt : Date.now()
      pts.push([start, total]); doneTs.forEach(t => { done++; pts.push([t.endedAt, total - done]) }); pts.push([Date.now(), total - done])
      return { pts, total }
    }
    function Spark({ pts, total }) {
      if (!pts.length || !total) return null
      const t0 = pts[0][0], t1 = pts[pts.length - 1][0] || t0 + 1
      const W = 220, H = 48
      const xy = pts.map(([t, v]) => [((t - t0) / (t1 - t0 || 1)) * W, H - (v / total) * H])
      const d = xy.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ')
      return h('svg', { width: W, height: H, style: { display: 'block' } },
        h('path', { d, fill: 'none', stroke: 'var(--dsw-alias-brand-primary)', strokeWidth: 2 }),
        h('line', { x1: 0, y1: H, x2: W, y2: H, stroke: 'var(--dsw-alias-border-l2)', strokeWidth: 1 }),
      )
    }
    function VoiceBar({ view }) {
      const [auto, setAuto] = useState(false)
      const lastRef = useRef(null)
      useEffect(() => {
        if (!auto) return
        const msgs = view.messages || []
        const last = [...msgs].reverse().find(m => m.role === 'assistant')
        if (last && last.at !== lastRef.current) {
          lastRef.current = last.at
          try { const u = new SpeechSynthesisUtterance(last.text.slice(0, 500)); u.lang = 'zh-CN'; speechSynthesis.speak(u) } catch {}
        }
      }, [view.messages, auto])
      const mic = () => {
        const R = window.SpeechRecognition || window.webkitSpeechRecognition
        if (!R) return
        const r = new R(); r.lang = 'zh-CN'
        r.onresult = (e) => {
          const t = e.results[0][0].transcript
          const ed = document.querySelector('[data-composer-input]')
          if (ed) { ed.focus(); document.execCommand('insertText', false, t); const card = ed.closest('[data-composer-card]'); const btn = (card && card.querySelector('button[type="submit"]')) || (card && [...card.querySelectorAll('button')].pop()); if (btn) btn.click() }
        }
        r.start()
      }
      return h('div', { style: { display: 'flex', gap: '6px' } },
        h('button', { style: T.back, onClick: mic, title: '语音输入' }, '🎤'),
        h('button', { style: { ...T.back, color: auto ? C.done : undefined }, onClick: () => setAuto(!auto) }, auto ? '🔊 播报开' : '🔇 播报关'),
      )
    }
    function Flow({ view }) {
      const ts = view.blueprint.tasks || []
      const byId = {}; ts.forEach(t => byId[t.id] = t)
      const depth = {}; const dep = id => { if (depth[id] != null) return depth[id]; const t = byId[id]; if (!t) return 0; const d = 1 + Math.max(0, ...(t.dependsOn || []).map(dep)); depth[id] = d; return d }
      ts.forEach(t => dep(t.id))
      const levels = {}; ts.forEach(t => { (levels[depth[t.id]] = levels[depth[t.id]] || []).push(t) })
      const NW = 150, NH = 34, GX = 40, GY = 14
      const pos = {}; let maxW = 0, maxH = 0
      Object.keys(levels).sort((a, b) => a - b).forEach(L => { levels[L].forEach((t, i) => { pos[t.id] = { x: L * (NW + GX), y: i * (NH + GY) }; maxW = Math.max(maxW, (L + 1) * (NW + GX)); maxH = Math.max(maxH, (i + 1) * (NH + GY)) }) })
      const H = maxH
      const color = t => { const st = (view.tasks[t.id] || {}).status; return st === 'done' ? C.done : st === 'running' ? C.running : st === 'blocked' ? C.blocked : 'var(--dsw-alias-border-l2)' }
      return h('div', { style: { overflow: 'auto', maxHeight: '260px', marginTop: '4px' } },
        h('svg', { width: maxW + 20, height: H + 10 },
          h('defs', null, h('marker', { id: 'pbarr', viewBox: '0 0 10 10', refX: 8, refY: 5, markerWidth: 6, markerHeight: 6, orient: 'auto' }, h('path', { d: 'M0,0L10,5L0,10z', fill: 'var(--dsw-alias-label-secondary)' }))),
          ts.flatMap(t => (t.dependsOn || []).map(d => { const a = pos[d], b = pos[t.id]; if (!a || !b) return null; return h('path', { key: d + t.id, d: `M${a.x + NW},${a.y + NH / 2} L${b.x},${b.y + NH / 2}`, stroke: 'var(--dsw-alias-label-secondary)', fill: 'none', markerEnd: 'url(#pbarr)' }) })),
          ts.map(t => { const p = pos[t.id]; return h('g', { key: t.id }, h('rect', { x: p.x, y: p.y, width: NW, height: NH, rx: 6, fill: 'var(--dsw-alias-bg-layer-2)', stroke: color(t) }), h('text', { x: p.x + 8, y: p.y + 21, fontSize: 10, fill: 'var(--dsw-alias-label-primary)' }, (t.title || t.id).slice(0, 12))) }),
        ))
    }
    function Guide({ view, node }) {
      const [intro, setIntro] = useState(null)
      const [qa, setQa] = useState([])
      const [q, setQ] = useState('')
      const [busy, setBusy] = useState(false)
      const paths = collectPaths(node).slice(0, 6)
      useEffect(() => {
        fetch('/project-board/api/focus', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ root: view.cwd, node: { kind: node.kind, id: node.id, title: node.title, path: node.path, paths } }) }).catch(() => {})
        const t = node.kind === 'task' || node.kind === 'subtask' ? `${node.title}：${node.desc || node.acceptance || ''}` : node.kind === 'file' ? `文件 ${node.path}（属当前任务 scope）` : `${node.title} · ${(node.children || []).length} 项`
        setIntro(t + (node.status === 'done' ? '（已完成）' : node.status === 'running' ? '（进行中）' : ''))
        setQa([])
      }, [node.id, node.path])
      const ask = (text) => {
        const question = (text || q).trim(); if (!question || busy) return
        setBusy(true); setQa(a => [...a, { q: question, a: null }]); setQ('')
        fetch('/project-board/api/ask', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ root: view.cwd, paths, question, title: node.title }) })
          .then(r => r.json()).then(j => { const ans = j.answer || j.text || j.reply || '（无回答）'; setQa(a => { const c = [...a]; c[c.length - 1] = { q: question, a: ans }; return c }) })
          .catch(() => { setQa(a => { const c = [...a]; c[c.length - 1] = { q: question, a: '（导游离线，稍后再试）' }; return c }) })
          .finally(() => setBusy(false))
      }
      const mic = () => { const R = window.SpeechRecognition || window.webkitSpeechRecognition; if (!R) return; const r = new R(); r.lang = 'zh-CN'; r.onresult = e => ask(e.results[0][0].transcript); r.start() }
      return h('div', { style: { ...T.card, marginTop: '8px' } },
        h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' } },
          h('h3', { style: T.h }, '🧭 导游'),
          h('span', { style: { ...T.sub, fontSize: '10px' } }, '上下文：' + (node.title || '')),
        ),
        h('div', { style: { fontSize: '12px', color: 'var(--dsw-alias-label-primary)', lineHeight: 1.7, whiteSpace: 'pre-wrap' } }, intro == null ? '…' : intro),
        qa.length ? h('div', { style: { marginTop: '8px', display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '200px', overflowY: 'auto' } }, qa.map((m, i) => h('div', { key: i },
          h('div', { style: { ...T.sub, fontSize: '11px', color: 'var(--dsw-alias-brand-primary)' } }, '你：' + m.q),
          h('div', { style: { fontSize: '12px', color: 'var(--dsw-alias-label-primary)', lineHeight: 1.6, whiteSpace: 'pre-wrap' } }, m.a == null ? '🧭 思考中…' : m.a),
        ))) : null,
        h('div', { style: { display: 'flex', gap: '6px', marginTop: '8px' } },
          h('input', { value: q, placeholder: '问导游：关于当前节点…', onChange: e => setQ(e.target.value), onKeyDown: e => { if (e.key === 'Enter') ask() }, style: { flex: 1, padding: '6px 8px', borderRadius: '8px', border: '1px solid var(--dsw-alias-border-l2)', background: 'var(--dsw-alias-bg-base)', color: 'var(--dsw-alias-label-primary)', fontSize: '12px' } }),
          h('button', { style: T.back, onClick: () => ask(), disabled: busy }, '问'),
          h('button', { style: T.back, onClick: mic, title: '语音问' }, '🎤'),
        ),
      )
    }

    function DialogBox({ view, node, isRoot, onOpen, inGrid }) {
      const [now, setNow] = useState(Date.now())
      useEffect(() => { const iv = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(iv) }, [])
      const mirrorRef = useRef(null)
      useLayoutEffect(() => { const el = mirrorRef.current; if (el) el.scrollTop = el.scrollHeight }, [view.messages, view.activity, now])
      useEffect(() => {
        fetch('/project-board/api/focus', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ root: view.cwd, node: { kind: node.kind, id: node.id, title: node.title, path: node.path, paths: collectPaths(node).slice(0, 6) } }) }).catch(() => {})
      }, [node.id, node.path])
      return h('div', { style: { ...(inGrid ? { gridColumn: 'span 2', gridRow: 'span 4' } : { gridColumn: 'span 2', gridRow: 'span 4' }), border: '1px solid var(--dsw-alias-brand-primary)', borderRadius: '12px', background: 'var(--dsw-alias-bg-layer-1)', padding: '10px', display: 'flex', flexDirection: 'column', minHeight: 0, boxShadow: '0 0 0 1px color-mix(in srgb, var(--dsw-alias-brand-primary) 18%, transparent)' } },
        h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' } }, h(Ring, { pct: blendedPct(view), color: (view.counts || {}).running > 0 ? C.running : C.done }), h('span', { style: T.greet }, '💬 对话'), h('span', { style: { ...T.sub, marginLeft: 'auto' } }, isRoot ? '实时·可输入' : '锁定：' + (node.title || '当前项目')), h(VoiceBar, { view })),
        h('div', { ref: mirrorRef, style: { flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '8px' } },
          flow(view).map((m, i) => m.type === 'edit'
            ? h('div', { key: i, style: { ...T.card, padding: '8px' } },
              h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px' } },
                h('span', { style: { ...T.tileNum, position: 'static', width: '22px', height: '22px', background: 'var(--dsw-alias-brand-primary)', color: '#fff', border: 'none' } }, '</>'),
                h('span', { style: { fontSize: '12px', fontWeight: 600, color: 'var(--dsw-alias-label-primary)' } }, `已编辑${m.files.length}个文件`),
                h('span', { style: { fontSize: '11px', color: C.done } }, '+' + m.plus),
                h('span', { style: { fontSize: '11px', color: C.blocked } }, '-' + m.minus),
              ),
              h('div', { style: { marginTop: '6px', display: 'flex', flexDirection: 'column', gap: '4px' } }, m.files.map((f, j) => h('div', { key: j, style: { display: 'flex', justifyContent: 'space-between', gap: '8px', fontSize: '11px', color: 'var(--dsw-alias-label-secondary)', cursor: 'pointer' }, onClick: () => onOpen({ kind: 'file', path: f.path, title: (f.path || '').split('/').pop() }) },
                h('span', { style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--dsw-alias-brand-primary)' } }, f.path),
                h('span', { style: { whiteSpace: 'nowrap' } }, h('span', { style: { color: C.done } }, '+' + (f.plus || 0)), ' ', h('span', { style: { color: C.blocked } }, '-' + (f.minus || 0))),
              ))),
            )
            : m.role === 'tool'
              ? h('div', { key: i, style: { ...T.card, padding: '6px 8px' } }, h('div', { style: { fontSize: '11px', color: 'var(--dsw-alias-label-secondary)' } }, m.text))
              : h('div', { key: i },
                h('div', { style: { ...T.sub, fontSize: '10px' } }, m.role === 'user' ? '你' : 'AI'),
                h(Markdown, { text: m.text, bare: true }),
              )),
        ),
        h('div', { id: 'pb-composer-slot', style: { marginTop: '6px' } }),
      )
    }
    function CodeView({ view, node, onBack }) {
      const [code, setCode] = useState(null)
      useEffect(() => { setCode(null); api(view, 'file', { path: node.path }).then(setCode).catch(() => setCode({ error: 'read' })) }, [node.path])
      const isMd = /\.md$/.test(node.path || '')
      return h('div', { style: T.wrap },
        h('button', { style: T.back, onClick: onBack }, '← 返回'),
        h('div', { style: { ...T.greet, marginBottom: '6px' } }, '📄 ' + node.title),
        h('div', { style: { ...T.sub, marginBottom: '8px' } }, node.path),
        h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gridAutoRows: 'clamp(80px, 10vh, 110px)', gap: '12px', marginBottom: '14px' } },
          h(DialogBox, { view, node, isRoot: false, onOpen: () => {}, inGrid: true }),
          h('div', { style: { gridColumn: 'span 2', gridRow: 'span 4', ...T.card, display: 'flex', flexDirection: 'column', minHeight: 0 } },
            h('h3', { style: T.h }, '当前文件'),
            h('div', { style: { ...T.sub, fontSize: '11px', wordBreak: 'break-all' } }, node.path),
          ),
        ),
        code == null ? h('div', { style: T.sub }, '加载中…') : code.binary ? h('div', { style: T.note }, '二进制，请在编辑器打开') : code.truncated ? h('div', { style: T.note }, '过大（>256KB）') : isMd ? h(Markdown, { text: code.content || '' }) : h('pre', { style: { ...T.code, maxHeight: '60vh' } }, code.content || code.error || ''),

      )
    }

    // 递归文件夹视图：任意层数；root 额外显示当前运行+总进度+对话
    function FolderView({ view, node, onOpen, onBack, syncOn, onToggleSync, onManualSync }) {
      const isRoot = node.kind === 'root'
      const ri = isRoot ? runInfo(view) : null
      const rt = ri ? (view.blueprint.tasks || []).find(t => t.id === ri.id) : null
      const [cin, setCin] = useState('')
      const [jump, setJump] = useState('')
      const [now, setNow] = useState(Date.now())
      useEffect(() => { const iv = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(iv) }, [])
      const dynPct = (ch) => { const rec = view.tasks[ch.id] || {}; const st = rec.status || ch.status; if (st === 'done') return 100; if (st !== 'running') return 0; const t0 = rec.startedAt || (view.currentAction && view.currentAction.t0) || now; const bp = (view.blueprint.tasks || []).find(t => t.id === ch.id); const est = (bp && bp.estimateMinutes) || 5; const mins = Math.max(0.2, (now - t0) / 60000); const acts = ((view.artifacts || {})[ch.id] || []).length; const base = Math.min(60, acts * 6); const timePart = (1 - Math.exp(-mins / (est * 0.5))) * 40; return Math.min(95, Math.round(base + timePart)) }
      const sendToChat = (text) => {
        const tas = [...document.querySelectorAll('textarea')]
        const ta = tas.find(t => (t.placeholder || '').includes('发送')) || tas[0]
        if (!ta || !text.trim()) return
        const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
        set.call(ta, text)
        ta.dispatchEvent(new Event('input', { bubbles: true }))
        const form = ta.closest('form')
        if (form && form.requestSubmit) form.requestSubmit()
        setCin('')
      }
      const folder = { border: '1px solid var(--dsw-alias-border-l1)', borderRadius: '16px', background: 'var(--dsw-alias-bg-layer-1)', padding: '10px', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px' }
      const preview = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px', width: '52px', height: '52px', borderRadius: '12px', background: 'var(--dsw-alias-bg-layer-2)', padding: '6px', boxSizing: 'border-box' }
      const card = (ch, fill) => h('div', { key: ch.id || ch.path, style: { ...T.tile, height: fill ? '100%' : 'clamp(120px, 16vh, 170px)', overflow: 'hidden', borderColor: ch.status === 'running' ? C.running : criticalSet(view).has(ch.id) ? C.warn : 'var(--dsw-alias-border-l1)' }, className: 'pb-card', onClick: () => onOpen(ch) },
        h('span', { style: T.tileNum }, ch.num != null ? ch.num : iconOf(ch)),
        h('div', { style: { ...T.tileTitle, display: 'flex', alignItems: 'center', gap: '6px' } }, iconOf(ch), h('span', { style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, ch.title)),
        h('div', { style: { fontSize: '11px', color: 'var(--dsw-alias-label-secondary)', overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' } }, ch.desc || (ch.stats && ch.stats.total ? `${ch.stats.done}/${ch.stats.total} 完成` : (ch.kind === 'file' ? ch.path : (ch.children || []).length + ' 项'))),
        h('div', { style: T.tileMeta }, h('span', { style: { ...T.dot, background: nodeColor(ch, view) }, className: ch.status === 'running' ? 'pb-led' : undefined }), ch.status ? si({ status: ch.status }).label : (ch.stats && ch.stats.total ? `${ch.stats.done}/${ch.stats.total}·${Math.round(ch.stats.done / ch.stats.total * 100)}%` : (ch.kind === 'file' ? '代码' : '文件夹'))),
        h('div', { style: { ...T.sub, fontSize: '10px' } }, metricsLine(ch, view)),
        h('div', { style: { display: 'flex', alignItems: 'center', gap: '6px', marginTop: 'auto' } },
          h('div', { style: { ...T.track, flex: 1 } }, h('div', { className: ch.status === 'running' ? 'pb-run' : undefined, style: { height: '100%', width: dynPct(ch) + '%', background: nodeColor(ch, view), transition: 'width .6s ease' } })),
          h('span', { style: { ...T.sub, fontSize: '10px', fontVariantNumeric: 'tabular-nums' } }, dynPct(ch) + '%'),
        ),
      )
      const group = (title, pct, cards) => h('div', { style: { ...T.card, marginBottom: '14px', borderColor: 'var(--dsw-alias-border-l2)' } },
        h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px' } }, h('span', { style: { ...T.greet, fontSize: '14px' } }, title), pct != null ? h('span', { style: T.pct }, pct + '%') : null),
        h('div', { style: { ...T.grid, gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '12px' } }, cards),
      )
      const secIds = (view.blueprint.sections || []).map(s => s.id)
      const adhoc = (view.blueprint.tasks || []).filter(t => !secIds.includes(t.sectionId)).sort((a, b) => ((view.tasks[a.id] || {}).startedAt || 0) - ((view.tasks[b.id] || {}).startedAt || 0))
      const titleOf = {}; (view.blueprint.tasks || []).forEach(t => { titleOf[t.id] = t.title })
      const dialogCell = (inGrid) => h(DialogBox, { view, node, isRoot, onOpen, inGrid })
      return h('div', { style: isRoot ? { ...T.wrap, overflow: 'auto', display: 'flex', flexDirection: 'column' } : T.wrap, className: 'pb-page' },
        h(TechStyle),
        !isRoot ? h('button', { style: T.back, onClick: onBack }, '← 返回上级') : null,
        h('div', { style: { ...T.greet, marginBottom: '6px' }, className: 'pb-hud' }, (node.num ? node.num + '号 · ' : '') + node.title),
        isRoot ? h('div', { style: { ...T.sub, marginBottom: '10px' }, className: 'pb-hud' }, `完成 ${(view.counts || {}).done || 0} · 进行 ${(view.counts || {}).running || 0} · 阻塞 ${(view.counts || {}).blocked || 0} · 未认领 ${(view.unclaimed || []).length} · 会话耗 ${fmtMs((view.sessionUsage || {}).elapsedMs)} · ${fmtTok((view.sessionUsage || {}).tokens)} tok`) : null,
        isRoot ? h(Proposals, { view }) : null,
        node.desc ? h('div', { style: { ...T.sub, marginBottom: '10px' } }, node.desc) : null,
        node.acceptance ? h('div', { style: { ...T.sub, marginBottom: '10px' } }, '验收：' + node.acceptance) : null,
        (node.kind === 'task' || node.kind === 'subtask') ? h('div', { style: { ...T.sub, marginBottom: '10px', color: 'var(--dsw-alias-label-primary)' } }, '本任务：' + metricsLine(node, view)) : null,
        h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gridAutoRows: 'clamp(80px, 10vh, 110px)', gap: '12px', marginBottom: '14px' } },
          dialogCell(true),
          h('div', { style: { gridColumn: 'span 2', gridRow: 'span 4', ...T.card, display: 'flex', flexDirection: 'column', minHeight: 0 } },
            h('h3', { style: T.h }, isRoot ? '零散任务（做过+当前·时间序）' : '当前层级子项'),
            h('div', { style: { flex: 1, overflowY: 'auto', display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '10px', alignContent: 'start' } },
              isRoot ? [
                    ...(view.currentAction ? [card({ kind: 'task', id: 'live', title: (view.nextIntent && view.nextIntent.text) || `${view.currentAction.tool}`, desc: '当前执行·非蓝图', status: 'running', stats: { done: 0, total: 1 }, children: [] })] : []),
                    ...(view.activity || []).slice(-12).reverse().map(a => card({ kind: 'task', id: a.callId, title: a.tool + (a.target ? ' ' + String(a.target).split(/[\\/]/).pop() : ''), desc: a.target, status: a.error ? 'blocked' : (a.t1 ? 'done' : 'running'), stats: { done: a.t1 ? 1 : 0, total: 1 }, children: [] })),
                    ...adhoc.map(t => card({ kind: 'task', id: t.id, title: t.title, desc: t.description, status: (view.tasks[t.id] || {}).status, stats: { done: (view.tasks[t.id] || {}).status === 'done' ? 1 : 0, total: 1 }, taskId: t.id, children: [] })),
              ] : (node.children || []).map(ch => card(ch)),
            ),
          ),
        ),
        isRoot
          ? h('div', null,
            h('div', { style: { ...T.card, padding: '12px', marginBottom: '14px' } },
              h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' } },
                h('h3', { style: T.h }, '小工具'),
                h('input', { value: jump, placeholder: '输入编号回车→打开任务', onChange: e => setJump(e.target.value), onKeyDown: e => { if (e.key === 'Enter') { const t = (view.blueprint.tasks || [])[parseInt(jump, 10) - 1]; if (t) { const n = buildTree(view, false).children.flatMap(s => s.children).find(x => x.id === t.id); if (n) onOpen(n) } setJump('') } }, style: { width: '150px', padding: '4px 8px', borderRadius: '8px', border: '1px solid var(--dsw-alias-border-l2)', background: 'var(--dsw-alias-bg-base)', color: 'var(--dsw-alias-label-primary)', fontSize: '12px' } }),
                h('span', { style: { ...T.sub, fontSize: '10px' } }, '琥珀色边框＝关键路径（要按顺序做、影响总工期）'),
              ),
              h('div', { style: { display: 'flex', gap: '16px', alignItems: 'center', marginTop: '8px', flexWrap: 'wrap' } },
                h('div', null, h('div', { style: { ...T.sub, fontSize: '10px' } }, '还剩几个任务没做（越低越好）'), h(Spark, { pts: burn(view).pts, total: burn(view).total })),
                h('details', { style: { flex: 1, minWidth: '200px' } },
                  h('summary', { style: { ...T.sub, fontSize: '10px', cursor: 'pointer' } }, '点开看：任务流程图（边个先做）'),
                  h(Flow, { view }),
                ),
              ),
            ),
            h('div', { style: { ...T.card, padding: '12px' } },
              h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px' } }, h(Ring, { pct: blendedPct(view), color: (view.counts || {}).running > 0 ? C.running : C.done }), h('h3', { style: T.h }, '项目总览'), h('span', { style: { ...T.sub, fontSize: '10px' } }, '基线 V2.71'), h('span', { style: { ...T.sub, fontSize: '10px', marginLeft: 'auto', color: syncOn ? C.done : C.pending } }, syncOn ? (view.autoSync ? '⚡同步 ' + new Date(view.autoSync.at).toLocaleTimeString() + (view.autoSync.changed ? ' ·更新' + view.autoSync.changed : ' ·一致') : '⚡同步…') : '⏸同步关'), onManualSync ? h('button', { style: { ...T.back, marginBottom: 0, padding: '2px 8px' }, onClick: onManualSync, title: '立即同步' }, '🔄') : null, onToggleSync ? h('button', { style: { ...T.back, marginBottom: 0, padding: '2px 8px' }, onClick: onToggleSync }, syncOn ? '关同步' : '开同步') : null),
              h(OverallBar, { view }),
              h('div', { style: { ...T.sub, marginTop: '6px' } }, `完成 ${(view.counts || {}).done || 0} · 进行 ${(view.counts || {}).running || 0} · 阻塞 ${(view.counts || {}).blocked || 0} · 未认领 ${(view.unclaimed || []).length}`),
              h(Proposals, { view }),
              h('div', { style: { marginTop: '12px' } },
                (node.children || []).filter(s => s.kind === 'section').map(sec => group(sec.title, sec.stats && sec.stats.total ? Math.round(sec.stats.done / sec.stats.total * 100) : null, (sec.children || []).map(ch => card(ch)))),
              ),
            ),
          )
          : null,
        (node.kind === 'task') ? h('div', { style: { ...T.card, marginTop: '8px' } },
          h('h3', { style: T.h }, '执行历史'),
          h('div', { style: { ...T.sub, fontSize: '11px' } }, ((view.artifacts || {})[node.id] || []).map(a => a.path).join(' → ') || '（本会话暂无产物记录）'),
          (node.spinSeq && node.spinSeq.length) ? h('div', { style: { ...T.note, marginTop: '6px', color: C.warn } }, '⚠ 打转：' + node.spinSeq.map(s => s.tool + ' ' + s.target).join(' → ')) : null,
          (view.tasks[node.id] || {}).status === 'done' ? h('button', { style: { ...T.back, marginTop: '6px' }, onClick: () => fetch('/project-board/api/reopen', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ root: view.cwd, taskId: node.id }) }).then(() => location.reload()) }, '人工重开（done→running）') : null,
          h('button', { style: { ...T.back, marginTop: '6px', marginLeft: '6px' }, onClick: () => { const t = prompt('修改任务标题', node.title); if (t) fetch('/project-board/api/task-edit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ root: view.cwd, taskId: node.id, title: t }) }).then(() => location.reload()) } }, '编辑标题'),
        ) : null,

      )
    }

    // 主屏：好看的扁平卡片网格（编号任务+概要+ETA+绿色进度），点任务下钻代码、点📂看架构
    function CardGrid({ view, onTask, onProject }) {
      const bp = view.blueprint
      const numOf = {}
      ;(bp.tasks || []).forEach((t, i) => { numOf[t.id] = i + 1 })
      return h('div', { style: T.wrap },
        h('div', { style: { marginBottom: '14px' } },
          h('div', { style: { ...T.greet, marginBottom: '6px' } }, bp.project ? bp.project.name : '项目'),
          h(OverallBar, { view }),
        ),
        h('div', { style: T.grid },
          h('div', { style: { ...T.tile, borderColor: 'var(--dsw-alias-brand-primary)' }, onClick: goChat },
            h('span', { style: T.tileNum }, '0'),
            h('div', { style: T.tileTitle }, '💬 对话'),
            h('div', { style: T.tileMeta }, '需要输入时打开，回到当前对话'),
          ),
          h('div', { style: T.tile, onClick: onProject },
            h('span', { style: T.tileNum }, '📂'),
            h('div', { style: T.tileTitle }, '项目代码·架构'),
            h('div', { style: T.tileMeta }, '按板块/功能下钻浏览'),
          ),
          (bp.tasks || []).map(t => {
            const rt = view.tasks[t.id] || {}
            const s = si(rt)
            const te = (view.taskEta || {})[t.id]
            const sec = (bp.sections || []).find(x => x.id === t.sectionId)
            return h('div', { key: t.id, style: T.tile, onClick: () => onTask(t.id) },
              h('span', { style: T.tileNum }, numOf[t.id]),
              h('div', { style: T.tileTitle }, t.title),
              h('div', { style: { fontSize: '11px', color: 'var(--dsw-alias-label-secondary)', overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' } }, t.description || t.acceptance || ''),
              h('div', { style: T.tileMeta }, h('span', { style: { ...T.dot, background: s.color } }), s.label, sec ? h('span', null, '· ' + sec.title) : null),
              h('div', { style: { ...T.tileMeta, marginTop: 'auto' } }, h('span', null, 'ETA ' + (rt.status === 'done' ? '0' : fmtMs(te && te.ms)))),
              h('div', { style: T.track }, h('div', { style: { height: '100%', width: (rt.status === 'done' ? 100 : rt.status === 'running' ? (runInfo(view) || { frac: .1 }).frac * 100 : 0) + '%', background: rt.status === 'done' ? C.done : s.color } })),
            )
          }),
        ),
      )
    }

    function BoardPage(props) {
      useTick(3000)
      const view = props.useProjection('projectBoard')
      const [stack, setStack] = useState([])
      const [autoMap, setAutoMap] = useState(null)
      const [lastSync, setLastSync] = useState(null)
      const [syncOn, setSyncOn] = useState(() => { try { return localStorage.getItem('pb-sync') !== '0' } catch { return true } })
      const doSync = () => fetch('/project-board/api/auto-sync', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ root: view.cwd }) }).then(r => r.json()).then(d => { if (d && d.statuses) setAutoMap(d.statuses); setLastSync({ at: Date.now(), changed: d && d.changed }) }).catch(() => {})
      const toggleSync = () => setSyncOn(v => { const nv = !v; try { localStorage.setItem('pb-sync', nv ? '1' : '0') } catch {} fetch('/project-board/api/sync-config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ root: view.cwd, enabled: nv }) }).catch(() => {}); return nv })
      useEffect(() => {
        if (!view || !view.cwd || !syncOn) return
        doSync()
        const iv = setInterval(doSync, 20000)
        return () => clearInterval(iv)
      }, [view && view.cwd, syncOn])
      useEffect(() => {
        let seat = null, origParent = null, origNext = null
        const move = () => {
          const slot = document.getElementById('pb-composer-slot')
          const s = seat || document.querySelector('[data-composer-seat]')
          if (slot && s && s.parentNode !== slot) {
            if (!seat) { seat = s; origParent = s.parentNode; origNext = s.nextSibling }
            slot.appendChild(s)
          }
        }
        move()
        const iv = setInterval(move, 600)
        return () => { clearInterval(iv); if (seat && origParent) origParent.insertBefore(seat, origNext) }
      }, [])
      if (!view || !view.blueprint) return h('div', { style: T.empty },
        h('div', { style: { marginBottom: '10px' } }, '暂无项目蓝图。'),
        h('button', { style: T.back, onClick: () => fetch('/project-board/api/auto-init', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ root: (view && view.cwd) || undefined }) }).then(() => location.reload()) }, '⚡ 无模型自动建板（扫描仓库）'),
        h('div', { style: { ...T.sub, marginTop: '8px' } }, '或让 Agent 用 project_init 生成／手写 .dsh-project/blueprint.json 后刷新。'),
      )
      const effView = autoMap ? { ...view, autoSync: lastSync, tasks: Object.fromEntries(Object.entries(view.tasks || {}).map(([id, t]) => [id, autoMap[id] ? { ...t, status: autoMap[id] } : t])) } : { ...view, autoSync: lastSync }
      const tree = buildTree(effView, false)
      const syncProps = { syncOn, onToggleSync: toggleSync, onManualSync: doSync }
      if (!stack.length) return h(FolderView, { view: effView, node: tree, ...syncProps, onOpen: (ch) => setStack([ch]), onBack: () => setStack([]) })
      const node = stack[stack.length - 1]
      if (node.kind === 'file') return h(CodeView, { view: effView, node, onBack: () => setStack(stack.slice(0, -1)) })
      return h(FolderView, { view: effView, node, ...syncProps, onOpen: (ch) => setStack([...stack, ch]), onBack: () => setStack(stack.slice(0, -1)) })
    }

    function Ring({ pct, color }) {
      const r = 13, C = 2 * Math.PI * r
      return h('svg', { width: 34, height: 34, viewBox: '0 0 34 34', className: 'pb-ring', style: { flexShrink: 0 } },
        h('circle', { cx: 17, cy: 17, r, fill: 'none', stroke: 'var(--dsw-alias-bg-layer-2)', strokeWidth: 4 }),
        h('circle', { cx: 17, cy: 17, r, fill: 'none', stroke: color, strokeWidth: 4, strokeLinecap: 'round', strokeDasharray: `${(pct / 100) * C} ${C}`, transform: 'rotate(-90 17 17)' }),
        h('text', { x: 17, y: 17, textAnchor: 'middle', dominantBaseline: 'central', fontSize: 9, fontWeight: 700, fill: 'var(--dsw-alias-label-primary)', style: { fontVariantNumeric: 'tabular-nums' } }, pct),
      )
    }

    function DockStrip(props) {
      useTick(3000)
      const view = props.useProjection('projectBoard')
      if (!view || !view.blueprint) return null
      const c = view.counts || { total: 0, done: 0, running: 0 }
      const pct = blendedPct(view)
      const runId = Object.keys(view.tasks).find(id => view.tasks[id].status === 'running')
      const rt = runId ? (view.blueprint.tasks || []).find(t => t.id === runId) : null
      const color = c.running > 0 ? C.running : pct >= 100 ? C.done : C.running
      const agg = Object.values(view.taskMetrics || {}).reduce((a, x) => ({ elapsed: a.elapsed + (x.elapsedMs || 0), used: a.used + (x.tokensUsed || 0), est: a.est + (x.tokensEst || 0) }), { elapsed: 0, used: 0, est: 0 })
      return h('div', { style: { display: 'flex', justifyContent: 'center', padding: '6px 12px' } },
        h(TechStyle),
        h('div', { style: { display: 'flex', alignItems: 'center', gap: '10px', width: '100%', maxWidth: '560px', padding: '8px 14px', borderRadius: '14px', border: '1px solid var(--dsw-alias-border-l1)', background: 'var(--dsw-alias-bg-layer-1)', boxShadow: '0 1px 4px rgba(0,0,0,.25)' } },
          h(Ring, { pct, color }),
          h('div', { style: { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '2px' } },
            h('span', { style: { fontSize: '12px', fontWeight: 600, color: 'var(--dsw-alias-label-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, rt ? '⠋ ' + rt.title : (pct >= 100 ? '✓ 全部完成' : '待命')),
            h('span', { style: { fontSize: '10px', color: 'var(--dsw-alias-label-secondary)', whiteSpace: 'nowrap' } }, `耗 ${fmtMs(agg.elapsed)} · ${fmtTok(agg.used)} tok · 估 ${fmtTok(agg.est)} tok`),
          ),
          h('span', { style: { fontSize: '11px', color: 'var(--dsw-alias-label-secondary)', whiteSpace: 'nowrap' } }, `${c.done}/${c.total} · 还需 ` + fmtMs(view.eta && view.eta.ms)),
        ),
      )
    }

    const Icon = ({ size }) => h('svg', { width: size || 16, height: size || 16, viewBox: '0 0 16 16', 'aria-hidden': true },
      h('rect', { x: 1, y: 1, width: 6, height: 14, rx: 1, fill: 'currentColor', opacity: .9 }),
      h('rect', { x: 9, y: 1, width: 6, height: 6, rx: 1, fill: 'currentColor', opacity: .5 }),
      h('rect', { x: 9, y: 9, width: 6, height: 6, rx: 1, fill: 'currentColor', opacity: .5 }))

    return {
      inject: ['slots', 'layout'],
      apply(ctx) {
        // embed 模式（?pbembed=1）：shell 已只渲染真实对话主栏，插件唔注册看板、唔加隐藏 CSS
        if (new URLSearchParams(location.search).has('pbembed')) return
        // web 版文件夹按钮（reveal-in-folder 无桌面桥接）→ 改开右栏文件浏览
        const onDirClick = (e) => {
          const wrap = e.target.closest && e.target.closest('[data-open-target="directory"]')
          if (!wrap) return
          const btn = e.target.closest('button')
          if (!btn || btn.getAttribute('aria-haspopup') === 'menu') return
          e.preventDefault()
          e.stopPropagation()
          ctx.layout.openRightbar(true, false)
        }
        document.addEventListener('click', onDirClick, true)
        goChat = () => {
          // 切换到「对话」视图（放大聊天）：优先点击头部页签，回退 selectPanel
          try {
            const els = Array.from(document.querySelectorAll('button, [role="tab"], a'))
            const tab = els.find(e => (e.textContent || '').trim() === '对话' && e.offsetParent)
            if (tab) { tab.click(); return }
          } catch {}
          ctx.layout.selectPanel('conversation')
        }
        // 合二为一：看板作为对话默认视图，内含真实对话+输入；底部独立 composer/dock 于看板激活时隐藏
        ctx.slots.inject('conversation.view', () => ctx.slots.register({ name: 'conversation.view', id: 'project-board', order: -1, label: () => '看板' }, BoardPage))
      },
    }
  },
})
