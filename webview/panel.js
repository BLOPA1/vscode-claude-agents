(function () {
  'use strict'
  const vscode = typeof acquireVsCodeApi === 'function' ? acquireVsCodeApi() : null
  const app = document.getElementById('app')
  const init = window.__INIT__ || {}
  if (init.inEditor) document.body.classList.add('in-editor')
  const saved = (vscode && vscode.getState && vscode.getState()) || {}
  const ui = Object.assign({ tab: 'overview', chatId: null, nodeId: null, filter: 'active', hideDone: false }, init, saved)
  let snap = window.__SNAPSHOT__ || null
  let receivedAt = Date.now()

  // ── textos (el idioma lo decide el host y llega en cada snapshot) ──
  const pl = (n, one, many) => (n === 1 ? one : many)
  const L = {
    en: {
      title: 'Claude Agents', overview: 'Overview', chats: 'Chats', loading: 'Loading…', popout: 'Open in an editor tab',
      account: 'Account', name: 'Name', email: 'Account', org: 'Organization', role: 'Role', modelsToday: 'Models today',
      noAccount: 'No account data found in <code>.claude.json</code>.',
      nowAndToday: 'Now and today', now: 'Now', today: 'Today', chatsWorking: 'Chats working', agentsWorking: 'Agents working',
      waitApproval: 'Awaiting approval', tChats: 'Chats', tAgents: 'Agents', tokensOut: 'Tokens generated', tools: 'Tools',
      nWorking: n => `${n} working`, nAgents: n => `${n} ${pl(n, 'agent', 'agents')}`, waitingChip: 'awaiting approval',
      agentsWorkingAct: 'Agents working', workingAct: 'Working…',
      noneWorking: 'No chat is working right now.', recent: 'Recent', activeChats: 'Active chats', seeAll: 'See all', all: 'All →',
      fWorking: n => `Working (${n})`, fAll: n => `Last 24 h (${n})`, emptyActive: 'No chat is working. Check “Last 24 h”.', emptyAll: 'No chats in the last 24 hours.',
      bg: 'background', inBg: 'in the background', back: 'All chats', loadingChat: 'Loading the chat…', chatError: 'Could not read this chat: ',
      context: 'Context', yourMsgs: 'Your messages', activeAgents: 'Active agents', transcript: 'View transcript', agentTranscript: 'View the agent’s transcript',
      showAll: 'Show all', hideDone: 'Hide finished', agentMap: 'Agent map',
      mapHint: (n, w) => `${n} ${pl(n, 'agent', 'agents')} · ${w} working · tap a node to see its activity`, noSubagents: 'This chat did not launch any subagents.',
      tokensGen: x => `${x} tokens generated`, instructions: 'Instructions it received', activity: 'Activity', mainAgent: 'main agent',
      noActivity: 'No activity recorded yet.', tasks: 'Chat tasks', ago: x => `${x} ago`, justNow: 'just now',
      status: { running: 'Working', waiting: 'Awaiting your approval?', starting: 'Starting', done: 'Finished', idle: 'Waiting for your message', stale: 'No recent activity', error: 'Error' }
    },
    es: {
      title: 'Agentes de Claude', overview: 'Resumen', chats: 'Chats', loading: 'Cargando…', popout: 'Abrir en una pestaña del editor',
      account: 'Cuenta', name: 'Nombre', email: 'Cuenta', org: 'Organización', role: 'Rol', modelsToday: 'Modelos hoy',
      noAccount: 'No encontré datos de la cuenta en <code>.claude.json</code>.',
      nowAndToday: 'Ahora y hoy', now: 'Ahora', today: 'Hoy', chatsWorking: 'Chats trabajando', agentsWorking: 'Agentes trabajando',
      waitApproval: 'Esperan aprobación', tChats: 'Chats', tAgents: 'Agentes', tokensOut: 'Tokens generados', tools: 'Herramientas',
      nWorking: n => `${n} trabajando`, nAgents: n => `${n} ${pl(n, 'agente', 'agentes')}`, waitingChip: 'esperando aprobación',
      agentsWorkingAct: 'Agentes trabajando', workingAct: 'Trabajando…',
      noneWorking: 'Ningún chat está trabajando ahora.', recent: 'Recientes', activeChats: 'Chats activos', seeAll: 'Ver todos', all: 'Todos →',
      fWorking: n => `Trabajando (${n})`, fAll: n => `Últimas 24 h (${n})`, emptyActive: 'Ningún chat trabajando. Mira “Últimas 24 h”.', emptyAll: 'No hay chats en las últimas 24 horas.',
      bg: '2º plano', inBg: 'en segundo plano', back: 'Todos los chats', loadingChat: 'Cargando el chat…', chatError: 'No pude leer este chat: ',
      context: 'Contexto', yourMsgs: 'Mensajes tuyos', activeAgents: 'Agentes activos', transcript: 'Ver transcript', agentTranscript: 'Ver transcript del agente',
      showAll: 'Mostrar todos', hideDone: 'Ocultar terminados', agentMap: 'Mapa de agentes',
      mapHint: (n, w) => `${n} ${pl(n, 'agente', 'agentes')} · ${w} trabajando · toca un nodo para ver su actividad`, noSubagents: 'Este chat no lanzó subagentes.',
      tokensGen: x => `${x} tokens generados`, instructions: 'Instrucciones que recibió', activity: 'Actividad', mainAgent: 'agente principal',
      noActivity: 'Todavía no hay actividad registrada.', tasks: 'Tareas del chat', ago: x => `hace ${x}`, justNow: 'ahora',
      status: { running: 'Trabajando', waiting: '¿Esperando tu aprobación?', starting: 'Iniciando', done: 'Terminado', idle: 'Esperando tu mensaje', stale: 'Sin actividad reciente', error: 'Error' }
    }
  }
  const lang = () => ((snap && snap.lang) || init.lang) === 'es' ? 'es' : 'en'
  const T = (k, ...a) => { const v = L[lang()][k]; return typeof v === 'function' ? v(...a) : v }
  const STATUS = st => L[lang()].status[st] || ''
  document.documentElement.lang = lang()

  const send = m => { if (vscode) vscode.postMessage(m) }
  const persist = () => { if (vscode && vscode.setState) vscode.setState(ui) }
  const select = () => { persist(); send({ type: 'select', chatId: ui.tab === 'chats' ? ui.chatId : null, nodeId: ui.nodeId }) }

  // ── utilidades ──
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
  const num = v => (Number.isFinite(Number(v)) ? Number(v) : 0)
  const now = () => (snap ? snap.now + (Date.now() - receivedAt) : Date.now())
  const fmtTok = n => { n = Number(n) || 0; if (n >= 1e6) return (n / 1e6).toFixed(n >= 1e7 ? 0 : 1) + 'M'; if (n >= 1e3) return (n / 1e3).toFixed(n >= 1e5 ? 0 : 1) + 'k'; return String(Math.round(n)) }
  const fmtDur = ms => { if (ms == null || !isFinite(ms)) return '—'; ms = Math.max(0, ms); const s = Math.floor(ms / 1000), m = Math.floor(s / 60), h = Math.floor(m / 60); if (h) return `${h}h ${m % 60}m`; if (m) return `${m}m ${s % 60}s`; return `${s}s` }
  const fmtAgo = t => { if (!t) return ''; const d = now() - t; if (d < 10000) return T('justNow'); return T('ago', fmtDur(d).replace(/ \d+s$/, '')) }
  const hms = t => { if (!t) return ''; const d = new Date(t); return [d.getHours(), d.getMinutes(), d.getSeconds()].map(x => String(x).padStart(2, '0')).join(':') }
  const model = m => (m ? String(m).replace(/^claude-/, '') : '')
  const card = (title, body, extra, flush) => `<section class="card"><h2><span>${title}</span>${extra || ''}</h2><div class="body${flush ? ' flush' : ''}">${body}</div></section>`
  const isLive = st => st === 'running' || st === 'waiting' || st === 'starting'

  // ── íconos SVG de trazo (heredan el color del tema con currentColor) ──
  const P = {
    file: '<path d="M4 1.5h5l3 3v10H4z"/><path d="M9 1.5v3h3"/>',
    write: '<path d="M4 1.5h5l3 3v10H4z"/><path d="M9 1.5v3h3M8 7.5v5M5.5 10h5"/>',
    edit: '<path d="M11 2.5l2.5 2.5L6 12.5 3 13l.5-3z"/><path d="M9.5 4L12 6.5"/>',
    term: '<rect x="1.5" y="2.5" width="13" height="11" rx="1.5"/><path d="M4.5 6l2 2-2 2M8 10.5h3.5"/>',
    search: '<circle cx="7" cy="7" r="4.5"/><path d="M10.3 10.3l4 4"/>',
    folder: '<path d="M1.5 3.5h5L8 5h6.5v8h-13z"/>',
    globe: '<circle cx="8" cy="8" r="6.5"/><path d="M1.5 8h13M8 1.5c-2.4 2.4-2.4 10.6 0 13M8 1.5c2.4 2.4 2.4 10.6 0 13"/>',
    agent: '<rect x="2.5" y="5" width="11" height="8.5" rx="2"/><path d="M8 2.5V5M5.5 13.5v1M10.5 13.5v1"/><circle cx="8" cy="2" r=".7"/><path d="M6 8.5v1M10 8.5v1"/>',
    todo: '<path d="M2 4l1.5 1.5L6 3M2 10l1.5 1.5L6 9M8.5 4.5h6M8.5 10.5h6"/>',
    text: '<path d="M2 3h12v8H7.5L4 13.5V11H2z"/>',
    user: '<circle cx="8" cy="5" r="3"/><path d="M2.5 14.5c.6-3 2.8-4.5 5.5-4.5s4.9 1.5 5.5 4.5"/>',
    bell: '<path d="M4 11V7a4 4 0 018 0v4l1.5 1.5h-11z"/><path d="M6.5 14.5h3"/>',
    stop: '<rect x="3.5" y="3.5" width="9" height="9" rx="1.5"/>',
    plug: '<path d="M6 1.5v3M10 1.5v3M4 4.5h8v3a4 4 0 01-8 0zM8 11.5v3"/>',
    tool: '<path d="M10.5 1.8a3.5 3.5 0 00-3.3 4.7L2 11.7 4.3 14l5.2-5.2a3.5 3.5 0 004.7-3.3l-2 2-2.2-.5-.5-2.2z"/>',
    question: '<circle cx="8" cy="8" r="6.5"/><path d="M6.2 6.2a1.9 1.9 0 113 1.5c-.8.5-1.2.9-1.2 1.8M8 11.5v.1"/>',
    sparkle: '<path d="M8 1.5l1.5 5 5 1.5-5 1.5-1.5 5-1.5-5-5-1.5 5-1.5z"/>',
    plan: '<path d="M1.5 3.5l4-1.5 5 2 4-1.5v10l-4 1.5-5-2-4 1.5zM5.5 2v10M10.5 4v10"/>',
    send: '<path d="M14.5 1.5L7 9M14.5 1.5l-4.5 13L7 9 1.5 6z"/>',
    check: '<path d="M3 8.5l3 3 7-7"/>',
    circle: '<circle cx="8" cy="8" r="5"/>',
    half: '<circle cx="8" cy="8" r="5"/><path d="M8 3a5 5 0 010 10z" fill="currentColor"/>',
    clock: '<circle cx="8" cy="8" r="6.5"/><path d="M8 4.5V8l2.5 1.5"/>',
    tokens: '<path d="M2.5 4.5h11M2.5 8h11M2.5 11.5h7"/>',
    back: '<path d="M10 3L5 8l5 5"/>',
    external: '<path d="M9 2.5h4.5V7M13.5 2.5L7.5 8.5M12 9.5v4H2.5V4h4"/>',
    chats: '<path d="M2 3h9v6H6L3.5 11V9H2z"/><path d="M11 6h3v6h-1.5v2L10 12H6.5v-1"/>',
    pulse: '<path d="M1.5 8h3l2-4.5 3 9 2-4.5h3"/>'
  }
  const svg = k => `<svg class="i" viewBox="0 0 16 16" aria-hidden="true">${P[k] || P.tool}</svg>`
  // herramienta → [ícono, color]
  const TOOL = {
    Read: ['file', 'file'], Write: ['write', 'edit'], Edit: ['edit', 'edit'], MultiEdit: ['edit', 'edit'], NotebookEdit: ['edit', 'edit'],
    Bash: ['term', 'term'], BashOutput: ['term', 'term'], KillShell: ['stop', 'term'], KillBash: ['stop', 'term'],
    Grep: ['search', 'search'], Glob: ['search', 'search'], LS: ['folder', 'file'],
    WebFetch: ['globe', 'web'], WebSearch: ['globe', 'web'], Agent: ['agent', 'agent'], Task: ['agent', 'agent'],
    TodoWrite: ['todo', 'todo'], Skill: ['sparkle', 'agent'], AskUserQuestion: ['question', 'user'], ExitPlanMode: ['plan', 'todo'],
    SubagentHandback: ['send', 'agent']
  }
  const evIcon = e => {
    if (e.kind === 'text') return ['text', 'text']
    if (e.kind === 'prompt') return ['user', 'user']
    if (e.kind === 'interrupt') return ['stop', 'text']
    if (e.kind === 'notify') return ['bell', 'info']
    if (/^mcp__/.test(e.name || '')) return ['plug', 'mcp']
    return TOOL[e.name] || ['tool', 'tool']
  }
  const icoSpan = e => { const [i, c] = evIcon(e); return `<span class="ico c-${c}">${svg(i)}</span>` }

  // ── Resumen ──
  function accountCard() {
    const a = snap.account || {}
    const rows = []
    if (a.name) rows.push([T('name'), a.name])
    if (a.email) rows.push([T('email'), a.email])
    if (a.org) rows.push([T('org'), a.org])
    if (a.role) rows.push([T('role'), a.role])
    if (a.version) rows.push(['Claude Code', 'v' + a.version])
    const t = snap.today
    if (t && t.models && Object.keys(t.models).length) rows.push([T('modelsToday'), Object.entries(t.models).sort((x, y) => y[1] - x[1]).map(([m]) => model(m)).join(', ')])
    if (!rows.length) return card(`${svg('user')} ${T('account')}`, `<div class="empty">${T('noAccount')}</div>`)
    return card(`${svg('user')} ${T('account')}`, `<div class="kv">${rows.map(([k, v]) => `<span class="k">${esc(k)}</span><span class="v" title="${esc(v)}">${esc(v)}</span>`).join('')}</div>`, '', true)
  }

  function todayCard() {
    const t = snap.today || {}
    const tot = snap.totals || {}
    const st = (n, l, ic, c, cls) => `<div class="stat"><div class="n ${cls || ''}">${esc(n)}</div><div class="l"><span class="ico c-${c}">${svg(ic)}</span>${l}</div></div>`
    return card(`${svg('pulse')} ${T('nowAndToday')}`, `<div class="group">${T('now')}</div><div class="stats">
        ${st(num(tot.running), T('chatsWorking'), 'chats', 'user', tot.running ? 'run' : '')}
        ${st(num(tot.agentsActive), T('agentsWorking'), 'agent', 'agent', tot.agentsActive ? 'run' : '')}
        ${st(num(tot.waiting), T('waitApproval'), 'question', 'edit', tot.waiting ? 'wait' : '')}
      </div><div class="group">${T('today')}</div><div class="stats">
        ${st(num(t.chats), T('tChats'), 'chats', 'user')}
        ${st(num(t.agents), T('tAgents'), 'agent', 'agent')}
        ${st(fmtTok(t.output), T('tokensOut'), 'tokens', 'file')}
        ${st(fmtTok(t.tools), T('tools'), 'tool', 'term')}
      </div>`, '', true)
  }

  function chatRow(c) {
    const chips = []
    if (c.agentsActive) chips.push(`<span class="chip run">${svg('agent')} ${T('nWorking', num(c.agentsActive))}</span>`)
    if (c.agentsTotal) chips.push(`<span class="chip">${svg('agent')} ${T('nAgents', num(c.agentsTotal))}</span>`)
    if (c.status === 'waiting') chips.push(`<span class="chip wait">${svg('question')} ${T('waitingChip')}</span>`)
    const st = c.running ? (c.status === 'waiting' ? 'waiting' : 'running') : c.status
    const action = c.running ? (c.action || (c.agentsActive ? T('agentsWorkingAct') : T('workingAct'))) : STATUS(c.status)
    return `<button class="chat ${esc(st)}" data-act="open" data-id="${esc(c.id)}">
      <div class="l1"><span class="dot ${esc(st)}"></span><span class="t" title="${esc(c.title)}">${esc(c.title)}</span><span class="tiny" data-ago="${num(c.updatedAt) || ''}"></span></div>
      <div class="l2 tiny">${[c.project, c.source, model(c.model), c.gitBranch].filter(Boolean).map(esc).join('<span class="sep">·</span>')}</div>
      <div class="l3">${c.running && st === 'running' ? '<span class="spin"></span>' : ''}<span>${esc(action)}</span></div>
      ${chips.length ? `<div class="chips">${chips.join('')}</div>` : ''}
    </button>`
  }

  function overview() {
    const chats = snap.chats || []
    const live = chats.filter(c => c.running)
    let body
    if (live.length) body = live.map(chatRow).join('')
    else {
      body = `<div class="empty">${T('noneWorking')}</div>`
      const recent = chats.slice(0, 3)
      if (recent.length) body += `<div class="sub">${T('recent')}</div>${recent.map(chatRow).join('')}`
    }
    return accountCard() + todayCard() + card(`${svg('chats')} ${T('activeChats')} <span class="badge">${live.length}</span>`, body, `<button class="iconbtn" data-act="tab" data-tab="chats" title="${T('seeAll')}">${T('all')}</button>`, true)
  }

  // ── Chats ──
  function chatList() {
    const chats = snap.chats || []
    const list = ui.filter === 'active' ? chats.filter(c => c.running) : chats
    const f = (k, l) => `<button class="pill ${ui.filter === k ? 'on' : ''}" data-act="filter" data-f="${k}">${l}</button>`
    const empty = ui.filter === 'active' ? T('emptyActive') : T('emptyAll')
    return `<div class="filter">${f('active', T('fWorking', chats.filter(c => c.running).length))}${f('all', T('fAll', chats.length))}</div>
      ${card(`${svg('chats')} ${T('chats')}`, list.length ? list.map(chatRow).join('') : `<div class="empty">${empty}</div>`, '', true)}`
  }

  function nodeHtml(n, selId) {
    const live = isLive(n.status)
    const bits = []
    if (n.startedAt) bits.push(`<span class="m">${svg('clock')}<span data-dur-from="${num(n.startedAt)}" data-dur-to="${live ? '' : (num(n.endedAt || n.updatedAt) || '')}"></span></span>`)
    if (n.tokens) bits.push(`<span class="m">${svg('tokens')}${fmtTok(n.tokens)}</span>`)
    if (n.tools) bits.push(`<span class="m">${svg('tool')}${num(n.tools)}</span>`)
    const tags = []
    if (n.kind === 'agent') tags.push(`<span class="tag">${esc(n.agentType)}</span>`)
    if (n.background) tags.push(`<span class="tag">${T('bg')}</span>`)
    if (n.kind === 'main' && n.model) tags.push(`<span class="tag">${esc(model(n.model))}</span>`)
    const peek = live && n.feed && n.feed.length > 1 ? `<div class="peek">${n.feed.slice(-3, -1).reverse().map(e => `<div>${icoSpan(e)}<span>${esc(e.text)}</span></div>`).join('')}</div>` : ''
    const action = live ? (n.action || STATUS(n.status)) : STATUS(n.status)
    const lead = live && n.status === 'running' ? '<span class="spin"></span>' : n.status === 'done' ? svg('check') : ''
    return `<button class="node ${n.kind} ${esc(n.status)} ${selId === n.id ? 'sel' : ''}" data-act="node" data-node="${esc(n.id)}">
      <div class="n1"><span class="dot ${esc(n.status)}"></span><span class="nt" title="${esc(n.title)}">${esc(n.title)}</span></div>
      <div class="n2 ${esc(n.status)}">${lead}<span>${esc(action || '')}</span></div>
      <div class="n3 tiny">${bits.join('')}${tags.join('')}</div>${peek}
    </button>`
  }

  function feedHtml(n) {
    const items = (n.feed || []).slice().reverse()
    if (!items.length) return `<div class="empty">${T('noActivity')}</div>`
    return `<ul class="feed">${items.map(e => {
      const running = e.kind === 'tool' && !e.done
      const [i, c] = evIcon(e)
      const cls = [e.kind, running ? 'run' : '', e.error ? 'err' : ''].join(' ')
      const tm = running ? `<span class="spin"></span><span data-dur-from="${num(e.at)}"></span>` : e.kind === 'tool' && e.endAt ? `${hms(e.at)} · ${fmtDur(e.endAt - e.at)}` : hms(e.at)
      return `<li class="ev ${cls}"><span class="ic c-${c}">${svg(e.error ? 'stop' : i)}</span><span class="tx">${esc(e.text)}</span><span class="tm">${tm}</span></li>`
    }).join('')}</ul>`
  }

  function detail() {
    const d = snap.details && snap.details[ui.chatId]
    const back = `<button class="back" data-act="back">${svg('back')} ${T('back')}</button>`
    if (!d) return back + `<div class="empty">${T('loadingChat')}</div>`
    if (d.error) return back + `<div class="empty">${T('chatError')}${esc(d.error)}</div>`
    const m = d.main
    const all = [m, ...d.agents]
    const sel = all.find(n => n.id === ui.nodeId) || m
    const agents = ui.hideDone ? d.agents.filter(n => isLive(n.status)) : d.agents
    const ctxPct = m.tokens ? Math.min(100, m.tokens / (m.tokens > 200000 ? 1000000 : 200000) * 100) : 0
    const total = d.agents.length + d.hiddenAgents

    const meta = [d.project, d.source, model(m.model), d.gitBranch, d.version && 'v' + d.version].filter(Boolean).map(x => `<span class="tag">${esc(x)}</span>`).join('')
    const head = `<section class="card"><div class="body">
        <div class="hd"><span class="t">${esc(m.title)}</span></div>
        <div class="meta">${meta}</div>
        <div class="status ${esc(m.status)}"><span class="dot ${esc(m.status)}"></span><span>${esc(isLive(m.status) ? (m.action || STATUS(m.status)) : STATUS(m.status))}</span><span class="tiny" data-ago="${num(m.updatedAt) || ''}"></span></div>
        ${m.tokens ? `<div class="ctx"><div class="row tiny"><span>${T('context')} ${fmtTok(m.tokens)}</span><span>${Math.round(ctxPct)}%</span></div><div class="bar"><div class="fill ${ctxPct >= 90 ? 'bad' : ctxPct >= 70 ? 'warn' : ''}" data-w="${ctxPct.toFixed(1)}"></div></div></div>` : ''}
      </div>
      <div class="stats">
        <div class="stat"><div class="n">${num(d.prompts)}</div><div class="l"><span class="ico c-user">${svg('user')}</span>${T('yourMsgs')}</div></div>
        <div class="stat"><div class="n">${num(m.tools)}</div><div class="l"><span class="ico c-term">${svg('tool')}</span>${T('tools')}</div></div>
        <div class="stat"><div class="n">${fmtTok(m.output)}</div><div class="l"><span class="ico c-file">${svg('tokens')}</span>${T('tokensOut')}</div></div>
        <div class="stat"><div class="n ${d.working ? 'run' : ''}">${num(d.working)}/${num(total)}</div><div class="l"><span class="ico c-agent">${svg('agent')}</span>${T('activeAgents')}</div></div>
      </div>
      <div class="body"><div class="btns"><button class="btn" data-act="openfile" data-path="${esc(d.file)}">${svg('file')} ${T('transcript')}</button></div></div>
    </section>`

    const extra = d.agents.length ? `<button class="pill ${ui.hideDone ? 'on' : ''}" data-act="hideDone">${ui.hideDone ? T('showAll') : T('hideDone')}</button>` : ''
    const mapBody = `<div class="maphint tiny">${T('mapHint', total, num(d.working))}</div>
      <div class="mapwrap"><div class="map">
        <div class="root">${nodeHtml(m, sel.id)}</div>
        ${agents.length ? `<div class="kids">${agents.map(n => nodeHtml(n, sel.id)).join('')}</div>` : ''}
      </div>
      ${!d.agents.length ? `<div class="empty">${T('noSubagents')}</div>` : ''}</div>`
    const map = card(`${svg('agent')} ${T('agentMap')}`, mapBody, extra, true)

    const selHead = sel.kind === 'agent'
      ? `<div class="selhead"><div class="tiny">${[sel.agentType, sel.background && T('inBg'), sel.model && model(sel.model), sel.output && T('tokensGen', fmtTok(sel.output))].filter(Boolean).map(esc).join('<span class="sep">·</span>')}</div>
         ${sel.prompt ? `<details data-key="prompt:${esc(sel.id)}"><summary>${T('instructions')}</summary><div class="instr">${esc(sel.prompt)}</div></details>` : ''}
         ${sel.file ? `<div class="btns"><button class="btn" data-act="openfile" data-path="${esc(sel.file)}">${svg('file')} ${T('agentTranscript')}</button></div>` : ''}</div>`
      : ''
    const feed = card(`${svg('pulse')} ${T('activity')} · ${esc(sel.kind === 'main' ? T('mainAgent') : sel.title)}`, selHead + feedHtml(sel), isLive(sel.status) ? '<span class="dot running"></span>' : '', true)

    let todos = ''
    if (d.todos && d.todos.items && d.todos.items.length) {
      const it = d.todos.items
      const done = it.filter(x => x.state === 'completed').length
      const mark = { completed: 'check', in_progress: 'half', pending: 'circle' }
      todos = card(`${svg('todo')} ${T('tasks')} <span class="badge">${done}/${it.length}</span>`, it.map(x => `<div class="todo ${esc(x.state)}"><span class="ico">${svg(mark[x.state] || 'circle')}</span><span>${esc(x.state === 'in_progress' && x.note ? x.note : x.name)}</span></div>`).join(''), '', true)
    }
    return back + head + `<div class="split"><div>${map}${todos}</div><div id="feedcol">${feed}</div></div>`
  }

  // ── Render ──
  // No redibujar mientras el usuario está haciendo clic (evita perder el clic si llega un snapshot justo en ese momento)
  let pressing = false, pendingRender = false
  const release = () => { pressing = false; if (pendingRender) { pendingRender = false; setTimeout(render, 0) } }
  document.addEventListener('pointerdown', () => { pressing = true })
  document.addEventListener('pointerup', release)
  document.addEventListener('pointercancel', release)
  window.addEventListener('blur', release)

  function render() {
    if (!snap) { app.innerHTML = `<div class="empty">${T('loading')}</div>`; return }
    if (pressing) { pendingRender = true; return }
    document.documentElement.lang = lang()
    const live = (snap.chats || []).filter(c => c.running).length
    const tab = (k, ic, l) => `<button class="tab ${ui.tab === k ? 'on' : ''}" data-act="tab" data-tab="${k}">${svg(ic)}${l}</button>`
    const body = ui.tab === 'overview' ? overview() : ui.chatId ? detail() : chatList()
    const open = new Set([...app.querySelectorAll('details[open][data-key]')].map(el => el.getAttribute('data-key')))
    const feedEl = app.querySelector('.split .feed')
    const feedY = feedEl ? feedEl.scrollTop : 0
    const y = window.scrollY
    app.innerHTML = `<div class="top"><h1>${svg('agent')} ${T('title')}</h1><div class="right"><span class="tiny">${hms(snap.now)}</span>${init.inEditor ? '' : `<button class="iconbtn" data-act="popout" title="${T('popout')}">${svg('external')}</button>`}</div></div>
      <div class="tabs">${tab('overview', 'pulse', T('overview'))}${tab('chats', 'chats', `${T('chats')}${live ? ` <span class="badge">${live}</span>` : ''}`)}</div>${body}`
    app.querySelectorAll('[data-w]').forEach(el => { el.style.width = el.getAttribute('data-w') + '%' })
    app.querySelectorAll('details[data-key]').forEach(el => { if (open.has(el.getAttribute('data-key'))) el.open = true })
    const newFeed = app.querySelector('.split .feed')
    if (newFeed) newFeed.scrollTop = feedY
    tickLabels()
    window.scrollTo(0, y)
  }

  function tickLabels() {
    app.querySelectorAll('[data-ago]').forEach(el => { const t = Number(el.getAttribute('data-ago')); el.textContent = t ? fmtAgo(t) : '' })
    app.querySelectorAll('[data-dur-from]').forEach(el => {
      const from = Number(el.getAttribute('data-dur-from')), to = Number(el.getAttribute('data-dur-to')) || now()
      el.textContent = from ? fmtDur(to - from) : ''
    })
  }
  setInterval(tickLabels, 1000)

  app.addEventListener('click', ev => {
    const el = ev.target.closest('[data-act]')
    if (!el) return
    const act = el.getAttribute('data-act')
    let reveal = false
    if (act === 'tab') { ui.tab = el.getAttribute('data-tab'); ui.chatId = null; ui.nodeId = null; select() }
    else if (act === 'open') { ui.tab = 'chats'; ui.chatId = el.getAttribute('data-id'); ui.nodeId = null; select(); window.scrollTo(0, 0) }
    else if (act === 'back') { ui.chatId = null; ui.nodeId = null; select() }
    else if (act === 'node') { ui.nodeId = el.getAttribute('data-node'); select(); reveal = true }
    else if (act === 'filter') { ui.filter = el.getAttribute('data-f'); persist() }
    else if (act === 'hideDone') { ui.hideDone = !ui.hideDone; persist() }
    else if (act === 'openfile') { send({ type: 'openFile', path: el.getAttribute('data-path') }); return }
    else if (act === 'popout') { send({ type: 'popout' }); return }
    pressing = false
    render()
    // En el sidebar la actividad queda debajo del mapa: llevarla a la vista al elegir un nodo
    if (reveal && window.innerWidth < 1050) { const f = document.getElementById('feedcol'); if (f) f.scrollIntoView({ behavior: 'smooth', block: 'start' }) }
  })

  window.addEventListener('message', ev => {
    const m = ev.data
    if (!m || typeof m !== 'object') return
    if (m.type === 'snapshot') { snap = m.snapshot; receivedAt = Date.now(); render() }
    else if (m.type === 'openChat' && m.chatId) { ui.tab = 'chats'; ui.chatId = m.chatId; ui.nodeId = null; select(); render() }
  })

  render()
  select()
  send({ type: 'ready' })
})()
