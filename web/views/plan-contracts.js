// views/plan-contracts.js — aba Contratos do plano: o .feature.md renderizado
// como markdown, uma Funcionalidade por <details> com a contagem de cenários,
// e os controles de freeze/drift que já existiam.
import { esc, md } from '../app.js'

/** O markdown do vault vem com frontmatter YAML — fora daqui só o corpo. */
const body = (t) => String(t ?? '').replace(/^---\r?\n[\s\S]*?\r?\n---[ \t]*\r?\n?/, '')

// "Cenários:" (pt) e "Scenarios:" (en) são sinônimos de Exemplos — não contam.
const SCENARIO = /^[ \t]*(Cenário|Esquema do Cenário|Delineação do Cenário|Scenario Outline|Scenario Template|Scenario)[ \t]*:/gm
export const countScenarios = (text) => (String(text ?? '').match(SCENARIO) || []).length

/**
 * Divide o corpo em introdução + seções `## …`. Só o nível 2 vira seção: é o
 * que o `kb new --type contract` gera (uma `## Funcionalidade: X` por bloco).
 */
export function sections(text) {
  const lines = body(text).split(/\r?\n/)
  const out = []
  let cur = { heading: null, lines: [] }
  let fence = false
  for (const ln of lines) {
    if (/^\s*```/.test(ln)) fence = !fence
    if (!fence && /^##\s+\S/.test(ln)) {
      out.push(cur)
      cur = { heading: ln.replace(/^##\s+/, '').trim(), lines: [] }
      continue
    }
    cur.lines.push(ln)
  }
  out.push(cur)
  return out.map((s) => ({ heading: s.heading, text: s.lines.join('\n'), scenarios: countScenarios(s.lines.join('\n')) }))
}

const isMobile = () => window.innerWidth < 900

function contractCard(c, i) {
  const secs = c.exists === false || !c.content ? [] : sections(c.content)
  const intro = secs.find((s) => s.heading === null)
  const feats = secs.filter((s) => s.heading !== null)
  const total = feats.reduce((a, s) => a + s.scenarios, 0)
  const startOpen = !(isMobile() && feats.length > 3)
  const featsHtml = feats
    .map(
      (s) => `<details class="feat"${startOpen ? ' open' : ''}>
        <summary><span class="t">${esc(s.heading.replace(/^Funcionalidade:\s*/i, ''))}</span>
          <span class="pill">${s.scenarios} cenário${s.scenarios === 1 ? '' : 's'}</span></summary>
        <div class="md">${md(s.text)}</div>
      </details>`,
    )
    .join('')
  return `<section class="card" data-contract="${esc(c.file)}">
    <h2>${esc(c.file)}<span class="n">${feats.length ? `${feats.length} func. · ${total} cenário${total === 1 ? '' : 's'}` : ''}</span></h2>
    <small class="dim">${esc(c.path || '—')}</small>
    <div class="row">
      <span class="pill ${c.frozen ? 'ok' : ''}">${c.frozen ? '🧊 congelado' : 'não congelado'}</span>
      ${c.frozenAt ? `<span class="pill">${esc(new Date(c.frozenAt).toLocaleString('pt-BR'))}</span>` : ''}
      ${c.drifted ? '<span class="pill err" title="o conteúdo mudou depois do freeze">drift</span>' : ''}
      ${c.exists === false ? '<span class="pill err">ausente</span>' : ''}
      ${c.legacy ? '<span class="pill warn" title="fora de <vault>/10-projects/<projeto>/behaviors/">legado</span>' : ''}
    </div>
    <div class="row">
      ${c.frozen ? '<button class="btn sm warn" data-act="unfreeze">descongelar</button>' : '<button class="btn sm primary" data-act="freeze">congelar</button>'}
      <button class="btn sm" data-act="check">kb dev check</button>
      ${feats.length > 1 ? `<span class="spacer" style="flex:1"></span><button class="btn sm" data-feats="toggle">${startOpen ? 'recolher tudo' : 'expandir tudo'}</button>` : ''}
    </div>
    ${c.exists === false ? `<div class="empty">${esc(c.warning || `contrato declarado em contracts: mas o arquivo não existe (${c.path || c.file})`)}</div>` : ''}
    ${intro && intro.text.trim() ? `<div class="md intro">${md(intro.text)}</div>` : ''}
    ${featsHtml || (c.content && !feats.length ? `<div class="md">${md(body(c.content))}</div>` : '')}
    ${i === 0 ? '<pre data-el="kbout" hidden></pre>' : ''}
  </section>`
}

export function contractsHtml(p) {
  const rows = p.contracts || []
  if (!rows.length) return '<div class="empty">nenhum contrato declarado</div>'
  return rows.map(contractCard).join('')
}

/** Expandir/recolher tudo — chamado pelo handler de clique da view do plano. */
export function toggleFeats(btn) {
  const card = btn.closest('.card')
  const all = [...card.querySelectorAll('details.feat')]
  const open = all.some((d) => !d.open)
  for (const d of all) d.open = open
  btn.textContent = open ? 'recolher tudo' : 'expandir tudo'
}
