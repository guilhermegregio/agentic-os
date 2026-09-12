import { execFile } from 'node:child_process'
import { copyFile, readdir, stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { basename, join } from 'node:path'
import { promisify } from 'node:util'
import { WORKTREES_DIR } from './config.js'

/**
 * Worktrees no mesmo layout do `wtree`: `~/code/worktrees/<repo>-<branch>`, com
 * `.env*` copiados e `pnpm install` quando há lockfile. Git puro — abrir workspace
 * no herdr é opcional e fica com o `wtree`.
 */

const exec = promisify(execFile)
export { WORKTREES_DIR }

export interface Worktree {
  path: string
  head: string
  branch?: string
  isMain: boolean
  exists: boolean
  dirty?: number
}

export async function list(repoPath: string): Promise<Worktree[]> {
  let out = ''
  try {
    out = (await exec('git', ['worktree', 'list', '--porcelain'], { cwd: repoPath, timeout: 4000 })).stdout
  } catch {
    return []
  }
  const rows: Worktree[] = []
  let cur: Partial<Worktree> | null = null
  for (const line of out.split('\n')) {
    if (line.startsWith('worktree ')) {
      if (cur?.path) rows.push(cur as Worktree)
      cur = { path: line.slice(9), isMain: rows.length === 0, exists: true }
    } else if (line.startsWith('HEAD ') && cur) cur.head = line.slice(5, 12)
    else if (line.startsWith('branch ') && cur) cur.branch = line.slice(7).replace('refs/heads/', '')
  }
  if (cur?.path) rows.push(cur as Worktree)
  await Promise.all(
    rows.map(async (w) => {
      w.exists = existsSync(w.path)
      if (!w.exists) return
      try {
        const st = await exec('git', ['status', '--porcelain'], { cwd: w.path, timeout: 4000 })
        w.dirty = st.stdout.split('\n').filter(Boolean).length
      } catch {
        /* sem status */
      }
    }),
  )
  return rows
}

const safe = (s: string) => s.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '')

export interface CreateInput {
  repoPath: string
  branch: string
  base?: string
  existing?: boolean
  install?: boolean
}

export async function create(input: CreateInput): Promise<{ path: string; branch: string; log: string[] }> {
  const branch = input.branch.trim()
  if (!branch) throw new Error('branch vazia')
  const path = join(WORKTREES_DIR, `${basename(input.repoPath)}-${safe(branch)}`)
  if (existsSync(path)) throw new Error(`já existe: ${path}`)
  const log: string[] = []
  const args = input.existing
    ? ['worktree', 'add', path, branch]
    : ['worktree', 'add', '-b', branch, path, input.base ?? 'main']
  const r = await exec('git', args, { cwd: input.repoPath, timeout: 30_000 })
  log.push(`git ${args.join(' ')}`, r.stderr.trim())

  // .env* do repo pai (segredos não versionados) — igual ao wtree.
  for (const f of await readdir(input.repoPath)) {
    if (!/^\.env(\..+)?$/.test(f) && f !== '.envrc') continue
    try {
      if ((await stat(join(input.repoPath, f))).isFile()) {
        await copyFile(join(input.repoPath, f), join(path, f))
        log.push(`copiado ${f}`)
      }
    } catch {
      /* ignora */
    }
  }
  if (input.install !== false && existsSync(join(path, 'pnpm-lock.yaml'))) {
    try {
      await exec('pnpm', ['install', '--prefer-offline'], { cwd: path, timeout: 180_000 })
      log.push('pnpm install ok')
    } catch (e) {
      log.push(`pnpm install falhou: ${e instanceof Error ? e.message : e}`)
    }
  }
  return { path, branch, log: log.filter(Boolean) }
}

export async function remove(repoPath: string, path: string, opts: { force?: boolean; deleteBranch?: boolean } = {}) {
  const wts = await list(repoPath)
  const wt = wts.find((w) => w.path === path)
  if (!wt) throw new Error('worktree não pertence a este repo')
  if (wt.isMain) throw new Error('não remove o checkout principal')
  const args = ['worktree', 'remove', ...(opts.force ? ['--force'] : []), path]
  await exec('git', args, { cwd: repoPath, timeout: 30_000 })
  if (opts.deleteBranch && wt.branch) {
    await exec('git', ['branch', opts.force ? '-D' : '-d', wt.branch], { cwd: repoPath, timeout: 10_000 })
  }
  return { ok: true }
}

/** Diretórios em ~/code/worktrees que nenhum repo reconhece — o que `kb status` chama de órfão. */
export async function orphans(knownRepos: string[]): Promise<string[]> {
  let dirs: string[] = []
  try {
    dirs = (await readdir(WORKTREES_DIR, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => join(WORKTREES_DIR, d.name))
  } catch {
    return []
  }
  const known = new Set<string>()
  for (const repo of knownRepos) for (const w of await list(repo)) known.add(w.path)
  return dirs.filter((d) => !known.has(d))
}
