import { execFile } from 'node:child_process'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { CODE_DIR, KB_CONFIG } from './config.js'
import { invalidateConfig, kbConfig } from './harness.js'

/**
 * Bootstrap de projeto novo: `~/code/<nome>` como repo git, registrado no `kb` com casa
 * no vault e o bloco `kb:link` no CLAUDE.md, tudo num único commit inicial. A descrição
 * descreve o projeto (README, CLAUDE.md, `_project.md`) — nunca vira mensagem de sessão.
 * Sempre `execFile` sem shell: o nome nunca é interpolado numa string de comando.
 */

const exec = promisify(execFile)
export { CODE_DIR }

/** O CLI lê `KB_CONFIG`; o jarvis, `JARVIS_KB_CONFIG` — os dois têm de ver a mesma config. */
const kbEnv = { ...process.env, KB_CONFIG }

const NAME_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/

/** Mesmo slug do `kb new --type project`: a pasta da casa é `10-projects/<slug(título)>`. */
const kbSlug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')

const errMsg = (e: unknown) => {
  const err = e as { stderr?: string; code?: string; message?: string }
  if (err?.code === 'ENOENT') return 'binário não encontrado no PATH'
  return (err?.stderr?.trim() || err?.message || String(e)).split('\n').filter(Boolean).at(-1) ?? String(e)
}

export async function meta() {
  const cfg = await kbConfig()
  return {
    codeDir: CODE_DIR,
    groups: cfg.groups.map((g) => ({ name: g.name, ...(g.title ? { title: g.title } : {}) })),
    vaults: cfg.vaults.map((v) => ({ name: v.name, default: Boolean(v.default) })),
  }
}

export interface CreateProjectInput {
  name: string
  description?: string
  group?: string
  vault?: string
}

export interface CreateProjectResult {
  name: string
  path: string
  vaultHome?: string
  registered: boolean
  log: string[]
}

export async function create(input: CreateProjectInput): Promise<CreateProjectResult> {
  // 1. validação — nada é tocado no disco antes daqui passar
  const name = String(input.name ?? '').trim()
  const description = String(input.description ?? '').trim()
  const group = input.group?.trim() || undefined
  if (!NAME_RE.test(name)) throw new Error('nome inválido: use minúsculas, dígitos, ".", "_" ou "-" (até 64, começando por letra ou dígito)')
  const path = join(CODE_DIR, name)
  if (existsSync(path)) throw new Error(`já existe: ${path}`)
  const cfg = await kbConfig()
  const registeredAs = cfg.projects.find((p) => p.name === name)
  if (registeredAs) throw new Error(`nome já registrado no kb: ${name} → ${registeredAs.path}`)
  if (group && !cfg.groups.some((g) => g.name === group)) throw new Error(`grupo desconhecido no kb: ${group}`)
  const vaultName = input.vault?.trim() || undefined
  if (vaultName && !cfg.vaults.some((v) => v.name === vaultName)) throw new Error(`vault desconhecido no kb: ${vaultName}`)
  const vault = vaultName ? cfg.vaults.find((v) => v.name === vaultName) : (cfg.vaults.find((v) => v.default) ?? cfg.vaults[0])

  const log: string[] = [`validado: ${name} → ${path}`]

  // 2. pasta + git init — falha aqui não deixa resíduo
  try {
    await mkdir(CODE_DIR, { recursive: true })
    await mkdir(path)
  } catch (e) {
    throw new Error(`mkdir falhou: ${errMsg(e)}`)
  }
  try {
    await exec('git', ['init', '-b', 'main'], { cwd: path, timeout: 10_000 })
    log.push('git init -b main')
  } catch (e) {
    await rm(path, { recursive: true, force: true })
    throw new Error(`git init falhou: ${errMsg(e)}`)
  }

  // 3. README.md e CLAUDE.md — o link-claude só acrescenta o bloco kb:link
  const doc = `# ${name}\n\n${description ? `${description}\n` : ''}`
  await writeFile(join(path, 'README.md'), doc)
  await writeFile(join(path, 'CLAUDE.md'), doc)
  log.push('README.md e CLAUDE.md escritos')

  // 4–7. harness kb — falha não apaga nada, só vira linha de log e registered:false
  let registered = true
  const kb = async (label: string, args: string[], timeout = 30_000) => {
    try {
      await exec('kb', args, { cwd: path, timeout, env: kbEnv })
      log.push(label)
      return true
    } catch (e) {
      registered = false
      log.push(`${label} falhou: ${errMsg(e)}`)
      return false
    }
  }

  let vaultHome: string | undefined
  // --vault sempre explícito (default resolvido): a casa não depende de pasta homônima em outro vault.
  const added = await kb(
    `kb project add${group ? ` --group ${group}` : ''}${vault ? ` --vault ${vault.name}` : ''}`,
    ['project', 'add', path, ...(group ? ['--group', group] : []), ...(vault ? ['--vault', vault.name] : [])],
    60_000,
  )
  if (!added) {
    log.push('kb new, link-claude e vault index pulados (projeto sem registro no kb)')
  } else if (!vault) {
    registered = false
    log.push('kb new falhou: nenhum vault registrado no kb')
  } else {
    const homes = [...new Set([name, kbSlug(name)])].map((f) => join(vault.path, '10-projects', f))
    const existing = homes.find((h) => existsSync(join(h, '_project.md')))
    if (existing) {
      vaultHome = existing
      log.push(`kb new pulado: ${join(existing, '_project.md')} já existe`)
    } else if (await kb(`kb new --type project (${vault.name})`, ['new', '--vault', vault.name, '--type', 'project', '--title', name, '--project', name])) {
      vaultHome = homes.find((h) => existsSync(join(h, '_project.md')))
      if (vaultHome && description) {
        try {
          const file = join(vaultHome, '_project.md')
          const text = await readFile(file, 'utf8')
          const next = text.replace(/^(# .*\r?\n)/m, `$1\n${description}\n`)
          await writeFile(file, next === text ? `${text.replace(/\s*$/, '')}\n\n${description}\n` : next)
          log.push('descrição escrita no _project.md')
        } catch (e) {
          registered = false
          log.push(`descrição no _project.md falhou: ${errMsg(e)}`)
        }
      }
    }
    await kb('kb project link-claude', ['project', 'link-claude', name])
    await kb(`kb vault index --vault ${vault.name}`, ['vault', 'index', '--vault', vault.name])
  }

  // 8. commit inicial com README, CLAUDE.md e a higiene do kb
  try {
    await exec('git', ['add', '-A'], { cwd: path, timeout: 10_000 })
    await exec('git', ['commit', '-m', `chore: projeto novo ${name}`], { cwd: path, timeout: 60_000 })
    log.push('git commit: chore: projeto novo')
  } catch (e) {
    log.push(`git commit falhou: ${errMsg(e)}`)
  }

  // 9. listas enxergam o projeto já, sem esperar o cache de 10 s
  invalidateConfig()

  return { name, path, ...(vaultHome ? { vaultHome } : {}), registered, log }
}
