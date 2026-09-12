import { createReadStream, existsSync } from 'node:fs'
import { readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { createInterface } from 'node:readline'
import { join } from 'node:path'
import { CACHE_DIR, CLAUDE_PROJECTS_DIR, ensureDirs } from './config.js'
import { costOf, normalizeModel, type UsageLike } from './pricing.js'

/**
 * Painel de custos sem banco de dados: os transcripts que o CLI já grava em
 * ~/.claude/projects/<projeto>/<sessão>.jsonl são a fonte da verdade.
 *
 * Reler 122 projetos a cada request é inviável, então o índice é incremental:
 * para cada arquivo guardamos o offset já lido e, na próxima varredura, lemos
 * apenas o que cresceu (jsonl é append-only). Arquivo que encolheu = releitura.
 */

const CACHE_FILE = join(CACHE_DIR, 'usage-index.json')
const CACHE_VERSION = 3

/** Números de um (dia × modelo). */
export interface Bucket {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  costUsd: number
  requests: number
}

interface FileEntry {
  /** Bytes já consumidos — offset da próxima leitura. */
  offset: number
  mtimeMs: number
  project: string
  sessionId: string
  cwd?: string
  gitBranch?: string
  title?: string
  firstTs?: number
  lastTs?: number
  userTurns: number
  /** dia (YYYY-MM-DD) → modelo → bucket */
  days: Record<string, Record<string, Bucket>>
  /** requestIds já contados, para não somar duas vezes numa releitura parcial. */
  seen: string[]
}

interface CacheShape {
  version: number
  files: Record<string, FileEntry>
}

let cache: CacheShape = { version: CACHE_VERSION, files: {} }
let loaded = false
let scanning: Promise<void> | null = null
let lastScan = 0

const emptyBucket = (): Bucket => ({
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  costUsd: 0,
  requests: 0,
})

export function dayKey(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/** `-home-user-code-app` → `/home/user/code/app` (heurística do CLI). */
function projectLabel(dirName: string): string {
  return dirName.replace(/^-/, '').replace(/-/g, '/')
}

async function loadCache() {
  if (loaded) return
  loaded = true
  ensureDirs()
  try {
    const raw = JSON.parse(await readFile(CACHE_FILE, 'utf8')) as CacheShape
    if (raw.version === CACHE_VERSION) cache = raw
  } catch {
    // sem cache ainda, ou versão velha: varre do zero
  }
}

async function saveCache() {
  try {
    await writeFile(CACHE_FILE, JSON.stringify(cache), 'utf8')
  } catch {
    // cache é otimização; falhar em gravar não pode derrubar o request
  }
}

function bucketFor(entry: FileEntry, day: string, model: string): Bucket {
  const byModel = (entry.days[day] ??= {})
  return (byModel[model] ??= emptyBucket())
}

/** Lê do offset em diante e acumula no entry. */
async function ingest(path: string, entry: FileEntry, start: number) {
  const stream = createReadStream(path, { encoding: 'utf8', start })
  const rl = createInterface({ input: stream, crlfDelay: Infinity })
  const seen = new Set(entry.seen)

  for await (const line of rl) {
    if (!line.trim()) continue
    let row: any
    try {
      row = JSON.parse(line)
    } catch {
      continue // linha parcial (escrita em voo) — a próxima varredura pega
    }

    if (row.sessionId && !entry.sessionId) entry.sessionId = row.sessionId
    if (row.cwd) entry.cwd = row.cwd
    if (row.gitBranch) entry.gitBranch = row.gitBranch
    if (row.type === 'ai-title' && typeof row.aiTitle === 'string') entry.title = row.aiTitle

    const ts = row.timestamp ? Date.parse(row.timestamp) : NaN
    if (Number.isFinite(ts)) {
      entry.firstTs = entry.firstTs ? Math.min(entry.firstTs, ts) : ts
      entry.lastTs = entry.lastTs ? Math.max(entry.lastTs, ts) : ts
    }

    if (row.type === 'user' && !row.isMeta && !row.isSidechain) {
      const c = row.message?.content
      entry.userTurns++
      if (!entry.title && typeof c === 'string' && c.trim()) entry.title = c.slice(0, 90)
    }

    if (row.type !== 'assistant') continue
    const usage: UsageLike | undefined = row.message?.usage
    if (!usage) continue

    // Um requestId pode reaparecer (retry, replay do transcript): conta uma vez.
    const key = row.requestId ?? row.message?.id ?? `${row.uuid ?? ''}`
    if (key) {
      if (seen.has(key)) continue
      seen.add(key)
    }

    const model = normalizeModel(row.message?.model)
    const day = dayKey(Number.isFinite(ts) ? new Date(ts) : new Date())
    const b = bucketFor(entry, day, model)
    b.input += usage.input_tokens ?? 0
    b.output += usage.output_tokens ?? 0
    b.cacheRead += usage.cache_read_input_tokens ?? 0
    b.cacheWrite += usage.cache_creation_input_tokens ?? 0
    b.costUsd += costOf(usage, row.message?.model)
    b.requests++
  }

  // Mantém a lista limitada: só os requestIds recentes importam para dedup.
  entry.seen = [...seen].slice(-4000)
}

async function scanOnce() {
  await loadCache()
  if (!existsSync(CLAUDE_PROJECTS_DIR)) return

  let dirs: string[] = []
  try {
    dirs = (await readdir(CLAUDE_PROJECTS_DIR, { withFileTypes: true }))
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
  } catch {
    return
  }

  const alive = new Set<string>()
  let touched = 0

  for (const dir of dirs) {
    const dirPath = join(CLAUDE_PROJECTS_DIR, dir)
    let files: string[]
    try {
      files = (await readdir(dirPath)).filter((f) => f.endsWith('.jsonl'))
    } catch {
      continue
    }

    for (const file of files) {
      const path = join(dirPath, file)
      alive.add(path)
      let st
      try {
        st = await stat(path)
      } catch {
        continue
      }

      const prev = cache.files[path]
      if (prev && prev.offset === st.size && prev.mtimeMs === st.mtimeMs) continue

      const shrank = prev && st.size < prev.offset
      const entry: FileEntry =
        prev && !shrank
          ? prev
          : {
              offset: 0,
              mtimeMs: 0,
              project: dir,
              sessionId: file.replace(/\.jsonl$/, ''),
              userTurns: 0,
              days: {},
              seen: [],
            }
      entry.project = dir
      entry.sessionId = file.replace(/\.jsonl$/, '')

      await ingest(path, entry, entry.offset)
      entry.offset = st.size
      entry.mtimeMs = st.mtimeMs
      cache.files[path] = entry
      touched++
    }
  }

  // Transcript apagado sai do índice.
  for (const path of Object.keys(cache.files)) if (!alive.has(path)) delete cache.files[path]

  if (touched) await saveCache()
  lastScan = Date.now()
}

/** Varre no máximo uma vez por `maxAgeMs`; chamadas concorrentes compartilham a mesma promessa. */
export async function refresh(maxAgeMs = 5000): Promise<void> {
  if (scanning) return scanning
  if (Date.now() - lastScan < maxAgeMs) return
  scanning = scanOnce().finally(() => {
    scanning = null
  })
  return scanning
}

export interface SessionRow {
  sessionId: string
  project: string
  projectPath: string
  cwd?: string
  gitBranch?: string
  title?: string
  firstTs?: number
  lastTs?: number
  userTurns: number
  costUsd: number
  tokens: number
  models: string[]
}

/** Uma linha por transcript, do mais recente para o mais antigo. */
export async function sessions(limit = 40, projectPath?: string): Promise<SessionRow[]> {
  await refresh()
  const rows: SessionRow[] = []
  for (const entry of Object.values(cache.files)) {
    let costUsd = 0
    let tokens = 0
    const models = new Set<string>()
    for (const byModel of Object.values(entry.days)) {
      for (const [model, b] of Object.entries(byModel)) {
        costUsd += b.costUsd
        tokens += b.input + b.output + b.cacheRead + b.cacheWrite
        if (b.requests) models.add(model)
      }
    }
    const path = entry.cwd ?? projectLabel(entry.project)
    if (projectPath && path !== projectPath) continue
    rows.push({
      sessionId: entry.sessionId,
      project: entry.project,
      projectPath: path,
      cwd: entry.cwd,
      gitBranch: entry.gitBranch,
      title: entry.title,
      firstTs: entry.firstTs,
      lastTs: entry.lastTs,
      userTurns: entry.userTurns,
      costUsd,
      tokens,
      models: [...models],
    })
  }
  rows.sort((a, b) => (b.lastTs ?? 0) - (a.lastTs ?? 0))
  return rows.slice(0, limit)
}

export interface WindowTotals {
  from: string
  costUsd: number
  tokens: number
  requests: number
  byModel: Array<{ model: string; costUsd: number; tokens: number }>
}

export interface CostReport {
  /** Série contínua (sem buracos) do mais antigo ao mais novo. */
  daily: Array<{ day: string; costUsd: number; tokens: number; requests: number }>
  byModel: Array<{ model: string; costUsd: number; tokens: number; requests: number }>
  byProject: Array<{ project: string; projectPath: string; costUsd: number; tokens: number; sessions: number }>
  totals: { costUsd: number; tokens: number; requests: number; sessions: number }
  today: { costUsd: number; tokens: number; requests: number }
  /** Janelas de calendário: semana começa na segunda, mês no dia 1. */
  windows: {
    today: WindowTotals
    week: WindowTotals
    month: WindowTotals
  }
  /** Custo dos 7 dias anteriores aos últimos 7, para o delta do stat tile. */
  last7: { costUsd: number; prev7: number }
  scannedFiles: number
  generatedAt: number
}

export async function costs(days = 30): Promise<CostReport> {
  await refresh()

  const today = dayKey(new Date())
  const horizon = new Date()
  horizon.setDate(horizon.getDate() - (days - 1))
  const from = dayKey(horizon)

  const daily = new Map<string, { costUsd: number; tokens: number; requests: number }>()
  const byModel = new Map<string, { costUsd: number; tokens: number; requests: number }>()
  const byProject = new Map<string, { projectPath: string; costUsd: number; tokens: number; sessions: number }>()
  const totals = { costUsd: 0, tokens: 0, requests: 0, sessions: 0 }

  // Janelas de 7 dias para o delta.
  const d7 = new Date()
  d7.setDate(d7.getDate() - 6)
  const from7 = dayKey(d7)
  const d14 = new Date()
  d14.setDate(d14.getDate() - 13)
  const from14 = dayKey(d14)
  let cost7 = 0
  let prev7 = 0

  // Janelas de calendário (dia/semana/mês) — o que o usuário chama de "gasto do mês".
  const monday = new Date()
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7))
  const first = new Date()
  first.setDate(1)
  const windows: CostReport['windows'] = {
    today: { from: today, costUsd: 0, tokens: 0, requests: 0, byModel: [] },
    week: { from: dayKey(monday), costUsd: 0, tokens: 0, requests: 0, byModel: [] },
    month: { from: dayKey(first), costUsd: 0, tokens: 0, requests: 0, byModel: [] },
  }
  const winModels: Record<'today' | 'week' | 'month', Map<string, { costUsd: number; tokens: number }>> = {
    today: new Map(),
    week: new Map(),
    month: new Map(),
  }
  const addWindow = (k: 'today' | 'week' | 'month', model: string, b: Bucket, tokens: number) => {
    windows[k].costUsd += b.costUsd
    windows[k].tokens += tokens
    windows[k].requests += b.requests
    const m = winModels[k].get(model) ?? { costUsd: 0, tokens: 0 }
    m.costUsd += b.costUsd
    m.tokens += tokens
    winModels[k].set(model, m)
  }

  for (const entry of Object.values(cache.files)) {
    const path = entry.cwd ?? projectLabel(entry.project)
    let inWindow = false

    for (const [day, models] of Object.entries(entry.days)) {
      for (const [model, b] of Object.entries(models)) {
        if (model === '<synthetic>' || model === 'unknown') continue // linhas sem chamada real de modelo
        const tokens = b.input + b.output + b.cacheRead + b.cacheWrite
        if (day >= from7) cost7 += b.costUsd
        else if (day >= from14) prev7 += b.costUsd
        if (day === today) addWindow('today', model, b, tokens)
        if (day >= windows.week.from) addWindow('week', model, b, tokens)
        if (day >= windows.month.from) addWindow('month', model, b, tokens)
        if (day < from) continue
        inWindow = true

        const d = daily.get(day) ?? { costUsd: 0, tokens: 0, requests: 0 }
        d.costUsd += b.costUsd
        d.tokens += tokens
        d.requests += b.requests
        daily.set(day, d)

        const m = byModel.get(model) ?? { costUsd: 0, tokens: 0, requests: 0 }
        m.costUsd += b.costUsd
        m.tokens += tokens
        m.requests += b.requests
        byModel.set(model, m)

        const p = byProject.get(entry.project) ?? { projectPath: path, costUsd: 0, tokens: 0, sessions: 0 }
        p.costUsd += b.costUsd
        p.tokens += tokens
        byProject.set(entry.project, p)

        totals.costUsd += b.costUsd
        totals.tokens += tokens
        totals.requests += b.requests
      }
    }
    if (inWindow) {
      totals.sessions++
      const p = byProject.get(entry.project)
      if (p) p.sessions++
    }
  }

  // Série densa: dias sem gasto precisam existir como zero para o sparkline não mentir.
  const series: CostReport['daily'] = []
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date()
    d.setDate(d.getDate() - i)
    const key = dayKey(d)
    series.push({ day: key, ...(daily.get(key) ?? { costUsd: 0, tokens: 0, requests: 0 }) })
  }

  for (const k of ['today', 'week', 'month'] as const) {
    windows[k].byModel = [...winModels[k].entries()].map(([model, v]) => ({ model, ...v })).sort((a, b) => b.costUsd - a.costUsd)
  }

  return {
    daily: series,
    windows,
    byModel: [...byModel.entries()]
      .map(([model, v]) => ({ model, ...v }))
      .sort((a, b) => b.costUsd - a.costUsd),
    byProject: [...byProject.entries()]
      .map(([project, v]) => ({ project, ...v }))
      .sort((a, b) => b.costUsd - a.costUsd),
    totals,
    today: daily.get(today) ?? { costUsd: 0, tokens: 0, requests: 0 },
    last7: { costUsd: cost7, prev7 },
    scannedFiles: Object.keys(cache.files).length,
    generatedAt: Date.now(),
  }
}
