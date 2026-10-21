'use strict'
/**
 * Agentes de Claude — panel lateral para ver en tiempo real los chats de Claude Code y lo que hacen sus subagentes.
 * Solo lee archivos locales (los transcripts que escribe Claude Code). Sin red, sin telemetría, no modifica nada.
 */
const vscode = require('vscode')
const fs = require('node:fs')
const path = require('node:path')
const { createCollector } = require('./lib/snapshot')
const { claudeDir } = require('./lib/util')
const { getHtml } = require('./webview/html')
const { t: tr, setLang, getLang, resolveLang } = require('./lib/i18n')

const VIEW_ID = 'claudeAgents.view'

function activate(context) {
  // Idioma: ajuste claudeAgents.language o, en 'auto', el del editor. Las frases se generan al leer, así que
  // al cambiarlo se crea un recolector nuevo para que todo se relea en el idioma elegido.
  const applyLang = () => setLang(resolveLang(vscode.workspace.getConfiguration('claudeAgents').get('language'), vscode.env.language))
  applyLang()
  let collector = createCollector()
  const views = new Set() // { webview, visible(), sel: { chatId, nodeId } }
  let latest = null
  let timer = null
  let running = false
  let again = false
  let tickN = 0
  let editorPanel = null

  const item = vscode.window.createStatusBarItem('claudeAgents.status', vscode.StatusBarAlignment.Left, 90)
  item.name = getLang() === 'es' ? 'Agentes de Claude' : 'Claude Agents'
  item.command = 'claudeAgents.focus'
  item.text = '$(hubot) Claude'
  item.show()
  context.subscriptions.push(item)

  function cfg() {
    const c = vscode.workspace.getConfiguration('claudeAgents')
    return {
      claudeDir: c.get('claudeDir'),
      pollMs: Math.max(1000, (Number(c.get('pollSeconds')) || 2) * 1000),
      statsEvery: Math.max(5, Number(c.get('statsSeconds')) || 20),
      workspaceDirs: (vscode.workspace.workspaceFolders || []).map(f => f.uri.fsPath)
    }
  }

  function paintStatusBar() {
    if (!latest) return
    const t = latest.totals || {}
    if (t.running || t.agentsActive) {
      const parts = [tr('sbChats', t.running)]
      if (t.agentsActive) parts.push(tr('sbAgents', t.agentsActive))
      item.text = `$(sync~spin) ${parts.join(' · ')}`
    } else item.text = `$(hubot) ${tr('sbIdle')}`
    item.backgroundColor = t.waiting ? new vscode.ThemeColor('statusBarItem.warningBackground') : undefined
    const lines = (latest.chats || []).filter(c => c.running).slice(0, 8)
      .map(c => `- **${c.title.replace(/[[\]*_`]/g, '')}** — ${(c.action || tr('sbWorking')).replace(/[[\]*_`]/g, '')}${c.agentsActive ? ` · ${tr('sbAgentsN', c.agentsActive)}` : ''}`)
    item.tooltip = new vscode.MarkdownString(lines.length ? `**${tr('sbHead')}**\n\n${lines.join('\n')}` : tr('sbNone'))
  }

  function post() {
    if (!latest) return
    for (const v of views) if (v.visible()) v.webview.postMessage({ type: 'snapshot', snapshot: latest })
  }

  async function tick(forceStats) {
    if (running) { again = true; return }
    running = true
    try {
      const c = cfg()
      const anyVisible = [...views].some(v => v.visible())
      const statsTicks = Math.max(1, Math.round(c.statsEvery * 1000 / c.pollMs))
      latest = await collector.collect({
        lang: getLang(),
        claudeDir: c.claudeDir, workspaceDirs: c.workspaceDirs,
        selections: anyVisible ? [...views].filter(v => v.visible()).map(v => v.sel) : [],
        withStats: forceStats || (anyVisible && tickN++ % statsTicks === 0)
      })
      paintStatusBar()
      post()
    } catch (e) {
      console.error('[claudeAgents] fallo al leer', e)
    } finally {
      running = false
      if (again) { again = false; setTimeout(() => tick(), 0) }
    }
  }

  function schedule() {
    if (timer) clearInterval(timer)
    timer = setInterval(() => tick(), cfg().pollMs)
  }
  context.subscriptions.push({ dispose: () => { if (timer) clearInterval(timer) } })

  async function openFile(p) {
    // Solo se abren transcripts .jsonl dentro del directorio de Claude
    try {
      const root = fs.realpathSync(claudeDir(cfg().claudeDir))
      const real = fs.realpathSync(String(p))
      if (real.startsWith(root + path.sep) && real.endsWith('.jsonl')) {
        await vscode.window.showTextDocument(vscode.Uri.file(real), { preview: true, viewColumn: vscode.ViewColumn.Active })
      }
    } catch {}
  }

  /** Conecta un webview (sidebar o pestaña del editor) con el recolector. */
  function attach(webview, visible, onDispose, init) {
    const v = { webview, visible, sel: { chatId: null, nodeId: null } }
    views.add(v)
    webview.options = { enableScripts: true, localResourceRoots: [] }
    webview.html = getHtml(webview, { init })
    const sub = webview.onDidReceiveMessage(async m => {
      if (!m || typeof m !== 'object') return
      if (m.type === 'ready') { post(); tick() }
      else if (m.type === 'select') { v.sel = { chatId: m.chatId || null, nodeId: m.nodeId || null }; tick() }
      else if (m.type === 'openFile' && typeof m.path === 'string') openFile(m.path)
      else if (m.type === 'popout') openInEditor()
    })
    onDispose(() => { views.delete(v); sub.dispose() })
    return v
  }

  const provider = {
    resolveWebviewView(wv) {
      attach(wv.webview, () => wv.visible, fn => wv.onDidDispose(fn), {})
      wv.onDidChangeVisibility(() => { if (wv.visible) tick() })
    }
  }
  context.subscriptions.push(vscode.window.registerWebviewViewProvider(VIEW_ID, provider, { webviewOptions: { retainContextWhenHidden: true } }))

  function openInEditor() {
    if (editorPanel) { editorPanel.reveal(); return }
    editorPanel = vscode.window.createWebviewPanel('claudeAgents.editor', getLang() === 'es' ? 'Agentes de Claude' : 'Claude Agents', vscode.ViewColumn.Beside, { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [] })
    editorPanel.iconPath = vscode.Uri.file(path.join(__dirname, 'media', 'icon.svg'))
    const p = editorPanel
    attach(p.webview, () => p.visible, fn => p.onDidDispose(fn), { inEditor: true })
    p.onDidChangeViewState(() => { if (p.visible) tick() })
    p.onDidDispose(() => { editorPanel = null })
  }

  const reg = (id, fn) => context.subscriptions.push(vscode.commands.registerCommand(id, fn))
  reg('claudeAgents.focus', () => vscode.commands.executeCommand(`${VIEW_ID}.focus`))
  reg('claudeAgents.openInEditor', openInEditor)
  reg('claudeAgents.refresh', () => tick(true))
  context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(e => {
    if (!e.affectsConfiguration('claudeAgents')) return
    if (e.affectsConfiguration('claudeAgents.language')) { const prev = getLang(); applyLang(); if (getLang() !== prev) collector = createCollector() }
    schedule(); tick(true)
  }))

  schedule()
  tick(true)
}

function deactivate() {}

module.exports = { activate, deactivate }
