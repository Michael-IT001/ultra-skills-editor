# Changelog

All notable changes to the **Ultra Skills Editor** will be documented in this file.

## [1.8.4] - 2026-03-06
- 📝 **Documentation**: Clearly outlined how new users can locate and open the Skills Editor panel (via the Status Bar, Command Palette, or Right-Click menu) in `README.md`.

## [1.8.3] - 2026-03-06
- 🐛 **Bug Fix**: Fixed a visual issue where the VS Code/Cursor status bar item text wouldn't instantly update when switching languages inside the extension UI.

## [1.8.2] - 2026-03-05
- 🎉 **Rebranded to Ultra Skills Editor**: Renamed to better reflect its universal support for both Antigravity and Cursor IDEs!
- 🚀 **Dual IDE Support**: Intelligent environment detection natively routes to `~/.cursor/skills` (Cursor) or `~/.antigravity/skills` (Antigravity).
- ✨ **Context Menu Magic**: Right-clicking any skill in the sidebar now opens a custom Context Menu.
- ✏️ **Skill Renaming**: The new Context Menu allows you to quickly rename skills directly from the IDE UI without opening the file explorer.
- 🐛 **Bug Fix**: Fixed a critical bug where the UI would get stuck on "Loading..." due to unescaped unicode characters in Webview injections.


## [1.1.0] - 2026-02-27
- ✨ **Drag-and-Drop Reordering**: Introduced a new feature to manually reorder skills by dragging and dropping items in the sidebar.
- 💾 **Persistent Order**: Custom skill order is now saved and persisted across sessions.
- ↔️ **Resizable Sidebar**: Added a resizer to the sidebar, allowing users to customize the width of the skills list.
- 🧹 **Code Cleaning**: Removed internal metadata and prepared the package for public release.

## [1.0.18] - 2026-02-27
- 🔧 **Internal Prep**: Codebase cleanup and structural optimizations.

## [1.0.17] - 2026-02-23
- 🐛 **Critical UI Fix**: Resolved a regression where CSS source code was leaking into the UI as raw text.
- 🏗️ **Structural Hardening**: Sanitized HTML/CSS injection in the webview to ensure consistent rendering across all environments.

## [1.0.16] - 2026-02-23
- 🎨 **Intelligent Responsive Layout**: The UI now adapts dynamically to sidebar resizing.
- 📱 **Adaptive Toolbars**: Button text automatically transforms into clean, centered icons in narrow views, preventing layout overlap.
- 🏷️ **Smart Header**: The skill path intelligently hides when space is limited, prioritizing the skill title.
- 💎 **Premium Aesthetic Refactoring**: Optimized editor padding and button spacing for a more high-end feel.

## [1.0.15] - 2026-02-23
- ✨ **Universal `@` Icon System**: All skills now feature a consistent `@` icon for a cleaner, unified look.
- 🛒 **Icon-Direct Selection**: Click the `@` icon directly to toggle skills. Selected skills light up in vibrant blue.
- ⚡ **Shift + Click Multi-select**: Implementation of range selection—hold Shift while clicking icons to select multiple skills instantly.
- 🌍 **Full Localization**: All selection notifications and button states are now fully translated across 16 languages.

## [1.0.13] - 2026-02-23
- 🐛 Fixed critical Webview templating issues with safe string concatenation.
- 🧹 Added "Clear Selection" icon to sidebar header for easier clipboard management.
- 🌍 Completed translations for all UI elements.

## [1.0.9] - 2026-02-23
- 🐛 Rendering stability improvements.

## [1.0.8] - 2026-02-23
- ✨ Introduced frontend skill selection state management for the clipboard cart feature.

## [1.0.7] - 2026-02-23
- 📦 Added smart clipboard accumulation: multiple Global skills can be chained into a single clipboard payload.

## [1.0.6] - 2026-02-23
- 📋 Added `Copy to Chat` button for Global Skills, allowing one-click copy of a Markdown skill reference to paste directly into your AI chat.

## [1.0.5] - 2026-02-23
- 📦 UI improvements for Global Skills panel actions.

## [1.0.1] - 2026-02-22
- 🌍 Expanded localization to 16 languages.
- 🔒 Code hardening and stability improvements for public release.

## [1.0.0] - 2026-02-22
### Added
- 🎉 Initial public release
- 📝 Full skill CRUD (Create, Read, Update, Delete)
- 📦 Import skills from `.md` files and skill directories
- 🌍 16 language support with automatic detection and manual switching
- 🎨 Native Cursor / Antigravity theme integration
- 💾 `Ctrl/Cmd + S` quick save shortcut
- 🔒 Confirmation dialogs for save and delete operations
- 🗂️ Global and project-scoped skill storage
- 🌐 Persistent language preference across sessions
