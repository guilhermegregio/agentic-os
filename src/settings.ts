import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { DATA_DIR, MAX_RUNNING, ensureDirs } from './config.js'

/** Ajustes do operador, persistidos fora do repo (`<data>/settings.json`). */
export interface Settings {
  /** Quantas sessões podem estar num turno ao mesmo tempo — o freio da máquina. */
  maxRunning: number
  defaultPermissionMode: string
  defaultModel?: string
  /** cwd sugerido ao abrir sessão sem projeto. */
  defaultCwd?: string
}

const FILE = join(DATA_DIR, 'settings.json')
let current: Settings = { maxRunning: MAX_RUNNING, defaultPermissionMode: 'default' }
let loaded = false

export async function loadSettings(): Promise<Settings> {
  if (loaded) return current
  loaded = true
  ensureDirs()
  try {
    current = { ...current, ...JSON.parse(await readFile(FILE, 'utf8')) }
  } catch {
    // primeira execução: defaults
  }
  return current
}

export function getSettings(): Settings {
  return current
}

export async function updateSettings(patch: Partial<Settings>): Promise<Settings> {
  const next = { ...current, ...patch }
  if (!Number.isFinite(next.maxRunning) || next.maxRunning < 1) next.maxRunning = 1
  if (next.maxRunning > 16) next.maxRunning = 16
  current = next
  ensureDirs()
  await writeFile(FILE, JSON.stringify(current, null, 2), 'utf8')
  return current
}
