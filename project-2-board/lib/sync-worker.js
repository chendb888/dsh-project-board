/** 全量同步 worker： off-main-thread 执行 autoSync，避免阻塞 host 主线程。 */
import { parentPort, workerData } from 'node:worker_threads'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { autoSync } from './auto.js'

const cwd = workerData && workerData.cwd
try {
  const p = join(cwd, '.dsh-project', 'blueprint.json')
  if (!existsSync(p)) { parentPort.postMessage({ statuses: null, changed: 0 }); }
  else {
    const bp = JSON.parse(readFileSync(p, 'utf8'))
    const changed = autoSync(cwd, bp)
    if (changed) writeFileSync(p, JSON.stringify(bp, null, 2) + '\n', 'utf8')
    const statuses = {}
    for (const t of bp.tasks || []) statuses[t.id] = t.status
    parentPort.postMessage({ statuses, changed })
  }
} catch (e) {
  parentPort.postMessage({ statuses: null, changed: 0, error: String(e && e.message || e) })
}