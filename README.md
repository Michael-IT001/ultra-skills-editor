# 🧠 Ultra Skills Editor

<p align="center">
  <img src="https://raw.githubusercontent.com/Michael-IT001/ultra-skills-editor/main/media/intro-demo.gif" alt="Ultra Skills Editor demo" width="900" />
</p>

> A multi-language skills management extension for **VS Code, Cursor, Trae (Global & CN), Windsurf, Antigravity, Qoder, and CodeBuddy**.  
> Create, edit, import, and organize your AI skills from a single panel.

---

## 💡 How to Open the Editor

There are **3 easy ways** to launch the Ultra Skills Editor:

1. **Status Bar**: Click the wrench button in the status bar.
2. **Right-Click Menu**: Right-click any `.md` / `.mdc` file or folder and choose **Import as Skill / 导入为技能**.
3. **Command Palette**: Run `Open Skills Editor`.

> 💡 **Shift + Drag to Import**  
> Hold `Shift` and drag multiple `.md` / `.mdc` files or folders into the panel to batch import them.

---

## 📸 Core Workflows

### Smart Grouping

<table>
  <tr>
    <th align="left">Preview</th>
    <th align="left">What it does</th>
  </tr>
  <tr>
    <td valign="top" width="260">
      <img src="https://raw.githubusercontent.com/Michael-IT001/ultra-skills-editor/main/media/smart-grouping.png" alt="Smart Grouping button inside Ultra Skills Editor" width="240" />
    </td>
    <td valign="top">
      <strong>Clean up a messy skill library in one click.</strong><br><br>
      Smart Grouping automatically sorts ungrouped skills into practical sections such as Frontend, Backend, AI, Testing, and Docs.<br><br>
      - Useful right after large imports.<br>
      - Keeps the sidebar readable with visible group counts.<br>
      - Works naturally with later drag-and-drop refinement.
    </td>
  </tr>
</table>

### Batch `@` Copy + Favorites

<table>
  <tr>
    <th align="left">Preview</th>
    <th align="left">What it does</th>
  </tr>
  <tr>
    <td valign="top" width="260">
      <img src="https://raw.githubusercontent.com/Michael-IT001/ultra-skills-editor/main/media/clipboard-favorites.png" alt="Selected skills with batch @ copy and favorite stars" width="240" />
    </td>
    <td valign="top">
      <strong>Reuse your best skills faster.</strong><br><br>
      Select multiple skills with the `@` cart workflow to copy them into the clipboard as markdown-ready references, then star important ones to keep them close at hand.<br><br>
      - Batch copy selected skills for chat or prompt building.<br>
      - Favorite high-value skills for quick recall.<br>
      - Combine with <strong>Recent / Favorite / Global / Project</strong> filters for faster browsing.
    </td>
  </tr>
</table>

### Batch Import with Destination Choice

<table>
  <tr>
    <th align="left">Preview</th>
    <th align="left">What it does</th>
  </tr>
  <tr>
    <td valign="top" width="260">
      <img src="https://raw.githubusercontent.com/Michael-IT001/ultra-skills-editor/main/media/batch-import-destination.png" alt="Batch import modal with Global and Project destination choice" width="240" />
    </td>
    <td valign="top">
      <strong>Import in bulk without losing control.</strong><br><br>
      Drop in multiple files or folders, preview how many skills will be created, choose how to handle naming conflicts, and decide whether the import should be saved as <strong>Global</strong> or only for the <strong>current project</strong>.<br><br>
      - Supports drag-and-drop and toolbar import.<br>
      - Shows a batch preview before committing.<br>
      - Lets you choose the destination per import session.
    </td>
  </tr>
</table>

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

## 🚀 Getting Started

### Installation

1. Download the latest `.vsix` from the [Releases](https://github.com/Michael-IT001/antigravity-skills-editor/releases) page.
2. Open the Extensions panel in Antigravity, Cursor, or another supported editor.
3. Open the extensions menu and choose **Install from VSIX...**.
4. Select the package and reload the window.

---

## 📁 How Skills Are Stored (Dynamic Routing)

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

## 💻 Cross-Platform Compatibility

- **macOS** (Intel & Apple Silicon)
- **Windows** (10 / 11)
- **Linux** (Ubuntu, Debian, and similar distributions)

---

## 📄 License

This project is licensed under the [MIT License](https://github.com/Michael-IT001/antigravity-skills-editor/blob/main/LICENSE).
