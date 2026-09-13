import { execFile } from 'node:child_process'
import { readdir, readFile, stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, isAbsolute, join, resolve, sep } from 'node:path'
import { promisify } from 'node:util'
import { KB_CONFIG, KB_STATE_DIR } from './config.js'

/**
 * Leitor do harness `kb`: projetos/grupos/vaults registrados e os planos do
 * devflow. Tudo vem de arquivo — a config em ~/.config/kb/config.json, os planos
 * em <vault>/30-plans/<slug>/ — em vez de fazer shell-out no CLI e parsear texto.
 * Exceção: `git` para o estado do repo, que não tem como sair de arquivo.
 */

const exec = promisify(execFile)

// ---------------------------------------------------------------------------
// Frontmatter — mini-parser no mesmo espírito do engine do kb (regex, sem YAML)
// ---------------------------------------------------------------------------

export type FmValue = string | string[] | boolean | null

export function parseFrontmatter(text: string): { fm: Record<string, FmValue>; body: string } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text)
  if (!m) return { fm: {}, body: text }
  const fm: Record<string, FmValue> = {}
  let listKey: string | null = null

  for (const raw of m[1].split(/\r?\n/)) {
    const item = /^\s+-\s+(.*)$/.exec(raw)
    if (item && listKey) {
      const arr = (fm[listKey] ??= []) as string[]
      if (Array.isArray(arr)) arr.push(unquote(item[1]))
      continue
    }
    const kv = /^([A-Za-z0-9_.-]+):\s*(.*)$/.exec(raw)
    if (!kv) continue
    const [, key, rest] = kv
    if (!rest.trim()) {
      listKey = key
      fm[key] = []
      continue
    }
    listKey = null
    const value = rest.trim()
    if (value.startsWith('[')) {
      fm[key] = value
        .replace(/^\[|\]$/g, '')
        .split(',')
        .map((s) => unquote(s))
        .filter(Boolean)
    } else if (value === 'true' || value === 'false') {
      fm[key] = value === 'true'
    } else if (value === 'null' || value === '~') {
      fm[key] = null
    } else {
      fm[key] = unquote(value)
    }
  }
  return { fm, body: text.slice(m[0].length) }
}

/** Tira aspas e o comentário inline (`valor   # nota`) que o template do kb usa. */
const unquote = (s: string) => {
  const t = s.trim()
  if (/^["']/.test(t)) return t.replace(/^["']([^"']*)["'].*$/, '$1').trim()
  return t.replace(/\s+#.*$/, '').trim()
}
const asStr = (v: FmValue | undefined) => (typeof v === 'string' ? v : undefined)
const asArr = (v: FmValue | undefined) => (Array.isArray(v) ? v : typeof v === 'string' && v ? [v] : [])

// ---------------------------------------------------------------------------
// Config do kb
// ---------------------------------------------------------------------------

export interface KbVault {
  name: string
  path: string
  visibility: string
  default?: boolean
}
export interface KbProject {
  name: string
  path: string
  monorepo?: boolean
  subprojects?: Array<{ name: string; subpath: string }>
}
export interface KbGroup {
  name: string
  title?: string
  members: string[]
}
export interface KbConfig {
  vaults: KbVault[]
  projects: KbProject[]
  groups: KbGroup[]
}

let configCache: { at: number; value: KbConfig } | null = null

/** Descarta o cache da config — quem acabou de escrever nela quer ver o resultado já. */
export function invalidateConfig() {
  configCache = null
}

export async function kbConfig(): Promise<KbConfig> {
  if (configCache && Date.now() - configCache.at < 10_000) return configCache.value
  let value: KbConfig = { vaults: [], projects: [], groups: [] }
  try {
    const raw = JSON.parse(await readFile(KB_CONFIG, 'utf8'))
    value = {
      vaults: raw.vaults ?? [],
      projects: raw.projects ?? [],
      groups: raw.groups ?? [],
    }
  } catch {
    // sem harness kb instalado: o jarvis continua funcionando sem projetos
  }
  configCache = { at: Date.now(), value }
  return value
}

// ---------------------------------------------------------------------------
// Projetos (para abrir sessão em outro cwd)
// ---------------------------------------------------------------------------

export interface ProjectRow {
  name: string
  path: string
  exists: boolean
  monorepo: boolean
  subprojects: Array<{ name: string; path: string }>
  groups: string[]
  /** Vault onde o conhecimento deste projeto mora, se houver plano apontando. */
  git?: { branch: string; dirty: number; ahead: number }
  hasClaudeMd: boolean
  hasGraph: boolean
}

async function gitInfo(path: string): Promise<ProjectRow['git']> {
  if (!existsSync(join(path, '.git'))) return undefined
  try {
    const [branch, status] = await Promise.all([
      exec('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: path, timeout: 3000 }),
      exec('git', ['status', '--porcelain', '--branch'], { cwd: path, timeout: 3000 }),
    ])
    const lines = status.stdout.split('\n').filter(Boolean)
    const head = lines.find((l) => l.startsWith('##')) ?? ''
    const ahead = Number(/ahead (\d+)/.exec(head)?.[1] ?? 0)
    return {
      branch: branch.stdout.trim(),
      dirty: lines.filter((l) => !l.startsWith('##')).length,
      ahead,
    }
  } catch {
    return undefined
  }
}

export async function projects(withGit = true): Promise<ProjectRow[]> {
  const cfg = await kbConfig()
  const groupsOf = (name: string) =>
    cfg.groups.filter((g) => g.members.some((m) => m === name || m.startsWith(`${name}#`))).map((g) => g.name)

  const rows = await Promise.all(
    cfg.projects.map(async (p): Promise<ProjectRow> => {
      const exists = existsSync(p.path)
      return {
        name: p.name,
        path: p.path,
        exists,
        monorepo: Boolean(p.monorepo),
        subprojects: (p.subprojects ?? []).map((s) => ({ name: s.name, path: join(p.path, s.subpath) })),
        groups: groupsOf(p.name),
        git: exists && withGit ? await gitInfo(p.path) : undefined,
        hasClaudeMd: exists && existsSync(join(p.path, 'CLAUDE.md')),
        hasGraph: exists && existsSync(join(p.path, 'graphify-out')),
      }
    }),
  )
  return rows.sort((a, b) => a.name.localeCompare(b.name))
}

// ---------------------------------------------------------------------------
// Planos do devflow
// ---------------------------------------------------------------------------

export interface PlanTask {
  id: string
  title: string
  status: string
  dependsOn: string[]
  repo?: string
  branch?: string
  gates: string[]
  gate?: string
  stage?: string
  scope: string[]
  /** true quando status=todo e todas as dependências estão done. */
  ready: boolean
}

export interface PlanRow {
  slug: string
  vault: string
  visibility: string
  title: string
  status: string
  projects: string[]
  groups: string[]
  stack: string[]
  created?: string
  updated?: string
  /** Progresso: tasks estruturadas quando existem; senão, checkboxes do corpo. */
  progress: { done: number; total: number; source: 'tasks' | 'checkboxes' }
  tasks: PlanTask[]
  ready: string[]
  /** Gates humanos (⛔) ainda abertos, pelo texto do plano. */
  openGates: number
  frozen: Array<{ file: string; frozenAt?: string }>
  contracts: string[]
  /**
   * `contracts` resolvidos: path absoluto, existência e `legacy` (fora do vault).
   * `warning` é o aviso textual para contrato legado ou ausente.
   */
  contractFiles: Array<ResolvedContract & { warning?: string }>
  /** URL do protótipo (frontmatter `prototype_url`), se o plano tem gate de layout. */
  prototypeUrl?: string
  worktree?: string
  approvedBy?: string
  /** Estado das tasks-gate humanas (TP = layout, TB = contrato). */
  gates: Array<{ id: string; stage?: string; status: string }>
  lastExecution?: { day: string; ts: number }
  mtime: number
  path: string
}

interface FrozenEntry {
  plan: string
  vault: string
  file: string
  sha?: string
  frozen_at?: string
}

async function frozenContracts(): Promise<FrozenEntry[]> {
  try {
    const raw = JSON.parse(await readFile(join(KB_STATE_DIR, 'frozen-contracts.json'), 'utf8'))
    return raw.entries ?? []
  } catch {
    return []
  }
}

export interface ResolvedContract {
  /** Entrada como está no `contracts:` do plano. */
  file: string
  /** Path absoluto resolvido (o primeiro candidato quando nenhum existe). */
  path: string
  exists: boolean
  /** true quando resolveu fora de `<vault>/10-projects/` (repo ou worktree — legado). */
  legacy: boolean
}

const expandHome = (p: string) => (p.startsWith('~/') ? join(homedir(), p.slice(2)) : p === '~' ? homedir() : p)

/**
 * Resolve uma entrada de `contracts:`. Relativa: casa do projeto no vault do plano
 * (`<vault>/10-projects/<entrada>`) primeiro; depois repo do projeto e worktree do
 * plano, que são o layout legado. Absoluta ou `~`: usada como está.
 */
export function resolveContract(vaultPath: string, entry: string, repoPath?: string, worktree?: string): ResolvedContract {
  const home = resolve(vaultPath, '10-projects')
  const candidates =
    isAbsolute(entry) || entry.startsWith('~')
      ? [resolve(expandHome(entry))]
      : [
          join(home, entry),
          ...(repoPath ? [resolve(repoPath, entry)] : []),
          ...(worktree ? [resolve(expandHome(worktree), entry)] : []),
        ]
  const path = candidates.find((c) => existsSync(c)) ?? candidates[0]
  const legacy = !(path === home || path.startsWith(home + sep))
  return { file: entry, path, exists: existsSync(path), legacy }
}

export const contractWarning = (c: ResolvedContract) =>
  !c.exists
    ? 'contrato não encontrado'
    : c.legacy
      ? 'contrato legado: fora de <vault>/10-projects/<projeto>/behaviors/'
      : undefined

/** Entrada do índice de freeze do kb que corresponde ao contrato resolvido. */
export function frozenEntryFor<T extends { plan: string; file: string }>(entries: T[], slug: string, c: ResolvedContract): T | undefined {
  const mine = entries.filter((f) => f.plan === slug)
  return (
    mine.find((f) => resolve(expandHome(f.file)) === c.path) ??
    mine.find((f) => f.file === c.file) ??
    mine.find((f) => basename(f.file) === basename(c.file))
  )
}

async function readTasks(dir: string): Promise<PlanTask[]> {
  let files: string[]
  try {
    files = (await readdir(dir)).filter((f) => f.endsWith('.md') && f !== '_task.md')
  } catch {
    return []
  }
  const tasks: PlanTask[] = []
  for (const file of files.sort()) {
    try {
      const { fm } = parseFrontmatter(await readFile(join(dir, file), 'utf8'))
      tasks.push({
        id: asStr(fm.id) ?? basename(file, '.md'),
        title: asStr(fm.title) ?? basename(file, '.md'),
        status: asStr(fm.status) ?? 'todo',
        dependsOn: asArr(fm.depends_on).filter((d) => d && d !== '—'),
        repo: asStr(fm.repo),
        branch: asStr(fm.branch),
        gates: asArr(fm.gates),
        gate: asStr(fm.gate),
        stage: asStr(fm.stage),
        scope: asArr(fm.scope),
        ready: false,
      })
    } catch {
      continue
    }
  }
  // Ready-set: mesma regra do `kb dev check` — todo com todas as deps done.
  const done = new Set(tasks.filter((t) => t.status === 'done').map((t) => t.id))
  for (const t of tasks) t.ready = t.status !== 'done' && t.dependsOn.every((d) => done.has(d))
  return tasks
}

async function lastExecution(dir: string): Promise<PlanRow['lastExecution']> {
  try {
    const files = (await readdir(dir)).filter((f) => f.endsWith('.md')).sort()
    const last = files.at(-1)
    if (!last) return undefined
    const st = await stat(join(dir, last))
    return { day: basename(last, '.md'), ts: st.mtimeMs }
  } catch {
    return undefined
  }
}

/**
 * Planos ATIVOS de todos os vaults. `30-plans/_archive/**` fica de fora por
 * padrão — plano concluído é histórico, e herdar esse ruído é justamente o que
 * o protocolo do vault manda evitar. `includeArchived` para o caso explícito.
 */
export async function plans(includeArchived = false): Promise<PlanRow[]> {
  const cfg = await kbConfig()
  const frozen = await frozenContracts()
  const out: PlanRow[] = []

  for (const vault of cfg.vaults) {
    const plansDir = join(vault.path, '30-plans')
    let slugs: string[]
    try {
      slugs = (await readdir(plansDir, { withFileTypes: true }))
        .filter((d) => d.isDirectory() && (includeArchived || d.name !== '_archive'))
        .map((d) => d.name)
    } catch {
      continue
    }

    for (const slug of slugs) {
      const dir = join(plansDir, slug)
      const planFile = join(dir, '_plan.md')
      let text: string
      let mtime = 0
      try {
        text = await readFile(planFile, 'utf8')
        mtime = (await stat(planFile)).mtimeMs
      } catch {
        continue
      }

      const { fm, body } = parseFrontmatter(text)
      const tasks = await readTasks(join(dir, 'tasks'))

      const boxes = body.match(/^\s*-\s+\[[ xX]\]/gm) ?? []
      const boxesDone = body.match(/^\s*-\s+\[[xX]\]/gm) ?? []
      const progress: PlanRow['progress'] = tasks.length
        ? { done: tasks.filter((t) => t.status === 'done').length, total: tasks.length, source: 'tasks' }
        : { done: boxesDone.length, total: boxes.length, source: 'checkboxes' }

      // Gate humano aberto: linha de checkbox não marcada que carrega o ⛔.
      const openGates =
        (body.match(/^\s*-\s+\[ \].*⛔/gm) ?? []).length +
        (body.match(/^#+.*⛔.*$/gm) ?? []).filter((h) => !/\bdone\b/i.test(h)).length +
        tasks.filter((t) => t.gate === 'human' && t.status !== 'done').length

      out.push({
        slug,
        vault: vault.name,
        visibility: asStr(fm.visibility) ?? vault.visibility,
        title: asStr(fm.title) ?? slug,
        status: asStr(fm.status) ?? 'active',
        projects: asArr(fm.projects),
        groups: asArr(fm.groups),
        stack: asArr(fm.stack),
        created: asStr(fm.created),
        updated: asStr(fm.updated),
        progress,
        tasks,
        ready: tasks.filter((t) => t.ready).map((t) => t.id),
        openGates,
        frozen: frozen
          .filter((f) => f.plan === slug)
          .map((f) => ({ file: f.file, frozenAt: f.frozen_at })),
        contracts: asArr(fm.contracts),
        contractFiles: asArr(fm.contracts).map((c) => {
          const repo = cfg.projects.find((p) => asArr(fm.projects).includes(p.name))
          const r = resolveContract(vault.path, c, repo?.path, asStr(fm.worktree))
          return { ...r, warning: contractWarning(r) }
        }),
        prototypeUrl: asStr(fm.prototype_url),
        worktree: asStr(fm.worktree),
        approvedBy: asStr(fm.approved_by),
        gates: tasks.filter((t) => t.gate === 'human').map((t) => ({ id: t.id, stage: t.stage, status: t.status })),
        lastExecution: await lastExecution(join(dir, 'execution')),
        mtime,
        path: dir,
      })
    }
  }

  out.sort((a, b) => (b.lastExecution?.ts ?? b.mtime) - (a.lastExecution?.ts ?? a.mtime))
  return out
}

/** Corpo do plano + log de execução mais recente, para o drawer de detalhe. */
export async function planDetail(vaultName: string, slug: string) {
  const cfg = await kbConfig()
  const vault = cfg.vaults.find((v) => v.name === vaultName)
  if (!vault) return null
  const dir = join(vault.path, '30-plans', slug)
  let body = ''
  try {
    body = parseFrontmatter(await readFile(join(dir, '_plan.md'), 'utf8')).body
  } catch {
    return null
  }
  const all = await plans(true)
  const row = all.find((p) => p.slug === slug && p.vault === vaultName)

  let execution: Array<{ day: string; body: string }> = []
  try {
    const files = (await readdir(join(dir, 'execution'))).filter((f) => f.endsWith('.md')).sort().reverse()
    execution = await Promise.all(
      files.slice(0, 3).map(async (f) => ({
        day: basename(f, '.md'),
        body: await readFile(join(dir, 'execution', f), 'utf8'),
      })),
    )
  } catch {
    // plano sem log de execução ainda
  }
  return { ...row, body, execution }
}

/** Trabalho não salvo nos repos do kb — o mesmo sinal do `kb status`. */
export async function repoRisk(): Promise<Array<{ name: string; path: string; dirty: number; ahead: number; branch: string }>> {
  const rows = await projects(true)
  return rows
    .filter((r) => r.git && (r.git.dirty > 0 || r.git.ahead > 0))
    .map((r) => ({ name: r.name, path: r.path, branch: r.git!.branch, dirty: r.git!.dirty, ahead: r.git!.ahead }))
}
