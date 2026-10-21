# Changelog

## 0.2.0

- **English and Spanish.** The panel, the status bar, the commands and the settings follow the VS Code language. The new `claudeAgents.language` setting (`auto`, `en`, `es`) forces one of them.
- **New design**:
  - All colors come from the VS Code theme.
  - Cards with headers and dividers, and figures in a grid with lines, grouped under "Now" and "Today".
  - SVG icons per kind of action instead of emojis.
  - The activity log is shown as a timeline.
- **Fixes**:
  - Background subagents no longer stay in "Thinking…" after they finish. The extension now detects the report hand-back (`SubagentHandback`) and the completion notice (`task-notification`).
  - Agent completion notices no longer appear, or count, as user messages. They are shown as notices in the activity log.
  - The panel no longer stops updating if you release the mouse button outside it.
  - The activity log keeps its scroll position between updates.
  - In the sidebar, clicking a node scrolls to its activity.
  - The system's reduced-motion preference is respected.

## 0.1.0

- First version: Overview, Chats, agent map, live activity and status bar (Spanish only).
