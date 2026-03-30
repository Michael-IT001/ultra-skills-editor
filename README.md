# Ultra Skills Editor

<p align="center">
  <img src="https://raw.githubusercontent.com/Michael-IT001/antigravity-skills-editor/main/media/intro-demo.gif" alt="Ultra Skills Editor demo" width="100%" />
</p>

<p align="center">
  <strong>Smart Grouping</strong> ·
  <strong>Batch @ Copy</strong> ·
  <strong>Favorites</strong> ·
  <strong>Global / Project Import</strong> ·
  <strong>16 Languages</strong>
</p>

> Local-first skill manager for **VS Code, Cursor, Trae (Global & CN), Windsurf, Antigravity, Qoder, and CodeBuddy**.  
> Create, edit, import, organize, favorite, and batch-copy skills from one panel.

---

## ⚡ Quick Start

| Task | How |
|---|---|
| Open the editor | Click the status bar button, run `Open Skills Editor`, or use `Import as Skill / 导入为技能` from the explorer context menu. |
| Batch import | Hold `Shift` and drag `.md` / `.mdc` files or folders into the panel, or use the import button in the header. |
| Save and reuse | Press `Ctrl/Cmd + S` to save, use the `@` cart to copy selected skills, and star important skills with Favorites. |

---

## 📸 Core Workflows

### Smart Grouping

| Preview | What it does |
|---|---|
| ![Smart Grouping button inside Ultra Skills Editor](https://raw.githubusercontent.com/Michael-IT001/antigravity-skills-editor/main/media/smart-grouping.png) | **Clean up a messy skill library in one click.**<br><br>Smart Grouping automatically sorts ungrouped skills into practical sections such as Frontend, Backend, AI, Testing, and Docs.<br><br>- Useful right after large imports.<br>- Keeps the sidebar readable with visible group counts.<br>- Works naturally with later drag-and-drop refinement. |

### Batch `@` Copy + Favorites

| Preview | What it does |
|---|---|
| ![Selected skills with batch @ copy and favorite stars](https://raw.githubusercontent.com/Michael-IT001/antigravity-skills-editor/main/media/clipboard-favorites.png) | **Reuse your best skills faster.**<br><br>Select multiple skills with the `@` cart workflow to copy them into the clipboard as markdown-ready references, then star important ones to keep them close at hand.<br><br>- Batch copy selected skills for chat or prompt building.<br>- Favorite high-value skills for quick recall.<br>- Combine with **Recent / Favorite / Global / Project** filters for faster browsing. |

### Batch Import with Destination Choice

| Preview | What it does |
|---|---|
| ![Batch import modal with Global and Project destination choice](https://raw.githubusercontent.com/Michael-IT001/antigravity-skills-editor/main/media/batch-import-destination.png) | **Import in bulk without losing control.**<br><br>Drop in multiple files or folders, preview how many skills will be created, choose how to handle naming conflicts, and decide whether the import should be saved as **Global** or only for the **current project**.<br><br>- Supports drag-and-drop and toolbar import.<br>- Shows a batch preview before committing.<br>- Lets you choose the destination per import session. |

---

## ✅ More Practical Features

| Feature | Why it matters |
|---|---|
| **Group drag-and-drop** | Reorder skills and groups directly in the sidebar. |
| **Group multi-select** | Use `Shift + Click` on group labels to move multiple groups together. |
| **Batch export** | Export entire skill folders, not just a single markdown file. |
| **Duplicate** | Clone an existing skill to reuse it as a template. |
| **Quick save** | Press `Ctrl/Cmd + S` to save without leaving the editor. |
| **Keyboard shortcut** | Toggle the editor with `Cmd + Shift + K` on Mac or `Ctrl + Shift + K` on Windows. |

---

## 🌍 Supported Languages

| | | | |
|---|---|---|---|
| 🇺🇸 English | 🇨🇳 简体中文 | 🇹🇼 繁體中文 | 🇯🇵 日本語 |
| 🇩🇪 Deutsch | 🇪🇸 Español | 🇫🇷 Français | 🇮🇹 Italiano |
| 🇰🇷 한국어 | 🇧🇷 Português | 🇷🇺 Русский | 🇹🇷 Türkçe |
| 🇵🇱 Polski | 🇨🇿 Čeština | 🇸🇦 العربية | 🇻🇳 Tiếng Việt |

The interface follows the editor language on first launch, and you can switch it later from the language selector in the sidebar footer.

---

## 🚀 Installation

1. Download the latest `.vsix` from the [Releases](https://github.com/Michael-IT001/antigravity-skills-editor/releases) page.
2. Open the Extensions panel in Antigravity, Cursor, or another supported editor.
3. Open the extensions menu and choose **Install from VSIX...**.
4. Select the package and reload the window.

---

## 📁 Storage Routing

Global and project skills are routed to each IDE's native directories.

| Your IDE | Global Storage Path | Default Project Storage Path |
|----------|-------------------|----------------------------|
| **Antigravity / Gemini** | `~/.gemini/antigravity/skills/` | `.agents/skills/` |
| **Cursor** | `~/.cursor/skills/` | `.agents/skills/` |
| **Windsurf** | `~/.codeium/windsurf/skills/` | `.windsurf/skills/` |
| **Trae (Global)** | `~/.trae/skills/` | `.trae/skills/` |
| **Trae CN (国内版)** | `~/.trae-cn/skills/` | `.trae/skills/` |
| **VS Code** | `~/.copilot/skills/` | `.agents/skills/` |
| **Qoder** | `~/.qoder/skills/` | `.agents/skills/` |
| **CodeBuddy** | `~/.codebuddy/skills/` | `.agents/skills/` |

Windows paths are mapped automatically to the corresponding `%USERPROFILE%` locations.

---

## 🔒 Security & Privacy

- **100% Local**: Skill processing, file operations, and grouping run locally.
- **No External Calls**: The extension does not send your skills, file paths, or workspace data to external services.
- **No Telemetry**: Your usage stays inside your editor and filesystem.

---

## 📄 License

This project is licensed under the [MIT License](https://github.com/Michael-IT001/antigravity-skills-editor/blob/main/LICENSE).
