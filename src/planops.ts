import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFile, readdir, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { createConnection } from 'node:net'
import { homedir } from 'node:os'
import { basename, isAbsolute, join } from 'node:path'
import { promisify } from 'node:util'
import { KB_STATE_DIR, OPERATOR, PROTOTYPES_APPS_DIR, PROTOTYPES_PROJECT } from './config.js'
import { kbConfig, parseFrontmatter, type FmValue } from './harness.js'

/**
 * Operações do console do devflow. Regra: o Jarvis só muda o que um humano mudaria
 * à mão no gate (status/approved_by do _plan.md, checkbox ⛔ das tasks TP/TB);
 * freeze/unfreeze/check são sempre do `kb dev` — nunca reimplementados aqui.
 */

const exec = promisify(execFile)
const today = () => new Date().toISOString().slice(0, 10)

async function planDir(vaultName: string, slug: string) {
  const cfg = await kbConfig()
  const vault = cfg.vaults.find((v) => v.name === vaultName)
  if (!vault) throw new Error(`vault desconhecido: ${vaultName}`)
  const dir = join(vault.path, '30-plans', slug)
  if (!existsSync(join(dir, '_plan.md'))) throw new Error(`plano não encontrado: ${slug}`)
  return { vault, dir }
}

export interface PlanFile {
  name: string
  path: string
  markdown: string
  fm: Record<string, FmValue>
}

/** Todos os markdowns do plano: _plan.md, tasks/*, execution/* (mais recente primeiro). */
export async function files(vaultName: string, slug: string) {
  const { dir } = await planDir(vaultName, slug)
  const read = async (rel: string): Promise<PlanFile> => {
    const markdown = await readFile(join(dir, rel), 'utf8')
    return { name: rel, path: join(dir, rel), markdown, fm: parseFrontmatter(markdown).fm }
  }
  const plan = await read('_plan.md')
  const tasks: PlanFile[] = []
  try {
    for (const f of (await readdir(join(dir, 'tasks'))).filter((f) => f.endsWith('.md') && f !== '_task.md').sort()) tasks.push(await read(`tasks/${f}`))
  } catch {
    /* sem tasks */
  }
  const execution: PlanFile[] = []
  try {
    for (const f of (await readdir(join(dir, 'execution'))).filter((f) => f.endsWith('.md')).sort().reverse().slice(0, 5)) execution.push(await read(`execution/${f}`))
  } catch {
    /* sem log */
  }
  return { dir, plan, tasks, execution }
}

function setFm(text: string, key: string, value: string): string {
  const re = new RegExp(`^(${key}:)[^\\n]*$`, 'm')
  if (re.test(text)) return text.replace(re, `$1 ${value}`)
  // chave ausente: insere antes do fechamento do frontmatter
  return text.replace(/\n---\n/, `\n${key}: ${value}\n---\n`)
}

const PLAN_STATUSES = ['draft', 'ready-for-review', 'approved', 'in-progress', 'done', 'archived']

export async function setPlanStatus(vaultName: string, slug: string, status: string, by = OPERATOR) {
  if (!PLAN_STATUSES.includes(status)) throw new Error(`status inválido: ${status}`)
  const { dir } = await planDir(vaultName, slug)
  const file = join(dir, '_plan.md')
  let text = await readFile(file, 'utf8')
  text = setFm(text, 'status', status)
  text = setFm(text, 'updated', today())
  if (status === 'approved') {
    text = setFm(text, 'approved_by', by)
    text = setFm(text, 'approved_at', today())
  }
  await writeFile(file, text, 'utf8')
  return { status }
}

/** Marca o gate humano de uma task (TP/TB): status done + checkbox ⛔ marcado. */
export async function approveGate(vaultName: string, slug: string, taskId: string) {
  const { dir } = await planDir(vaultName, slug)
  const file = join(dir, 'tasks', `${taskId}.md`)
  if (!existsSync(file)) throw new Error(`task não encontrada: ${taskId}`)
  let text = await readFile(file, 'utf8')
  const { fm } = parseFrontmatter(text)
  if (fm.gate !== 'human') throw new Error(`${taskId} não é uma task-gate humana`)
  text = setFm(text, 'status', 'done')
  text = text.replace(/^(\s*-\s+)\[ \](.*⛔)/gm, '$1[x]$2')
  await writeFile(file, text, 'utf8')
  return { taskId, status: 'done' }
}

/** `kb dev <args>` — o engine do harness faz a operação; o Jarvis só mostra a saída. */
export async function kbDev(args: string[]): Promise<{ ok: boolean; code: number; output: string }> {
  try {
    const { stdout, stderr } = await exec('kb', ['dev', ...args], { timeout: 60_000, env: process.env })
    return { ok: true, code: 0, output: (stdout + stderr).trim() }
  } catch (err: any) {
    return { ok: false, code: err.code ?? 1, output: ((err.stdout ?? '') + (err.stderr ?? '') + (err.message ?? '')).trim() }
  }
}

interface FrozenEntry {
  plan: string
  vault: string
  file: string
  sha?: string
  frozen_at?: string
}

async function frozenEntries(): Promise<FrozenEntry[]> {
  try {
    return JSON.parse(await readFile(join(KB_STATE_DIR, 'frozen-contracts.json'), 'utf8')).entries ?? []
  } catch {
    return []
  }
}

const expand = (p: string) => (p.startsWith('~/') ? join(homedir(), p.slice(2)) : p)

/** Contratos (`contracts:`) do plano com conteúdo, estado de freeze e drift. */
export async function contracts(vaultName: string, slug: string) {
  const { plan } = await files(vaultName, slug)
  const cfg = await kbConfig()
  const projects = (Array.isArray(plan.fm.projects) ? plan.fm.projects : []) as string[]
  const repo = cfg.projects.find((p) => projects.includes(p.name))
  const frozen = await frozenEntries()
  const list = (Array.isArray(plan.fm.contracts) ? plan.fm.contracts : []) as string[]
  return Promise.all(
    list.map(async (c) => {
      // Relativo ao repo do projeto; antes do merge, o contrato pode viver só no worktree do plano.
      const candidates =
        isAbsolute(c) || c.startsWith('~')
          ? [expand(c)]
          : [repo ? join(repo.path, c) : c, ...(typeof plan.fm.worktree === 'string' ? [join(expand(plan.fm.worktree), c)] : [])]
      let path = candidates[0]
      let content = ''
      let exists = false
      for (const cand of candidates) {
        try {
          content = await readFile(cand, 'utf8')
          exists = true
          path = cand
          break
        } catch {
          /* tenta o próximo */
        }
      }
      const entry = frozen.find((f) => f.plan === slug && (f.file === c || f.file === path || basename(f.file) === basename(c)))
      const sha = exists ? createHash('sha256').update(content).digest('hex') : ''
      const drifted = Boolean(entry?.sha && sha && !sha.startsWith(entry.sha))
      return { file: c, path, exists, content, frozen: Boolean(entry), frozenAt: entry?.frozen_at, drifted }
    }),
  )
}

/** Um `port` responde? (300ms) — para saber se o protótipo está no ar. */
export function portUp(port: number, host = '127.0.0.1'): Promise<boolean> {
  return new Promise((resolve) => {
    const s = createConnection({ port, host })
    const done = (v: boolean) => {
      s.destroy()
      resolve(v)
    }
    s.setTimeout(300)
    s.once('connect', () => done(true))
    s.once('timeout', () => done(false))
    s.once('error', () => done(false))
  })
}

export async function urlUp(url: string): Promise<boolean | null> {
  try {
    const u = new URL(url)
    if (!['localhost', '127.0.0.1'].includes(u.hostname)) return null
    return portUp(Number(u.port || (u.protocol === 'https:' ? 443 : 80)), '127.0.0.1')
  } catch {
    return null
  }
}

/**
 * Protótipos: subapps de `JARVIS_PROTOTYPES_PROJECT` (um por marca/cliente), cada
 * um com a porta fixa no script `dev` do seu package.json. Sem a variável, vazio.
 */
export async function prototypes() {
  if (!PROTOTYPES_PROJECT) return []
  const cfg = await kbConfig()
  const proj = cfg.projects.find((p) => p.name === PROTOTYPES_PROJECT)
  if (!proj) return []
  const appsDir = join(proj.path, PROTOTYPES_APPS_DIR)
  let apps: string[] = []
  try {
    apps = (await readdir(appsDir, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name)
  } catch {
    return []
  }
  return Promise.all(
    apps.map(async (app) => {
      let port: number | null = null
      try {
        const pkg = JSON.parse(await readFile(join(appsDir, app, 'package.json'), 'utf8'))
        const m = /--port\s+(\d+)/.exec(pkg.scripts?.dev ?? '')
        if (m) port = Number(m[1])
      } catch {
        /* sem package.json */
      }
      return { app, path: join(appsDir, app), port, url: port ? `http://localhost:${port}` : null, up: port ? await portUp(port) : false }
    }),
  )
}
