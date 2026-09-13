// app.js — bootstrap do Jarvis: router por hash, api(), SSE, toasts, dialog de
// nova sessão e o badge de sessões vivas. Vanilla ES modules, sem build.

// --------------------------------------------------------------------------
// Modo mock (protótipo navegável sem backend) — ?mock=1 persiste na aba; o
// servidor em JARVIS_MOCK=1 (pnpm start:mock) liga pela meta `jarvis-mock`.
// --------------------------------------------------------------------------
const MOCK_KEY = 'jarvis:mock'
{
  const q = new URLSearchParams(location.search)
  const forced = Boolean(document.querySelector('meta[name="jarvis-mock"]'))
  if (q.get('mock') === '0') sessionStorage.removeItem(MOCK_KEY)
  else if (q.has('mock') || forced) sessionStorage.setItem(MOCK_KEY, '1')
}
export const isMock = () => sessionStorage.getItem(MOCK_KEY) === '1'
let mockMod = null
const mock = async () => (mockMod ||= await import('./mock.js'))

// --------------------------------------------------------------------------
// Token da API (JARVIS_TOKEN, obrigatório fora do loopback). Entra uma vez por
// ?token=… — some da URL na hora — e fica em localStorage. Sem ele o servidor
// responde 401 e api() pede o token na tela.
// --------------------------------------------------------------------------
const TOKEN_KEY = 'jarvis:token'
const storage = {
  get: () => {
    try {
      return localStorage.getItem(TOKEN_KEY) || ''
    } catch {
      return ''
    }
  },
  set: (t) => {
    try {
      t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY)
    } catch {
      /* storage bloqueado: vale só para esta página */
    }
  },
}
{
  const q = new URLSearchParams(location.search)
  if (q.has('token')) {
    storage.set(q.get('token').trim())
    q.delete('token')
    history.replaceState(null, '', location.pathname + (q.size ? `?${q}` : '') + location.hash)
  }
}
export const getToken = () => storage.get()
export const setToken = (t) => storage.set(String(t ?? '').trim())
/** Acrescenta ?token= — para o EventSource, que não manda header. */
export const withToken = (url) => {
  const t = getToken()
  return t ? `${url}${url.includes('?') ? '&' : '?'}token=${encodeURIComponent(t)}` : url
}
let asking = null
/** Um prompt só, mesmo com várias chamadas tomando 401 ao mesmo tempo. */
function askToken() {
  asking ||= Promise.resolve()
    .then(() => {
      const given = window.prompt('Jarvis: token de acesso (JARVIS_TOKEN do servidor)')
      const t = String(given ?? '').trim()
      if (t) setToken(t)
      return Boolean(t)
    })
    .finally(() => (asking = null))
  return asking
}

// --------------------------------------------------------------------------
// Utilitários
// --------------------------------------------------------------------------
export const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])

/** "—" para tudo que estiver vazio: nada aqui quebra por campo ausente. */
export const dash = (v) => (v === 0 ? '0' : v === null || v === undefined || v === '' ? '—' : v)

const usdFmt = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 })
const usdFine = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'USD', maximumFractionDigits: 4 })
export const fmtUsd = (v) => (Number.isFinite(Number(v)) ? (Math.abs(v) < 1 ? usdFine.format(v) : usdFmt.format(v)) : '—')
export const fmtInt = (v) => (Number.isFinite(Number(v)) ? new Intl.NumberFormat('pt-BR').format(Math.round(v)) : '—')
export function fmtTokens(v) {
  const n = Number(v)
  if (!Number.isFinite(n)) return '—'
  if (n >= 1e9) return (n / 1e9).toFixed(1).replace('.', ',') + 'B'
  if (n >= 1e6) return (n / 1e6).toFixed(1).replace('.', ',') + 'M'
  if (n >= 1e3) return Math.round(n / 1e3) + 'k'
  return String(n)
}
export function shortPath(p, keep = 2) {
  if (!p) return '—'
  const parts = String(p).split('/').filter(Boolean)
  return (parts.length > keep ? '…/' : '/') + parts.slice(-keep).join('/')
}
export function relTime(ts) {
  const n = Number(ts)
  if (!Number.isFinite(n) || !n) return '—'
  const d = Math.round((Date.now() - n) / 1000)
  if (d < 60) return 'agora'
  if (d < 3600) return `há ${Math.floor(d / 60)} min`
  if (d < 86400) return `há ${Math.floor(d / 3600)} h`
  return `há ${Math.floor(d / 86400)} d`
}
/** "reseta em 14:30 · 2h24" — aceita ISO ou epoch. */
export function resetIn(when) {
  if (!when) return '—'
  const t = typeof when === 'number' ? when : Date.parse(when)
  if (!Number.isFinite(t)) return '—'
  const hhmm = new Date(t).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
  const diff = t - Date.now()
  if (diff <= 0) return `reseta em ${hhmm}`
  const h = Math.floor(diff / 3600000)
  const m = Math.floor((diff % 3600000) / 60000)
  const d = Math.floor(h / 24)
  const gap = d >= 1 ? `${d}d${h % 24}h` : h >= 1 ? `${h}h${String(m).padStart(2, '0')}` : `${m}min`
  return `reseta em ${hhmm} · ${gap}`
}
export const pct = (part, whole) => (whole ? Math.min(100, Math.round((Number(part) / Number(whole)) * 100)) : 0)

// --------------------------------------------------------------------------
// Markdown — o texto vem de um modelo e de arquivos do vault: nada de HTML cru
// --------------------------------------------------------------------------
let markedReady = false
function setupMarked() {
  if (markedReady || !globalThis.marked) return
  markedReady = true
  // Descarta tokens de HTML bruto (bloco e inline); fences de código continuam.
  try {
    globalThis.marked.use({ renderer: { html: () => '' } })
  } catch {
    /* versão sem use(): a limpeza de DOM abaixo ainda cobre */
  }
}

const DANGEROUS = 'script,iframe,object,embed,link,meta,style,form,base,svg,math'
const BAD_URL = /^\s*(javascript|vbscript|data):/i

/** Segunda tranca: varre o HTML já convertido e remove o que pode executar. */
function sanitize(html) {
  const t = document.createElement('template')
  t.innerHTML = String(html ?? '')
  for (const el of t.content.querySelectorAll(DANGEROUS)) el.remove()
  for (const el of t.content.querySelectorAll('*')) {
    for (const at of [...el.attributes]) {
      const name = at.name.toLowerCase()
      if (name.startsWith('on') || name === 'srcdoc' || name === 'style') el.removeAttribute(at.name)
      else if ((name === 'href' || name === 'src' || name === 'xlink:href') && BAD_URL.test(at.value)) el.removeAttribute(at.name)
    }
    if (el.tagName === 'A' && el.getAttribute('href')) {
      el.setAttribute('target', '_blank')
      el.setAttribute('rel', 'noopener noreferrer')
    }
  }
  return t.innerHTML
}

/** marked + sanitização; converte [[wikilinks]] antes de renderizar. */
export function md(text) {
  const src = String(text ?? '')
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2')
    .replace(/\[\[([^\]]+)\]\]/g, '$1')
  try {
    setupMarked()
    return globalThis.marked ? sanitize(globalThis.marked.parse(src, { gfm: true, breaks: true })) : esc(src)
  } catch {
    return esc(src)
  }
}

/** Cria um nó a partir de uma string de HTML. */
export function node(html) {
  const t = document.createElement('template')
  t.innerHTML = String(html).trim()
  return t.content.firstElementChild
}

export const bus = new EventTarget()

// --------------------------------------------------------------------------
// API
// --------------------------------------------------------------------------
export async function api(path, opts = {}) {
  if (isMock()) {
    const { mockApi } = await mock()
    return mockApi(path, opts)
  }
  const { retried, ...rest } = opts
  const init = { headers: {}, ...rest }
  if (init.body && typeof init.body !== 'string') {
    init.body = JSON.stringify(init.body)
    init.headers['content-type'] = 'application/json'
  } else if (init.body) init.headers['content-type'] = 'application/json'
  const token = getToken()
  if (token) init.headers['x-jarvis-token'] = token
  const res = await fetch(path, init)
  if (res.status === 401 && !retried && (await askToken())) return api(path, { ...opts, retried: true })
  const txt = await res.text()
  let data = null
  try {
    data = txt ? JSON.parse(txt) : null
  } catch {
    throw new Error(`resposta inválida (${res.status})`)
  }
  if (!res.ok || (data && data.error)) {
    const err = new Error((data && data.error) || `erro ${res.status}`)
    err.status = res.status
    throw err
  }
  return data
}

/**
 * Stream de eventos da sessão. Reconecta com backoff a partir do último seq e
 * ignora duplicatas do replay. handlers = { kind: fn(evento) }.
 * reconnect() força uma reabertura — é o que acorda o stream de uma sessão
 * gravada depois que o servidor a revive.
 */
export function openStream(sessionId, { since = 0, handlers = {}, onOpen, onDrop, onGone } = {}) {
  let es = null
  let last = Number(since) || 0
  let closed = false
  let gone = false
  let retry = null
  let delay = 1500
  let fails = 0

  const wire = (src) => {
    for (const [kind, fn] of Object.entries(handlers)) {
      src.addEventListener(kind, (ev) => {
        if (!ev.data) return
        let e
        try {
          e = JSON.parse(ev.data)
        } catch {
          return
        }
        // `stored` é o status sintético do servidor: reusa o último seq de propósito.
        if (e.seq && e.seq <= last && !e.stored) return
        if (e.seq && e.seq > last) last = e.seq
        fn(e)
      })
    }
  }

  /** Falhou de novo sem nunca abrir: a sessão pode ter sumido (404). */
  const checkGone = async () => {
    if (fails < 2) return false
    try {
      await api(`/api/sessions/${encodeURIComponent(sessionId)}`)
      return false
    } catch (e) {
      if (e?.status === 404) {
        gone = true
        onGone?.()
        return true
      }
      return false
    }
  }

  const connect = async () => {
    if (closed || gone) return
    if (isMock()) {
      const { MockEventSource } = await mock()
      if (closed || gone) return
      es = new MockEventSource(`mock:${sessionId}`, { since: last, sessionId })
      wire(es)
      onOpen?.(es)
      return
    }
    const src = new EventSource(withToken(`/api/sessions/${encodeURIComponent(sessionId)}/events?since=${last}`))
    es = src
    wire(src)
    src.onopen = () => {
      fails = 0
      delay = 1500
      onOpen?.(src)
    }
    src.onerror = async (ev) => {
      if (closed || gone) return
      // O evento SSE nomeado `error` (kind lógico) também cai aqui: tem .data.
      if (ev && ev.data !== undefined) return
      // Deixa a reconexão nativa em paz só se ela não fechou o canal; senão
      // refazemos nós, para a URL levar o ?since atualizado.
      src.close()
      fails++
      onDrop?.()
      if (await checkGone()) return
      if (closed) return
      retry = setTimeout(connect, delay)
      delay = Math.min(30000, Math.round(delay * 1.6))
    }
  }
  void connect()

  return {
    get lastSeq() {
      return last
    },
    get raw() {
      return es
    },
    /** Reabre agora, a partir de fromSeq (padrão: o último seq visto). */
    reconnect(fromSeq) {
      if (closed || gone) return
      clearTimeout(retry)
      es?.close?.()
      if (Number.isFinite(Number(fromSeq))) last = Number(fromSeq)
      fails = 0
      delay = 1500
      void connect()
    },
    close() {
      closed = true
      clearTimeout(retry)
      es?.close?.()
    },
  }
}

// --------------------------------------------------------------------------
// Toasts
// --------------------------------------------------------------------------
const toastBox = document.getElementById('toasts')
export function toast(msg, kind = '') {
  const el = document.createElement('div')
  el.className = `toast ${kind}`.trim()
  el.textContent = String(msg)
  toastBox.append(el)
  setTimeout(() => el.remove(), kind === 'err' ? 6000 : 3200)
  return el
}
/** Envolve uma ação: mostra erro como toast e devolve null em vez de explodir. */
export async function guard(fn, okMsg) {
  try {
    const v = await fn()
    if (okMsg) toast(okMsg, 'ok')
    return v
  } catch (e) {
    toast(e?.message || String(e), 'err')
    return null
  }
}

// --------------------------------------------------------------------------
// Estado compartilhado (leve)
// --------------------------------------------------------------------------
export const state = { models: [], settings: null, projects: null, live: null }

export async function models() {
  if (state.models.length) return state.models
  const ov = await api('/api/overview').catch(() => null)
  state.models = ov?.models || []
  state.settings = ov?.settings || state.settings
  return state.models
}

/** Opções do <select> de modelo: o servidor devolve id resolvido em `model`. */
export function modelOptions(ms, current, blankLabel = 'modelo padrão') {
  const cur = current == null ? '' : String(current)
  const match = (m) => m.id === cur || m.resolved === cur
  const known = (ms || []).some(match)
  return (
    `<option value="">${esc(blankLabel)}</option>` +
    (ms || [])
      .map((m) => `<option value="${esc(m.id)}" title="${esc(m.description || '')}"${match(m) ? ' selected' : ''}>${esc(m.label || m.id)}</option>`)
      .join('') +
    (cur && !known ? `<option value="${esc(cur)}" selected>${esc(cur)}</option>` : '')
  )
}

/** Seleciona no <select> o modelo atual, criando a opção se ela não existir. */
export function selectModel(sel, ms, value) {
  const cur = value == null ? '' : String(value)
  if (!cur) {
    sel.value = ''
    return
  }
  const hit = (ms || []).find((m) => m.id === cur || m.resolved === cur)
  const wanted = hit ? hit.id : cur
  if (![...sel.options].some((o) => o.value === wanted)) sel.append(new Option(wanted, wanted))
  sel.value = wanted
}

// --------------------------------------------------------------------------
// Badge de sessões vivas
// --------------------------------------------------------------------------
const badge = document.getElementById('badge-live')
let badgeTimer = null
export async function refreshLive() {
  try {
    const [sessions, settings] = await Promise.all([api('/api/sessions'), api('/api/settings')])
    const running = sessions.filter((s) => s.state === 'running').length
    const queued = sessions.filter((s) => s.state === 'queued').length
    const pend = sessions.reduce((a, s) => a + (s.pendingPermissions || 0), 0)
    state.settings = settings
    state.live = { sessions, running, queued, pending: pend, maxRunning: settings?.maxRunning ?? 0 }
    badge.textContent = `${running}/${settings?.maxRunning ?? '—'}`
    badge.title = `${running} rodando · ${queued} na fila · ${pend} permissões pendentes`
    badge.classList.toggle('hot', pend > 0 || (settings?.maxRunning && running >= settings.maxRunning))
    bus.dispatchEvent(new CustomEvent('live', { detail: state.live }))
  } catch {
    /* badge é decorativo: falha em silêncio */
  }
}
function startBadge() {
  clearInterval(badgeTimer)
  void refreshLive()
  badgeTimer = setInterval(refreshLive, 8000)
}

// --------------------------------------------------------------------------
// Dialog de nova sessão
// --------------------------------------------------------------------------
const dlg = document.getElementById('dlg-session')
const form = document.getElementById('form-session')
const nsProject = document.getElementById('ns-project')
const nsCwd = document.getElementById('ns-cwd')
const nsModel = document.getElementById('ns-model')
const nsMode = document.getElementById('ns-mode')
const nsPrompt = document.getElementById('ns-prompt')
let dlgFilled = false

async function fillDialog() {
  if (dlgFilled) return
  const [projects, ms] = await Promise.all([api('/api/projects'), models()])
  const opts = []
  for (const p of projects || []) {
    opts.push(`<option value="${esc(p.path)}">${esc(p.name)}</option>`)
    for (const sp of p.subprojects || []) opts.push(`<option value="${esc(sp.path)}">&nbsp;&nbsp;↳ ${esc(sp.name)}</option>`)
  }
  opts.push('<option value="">outro cwd…</option>')
  nsProject.innerHTML = opts.join('')
  nsModel.innerHTML = modelOptions(ms, '', 'padrão')
  if (state.settings?.defaultPermissionMode) nsMode.value = state.settings.defaultPermissionMode
  state.projects = projects
  dlgFilled = true // só depois do sucesso: uma falha pode ser tentada de novo
}

export async function openSessionDialog(cwd) {
  try {
    await fillDialog()
  } catch (e) {
    toast(`projetos indisponíveis: ${e?.message || e}`, 'err')
    if (!nsProject.options.length) nsProject.innerHTML = '<option value="">outro cwd…</option>'
  }
  if (cwd) {
    const hit = [...nsProject.options].find((o) => o.value === cwd)
    nsProject.value = hit ? cwd : ''
  }
  nsCwd.value = cwd || nsProject.value || state.settings?.defaultCwd || ''
  nsPrompt.value = ''
  dlg.showModal()
}

nsProject.addEventListener('change', () => {
  if (nsProject.value) nsCwd.value = nsProject.value
  else nsCwd.focus()
})
document.getElementById('ns-cancel').addEventListener('click', () => dlg.close())
form.addEventListener('submit', async (e) => {
  e.preventDefault()
  const body = {
    cwd: nsCwd.value.trim() || undefined,
    permissionMode: nsMode.value,
    model: nsModel.value || undefined,
    prompt: nsPrompt.value.trim() || undefined,
  }
  dlg.close()
  const s = await guard(() => api('/api/sessions', { method: 'POST', body }), 'sessão criada')
  if (s?.id) {
    void refreshLive()
    location.hash = `#/s/${s.id}`
  }
})
document.getElementById('new-session').addEventListener('click', () => void openSessionDialog())

// --------------------------------------------------------------------------
// Router
// --------------------------------------------------------------------------
const viewEl = document.getElementById('view')
const crumbEl = document.getElementById('crumb')
const backEl = document.getElementById('back')
const sideFoot = document.getElementById('side-foot')

const ROUTES = [
  { re: /^\/?$/, mod: './views/home.js', nav: 'home', crumb: '' },
  { re: /^\/sessions\/?$/, mod: './views/sessions.js', nav: 'sessions', crumb: 'Sessões' },
  { re: /^\/s\/([^/]+)$/, mod: './views/sessions.js', nav: 'sessions', crumb: 'Sessão', detail: true, keys: ['id'], parent: '#/sessions' },
  { re: /^\/projects\/?$/, mod: './views/projects.js', nav: 'projects', crumb: 'Projetos' },
  { re: /^\/plans\/?$/, mod: './views/plans.js', nav: 'plans', crumb: 'Planos' },
  { re: /^\/plans\/([^/?]+)\/([^/?]+)(?:\?([^#]*))?$/, mod: './views/plans.js', nav: 'plans', crumb: 'Plano', detail: true, keys: ['vault', 'slug', 'query'], parent: '#/plans' },
]

let leaving = []
let token = 0

/** Limpeza da rota corrente. Se a rota já mudou, roda na hora (nada vaza). */
export function onLeave(fn, routeToken = token) {
  if (routeToken !== token) {
    try {
      fn()
    } catch {
      /* ignora */
    }
    return
  }
  leaving.push(fn)
}
export function setCrumb(text) {
  crumbEl.textContent = text || ''
}

let currentDetail = false
let currentParent = '#/'
function syncBack() {
  backEl.hidden = !(currentDetail && window.innerWidth < 1280)
}
backEl.addEventListener('click', () => {
  location.hash = currentParent || '#/'
})
window.addEventListener('resize', syncBack)

async function route() {
  const my = ++token
  for (const fn of leaving.splice(0)) {
    try {
      fn()
    } catch {
      /* ignora */
    }
  }
  const path = (location.hash || '#/').slice(1) || '/'
  const hit = ROUTES.find((r) => r.re.test(path)) || ROUTES[0]
  const m = hit.re.exec(path) || []
  const params = {}
  ;(hit.keys || []).forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1] ?? '')))

  currentDetail = Boolean(hit.detail)
  currentParent = hit.parent || '#/'
  syncBack()
  setCrumb(hit.crumb)
  for (const a of document.querySelectorAll('[data-nav]')) a.classList.toggle('active', a.dataset.nav === hit.nav)

  const root = document.createElement('div')
  root.className = 'route'
  root.innerHTML = '<div class="empty">carregando…</div>'
  viewEl.replaceChildren(root)
  viewEl.scrollTop = 0

  // Contexto da rota: as views checam isCurrent() antes de criar timers/streams
  // e registram a limpeza com o token delas, não com o token "de agora".
  const ctx = {
    token: my,
    isCurrent: () => my === token,
    onLeave: (fn) => onLeave(fn, my),
  }

  try {
    const mod = await import(hit.mod)
    if (my !== token) return
    await mod.render(root, params, ctx)
  } catch (e) {
    if (my !== token) return
    console.error(e)
    root.innerHTML = `<div class="card"><h2>erro</h2><p class="dim">${esc(e?.message || e)}</p></div>`
  }
}

window.addEventListener('hashchange', route)

// --------------------------------------------------------------------------
// Rodapé da sidebar (conta) + boot
// --------------------------------------------------------------------------
async function footer() {
  const ov = await api('/api/overview').catch(() => null)
  if (!ov) return
  state.models = ov.models || []
  state.settings = ov.settings || state.settings
  const a = ov.account || {}
  sideFoot.innerHTML = `${esc(a.email || 'conta —')}<br><span class="dim">${esc(a.subscription || a.apiKeySource || 'sem plano')}${
    isMock() ? ' · <b>mock</b>' : ''
  }</span>`
}

void route()
startBadge()
void footer()
if (isMock()) toast('modo protótipo: dados fictícios (mock)')
