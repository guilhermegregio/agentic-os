// views/plan-activity.js — aba Atividade do plano e a pill de estado usada na
// lista e na Home. Tudo aqui é INFERIDO pelo servidor (herdr, sessões, CLI,
// worktrees, git): nada é persistido, a UI diz isso.
import { esc, shortPath, relTime } from '../app.js'

export const STATES = {
  working: { icon: 'working', label: 'trabalhando', cls: 'ok', order: 0 },
  'waiting-human': { icon: 'blocked', label: 'aguardando você', cls: 'warn', order: 1 },
  idle: { icon: 'idle', label: 'agente ocioso', cls: 'acc', order: 2 },
  quiet: { icon: 'queued', label: 'sem atividade', cls: '', order: 3 },
  stale: { icon: 'closed', label: 'parado', cls: 'dim', order: 4 },
  done: { icon: 'done', label: 'concluído', cls: '', order: 5 },
}
export const stateOrder = (a) => STATES[a?.state]?.order ?? 9

/** Pill compacta: `● trabalhando`, `⏸ aguardando você`, `○ parado há 2 d`. */
export function activityPill(a, { withReason = false } = {}) {
  if (!a || !a.state) return '<span class="pill dim" title="atividade indisponível">—</span>'
  const s = STATES[a.state] || { icon: '', label: a.state, cls: '' }
  const when = (a.state === 'stale' || a.state === 'quiet') && a.since ? ` ${esc(relTime(a.since))}` : ''
  return `<span class="pill ${s.cls} plan-act" title="${esc(a.reason || s.label)}"><i class="dot ${s.icon}"></i>${s.label}${when}${
    withReason && a.reason ? ` <span class="dim">· ${esc(a.reason)}</span>` : ''
  }</span>`
}

const card = (title, n, body, cls = '') =>
  `<section class="card ${cls}"><h2>${esc(title)}${n ? `<span class="n">${esc(n)}</span>` : ''}</h2>${body}</section>`
const empty = (msg) => `<div class="empty">${esc(msg)}</div>`
const taskTag = (t) => (t ? `<span class="pill acc">${esc(t)}</span>` : '<span class="pill">plano</span>')

function waitingHtml(a, p) {
  const rows = a.waiting || []
  if (!rows.length) return card('Aguardando você', null, empty('nada pendente'))
  const openGate = (p.gates || []).some((g) => g.status !== 'done')
  return card(
    'Aguardando você',
    rows.length,
    `<ul class="list">${rows.map((w) => `<li><span class="dot blocked"></span><span class="t">${esc(w)}</span></li>`).join('')}</ul>
     ${openGate ? '<small class="dim">os botões de aprovar gate ficam no topo da página</small>' : ''}`,
  )
}

function agentsHtml(a) {
  const rows = a.agents || []
  if (a.herdr === false) return card('Agentes (herdr)', null, empty('herdr indisponível — fora do multiplexador não há frota'))
  if (!rows.length) return card('Agentes (herdr)', null, empty('nenhum agente num cwd deste plano'))
  return card(
    'Agentes (herdr)',
    rows.length,
    `<ul class="list">${rows
      .map(
        (x) => `<li><span class="dot ${esc(x.status || 'unknown')}"></span>
        <span class="t">${esc(x.title || 'agente')}<small>${esc(x.status || '—')} · ${esc(shortPath(x.cwd))} · ${esc(x.paneId || '—')}</small></span>
        ${taskTag(x.task)}
        ${x.paneId ? `<button class="btn sm" data-focus="${esc(x.paneId)}">focar</button>` : ''}</li>`,
      )
      .join('')}</ul>`,
  )
}

function sessionsHtml(a) {
  const rows = a.sessions || []
  if (!rows.length) return card('Sessões (web)', null, empty('nenhuma sessão do Jarvis neste plano'))
  return card(
    'Sessões (web)',
    rows.length,
    `<ul class="list">${rows
      .map(
        (s) => `<li class="link" data-go="#/s/${esc(s.id)}"><span class="dot ${esc(s.state || 'closed')}"></span>
        <span class="t">${esc(s.title || 'sessão')}<small>${esc(s.state || '—')} · ${esc(shortPath(s.cwd))}${
          s.pendingPermissions ? ' · <b style="color:var(--warn)">' + s.pendingPermissions + ' permissão(ões) pendente(s)</b>' : ''
        }</small></span>${taskTag(s.task)}${s.live ? '<span class="pill ok">viva</span>' : ''}</li>`,
      )
      .join('')}</ul>`,
  )
}

function cliHtml(a) {
  const rows = a.cli || []
  if (!rows.length) return card('CLI (transcripts)', null, empty('nenhuma sessão do CLI nos últimos 7 dias'))
  return card(
    'CLI (transcripts)',
    rows.length,
    `<ul class="list">${rows
      .map(
        (c) => `<li><span class="t">${esc(c.title || c.sessionId)}<small>${esc(relTime(c.lastTs))} · ${esc(shortPath(c.cwd))}</small></span>
        ${taskTag(c.task)}<button class="btn sm" data-copy="claude --resume ${esc(c.sessionId)}" title="copiar claude --resume">resume</button></li>`,
      )
      .join('')}</ul>`,
  )
}

function tasksHtml(a) {
  const rows = a.tasks || []
  if (!rows.length) return ''
  return card(
    'Tasks × git',
    null,
    `<div class="tablewrap"><table>
      <thead><tr><th>task</th><th>status</th><th>branch</th><th>worktree</th><th>main</th><th>presença</th></tr></thead>
      <tbody>${rows
        .map(
          (t) => `<tr>
          <td><b>${esc(t.id)}</b></td>
          <td>${esc(t.status || '—')}</td>
          <td class="mono dim">${esc(t.branch || '—')}${t.branch && !t.branchExists ? ' <span class="pill">não criada</span>' : ''}</td>
          <td>${t.worktreeExists ? `<span class="pill" title="${esc(t.worktree || '')}">existe</span>${t.lastCommitTs ? `<small class="dim"> commit ${esc(relTime(t.lastCommitTs))}</small>` : ''}` : '<span class="dim">—</span>'}</td>
          <td>${t.merged ? '<span class="pill ok">mergeada</span>' : '<span class="dim">—</span>'}</td>
          <td>${t.agents ? `<span class="pill ok">${t.agents} agente</span>` : ''}${t.sessions ? ` <span class="pill acc">${t.sessions} sessão</span>` : ''}${!t.agents && !t.sessions ? '<span class="dim">ninguém</span>' : ''}</td>
        </tr>`,
        )
        .join('')}</tbody></table></div>`,
    'wide',
  )
}

/** HTML da aba inteira. `a` = resposta de /activity; `p` = o plano. */
export function activityHtml(a, p) {
  if (!a) return '<div class="empty">atividade indisponível (o servidor não respondeu)</div>'
  const s = STATES[a.state] || { icon: '', label: a.state || '—', cls: '' }
  return `<div class="act-hero">
      <div class="state"><i class="dot ${s.icon}"></i>${esc(s.label)}${a.since ? `<span class="pill">último sinal ${esc(relTime(a.since))}</span>` : ''}</div>
      <div class="why">${esc(a.reason || '—')}</div>
      <div class="note">inferido de herdr, sessões web, transcripts do CLI, worktrees e git — nada é persistido; cwd casando não prova que o agente está nesta task. Atualiza a cada 10 s.</div>
    </div>
    <div class="act-grid">
      ${waitingHtml(a, p)}
      ${agentsHtml(a)}
      ${sessionsHtml(a)}
      ${cliHtml(a)}
      ${tasksHtml(a)}
    </div>`
}
