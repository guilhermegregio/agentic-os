// views/plan-tasks.js — aba Tasks do plano: DAG das dependências (mermaid,
// gerado no cliente) + tabela com linha expansível mostrando o frontmatter
// estruturado e o corpo do tasks/Txx.md.
import { esc, md, relTime } from '../app.js'

const body = (t) => String(t ?? '').replace(/^---\r?\n[\s\S]*?\r?\n---[ \t]*\r?\n?/, '')

const STATUS_CLS = { done: 'ok', review: 'warn', running: 'warn', assigned: 'warn', 'in-progress': 'warn', blocked: 'err' }
export const statusPill = (s) => `<span class="pill ${STATUS_CLS[s] || ''}">${esc(s || '—')}</span>`

const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#888'
const short = (s, n = 34) => (String(s || '').length > n ? String(s).slice(0, n - 1) + '…' : String(s || ''))
const safeLabel = (s) => String(s).replace(/"/g, "'").replace(/[\[\]{}()<>|#;]/g, ' ')

/** Fonte mermaid do DAG — classe por status, ⛔ nos gates humanos. */
export function dagSource(tasks) {
  const colors = {
    done: [cssVar('--ok'), cssVar('--bg')],
    warn: [cssVar('--warn'), cssVar('--bg')],
    ready: [cssVar('--acc'), cssVar('--bg')],
    todo: [cssVar('--line'), cssVar('--panel2')],
    blocked: [cssVar('--err'), cssVar('--bg')],
  }
  const cls = (t) =>
    t.status === 'done' ? 'done' : t.status === 'blocked' ? 'blocked' : ['review', 'running', 'assigned', 'in-progress'].includes(t.status) ? 'warn' : t.ready ? 'ready' : 'todo'
  const lines = ['graph LR']
  for (const t of tasks) {
    const label = `${t.id}${t.gate === 'human' ? ' ⛔' : ''} ${short(t.title)}`
    lines.push(`  ${t.id}["${safeLabel(label)}"]:::${cls(t)}`)
  }
  for (const t of tasks) for (const d of t.dependsOn || []) if (tasks.some((x) => x.id === d)) lines.push(`  ${d} --> ${t.id}`)
  for (const [k, [stroke, fill]] of Object.entries(colors)) {
    const txt = k === 'todo' ? cssVar('--dim') : cssVar('--fg')
    lines.push(`  classDef ${k} fill:${fill},stroke:${stroke},stroke-width:2px,color:${txt}`)
  }
  return lines.join('\n')
}

function chip(label, value, { mono = true, copy = null, wide = false } = {}) {
  if (value === undefined || value === null || value === '' || (Array.isArray(value) && !value.length)) return ''
  const v = Array.isArray(value) ? value.join(wide ? '\n' : ', ') : String(value)
  return `<span class="chip${wide ? ' wide' : ''}"><b>${esc(label)}</b><span class="${mono ? 'mono' : ''}">${esc(v)}</span>${
    copy ? `<button type="button" class="cb" data-copy="${esc(copy)}" title="copiar ${esc(copy)}">copiar</button>` : ''
  }</span>`
}

/** Linha de detalhe: frontmatter em chips + corpo renderizado + sinais de atividade. */
function detailHtml(t, file, act) {
  const ta = (act?.tasks || []).find((x) => x.id === t.id)
  const signals = ta
    ? [
        ta.agents ? `<span class="pill ok"><i class="dot working"></i>${ta.agents} agente${ta.agents > 1 ? 's' : ''} aqui</span>` : '',
        ta.sessions ? `<span class="pill acc">${ta.sessions} sessão${ta.sessions > 1 ? 'ões' : ''}</span>` : '',
        ta.worktreeExists ? `<span class="pill" title="${esc(ta.worktree || '')}">worktree existe</span>` : ta.branchExists ? '<span class="pill">branch sem worktree</span>' : '',
        ta.merged ? '<span class="pill ok">mergeada na main</span>' : '',
        ta.lastCommitTs ? `<span class="pill">último commit ${esc(relTime(ta.lastCommitTs))}</span>` : '',
      ]
        .filter(Boolean)
        .join('')
    : ''
  const gates = (t.gates || []).map((g) => chip('gate', g, { copy: g })).join('')
  return `<div class="chips">
      ${chip('status', t.status, { mono: false })}
      ${t.gate ? chip('gate humano', t.stage || t.gate, { mono: false }) : ''}
      ${chip('repo', t.repo)}
      ${t.branch ? chip('branch', t.branch, { copy: `wtree ${t.branch}` }) : ''}
      ${chip('owner', t.owner)}
      ${chip('deps', t.dependsOn)}
      ${gates}
      ${chip('scope', t.scope, { wide: true })}
    </div>
    ${signals ? `<div class="row" style="margin-bottom:10px">${signals}</div>` : ''}
    ${file?.markdown ? `<div class="md">${md(body(file.markdown))}</div>` : '<div class="empty">sem corpo</div>'}`
}

export function tasksHtml(p, { open = null, act = null } = {}) {
  const rows = p.tasks || []
  if (!rows.length) return '<div class="empty">sem tasks</div>'
  const files = new Map((p.files?.tasks || []).map((f) => [f.fm?.id || f.name.replace(/^tasks\//, '').replace(/\.md$/, ''), f]))
  const dag = `<div class="tasks-dag"><div class="md"><pre><code class="language-mermaid">${esc(dagSource(rows))}</code></pre></div>
    <div class="legend"><span><i style="background:var(--ok)"></i>done</span><span><i style="background:var(--warn)"></i>review / rodando</span><span><i style="background:var(--acc)"></i>pronta</span><span><i style="background:var(--line)"></i>bloqueada</span><span>⛔ gate humano · clique abre a task</span></div></div>`
  return `${dag}<div class="tablewrap"><table class="tasks-table">
    <thead><tr><th>id</th><th>título</th><th>status</th><th>deps</th><th>pronta</th><th>escopo</th></tr></thead>
    <tbody>${rows
      .map((t) => {
        const isOpen = open === t.id
        return `<tr class="task${isOpen ? ' open' : ''}" data-task="${esc(t.id)}" aria-expanded="${isOpen}">
        <td><b>${esc(t.id)}</b>${t.gate ? ' ⛔' : ''}</td>
        <td>${esc(t.title || '—')}</td>
        <td>${statusPill(t.status)}</td>
        <td class="dim">${esc((t.dependsOn || []).join(', ') || '—')}</td>
        <td>${t.ready ? '<span class="pill acc">sim</span>' : '<span class="dim">não</span>'}</td>
        <td class="mono dim">${esc((t.scope || []).slice(0, 3).join(' ') + ((t.scope || []).length > 3 ? ' …' : '') || '—')}</td>
      </tr>
      <tr class="task-detail" data-task-detail="${esc(t.id)}"${isOpen ? '' : ' hidden'}><td colspan="6">${isOpen ? detailHtml(t, files.get(t.id), act) : ''}</td></tr>`
      })
      .join('')}</tbody></table></div>`
}

/** Abre/fecha a linha de uma task (uma aberta por vez). Devolve o id aberto ou null. */
export function toggleTask(panel, p, id, act = null, { force = null } = {}) {
  const files = new Map((p.files?.tasks || []).map((f) => [f.fm?.id || f.name.replace(/^tasks\//, '').replace(/\.md$/, ''), f]))
  let opened = null
  for (const row of panel.querySelectorAll('tr.task')) {
    const det = panel.querySelector(`[data-task-detail="${CSS.escape(row.dataset.task)}"]`)
    const mine = row.dataset.task === id
    const willOpen = mine ? (force === null ? row.getAttribute('aria-expanded') !== 'true' : force) : false
    row.classList.toggle('open', willOpen)
    row.setAttribute('aria-expanded', String(willOpen))
    det.hidden = !willOpen
    if (willOpen) {
      const t = (p.tasks || []).find((x) => x.id === id)
      if (!det.firstElementChild.childElementCount) det.firstElementChild.innerHTML = detailHtml(t, files.get(id), act)
      opened = id
    } else det.firstElementChild.innerHTML = ''
  }
  return opened
}

/** id da task a partir do nó do SVG do mermaid (`flowchart-T01-3`). */
export const taskFromNode = (g) => /^flowchart-([A-Za-z0-9_]+)-\d+$/.exec(g?.id || '')?.[1] || null
