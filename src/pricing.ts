/**
 * Preços e janelas de contexto por modelo, mais o cálculo de custo a partir de um
 * usage record da API. Os transcripts do CLI guardam `usage` mas NÃO guardam custo,
 * então o custo do painel é derivado aqui.
 *
 * Multiplicadores de cache (iguais para todos os modelos, salvo nota):
 *   escrita 5m = 1.25× input · escrita 1h = 2× input · leitura = 0.1× input
 */

export interface ModelPrice {
  /** USD por 1M tokens de input não-cacheado. */
  input: number
  /** USD por 1M tokens de output. */
  output: number
  /** Janela de contexto em tokens. */
  context: number
  /** Multiplicador da leitura de cache sobre o input (default 0.1). */
  cacheReadMult?: number
  /** Preço alternativo quando `usage.speed === 'fast'` (research preview). */
  fast?: { input: number; output: number }
  label: string
}

const OPUS = { input: 5, output: 25, context: 1_000_000 }
const FABLE = { input: 10, output: 50, context: 1_000_000 }

export const MODELS: Record<string, ModelPrice> = {
  'claude-fable-5-1': { ...FABLE, cacheReadMult: 0.025, label: 'Fable 5.1' },
  'claude-mythos-5-1': { ...FABLE, cacheReadMult: 0.025, label: 'Mythos 5.1' },
  'claude-fable-5': { ...FABLE, label: 'Fable 5' },
  'claude-opus-5': { ...OPUS, fast: { input: 10, output: 50 }, label: 'Opus 5' },
  'claude-opus-4-8': { ...OPUS, fast: { input: 10, output: 50 }, label: 'Opus 4.8' },
  'claude-opus-4-7': { ...OPUS, label: 'Opus 4.7' },
  'claude-opus-4-6': { ...OPUS, label: 'Opus 4.6' },
  'claude-sonnet-5': { input: 2, output: 10, context: 1_000_000, label: 'Sonnet 5' },
  'claude-sonnet-4-6': { input: 3, output: 15, context: 1_000_000, label: 'Sonnet 4.6' },
  'claude-haiku-4-5': { input: 1, output: 5, context: 200_000, label: 'Haiku 4.5' },
}

/** `claude-opus-5[1m]` e `claude-haiku-4-5-20251001` caem no mesmo preço da família. */
export function normalizeModel(model?: string | null): string {
  if (!model) return 'unknown'
  const base = model.replace(/\[[^\]]*\]/g, '').trim()
  if (MODELS[base]) return base
  // sufixo de data (`-20251001`) ou snapshot: derruba e tenta de novo
  const undated = base.replace(/-\d{8}$/, '')
  if (MODELS[undated]) return undated
  // prefixo de provider (`anthropic.claude-opus-5`, `us.anthropic.…`)
  const stripped = undated.replace(/^.*?(claude-)/, '$1')
  return MODELS[stripped] ? stripped : undated
}

export function modelLabel(model?: string | null): string {
  const id = normalizeModel(model)
  return MODELS[id]?.label ?? id
}

export function contextWindow(model?: string | null): number {
  return MODELS[normalizeModel(model)]?.context ?? 200_000
}

/** Subconjunto do `usage` da API que interessa para custo e contexto. */
export interface UsageLike {
  input_tokens?: number
  output_tokens?: number
  cache_read_input_tokens?: number
  cache_creation_input_tokens?: number
  cache_creation?: { ephemeral_5m_input_tokens?: number; ephemeral_1h_input_tokens?: number }
  speed?: string
  server_tool_use?: { web_search_requests?: number; web_fetch_requests?: number }
}

export interface Tally {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  costUsd: number
  /** Tokens que o modelo leu neste turno = tamanho do contexto na última chamada. */
  contextTokens: number
}

export const emptyTally = (): Tally => ({
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  costUsd: 0,
  contextTokens: 0,
})

/** Custo em USD de um único usage record. */
export function costOf(usage: UsageLike | undefined, model?: string | null): number {
  if (!usage) return 0
  const p = MODELS[normalizeModel(model)]
  if (!p) return 0
  const rate = usage.speed === 'fast' && p.fast ? p.fast : p
  const M = 1_000_000

  const write5m = usage.cache_creation?.ephemeral_5m_input_tokens ?? 0
  const write1h = usage.cache_creation?.ephemeral_1h_input_tokens ?? 0
  // Sem o detalhamento por TTL, assume o default de 5 minutos.
  const writeFallback = write5m + write1h ? 0 : (usage.cache_creation_input_tokens ?? 0)

  const readMult = p.cacheReadMult ?? 0.1

  return (
    ((usage.input_tokens ?? 0) * rate.input +
      (usage.output_tokens ?? 0) * rate.output +
      (usage.cache_read_input_tokens ?? 0) * rate.input * readMult +
      (write5m + writeFallback) * rate.input * 1.25 +
      write1h * rate.input * 2) /
    M
  )
}

/** Soma um usage record num acumulador (mutável, para varreduras grandes). */
export function addUsage(t: Tally, usage: UsageLike | undefined, model?: string | null): Tally {
  if (!usage) return t
  const input = usage.input_tokens ?? 0
  const cacheRead = usage.cache_read_input_tokens ?? 0
  const cacheWrite = usage.cache_creation_input_tokens ?? 0
  t.input += input
  t.output += usage.output_tokens ?? 0
  t.cacheRead += cacheRead
  t.cacheWrite += cacheWrite
  t.costUsd += costOf(usage, model)
  // O contexto não acumula: é o estado da última chamada.
  t.contextTokens = input + cacheRead + cacheWrite
  return t
}

export function mergeTally(a: Tally, b: Tally): Tally {
  return {
    input: a.input + b.input,
    output: a.output + b.output,
    cacheRead: a.cacheRead + b.cacheRead,
    cacheWrite: a.cacheWrite + b.cacheWrite,
    costUsd: a.costUsd + b.costUsd,
    contextTokens: Math.max(a.contextTokens, b.contextTokens),
  }
}

/** Catálogo para os seletores da UI. */
export function modelCatalog() {
  return Object.entries(MODELS).map(([id, p]) => ({
    id,
    label: p.label,
    input: p.input,
    output: p.output,
    context: p.context,
  }))
}
