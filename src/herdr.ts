import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

/** Frota de agentes do herdr (`herdr agent list`), só quando rodamos dentro dele. */
const exec = promisify(execFile)

export interface HerdrAgent {
  terminalId: string
  agent: string
  status: string
  title: string
  cwd: string
  workspaceId: string
  paneId: string
  focused: boolean
  sessionId?: string
}

export const available = () => process.env.HERDR_ENV === '1'

export async function agents(): Promise<HerdrAgent[]> {
  if (!available()) return []
  try {
    const { stdout } = await exec('herdr', ['agent', 'list'], { timeout: 4000 })
    const raw = JSON.parse(stdout)
    const list = raw.result?.agents ?? raw.agents ?? []
    return list.map((a: any) => ({
      terminalId: a.terminal_id,
      agent: a.agent,
      status: a.agent_status ?? 'unknown',
      title: a.terminal_title_stripped ?? a.title ?? '',
      cwd: a.foreground_cwd ?? a.cwd ?? '',
      workspaceId: a.workspace_id,
      paneId: a.pane_id,
      focused: Boolean(a.focused),
      sessionId: a.agent_session?.value,
    }))
  } catch {
    return []
  }
}

/** Abre um pane novo rodando `command` — usado pelo handoff web → CLI. */
export async function openPane(command: string, cwd?: string): Promise<{ paneId: string } | null> {
  if (!available()) return null
  const parent = process.env.HERDR_PANE_ID
  if (!parent) return null
  try {
    const split = await exec('herdr', ['pane', 'split', parent, '--direction', 'down'], { timeout: 5000 })
    const paneId = JSON.parse(split.stdout).result?.pane?.pane_id
    if (!paneId) return null
    const full = cwd ? `cd ${JSON.stringify(cwd)} && ${command}` : command
    await exec('herdr', ['pane', 'run', paneId, full], { timeout: 5000 })
    return { paneId }
  } catch {
    return null
  }
}

export async function focus(paneId: string) {
  if (!available()) return false
  try {
    await exec('herdr', ['agent', 'focus', paneId], { timeout: 3000 })
    return true
  } catch {
    return false
  }
}
