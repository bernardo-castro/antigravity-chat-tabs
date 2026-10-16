# Antigravity Chat Tabs (VS Code / Antigravity IDE Extension)

**Author:** Bernardo Castro (`BernardoCastroDev`)

Adds a **Kiro-style horizontal multi-session tab bar** to the **Antigravity IDE** Agent side panel, making it effortless to see, switch between, organize, and manage multiple conversations per workspace.

## ✨ Features (v1.1.0)

- **Horizontal Session Tabs per Workspace**: Automatically displays your open/recent conversations for the current workspace as tabs at the top of the Agent chat panel.
- **Drag & Drop Tab Reordering**: Drag tabs left or right to organize your conversations in any order you like; order is persisted per workspace.
- **Double-Click & Right-Click Inline Rename (`✏️`)**: Double-click any tab (or right-click → *Renombrar pestaña*) to give it a custom name without altering the underlying conversation history.
- **Pin Tabs (`📌`)**: Pin important conversations to the start of the tab bar so they never get closed accidentally.
- **Right-Click Context Menu**:
  - `✏️ Renombrar pestaña` / `↺ Restaurar título original`
  - `📌 Fijar / Desfijar pestaña al inicio`
  - `✕ Cerrar pestaña`
  - `⇄ Cerrar otras pestañas`
  - `⇥ Cerrar pestañas a la derecha`
  - `⟲ Reabrir última pestaña cerrada`
- **Animated Status Indicators**: Pulsing emerald indicator when the agent is working in a background tab, and pulsing blue halo when a tab is waiting for your approval/input.
- **Integrated `+ New Session` Tab**: Start a new conversation in one click without losing your open conversation tabs.
- **Auto-Healing Across IDE Updates**: Automatically detects when Antigravity IDE updates itself and re-applies the Session Tabs bar on startup.

## Commands (`Ctrl+Shift+P` / `Cmd+Shift+P`)

- `Antigravity Chat Tabs: Enable Session Tabs`
- `Antigravity Chat Tabs: Restore Default Header`
- `Antigravity Chat Tabs: Check Status`
