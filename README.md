# Antigravity Chat Tabs (VS Code / Antigravity IDE Extension)

**Author:** Bernardo Castro (`BernardoCastroDev`)

Adds a **Kiro-style horizontal multi-session tab bar** to the **Antigravity IDE** Agent side panel, making it effortless to see, switch between, and manage multiple conversations per workspace.

## Features

- **Horizontal Session Tabs per Workspace**: Automatically displays your open/recent conversations for the current workspace as tabs at the top of the Agent chat panel.
- **Persistent Tab Order**: Tabs stay in a stable order while you chat and persist across IDE restarts per workspace.
- **Integrated `New Session` Tab**: Start a new conversation in one click without losing your open conversation tabs.
- **Non-Destructive Tab Close (`×` or Middle-Click)**: Close tabs from the bar without deleting the conversation from your history.
- **Auto-Healing Across IDE Updates**: Automatically detects when Antigravity IDE updates itself and re-applies the Session Tabs bar on startup.

## Commands (`Ctrl+Shift+P` / `Cmd+Shift+P`)

- `Antigravity Chat Tabs: Enable Session Tabs`
- `Antigravity Chat Tabs: Restore Default Header`
- `Antigravity Chat Tabs: Check Status`

## Sharing & Publishing

### 1. Share the `.vsix` file directly
Other developers can install `antigravity-chat-tabs-1.0.0.vsix` in Antigravity IDE via:
`Extensions (Ctrl+Shift+X)` -> `...` (top right) -> **`Install from VSIX...`**

### 2. Publish to Open VSX Registry (Antigravity IDE Marketplace)
Antigravity IDE uses [Open VSX](https://open-vsx.org) as its official extension marketplace. To publish:
```bash
npx ovsx publish antigravity-chat-tabs-1.0.0.vsix -p <YOUR_OPEN_VSX_TOKEN>
```
