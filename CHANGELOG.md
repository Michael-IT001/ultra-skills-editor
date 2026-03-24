## v2.8.4
- **Routine Maintenance**: General performance optimizations, stability improvements, and documentation updates.

## v2.8.3
- **Routine Maintenance**: General bug fixes and under-the-hood optimization.

## v2.8.2
- **Import Path Fix**: Fixed an issue where newly imported/created global skills were still saved to the legacy path (`~/.antigravity/skills/`) instead of the new standard path (`~/.gemini/antigravity/skills/`). The new path is now always used for writes, while legacy paths remain scannable for reading existing skills.

## v2.8.8
- **UI Reversion**: Reverted the UI title and status bar text back to "My Skills / 我的技能" while keeping the extension display name as "Ultra Skills Editor".

## v2.8.7
- **Name Correction**: Reverted the extension display name to "Ultra Skills Editor" and updated command titles for consistency.
- **Skill Discovery Fix**: Enhanced skill discovery logic to support both folder-based (SKILL.md) and standalone (.md/.mdc) skills.
- **Branding Update**: Updated localized titles to "Ultra Skills Editor".

## [2.8.6] - 2026-03-24
### Changed
- **Branding**: Reverted display name to "My Skills / 我的技能".
- **UI**: Reverted to the clean 2.7.x interface (Removed Migration Wizard and cross-IDE discovery).
- **Paths**: Enhanced native Antigravity path support (`~/.gemini/antigravity/skills/`).
- **Isolation**: Each IDE now strictly manages its own skills scope.

## [2.7.27] - 2026-02-15
### Fixed
- Internal bug fixes and performance optimizations.

## v2.8.1
- **Unified Skill Storage Standard**: Updated default workspace paths to `.agents/skills/` across all supported IDEs (Cursor, VS Code, Antigravity, etc.) for consistency while maintaining backward compatibility.
- **Cross-Platform Path Recognition**: Enhanced path resolution logic to natively support both Windows and Mac directory structures, ensuring Windows `%USERPROFILE%` paths are correctly identified.
- **Documentation Sync**: Updated built-in storage path tables to reflect the new unified standards.

## v2.7.27
- **External File Drop Overlay No Longer Gets Stuck**: Reworked the webview’s external file-drag overlay cleanup so the blue drop frame is cleared consistently on drop, drag cancellation, blur, hidden visibility, Escape, and ordinary pointer clicks instead of relying on a narrow set of exit events.

## v2.7.26
- **Header Icons Raised To A Clearly Visible 18px**: Increased the top header icon size from 17px to 18px so the change is visibly stronger than the prior build while keeping the same crisp rendering, gray-frame interactions, and compact-layout behavior.

## v2.7.25
- **Header Icons Enlarged And De-Blurred**: Removed the fractional translate/scale adjustments from the top header icons so they render crisply again, then increased their header-only size slightly for a cleaner, larger appearance without changing the surrounding interactions.

## v2.7.24
- **Smart Group Icon Tuned And Compact Resizer Enabled**: Slightly increased the visual size of the top smart-group button so it no longer reads smaller than the other header icons. The existing divider now works in compact stacked layouts too, allowing the sidebar/editor split to be dragged vertically and restored from saved UI state.

## v2.7.23
- **Header Icon Alignment Polished And Pointer Focus Ring Suppressed**: Applied tiny header-only icon alignment offsets so the top four buttons keep the current overall size while landing on a more even visual baseline and footprint. Pointer clicks, including accidental `Shift` clicks, no longer leave the native yellow focus ring on those header buttons, while keyboard `Tab` focus remains visible.

## v2.7.22
- **Top Header Icons Restored To `2.6.30` Source SVGs**: Replaced the runtime expand/collapse header icon swap with the exact `2.6.30` SVG source so the top button row uses the same icon geometry again without changing the current hover/active gray-frame interaction.

## v2.7.21
- **Right-Click Menu Translations Completed Across All Supported Languages**: Filled in the missing context-menu group and multi-select strings for every shipped language. `Open in Finder` remains allowed to fall back to English.

## v2.7.20
- **Multi-Group Labels Now Follow The Selected Language**: Added localized multi-group dissolve and delete strings, and changed the UI fallback order so missing plural keys reuse the current language’s existing single-group wording instead of dropping to English.

## v2.7.19
- **Multi-Group Context Menu Fixed**: Group context actions now respect the full multi-group selection. `Dissolve Group` dissolves every selected group instead of only the clicked one, and `Rename Group` is hidden whenever multiple groups are targeted.

## v2.7.18
- **Drop Into Collapsed Groups**: Dragging skills over a collapsed group header now treats that header as a valid “drop into this group” target, so skills can be moved into folded groups without expanding them first.

## v2.7.17
- **Clear Button Limited To `@` Selection**: The header clear button now appears only for `@` copy-to-chat selections and no longer shows up for ordinary skill multi-select or drag selection.

## v2.7.16
- **Removed `@` From Skill Drag Proxy**: Multi-select and normal skill dragging now use a neutral stacked-selection icon instead of the `@` copy-to-chat marker, so drag feedback no longer suggests the wrong feature.

## v2.7.15
- **Batch Group Drag Restored**: Single-group anchor selection now commits on click instead of mousedown, so dragging one of several selected groups preserves the full multi-group drag display and animation behavior instead of collapsing to a single group first.

## v2.7.14
- **Collapse Clears Group Highlight**: Expanding or collapsing a group now immediately clears the group selection highlight, so the header does not stay visually selected after the toggle action.

## v2.7.13
- **Visible Group Selection Anchor**: A plain click on a group header now leaves that single group highlighted with the same selection style as multi-select, so the Shift-click range anchor is visible before extending the selection.

## v2.7.12
- **Shift-Click Group Range Selection**: Group multi-selection now follows standard list behavior. `Shift+Click` selects a visible range of groups, `Ctrl/Cmd+Click` toggles a single group, and a plain click only clears group selection while keeping the anchor for the next range select.

## v2.7.11
- **Single-Click Clears Group Multi-Selection**: A plain left click now exits group multi-selection reliably, including clicking a selected group header, a skill row, or empty space in the list.

## v2.7.10
- **Header Selection Logic Aligned to 2.6.30**: Restored the group-header selection and non-drag mouseup behavior to match 2.6.30, while keeping the already-fixed single-click arrow expand behavior.

## v2.7.9
- **Drag State Click Fix**: Fixed the root cause where plain mouse clicks could still pass through the drag-engine mouseup path, suppressing the intended click action such as single-click group-arrow expand.

## v2.7.8
- **Single-Click Group Arrow**: The group chevron now toggles expand or collapse on a single click and no longer gets blocked by the group drag behavior.

## v2.7.7
- **Header Row Reverted to 2.6.16 Layout**: Reverted the entire sidebar header button row to the original 2.6.16 sizing and positioning instead of per-icon adjustments.

## v2.7.6
- **Per-Icon Optical Alignment**: Switched from one shared size tweak to per-icon normalization so the three sidebar header glyphs align better in both overall size and vertical center.

## v2.7.5
- **Header Icon Size Increase**: Increased the overall size of the three sidebar header icons while keeping the corrected geometry and existing hover or active frame behavior.

## v2.7.4
- **Header Icon Geometry Fix**: Restored the first toolbar icon to the fuller 2.6.16 geometry and normalized the three header glyphs onto a consistent optical size.

## v2.7.3
- **Toolbar Icon Size Alignment**: Unified the optical sizing of the three sidebar header icons while preserving the existing hover and active gray-frame interaction.

## v2.6.32
- **Version Bump**: Updated to v2.6.32 to resolve Open VSX version conflict.

## v2.6.21
- **Version Bump**: Updated to v2.6.21.

## v2.6.19
- **🔄 元数据回滚与更新**: 将插件技术 ID 回退至 `antigravity-skills-editor` 以适配 Open VSX 的覆盖式更新，同时保留 "Ultra Skills Editor" 显示名称。
- **🧹 代码同步**: 同步所有内部命令 ID 与状态键，确保在 ID 变更后插件逻辑的连续性。

## v2.6.18
- **🚀 品牌重塑**: 正式更名为 "Ultra Skills Editor"。
- **🆔 命名空间优化**: 将 Publisher 锁定为 `Michael-IT001`。
- **📦 资源打包**: 完成 Open VSX 与 GitHub 的同步发布。

## v2.6.16
- **🔧 兼容性优化**: 回退元数据信息（显示名称与仓库地址）以适配 Open VSX 审核系统。

## v2.6.15
- **🔧 元数据修复**: 修正了仓库地址并再次尝试发布至 Open VSX。

## v2.6.14
- **🚢 批量文件夹导出 (Batch Folder Export)**:
    - 导出操作现在会整体复制文件夹（含资源文件），而不仅仅是 `.md`。
    - 支持多选后一键批量导出所有选中的文件夹。

## v2.6.13
- **✨ 组标题视觉重构**:
    - 将实心三角换成极简细笔触 Chevron 箭头。
    - 增加平滑的 90° 旋转展开动画。
- **🖱️ 交互逻辑优化**:
    - 单击组标题不再触发展开（防止误触），仅限双击或点击箭头展开。
- **📺 响应式布局修正**:
    - 修复了在窗口较短或侧边栏较窄时编辑器路径栏消失的问题。

## v2.6.12
- **⚡ 多选组拖拽 (Multi-select Group Drag)**:
    - 支持按住 `Shift` 点击组标题进行多选。
    - 允许将多个选中的组作为一个整体批量拖动换序。
- **🎨 拖拽视觉增强**:
    - 增加了批量拖拽时的堆叠代理卡片效果。
    - 选中的组现在有明显的高亮边框和背景提示。

## v2.6.11
- **📁 智能多文件夹导入**:
    - 修复了拖入多个文件夹时只能识别首个文件夹的 Bug。
    - 增加了对包含 `SKILL.md` 的深度嵌套文件夹的自动识别。
- **🚀 动画性能优化**:
    - 组排列切换动画使用 GPU 加速（translate3d），解决列表长时的卡顿感。
- **📑 导入弹窗统一**:
    - 拖拽导入现在使用与手动导入完全一样的 UI，支持摘要查看和冲突覆盖策略。

## v2.6.10
- **🛠️ 基础功能库更新与性能调优。**
