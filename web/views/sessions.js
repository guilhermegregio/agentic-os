// views/sessions.js — lista de sessões e o chat (SSE, tool calls, permissões).
import {
  api, esc, md, node, fmtUsd, fmtTokens, shortPath, relTime, pct, toast, guard, setCrumb,
  openStream, openSessionDialog, models, modelOptions, selectModel, isMock, refreshLive,
} from '../app.js'
import { enhance } from '../md-enhance.js'

const MODES = [
  ['default', 'default (pergunta)'],
  ['acceptEdits', 'acceptEdits'],
  ['plan', 'plan'],
  ['auto', 'auto'],
  ['bypassPermissions', 'bypass'],
]

/** Estados em que não há processo do agente atrás da sessão. */
const DEAD = new Set(['closed', 'handed-off', 'error'])

export async function render(root, params, ctx) {
  if (params.id) return chat(root, params.id, ctx)
  return list(root, ctx)
}

// ==========================================================================
// Lista
// ==========================================================================
function rowHtml(s) {
  const p = pct(s.usage?.contextTokens, s.usage?.contextWindow)
  return `<li class="link" data-go="#/s/${esc(s.id)}">
    <span class="dot ${esc(s.state)}"></span>
    <span class="t">${esc(s.title || 'sessão')}
      <small>${esc(shortPath(s.cwd))} · ${esc(s.state)} · ${esc(fmtUsd(s.usage?.costUsd))} · ctx ${p}% · ${esc(relTime(s.updatedAt))}</small></span>
    ${s.pendingPermissions ? `<span class="pill warn">${s.pendingPermissions}</span>` : ''}
    ${s.live ? '<span class="pill acc">viva</span>' : ''}
  </li>`
}

async function listBody(filter) {
  if (filter === 'cli') {
    const rows = await api('/api/sessions/stored?limit=40')
    if (!rows.length) return '<div class="empty">nenhuma sessão do CLI encontrada</div>'
    return `<ul class="list">${rows
      .map(
        (r) => `<li><span class="t">${esc(r.summary || r.firstPrompt || r.sessionId)}
        <small>${esc(shortPath(r.cwd))} · ${esc(r.gitBranch || '—')} · ${esc(relTime(r.lastModified))}</small></span>
        ${r.imported ? '<span class="pill ok">importada</span>' : `<button class="btn sm" data-import="${esc(r.sessionId)}" data-cwd="${esc(r.cwd || '')}">importar</button>`}</li>`,
      )
      .join('')}</ul>`
  }
  const rows = await api('/api/sessions')
  const view = filter === 'live' ? rows.filter((s) => s.live) : rows
  if (!view.length) return '<div class="empty">nenhuma sessão aqui</div>'
  return `<ul class="list">${view.map(rowHtml).join('')}</ul>`
}

async function list(root, ctx) {
  setCrumb('Sessões')
  let filter = sessionStorage.getItem('jarvis:sfilter') || 'live'
  root.innerHTML = `<div class="toolbar"><h1>Sessões</h1><button class="btn primary sm" data-new>nova sessão</button></div>
    <div class="tabs">
      <button data-f="live">vivas</button><button data-f="all">todas</button><button data-f="cli">sessões do CLI</button>
    </div>
    <div id="sbody"><div class="empty">carregando…</div></div>`
  const body = root.querySelector('#sbody')

  const paint = async () => {
    for (const b of root.querySelectorAll('.tabs button')) b.classList.toggle('active', b.dataset.f === filter)
    sessionStorage.setItem('jarvis:sfilter', filter)
    try {
      const html = await listBody(filter)
      if (!ctx.isCurrent()) return
      body.innerHTML = html
    } catch (e) {
      if (!ctx.isCurrent()) return
      body.innerHTML = `<div class="empty">erro: ${esc(e.message)}</div>`
    }
  }
  await paint()

  if (ctx.isCurrent()) {
    const timer = setInterval(() => filter !== 'cli' && paint(), 10000)
    ctx.onLeave(() => clearInterval(timer))
  }

  root.addEventListener('click', async (e) => {
    const tab = e.target.closest('[data-f]')
    if (tab) {
      filter = tab.dataset.f
      return void paint()
    }
    if (e.target.closest('[data-new]')) return void openSessionDialog()
    const imp = e.target.closest('[data-import]')
    if (imp) {
      imp.disabled = true
      const s = await guard(
        () => api('/api/sessions', { method: 'POST', body: { resume: imp.dataset.import, cwd: imp.dataset.cwd || undefined } }),
        'sessão importada',
      )
      imp.disabled = false
      if (s?.id) location.hash = `#/s/${s.id}`
      return
    }
    const go = e.target.closest('[data-go]')
    if (go) location.hash = go.dataset.go
  })
}

// ==========================================================================
// Chat
// ==========================================================================
const headHtml = (s, modelOpts) => `<div class="chat-head">
  <span class="dot ${esc(s.state)}" data-el="dot"></span><b data-el="state">${esc(s.state)}</b>
  <span class="dim" title="${esc(s.cwd || '')}">${esc(shortPath(s.cwd))}</span>
  <select data-el="mode" aria-label="modo de permissão">${MODES.map(
    ([v, l]) => `<option value="${v}"${s.permissionMode === v ? ' selected' : ''}>${esc(l)}</option>`,
  ).join('')}</select>
  <select data-el="model" aria-label="modelo">${modelOpts}</select>
  <span class="ctx"><small data-el="ctxt">contexto —</small><span class="meter"><i data-el="ctxbar" style="width:0%"></i></span></span>
  <span class="pill" data-el="cost">${esc(fmtUsd(s.usage?.costUsd))}</span>
  <button class="btn sm" data-act="interrupt">interromper</button>
  <button class="btn sm" data-act="handoff">abrir no CLI</button>
  <button class="btn sm err" data-act="archive">arquivar</button>
</div>`

async function chat(root, id, ctx) {
  setCrumb('Sessão')
  let s
  try {
    s = await api(`/api/sessions/${encodeURIComponent(id)}`)
  } catch (e) {
    if (!ctx.isCurrent()) return
    root.innerHTML = `<div class="card"><h2>sessão</h2><p class="dim">${esc(e.message)}</p><a class="btn" href="#/sessions">voltar</a></div>`
    return
  }
  if (!ctx.isCurrent()) return
  setCrumb(s.title || 'Sessão')

  const ms = await models().catch(() => [])
  if (!ctx.isCurrent()) return

  root.innerHTML = `<div class="sessions-layout with-chat">
    <div class="list-col" data-el="side"><div class="empty">carregando…</div></div>
    <div class="chat">
      ${headHtml(s, modelOptions(ms, s.model))}
      <div class="log" data-el="log"></div>
      <form class="composer" data-el="composer">
        <textarea data-el="input" rows="1" placeholder="mensagem…" title="Enter envia · Shift+Enter quebra linha"></textarea>
        <button class="btn primary" type="submit" aria-label="enviar">↑</button>
      </form>
    </div>
  </div>`

  const $ = (k) => root.querySelector(`[data-el="${k}"]`)
  const log = $('log')
  const input = $('input')

  // lista lateral (≥1280px)
  api('/api/sessions')
    .then((rows) => {
      if (!ctx.isCurrent()) return
      $('side').innerHTML = `<ul class="list">${rows
        .map((r) => rowHtml(r).replace('<li class="link"', `<li class="link${r.id === id ? ' cur' : ''}"`))
        .join('')}</ul>`
    })
    .catch(() => ctx.isCurrent() && ($('side').innerHTML = ''))

  // --- estado de render ---------------------------------------------------
  const tools = new Map() // tool_use_id → elemento <details>
  const perms = new Map() // permission id → elemento .perm
  let streamEl = null
  let streamText = ''
  let thinkEl = null
  let dropEl = null // última linha "conexão caiu" (não empilhar)
  let usage = s.usage || {}
  let state = s.state
  let live = Boolean(s.live)

  const isDead = () => !live || DEAD.has(state)

  const atBottom = () => log.scrollHeight - log.scrollTop - log.clientHeight < 80
  function push(el) {
    if (!el) return null
    const stick = atBottom()
    log.append(el)
    if (stick) log.scrollTop = log.scrollHeight
    return el
  }

  /** Permissão de sessão morta não tem para quem responder. */
  function expirePerms() {
    for (const el of perms.values()) {
      if (el.classList.contains('done')) continue
      el.classList.add('done')
      const st = el.querySelector('[data-el="permstate"]')
      st.hidden = false
      st.textContent = '⏱ expirada (sessão encerrada)'
    }
  }

  function setState(next, opts = {}) {
    state = next
    if (!DEAD.has(next)) live = true
    else if (opts.stored) live = false
    $('state').textContent = next
    $('dot').className = `dot ${next}`
    input.placeholder = next === 'queued' ? 'na fila — entra quando um slot liberar' : 'mensagem…'
    $('composer').classList.toggle('queued', next === 'queued')
    if (DEAD.has(next)) expirePerms()
  }

  function setUsage(u) {
    usage = u || usage
    const p = pct(usage.contextTokens, usage.contextWindow)
    $('ctxt').textContent = `contexto ${p}% · ${fmtTokens(usage.contextTokens)}/${fmtTokens(usage.contextWindow)}`
    $('ctxbar').style.width = `${p}%`
    $('ctxbar').parentElement.className = `meter${p >= 90 ? ' err' : p >= 70 ? ' warn' : ''}`
    $('cost').textContent = fmtUsd(usage.costUsd)
  }

  // --- blocos -------------------------------------------------------------
  const textOf = (c) =>
    typeof c === 'string'
      ? c
      : Array.isArray(c)
        ? c.map((b) => (typeof b === 'string' ? b : b?.text ?? b?.content ?? '')).join('\n')
        : String(c ?? '')

  function toolBlock(b) {
    const sum = summarize(b.input)
    const el = node(`<details class="tool">
      <summary><span class="n">${esc(b.name || 'tool')}</span><span class="s">${esc(sum)}</span></summary>
      <pre>${esc(pretty(b.input))}</pre>
    </details>`)
    if (b.id) tools.set(b.id, el)
    return el
  }

  function toolResult(b) {
    const el = tools.get(b.tool_use_id)
    const txt = textOf(b.content)
    const res = node(`<div class="res"><pre>${esc(txt.length > 4000 ? txt.slice(0, 4000) + '\n…' : txt)}</pre></div>`)
    if (b.is_error) res.classList.add('err')
    if (el) el.append(res)
    else push(node('<div class="tool"></div>')).append(res)
  }

  /**
   * toolsOnly: as mensagens `user` do SDK são eco do que já mostramos via
   * user_text (e no resume vêm com isReplay) — só o tool_result interessa.
   */
  function renderBlocks(role, content, { toolsOnly = false } = {}) {
    const blocks = Array.isArray(content) ? content : [{ type: 'text', text: textOf(content) }]
    for (const b of blocks) {
      if (!b) continue
      if (b.type === 'tool_result') {
        toolResult(b)
        continue
      }
      if (toolsOnly) continue
      if (b.type === 'text' && b.text?.trim()) {
        if (role === 'user') push(node('<div class="msg user"></div>')).textContent = b.text
        else void enhance(push(node(`<div class="msg assistant">${md(b.text)}</div>`)))
      } else if (b.type === 'thinking' && (b.thinking || b.text)) {
        push(node('<div class="thinking"></div>')).textContent = b.thinking || b.text
      } else if (b.type === 'tool_use') {
        push(toolBlock(b))
      }
    }
  }

  function permCard(e) {
    const el = node(`<div class="perm" data-perm="${esc(e.id)}">
      <div class="t">permissão: ${esc(e.toolName || 'ferramenta')}</div>
      ${e.title ? `<div>${esc(e.title)}</div>` : ''}
      ${e.description ? `<small class="dim">${esc(e.description)}</small>` : ''}
      ${e.decisionReason ? `<small class="dim">motivo: ${esc(e.decisionReason)}</small>` : ''}
      <pre>${esc(pretty(e.input))}</pre>
      <div class="btns">
        <button class="btn sm ok" data-perm-act="allow">permitir</button>
        <button class="btn sm" data-perm-act="always">sempre</button>
        <button class="btn sm err" data-perm-act="deny">negar</button>
      </div>
      <small class="dim" data-el="permstate" hidden></small>
    </div>`)
    perms.set(e.id, el)
    return el
  }

  function resolvePerm(id, behavior) {
    const el = perms.get(id)
    if (!el) return
    el.classList.add('done')
    const st = el.querySelector('[data-el="permstate"]')
    st.hidden = false
    st.textContent = behavior === 'allow' ? '✓ permitido' : '✕ negado'
  }

  // --- streaming ----------------------------------------------------------
  function streamDelta(kind, text) {
    if (!text) return
    if (kind === 'thinking') {
      if (!thinkEl) thinkEl = push(node('<div class="thinking"></div>'))
      thinkEl.textContent += text
      return
    }
    streamText += text
    if (!streamEl) streamEl = push(node('<div class="msg assistant streaming"></div>'))
    streamEl.innerHTML = md(streamText)
    if (atBottom()) log.scrollTop = log.scrollHeight
  }
  /** A mensagem final re-renderiza texto e thinking: o preview do stream sai. */
  function endStream() {
    streamEl?.remove()
    thinkEl?.remove()
    streamEl = null
    streamText = ''
    thinkEl = null
  }

  // --- SSE ----------------------------------------------------------------
  const stream = openStream(id, {
    since: 0,
    handlers: {
      user_text: (e) => {
        endStream()
        dropEl = null
        push(node('<div class="msg user"></div>')).textContent = e.text || ''
      },
      history: (e) => {
        for (const m of e.messages || []) renderBlocks(m.role, m.content)
        push(node('<div class="msg sys">— histórico importado do CLI —</div>'))
      },
      sdk: (e) => {
        const m = e.msg || {}
        if (m.type === 'stream_event') {
          const ev = m.event || {}
          if (ev.type === 'content_block_delta') {
            const d = ev.delta || {}
            if (d.type === 'text_delta') streamDelta('text', d.text)
            else if (d.type === 'thinking_delta') streamDelta('thinking', d.thinking)
          }
          return
        }
        if (m.type === 'user') {
          // eco do input (isReplay ou não): o texto já veio em user_text
          renderBlocks('user', m.message?.content, { toolsOnly: true })
          return
        }
        if (m.isReplay) return
        if (m.type === 'system' && m.subtype === 'init') {
          push(node(`<div class="msg sys">init · ${esc(m.model || '')} · ${esc(shortPath(m.cwd))}</div>`))
          return
        }
        if (m.type === 'assistant') {
          endStream()
          renderBlocks('assistant', m.message?.content)
          return
        }
        if (m.type === 'result') {
          endStream()
          const bits = [
            m.subtype || (m.is_error ? 'erro' : 'ok'),
            Number.isFinite(m.num_turns) ? `${m.num_turns} turnos` : null,
            Number.isFinite(m.duration_ms) ? `${(m.duration_ms / 1000).toFixed(1)}s` : null,
            Number.isFinite(m.total_cost_usd) ? fmtUsd(m.total_cost_usd) : null,
          ].filter(Boolean)
          push(node(`<div class="result${m.is_error ? ' err' : ''}">${esc(bits.join(' · '))}</div>`))
        }
      },
      permission_request: (e) => {
        endStream()
        push(permCard(e))
      },
      permission_resolved: (e) => resolvePerm(e.id, e.behavior),
      status: (e) => setState(e.state, { stored: e.stored }),
      usage: (e) => setUsage(e.usage),
      config: (e) => {
        if (e.permissionMode) $('mode').value = e.permissionMode
        if (e.model !== undefined) selectModel($('model'), ms, e.model)
      },
      error: (e) => push(node('<div class="msg err"></div>')).textContent = e.error || 'erro',
    },
    onDrop: () => {
      if (dropEl && log.lastElementChild === dropEl) return // não empilha
      dropEl = push(node('<div class="msg sys">— conexão caiu, reconectando —</div>'))
    },
    onGone: () => {
      setState('closed', { stored: true })
      push(node('<div class="msg sys">— sessão não existe mais no servidor —</div>'))
    },
  })
  ctx.onLeave(() => stream.close())

  setState(state, { stored: !s.live })
  setUsage(usage)

  // --- interações ---------------------------------------------------------
  $('mode').addEventListener('change', async (e) => {
    await guard(() => api(`/api/sessions/${encodeURIComponent(id)}/mode`, { method: 'POST', body: { mode: e.target.value } }), `modo: ${e.target.value}`)
  })
  $('model').addEventListener('change', async (e) => {
    await guard(() => api(`/api/sessions/${encodeURIComponent(id)}/model`, { method: 'POST', body: { model: e.target.value || undefined } }), 'modelo trocado')
  })

  root.addEventListener('click', async (e) => {
    const go = e.target.closest('[data-go]')
    if (go) return void (location.hash = go.dataset.go)

    const pAct = e.target.closest('[data-perm-act]')
    if (pAct) {
      const card = pAct.closest('[data-perm]')
      const pid = card.dataset.perm
      const kind = pAct.dataset.permAct
      const body = { behavior: kind === 'deny' ? 'deny' : 'allow', always: kind === 'always' }
      for (const b of card.querySelectorAll('button')) b.disabled = true
      const ok = await guard(() => api(`/api/sessions/${encodeURIComponent(id)}/permissions/${encodeURIComponent(pid)}`, { method: 'POST', body }))
      if (ok) {
        resolvePerm(pid, body.behavior)
        if (isMock()) stream.raw?.fire?.('permission_resolved', { id: pid, behavior: body.behavior })
      } else for (const b of card.querySelectorAll('button')) b.disabled = false
      void refreshLive()
      return
    }

    const act = e.target.closest('[data-act]')?.dataset.act
    if (act === 'interrupt') {
      await guard(() => api(`/api/sessions/${encodeURIComponent(id)}/interrupt`, { method: 'POST' }), 'interrompido')
    } else if (act === 'handoff') {
      const r = await guard(() => api(`/api/sessions/${encodeURIComponent(id)}/handoff`, { method: 'POST', body: { openPane: true } }))
      if (r) {
        push(node(`<div class="tool handoff"><div class="t">sessão entregue ao CLI${r.pane?.paneId ? ` · pane ${esc(r.pane.paneId)}` : ''}</div>
          <pre>${esc(r.command)}</pre><small class="dim">cwd: ${esc(r.cwd || '—')}</small></div>`))
        setState('handed-off', { stored: true })
        toast('sessão aberta no CLI', 'ok')
      }
    } else if (act === 'archive') {
      if (!confirm('arquivar esta sessão?')) return
      const ok = await guard(() => api(`/api/sessions/${encodeURIComponent(id)}?archive=1`, { method: 'DELETE' }), 'sessão arquivada')
      if (ok) location.hash = '#/sessions'
    }
  })

  const send = async () => {
    const text = input.value.trim()
    if (!text) return
    // Sessão gravada: o POST revive o processo, mas o SSE aberto ficou preso no
    // stream antigo — reabrimos a partir do último seq assim que ele responde.
    const needsRevive = isDead()
    input.value = ''
    input.style.height = 'auto'
    const r = await guard(() => api(`/api/sessions/${encodeURIComponent(id)}/messages`, { method: 'POST', body: { text } }))
    if (!r) {
      input.value = text
      return
    }
    live = true
    if (r.state) setState(r.state)
    if (needsRevive) stream.reconnect(stream.lastSeq)
    void refreshLive()
  }
  $('composer').addEventListener('submit', (e) => {
    e.preventDefault()
    void send()
  })
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault()
      void send()
    }
  })
  input.addEventListener('input', () => {
    input.style.height = 'auto'
    input.style.height = Math.min(160, input.scrollHeight) + 'px'
  })
  setTimeout(() => ctx.isCurrent() && input.focus({ preventScroll: true }), 50)
}

// --- helpers ---------------------------------------------------------------
function pretty(v) {
  if (v === null || v === undefined) return '—'
  if (typeof v === 'string') return v
  try {
    return JSON.stringify(v, null, 2)
  } catch {
    return String(v)
  }
}
function summarize(input) {
  if (!input || typeof input !== 'object') return ''
  const k = input.file_path || input.path || input.command || input.pattern || input.url || input.prompt
  const s = typeof k === 'string' ? k : ''
  return s.length > 90 ? s.slice(0, 90) + '…' : s
}
