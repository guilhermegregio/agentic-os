import { homedir, userInfo } from 'node:os'
import { join, resolve } from 'node:path'
import { existsSync, mkdirSync } from 'node:fs'

/**
 * Arquivo de ambiente: `JARVIS_ENV_FILE` (ex.: `.env.mock`) ou `.env` na raiz, se
 * existir. Carregado pelo loader nativo do Node — sem dependência — e variáveis já
 * definidas no shell têm precedência sobre o arquivo. Este módulo é importado por
 * todo mundo que lê `process.env`, então o carregamento acontece antes das leituras.
 */
export const ENV_FILE: string | null = (() => {
  const file = resolve(process.env.JARVIS_ENV_FILE ?? '.env')
  if (!existsSync(file)) {
    if (process.env.JARVIS_ENV_FILE) throw new Error(`JARVIS_ENV_FILE não encontrado: ${file}`)
    return null
  }
  process.loadEnvFile(file)
  return file
})()

/** Modo protótipo: só estáticos + dados fictícios do `web/mock.js`; a API fica desligada. */
export const MOCK = process.env.JARVIS_MOCK === '1'

/**
 * Tudo que o jarvis grava vive fora do repo, em XDG state — o repo é código,
 * o estado é runtime. `JARVIS_DATA_DIR` troca o destino (útil para testes).
 */
export const DATA_DIR = process.env.JARVIS_DATA_DIR ?? join(homedir(), '.local', 'state', 'jarvis')
export const SESSIONS_DIR = join(DATA_DIR, 'sessions')
export const CACHE_DIR = join(DATA_DIR, 'cache')

/** Onde o CLI do Claude Code guarda os transcripts (fonte do painel de custos). */
export const CLAUDE_HOME = process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude')
export const CLAUDE_PROJECTS_DIR = join(CLAUDE_HOME, 'projects')

/** Binário do Claude Code CLI; sem isso, `which claude` e depois o embutido no SDK. */
export const CLAUDE_BIN = process.env.JARVIS_CLAUDE_BIN

/** Config do harness `kb`: vaults, projetos e grupos registrados. */
export const KB_CONFIG = process.env.JARVIS_KB_CONFIG ?? join(homedir(), '.config', 'kb', 'config.json')
export const KB_STATE_DIR = process.env.JARVIS_KB_STATE_DIR ?? join(homedir(), '.local', 'state', 'kb')

/** Onde projetos novos nascem: `<dir>/<nome>`. */
export const CODE_DIR = process.env.JARVIS_CODE_DIR ?? join(homedir(), 'code')

/** Layout do `wtree`: `<dir>/<repo>-<branch>`. */
export const WORKTREES_DIR = process.env.JARVIS_WORKTREES_DIR ?? join(homedir(), 'code', 'worktrees')

/** Horas sem sinal até um plano sem ninguém presente passar de `quiet` para `stale`. */
export const ACTIVITY_STALE_HOURS = Number(process.env.JARVIS_ACTIVITY_STALE_HOURS ?? 6)

/** Limite inicial de sessões num turno ao mesmo tempo (ajustável ao vivo em settings). */
export const MAX_RUNNING = Number(process.env.JARVIS_MAX_RUNNING ?? 2)

export const PORT = Number(process.env.PORT ?? 4747)

/**
 * Interface de escuta. Default loopback: a API dá controle total da máquina (sessões
 * Claude em qualquer cwd, worktrees, `kb dev`, panes do herdr), então expor na rede
 * (`0.0.0.0`, IP do Tailscale…) exige `JARVIS_TOKEN` — o servidor recusa subir sem ele.
 */
export const HOST = process.env.JARVIS_HOST ?? '127.0.0.1'
export const LOOPBACK_HOSTS = new Set(['127.0.0.1', '::1', 'localhost'])

/**
 * Projeto (nome registrado no `kb`) cujos subapps são protótipos com porta fixa
 * no script `dev` — aparecem no dashboard com status up/down. Opcional.
 */
export const PROTOTYPES_PROJECT = process.env.JARVIS_PROTOTYPES_PROJECT
export const PROTOTYPES_APPS_DIR = process.env.JARVIS_PROTOTYPES_APPS_DIR ?? 'apps'

/** Quem assina aprovações de plano/gate quando o cliente não informa. */
export const OPERATOR = process.env.JARVIS_OPERATOR ?? userInfo().username

/** Token opcional: se definido, toda rota /api exige `x-jarvis-token`. */
export const AUTH_TOKEN = process.env.JARVIS_TOKEN

export function ensureDirs() {
  for (const d of [DATA_DIR, SESSIONS_DIR, CACHE_DIR]) mkdirSync(d, { recursive: true })
}
