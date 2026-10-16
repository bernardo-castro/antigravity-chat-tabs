# Antigravity Chat Tabs (VS Code / Antigravity IDE Extension)

**Author:** Bernardo Castro (`BernardoCastroDev`)

Adds a **Kiro-style horizontal multi-session tab bar** to the **Antigravity IDE** Agent side panel, making it effortless to work across multiple AI agent conversations in parallel per workspace.

## ✨ Features (v1.2.1)

- **Parallel Multi-Session Status Indicators**:
  - 🔄 **Thinking / Processing Spinner**: Animated cyan spinner while a background tab is actively thinking or executing tools.
  - 🟠 **Needs Attention Alert**: Pulsing amber badge + amber tab highlight when a background conversation is waiting for your approval or input.
  - ✅ **Completed / Unread Response (`✓`)**: Glowing emerald checkmark badge when a background tab finishes responding while you are working in another tab (clears automatically when you view the tab).
- **Seamless Inline Tab Rename (`2×Click` or Right-Click)**: Double-click any tab to edit its title inline with native dark tab styling and automatic end-of-line cursor placement.
- **Drag & Drop Tab Reordering**: Drag tabs left or right to organize your conversations; order is persisted per workspace.
- **Pin Tabs (`📌`)**: Pin important conversations to the start of the tab bar so they never get closed accidentally.
- **Right-Click Context Menu**:
  - `✏️ Renombrar pestaña` / `↺ Restaurar título original`
  - `📌 Fijar / Desfijar pestaña al inicio`
  - `✕ Cerrar pestaña`
  - `⇄ Cerrar otras pestañas`
  - `⇥ Cerrar pestañas a la derecha`
  - `⟲ Reabrir última pestaña cerrada`
- **Integrated `+ New Session` Tab**: Start a new parallel conversation in one click without losing your open conversation tabs.
- **Auto-Healing Across IDE Updates**: Automatically detects when Antigravity IDE updates itself and re-applies the Session Tabs bar on startup.

## Commands (`Ctrl+Shift+P` / `Cmd+Shift+P`)

- `Antigravity Chat Tabs: Enable Session Tabs`
- `Antigravity Chat Tabs: Restore Default Header`
- `Antigravity Chat Tabs: Check Status`
