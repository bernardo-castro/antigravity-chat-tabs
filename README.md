# Antigravity Chat Tabs (VS Code / Antigravity IDE Extension)

**Author:** Bernardo Castro (`BernardoCastroDev`)

Professional multi-session workspace suite for **Antigravity IDE**. Transforms the Agent side panel into a high-performance parallel multi-agent environment featuring horizontal session tabs, complete per-tab context isolation (modified files, terminals, artifacts, and browser), and a floating multi-monitor AI Aura companion for real-time status & interactive notifications.

---

## ✨ Features (v1.6.0)

- **✨ Floating Multi-Monitor AI Aura Companion (`v1.6.0`)**:
  - 🖥️ **Always-On-Top Desktop Aura Cloud (Even with IDE Minimized)**: Organic floating circular aura that stays above all windows across any monitor, replacing generic IDE notifications.
  - 🔄 **Synchronized Chat Status Badges & Multi-Task Counters**: Mirrors the exact chat status icons (`🔄` blue thinking spinner, `🟠` amber waiting indicator, `✓` emerald ready check) with automatic counters when multiple chats are running or completed (`[ 🔄 2 ]`, `[ ✓ 2 ]`, or combined `[ 🔄 1 │ ✓ 1 ]`), and clears notifications as you view, close, or click them.
  - 📋 **Instant Floating Tab Switcher**: Click the floating orb at any time to list all open chat tabs with their live status, and click any tab to restore/un-minimize Antigravity IDE, bring it to the front, and jump directly to that conversation.
  - 🎨 **3 Aura Styles & 4 Notification Sound Presets**: Configure your aura directly from the IDE top bar (`Nebula`, `Aurora`, `Solaris`), choose between 4 synthesized notification tones (`Cristal`, `Pulso`, `Arpa`, `Zen`) or mute (`🔇`), toggle visibility, or reset position (`🎯`).
- **Smart Multi-Tab Overflow & Navigation (`v1.5.1`)**:
  - 📐 **Content-Hugging Elastic Tab Sizing**: Short tabs (like `"Git"`) stay compact around their text without wasting space, while long titles truncate cleanly with `...` at `max-width` and compress gracefully when many tabs are open.
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

## 🇪🇸 Características en Español (`v1.6.0`)

- **✨ Orbe de Aura IA Flotante Multimonitor (`v1.6.0`)**:
  - 🖥️ **Siempre Visible en Escritorio (Incluso con el IDE Minimizado)**: Nube orgánica circular tipo aura que flota sobre cualquier ventana o monitor, reemplazando las notificaciones genéricas del IDE.
  - 🔄 **Iconos de Estado Sincronizados y Contadores Multitarea**: Imita exactamente los iconos de los chats (**Cargando azul** mientras piensa, **Círculo ámbar** cuando requiere atención y **Check verde `✓`** al terminar), mostrando contadores cuando hay más de un chat activo o terminado (`[ 🔄 2 ]`, `[ ✓ 2 ]`) o una cápsula combinada (`[ 🔄 1 │ ✓ 1 ]`), y eliminando el aviso al verlo, cerrarlo o pinchar el icono.
  - 📋 **Selector Rápido de Pestañas desde el Orbe**: Al presionar el orbe flotante se listan todas las pestañas abiertas con su estado en tiempo real; al hacer clic en cualquiera, des-minimiza Antigravity IDE, lo trae al frente y abre directamente esa pestaña.
  - 🎨 **3 Estilos de Aura y 4 Tonos de Notificación**: Personaliza el aura desde el botón superior del IDE (`Nebula`, `Aurora`, `Solaris`), elige entre 4 sonidos (`Cristal`, `Pulso`, `Arpa`, `Zen`) o silenciar (`🔇`), activar/ocultar o restablecer su posición (`🎯`).
- **Navegación Inteligente para Muchas Pestañas (`v1.5.1`)**:
  - 📐 **Ancho de Pestaña Ajustado al Contenido**: Las pestañas con nombres cortos (ej. `"Git"`) se ajustan a su texto sin malgastar espacio, mientras que los títulos largos se truncan con `...` y se compactan automáticamente cuando hay muchas pestañas abiertas.
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
