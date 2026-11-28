/** SPD-009：领域模板注册表 + PDF 文本解析（best-effort，无外部依赖）。 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { inflateSync } from 'node:zlib'

export const TEMPLATES = {
  default: { modRoots: ['src', 'lib', 'packages', 'app'], doc: true, test: true, todo: true },
  'web-app': { modRoots: ['src', 'app', 'components', 'pages'], doc: true, test: true, todo: true },
  library: { modRoots: ['lib', 'src'], doc: true, test: true, todo: false },
  docs: { modRoots: [], doc: true, test: false, todo: false },
}

export function detectTemplate(root) {
  try {
    const p = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
    const d = { ...p.dependencies, ...p.devDependencies }
    if (d.react || d.next || d.vue || d.svelte) return 'web-app'
    if (p.main || p.module || p.exports) return 'library'
  } catch {}
  let md = 0
  try { md = readdirSync(root).filter(f => /\.md$/i.test(f)).length } catch {}
  if (md >= 5) return 'docs'
  return 'default'
}

/** 提取 PDF 文本：stream（FlateDecode 用 zlib 解压）→ Tj/TJ 操作数。best-effort。 */
export function pdfText(buf) {
  const s = buf.toString('latin1')
  const out = []
  const re = /stream\r?\n/g
  let m
  while ((m = re.exec(s))) {
    const start = m.index + m[0].length
    const end = s.indexOf('endstream', start)
    if (end < 0) continue
    const data = buf.subarray(start, end)
    let txt
    try { txt = inflateSync(data).toString('latin1') } catch { txt = data.toString('latin1') }
    for (const x of txt.matchAll(/\(((?:[^()\\]|\\.)*)\)\s*Tj/g)) out.push(x[1])
    for (const x of txt.matchAll(/\[((?:[^\[\]\\]|\\.)*)\]\s*TJ/g)) out.push([...x[1].matchAll(/\(((?:[^()\\]|\\.)*)\)/g)].map(y => y[1]).join(''))
    re.lastIndex = end
  }
  return out.join('\n').replace(/\\([()\\])/g, '$1')
}

/** 扫描 PDF → 任务（每文件按提取行拆，无文本则单任务）。 */
export function pdfTasks(root) {
  const tasks = []
  const walk = (rel, depth) => {
    if (depth > 3) return
    let es = []
    try { es = readdirSync(join(root, rel)) } catch { return }
    for (const e of es) {
      if (e === 'node_modules' || e === '.git' || e === 'dist') continue
      const r = rel ? rel + '/' + e : e
      const p = join(root, r)
      try {
        if (statSync(p).isDirectory()) walk(r, depth + 1)
        else if (/\.pdf$/i.test(e)) {
          const lines = pdfText(readFileSync(p)).split('\n').map(x => x.trim()).filter(x => x.length > 3).slice(0, 20)
          if (lines.length) lines.forEach(ln => tasks.push({ title: 'PDF ' + e + ' · ' + ln.slice(0, 30), scope: [r], est: 5 }))
          else tasks.push({ title: 'PDF ' + e, scope: [r], est: 5 })
        }
      } catch {}
    }
  }
  walk('', 0)
  return tasks
}