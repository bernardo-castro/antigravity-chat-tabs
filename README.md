# Antigravity Chat Tabs (VS Code / Antigravity IDE Extension)

**Author:** Bernardo Castro (`BernardoCastroDev`)

Adds a **Kiro-style horizontal multi-session tab bar** to the **Antigravity IDE** Agent side panel, making it effortless to work across multiple AI agent conversations in parallel per workspace.

---

## ✨ Features (v1.5.0)

- **Smart Multi-Tab Overflow & Navigation (`v1.5.0`)**:
  - 📐 **Elastic Chrome/VS Code-Style Tab Sizing**: Inactive tabs compress gracefully and hide their `✕` close button until hovered, while the **active tab** stays wide and readable.
  - ▾ **Searchable All-Tabs Dropdown (`▾ N`)**: Compact dropdown button next to `+` with a live status indicator (`⚠️`, `🔄`, `✓`), instant search filter, and quick Pin (`📌`) / Close (`✕`) actions for all open tabs.
  - ↔️ **Hover Horizontal Scrollbar & Wheel Scroll**: Sleek `3px` horizontal scrollbar on hover plus mouse wheel scrolling across the tab strip.
- **Per-Tab Context Isolation (Files, Consoles, Artifacts & Browser)**:
  - 📄 **Isolated `Changes Overview` & Per-Tab `Accept all` / `Reject all`**: Each conversation tab maintains a live background state subscription (`wKo`), attributes modified files strictly from explicit agent editing steps, and isolates `Accept all` / `Reject all` so accepting or rejecting changes in one tab never touches pending diffs from other parallel tabs.
  - `>_` **Isolated Background Consoles**: Filters background terminal processes per session and hides completed/canceled tasks automatically.
  - 📥 **Isolated Artifacts**: Displays only the artifacts generated within the active conversation.
  - 🌐 **Isolated Browser Pages**: Associates active browser pages with the conversation tab that launched them.
- **Parallel Multi-Session Status Indicators**:
  - 🔄 **Thinking / Processing Spinner**: Animated cyan spinner while a background tab is actively thinking or executing tools (synchronized directly with `agentStateProvider.status` for instant idle transitions).
  - 🟠 **Needs Attention Alert**: Pulsing amber badge + amber tab highlight when a background conversation is waiting for your approval or input.
  - ✅ **Completed / Unread Response (`✓`)**: Glowing emerald checkmark badge when a background tab finishes responding while you are working in another tab (clears automatically when you view the tab).
- **Automatic Bilingual UI (English & Español)**: Automatically detects the IDE language (`en` / `es`) and displays all menus, tooltips, and notifications in your language.
- **Seamless Inline Tab Rename (`2×Click` or Right-Click)**: Double-click any tab to edit its title inline with native dark tab styling and automatic end-of-line cursor placement.
- **Drag & Drop Tab Reordering**: Drag tabs left or right to organize your conversations; order is persisted per workspace.
- **Pin Tabs (`📌`)**: Pin important conversations to the start of the tab bar so they never get closed accidentally.
- **Right-Click Context Menu**:
  - `✏️ Rename tab` / `↺ Restore original title`
  - `📌 Pin / Unpin tab to start`
  - `✕ Close tab` / `⇄ Close other tabs` / `⇥ Close tabs to the right`
  - `⟲ Reopen last closed tab`
- **Integrated `+ New Session` Tab**: Start a new parallel conversation in one click without losing your open conversation tabs.
- **Auto-Healing & Syntax Safety Guard**: Automatically detects when Antigravity IDE updates itself, validates patched code syntax in memory (`vm.Script`), and re-applies the Session Tabs bar safely on startup.

---

## 🇪🇸 Características en Español (`v1.5.0`)

- **Navegación Inteligente para Muchas Pestañas (`v1.5.0`)**:
  - 📐 **Pestañas Elásticas estilo Chrome/VS Code**: Las pestañas inactivas se compactan automáticamente y ocultan la `✕` hasta pasar el mouse, manteniendo la **pestaña activa** siempre ancha y legible.
  - ▾ **Selector Desplegable con Buscador (`▾ N`)**: Botón compacto junto al `+` con alerta de estado en vivo, filtro instantáneo y acciones rápidas para fijar (`📌`) o cerrar (`✕`) cualquier pestaña.
  - ↔️ **Barra de Scroll Horizontal Sutil y Rueda del Mouse**: Scrollbar fino de `3px` al pasar el cursor sobre la barra de pestañas.
- **Aislamiento Total por Pestaña (Archivos, Consolas, Artifacts y Browser)**:
  - 📄 **Archivos Modificados (`Changes Overview`) y botones `Accept all` / `Reject all` aislados por pestaña**: Mantiene suscripciones activas por sesión, atribuye archivos únicamente por pasos explícitos de edición del agente y hace que `Accept all` / `Reject all` afecten exclusivamente los archivos de la pestaña actual sin tocar los diffs pendientes de otras pestañas.
  - `>_` **Consolas en segundo plano por sesión**: Muestra solo los procesos actualmente en ejecución de esa pestaña.
  - 📥 **Artifacts y 🌐 Browser aislados por conversación**.
- **Indicadores de Sesiones en Paralelo en Tiempo Real**:
  - 🔄 **Pensando / Procesando**: Spinner cian animado mientras el agente trabaja en segundo plano.
  - 🟠 **Requiere tu atención**: Punto ámbar pulsante y borde naranja cuando el agente necesita tu aprobación o respuesta.
  - ✅ **Terminó / Respuesta lista (`✓`)**: Check verde esmeralda cuando una pestaña en segundo plano termina su tarea (se limpia automáticamente al abrir la pestaña).
- **Idioma Automático (Español / Inglés)**: Detecta automáticamente el idioma de tu IDE.
- **Renombrado Directo Fluido (`Doble clic`)**, **Fijar Pestañas (`📌`)**, **Reordenar con Arrastrar y Soltar (`Drag & Drop`)** y **Menú Clic Derecho completo**.

## Commands (`Ctrl+Shift+P` / `Cmd+Shift+P`)

- `Antigravity Chat Tabs: Enable Session Tabs`
- `Antigravity Chat Tabs: Restore Default Header`
- `Antigravity Chat Tabs: Check Status`
