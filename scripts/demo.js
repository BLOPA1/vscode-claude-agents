'use strict'
/**
 * demo.js — crea un directorio de Claude falso (chats + subagentes) y renderiza el panel en HTML.
 *   node scripts/demo.js <carpeta_salida>     → escribe overview.html, detail.html (y los datos en <salida>/home)
 * Nunca toca tus datos reales.
 */
const fs = require('node:fs')
const path = require('node:path')
const { createCollector } = require('../lib/snapshot')
const { getHtml } = require('../webview/html')
const { setLang } = require('../lib/i18n')
const ES = process.env.DEMO_LANG === 'es' // DEMO_LANG=es: panel y datos de ejemplo en español
setLang(ES ? 'es' : 'en')
const X = (en, es) => (ES ? es : en)

function makeDemo(root, now = Date.now()) {
  fs.rmSync(root, { recursive: true, force: true })
  const claude = path.join(root, '.claude')
  const SEC = 1000, MIN = 60000, HOUR = 3600000
  const iso = off => new Date(now - off).toISOString()
  const write = (file, lines, mtimeOff) => {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, lines.map(l => JSON.stringify(l)).join('\n') + '\n')
    const t = new Date(now - mtimeOff); fs.utimesSync(file, t, t)
  }
  let n = 0
  const mid = () => 'msg_' + (++n)
  const usage = (ctx, out) => ({ input_tokens: 5, cache_read_input_tokens: Math.round(ctx * 0.9), cache_creation_input_tokens: Math.round(ctx * 0.1) - 5, output_tokens: out })
  const base = (sid, cwd, entry, side) => ({ sessionId: sid, cwd, entrypoint: entry, version: '2.1.306', gitBranch: 'develop', isSidechain: !!side })
  const prompt = (b, off, text) => ({ ...b, type: 'user', timestamp: iso(off), message: { role: 'user', content: text } })
  const asst = (b, off, ctx, out, content) => ({ ...b, type: 'assistant', timestamp: iso(off), message: { id: mid(), model: 'claude-opus-5-5', usage: usage(ctx, out), content } })
  const tool = (id, name, input) => ({ type: 'tool_use', id, name, input })
  const result = (b, off, id, extra) => ({ ...b, type: 'user', timestamp: iso(off), toolUseResult: extra || {}, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: 'ok' }] } })

  // ── Chat 1: "AGENTES" con 7 subagentes (como en tu captura) ──
  const sid = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa'
  const cwd = '/home/dev/projects/my-app'
  const proj = path.join(claude, 'projects', '-home-dev-projects-my-app')
  const b = base(sid, cwd, 'claude-vscode')
  const agents = [
    { id: 'a01', desc: X('Real frontend conventions', 'Convenciones reales del frontend'), type: 'Explore', start: 70 * MIN, dur: 16 * MIN + 44 * SEC, tok: 305900, tools: 41, done: true },
    { id: 'a02', desc: X('Real backend conventions', 'Convenciones reales del backend'), type: 'Explore', start: 70 * MIN, dur: 22 * MIN + 25 * SEC, tok: 348900, tools: 52, done: true },
    { id: 'a03', desc: X('Facts about the Orders module for its guide', 'Hechos del modulo Compras para su guia'), type: 'general-purpose', start: 45 * MIN, dur: 9 * MIN + 56 * SEC, tok: 296100, tools: 33, done: true },
    { id: 'a04', desc: X('Facts about the Billing module for its guide', 'Hechos del modulo Mantenimiento para su guia'), type: 'general-purpose', start: 45 * MIN, dur: 11 * MIN + 45 * SEC, tok: 418400, tools: 47, done: true },
    { id: 'a05', desc: X('Test the doc generator check', 'Probar el control del documentador'), type: 'general-purpose', start: 6 * MIN, dur: 11 * SEC, tok: 21100, tools: 3, done: true },
    { id: 'a06', desc: X('Test the doc generator hook', 'Probar el hook del documentador'), type: 'general-purpose', start: 3 * MIN, running: 'Bash', bg: true },
    { id: 'a07', desc: X('Review the DeliveryMap component', 'Prueba: revisar MapaDeEntrega'), type: 'Explore', start: 50 * SEC, running: 'Read' }
  ]
  const main = [
    prompt(b, 75 * MIN, X('Document the modules and review the real conventions of the project', 'Necesito que documentes los módulos y revises las convenciones reales del proyecto')),
    asst(b, 74 * MIN, 40000, 900, [{ type: 'text', text: X('I will launch several agents in parallel to survey the frontend and the backend.', 'Voy a lanzar varios agentes en paralelo para relevar el frontend y el backend.') }, tool('tu_todo1', 'TodoWrite', { todos: [
      { content: X('Survey frontend conventions', 'Relevar convenciones del frontend'), status: 'completed', activeForm: X('Surveying frontend', 'Relevando frontend') },
      { content: X('Survey backend conventions', 'Relevar convenciones del backend'), status: 'completed', activeForm: X('Surveying backend', 'Relevando backend') },
      { content: X('Document the Orders module', 'Documentar módulo Compras'), status: 'completed', activeForm: X('Documenting Orders', 'Documentando Compras') },
      { content: X('Test the doc generator', 'Probar el documentador'), status: 'in_progress', activeForm: X('Testing the doc generator hook', 'Probando el hook del documentador') },
      { content: X('Review DeliveryMap', 'Revisar MapaDeEntrega'), status: 'pending', activeForm: X('Reviewing DeliveryMap', 'Revisando MapaDeEntrega') }] })]),
    result(b, 74 * MIN - 2 * SEC, 'tu_todo1')
  ]
  for (const a of agents) {
    main.push(asst(b, a.start, 52000, 300, [tool('tu_' + a.id, 'Agent', { description: a.desc, subagent_type: a.type, prompt: X(`Task: ${a.desc}. Review the code in ${cwd} and return a summary with verifiable facts.`, `Tarea: ${a.desc}. Revisa el código en ${cwd} y devuelve un resumen con hechos verificables.`), run_in_background: !!a.bg })]))
    if (a.done) main.push(result(b, a.start - a.dur, 'tu_' + a.id, { status: 'completed', agentId: a.id, totalTokens: a.tok, totalToolUseCount: a.tools, totalDurationMs: a.dur }))
    if (a.bg) main.push(result(b, a.start - 1 * SEC, 'tu_' + a.id, { status: 'async_launched', agentId: a.id }))
    // archivo del subagente
    const sb = { ...base(sid, cwd, 'claude-vscode', true), agentId: a.id }
    const lines = [prompt(sb, a.start - SEC, X(`Task: ${a.desc}.`, `Tarea: ${a.desc}.`))]
    const files = ['src/app/orders/order.service.ts', 'src/app/orders/order.component.ts', 'backend/Orders/OrderController.cs', '.claude/skills/frontend-guidelines/SKILL.md']
    let off = a.start - 3 * SEC
    const end = a.done ? a.start - a.dur : 5 * SEC
    let k = 0
    while (off > end + 4 * SEC && k < 14) {
      const step = Math.max(2 * SEC, (off - end) / 6)
      const f = files[k % files.length]
      const nm = k % 3 === 2 ? 'Grep' : 'Read'
      lines.push(asst(sb, off, Math.round((a.tok || 9000) * (k + 1) / 15), 200, [tool(`${a.id}_t${k}`, nm, nm === 'Grep' ? { pattern: 'class .*Service', path: cwd + '/src' } : { file_path: cwd + '/' + f })]))
      lines.push(result(sb, off - SEC, `${a.id}_t${k}`))
      off -= step; k++
    }
    if (a.done) lines.push(asst(sb, end, a.tok, 1500, [{ type: 'text', text: X(`Done: summary of ${a.desc.toLowerCase()}.`, `Listo: resumen de ${a.desc.toLowerCase()}.`) }]))
    else if (a.running === 'Bash') {
      lines.push(asst(sb, 40 * SEC, 18000, 300, [{ type: 'text', text: X('I will trigger the hook with a test change.', 'Voy a disparar el hook con un cambio de prueba.') }]))
      lines.push(asst(sb, 12 * SEC, 19500, 200, [tool(`${a.id}_bash`, 'Bash', { command: 'npm run docs:hook -- --dry-run', description: X('Run the doc generator hook in dry-run mode', 'Ejecutar el hook del documentador en modo prueba') })]))
    } else {
      lines.push(asst(sb, 4 * SEC, 6900, 150, [tool(`${a.id}_read`, 'Read', { file_path: cwd + '/.claude/skills/frontend-guidelines/SKILL.md' })]))
    }
    const dir = path.join(proj, sid, 'subagents')
    write(path.join(dir, `agent-${a.id}.jsonl`), lines, a.done ? a.start - a.dur : (a.running === 'Bash' ? 12 * SEC : 4 * SEC))
    fs.writeFileSync(path.join(dir, `agent-${a.id}.meta.json`), JSON.stringify({ agentType: a.type, description: a.desc, requestShape: a.bg ? 'background' : 'foreground' }))
  }
  main.push({ type: 'ai-title', aiTitle: X('Documentation agents', 'AGENTES') })
  write(path.join(proj, sid + '.jsonl'), main, 50 * SEC)

  // ── Chat 2: módulo compras, editando código ──
  const sid2 = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb'
  const b2 = base(sid2, cwd, 'claude-vscode')
  write(path.join(proj, sid2 + '.jsonl'), [
    prompt(b2, 20 * MIN, X('Check the Orders module in staging and fix the tax calculation', 'Revisa el módulo COMPRAS en PREPROD y corrige el cálculo de impuestos')),
    asst(b2, 18 * MIN, 61000, 700, [tool('c2r', 'Read', { file_path: cwd + '/backend/Orders/Taxes.cs' })]),
    result(b2, 18 * MIN - SEC, 'c2r'),
    asst(b2, 8 * SEC, 88000, 400, [tool('c2e', 'Edit', { file_path: cwd + '/backend/Orders/Taxes.cs' })]),
    { type: 'ai-title', aiTitle: X('Orders module in staging', 'Módulo COMPRAS en PREPROD') }
  ], 8 * SEC)

  // ── Chat 3: terminado hace 2 h ──
  const sid3 = 'cccccccc-3333-4333-8333-cccccccccccc'
  const b3 = base(sid3, '/home/dev/projects/infra', 'cli')
  write(path.join(claude, 'projects', '-home-dev-projects-infra', sid3 + '.jsonl'), [
    prompt(b3, 2.5 * HOUR, X('Open the pull request for the orders change', 'Arma el PR de compras en Bitbucket')),
    asst(b3, 2.2 * HOUR, 30000, 900, [{ type: 'text', text: X('Pull request created.', 'PR creado.') }]),
    { ...b3, type: 'system', subtype: 'stop_hook_summary', timestamp: iso(2.2 * HOUR) },
    { type: 'ai-title', aiTitle: X('Orders pull request', 'PR de compras') }
  ], 2.2 * HOUR)

  fs.writeFileSync(path.join(root, '.claude.json'), JSON.stringify({ oauthAccount: { emailAddress: 'dev@example.com', displayName: 'Dev', organizationName: X('My Company', 'Mi Empresa'), organizationRole: 'admin' }, someOtherSecret: 'no-se-lee' }))
  return { claude, sid }
}

if (require.main === module) {
  (async () => {
    const out = path.resolve(process.argv[2] || 'demo-out')
    fs.mkdirSync(out, { recursive: true })
    const demo = makeDemo(path.join(out, 'home'))
    const col = createCollector()
    const nodeId = process.env.NODE_SEL || 'a:a07'
    const snap = await col.collect({ claudeDir: demo.claude, selections: [{ chatId: demo.sid, nodeId }], withStats: true })
    const dark = 'html{background:#181818} body{background:#181818} :root{--vscode-foreground:#cccccc;--vscode-descriptionForeground:#9d9d9d;--vscode-sideBar-background:#181818;--vscode-editorWidget-background:#202020;--vscode-widget-border:#353535;--vscode-focusBorder:#0078d4;--vscode-font-family:system-ui,sans-serif}'
    fs.writeFileSync(path.join(out, 'overview.html'), getHtml(null, { snapshot: snap, themeCss: dark, init: { tab: 'overview' } }))
    fs.writeFileSync(path.join(out, 'detail.html'), getHtml(null, { snapshot: snap, themeCss: dark, init: { tab: 'chats', chatId: demo.sid, nodeId } }))
    fs.writeFileSync(path.join(out, 'snapshot.json'), JSON.stringify(snap, null, 2))
    console.log('chats:', snap.chats.map(c => `${c.title} [${c.status}] agentes ${c.agentsActive}/${c.agentsTotal}`).join(' | '))
    const d = snap.details[demo.sid]
    console.log('main:', d.main.status, '-', d.main.action)
    for (const a of d.agents) console.log(' ', a.status.padEnd(8), a.title, '|', a.action, '|', a.tokens, 'tok', a.tools, 'tools')
    console.log('today:', JSON.stringify(snap.today), 'account:', JSON.stringify(snap.account))
  })()
}

module.exports = { makeDemo }
