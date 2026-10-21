'use strict'
/** html.js — HTML del webview: CSS y JS embebidos, CSP con nonce (sin estilos inline en atributos). */
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')

function getHtml(webview, opts = {}) {
  const nonce = opts.nonce || crypto.randomBytes(16).toString('base64')
  const css = fs.readFileSync(path.join(__dirname, 'panel.css'), 'utf8')
  const js = fs.readFileSync(path.join(__dirname, 'panel.js'), 'utf8')
  const json = v => JSON.stringify(v).replace(/</g, '\\u003c')
  const inject = opts.snapshot
    ? `<script nonce="${nonce}">window.__INIT__=${json(opts.init || {})};window.__SNAPSHOT__=${json(opts.snapshot)}</script>`
    : `<script nonce="${nonce}">window.__INIT__=${json(opts.init || {})}</script>`
  const theme = opts.themeCss ? `<style nonce="${nonce}">${opts.themeCss}</style>` : ''
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}'; img-src data:;">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Agentes de Claude</title>
<style nonce="${nonce}">${css}</style>${theme}
</head>
<body>
<div id="app"><div class="empty">Cargando…</div></div>
${inject}
<script nonce="${nonce}">${js}</script>
</body>
</html>`
}

module.exports = { getHtml }
