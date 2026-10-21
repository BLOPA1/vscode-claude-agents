# Architecture

**English** · [Español](ARQUITECTURA.md)

This document explains how the extension is built, for anyone who wants to change or adapt it.

## Overview

```text
Claude Code files (~/.claude)            ← read only, never modified
        │  re-read every ~2 s (new bytes only)
        ▼
Extension host (Node.js)                  ← reads, interprets and builds a "snapshot"
        │  postMessage(snapshot)
        ▼
Webview (HTML/CSS/JS)                     ← draws Overview, Chats, the map and the activity
        │  postMessage({ type: 'select', chatId, nodeId })
        └──────────────► back to the extension host
```

The extension doesn't connect to Claude Code. Claude Code already writes to disk everything each chat and each subagent does. The extension reads those files, works out the status and passes it to the view.

All the logic in `lib/` is plain Node and doesn't import `vscode`, so it can be tested with `node` and fake data (`scripts/demo.js`). Only `extension.js` uses the editor API.

## Data sources

### Chats

They live in `~/.claude/projects/<project-folder>/<session-id>.jsonl`. The format is JSONL: one JSON object per line, with new lines appended at the end. The fields that matter:

```jsonc
{ "type": "user" | "assistant" | "system" | "ai-title" | ...,
  "timestamp": "2026-10-21T14:00:00Z",
  "cwd": "/home/dev/projects/my-app",
  "entrypoint": "claude-vscode",          // IDE; "cli" = terminal; "sdk-*"
  "isSidechain": false,
  "origin": { "kind": "task-notification" },   // notices from Claude Code itself
  "message": {
    "id": "msg_...", "model": "claude-opus-5-5",
    "usage": { "input_tokens", "cache_read_input_tokens", "cache_creation_input_tokens", "output_tokens" },
    "content": [
      { "type": "text", "text": "..." },
      { "type": "tool_use", "id": "toolu_1", "name": "Read", "input": { "file_path": "..." } },
      { "type": "tool_result", "tool_use_id": "toolu_1", "is_error": false }   // in "user" lines
    ]
  },
  "toolUseResult": { "agentId": "a07", "status": "completed", "totalTokens": 6900 }  // result of an Agent call
}
```

### Subagents

They live in `~/.claude/projects/<project>/<session-id>/subagents/agent-<id>.jsonl`, with the same format as chats. Next to each one is `agent-<id>.meta.json`, with `agentType`, `description` and `requestShape` (foreground or background).

### Account

It comes from `~/.claude.json` → `oauthAccount` (`emailAddress`, `displayName`, `organizationName`, `organizationRole`). Only that field is read, never tokens or credentials.

## Modules

### `lib/sessions.js`: chat discovery

- Walks `projects/*/*.jsonl` and keeps the files modified in the last 24 hours.
- Reads only the first 64 KB (`cwd`, `entrypoint`, first prompt) and the last 160 KB (title, status) of each file, cached by size and date.
- Counts the files in `subagents/`. Those modified in the last 2 minutes count as active.
- Also checks the date of the `subagents` folder, because a chat can be quiet while its agents work.

### `lib/reader.js`: incremental reader

For each file it remembers how far it has read, and on each pass it processes only the new bytes, with a stream. The last incomplete line is kept for the next pass. If the file shrank, it starts over.

Line by line it keeps track of:

- **Recent activity** (120 entries): each `tool_use` goes in as pending and is marked done when its `tool_result` arrives.
- **Tokens**: the current context is `input + cache_read + cache_creation` from the last message. Output is accumulated and deduplicated by `message.id`.
- **`Agent`/`Task` calls**: description, type, whether they run in the background, and their result.
- The latest `TodoWrite` list, the model, the title and the per-day totals.

### Status deriver (`deriveStatus` in `reader.js`)

A pure function that decides the status from the last meaningful entry:

| Last entry | Status |
|---|---|
| `tool_use` without a result | **Working**, with that tool |
| `tool_use` without a result for more than 30 s (except Bash, Agent and Web) | **Awaiting approval?** |
| Recent `tool_result` or user prompt | **Thinking** |
| Assistant text more than 5 s old | **Finished** (subagent) or **Waiting for your message** (main chat) |
| `system` with `stop_hook_summary`/`turn_duration`, or "[Request interrupted" | **Finished** |
| Result of `SubagentHandback` (the subagent handed back its report) | **Finished** |
| Nothing new for more than 30 min | **No recent activity** |

Subagents have extra rules:

- If the call in the main chat has `status: "completed"`, that overrides everything else.
- A background agent first returns a "launched" result, which does **not** mean it finished. The end comes later, as a message with `origin.kind = "task-notification"` (or as the report hand-back, `origin.kind = "peer"` with `handback`). At that point the call is marked finished.

### Agent linker (`buildDetail` in `snapshot.js`)

It matches each `agent-<id>.jsonl` with its `Agent` call in the main chat:

1. First by `toolUseResult.agentId`.
2. If the agent is still running and there is no result yet, by the `description` in `.meta.json`.
3. `Agent` calls that don't have a file yet are shown as "Starting…".

### `lib/describe.js` and `lib/i18n.js`

`describe.js` is a table that turns each tool's `name + input` into a readable phrase: "Reading src/x.ts", "Running: npm test", "Searching 'pattern' in src", "MCP server · tool", and so on. The phrases come from `i18n.js`, which holds the English and Spanish strings for the host side.

The phrases are generated when a line is read. That's why, when the language changes, the extension creates a new collector so that everything is re-read in the chosen language.

### `lib/snapshot.js`: collector

On each pass it:

1. Scans the sessions, which is cheap.
2. Builds the full detail only for the chats open in some view.
3. Recalculates today's totals less often (every 20 s).
4. Returns a single object.

The readers live in an LRU cache (200), and passes are chained, so two passes never read the same file at the same time.

## Data model (snapshot)

```js
{
  now, lang,
  account: { name, email, org, role, version },
  today:   { chats, agents, output, tools, models: { "claude-opus-5-5": 102 } },
  totals:  { running, agentsActive, waiting },          // for the status bar
  chats: [ { id, title, project, source, model, status, action,
             running, agentsActive, agentsTotal, updatedAt } ],
  details: {                                            // only chats open in a view
    "<chatId>": { main: Node, agents: [Node], todos, prompts, working }
  }
}

Node = { id, kind: 'main' | 'agent', title, agentType, background,
         status, action, startedAt, endedAt, tokens, output, tools, model, prompt,
         feed: [ { kind: 'tool' | 'text' | 'prompt' | 'notify' | 'interrupt', name, text, at, endAt, done, error } ] }
```

The full `feed` (80 entries) is sent only for the selected node. The other nodes carry just the latest entries, for the preview inside the map.

## `extension.js`

- **Sidebar view**: a `viewsContainers.activitybar` and a `webview` view, registered with `retainContextWhenHidden`.
- **Editor tab**: `createWebviewPanel` in `ViewColumn.Beside`, with the same HTML and the same messages.
- **Status bar**: `$(sync~spin) 2 chats · 3 agents`, with a warning background if something is awaiting approval.
- **Language**: the `claudeAgents.language` setting, or the editor language (`vscode.env.language`) when it is `auto`. Manifest strings (commands, settings) come from `package.nls.json` and `package.nls.es.json`.
- **Polling**: a `setInterval`. If a pass hasn't finished, another one isn't started; it is marked "run again when done".
- **Messages from the view**:

  | Message | What the host does |
  |---|---|
  | `select` | Stores which chat and node that view is showing and triggers a pass. |
  | `openFile` | Opens a transcript, only if its real path is inside the Claude directory and ends in `.jsonl`. |
  | `popout` | Opens the editor tab. |

## Webview

- **No frameworks**: plain HTML, CSS and JS.
- **Security**: CSP with a nonce. All transcript text is escaped before it goes into the HTML.
- **Colors**: only theme variables (`--vscode-*`), so it adapts to light, dark and high-contrast themes.
- **Icons**: inline stroke SVGs that inherit their color through `currentColor`.
- **Texts**: an English and Spanish dictionary at the top of `panel.js`. The language arrives in each snapshot (`snapshot.lang`).
- **Agent map**: pure CSS. A *container query* switches it from a vertical tree (narrow sidebar) to a left-to-right diagram (wide tab).
- **Real time**:
  - It redraws when each snapshot arrives, keeping the scroll position and the open `<details>`.
  - It doesn't redraw while the user holds the mouse button down.
  - Counters ("5 s ago", "running for 2m 10s") update every second without asking for new data.

## Known risks

- **The format can change.** The transcripts are internal to Claude Code. Parsing is isolated in `reader.js` and `sessions.js`, so a format change only needs to be fixed there.
- **Approval is a guess.** "Awaiting approval" is inferred from timing; it isn't real data.
- **Sub-subagents** are counted but not drawn as an extra level of the tree.
