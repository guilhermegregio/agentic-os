import { appendFile, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { SESSIONS_DIR, ensureDirs } from './config.js'
import { emptyTally, type Tally } from './pricing.js'

/**
 * Persistência local em arquivos, sem banco:
 *
 *   <data>/sessions/index.json          índice (uma linha de metadado por sessão)
 *   <data>/sessions/<id>/meta.json      metadado canônico da sessão
 *   <data>/sessions/<id>/events.jsonl   todo evento que a UI recebeu (append-only)
 *
 * O índice é derivado — se ele se perder, `rebuild()` o reconstrói a partir dos
 * meta.json. Os eventos ficam em jsonl porque a escrita é sempre no fim e a
 * leitura é sequencial com `since`: é o formato que casa com o uso.
 */

export interface SessionMeta {
  id: string
  sdkSessionId?: string
  title: string
  cwd: string
  model?: string
  lastModel?: string
  permissionMode: string
  state: string
  createdAt: number
  updatedAt: number
  turns: number
  tally: Tally
  contextTokens: number
  contextWindow: number
  /** Último `seq` gravado — o replay do disco usa isso. */
  lastSeq: number
  resumeOf?: string
  archived?: boolean
}

const metas = new Map<string, SessionMeta>()
/** Ids apagados: um `saveMeta` atrasado (timer de debounce) não pode ressuscitá-los. */
const removed = new Set<string>()
const writeQueues = new Map<string, Promise<void>>()
let indexTimer: NodeJS.Timeout | null = null
let booted = false

const dirOf = (id: string) => join(SESSIONS_DIR, id)

export async function boot() {
  if (booted) return
  booted = true
  ensureDirs()
  try {
    const raw = JSON.parse(await readFile(join(SESSIONS_DIR, 'index.json'), 'utf8'))
    for (const m of raw.sessions ?? []) metas.set(m.id, normalize(m))
  } catch {
    await rebuild()
  }
}

function normalize(m: Partial<SessionMeta>): SessionMeta {
  return {
    id: m.id!,
    sdkSessionId: m.sdkSessionId,
    title: m.title ?? 'sessão',
    cwd: m.cwd ?? '',
    model: m.model,
    lastModel: m.lastModel,
    permissionMode: m.permissionMode ?? 'default',
    // Uma sessão viva no processo anterior está morta agora: o processo caiu com ela.
    state: m.state === 'running' || m.state === 'starting' || m.state === 'queued' ? 'closed' : (m.state ?? 'closed'),
    createdAt: m.createdAt ?? Date.now(),
    updatedAt: m.updatedAt ?? m.createdAt ?? Date.now(),
    turns: m.turns ?? 0,
    tally: { ...emptyTally(), ...(m.tally ?? {}) },
    contextTokens: m.contextTokens ?? 0,
    contextWindow: m.contextWindow ?? 200_000,
    lastSeq: m.lastSeq ?? 0,
    resumeOf: m.resumeOf,
    archived: m.archived,
  }
}

/** Reconstrói o índice varrendo os meta.json (recuperação). */
export async function rebuild() {
  ensureDirs()
  metas.clear()
  let dirs: string[] = []
  try {
    dirs = (await readdir(SESSIONS_DIR, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name)
  } catch {
    return
  }
  for (const id of dirs) {
    try {
      metas.set(id, normalize(JSON.parse(await readFile(join(dirOf(id), 'meta.json'), 'utf8'))))
    } catch {
      // diretório sem meta legível: ignora
    }
  }
  await flushIndex()
}

async function flushIndex() {
  const sessions = [...metas.values()].sort((a, b) => b.updatedAt - a.updatedAt)
  const tmp = join(SESSIONS_DIR, 'index.json.tmp')
  const final = join(SESSIONS_DIR, 'index.json')
  try {
    await writeFile(tmp, JSON.stringify({ version: 1, sessions }), 'utf8')
    // rename é atômico: o índice nunca é lido pela metade
    const { rename } = await import('node:fs/promises')
    await rename(tmp, final)
  } catch {
    // índice é derivado; perder uma gravação é recuperável via rebuild()
  }
}

function scheduleIndex() {
  if (indexTimer) return
  indexTimer = setTimeout(() => {
    indexTimer = null
    void flushIndex()
  }, 400)
}

/** Enfileira uma escrita por sessão para os appends não se cruzarem. */
function enqueue(id: string, job: () => Promise<void>) {
  const prev = writeQueues.get(id) ?? Promise.resolve()
  const next = prev.then(job).catch(() => {})
  writeQueues.set(id, next)
  return next
}

export async function saveMeta(meta: SessionMeta) {
  if (removed.has(meta.id)) return
  metas.set(meta.id, meta)
  scheduleIndex()
  await enqueue(meta.id, async () => {
    await mkdir(dirOf(meta.id), { recursive: true })
    await writeFile(join(dirOf(meta.id), 'meta.json'), JSON.stringify(meta, null, 2), 'utf8')
  })
}

export function getMeta(id: string): SessionMeta | undefined {
  return metas.get(id)
}

export function listMeta(): SessionMeta[] {
  return [...metas.values()].sort((a, b) => b.updatedAt - a.updatedAt)
}

export function appendEvents(id: string, lines: unknown[]) {
  if (!lines.length) return
  const payload = lines.map((l) => JSON.stringify(l)).join('\n') + '\n'
  void enqueue(id, async () => {
    await mkdir(dirOf(id), { recursive: true })
    await appendFile(join(dirOf(id), 'events.jsonl'), payload, 'utf8')
  })
}

/** Replay do disco: eventos com `seq > since`. */
export async function readEvents(id: string, since = 0): Promise<any[]> {
  try {
    const text = await readFile(join(dirOf(id), 'events.jsonl'), 'utf8')
    const out: any[] = []
    for (const line of text.split('\n')) {
      if (!line) continue
      try {
        const e = JSON.parse(line)
        if ((e.seq ?? 0) > since) out.push(e)
      } catch {
        continue
      }
    }
    return out
  } catch {
    return []
  }
}

export async function removeSession(id: string) {
  removed.add(id)
  metas.delete(id)
  scheduleIndex()
  await enqueue(id, async () => {
    await rm(dirOf(id), { recursive: true, force: true })
  })
}

export async function archiveSession(id: string, archived = true) {
  const m = metas.get(id)
  if (!m) return false
  await saveMeta({ ...m, archived, updatedAt: Date.now() })
  return true
}
