import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { readdir, stat } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'
import { promisify } from 'node:util'
import { ACTIVITY_STALE_HOURS, WORKTREES_DIR } from './config.js'
import { expandHome, kbConfig, plans, type PlanRow } from './harness.js'
import * as herdr from './herdr.js'
import * as usage from './usage.js'

/**
 * Atividade inferida por plano. O servidor nunca grava estado: cruza pelo cwd o
 * que já existe — agentes do herdr, sessões do Jarvis, transcripts do CLI,
 * worktrees e git. Cada fonte falha sozinha (lista vazia) e o estado sai do que
 * sobrou. Tudo numa passada para todos os planos, com cache curto.
 */

const exec = promisify(execFile)

export type ActivityState = 'working' | 'waiting-human' | 'idle' | 'done' | 'quiet' | 'stale'

export interface ActivitySummary {
  state: ActivityState
  since: number | null
  reason: string
}

/** Recorte da sessão do Jarvis que interessa aqui (o manager mora no server). */
export interface SessionLike {
  id: string
  state: string
  title: string
  cwd: string
  live: boolean
  pendingPermissions: number
  updatedAt: number
}

export interface Activity extends ActivitySummary {
  herdr: boolean
  waiting: string[]
  agents: Array<{ paneId: string; status: string; title: string; cwd: string; sessionId?: string; task?: string }>
  sessions: Array<{ id: string; state: string; title: string; cwd: string; live: boolean; pendingPermissions: number; task?: string }>
  cli: Array<{ sessionId: string; cwd: string; lastTs?: number; title?: string; task?: string }>
  tasks: Array<{
    id: string
    status: string
    branch?: string
    worktree?: string
    worktreeExists: boolean
    branchExists: boolean
    merged: boolean
    lastCommitTs: number | null
    agents: number
    sessions: number
  }>
  lastExecution: PlanRow['lastExecution'] | null
}

let sessionSource: () => SessionLike[] = () => []

/** O server registra de onde vêm as sessões do Jarvis (`manager.list()`). */
export function useSessions(fn: () => SessionLike[]) {
  sessionSource = fn
}

const CLI_WINDOW_MS = 7 * 24 * 3600_000
const CACHE_MS = 5_000
const GIT_TIMEOUT = 3_000

const key = (vault: string, slug: string) => `${vault}/${slug}`
const under = (cwd: string, p: string) => cwd === p || cwd.startsWith(p + sep)

async function git(cwd: string, args: string[]): Promise<string | null> {
  try {
    return (await exec('git', args, { cwd, timeout: GIT_TIMEOUT })).stdout
  } catch {
    return null
  }
}

/** Fonte por repo: assuntos da main e branches locais (uma chamada de cada). */
interface RepoGit {
  subjects: string[]
  branches: Set<string>
}

async function repoGit(path: string): Promise<RepoGit> {
  const [log, branches] = await Promise.all([
    git(path, ['log', '-n', '300', '--format=%s%x00%ct', 'main']),
    git(path, ['branch', '--list', '--format=%(refname:short)']),
  ])
  return {
    subjects: (log ?? '').split('\n').filter(Boolean).map((l) => l.split('\0')[0]),
    branches: new Set((branches ?? '').split('\n').map((b) => b.trim()).filter(Boolean)),
  }
}

async function taskMtimes(planDir: string): Promise<number> {
  try {
    const dir = join(planDir, 'tasks')
    const files = (await readdir(dir)).filter((f) => f.endsWith('.md'))
    const times = await Promise.all(files.map((f) => stat(join(dir, f)).then((s) => s.mtimeMs).catch(() => 0)))
    return Math.max(0, ...times)
  } catch {
    return 0
  }
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

export function age(ms: number): string {
  const min = Math.max(0, Math.floor(ms / 60_000))
  if (min < 60) return `${min} min`
  const h = Math.floor(min / 60)
  if (h < 48) return `${h} h`
  return `${Math.floor(h / 24)} d`
}

async function compute(): Promise<Map<string, Activity>> {
  const now = Date.now()
  const [rows, cfg, agents, cli] = await Promise.all([
    plans(true).catch(() => [] as PlanRow[]),
    kbConfig(),
    herdr.agents().catch(() => []),
    usage.sessions(10_000).catch(() => []),
  ])
  let sessions: SessionLike[] = []
  try {
    sessions = sessionSource()
  } catch {
    sessions = []
  }
  const recentCli = cli.filter((r) => r.cwd && r.lastTs && now - r.lastTs < CLI_WINDOW_MS)
  const repoPath = (name?: string) => cfg.projects.find((p) => p.name === name)?.path

  // git: uma passada por repo distinto.
  const repoNames = new Set<string>()
  for (const p of rows) {
    for (const name of p.projects) repoNames.add(name)
    for (const t of p.tasks) if (t.repo) repoNames.add(t.repo)
  }
  const gitByRepo = new Map<string, RepoGit>()
  await Promise.all(
    [...repoNames].map(async (name) => {
      const path = repoPath(name)
      if (path && existsSync(path)) gitByRepo.set(name, await repoGit(path))
    }),
  )

  const out = new Map<string, Activity>()
  await Promise.all(
    rows.map(async (p) => {
      out.set(key(p.vault, p.slug), await forPlan(p, { now, agents, sessions, cli: recentCli, gitByRepo, repoPath }))
    }),
  )
  return out
}

interface Sources {
  now: number
  agents: herdr.HerdrAgent[]
  sessions: SessionLike[]
  cli: usage.SessionRow[]
  gitByRepo: Map<string, RepoGit>
  repoPath: (name?: string) => string | undefined
}

async function forPlan(p: PlanRow, src: Sources): Promise<Activity> {
  const planRepo = p.projects[0]
  const planPaths = [
    ...p.projects.map((n) => src.repoPath(n)).filter((x): x is string => Boolean(x)),
    ...(p.worktree ? [resolve(expandHome(p.worktree))] : []),
  ]
  const taskPaths = p.tasks
    .filter((t) => t.branch)
    .map((t) => ({ id: t.id, path: join(WORKTREES_DIR, `${t.repo ?? planRepo}-${t.branch}`) }))

  /** undefined = não é do plano; { task } = é, com ou sem task. */
  const attribute = (cwd?: string): { task?: string } | undefined => {
    if (!cwd) return undefined
    const t = taskPaths.find((x) => under(cwd, x.path))
    if (t) return { task: t.id }
    return planPaths.some((x) => under(cwd, x)) ? {} : undefined
  }

  const agents: Activity['agents'] = []
  for (const a of src.agents) {
    const m = attribute(a.cwd)
    if (m) agents.push({ paneId: a.paneId, status: a.status, title: a.title, cwd: a.cwd, sessionId: a.sessionId, ...m })
  }
  const sessions: Activity['sessions'] = []
  for (const s of src.sessions) {
    const m = attribute(s.cwd)
    // gravada só entra se mexeu na janela do CLI; viva sempre.
    if (m && (s.live || src.now - s.updatedAt < CLI_WINDOW_MS))
      sessions.push({ id: s.id, state: s.state, title: s.title, cwd: s.cwd, live: s.live, pendingPermissions: s.pendingPermissions, ...m })
  }
  const cli: Activity['cli'] = []
  for (const r of src.cli) {
    const m = attribute(r.cwd)
    if (m) cli.push({ sessionId: r.sessionId, cwd: r.cwd!, lastTs: r.lastTs, title: r.title, ...m })
  }

  const tasks: Activity['tasks'] = await Promise.all(
    p.tasks.map(async (t) => {
      const repo = t.repo ?? planRepo
      const g = repo ? src.gitByRepo.get(repo) : undefined
      const worktree = taskPaths.find((x) => x.id === t.id)?.path
      const worktreeExists = Boolean(worktree && existsSync(worktree))
      const re = new RegExp(`^(merge )?${escapeRe(t.id)}\\(${escapeRe(p.slug)}\\)`)
      let lastCommitTs: number | null = null
      if (worktree && worktreeExists) {
        const ct = Number((await git(worktree, ['log', '-1', '--format=%ct']))?.trim())
        if (ct) lastCommitTs = ct * 1000
      }
      return {
        id: t.id,
        status: t.status,
        branch: t.branch,
        worktree,
        worktreeExists,
        branchExists: Boolean(t.branch && g?.branches.has(t.branch)),
        merged: Boolean(g?.subjects.some((s) => re.test(s))),
        lastCommitTs,
        agents: agents.filter((a) => a.task === t.id).length,
        sessions: sessions.filter((s) => s.task === t.id).length,
      }
    }),
  )

  const waiting: string[] = []
  for (const t of p.tasks) if (t.gate === 'human' && t.status !== 'done') waiting.push(`aguardando aprovação do ${t.id}`)
  if (p.status === 'ready-for-review') waiting.push('plano aguardando aprovação')
  for (const t of p.tasks) if (t.status === 'review') waiting.push(`${t.id} em review`)
  for (const s of sessions) if (s.live && s.pendingPermissions > 0) waiting.push(`permissão pendente em ${s.title || s.id}`)

  const signals = [
    p.lastExecution?.ts ?? 0,
    ...cli.map((c) => c.lastTs ?? 0),
    await taskMtimes(p.path),
    ...tasks.map((t) => t.lastCommitTs ?? 0),
  ]
  const last = Math.max(0, ...signals) || p.mtime || 0
  const since = last ? Math.round(last) : null

  const where = (task?: string) => (task ? `em ${task}` : 'no repo')
  const liveSessions = sessions.filter((s) => s.live && !['closed', 'error', 'handed-off'].includes(s.state))
  // No reason, quem está numa task diz mais do que quem está no repo.
  const pick = <T extends { task?: string }>(xs: T[]) => xs.find((x) => x.task) ?? xs[0]
  const workingAgent = pick(agents.filter((a) => a.status === 'working'))
  const runningSession = pick(liveSessions.filter((s) => s.state === 'running'))

  let state: ActivityState
  let reason: string
  if (workingAgent) {
    state = 'working'
    reason = `agente trabalhando ${where(workingAgent.task)} (${workingAgent.paneId})`
  } else if (runningSession) {
    state = 'working'
    reason = `sessão trabalhando ${where(runningSession.task)}`
  } else if (waiting.length) {
    state = 'waiting-human'
    reason = waiting[0]
  } else if (agents.length) {
    state = 'idle'
    reason = `agente ocioso ${where(pick(agents).task)}`
  } else if (liveSessions.length) {
    state = 'idle'
    reason = `sessão ociosa ${where(pick(liveSessions).task)}`
  } else if (p.status === 'done') {
    state = 'done'
    reason = 'concluído'
  } else if (last && src.now - last < ACTIVITY_STALE_HOURS * 3600_000) {
    state = 'quiet'
    reason = `último sinal há ${age(src.now - last)}`
  } else {
    state = 'stale'
    reason = last ? `parado há ${age(src.now - last)}` : 'sem sinal'
  }

  return {
    state,
    since,
    reason,
    herdr: herdr.available(),
    waiting,
    agents,
    sessions,
    cli,
    tasks,
    lastExecution: p.lastExecution ?? null,
  }
}

let cache: { at: number; value: Promise<Map<string, Activity>> } | null = null

function all(): Promise<Map<string, Activity>> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.value
  const value = compute()
  cache = { at: Date.now(), value }
  value.catch(() => {
    cache = null
  })
  return value
}

export const summary = (a: Activity): ActivitySummary => ({ state: a.state, since: a.since, reason: a.reason })

/** Atividade de todos os `rows`, calculada numa passada só. */
export async function activities(rows: PlanRow[]): Promise<Map<string, Activity>> {
  const map = await all()
  const out = new Map<string, Activity>()
  for (const p of rows) {
    const a = map.get(key(p.vault, p.slug))
    if (a) out.set(key(p.vault, p.slug), a)
  }
  return out
}

/** Atividade de um plano; null quando o plano não existe. */
export async function activity(vault: string, slug: string): Promise<Activity | null> {
  return (await all()).get(key(vault, slug)) ?? null
}
