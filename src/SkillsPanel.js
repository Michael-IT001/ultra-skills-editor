const vscode = require('vscode');
const path = require('path');
const fs = require('fs');
const os = require('os');
const translations = require('./i18n');

function getMergedTranslations(lang) {
    const base = translations['en'] || {};
    const locale = translations[lang] || {};
    return {
        ...base,
        ...locale,
        groupLabels: {
            ...(base.groupLabels || {}),
            ...(locale.groupLabels || {})
        }
    };
}

function createSkillContent(name, desc, body) {
    const n = name || '';
    const d = desc || n;
    const b = body || '';
    return `---\nname: ${n}\ndescription: ${d}\n---\n\n${b}`;
}

class SkillsPanel {
    static currentPanel = undefined;
    static viewType = 'skillsEditor';
    static builtInGroupAliases = {
        'ungrouped': '',
        '未分组': '',
        '未分組': '',
        'frontend': 'smart.frontend',
        '前端开发': 'smart.frontend',
        '前端開發': 'smart.frontend',
        'backend': 'smart.backend',
        '后端服务': 'smart.backend',
        '後端服務': 'smart.backend',
        'mobile': 'smart.mobile',
        '移动开发': 'smart.mobile',
        '行動開發': 'smart.mobile',
        'devops': 'smart.devops',
        '运维部署': 'smart.devops',
        '維運部署': 'smart.devops',
        'ai': 'smart.ai',
        '人工智能': 'smart.ai',
        '人工智慧': 'smart.ai',
        'data': 'smart.data',
        '数据分析': 'smart.data',
        '數據分析': 'smart.data',
        'database': 'smart.database',
        'databases': 'smart.database',
        '数据库': 'smart.database',
        '資料庫': 'smart.database',
        'testing': 'smart.testing',
        '测试质量': 'smart.testing',
        '測試品質': 'smart.testing',
        'design': 'smart.design',
        '设计视觉': 'smart.design',
        '設計視覺': 'smart.design',
        'docs': 'smart.docs',
        '文档写作': 'smart.docs',
        '文件寫作': 'smart.docs',
        'automation': 'smart.automation',
        'workflow automation': 'smart.automation',
        '自动化流程': 'smart.automation',
        '自動化流程': 'smart.automation',
        'utilities': 'smart.utilities',
        '工具脚本': 'smart.utilities',
        '工具腳本': 'smart.utilities',
        'security': 'smart.security',
        '安全审计': 'smart.security',
        '安全審計': 'smart.security',
        'collaboration': 'smart.collab',
        'collab': 'smart.collab',
        '协作沟通': 'smart.collab',
        '協作溝通': 'smart.collab',
        'product': 'smart.product',
        'prd': 'smart.product',
        '产品规划': 'smart.product',
        '產品規劃': 'smart.product',
        'research': 'smart.research',
        '研究分析': 'smart.research',
        'localization': 'smart.localization',
        'translation': 'smart.localization',
        'i18n': 'smart.localization',
        'l10n': 'smart.localization',
        '本地化': 'smart.localization',
        '在地化': 'smart.localization',
        'business': 'smart.business',
        'marketing': 'smart.business',
        'business ops': 'smart.business',
        '商业增长': 'smart.business',
        '商業增長': 'smart.business'
    };

    static createOrShow(context) {
        const column = vscode.window.activeTextEditor ? vscode.window.activeTextEditor.viewColumn : undefined;
        if (SkillsPanel.currentPanel && SkillsPanel.currentPanel._panel && typeof SkillsPanel.currentPanel._panel.reveal === 'function') {
            SkillsPanel.currentPanel._panel.reveal(column); return;
        }
        let existing = SkillsPanel.currentPanel;
        if (!existing) {
            existing = new SkillsPanel(context);
            SkillsPanel.currentPanel = existing;
        }

        const panelTitle = existing._i18n.title || 'My Skills';
        const panel = vscode.window.createWebviewPanel(SkillsPanel.viewType, panelTitle, column || vscode.ViewColumn.One, { enableScripts: true, retainContextWhenHidden: true });

        existing._panel = panel;
        existing._setupPanel(panel);
    }

    constructor(context) {
        this._context = context;
        this._disposables = [];
        this._loadRevision = 0;
        this._activeSkillPath = null;
        this._skillsCache = [];
        this._refreshTimer = null;
        this._refreshPoller = null;
        this._fsWatchers = [];
        this._dirSignature = '';
        this._recentSkillPaths = context.globalState.get('antigravityRecentSkillPaths', []);
        this._lang = this._resolveLang();
        this._i18n = getMergedTranslations(this._lang);
    }

    resolveWebviewView(webviewView, context, _token) {
        this._panel = webviewView;
        webviewView.webview.options = { enableScripts: true };
        this._setupWebview(webviewView.webview);
        SkillsPanel.currentPanel = this;
        this._update();
    }

    _setupPanel(panel) {
        this._setupWebview(panel.webview);
        this._registerRuntimeHooks();
        panel.onDidDispose(() => {
            if (SkillsPanel.currentPanel === this) SkillsPanel.currentPanel = undefined;
            this.dispose();
        }, null, this._disposables);
        this._update();
    }

    _setupWebview(webview) {
        webview.onDidReceiveMessage(message => {
            switch (message.command) {
                case 'requestSkills': {
                    var extra = {};
                    if (this._pendingLangState) { extra.restoreState = this._pendingLangState; this._pendingLangState = null; }
                    this._postSkills(extra); return;
                }
                case 'saveSkill': this._saveSkill(message.skillPath, message.content); return;
                case 'deleteSkill': this._deleteSkill(message.skillPath); return;
                case 'renameSkill': this._renameSkill(message.skillPath, message.newName); return;
                case 'importSkills': this._importSkills(); return;
                case 'importDroppedPaths': this._importDroppedPaths(message.paths); return;
                case 'dropFilesContent': this._handleDroppedContent(message); return;
                case 'openInFinder': this._openInFinder(message.skillPath); return;
                case 'createSkill': this._createSkill(message.skillName, message.isGlobal, message.description, message.body); return;
                case 'writeToClipboardExact': this._writeToClipboardExact(message.payload, message.count); return;
                case 'changeLang': this._changeLang(message.lang, message.state); return;
                case 'saveOrder': this._saveOrder(message.order); return;
                case 'saveTopLevelOrder': this._saveTopLevelOrder(message.order); return;
                case 'saveGroupOrder': this._saveGroupOrder(message.groupOrder); return;
                case 'saveManualEmptyGroups': this._saveManualEmptyGroups(message.manualEmptyGroups); return;
                case 'saveFavorites': this._saveFavorites(message.favorites); return;
                case 'saveCollapsedGroups': this._saveCollapsedGroups(message.collapsedGroups); return;
                case 'saveRecentSkills': this._saveRecentSkills(message.recentSkills); return;
                case 'saveUiState': this._saveUiState(message.state); return;
                case 'commitLayout': this._commitLayout(message); return;
                case 'setActiveSkill': this._activeSkillPath = message.skillPath || null; return;
                case 'exportSkills': this._exportSkills(message.skillPaths); return;
                case 'duplicateSkill': this._duplicateSkill(message.skillPath); return;
                case 'deleteSkills': this._deleteSkills(message.skillPaths); return;
                case 'showInfo': vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: message.text, cancellable: false }, () => new Promise(r => setTimeout(r, 3000))); return;
                case 'confirmSwitch':
                    vscode.window.showWarningMessage(
                        this._i18n.switchSavePrompt.replace('{0}', message.skillName),
                        { modal: true },
                        { title: this._i18n.saveBtnDialog },
                        { title: this._i18n.dontSaveBtn, isCloseAffordance: true }
                    ).then(choice => {
                        if (choice && choice.title === this._i18n.saveBtnDialog) { this._panel.webview.postMessage({ command: 'switchApproved', save: true }); }
                        else if (choice && choice.title === this._i18n.dontSaveBtn) { this._panel.webview.postMessage({ command: 'switchApproved', save: false }); }
                    });
                    return;
            }
        }, null, this._disposables);
    }

    _resolveLang() {
        let lang = this._context.globalState.get('antigravitySkillsLang');
        if (lang && translations[lang]) return lang;
        const vsLang = (vscode.env.language || 'en').toLowerCase();
        if (translations[vsLang]) return vsLang;
        const base = vsLang.split('-')[0];
        if (translations[base]) return base;
        const map = { 'zh-cn': 'zh-cn', 'zh-tw': 'zh-tw', 'zh-hant': 'zh-tw', 'zh-hans': 'zh-cn', 'pt-br': 'pt-br', 'pt': 'pt-br' };
        if (map[vsLang]) return map[vsLang];
        return 'en';
    }

    _detectIDE() {
        const appName = (vscode.env.appName || '').toLowerCase();
        const appRoot = (vscode.env.appRoot || '').toLowerCase();
        let execPath = '';
        try { execPath = (process.execPath || '').toLowerCase(); } catch (e) { }
        const all = appName + ' ' + appRoot + ' ' + execPath;
        if (all.includes('trae-cn') || all.includes('trae_cn') || all.includes('traecn') || appName.includes('trae cn')) return 'trae-cn';
        if (all.includes('trae')) return 'trae';
        if (all.includes('cursor')) return 'cursor';
        if (all.includes('qoder')) return 'qoder';
        if (all.includes('windsurf')) return 'windsurf';
        if (all.includes('codebuddy')) return 'codebuddy';
        if (all.includes('antigravity')) return 'antigravity';
        if (all.includes('visual studio') || all.includes('vscode')) return 'vscode';
        return 'ultra';
    }

    _getIDEPaths() {
        const map = {
            'cursor': {
                globalCandidates: ['.cursor/skills'],
                projectDir: '.agents/skills',
                projectCandidates: ['.agents/skills', '.cursor/rules', '.cursor/skills', '.cursor', 'cursor_skills', '.cursor/prompts']
            },
            'trae': {
                globalCandidates: ['.trae/skills'],
                projectDir: '.trae/skills',
                projectCandidates: ['.trae', 'trae_skills']
            },
            'trae-cn': {
                globalCandidates: ['.trae-cn/skills'],
                projectDir: '.trae/skills',
                projectCandidates: ['.trae/skills', '.trae-cn/skills', '.trae-cn', 'trae_skills']
            },
            'qoder': {
                globalCandidates: ['.qoder/skills'],
                projectDir: '.agents/skills',
                projectCandidates: ['.agents/skills', '.qoder/skills', '.qoder', 'qoder_skills', '.qoder/rules']
            },
            'windsurf': {
                globalCandidates: ['.codeium/windsurf/skills', '.windsurf/skills'],
                projectDir: '.windsurf/skills',
                projectCandidates: ['.windsurf/skills', '.windsurf/rules', '.windsurf', 'windsurf_skills']
            },
            'codebuddy': {
                globalCandidates: ['.codebuddy/skills'],
                projectDir: '.agents/skills',
                projectCandidates: ['.agents/skills', '.codebuddy/skills', '.codebuddy', 'codebuddy_skills']
            },
            'vscode': {
                globalCandidates: ['.copilot/skills'],
                projectDir: '.agents/skills',
                projectCandidates: ['.agents/skills', '.github/skills', '.github/prompts']
            },
            'ultra': {
                globalCandidates: ['.gemini/antigravity/skills', '.antigravity/skills'],
                projectDir: '.agents/skills',
                projectCandidates: ['.agents/skills', '.agent/skills', 'skills', 'antigravity_skills']
            },
            'antigravity': {
                globalCandidates: ['.gemini/antigravity/skills', '.antigravity/skills'],
                projectDir: '.agents/skills',
                projectCandidates: ['.agents/skills', '.agent/skills', 'skills', 'antigravity_skills']
            }
        };
        const ide = this._detectIDE();
        if (ide === 'ultra') {
            const legacyDir = path.join(os.homedir(), '.antigravity');
            if (fs.existsSync(legacyDir) && !fs.existsSync(path.join(os.homedir(), '.ultra-skills'))) return map['antigravity'];
        }
        return map[ide] || map['antigravity'];
    }

    _resolveGlobalSkillDirs(idePaths) {
        const candidates = Array.isArray(idePaths.globalCandidates) && idePaths.globalCandidates.length
            ? idePaths.globalCandidates
            : [path.join(idePaths.globalDir || '', 'skills')];
        const seen = new Set();
        const dirs = [];
        for (const relPath of candidates) {
            const fullPath = path.join(os.homedir(), ...String(relPath).split(/[\\/]+/).filter(Boolean));
            const normalized = path.normalize(fullPath);
            if (seen.has(normalized)) continue;
            seen.add(normalized);
            dirs.push(normalized);
        }
        return dirs;
    }

    _getPrimaryGlobalSkillDir(idePaths) {
        const dirs = this._resolveGlobalSkillDirs(idePaths);
        const ide = this._detectIDE();
        if (ide === 'antigravity' || ide === 'ultra') {
            // Always use the new standard path for imports and new skills
            return dirs[0];
        }
        const existing = dirs.find((dirPath) => fs.existsSync(dirPath));
        return existing || dirs[0];
    }

    _shouldSkipSkillSearchDir(dirName) {
        const lower = String(dirName || '').toLowerCase();
        if (!lower) return true;
        const ignored = new Set([
            '.git', '.svn', '.hg', '.idea', '.vscode', '.history',
            'node_modules', 'vendor', 'dist', 'build', 'coverage',
            '.next', '.nuxt', '.turbo', '.cache', '.parcel-cache',
            '.yarn', '.pnpm-store', '__pycache__', '.pytest_cache',
            '.venv', 'venv', 'target', 'bin', 'obj', '.gradle'
        ]);
        return ignored.has(lower);
    }

    _findSkillMarkdownFiles(rootPath) {
        const results = [];
        if (!rootPath || !fs.existsSync(rootPath)) return results;

        const visited = new Set();
        const stack = [rootPath];

        while (stack.length > 0) {
            const currentDir = stack.pop();
            const normalizedDir = path.normalize(currentDir);
            if (visited.has(normalizedDir)) continue;
            visited.add(normalizedDir);

            let entries = [];
            try {
                entries = fs.readdirSync(currentDir, { withFileTypes: true });
            } catch (err) {
                continue;
            }

            if (entries.some((entry) => entry.isFile() && entry.name === 'SKILL.md')) {
                results.push(path.join(currentDir, 'SKILL.md'));
            }

            for (const entry of entries) {
                if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
                if (this._shouldSkipSkillSearchDir(entry.name)) continue;
                stack.push(path.join(currentDir, entry.name));
            }
        }

        return results;
    }

    _extractSkillDisplayData(content, fallbackName) {
        let displayName = fallbackName;
        let description = '';
        let groupName = '';

        const fmMatch = content.match(/^---\s*\n([\s\S]*?)\n---/);
        if (fmMatch) {
            const lines = fmMatch[1].split('\n');
            for (const line of lines) {
                const nMatch = line.match(/^name:\s*(.+)$/i);
                if (nMatch) displayName = nMatch[1].trim();
                const dMatch = line.match(/^description:\s*(.+)$/i);
                if (dMatch) description = dMatch[1].trim();
                const gMatch = line.match(/^group:\s*(.+)$/i);
                if (gMatch) groupName = this._normalizeGroupValue(gMatch[1].trim());
            }
        }

        return { displayName, description, groupName };
    }

    _resolveImportTargetDir(isGlobal) {
        const paths = this._getEditorPaths();
        if (isGlobal) return paths.global;
        const wsPath = this._getWorkspacePath();
        if (!wsPath) return null;
        return this._getProjectSkillDir(wsPath);
    }

    _sanitizeSkillFolderName(name, fallbackIndex = 0) {
        let safeName = String(name || '').trim().replace(/[\\/:*?"<>|]/g, '-');
        if (!safeName) safeName = 'Skill_' + Date.now() + '_' + fallbackIndex;
        return safeName;
    }

    _getImportItemSuggestedName(item, fallbackIndex = 0) {
        if (!item) return this._sanitizeSkillFolderName('', fallbackIndex);

        if (item.kind === 'markdown') {
            const content = item.content || '';
            const fmMatch = content.match(/^---\s*\n([\s\S]*?)\n---/);
            if (fmMatch) {
                const nameMatch = fmMatch[1].match(/name:\s*(.+)/);
                if (nameMatch && nameMatch[1].trim()) {
                    return this._sanitizeSkillFolderName(nameMatch[1].trim(), fallbackIndex);
                }
            }

            let baseName = String(item.name || '').replace(/\.(md|mdc)$/i, '');
            if (['SKILL', 'README', 'skill', 'readme'].includes(baseName)) baseName = '';
            return this._sanitizeSkillFolderName(baseName, fallbackIndex);
        }

        return this._sanitizeSkillFolderName(item.name || item.suggestedName || '', fallbackIndex);
    }

    async _resolveImportDestination(targetDir, requestedName, strategy) {
        const t = this._i18n;
        let useName = this._sanitizeSkillFolderName(requestedName);
        let destDir = path.join(targetDir, useName);

        if (!fs.existsSync(destDir)) {
            return { useName, destDir };
        }

        if (strategy === 'skip') return null;
        if (strategy === 'overwrite') {
            fs.rmSync(destDir, { recursive: true, force: true });
            return { useName, destDir };
        }
        if (strategy === 'rename') {
            let counter = 1;
            const baseName = useName;
            while (fs.existsSync(path.join(targetDir, baseName + '_' + counter))) counter++;
            useName = baseName + '_' + counter;
            return { useName, destDir: path.join(targetDir, useName) };
        }

        const action = await vscode.window.showWarningMessage(
            t.overwritePrompt.replace('{0}', useName),
            { modal: true },
            t.overwriteBtn, t.createCopyBtn
        );
        if (action === t.overwriteBtn) {
            fs.rmSync(destDir, { recursive: true, force: true });
            return { useName, destDir };
        }
        if (action === t.createCopyBtn) {
            useName = useName + '_Copy_' + Date.now();
            return { useName, destDir: path.join(targetDir, useName) };
        }
        return null;
    }

    _copyDirectoryRecursive(sourceDir, destDir) {
        if (fs.cpSync) {
            fs.cpSync(sourceDir, destDir, { recursive: true });
            return;
        }

        fs.mkdirSync(destDir, { recursive: true });
        for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
            const sourcePath = path.join(sourceDir, entry.name);
            const destPath = path.join(destDir, entry.name);
            if (entry.isDirectory()) {
                this._copyDirectoryRecursive(sourcePath, destPath);
            } else if (entry.isFile()) {
                fs.copyFileSync(sourcePath, destPath);
            }
        }
    }

    _writeImportedFolderTree(destDir, files) {
        fs.mkdirSync(destDir, { recursive: true });
        for (const file of (files || [])) {
            const rawRelativePath = String(file.relativePath || '').replace(/\\/g, '/');
            const safeParts = rawRelativePath.split('/').filter((part) => part && part !== '.' && part !== '..');
            if (safeParts.length === 0) continue;
            const destPath = path.join(destDir, ...safeParts);
            fs.mkdirSync(path.dirname(destPath), { recursive: true });
            const buffer = Buffer.from(String(file.contentBase64 || ''), 'base64');
            fs.writeFileSync(destPath, buffer);
        }
    }

    _expandFolderTreeImportItem(item) {
        const files = Array.isArray(item && item.files) ? item.files : [];
        if (files.length === 0) return [];

        const normalizedFiles = files.map((file) => ({
            ...file,
            relativePath: String(file.relativePath || '').replace(/\\/g, '/').replace(/^\/+/, '')
        }));
        const rootSkillFile = normalizedFiles.find((file) => file.relativePath === 'SKILL.md');
        if (rootSkillFile) {
            return [{
                kind: 'folderTree',
                name: item.name,
                files: normalizedFiles
            }];
        }

        const skillRoots = Array.from(new Set(
            normalizedFiles
                .filter((file) => /(^|\/)SKILL\.md$/.test(file.relativePath))
                .map((file) => path.posix.dirname(file.relativePath))
                .filter((dirPath) => dirPath && dirPath !== '.')
        )).sort((a, b) => a.localeCompare(b));

        return skillRoots.map((rootDir) => ({
            kind: 'folderTree',
            name: path.posix.basename(rootDir),
            files: normalizedFiles
                .filter((file) => file.relativePath === rootDir || file.relativePath.startsWith(rootDir + '/'))
                .map((file) => ({
                    ...file,
                    relativePath: file.relativePath === rootDir ? path.posix.basename(file.relativePath) : file.relativePath.slice(rootDir.length + 1)
                }))
        }));
    }

    _collectImportItemsFromPath(filePath) {
        const items = [];
        if (!filePath || !fs.existsSync(filePath)) return items;

        let stat;
        try {
            stat = fs.statSync(filePath);
        } catch (err) {
            return items;
        }

        if (stat.isDirectory()) {
            const rootSkillPath = path.join(filePath, 'SKILL.md');
            if (fs.existsSync(rootSkillPath)) {
                items.push({ kind: 'folderPath', name: path.basename(filePath), sourcePath: filePath });
                return items;
            }

            const skillRoots = Array.from(new Set(this._findSkillMarkdownFiles(filePath).map((skillPath) => path.dirname(skillPath))));
            for (const skillRoot of skillRoots) {
                items.push({ kind: 'folderPath', name: path.basename(skillRoot), sourcePath: skillRoot });
            }
            return items;
        }

        if (filePath.endsWith('.md') || filePath.endsWith('.mdc')) {
            try {
                items.push({
                    kind: 'markdown',
                    name: path.basename(filePath),
                    content: fs.readFileSync(filePath, 'utf8')
                });
            } catch (err) {
                return items;
            }
        }

        return items;
    }

    async _importResolvedItems(items, skillName, isGlobal, strategy = 'ask') {
        if (!Array.isArray(items) || items.length === 0) return;

        const t = this._i18n;
        const targetDir = this._resolveImportTargetDir(isGlobal);
        if (!targetDir) {
            vscode.window.showErrorMessage(t.wsError);
            return;
        }

        const expandedItems = [];
        for (const item of items) {
            if (item && item.kind === 'folderTree') expandedItems.push(...this._expandFolderTreeImportItem(item));
            else if (item) expandedItems.push(item);
        }
        if (expandedItems.length === 0) return;

        try {
            if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });

            let count = 0;
            const importedSkillPaths = [];
            for (let index = 0; index < expandedItems.length; index++) {
                const item = expandedItems[index];
                const preferredName = (expandedItems.length === 1 && skillName)
                    ? skillName
                    : this._getImportItemSuggestedName(item, index);
                const resolved = await this._resolveImportDestination(targetDir, preferredName, strategy);
                if (!resolved) continue;

                const { useName, destDir } = resolved;
                if (item.kind === 'folderPath') {
                    this._copyDirectoryRecursive(item.sourcePath, destDir);
                    const skillMdPath = path.join(destDir, 'SKILL.md');
                    if (fs.existsSync(skillMdPath)) {
                        const content = fs.readFileSync(skillMdPath, 'utf8');
                        fs.writeFileSync(skillMdPath, this._prepareImportedSkillContent(content, useName), 'utf8');
                        importedSkillPaths.push(skillMdPath);
                    }
                    count++;
                    continue;
                }

                if (item.kind === 'folderTree') {
                    this._writeImportedFolderTree(destDir, item.files);
                    const skillMdPath = path.join(destDir, 'SKILL.md');
                    if (fs.existsSync(skillMdPath)) {
                        const content = fs.readFileSync(skillMdPath, 'utf8');
                        fs.writeFileSync(skillMdPath, this._prepareImportedSkillContent(content, useName), 'utf8');
                        importedSkillPaths.push(skillMdPath);
                    }
                    count++;
                    continue;
                }

                if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
                const skillMdPath = path.join(destDir, 'SKILL.md');
                fs.writeFileSync(skillMdPath, this._prepareImportedSkillContent(item.content || '', useName), 'utf8');
                importedSkillPaths.push(skillMdPath);
                count++;
            }

            if (count > 0) {
                await this._rememberKnownSkillPaths(importedSkillPaths);
                vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: t.importSuccess + ' (' + count + ')', cancellable: false }, () => new Promise((resolve) => setTimeout(resolve, 3000)));
                this._postSkills();
            }
        } catch (err) {
            vscode.window.showErrorMessage(t.importFailed + ' ' + err.message);
        }
    }

    _changeLang(lang, state) {
        if (!translations[lang]) return;
        this._lang = lang; this._i18n = getMergedTranslations(lang);
        this._context.globalState.update('antigravitySkillsLang', lang);
        if (SkillsPanel.statusBarItem) { SkillsPanel.statusBarItem.text = '$(tools) ' + this._i18n.title; SkillsPanel.statusBarItem.tooltip = this._i18n.create; }
        this._pendingLangState = state || null;
        this._update();
    }

    dispose() {
        if (this._refreshTimer) clearTimeout(this._refreshTimer);
        if (this._refreshPoller) clearInterval(this._refreshPoller);
        this._disposeFsWatchers();
        SkillsPanel.currentPanel = undefined; this._panel.dispose();
        while (this._disposables && this._disposables.length) { const x = this._disposables.pop(); if (x) x.dispose(); }
    }

    _registerRuntimeHooks() {
        if (this._runtimeHooksRegistered) return;
        this._runtimeHooksRegistered = true;

        this._disposables.push(vscode.window.onDidChangeWindowState((state) => {
            if (state && state.focused && SkillsPanel.currentPanel === this) {
                this._scheduleSkillsRefresh();
            }
        }));
        this._disposables.push(vscode.workspace.onDidChangeWorkspaceFolders(() => {
            if (SkillsPanel.currentPanel === this) {
                this._scheduleSkillsRefresh();
            }
        }));
        this._refreshPoller = setInterval(() => {
            if (!this._panel || SkillsPanel.currentPanel !== this) return;
            if (typeof this._panel.visible === 'boolean' && !this._panel.visible) return;
            const nextSignature = this._captureSkillDirSignature();
            if (nextSignature !== this._dirSignature) {
                this._dirSignature = nextSignature;
                this._scheduleSkillsRefresh(60);
            }
        }, 2000);
    }

    _scheduleSkillsRefresh(delay = 180) {
        if (!this._panel || SkillsPanel.currentPanel !== this) return;
        if (this._refreshTimer) clearTimeout(this._refreshTimer);
        this._refreshTimer = setTimeout(() => {
            this._refreshTimer = null;
            this._postSkills();
        }, delay);
    }

    _disposeFsWatchers() {
        while (this._fsWatchers.length > 0) {
            const watcher = this._fsWatchers.pop();
            try { watcher.close(); } catch (err) {}
        }
    }

    _refreshFsWatchers() {
        this._disposeFsWatchers();
        const watchedDirs = new Set();
        for (const { path: dirPath } of this._getSkillDirectories()) {
            const normalizedPath = path.normalize(dirPath);
            if (watchedDirs.has(normalizedPath) || !fs.existsSync(normalizedPath)) continue;
            watchedDirs.add(normalizedPath);
            try {
                let watcher = null;
                try {
                    watcher = fs.watch(normalizedPath, { persistent: false, recursive: true }, () => {
                        this._scheduleSkillsRefresh(60);
                    });
                } catch (recursiveErr) {
                    watcher = fs.watch(normalizedPath, { persistent: false }, () => {
                        this._scheduleSkillsRefresh(60);
                    });
                }
                this._fsWatchers.push(watcher);
            } catch (err) {}
        }
        this._dirSignature = this._captureSkillDirSignature();
    }

    _captureSkillDirSignature() {
        return this._getSkillDirectories().map(({ path: dirPath, type }) => {
            const normalizedPath = path.normalize(dirPath);
            try {
                const stat = fs.statSync(normalizedPath);
                return [type, normalizedPath, 'exists', Math.floor(stat.mtimeMs)].join(':');
            } catch (err) {
                return [type, normalizedPath, 'missing'].join(':');
            }
        }).join('|');
    }

    _getWorkspacePath() { return vscode.workspace.workspaceFolders ? vscode.workspace.workspaceFolders[0].uri.fsPath : undefined; }

    _getSkillDirectories() {
        const dirs = []; const idePaths = this._getIDEPaths();
        this._resolveGlobalSkillDirs(idePaths).forEach((dirPath) => {
            dirs.push({ path: dirPath, type: 'Global' });
        });
        const wsPath = this._getWorkspacePath();
        if (wsPath) {
            const candidates = Array.isArray(idePaths.projectCandidates) ? idePaths.projectCandidates.slice() : [];
            if (!candidates.includes(idePaths.projectDir)) candidates.push(idePaths.projectDir);
            const seenProjectDirs = new Set();
            for (const cand of candidates) {
                const full = path.join(wsPath, cand);
                const normalizedFull = path.normalize(full);
                if (seenProjectDirs.has(normalizedFull)) continue;
                seenProjectDirs.add(normalizedFull);
                dirs.push({ path: normalizedFull, type: 'Project' });
            }
        }
        return dirs;
    }

    _getEditorPaths() {
        const idePaths = this._getIDEPaths();
        return { global: this._getPrimaryGlobalSkillDir(idePaths), projectDefault: idePaths.projectDir };
    }

    _getProjectSkillDir(wsPath) {
        if (!wsPath) return null;
        return path.join(wsPath, this._getIDEPaths().projectDir);
    }

    async _update() { this._panel.title = this._i18n.title; this._panel.webview.html = this._getHtmlForWebview(); }

    _normalizeGroupValue(group) {
        const raw = (group || '').trim();
        if (!raw || raw === 'Ungrouped') return '';
        const lower = raw.toLowerCase();
        if (lower in SkillsPanel.builtInGroupAliases) return SkillsPanel.builtInGroupAliases[lower];
        if (raw in SkillsPanel.builtInGroupAliases) return SkillsPanel.builtInGroupAliases[raw];
        return raw;
    }

    _normalizeGroupUpdates(updates) {
        return (updates || []).map(({ skillPath, group }) => ({
            skillPath,
            group: this._normalizeGroupValue(group)
        }));
    }

    async _loadSkills() {
        const skills = [];
        const seenPaths = new Set();
        const skillEntries = [];

        for (const { path: dirPath, type } of this._getSkillDirectories()) {
            for (const skillMdPath of this._findSkillMarkdownFiles(dirPath)) {
                skillEntries.push({ skillMdPath, type });
            }
        }

        const workspaceFolders = vscode.workspace.workspaceFolders || [];
        if (workspaceFolders.length > 0) {
            const excludePattern = '**/{node_modules,vendor,dist,build,coverage,.git,.svn,.hg,.idea,.vscode,.history,.next,.nuxt,.turbo,.cache,.parcel-cache,.yarn,.pnpm-store,__pycache__,.pytest_cache,.venv,venv,target,bin,obj,.gradle}/**';
            const workspaceResults = await Promise.all(workspaceFolders.map((folder) =>
                vscode.workspace.findFiles(new vscode.RelativePattern(folder, '**/SKILL.md'), excludePattern, 2000)
            ));
            workspaceResults.forEach((uris) => {
                (uris || []).forEach((uri) => {
                    skillEntries.push({ skillMdPath: uri.fsPath, type: 'Project' });
                });
            });
        }

        for (const { skillMdPath, type } of skillEntries) {
            const normalizedPath = path.normalize(skillMdPath);
            if (seenPaths.has(normalizedPath)) continue;
            seenPaths.add(normalizedPath);

            try {
                const content = fs.readFileSync(skillMdPath, 'utf8');
                const mtime = fs.statSync(skillMdPath).mtimeMs;
                const fallbackName = path.basename(path.dirname(skillMdPath));
                const meta = this._extractSkillDisplayData(content, fallbackName);

                skills.push({
                    name: fallbackName,
                    displayName: meta.displayName,
                    path: skillMdPath,
                    content,
                    type,
                    description: meta.description,
                    mtime,
                    group: meta.groupName
                });
            } catch (e) {
                console.error(`Error loading skill at ${skillMdPath}:`, e);
            }
        }

        const savedOrder = this._context.globalState.get('antigravitySkillsOrder', []);
        if (savedOrder && savedOrder.length > 0) {
            skills.sort((a, b) => {
                const idxA = savedOrder.indexOf(a.path);
                const idxB = savedOrder.indexOf(b.path);
                if (idxA !== -1 && idxB !== -1) return idxA - idxB;
                if (idxA !== -1) return -1;
                if (idxB !== -1) return 1;
                return a.name.localeCompare(b.name);
            });
        } else {
            skills.sort((a, b) => a.displayName.localeCompare(b.displayName));
        }
        await this._normalizeExternallyAddedSkills(skills);
        this._skillsCache = skills;
        this._refreshFsWatchers();
        return skills;
    }

    async _normalizeExternallyAddedSkills(skills) {
        const storedKnownPaths = this._context.globalState.get('antigravityKnownSkillPaths');
        const currentPaths = skills.map((skill) => skill.path);
        if (!Array.isArray(storedKnownPaths)) {
            await this._context.globalState.update('antigravityKnownSkillPaths', currentPaths);
            return;
        }

        const knownPathSet = new Set(storedKnownPaths);
        for (const skill of skills) {
            if (knownPathSet.has(skill.path)) continue;
            const folderName = path.basename(path.dirname(skill.path));
            const normalizedContent = this._prepareImportedSkillContent(skill.content || '', folderName);
            if (normalizedContent !== skill.content) {
                try {
                    fs.writeFileSync(skill.path, normalizedContent, 'utf8');
                    skill.content = normalizedContent;
                } catch (err) {}
            }
            const meta = this._extractSkillDisplayData(skill.content, folderName);
            skill.name = folderName;
            skill.displayName = folderName;
            skill.description = meta.description;
            skill.group = '';
        }

        await this._context.globalState.update('antigravityKnownSkillPaths', currentPaths);
    }

    _getSkills() {
        return Array.isArray(this._skillsCache) ? this._skillsCache.slice() : [];
    }

    _getKnownSkillPaths() {
        const stored = this._context.globalState.get('antigravityKnownSkillPaths', []);
        return Array.isArray(stored) ? stored.slice() : [];
    }

    async _rememberKnownSkillPaths(paths) {
        const nextPaths = new Set(this._getKnownSkillPaths());
        let changed = false;
        for (const skillPath of (paths || [])) {
            if (!skillPath || nextPaths.has(skillPath)) continue;
            nextPaths.add(skillPath);
            changed = true;
        }
        if (changed) {
            await this._context.globalState.update('antigravityKnownSkillPaths', Array.from(nextPaths));
        }
    }

    async _replaceKnownSkillPath(oldPath, newPath) {
        if (!oldPath || !newPath) return;
        const nextPaths = this._getKnownSkillPaths().map((skillPath) => skillPath === oldPath ? newPath : skillPath);
        const deduped = Array.from(new Set(nextPaths.filter(Boolean)));
        await this._context.globalState.update('antigravityKnownSkillPaths', deduped);
    }

    async _removeKnownSkillPaths(paths) {
        const pathSet = new Set((paths || []).filter(Boolean));
        if (pathSet.size === 0) return;
        await this._context.globalState.update(
            'antigravityKnownSkillPaths',
            this._getKnownSkillPaths().filter((skillPath) => !pathSet.has(skillPath))
        );
    }

    _saveOrder(order) { this._context.globalState.update('antigravitySkillsOrder', order); }
    _saveTopLevelOrder(order) { this._context.globalState.update('antigravitySkillsTopLevelOrder', order || []); }
    _saveGroupOrder(order) { this._context.globalState.update('antigravitySkillsGroupOrder', order); }
    _saveManualEmptyGroups(arr) { this._context.globalState.update('antigravitySkillsManualEmptyGroups', arr || []); }
    _saveFavorites(arr) { this._context.globalState.update('antigravitySkillsFavorites', arr || []); }
    _saveCollapsedGroups(arr) { this._context.globalState.update('antigravitySkillsCollapsedGroups', arr || []); }
    _saveRecentSkills(arr) {
        this._recentSkillPaths = Array.isArray(arr) ? arr.slice() : [];
        this._context.globalState.update('antigravityRecentSkillPaths', this._recentSkillPaths);
    }
    _saveUiState(state) { this._context.globalState.update('antigravitySkillsUiState', state || null); }
    async _replacePathInStoredOrders(oldPath, newPath) {
        if (!oldPath || !newPath || oldPath === newPath) return;
        const savedOrder = this._context.globalState.get('antigravitySkillsOrder', []);
        if (Array.isArray(savedOrder) && savedOrder.indexOf(oldPath) !== -1) {
            await this._context.globalState.update('antigravitySkillsOrder', savedOrder.map((path) => path === oldPath ? newPath : path));
        }
        const topLevelOrder = this._context.globalState.get('antigravitySkillsTopLevelOrder', []);
        if (Array.isArray(topLevelOrder)) {
            const oldToken = 'skill:' + oldPath;
            if (topLevelOrder.indexOf(oldToken) !== -1) {
                await this._context.globalState.update('antigravitySkillsTopLevelOrder', topLevelOrder.map((token) => token === oldToken ? ('skill:' + newPath) : token));
            }
        }
        const favorites = this._context.globalState.get('antigravitySkillsFavorites', []);
        if (Array.isArray(favorites) && favorites.indexOf(oldPath) !== -1) {
            await this._context.globalState.update('antigravitySkillsFavorites', favorites.map((path) => path === oldPath ? newPath : path));
        }
        const recentSkills = this._context.globalState.get('antigravityRecentSkillPaths', []);
        if (Array.isArray(recentSkills) && recentSkills.indexOf(oldPath) !== -1) {
            this._recentSkillPaths = recentSkills.map((path) => path === oldPath ? newPath : path);
            await this._context.globalState.update('antigravityRecentSkillPaths', this._recentSkillPaths);
        }
        await this._replaceKnownSkillPath(oldPath, newPath);
    }
    async _removePathsFromStoredOrders(paths) {
        const pathSet = new Set((paths || []).filter(Boolean));
        if (pathSet.size === 0) return;
        const savedOrder = this._context.globalState.get('antigravitySkillsOrder', []);
        if (Array.isArray(savedOrder)) {
            await this._context.globalState.update('antigravitySkillsOrder', savedOrder.filter((path) => !pathSet.has(path)));
        }
        const topLevelOrder = this._context.globalState.get('antigravitySkillsTopLevelOrder', []);
        if (Array.isArray(topLevelOrder)) {
            await this._context.globalState.update('antigravitySkillsTopLevelOrder', topLevelOrder.filter((token) => {
                return !(typeof token === 'string' && token.indexOf('skill:') === 0 && pathSet.has(token.slice(6)));
            }));
        }
        const favorites = this._context.globalState.get('antigravitySkillsFavorites', []);
        if (Array.isArray(favorites)) {
            await this._context.globalState.update('antigravitySkillsFavorites', favorites.filter((path) => !pathSet.has(path)));
        }
        const recentSkills = this._context.globalState.get('antigravityRecentSkillPaths', []);
        if (Array.isArray(recentSkills)) {
            this._recentSkillPaths = recentSkills.filter((path) => !pathSet.has(path));
            await this._context.globalState.update('antigravityRecentSkillPaths', this._recentSkillPaths);
        }
        await this._removeKnownSkillPaths(Array.from(pathSet));
    }

    _getCleanStatePaths(key) {
        const arr = this._context.globalState.get(key, []);
        if (!Array.isArray(arr)) return arr || [];
        const cleanArr = arr.filter(p => {
            if (!p || typeof p !== 'string') return false;
            try { return fs.existsSync(p); } catch (e) { return false; }
        });
        if (cleanArr.length !== arr.length) this._context.globalState.update(key, cleanArr);
        return cleanArr;
    }

    _getCleanTopLevelOrder() {
        const arr = this._context.globalState.get('antigravitySkillsTopLevelOrder', []);
        if (!Array.isArray(arr)) return arr || [];
        const cleanArr = arr.filter(token => {
            if (typeof token !== 'string') return false;
            if (token.indexOf('skill:') === 0) {
                try { return fs.existsSync(token.slice(6)); } catch(e) { return false; }
            }
            return true;
        });
        if (cleanArr.length !== arr.length) this._context.globalState.update('antigravitySkillsTopLevelOrder', cleanArr);
        return cleanArr;
    }

    async _postSkills(extra = {}) {
        this._loadRevision += 1;
        const currentRevision = this._loadRevision;
        const restoreState = typeof extra.restoreState !== 'undefined'
            ? extra.restoreState
            : this._context.globalState.get('antigravitySkillsUiState', null);
        let loadedSkills = [];
        try {
            loadedSkills = await this._loadSkills();
        } catch (err) {
            console.error('Failed to load skills:', err);
            this._skillsCache = [];
        }
        if (!this._panel || currentRevision !== this._loadRevision) return;

        const cleanFavorites = this._getCleanStatePaths('antigravitySkillsFavorites');
        const cleanRecents = this._getCleanStatePaths('antigravityRecentSkillPaths');
        this._recentSkillPaths = cleanRecents;

        this._panel.webview.postMessage({
            command: 'loadSkills',
            skills: loadedSkills,
            revision: currentRevision,
            topLevelOrder: this._getCleanTopLevelOrder(),
            groupOrder: this._context.globalState.get('antigravitySkillsGroupOrder', []),
            manualEmptyGroups: this._context.globalState.get('antigravitySkillsManualEmptyGroups', []),
            favorites: cleanFavorites,
            collapsedGroups: this._context.globalState.get('antigravitySkillsCollapsedGroups', []),
            recentSkills: cleanRecents,
            restoreState,
            ...extra
        });
    }

    async _commitLayout(message) {
        try {
            if (Array.isArray(message.order)) {
                await this._context.globalState.update('antigravitySkillsOrder', message.order);
            }
            if (Array.isArray(message.topLevelOrder)) {
                await this._context.globalState.update('antigravitySkillsTopLevelOrder', message.topLevelOrder);
            }
            if (Array.isArray(message.groupOrder)) {
                await this._context.globalState.update('antigravitySkillsGroupOrder', message.groupOrder);
            }
            if (Array.isArray(message.manualEmptyGroups)) {
                await this._context.globalState.update('antigravitySkillsManualEmptyGroups', message.manualEmptyGroups);
            }
            const updates = this._normalizeGroupUpdates(message.updates || []);
            for (const { skillPath, group } of updates) {
                if (fs.existsSync(skillPath)) {
                    const content = fs.readFileSync(skillPath, 'utf8');
                    const updatedContent = this._updateFrontmatterGroup(content, group);
                    fs.writeFileSync(skillPath, updatedContent, 'utf8');
                }
            }
            this._postSkills({
                layoutSync: true,
                layoutUpdatedPaths: updates.map((item) => item.skillPath)
            });
        } catch (err) {
            console.error('Failed to commit layout:', err);
        }
    }

    async _saveSkill(skillPath, content) {
        try {
            const dir = path.dirname(skillPath);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(skillPath, content, 'utf8');
            let finalSkillPath = skillPath;

            // Sync folder name with the newly saved 'name:' field
            const fmMatch = content.match(/^---\s*\n([\s\S]*?)\n---/);
            if (fmMatch) {
                const nameMatch = fmMatch[1].match(/name:\s*(.+)/);
                if (nameMatch && nameMatch[1].trim()) {
                    const newName = nameMatch[1].trim();
                    const currentName = path.basename(dir);
                    if (newName !== currentName) {
                        const parentDir = path.dirname(dir);
                        const newDir = path.join(parentDir, newName);
                        // Allow case-only rename on case-insensitive systems like macOS
                        if (!fs.existsSync(newDir) || newDir.toLowerCase() === dir.toLowerCase()) {
                            fs.renameSync(dir, newDir);
                            finalSkillPath = path.join(newDir, 'SKILL.md');
                            await this._replacePathInStoredOrders(skillPath, finalSkillPath);
                        } else {
                            vscode.window.showErrorMessage(this._i18n.renameFailed + ' A skill with that name already exists.');
                        }
                    }
                }
            }
            this._postSkills({
                restoreState: { currentPath: finalSkillPath },
                saveResult: { ok: true, skillPath, savedPath: finalSkillPath }
            });
        } catch (err) {
            this._panel.webview.postMessage({ command: 'saveResult', ok: false, skillPath });
            vscode.window.showErrorMessage(this._i18n.saveFailed + ' ' + err.message);
        }
    }

    async _deleteSkill(skillPath) {
        try {
            const dir = path.dirname(skillPath);
            if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
            await this._removePathsFromStoredOrders([skillPath]);
            this._postSkills();
        } catch (err) { vscode.window.showErrorMessage(this._i18n.deleteFailed + ' ' + err.message); }
    }

    async _deleteSkills(skillPaths) {
        try {
            const seenDirs = new Set();
            for (const skillPath of (skillPaths || [])) {
                if (!skillPath) continue;
                const dir = path.dirname(skillPath);
                if (!seenDirs.has(dir) && fs.existsSync(dir)) {
                    seenDirs.add(dir);
                    fs.rmSync(dir, { recursive: true, force: true });
                }
            }
            await this._removePathsFromStoredOrders(skillPaths);
            this._postSkills();
        } catch (err) { vscode.window.showErrorMessage(this._i18n.deleteFailed + ' ' + err.message); }
    }

    /** Update group in frontmatter content string, returns updated content */
    _updateFrontmatterGroup(content, newGroup) {
        const normalizedGroup = this._normalizeGroupValue(newGroup);
        const fmMatch = content.match(/^(---\s*\n)([\s\S]*?)(\n---)/);
        if (fmMatch) {
            let fm = fmMatch[2];
            if (normalizedGroup) {
                if (fm.match(/group:\s*.*/)) {
                    fm = fm.replace(/group:\s*.*/, 'group: ' + normalizedGroup);
                } else {
                    fm = fm + '\ngroup: ' + normalizedGroup;
                }
            } else {
                fm = fm.replace(/\n?group:\s*.*/, '');
            }
            return fmMatch[1] + fm + fmMatch[3] + content.substring(fmMatch[0].length);
        }
        if (normalizedGroup) {
            return '---\ngroup: ' + normalizedGroup + '\n---\n' + content;
        }
        return content;
    }

    /** Update name: in frontmatter content string, returns updated content */
    _updateFrontmatterName(content, newName) {
        const fmMatch = content.match(/^(---\s*\n)([\s\S]*?)(\n---)/);
        if (fmMatch) {
            let fm = fmMatch[2];
            if (fm.match(/name:\s*.*/)) {
                fm = fm.replace(/name:\s*.*/, 'name: ' + newName);
            } else {
                fm = 'name: ' + newName + '\n' + fm;
            }
            return fmMatch[1] + fm + fmMatch[3] + content.substring(fmMatch[0].length);
        }
        // No frontmatter found, add one
        return '---\nname: ' + newName + '\ndescription: ' + newName + '\n---\n' + content;
    }

    _prepareImportedSkillContent(content, newName) {
        const renamed = this._updateFrontmatterName(content || '', newName);
        return this._updateFrontmatterGroup(renamed, '');
    }

    async _renameSkill(skillPath, newName) {
        if (!skillPath || !newName) return;
        try {
            const oldDir = path.dirname(skillPath); const parentDir = path.dirname(oldDir); const newDir = path.join(parentDir, newName);
            if (fs.existsSync(newDir)) { vscode.window.showErrorMessage(this._i18n.renameFailed + ' A skill with that name already exists.'); return; }
            fs.renameSync(oldDir, newDir);
            // Sync name: in SKILL.md frontmatter
            const newSkillMdPath = path.join(newDir, 'SKILL.md');
            if (fs.existsSync(newSkillMdPath)) {
                let content = fs.readFileSync(newSkillMdPath, 'utf8');
                fs.writeFileSync(newSkillMdPath, this._updateFrontmatterName(content, newName), 'utf8');
            }
            await this._replacePathInStoredOrders(skillPath, newSkillMdPath);
            this._postSkills({ restoreState: { currentPath: newSkillMdPath } });
        } catch (err) { vscode.window.showErrorMessage(this._i18n.renameFailed + ' ' + err.message); }
    }

    async _exportSkills(skillPaths) {
        if (!skillPaths || skillPaths.length === 0) return;
        const t = this._i18n;
        try {
            const isBatch = skillPaths.length > 1;
            const uri = await vscode.window.showOpenDialog({
                canSelectFiles: false,
                canSelectFolders: true,
                canSelectMany: false,
                title: isBatch ? (t.exportBtn || 'Export Folders') : (t.exportBtn || 'Export Folder'),
                openLabel: t.exportBtn || 'Export'
            });
            
            if (!uri || uri.length === 0) return;
            const destBase = uri[0].fsPath;
            
            for (const skillPath of skillPaths) {
                if (!skillPath || !fs.existsSync(skillPath)) continue;
                const folderPath = path.dirname(skillPath);
                const folderName = path.basename(folderPath);
                const destPath = path.join(destBase, folderName);
                
                // If destination folder already exists, maybe warn or increment? 
                // For now, let's just copy into it.
                this._copyDirectoryRecursive(folderPath, destPath);
            }
            
            vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: t.exportSuccess, cancellable: false }, () => new Promise(r => setTimeout(r, 3000)));
        } catch (err) { vscode.window.showErrorMessage(t.exportFailed + ' ' + err.message); }
    }

    _exportCurrentSkill() {
        const skills = this._getSkills();
        if (skills.length === 0) return;
        const activeSkill = this._activeSkillPath
            ? skills.find((skill) => skill.path === this._activeSkillPath)
            : null;
        this._exportSkills([(activeSkill || skills[0]).path]);
    }

    async _duplicateSkill(skillPath) {
        if (!skillPath) return;
        const t = this._i18n;
        try {
            const oldDir = path.dirname(skillPath); const parentDir = path.dirname(oldDir);
            const baseName = path.basename(oldDir); let newName = baseName + '_copy'; let counter = 1;
            while (fs.existsSync(path.join(parentDir, newName))) { newName = baseName + '_copy_' + counter; counter++; }
            const newDir = path.join(parentDir, newName);
            if (fs.cpSync) fs.cpSync(oldDir, newDir, { recursive: true });
            const newSkillMdPath = path.join(newDir, 'SKILL.md');
            if (fs.existsSync(newSkillMdPath)) {
                const content = fs.readFileSync(newSkillMdPath, 'utf8');
                fs.writeFileSync(newSkillMdPath, this._updateFrontmatterName(content, newName), 'utf8');
            }
            await this._rememberKnownSkillPaths([newSkillMdPath]);
            const savedOrder = this._context.globalState.get('antigravitySkillsOrder', []);
            if (Array.isArray(savedOrder) && savedOrder.indexOf(skillPath) !== -1) {
                const nextOrder = savedOrder.slice();
                nextOrder.splice(nextOrder.indexOf(skillPath) + 1, 0, newSkillMdPath);
                await this._context.globalState.update('antigravitySkillsOrder', nextOrder);
            }
            const sourceSkill = this._getSkills().find((skill) => skill.path === skillPath);
            const topLevelOrder = this._context.globalState.get('antigravitySkillsTopLevelOrder', []);
            if (sourceSkill && Array.isArray(topLevelOrder) && (!sourceSkill.group || sourceSkill.group === 'Ungrouped')) {
                const sourceToken = 'skill:' + skillPath;
                if (topLevelOrder.indexOf(sourceToken) !== -1) {
                    const nextTopLevelOrder = topLevelOrder.slice();
                    nextTopLevelOrder.splice(nextTopLevelOrder.indexOf(sourceToken) + 1, 0, 'skill:' + newSkillMdPath);
                    await this._context.globalState.update('antigravitySkillsTopLevelOrder', nextTopLevelOrder);
                }
            }
            vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: t.duplicateSuccess, cancellable: false }, () => new Promise(r => setTimeout(r, 3000)));
            this._postSkills({ restoreState: { currentPath: newSkillMdPath } });
        } catch (err) { vscode.window.showErrorMessage(t.saveFailed + ' ' + err.message); }
    }

    async _importDroppedPaths(paths) {
        const items = [];
        for (const filePath of (paths || [])) {
            items.push(...this._collectImportItemsFromPath(filePath));
        }
        if (items.length > 0) {
            this._panel.webview.postMessage({ command: 'showImportModal', files: items, source: 'picker' });
        }
    }

    async _importSkills() {
        const t = this._i18n;
        const uris = await vscode.window.showOpenDialog({ canSelectFiles: true, canSelectFolders: true, canSelectMany: true, openLabel: t.importBtn, filters: { 'Markdown': ['md', '*'] } });
        if (!uris || uris.length === 0) return;
        const files = [];
        for (const fileUri of uris) {
            files.push(...this._collectImportItemsFromPath(fileUri.fsPath));
        }
        if (files.length > 0) {
            this._panel.webview.postMessage({ command: 'showImportModal', files, source: 'picker' });
        }
    }

    async _handleDroppedContent(message) {
        const files = message.files;
        const skillName = message.skillName;
        const isGlobal = message.isGlobal;
        const strategy = message.strategy || 'ask';
        if (!files || files.length === 0) return;
        await this._importResolvedItems(files, skillName, isGlobal, strategy);
    }

    async _openInFinder(skillPath) {
        if (!skillPath) return;
        try {
            const targetPath = fs.existsSync(skillPath) ? path.dirname(skillPath) : skillPath;
            await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(targetPath));
        } catch (err) {
            vscode.window.showErrorMessage((this._i18n.openInFinderFailed || 'Failed to open in Finder') + ' ' + err.message);
        }
    }

    async _createSkill(skillName, isGlobal = true, description = '', body = '') {
        if (!skillName) return;
        const t = this._i18n; let targetDir = null; const paths = this._getEditorPaths();
        if (isGlobal) { targetDir = paths.global; } else { const wsPath = this._getWorkspacePath(); if (!wsPath) { vscode.window.showErrorMessage(t.wsError); return; } targetDir = this._getProjectSkillDir(wsPath); }
        try {
            if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });
            const newSkillDir = path.join(targetDir, skillName);
            if (!fs.existsSync(newSkillDir)) fs.mkdirSync(newSkillDir);
            const skillMdPath = path.join(newSkillDir, 'SKILL.md');
            if (!fs.existsSync(skillMdPath)) {
                fs.writeFileSync(skillMdPath, createSkillContent(skillName, description, body), 'utf8');
            }
            await this._rememberKnownSkillPaths([skillMdPath]);
            this._postSkills();
        } catch (err) { vscode.window.showErrorMessage(t.createFailed + ' ' + err.message); }
    }

    _writeToClipboardExact(payload, count) {
        try {
            if (!payload || count === 0) {
                vscode.env.clipboard.writeText('');
                // vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: this._i18n.deselected, cancellable: false }, () => new Promise(r => setTimeout(r, 2500)));
            } else {
                vscode.env.clipboard.writeText(payload);
                vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: this._i18n.copySuccess.replace('{0}', count).replace('{1}', count > 1 ? 's' : ''), cancellable: false }, () => new Promise(r => setTimeout(r, 2500)));
            }
        } catch (err) { console.error('Clipboard write failed:', err.message); }
    }

    _getHtmlForWebview() {
        const t = this._i18n;
        const currentLang = this._lang;
        const langOptions = Object.entries(translations).map(([code, tr]) =>
            `<option value="${code}" ${code === currentLang ? 'selected' : ''}>${tr.name}</option>`
        ).join('');
        const tJson = JSON.stringify(t).replace(/</g, '\\u003c').replace(/>/g, '\\u003e');
        
        const cleanFavorites = this._getCleanStatePaths('antigravitySkillsFavorites');
        const cleanTopLevelOrder = this._getCleanTopLevelOrder();

        const savedGroupOrder = JSON.stringify(this._context.globalState.get('antigravitySkillsGroupOrder', []));
        const savedTopLevelOrder = JSON.stringify(cleanTopLevelOrder);
        const savedManualEmptyGroups = JSON.stringify(this._context.globalState.get('antigravitySkillsManualEmptyGroups', []));
        const savedFavorites = JSON.stringify(cleanFavorites);
        const savedCollapsedGroups = JSON.stringify(this._context.globalState.get('antigravitySkillsCollapsedGroups', []));


        return /* html */`
            <!DOCTYPE html>
            <html lang="${currentLang}">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>${t.title}</title>
                <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
                <style>
	                    :root {
	                        --sidebar-width: 280px;
	                        --header-height: 48px;
	                        --transition-speed: 0.16s;
	                        --radius: 6px;
	                        --reorder-duration: 180ms;
	                        --reorder-ease: cubic-bezier(0.2, 0, 0, 1);
                            --group-reorder-duration: 220ms;
                            --group-reorder-ease: cubic-bezier(0.22, 0.61, 0.36, 1);
	                    }
                    * { box-sizing: border-box; }
                    body { font-family: var(--vscode-font-family); padding: 0; margin: 0; color: var(--vscode-editor-foreground); background-color: var(--vscode-editor-background); display: flex; height: 100vh; overflow: hidden; -webkit-font-smoothing: antialiased; text-rendering: optimizeLegibility; font-kerning: normal; --resizer-cursor: col-resize; }
                    body.is-resizing, body.is-resizing * { cursor: var(--resizer-cursor) !important; user-select: none !important; }
                    .sidebar { width: var(--sidebar-width); min-width: 180px; max-width: 80%; background-color: var(--vscode-sideBar-background); border-right: 1px solid var(--vscode-widget-border, var(--vscode-panel-border)); display: flex; flex-direction: column; z-index: 10; position: relative; }
                    .resizer { width: 4px; cursor: col-resize; background-color: transparent; transition: background-color 0.2s; z-index: 20; margin-right: -2px; margin-left: -2px; touch-action: none; }
                    .resizer:hover, .resizer.active { background-color: var(--vscode-focusBorder); }
                    .sidebar-header { height: var(--header-height); padding: 0 12px; display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid var(--vscode-widget-border, var(--vscode-panel-border)); }
                    .sidebar-title { font-weight: 700; font-size: 15px; color: var(--vscode-sideBarTitle-foreground); letter-spacing: 0.3px; }
                    .header-actions { display: flex; gap: 2px; align-items: center; }
                    .add-btn { background: transparent; border: none; color: var(--vscode-icon-foreground); cursor: pointer; padding: 5px; border-radius: var(--radius); display: flex; align-items: center; justify-content: center; transition: all var(--transition-speed); }
                    .add-btn:hover { background-color: var(--vscode-toolbar-hoverBackground); transform: scale(1.05); }
                    .header-actions .add-btn[data-header-icon] { min-width: 28px; min-height: 28px; outline: none; }
                    .header-actions .add-btn[data-header-icon] .icon { width: 18px; height: 18px; }
                    .header-actions .add-btn[data-header-icon]:focus { outline: none; box-shadow: none; }
                    .header-actions .add-btn[data-header-icon]:focus-visible { outline: 1px solid color-mix(in srgb, var(--vscode-focusBorder, #3794ff) 70%, transparent); outline-offset: 1px; }
                    /* Search bar */
                    .search-container { padding: 6px 10px; border-bottom: 1px solid var(--vscode-widget-border, var(--vscode-panel-border)); display: flex; gap: 4px; align-items: center; }
                    .search-input { width: 100%; background-color: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border); padding: 5px 8px 5px 28px; font-size: 12px; border-radius: var(--radius); outline: none; font-family: inherit; transition: border-color var(--transition-speed); }
                    .search-input:focus { border-color: var(--vscode-focusBorder); }
                    .search-wrapper { position: relative; }
                    .search-icon { position: absolute; left: 8px; top: 50%; transform: translateY(-50%); width: 14px; height: 14px; fill: var(--vscode-descriptionForeground); opacity: 0.6; pointer-events: none; }
                    /* Filter tabs */
                    .filter-tabs { display: flex; gap: 4px; padding: 6px 10px 4px; overflow-x: auto; overflow-y: hidden; white-space: nowrap; scrollbar-width: none; -webkit-overflow-scrolling: touch; }
                    .filter-tabs::-webkit-scrollbar { display: none; }
                    .filter-tab { background: transparent; border: 1px solid transparent; color: var(--vscode-descriptionForeground); cursor: pointer; padding: 2px 8px; font-size: 11px; border-radius: 12px; transition: all var(--transition-speed); font-family: inherit; flex: 0 0 auto; min-width: max-content; white-space: nowrap; }
                    .filter-tab:hover { background: rgba(128,128,128,0.15); }
                    .filter-tab.active { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border-color: var(--vscode-button-background); }
	                    .skill-group { margin-bottom: 4px; transition: transform var(--group-reorder-duration) var(--group-reorder-ease), opacity 0.18s ease; will-change: transform; contain: layout style; }
	                    .group-header { display: flex; align-items: center; min-height: 28px; padding: 7px 12px 7px 14px; font-size: 11px; font-weight: 600; color: color-mix(in srgb, var(--vscode-sideBarTitle-foreground) 88%, white 12%); text-transform: uppercase; cursor: grab; user-select: none; position: relative; border-left: 2px solid color-mix(in srgb, var(--vscode-textLink-foreground, #3794ff) 55%, transparent); margin: 4px 6px 4px 0; border-radius: 0 7px 7px 0; letter-spacing: 0.32px; opacity: 0.96; transition: transform var(--group-reorder-duration) var(--group-reorder-ease), background 0.15s ease, opacity 0.15s ease, border-color 0.15s ease; will-change: transform; }
                    .group-header:hover { opacity: 1; background: color-mix(in srgb, var(--vscode-list-hoverBackground, rgba(128,128,128,0.12)) 82%, transparent); border-left-color: color-mix(in srgb, var(--vscode-textLink-foreground, #3794ff) 72%, transparent); }
                    .group-header .group-arrow + span { font-size: 12.5px; font-weight: 700; letter-spacing: 0.18px; color: color-mix(in srgb, var(--vscode-sideBarTitle-foreground) 92%, white 8%); flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
                    .group-header .icon { width: 12px; height: 12px; margin-right: 7px; flex-shrink: 0; opacity: 0.84; }
                    .group-arrow { display: inline-flex; align-items: center; justify-content: center; cursor: pointer; padding: 4px 6px; margin: -4px 4px -4px -4px; border-radius: 6px; transition: background 0.12s ease; flex-shrink: 0; }
                    .group-arrow .icon { margin-right: 0; transition: transform 0.2s cubic-bezier(0.22, 0.61, 0.36, 1); transform: rotate(0deg); }
                    .group-arrow:hover { background: rgba(128,128,128,0.18); }
                    .group-header:not(.collapsed) .group-arrow .icon { transform: rotate(90deg); }
                    .group-header .group-count { min-width: 22px; font-size: 10px; font-weight: 700; background: color-mix(in srgb, var(--vscode-badge-background, rgba(128,128,128,0.22)) 78%, transparent); color: color-mix(in srgb, var(--vscode-badge-foreground, var(--vscode-sideBarTitle-foreground)) 86%, white 14%); padding: 0 8px; border-radius: 999px; margin-left: 8px; line-height: 18px; border: 1px solid color-mix(in srgb, var(--vscode-sideBar-border, rgba(128,128,128,0.24)) 56%, transparent); box-shadow: inset 0 1px 0 rgba(255,255,255,0.04); }
                    .group-items.collapsed { display: none; }
                    .group-items { min-height: 18px; padding: 2px 0; position: relative; } /* Keeps group footprint stable for drag targets */
                    .group-drop-zone { height: 6px; position: relative; }
                    .group-drop-zone-top { margin-top: 2px; }
                    .group-drop-zone-bottom { margin-bottom: 2px; }
                    .skill-list { flex: 1; overflow-y: auto; padding: 4px 0; position: relative; }
                    .skill-list.drag-primed .skill-item.drag-placeholder {
                        transition: none !important;
                    }
                    .skill-item {
                        display: flex;
                        align-items: center;
                        padding: 8px 10px;
                        cursor: grab;
                        border: 1px solid color-mix(in srgb, var(--vscode-sideBar-border, rgba(128,128,128,0.2)) 50%, transparent);
                        background: rgba(128, 128, 128, 0.03);
                        border-radius: 6px;
                        margin: 4px 10px;
	                        transition: transform var(--reorder-duration) var(--reorder-ease), background 0.18s ease, border-color 0.18s ease, box-shadow 0.18s ease, opacity 0.18s ease;
                        font-size: 13px;
                        color: var(--vscode-sideBar-foreground);
                        gap: 8px;
                        user-select: none;
                        position: relative;
	                        z-index: 1;
                            will-change: transform;
	                    }
	                    .skill-item.drag-proxy {
                        position: fixed !important;
                        margin: 0 !important;
                        z-index: 10000 !important;
                        pointer-events: none !important;
                        box-shadow: 0 5px 20px rgba(0,0,0,0.65) !important;
                        background-color: var(--vscode-editor-background) !important;
                        color: var(--vscode-editor-foreground) !important;
                        border-color: var(--vscode-focusBorder) !important;
	                        opacity: 1 !important;
	                        transition: none !important;
                            left: 0 !important;
                            top: 0 !important;
                            transform: translate3d(var(--drag-x, -9999px), var(--drag-y, -9999px), 0) !important;
                            will-change: transform;
                            contain: layout paint style;
                            backface-visibility: hidden;
	                    }
                    .skill-item.drag-batch-peer {
                        opacity: 1 !important;
                        background: rgba(128, 128, 128, 0.025) !important;
                        border-color: color-mix(in srgb, var(--vscode-sideBar-border, rgba(128,128,128,0.2)) 28%, transparent) !important;
                        box-shadow: none !important;
                    }
                    .skill-item.drag-batch-peer .skill-info,
                    .skill-item.drag-batch-peer .favorite-star,
                    .skill-item.drag-batch-peer .badge {
                        visibility: hidden !important;
                    }
                    .skill-item.drag-batch-peer .icon-container {
                        opacity: 0.2 !important;
                    }
	                    .batch-drag-proxy {
	                        position: fixed !important;
	                        z-index: 10000 !important;
	                        pointer-events: none !important;
                            left: 0 !important;
                            top: 0 !important;
                            transform: translate3d(var(--drag-x, -9999px), var(--drag-y, -9999px), 0) !important;
                            will-change: transform;
                            contain: layout paint style;
                            backface-visibility: hidden;
	                    }
	                    .single-drag-proxy {
	                        position: fixed !important;
	                        z-index: 10000 !important;
	                        pointer-events: none !important;
                            left: 0 !important;
                            top: 0 !important;
                            transform: translate3d(var(--drag-x, -9999px), var(--drag-y, -9999px), 0) !important;
                            will-change: transform;
                            contain: layout paint style;
                            backface-visibility: hidden;
	                    }
                    .single-drag-proxy__card {
                        position: relative;
                        display: flex;
                        align-items: center;
                        gap: 10px;
                        min-height: 48px;
                        padding: 10px 12px;
                        border-radius: 10px;
                        background: color-mix(in srgb, var(--vscode-editor-background) 94%, black 6%);
                        color: var(--vscode-editor-foreground);
                        border: 1px solid color-mix(in srgb, var(--vscode-focusBorder, #3794ff) 45%, transparent);
                        box-shadow: 0 10px 22px rgba(0,0,0,0.24);
                    }
                    .single-drag-proxy__icon {
                        width: 22px;
                        height: 22px;
                        border-radius: 999px;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        background: rgba(128,128,128,0.12);
                        color: var(--vscode-descriptionForeground);
                        font-size: 11px;
                        font-weight: 700;
                        flex-shrink: 0;
                    }
                    .single-drag-proxy__title {
                        min-width: 0;
                        flex: 1;
                        font-size: 13px;
                        font-weight: 600;
                        white-space: nowrap;
                        overflow: hidden;
                        text-overflow: ellipsis;
                    }
                    .batch-drag-proxy__layer {
                        position: absolute;
                        left: 14px;
                        right: 14px;
                        height: 46px;
                        border-radius: 10px;
                        background: color-mix(in srgb, var(--vscode-editor-background) 92%, black 8%);
                        border: 1px solid color-mix(in srgb, var(--vscode-focusBorder, #3794ff) 14%, transparent);
                    }
                    .batch-drag-proxy__layer--back {
                        top: 12px;
                        opacity: 0.28;
                    }
                    .batch-drag-proxy__layer--mid {
                        top: 6px;
                        opacity: 0.48;
                    }
                    .batch-drag-proxy__card {
                        position: relative;
                        display: flex;
                        align-items: center;
                        gap: 10px;
                        min-height: 52px;
                        padding: 10px 12px;
                        border-radius: 12px;
                        background: color-mix(in srgb, var(--vscode-editor-background) 94%, black 6%);
                        color: var(--vscode-editor-foreground);
                        border: 1px solid color-mix(in srgb, var(--vscode-focusBorder, #3794ff) 52%, transparent);
                        box-shadow: 0 12px 28px rgba(0,0,0,0.28);
                    }
                    .batch-drag-proxy__icon {
                        width: 24px;
                        height: 24px;
                        border-radius: 999px;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        background: rgba(128,128,128,0.12);
                        color: var(--vscode-descriptionForeground);
                        font-size: 12px;
                        font-weight: 700;
                        flex-shrink: 0;
                    }
                    .batch-drag-proxy__body {
                        min-width: 0;
                        flex: 1;
                        display: flex;
                        flex-direction: column;
                        gap: 2px;
                    }
                    .batch-drag-proxy__title {
                        font-size: 13px;
                        font-weight: 600;
                        color: var(--vscode-editor-foreground);
                        white-space: nowrap;
                        overflow: hidden;
                        text-overflow: ellipsis;
                    }
                    .batch-drag-proxy__meta {
                        font-size: 11px;
                        color: var(--vscode-descriptionForeground);
                        white-space: nowrap;
                    }
                    .drag-count-badge {
                        position: relative;
                        min-width: 20px;
                        height: 20px;
                        padding: 0 6px;
                        border-radius: 999px;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        background: var(--vscode-badge-background, var(--vscode-button-background));
                        color: var(--vscode-badge-foreground, var(--vscode-button-foreground));
                        border: 1px solid color-mix(in srgb, var(--vscode-focusBorder, #3794ff) 55%, transparent);
                        box-shadow: 0 6px 14px rgba(0,0,0,0.18);
                        font-size: 11px;
                        font-weight: 700;
                        line-height: 1;
                        flex-shrink: 0;
                    }
                    .skill-item.drag-placeholder {
                        opacity: 0 !important;
                        background: transparent !important;
                        border-color: transparent !important;
                        box-shadow: none !important;
                        transform: none !important;
                        visibility: hidden !important;
                    }
                    .group-drag-proxy {
                        position: fixed !important;
                        z-index: 10000 !important;
                        pointer-events: none !important;
                        left: 0 !important;
                        top: 0 !important;
                        transform: translate3d(var(--drag-x, -9999px), var(--drag-y, -9999px), 0) !important;
                        will-change: transform;
                        contain: layout paint style;
                        backface-visibility: hidden;
                    }
                    .group-drag-proxy__card {
                        position: relative;
                        display: flex;
                        align-items: center;
                        gap: 10px;
                        min-height: 40px;
                        padding: 8px 14px;
                        border-radius: 10px;
                        background: color-mix(in srgb, var(--vscode-editor-background) 94%, black 6%);
                        color: var(--vscode-editor-foreground);
                        border: 1.5px solid color-mix(in srgb, var(--vscode-textLink-foreground, #3794ff) 50%, transparent);
                        box-shadow: 0 10px 28px rgba(0,0,0,0.32), 0 2px 8px rgba(0,0,0,0.18);
                    }
                    .group-drag-proxy__icon {
                        width: 20px;
                        height: 20px;
                        border-radius: 4px;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        background: color-mix(in srgb, var(--vscode-textLink-foreground, #3794ff) 18%, transparent);
                        color: var(--vscode-textLink-foreground, #3794ff);
                        font-size: 10px;
                        font-weight: 700;
                        flex-shrink: 0;
                    }
                    .group-drag-proxy__title {
                        min-width: 0;
                        flex: 1;
                        font-size: 12px;
                        font-weight: 700;
                        text-transform: uppercase;
                        letter-spacing: 0.3px;
                        white-space: nowrap;
                        overflow: hidden;
                        text-overflow: ellipsis;
                        color: var(--vscode-editor-foreground);
                    }
                    .group-drag-proxy__count {
                        font-size: 10px;
                        font-weight: 700;
                        min-width: 18px;
                        height: 18px;
                        padding: 0 6px;
                        border-radius: 999px;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        background: var(--vscode-badge-background, var(--vscode-button-background));
                        color: var(--vscode-badge-foreground, var(--vscode-button-foreground));
                        flex-shrink: 0;
                    }
                    .group-header.drag-proxy {
                        position: fixed !important;
                        margin: 0 !important;
                        z-index: 10000 !important;
                        pointer-events: none !important;
                        box-shadow: 0 5px 20px rgba(0,0,0,0.65) !important;
                        background-color: var(--vscode-editor-background) !important;
                        color: var(--vscode-editor-foreground) !important;
                        border-color: var(--vscode-focusBorder) !important;
	                        opacity: 1 !important;
	                        transition: none !important;
	                        width: 260px;
                            left: 0 !important;
                            top: 0 !important;
                            transform: translate3d(var(--drag-x, -9999px), var(--drag-y, -9999px), 0) !important;
                            will-change: transform;
                            contain: layout paint style;
                            backface-visibility: hidden;
	                    }
                    .group-header.drag-placeholder {
                        opacity: 0 !important;
                        background: transparent !important;
                        border-color: transparent !important;
                        transform: none !important;
                        visibility: hidden !important;
                    }
                    .skill-group.drag-placeholder-group {
                        max-height: 4px !important;
                        overflow: hidden !important;
                        opacity: 0 !important;
                        pointer-events: none !important;
                        margin: 2px 0 !important;
                        padding: 0 !important;
                        transition: max-height 0.2s ease, opacity 0.15s ease, margin 0.2s ease !important;
                    }
                    .skill-item:hover {
                        background: rgba(128, 128, 128, 0.08);
                        border-color: rgba(128, 128, 128, 0.3);
                    }
                    .skill-item.active {
                        background: rgba(128, 128, 128, 0.1);
                        border-color: var(--vscode-focusBorder);
                        box-shadow: 0 0 0 0.5px var(--vscode-focusBorder);
                    }
                    .skill-item.selected {
                        background: rgba(55, 148, 255, 0.08);
                        border-color: var(--vscode-textLink-foreground, #3794ff);
                    }
                    .skill-item.dragging, .group-header.dragging { opacity: 0.6; cursor: grabbing; transform: scale(0.99); }
                    .group-header.selected {
                        background: color-mix(in srgb, var(--vscode-textLink-foreground, #3794ff) 14%, transparent) !important;
                        border-left-color: var(--vscode-textLink-foreground, #3794ff) !important;
                        outline: 1px solid color-mix(in srgb, var(--vscode-textLink-foreground, #3794ff) 45%, transparent);
                    }
                    .group-header.selected.drag-proxy-peer {
                        opacity: 0.35;
                        transform: scale(0.98);
                    }
                    .drop-line-indicator {
                        position: absolute;
                        height: 3px;
                        border-radius: 999px;
                        background: var(--vscode-focusBorder);
                        box-shadow: 0 0 0 1px color-mix(in srgb, var(--vscode-focusBorder) 35%, transparent);
                        pointer-events: none;
                        z-index: 30;
                        opacity: 0;
                        transform: scaleX(0.98);
                        transition: opacity 0.08s ease, transform 0.08s ease;
                    }
                    .drop-line-indicator.active {
                        opacity: 1;
                        transform: scaleX(1);
                    }
                    .drop-into-indicator {
                        position: absolute;
                        border: 2px solid var(--vscode-focusBorder);
                        border-radius: 6px;
                        background: rgba(0, 120, 212, 0.18);
                        box-shadow: 0 0 8px rgba(0, 120, 212, 0.35), inset 0 0 4px rgba(0, 120, 212, 0.12);
                        pointer-events: none;
                        z-index: 29;
                        opacity: 0;
                        transition: opacity 0.08s ease;
                    }
                    .drop-into-indicator.active { opacity: 1; }
                    .drag-preview {
                        position: fixed;
                        top: -1000px;
                        left: -1000px;
                        min-width: 140px;
                        max-width: 280px;
                        padding: 9px 14px;
                        border-radius: 8px;
                        background: var(--vscode-list-activeSelectionBackground, #3794ff);
                        color: #fff;
                        border: 1px solid var(--vscode-focusBorder);
                        box-shadow: 0 12px 32px rgba(0,0,0,0.35);
                        font-size: 13px;
                        font-weight: 600;
                        white-space: nowrap;
                        pointer-events: none;
                        z-index: 100000;
                        transform: scale(1.02);
                    }
                    .skill-item .skill-info { flex: 1; min-width: 0; }
                    .skill-item .skill-name { text-overflow: ellipsis; white-space: nowrap; overflow: hidden; display: block; }
                    .skill-item .skill-desc { font-size: 10px; color: var(--vscode-descriptionForeground); opacity: 0.7; text-overflow: ellipsis; white-space: nowrap; overflow: hidden; display: block; margin-top: 1px; }
                    .icon-container { width: 20px; height: 20px; display: flex; align-items: center; justify-content: center; margin-right: 6px; border-radius: 4px; cursor: pointer; transition: all var(--transition-speed); flex-shrink: 0; }
                    .icon-container:hover { background: rgba(128,128,128,0.2); }
                    .icon-container.at-active { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
                    .favorite-star { width: 18px; height: 18px; display: flex; align-items: center; justify-content: center; cursor: pointer; color: var(--vscode-descriptionForeground); opacity: 0.5; transition: all var(--transition-speed); flex-shrink: 0; }
                    .favorite-star:hover { opacity: 0.9; }
                    .favorite-star .star-icon { width: 14px; height: 14px; }
                    .favorite-star .star-icon.favorited { color: var(--vscode-textLink-foreground, #3794ff); opacity: 1; }
                    .main-area { flex: 1; display: flex; flex-direction: column; background-color: var(--vscode-editor-background); min-width: 0; min-height: 0; }
                    .editor-header { min-height: var(--header-height); padding: 6px 20px; display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid var(--vscode-widget-border, var(--vscode-panel-border)); background-color: var(--vscode-editorGroupHeader-tabsBackground, var(--vscode-editor-background)); gap: 8px; }
                    .skill-title-container { display: flex; flex-direction: column; justify-content: center; min-width: 0; flex: 1; }
                    .skill-title { font-size: 14px; font-weight: 600; color: var(--vscode-editor-foreground); text-overflow: ellipsis; overflow: hidden; white-space: nowrap; }
                    .skill-path-wrapper { display: flex; align-items: center; max-width: 100%; min-width: 0; margin-top: 2px; }
                    .skill-path { font-size: 11px; color: var(--vscode-descriptionForeground); text-overflow: ellipsis; overflow: hidden; white-space: nowrap; opacity: 0.7; }
                    .copy-path-btn { position: relative; width: 16px; height: 16px; margin-left: 4px; display: flex; align-items: center; justify-content: center; cursor: pointer; color: var(--vscode-descriptionForeground); opacity: 0; transition: opacity var(--transition-speed); flex-shrink: 0; }
                    .skill-path-wrapper:hover .copy-path-btn { opacity: 0.7; }
                    .copy-path-btn:hover { opacity: 1 !important; color: var(--vscode-foreground); }
                    .copy-path-btn svg { width: 14px; height: 14px; }
                    .copy-path-tooltip { display: none; position: absolute; left: 50%; transform: translateX(-50%); bottom: 100%; margin-bottom: 4px; background-color: var(--vscode-editorHoverWidget-background, #252526); color: var(--vscode-editorHoverWidget-foreground, #cccccc); border: 1px solid var(--vscode-editorHoverWidget-border, #454545); padding: 4px 8px; font-size: 11px; border-radius: 4px; box-shadow: 0 4px 8px rgba(0,0,0,0.2); z-index: 10; white-space: nowrap; pointer-events: none; opacity: 0; animation: fadeIn 0.1s forwards; }
                    @keyframes fadeIn { to { opacity: 1; } }
                    .copy-path-tooltip::after { content: ''; position: absolute; top: 100%; left: 50%; transform: translateX(-50%); border-width: 5px; border-style: solid; border-color: var(--vscode-editorHoverWidget-border, #454545) transparent transparent transparent; }
                    .copy-path-btn:hover .copy-path-tooltip { display: block; }
                    .save-btn { background-color: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; height: 28px; padding: 0 10px; font-size: 12px; border-radius: 4px; cursor: pointer; font-weight: 500; display: flex; align-items: center; justify-content: center; gap: 4px; transition: all var(--transition-speed); white-space: nowrap; flex-shrink: 0; }
                    .save-btn:hover { background-color: var(--vscode-button-hoverBackground); transform: translateY(-1px); }
                    .save-btn:active { transform: translateY(0); }
                    .save-btn span { display: inline-block; }
                    .save-btn.icon-only { padding: 0; width: 28px; }
                    .save-btn.secondary { background-color: var(--vscode-button-secondaryBackground, transparent); color: var(--vscode-foreground); border: 1px solid var(--vscode-button-border, var(--vscode-widget-border)); }
                    .save-btn.preview-active { background-color: var(--vscode-button-background) !important; color: var(--vscode-button-foreground) !important; border: none !important; }
                    .save-btn.preview-active:hover { background-color: var(--vscode-button-hoverBackground) !important; }
                    .save-btn.destructive { background-color: var(--vscode-errorForeground); color: #fff; }
                    .editor-container { flex: 1; position: relative; display: flex; flex-direction: column; overflow: hidden; }
                    textarea { flex: 1; width: 100%; height: 100%; background-color: transparent; color: var(--vscode-editor-foreground); border: none; --editor-pad-x: max(28px, calc(50% - 428px)); padding: 32px var(--editor-pad-x); box-sizing: border-box; font-family: var(--vscode-editor-font-family, 'Menlo', 'Monaco', 'Courier New', monospace); font-size: var(--vscode-editor-font-size, 13px); line-height: 1.8; letter-spacing: 0.3px; resize: none; outline: none; white-space: pre-wrap; overflow-wrap: break-word; word-break: break-all; word-wrap: break-word; overflow-x: hidden; scrollbar-gutter: stable both-edges; text-rendering: optimizeLegibility; font-kerning: normal; font-variant-ligatures: none; }
                    textarea::selection { background-color: var(--vscode-editor-selectionBackground); }
                    .empty-state { display: flex; flex-direction: column; justify-content: center; align-items: center; height: 100%; color: var(--vscode-descriptionForeground); font-size: 14px; gap: 8px; }
                    .empty-state svg { width: 48px; height: 48px; opacity: 0.4; }
                    .modal-overlay { position: fixed; top: 0; left: 0; right: 0; bottom: 0; background-color: rgba(0, 0, 0, 0.55); display: none; justify-content: center; align-items: center; z-index: 100; }
                    .modal-overlay.active { display: flex; }
                    .modal { background-color: var(--vscode-editorWidget-background); border: 1px solid var(--vscode-widget-border); border-radius: 8px; padding: 24px; width: 420px; box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5); display: flex; flex-direction: column; gap: 14px; animation: modalIn 0.15s ease-out; }
                    @keyframes modalIn { from { opacity: 0; transform: scale(0.95) translateY(-8px); } to { opacity: 1; transform: scale(1) translateY(0); } }
                    .modal h3 { margin: 0; font-size: 16px; font-weight: 600; }
                    .modal input[type="text"], .modal select { background-color: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border); padding: 8px 12px; font-size: 13px; border-radius: 4px; outline: none; font-family: inherit; transition: border-color var(--transition-speed); }
                    .modal input[type="text"]:focus, .modal select:focus { border-color: var(--vscode-focusBorder); }
                    .modal-section-label { font-size: 12px; font-weight: 600; margin-bottom: 4px; }
                    .import-summary-card { background: rgba(128,128,128,0.08); border: 1px solid color-mix(in srgb, var(--vscode-widget-border, rgba(128,128,128,0.24)) 70%, transparent); border-radius: 6px; padding: 10px 12px; display: flex; flex-direction: column; gap: 8px; }
                    .import-summary-head { display: flex; justify-content: space-between; gap: 12px; align-items: flex-start; }
                    .import-summary-meta { display: flex; flex-direction: column; gap: 2px; font-size: 12px; color: var(--vscode-descriptionForeground); }
                    .import-summary-count { font-size: 12px; font-weight: 700; color: var(--vscode-editor-foreground); white-space: nowrap; }
                    .import-preview-list { display: flex; flex-wrap: wrap; gap: 6px; }
                    .import-preview-chip { display: inline-flex; align-items: center; max-width: 100%; padding: 2px 8px; border-radius: 999px; background: rgba(128,128,128,0.16); color: var(--vscode-editor-foreground); font-size: 11px; line-height: 18px; }
                    .import-preview-chip.more { color: var(--vscode-descriptionForeground); }
                    .modal-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 4px; }
                    .modal-btn { padding: 6px 14px; font-size: 12px; border-radius: 4px; cursor: pointer; border: none; font-weight: 500; transition: all var(--transition-speed); }
                    .modal-btn.secondary { background-color: var(--vscode-button-secondaryBackground, transparent); color: var(--vscode-button-secondaryForeground, var(--vscode-foreground)); }
                    .modal-btn.secondary:hover { background-color: var(--vscode-button-secondaryHoverBackground, rgba(255,255,255,0.1)); }
                    .modal-btn.primary { background-color: var(--vscode-button-background); color: var(--vscode-button-foreground); }
                    .modal-btn.primary:hover { background-color: var(--vscode-button-hoverBackground); }
                    .sidebar-footer { padding: 6px 10px; border-top: 1px solid var(--vscode-widget-border, var(--vscode-panel-border)); display: flex; align-items: center; gap: 6px; }
                    .sidebar-footer .total-count { font-size: 11px; color: var(--vscode-descriptionForeground); opacity: 0.7; white-space: nowrap; }
                    .lang-select { flex: 1; background-color: var(--vscode-dropdown-background, var(--vscode-input-background)); color: var(--vscode-dropdown-foreground, var(--vscode-input-foreground)); border: 1px solid var(--vscode-dropdown-border, var(--vscode-input-border)); padding: 3px 6px; font-size: 11px; border-radius: 4px; outline: none; cursor: pointer; font-family: inherit; }
                    .lang-select:focus { border-color: var(--vscode-focusBorder); }
                    .icon { width: 16px; height: 16px; fill: currentColor; }
                    .file-drop-active::before { content: ''; position: fixed; inset: 0; background: rgba(0, 120, 212, 0.12); border: 2px dashed var(--vscode-focusBorder); z-index: 10000; pointer-events: none; border-radius: 8px; }
                    .context-menu { position: fixed; z-index: 99999; background: var(--vscode-menu-background, var(--vscode-dropdown-background)); border: 1px solid var(--vscode-menu-border, var(--vscode-dropdown-border)); border-radius: var(--radius); padding: 4px 0; min-width: 170px; box-shadow: 0 4px 20px rgba(0,0,0,0.35); display: none; animation: modalIn 0.1s ease-out; }
                    .context-menu.active { display: block; }
                    .context-menu-item { display: flex; align-items: center; gap: 8px; padding: 6px 14px; font-size: 12px; color: var(--vscode-menu-foreground, var(--vscode-foreground)); cursor: pointer; user-select: none; transition: background var(--transition-speed); }
                    .context-menu-item:hover { background: var(--vscode-menu-selectionBackground, var(--vscode-list-hoverBackground)); }
                    .context-menu-item .icon { width: 14px; height: 14px; flex-shrink: 0; }
                    .context-menu-item.destructive:hover { background: var(--vscode-errorForeground); color: #fff; }
                    .context-menu-separator { height: 1px; background: var(--vscode-widget-border); margin: 4px 8px; }
                    .badge { font-size: 9px; padding: 1px 5px; border-radius: 8px; margin-left: auto; flex-shrink: 0; }
                    .badge-global { background: rgba(128,128,128,0.2); }
                    .badge-project { background: rgba(80,140,200,0.2); color: var(--vscode-textLink-foreground); }
                    @media (max-width: 600px) {
                        .sidebar { width: 100% !important; min-width: 0; flex: none; max-width: none; height: 40%; border-right: none; border-bottom: 1px solid var(--vscode-widget-border); }
                        body { flex-direction: column; }
                        .main-area { width: 100%; min-height: 0; }
                        .resizer { display: block; width: 100%; height: 4px; cursor: row-resize; margin: -2px 0; }
                        .editor-header { padding: 0 12px; }
                        .save-btn span { display: none; }
                        .save-btn { width: 32px; padding: 0; gap: 0; }
                    }
                </style>
            </head>
            <body>
                <div class="sidebar" id="sidebar">
                    <div class="sidebar-header">
                        <div class="sidebar-title">${t.title}</div>
                        <div class="header-actions">
                            <button class="add-btn" id="expandCollapseBtn" data-header-icon="expand" title="${t.expandAllBtn || 'Expand/Collapse All'}">
                                <svg class="icon" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg"><path fill="currentColor" d="M1 2h14v12H1V2zm1 1v10h12V3H2zm2 4h8v2H4V7z"/></svg>
                            </button>
                            <button class="add-btn" id="clearBtn" title="${t.clearCart}" style="display:none; color: var(--vscode-errorForeground);">
                                <svg class="icon" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg"><path d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1zm0 13a6 6 0 1 1 0-12 6 6 0 0 1 0 12z"/><path d="M11.35 4.65a.5.5 0 0 0-.7-.7l-6 6a.5.5 0 0 0 .7.7l6-6z"/></svg>
                            </button>
                            <button class="add-btn" id="smartGroupBtn" data-header-icon="smart-group" title="${t.smartGroup || 'Smart Group'}">
                                <svg class="icon" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg"><path fill="currentColor" d="M14 4H9.618l-1-2H2a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V5a1 1 0 0 0-1-1zm0 9H2V5h12v8z"/><path fill="currentColor" d="M10.5 6.5l.75 1.5 1.5.75-1.5.75-.75 1.5-.75-1.5-1.5-.75 1.5-.75zM6.5 9l.5 1 1 .5-1 .5-.5 1-.5-1-1-.5 1-.5z"/></svg>
                            </button>
                            <button class="add-btn" id="importBtn" data-header-icon="import" title="${t.importBtn}">
                                <svg class="icon" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg"><path d="M11.5 1h-7l-.5.5V5H1.5l-.5.5v9l.5.5h13l.5-.5v-9l-.5-.5H12V1.5l-.5-.5zM5 2h6v3H5V2zm9 12H2V6h12v8z"/><path d="M5 8h6v1H5z"/></svg>
                            </button>
                            <button class="add-btn" id="newSkillBtn" data-header-icon="new" title="${t.create}">
                                <svg class="icon" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg"><path d="M14 7v1H8v6H7V8H1V7h6V1h1v6h6z"/></svg>
                            </button>
                        </div>
                    </div>
                    <div class="search-container">
                        <div class="search-wrapper" style="flex:1;">
                            <svg class="search-icon" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg"><path d="M15.25 13.65L11.5 9.9A5.5 5.5 0 1 0 9.9 11.5l3.75 3.75a1 1 0 0 0 1.41 0l.19-.19a1 1 0 0 0 0-1.41zM6.5 10.5a4 4 0 1 1 0-8 4 4 0 0 1 0 8z"/></svg>
                            <input type="text" class="search-input" id="searchInput" placeholder="${t.searchPlaceholder}" autocomplete="off">
                        </div>
                    </div>
                    <div class="filter-tabs" id="filterTabs">
                        <button class="filter-tab active" data-filter="all">${t.filterAll}</button>
                        <button class="filter-tab" data-filter="recent">${t.recentTab || '最近'}</button>
                        <button class="filter-tab" data-filter="favorite">${t.favoriteTab || 'Favorite'}</button>
                        <button class="filter-tab" data-filter="Global">${t.globalBadge}</button>
                        <button class="filter-tab" data-filter="Project">${t.projectBadge}</button>
                    </div>
                    <div class="skill-list" id="skillList"></div>
                    <div class="sidebar-footer">
                        <select class="lang-select" id="langSelect">${langOptions}</select>
                        <span class="total-count" id="totalCount"></span>
                    </div>
                </div>
                <div class="resizer" id="resizer"></div>
                <div class="main-area" id="mainArea">
                    <div class="empty-state">
                        <svg viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" fill="currentColor"><path d="M13.5 2h-12l-.5.5v11l.5.5h12l.5-.5v-11l-.5-.5zM2 3h11v1H2V3zm7 4H2V6h7v1zm0 2H2V8h7v1zm-3 2H2v-1h4v1zm7 0h-2v-1h2v1zm0-2h-2V8h2v1zm0-2h-2V6h2v1z"/></svg>
                        <div>${t.empty}</div>
                    </div>
                </div>

                <!-- Create Modal -->
                <div class="modal-overlay" id="createModal">
                    <div class="modal" style="width:480px;">
                        <h3>${t.create}</h3>
                        <input type="text" id="newSkillInput" placeholder="${t.placeholder}" autocomplete="off">
                        <input type="text" id="newSkillDesc" placeholder="${t.descPlaceholder || 'Description (optional)'}" autocomplete="off">
                        <textarea id="newSkillBody" placeholder="${t.contentPlaceholder || 'Content (optional)'}" style="background:var(--vscode-input-background);color:var(--vscode-input-foreground);border:1px solid var(--vscode-input-border);padding:8px 12px;font-size:13px;border-radius:4px;outline:none;font-family:var(--vscode-editor-font-family,monospace);resize:vertical;min-height:100px;max-height:240px;line-height:1.5;" spellcheck="false"></textarea>
                        <div style="display:flex; gap:16px;">
                            <label style="display:flex; align-items:center; gap:6px; font-size:12px; cursor:pointer;">
                                <input type="radio" name="skillType" value="global" checked> ${t.importGlobal}
                            </label>
                            <label style="display:flex; align-items:center; gap:6px; font-size:12px; cursor:pointer;">
                                <input type="radio" name="skillType" value="project"> ${t.importProject}
                            </label>
                        </div>
                        <div class="modal-actions">
                            <button class="modal-btn secondary" id="cancelCreateBtn">${t.cancel}</button>
                            <button class="modal-btn primary" id="confirmCreateBtn">${t.confirmCreate}</button>
                        </div>
                    </div>
                </div>

                <!-- Confirm Modal -->
                <div class="modal-overlay" id="confirmModal">
                    <div class="modal">
                        <h3 id="confirmTitle">${t.confirmAction}</h3>
                        <div id="confirmMessage" style="font-size: 13px; color: var(--vscode-descriptionForeground);"></div>
                        <div class="modal-actions">
                            <button class="modal-btn secondary" id="cancelConfirmBtn">${t.cancel}</button>
                            <button class="modal-btn primary" id="acceptConfirmBtn">${t.confirmAction}</button>
                        </div>
                    </div>
                </div>

                <!-- Import Modal -->
                <div class="modal-overlay" id="importModal">
                    <div class="modal">
                        <h3>${t.importBtn}</h3>
                        <div class="import-summary-card" id="importSummaryCard">
                            <div class="import-summary-head">
                                <div class="import-summary-meta">
                                    <div id="importSummaryPrimary"></div>
                                    <div id="importSummarySecondary"></div>
                                </div>
                                <div class="import-summary-count" id="importSummaryCount"></div>
                            </div>
                            <div class="import-preview-list" id="importPreviewList"></div>
                        </div>
                        <div id="importSingleNameRow">
                            <div class="modal-section-label">${t.placeholder}</div>
                            <input type="text" id="importSkillInput" placeholder="${t.placeholder}" autocomplete="off">
                        </div>
                        <div id="importBatchInfo" style="display:none; font-size:12px; color:var(--vscode-descriptionForeground); margin-top:-4px;"></div>

                        <div style="margin-top:8px;" id="importStrategyRow">
                            <div class="modal-section-label">${t.conflictStrategy || 'Conflict Strategy'}:</div>
                            <select id="importStrategySelect" style="width:100%; background-color:var(--vscode-input-background); color:var(--vscode-input-foreground); border:1px solid var(--vscode-input-border); padding:4px; border-radius:4px;">
                                <option value="ask">${t.strategyAsk || 'Ask for each file'}</option>
                                <option value="rename">${t.strategyRename || 'Keep both (Rename new)'}</option>
                                <option value="skip">${t.strategySkip || 'Skip existing'}</option>
                                <option value="overwrite">${t.strategyOverwrite || 'Overwrite all'}</option>
                            </select>
                        </div>

                        <div style="margin-top:12px;" class="modal-section-label">${t.importPickerTitle || 'Destination'}:</div>
                        <div style="display:flex; gap:16px; margin-top:4px;">
                            <label style="display:flex; align-items:center; gap:6px; font-size:12px; cursor:pointer;">
                                <input type="radio" name="importSkillType" value="global" checked> ${t.importGlobal}
                            </label>
                            <label style="display:flex; align-items:center; gap:6px; font-size:12px; cursor:pointer;">
                                <input type="radio" name="importSkillType" value="project"> ${t.importProject}
                            </label>
                        </div>
                        <div class="modal-actions">
                            <button class="modal-btn secondary" id="cancelImportBtn">${t.cancel}</button>
                            <button class="modal-btn primary" id="confirmImportBtn">${t.importBtn}</button>
                        </div>
                    </div>
                </div>

                <!-- Rename Modal -->
                <div class="modal-overlay" id="renameModal">
                    <div class="modal">
                        <h3>${t.renameTitle}</h3>
                        <div style="font-size: 13px; color: var(--vscode-descriptionForeground); margin-bottom: 4px;">${t.renameMsg}</div>
                        <input type="text" id="renameSkillInput" placeholder="${t.renamePlaceholder}" autocomplete="off">
                        <div class="modal-actions">
                            <button class="modal-btn secondary" id="cancelRenameBtn">${t.cancel}</button>
                            <button class="modal-btn primary" id="confirmRenameBtn">${t.renameBtn}</button>
                        </div>
                    </div>
                </div>

                <!-- Change Group Modal -->
                <div class="modal-overlay" id="changeGroupModal">
                    <div class="modal">
                        <h3>${t.changeGroupBtn || 'Change Group'}</h3>
                        <div style="font-size: 13px; color: var(--vscode-descriptionForeground); margin-bottom: 4px;">${t.groupSelectLabel || 'Choose an existing group or enter a new one:'}</div>
                        <select id="changeGroupSelect">
                            <option value="">${t.groupCustomOption || 'Custom group'}</option>
                        </select>
                        <input type="text" id="changeGroupInput" placeholder="${t.groupInputPlaceholder || 'Group name'}" autocomplete="off">
                        <div class="modal-actions">
                            <button class="modal-btn secondary" id="cancelGroupBtn">${t.cancel}</button>
                            <button class="modal-btn primary" id="confirmGroupBtn">${t.changeGroupBtn || 'Change Group'}</button>
                        </div>
                    </div>
                </div>

                <!-- Rename Group Modal -->
                <div class="modal-overlay" id="renameGroupModal">
                    <div class="modal">
                        <h3>${t.renameGroupTitle || 'Rename Group'}</h3>
                        <div style="font-size: 13px; color: var(--vscode-descriptionForeground); margin-bottom: 4px;">${t.renameGroupMsg || 'Enter the new group name:'}</div>
                        <input type="text" id="renameGroupInput" placeholder="${t.renameGroupPlaceholder || 'New group name'}" autocomplete="off">
                        <div class="modal-actions">
                            <button class="modal-btn secondary" id="cancelRenameGroupBtn">${t.cancel}</button>
                            <button class="modal-btn primary" id="confirmRenameGroupBtn">${t.renameGroupBtn || 'Rename Group'}</button>
                        </div>
                    </div>
                </div>

                <!-- Context Menu -->
                <div class="context-menu" id="ctxMenu">
                    <div class="context-menu-item" id="ctxRename">
                        <svg class="icon" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg"><path d="M13.23 1h-1.46L3.52 9.25l-.16.22L1 13.59 2.41 15l4.12-2.36.22-.16L15 4.23V2.77L13.23 1zM2.41 13.59l1.51-3 1.45 1.45-2.96 1.55zm3.83-2.06L4.47 9.76l8-8 1.77 1.77-8 8z"/></svg>
                        <span>${t.renameBtn}</span>
                    </div>

                    <div class="context-menu-item" id="ctxChangeGroup">
                        <svg class="icon" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg"><path d="M4 1h8a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V3a2 2 0 0 1 2-2zm0 1a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V3a1 1 0 0 0-1-1H4z"/><path d="M4 5h8v1H4V5zm0 2h8v1H4V7zm0 2h5v1H4V9z"/></svg>
                        <span>${t.changeGroupBtn || 'Change Group'}</span>
                    </div>
                    <div class="context-menu-item" id="ctxRemoveFromGroup">
                        <svg class="icon" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg"><path d="M3 3h10v1H3V3zm2 3h6v1H5V6zm0 3h6v1H5V9zm-2 3h10v1H3v-1z"/></svg>
                        <span>${t.removeFromGroupBtn || 'Remove From Group'}</span>
                    </div>
                    <div class="context-menu-item" id="ctxNewGroupSkill">
                        <svg class="icon" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg"><path d="M14 4H9.618l-1-2H2a1 1 0 00-1 1v10a1 1 0 001 1h12a1 1 0 001-1V5a1 1 0 00-1-1zm0 9H2V5h12v8z"/><path d="M7.5 7v2.5H5v1h2.5V13h1v-2.5H11v-1H8.5V7z"/></svg>
                        <span>${t.newGroupBtn || 'New Group'}</span>
                    </div>
                    <div class="context-menu-item" id="ctxHideFromRecent">
                        <svg class="icon" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg"><path d="M1.5 8s2.4-4 6.5-4 6.5 4 6.5 4-2.4 4-6.5 4-6.5-4-6.5-4zm6.5 2.8A2.8 2.8 0 1 0 8 5.2a2.8 2.8 0 0 0 0 5.6z"/><path d="M2 2l12 12-.7.7L1.3 2.7 2 2z"/></svg>
                        <span>${t.hideFromRecentBtn || 'Hide from Recent'}</span>
                    </div>
                    <div class="context-menu-item" id="ctxOpenInFinder">
                        <svg class="icon" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg"><path d="M2 3.5A1.5 1.5 0 0 1 3.5 2H6l1.2 1.4H12.5A1.5 1.5 0 0 1 14 4.9V12.5A1.5 1.5 0 0 1 12.5 14h-9A1.5 1.5 0 0 1 2 12.5v-9zM3.5 3A.5.5 0 0 0 3 3.5V5h10V4.9a.5.5 0 0 0-.5-.5H6.74L5.54 3H3.5zM3 6v6.5a.5.5 0 0 0 .5.5h9a.5.5 0 0 0 .5-.5V6H3z"/></svg>
                        <span>${t.openInFinderBtn || 'Open in Finder'}</span>
                    </div>
                    <div class="context-menu-separator"></div>
                    <div class="context-menu-item" id="ctxFavSelected">
                        <svg class="icon" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg"><path fill="currentColor" d="M8 1.5l2 4 4.5.5-3.2 3.2.8 4.5L8 11.2l-4.1 2.2.8-4.5L1.5 6l4.5-.5L8 1.5z"/></svg>
                        <span>${t.favSelectedBtn || 'Favorite Selected'}</span>
                    </div>
                    <div class="context-menu-item" id="ctxUnfavSelected">
                        <svg class="icon" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg"><path fill="none" stroke="currentColor" stroke-width="1.2" d="M8 1.5l2 4 4.5.5-3.2 3.2.8 4.5L8 11.2l-4.1 2.2.8-4.5L1.5 6l4.5-.5L8 1.5z"/></svg>
                        <span>${t.unfavSelectedBtn || 'Unfavorite Selected'}</span>
                    </div>
                    <div class="context-menu-separator"></div>
                    <div class="context-menu-item destructive" id="ctxDelete">
                        <svg class="icon" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg"><path d="M14 3h-3V1H5v2H2v1h1v11h10V4h1V3zM6 2h4v1H6V2zm6 12H4V4h8v10z"/><path d="M6 6h1v6H6zm3 0h1v6H9z"/></svg>
                        <span>${t.deleteConfirmTitle}</span>
                    </div>
                </div>

                <div class="context-menu" id="emptyCtxMenu">
                    <div class="context-menu-item" id="ctxNewGroupEmpty">
                        <svg class="icon" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg"><path d="M14 4H9.618l-1-2H2a1 1 0 00-1 1v10a1 1 0 001 1h12a1 1 0 001-1V5a1 1 0 00-1-1zm0 9H2V5h12v8z"/><path d="M7.5 7v2.5H5v1h2.5V13h1v-2.5H11v-1H8.5V7z"/></svg>
                        <span>${t.newGroupBtn || 'New Group'}</span>
                    </div>
                </div>

                <!-- New Group Modal -->
                <div class="modal-overlay" id="newGroupModal">
                    <div class="modal">
                        <h3>${t.newGroupTitle || 'New Group'}</h3>
                        <input type="text" id="newGroupInput" placeholder="${t.newGroupPlaceholder || 'Enter group name'}" autocomplete="off">
                        <div class="modal-actions">
                            <button class="modal-btn secondary" id="cancelNewGroupBtn">${t.cancel}</button>
                            <button class="modal-btn primary" id="confirmNewGroupBtn">${t.newGroupBtn || 'New Group'}</button>
                        </div>
                    </div>
                </div>

                <div class="context-menu" id="groupCtxMenu">
                    <div class="context-menu-item" id="ctxRenameGroup">
                        <svg class="icon" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg"><path d="M13.23 1h-1.46L3.52 9.25l-.16.22L1 13.59 2.41 15l4.12-2.36.22-.16L15 4.23V2.77L13.23 1zM2.41 13.59l1.51-3 1.45 1.45-2.96 1.55zm3.83-2.06L4.47 9.76l8-8 1.77 1.77-8 8z"/></svg>
                        <span>${t.renameGroupBtn || 'Rename Group'}</span>
                    </div>
                    <div class="context-menu-item destructive" id="ctxDissolveGroup">
                        <svg class="icon" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg"><path d="M2 3h12v1H2V3zm2 3h8v1H4V6zm-2 3h12v1H2V9zm2 3h8v1H4v-1z"/></svg>
                        <span>${t.dissolveGroupBtn || 'Dissolve Group'}</span>
                    </div>
                    <div class="context-menu-item destructive" id="ctxDeleteGroup">
                        <svg class="icon" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg"><path d="M14 3h-3V1H5v2H2v1h1v11h10V4h1V3zM6 2h4v1H6V2zm6 12H4V4h8v10z"/><path d="M6 6h1v6H6zm3 0h1v6H9z"/></svg>
                        <span>${t.deleteGroupBtn || 'Delete Group'}</span>
                    </div>
                </div>

                <script>
                    const vscode = acquireVsCodeApi();
                    const t = ${tJson};
                    let skills = [];
                    let currentIndex = -1;
                    let selectedSkills = new Set();
                    let selectedSkillsMap = new Map();
                    let searchQuery = '';
                    let filterType = 'all';
                    var groupOrder = ${savedGroupOrder};
                    var topLevelOrder = ${savedTopLevelOrder};
                    var manualEmptyGroups = ${savedManualEmptyGroups};
                    var favoritePaths = new Set(${savedFavorites});
                    var collapsedGroups = new Set(${savedCollapsedGroups});
	                    let recentSkillPaths = [];
	                    const RECENT_SKILLS_LIMIT = 8;
	                    let unsavedPaths = new Set();
                        let smartGroupScoreCache = new Map();
	                    let currentEditorSkillPath = null;
	                    let currentEditorBaseline = '';
		                    let latestLoadRevision = 0;
		                    let suppressClickUntil = 0;
	                        let uiStateSaveTimer = 0;
                        const COMPACT_LAYOUT_MAX_WIDTH = 600;
                        const DEFAULT_COMPACT_SIDEBAR_RATIO = 0.4;
                        const MIN_COMPACT_SIDEBAR_HEIGHT = 180;
                        const MIN_COMPACT_MAIN_HEIGHT = 220;
                        let desktopSidebarWidth = null;
                        let compactSidebarRatio = null;

		                    const skillList = document.getElementById('skillList');
	                    const searchInput = document.getElementById('searchInput');
	                    const filterTabs = document.getElementById('filterTabs');
	                    const langSelect = document.getElementById('langSelect');
	                    const importBtn = document.getElementById('importBtn');
                        const headerActionButtons = Array.from(document.querySelectorAll('.header-actions .add-btn[data-header-icon]'));
                        const sidebarEl = document.getElementById('sidebar');
                    const dropLineIndicator = document.createElement('div');
                    dropLineIndicator.className = 'drop-line-indicator';
                    const dropIntoIndicator = document.createElement('div');
                    dropIntoIndicator.className = 'drop-into-indicator';
                    const dragPreview = document.createElement('div');
                    dragPreview.className = 'drag-preview';
                    document.body.appendChild(dragPreview);
                    const mainArea = document.getElementById('mainArea');
                    const newSkillBtn = document.getElementById('newSkillBtn');
                    const clearBtn = document.getElementById('clearBtn');
                    const createModal = document.getElementById('createModal');
                    const newSkillInput = document.getElementById('newSkillInput');
                    function suppressPointerFocus(button) {
                        if (!button) return;
                        let pointerFocusPending = false;
                        const onPointerPress = (e) => {
                            if (e.type === 'pointerdown' && e.pointerType && e.pointerType !== 'mouse' && e.pointerType !== 'pen') return;
                            if (e.type === 'mousedown' && typeof window !== 'undefined' && window.PointerEvent) return;
                            if (typeof e.button === 'number' && e.button !== 0) return;
                            pointerFocusPending = true;
                            e.preventDefault();
                        };
                        button.addEventListener('pointerdown', onPointerPress);
                        button.addEventListener('mousedown', onPointerPress);
                        button.addEventListener('click', () => {
                            if (!pointerFocusPending) return;
                            button.blur();
                            pointerFocusPending = false;
                        });
                        button.addEventListener('keydown', () => { pointerFocusPending = false; });
                        button.addEventListener('blur', () => { pointerFocusPending = false; });
                    }
                    headerActionButtons.forEach(suppressPointerFocus);
                    function escHtml(s) { return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
	                    const defaultGroupLabels = {
                        'Ungrouped': t.ungrouped || 'Ungrouped',
                        'smart.frontend': 'Frontend',
                        'smart.backend': 'Backend',
                        'smart.mobile': 'Mobile',
                        'smart.data': 'Data',
                        'smart.database': 'Database',
                        'smart.devops': 'DevOps',
                        'smart.ai': 'AI',
                        'smart.testing': 'Testing',
                        'smart.design': 'Design',
                        'smart.docs': 'Docs',
                        'smart.automation': 'Automation',
                        'smart.security': 'Security',
                        'smart.collab': 'Collaboration',
                        'smart.product': 'Product',
                        'smart.research': 'Research',
                        'smart.localization': 'Localization',
                        'smart.business': 'Business',
                        'smart.utilities': 'Utilities'
	                    };
                        function isCompactLayout() {
                            return window.innerWidth <= COMPACT_LAYOUT_MAX_WIDTH;
                        }
                        function clampSidebarWidthValue(nextWidth) {
                            const minWidth = 180;
                            const maxWidth = Math.max(minWidth, Math.floor(window.innerWidth * 0.8));
                            return Math.max(minWidth, Math.min(Math.round(nextWidth), maxWidth));
                        }
                        function getCompactSidebarRatioValue() {
                            if (typeof compactSidebarRatio === 'number' && isFinite(compactSidebarRatio) && compactSidebarRatio > 0) {
                                return compactSidebarRatio;
                            }
                            return DEFAULT_COMPACT_SIDEBAR_RATIO;
                        }
                        function clampCompactSidebarHeightValue(nextHeight) {
                            const viewportHeight = Math.max(window.innerHeight || 0, MIN_COMPACT_SIDEBAR_HEIGHT + MIN_COMPACT_MAIN_HEIGHT);
                            const maxHeight = Math.max(0, viewportHeight - MIN_COMPACT_MAIN_HEIGHT);
                            const minHeight = Math.min(MIN_COMPACT_SIDEBAR_HEIGHT, maxHeight);
                            return Math.max(minHeight, Math.min(Math.round(nextHeight), maxHeight));
                        }
                        function applyCompactSidebarHeight(nextHeight) {
                            if (!sidebarEl) return;
                            const clampedHeight = clampCompactSidebarHeightValue(nextHeight);
                            const viewportHeight = Math.max(window.innerHeight || 1, 1);
                            compactSidebarRatio = clampedHeight / viewportHeight;
                            if (isCompactLayout()) {
                                sidebarEl.style.height = clampedHeight + 'px';
                            }
                        }
                        function syncResponsiveSidebar() {
                            if (!sidebarEl) return;
                            if (isCompactLayout()) {
                                const inlineWidth = parseInt(sidebarEl.style.width || '', 10);
                                if (Number.isFinite(inlineWidth) && inlineWidth >= 180) {
                                    desktopSidebarWidth = clampSidebarWidthValue(inlineWidth);
                                }
                                sidebarEl.style.removeProperty('width');
                                applyCompactSidebarHeight(window.innerHeight * getCompactSidebarRatioValue());
                                return;
                            }
                            const inlineHeight = parseInt(sidebarEl.style.height || '', 10);
                            if (Number.isFinite(inlineHeight) && inlineHeight > 0) {
                                applyCompactSidebarHeight(inlineHeight);
                            }
                            sidebarEl.style.removeProperty('height');
                            if (typeof desktopSidebarWidth === 'number' && desktopSidebarWidth >= 180) {
                                sidebarEl.style.width = clampSidebarWidthValue(desktopSidebarWidth) + 'px';
                            }
                        }
	                    function getGroupLabel(groupKey) {
		                        const labels = t.groupLabels || {};
		                        return labels[groupKey] || defaultGroupLabels[groupKey] || groupKey;
		                    }
                        function syncFilterTabs() {
                            if (!filterTabs) return;
                            filterTabs.querySelectorAll('.filter-tab').forEach((tab) => {
                                tab.classList.toggle('active', tab.getAttribute('data-filter') === filterType);
                            });
                        }
	                        function captureUiState() {
	                            const editor = document.getElementById('skillContent');
	                            const measuredSidebarWidth = sidebarEl ? sidebarEl.getBoundingClientRect().width : null;
                                const sidebarWidth = isCompactLayout()
                                    ? desktopSidebarWidth
                                    : measuredSidebarWidth;
	                            return {
                                currentIndex: currentIndex,
                                currentPath: getCurrentSkillPath(),
                                collapsedGroups: Array.from(collapsedGroups),
                                filterType: filterType,
                                searchQuery: searchInput ? searchInput.value : searchQuery,
                                listScrollTop: skillList ? skillList.scrollTop : 0,
                                editorScrollTop: editor ? editor.scrollTop : 0,
                                editorSelectionStart: editor ? editor.selectionStart : 0,
                                editorSelectionEnd: editor ? editor.selectionEnd : 0,
	                                sidebarWidth: (typeof sidebarWidth === 'number' && sidebarWidth >= 180) ? Math.round(sidebarWidth) : null,
                                    compactSidebarRatio: (typeof compactSidebarRatio === 'number' && isFinite(compactSidebarRatio) && compactSidebarRatio > 0) ? compactSidebarRatio : null
	                            };
	                        }
                        function arraysEqual(a, b) {
                            if (a === b) return true;
                            if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
                            for (let i = 0; i < a.length; i++) {
                                if (a[i] !== b[i]) return false;
                            }
                            return true;
                        }
                        function hasSameSkillLayout(nextSkills, nextTopLevelOrder, nextGroupOrder, nextManualEmptyGroups) {
                            if (!Array.isArray(nextSkills) || nextSkills.length !== skills.length) return false;
                            for (let i = 0; i < nextSkills.length; i++) {
                                const nextSkill = nextSkills[i];
                                const currentSkill = skills[i];
                                if (!nextSkill || !currentSkill) return false;
                                if (nextSkill.path !== currentSkill.path) return false;
                                if ((nextSkill.group || '') !== (currentSkill.group || '')) return false;
                            }
                            return arraysEqual(nextTopLevelOrder, topLevelOrder)
                                && arraysEqual(nextGroupOrder, groupOrder)
                                && arraysEqual(nextManualEmptyGroups, manualEmptyGroups);
                        }
	                        function persistUiStateNow() {
	                            vscode.postMessage({ command: 'saveUiState', state: captureUiState() });
	                        }
                        function scheduleUiStateSave() {
                            if (uiStateSaveTimer) clearTimeout(uiStateSaveTimer);
                            uiStateSaveTimer = setTimeout(() => {
                                uiStateSaveTimer = 0;
                                persistUiStateNow();
                            }, 120);
                        }
	                    function isUngrouped(groupKey) {
	                        return !groupKey || groupKey === 'Ungrouped';
	                    }
                    function isBuiltInGroup(groupKey) {
                        return typeof groupKey === 'string' && groupKey.startsWith('smart.');
                    }
                    function getGroupArrowSvg(isCollapsed) {
                        // Solid Codicon-style chevron for a more premium, clickable Cursor look
                        return '<span class="group-arrow"><svg class="icon" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" fill="currentColor"><path fill-rule="evenodd" clip-rule="evenodd" d="M10.072 8.024L5.715 3.667l.618-.62L11 7.716v.618L6.333 13l-.618-.619 4.357-4.357z"/></svg></span>';
                    }
                    function moveSkillPathsToUngrouped(skillPaths) {
                        return moveSkillBatch(skillPaths, { kind: 'bottom', newGroup: '' });
                    }
                    function getOrderedSkillPaths(skillPaths) {
                        const targetPathSet = new Set(skillPaths || []);
                        const ordered = [];
                        for (const skill of skills) {
                            if (targetPathSet.has(skill.path)) ordered.push(skill.path);
                        }
                        return ordered;
                    }
                    function getSkillsByPaths(skillPaths) {
                        const targetPathSet = new Set(skillPaths || []);
                        return skills.filter(function(skill) { return targetPathSet.has(skill.path); });
                    }
                    function findFirstIndexOfGroup(groupName) {
                        for (let i = 0; i < skills.length; i++) {
                            if (skills[i].group === groupName) return i;
                        }
                        return -1;
                    }
                    function findLastIndexOfGroup(groupName) {
                        for (let i = skills.length - 1; i >= 0; i--) {
                            if (skills[i].group === groupName) return i;
                        }
                        return -1;
                    }
                    function getItemDropIntent(itemEl, clientY) {
                        const rect = itemEl.getBoundingClientRect();
                        return clientY < rect.top + rect.height / 2 ? 'before' : 'after';
                    }
                    function getStableItemDropIntent(itemEl, clientY, previousIntent) {
                        const nextIntent = getItemDropIntent(itemEl, clientY);
                        if (!previousIntent || previousIntent === nextIntent) return nextIntent;
                        const rect = itemEl.getBoundingClientRect();
                        const middleY = rect.top + rect.height / 2;
                        const threshold = Math.min(8, Math.max(4, rect.height * 0.18));
                        if (nextIntent === 'after' && clientY < middleY + threshold) return previousIntent;
                        if (nextIntent === 'before' && clientY > middleY - threshold) return previousIntent;
                        return nextIntent;
                    }
                    function getHeaderDropIntent(headerEl, clientY) {
                        const rect = headerEl.getBoundingClientRect();
                        const offsetY = clientY - rect.top;
                        if (offsetY < rect.height * 0.3) return 'before';
                        if (offsetY > rect.height * 0.7) return 'after';
                        return 'into';
                    }
                    function getStableHeaderDropIntent(headerEl, clientY, previousIntent) {
                        const nextIntent = getHeaderDropIntent(headerEl, clientY);
                        if (!previousIntent || previousIntent === nextIntent) return nextIntent;
                        const rect = headerEl.getBoundingClientRect();
                        const beforeBoundary = rect.top + rect.height * 0.3;
                        const afterBoundary = rect.top + rect.height * 0.7;
                        const threshold = Math.min(8, Math.max(4, rect.height * 0.12));
                        if (previousIntent === 'before' && clientY <= beforeBoundary + threshold) return 'before';
                        if (previousIntent === 'after' && clientY >= afterBoundary - threshold) return 'after';
                        if (previousIntent === 'into' && clientY >= beforeBoundary - threshold && clientY <= afterBoundary + threshold) return 'into';
                        return nextIntent;
                    }
                    function insertBatchAtIndex(batch, index) {
                        let insertIndex = index;
                        if (insertIndex < 0) insertIndex = 0;
                        if (insertIndex > skills.length) insertIndex = skills.length;
                        skills.splice(insertIndex, 0, ...batch);
                    }
                    function insertBatchRelativeToPath(batch, targetPath, placeAfter) {
                        let insertIndex = skills.findIndex(function(s) { return s.path === targetPath; });
                        if (insertIndex === -1) insertIndex = skills.length;
                        else if (placeAfter) insertIndex += 1;
                        skills.splice(insertIndex, 0, ...batch);
                    }
                    function insertBatchRelativeToGroup(batch, groupName, position) {
                        let insertIndex = -1;
                        if (position === 'before' || position === 'top') {
                            insertIndex = findFirstIndexOfGroup(groupName);
                        } else if (position === 'after' || position === 'end') {
                            const lastIndex = findLastIndexOfGroup(groupName);
                            insertIndex = lastIndex === -1 ? skills.length : lastIndex + 1;
                        }
                        if (insertIndex === -1) insertIndex = skills.length;
                        skills.splice(insertIndex, 0, ...batch);
                    }
                    function skillToken(skillPath) {
                        return 'skill:' + skillPath;
                    }
                    function groupToken(groupName) {
                        return 'group:' + groupName;
                    }
                    function isSkillToken(token) {
                        return typeof token === 'string' && token.indexOf('skill:') === 0;
                    }
                    function isGroupToken(token) {
                        return typeof token === 'string' && token.indexOf('group:') === 0;
                    }
                    function tokenSkillPath(token) {
                        return isSkillToken(token) ? token.slice(6) : '';
                    }
                    function tokenGroupName(token) {
                        return isGroupToken(token) ? token.slice(6) : '';
                    }
                    function getCurrentGroupNames() {
                        const names = [];
                        const seen = new Set();
                        skills.forEach(function(skill) {
                            if (!isUngrouped(skill.group) && !seen.has(skill.group)) {
                                seen.add(skill.group);
                                names.push(skill.group);
                            }
                        });
                        manualEmptyGroups.forEach(function(groupName) {
                            if (!seen.has(groupName)) {
                                seen.add(groupName);
                                names.push(groupName);
                            }
                        });
                        return names;
                    }
                    function getDerivedGroupOrder() {
                        return topLevelOrder.filter(isGroupToken).map(tokenGroupName);
                    }
                    function reconcileTopLevelOrder() {
                        const validUngroupedPaths = new Set(skills.filter(function(skill) { return isUngrouped(skill.group); }).map(function(skill) { return skill.path; }));
                        const validGroups = new Set(getCurrentGroupNames());
                        const nextOrder = [];
                        const seenUngrouped = new Set();
                        const seenGroups = new Set();

                        (topLevelOrder || []).forEach(function(token) {
                            if (isSkillToken(token)) {
                                const skillPath = tokenSkillPath(token);
                                if (validUngroupedPaths.has(skillPath) && !seenUngrouped.has(skillPath)) {
                                    seenUngrouped.add(skillPath);
                                    nextOrder.push(skillToken(skillPath));
                                }
                            } else if (isGroupToken(token)) {
                                const groupName = tokenGroupName(token);
                                if (validGroups.has(groupName) && !seenGroups.has(groupName)) {
                                    seenGroups.add(groupName);
                                    nextOrder.push(groupToken(groupName));
                                }
                            }
                        });

                        skills.forEach(function(skill) {
                            if (isUngrouped(skill.group)) {
                                if (!seenUngrouped.has(skill.path)) {
                                    seenUngrouped.add(skill.path);
                                    nextOrder.push(skillToken(skill.path));
                                }
                            } else if (!seenGroups.has(skill.group)) {
                                seenGroups.add(skill.group);
                                nextOrder.push(groupToken(skill.group));
                            }
                        });

                        manualEmptyGroups.forEach(function(groupName) {
                            if (!seenGroups.has(groupName)) {
                                seenGroups.add(groupName);
                                nextOrder.push(groupToken(groupName));
                            }
                        });

                        topLevelOrder = nextOrder;
                        groupOrder = getDerivedGroupOrder();
                    }
                    function getTopLevelInsertIndex(anchorToken, placeAfter) {
                        const anchorIndex = topLevelOrder.indexOf(anchorToken);
                        if (anchorIndex === -1) return topLevelOrder.length;
                        return anchorIndex + (placeAfter ? 1 : 0);
                    }
                    function insertTopLevelTokensAt(tokens, insertIndex) {
                        const normalizedTokens = (tokens || []).filter(Boolean);
                        if (normalizedTokens.length === 0) return;
                        const tokenSet = new Set(normalizedTokens);
                        topLevelOrder = topLevelOrder.filter(function(token) { return !tokenSet.has(token); });
                        let safeIndex = insertIndex;
                        if (safeIndex < 0) safeIndex = 0;
                        if (safeIndex > topLevelOrder.length) safeIndex = topLevelOrder.length;
                        topLevelOrder.splice(safeIndex, 0, ...normalizedTokens);
                        groupOrder = getDerivedGroupOrder();
                    }
                    function syncTopLevelOrderAfterSkillMove(skillPaths, target) {
                        reconcileTopLevelOrder();
                        const movedSkillTokens = skillPaths.map(skillToken);
                        const originalIndices = movedSkillTokens.map(function(token) {
                            return topLevelOrder.indexOf(token);
                        }).filter(function(index) {
                            return index !== -1;
                        });
                        const fallbackIndex = originalIndices.length > 0 ? Math.min.apply(null, originalIndices) : topLevelOrder.length;
                        topLevelOrder = topLevelOrder.filter(function(token) {
                            return movedSkillTokens.indexOf(token) === -1;
                        });

                        if (target.newGroup) {
                            const targetGroupToken = groupToken(target.newGroup);
                            if (topLevelOrder.indexOf(targetGroupToken) === -1) {
                                let insertIndex = topLevelOrder.length;
                                if (target.kind === 'group-boundary' && target.groupName) {
                                    insertIndex = getTopLevelInsertIndex(groupToken(target.groupName), target.position !== 'before' && target.position !== 'top');
                                } else if (target.kind === 'relative-path' && target.targetPath) {
                                    const targetSkill = skills.find(function(skill) { return skill.path === target.targetPath; });
                                    const anchorToken = targetSkill
                                        ? (isUngrouped(targetSkill.group) ? skillToken(targetSkill.path) : groupToken(targetSkill.group))
                                        : null;
                                    insertIndex = anchorToken ? getTopLevelInsertIndex(anchorToken, !!target.placeAfter) : topLevelOrder.length;
                                } else if (target.kind === 'index') {
                                    insertIndex = fallbackIndex;
                                }
                                insertTopLevelTokensAt([targetGroupToken], insertIndex);
                            }
                        } else {
                            let insertIndex = target.kind === 'index' ? fallbackIndex : topLevelOrder.length;
                            if (target.kind === 'relative-path' && target.targetPath) {
                                const targetSkill = skills.find(function(skill) { return skill.path === target.targetPath; });
                                const anchorToken = targetSkill
                                    ? (isUngrouped(targetSkill.group) ? skillToken(targetSkill.path) : groupToken(targetSkill.group))
                                    : null;
                                insertIndex = anchorToken ? getTopLevelInsertIndex(anchorToken, !!target.placeAfter) : topLevelOrder.length;
                            } else if (target.kind === 'group-boundary' && target.groupName) {
                                insertIndex = getTopLevelInsertIndex(groupToken(target.groupName), target.position !== 'before' && target.position !== 'top');
                            }
                            insertTopLevelTokensAt(movedSkillTokens, insertIndex);
                        }

                        reconcileTopLevelOrder();
                    }
                    function syncTopLevelOrderAfterGroupMove(groupName, target) {
                        reconcileTopLevelOrder();
                        const movingToken = groupToken(groupName);
                        topLevelOrder = topLevelOrder.filter(function(token) { return token !== movingToken; });
                        let insertIndex = topLevelOrder.length;
                        if (target.kind === 'relative-path' && target.targetPath) {
                            const targetSkill = skills.find(function(skill) { return skill.path === target.targetPath; });
                            const anchorToken = targetSkill
                                ? (isUngrouped(targetSkill.group) ? skillToken(targetSkill.path) : groupToken(targetSkill.group))
                                : null;
                            insertIndex = anchorToken ? getTopLevelInsertIndex(anchorToken, !!target.placeAfter) : topLevelOrder.length;
                        } else if (target.kind === 'group-boundary' && target.groupName) {
                            insertIndex = getTopLevelInsertIndex(groupToken(target.groupName), target.position !== 'before' && target.position !== 'top');
                        }
                        insertTopLevelTokensAt([movingToken], insertIndex);
                        reconcileTopLevelOrder();
                    }
                    function renameTopLevelGroup(oldGroupName, newGroupName) {
                        const oldToken = groupToken(oldGroupName);
                        const newToken = groupToken(newGroupName);
                        topLevelOrder = topLevelOrder.map(function(token) {
                            return token === oldToken ? newToken : token;
                        });
                        reconcileTopLevelOrder();
                    }
                    function getOrderingPayload() {
                        reconcileTopLevelOrder();
                        return {
                            order: skills.map(function(skill) { return skill.path; }),
                            topLevelOrder: topLevelOrder.slice(),
                            groupOrder: getDerivedGroupOrder(),
                            manualEmptyGroups: manualEmptyGroups.slice()
                        };
                    }
                    function persistOrdering() {
                        const payload = getOrderingPayload();
                        vscode.postMessage({ command: 'saveOrder', order: payload.order });
                        vscode.postMessage({ command: 'saveTopLevelOrder', order: payload.topLevelOrder });
                        vscode.postMessage({ command: 'saveGroupOrder', groupOrder: payload.groupOrder });
                        vscode.postMessage({ command: 'saveManualEmptyGroups', manualEmptyGroups: payload.manualEmptyGroups });
                    }
                    function getGroupChangeUpdates(skillPaths, newGroup, originalGroups) {
                        const changedUpdates = [];
                        for (const skillPath of skillPaths) {
                            const prevGroup = originalGroups[skillPath] || '';
                            if (prevGroup !== newGroup) {
                                changedUpdates.push({ skillPath: skillPath, group: newGroup });
                            }
                        }
                        return changedUpdates;
                    }
                    function commitLayout(updates) {
                        const payload = getOrderingPayload();
                        vscode.postMessage({
                            command: 'commitLayout',
                            order: payload.order,
                            topLevelOrder: payload.topLevelOrder,
                            groupOrder: payload.groupOrder,
                            manualEmptyGroups: payload.manualEmptyGroups,
                            updates: updates || []
                        });
                    }
                    function moveSkillBatch(skillPaths, target) {
                        const orderedPaths = getOrderedSkillPaths(skillPaths);
                        if (orderedPaths.length === 0) return { movedPaths: [], changedPaths: [] };
                        const targetPathSet = new Set(orderedPaths);
                        const batch = getSkillsByPaths(orderedPaths);
                        const originalGroups = {};
                        const firstIndex = skills.findIndex(function(skill) { return targetPathSet.has(skill.path); });
                        const currentSkillPath = getCurrentSkillPath();
                        batch.forEach(function(skill) { originalGroups[skill.path] = skill.group || ''; });

                        if (target.kind === 'relative-path' && targetPathSet.has(target.targetPath)) {
                            return { movedPaths: orderedPaths, changedPaths: [] };
                        }

                        skills = skills.filter(function(skill) { return !targetPathSet.has(skill.path); });
                        batch.forEach(function(skill) { skill.group = target.newGroup || ''; });
                        if (!isUngrouped(target.newGroup || '')) {
                            manualEmptyGroups = manualEmptyGroups.filter(function(groupName) { return groupName !== target.newGroup; });
                        }

                        if (target.kind === 'relative-path') {
                            insertBatchRelativeToPath(batch, target.targetPath, !!target.placeAfter);
                        } else if (target.kind === 'group-boundary') {
                            insertBatchRelativeToGroup(batch, target.groupName, target.position);
                        } else if (target.kind === 'index') {
                            insertBatchAtIndex(batch, target.index);
                        } else {
                            skills.push(...batch);
                        }

                        syncTopLevelOrderAfterSkillMove(orderedPaths, target);
                        currentIndex = resolveIndexByPath(currentSkillPath, currentIndex);
                        return {
                            movedPaths: orderedPaths,
                            changedPaths: orderedPaths.filter(function(path) { return (originalGroups[path] || '') !== (target.newGroup || ''); }),
                            originalGroups: originalGroups,
                            firstIndex: firstIndex
                        };
                    }
                    function moveGroupBlock(groupName, target) {
                        if (!groupName) return false;
                        const batch = skills.filter(function(skill) { return skill.group === groupName; });
                        if (batch.length === 0) return false;
                        const batchPaths = new Set(batch.map(function(skill) { return skill.path; }));
                        const currentSkillPath = getCurrentSkillPath();

                        if (target.kind === 'relative-path') {
                            const targetSkill = skills.find(function(skill) { return skill.path === target.targetPath; });
                            if (!targetSkill || batchPaths.has(targetSkill.path)) return false;
                            if (isUngrouped(targetSkill.group)) {
                                skills = skills.filter(function(skill) { return !batchPaths.has(skill.path); });
                                insertBatchRelativeToPath(batch, target.targetPath, !!target.placeAfter);
                                syncTopLevelOrderAfterGroupMove(groupName, target);
                                currentIndex = resolveIndexByPath(currentSkillPath, currentIndex);
                                return true;
                            }
                            target = {
                                kind: 'group-boundary',
                                groupName: targetSkill.group,
                                position: target.placeAfter ? 'after' : 'before'
                            };
                        }

                        if (target.kind === 'group-boundary') {
                            if (!target.groupName || target.groupName === groupName) return false;
                            skills = skills.filter(function(skill) { return !batchPaths.has(skill.path); });
                            insertBatchRelativeToGroup(batch, target.groupName, target.position);
                            syncTopLevelOrderAfterGroupMove(groupName, target);
                            currentIndex = resolveIndexByPath(currentSkillPath, currentIndex);
                            return true;
                        }
                        return false;
                    }
                    function clearDropIndicators() {
                        dropLineIndicator.classList.remove('active');
                        dropIntoIndicator.classList.remove('active');
                    }
                    function ensureDragIndicatorElements() {
                        if (dropLineIndicator.parentElement !== skillList) skillList.appendChild(dropLineIndicator);
                        if (dropIntoIndicator.parentElement !== skillList) skillList.appendChild(dropIntoIndicator);
                    }
                    function getRelativeRect(el) {
                        const listRect = skillList.getBoundingClientRect();
                        const rect = el.getBoundingClientRect();
                        return {
                            top: rect.top - listRect.top + skillList.scrollTop,
                            bottom: rect.bottom - listRect.top + skillList.scrollTop,
                            left: rect.left - listRect.left + skillList.scrollLeft,
                            width: rect.width,
                            height: rect.height
                        };
                    }
                    function showDropLineForElement(el, placeAfter) {
                        ensureDragIndicatorElements();
                        dropIntoIndicator.classList.remove('active');
                        const rect = getRelativeRect(el);
                        const left = Math.max(8, rect.left + 8);
                        const width = Math.max(48, rect.width - 16);
                        dropLineIndicator.style.left = left + 'px';
                        dropLineIndicator.style.width = width + 'px';
                        dropLineIndicator.style.top = ((placeAfter ? rect.bottom : rect.top) - 1.5) + 'px';
                        dropLineIndicator.classList.add('active');
                    }
                    function showDropIntoForElement(el) {
                        ensureDragIndicatorElements();
                        dropLineIndicator.classList.remove('active');
                        const rect = getRelativeRect(el);
                        const insetLeft = Math.max(8, rect.left + 8);
                        const width = Math.max(48, rect.width - 16);
                        const height = Math.max(18, rect.height - 4);
                        dropIntoIndicator.style.left = insetLeft + 'px';
                        dropIntoIndicator.style.top = (rect.top + 2) + 'px';
                        dropIntoIndicator.style.width = width + 'px';
                        dropIntoIndicator.style.height = height + 'px';
                        dropIntoIndicator.classList.add('active');
                    }
                    function showDropLineAtListEnd() {
                        ensureDragIndicatorElements();
                        dropIntoIndicator.classList.remove('active');
                        dropLineIndicator.style.left = '12px';
                        dropLineIndicator.style.width = Math.max(48, skillList.clientWidth - 24) + 'px';
                        dropLineIndicator.style.top = Math.max(skillList.scrollTop + 8, skillList.scrollHeight - 6) + 'px';
                        dropLineIndicator.classList.add('active');
                    }
                    function setDragPreviewText(text) {
                        dragPreview.textContent = text || '';
                    }
                    function clearDragPrimedState() {
                        skillList.classList.remove('drag-primed');
                    }
                    function getCurrentSkillPath() {
                        return (currentIndex !== -1 && skills[currentIndex]) ? skills[currentIndex].path : null;
                    }
                    function resolveIndexByPath(skillPath, fallbackIndex) {
                        if (skillPath) {
                            const resolvedIndex = skills.findIndex(function(skill) { return skill.path === skillPath; });
                            if (resolvedIndex !== -1) return resolvedIndex;
                        }
                        if (typeof fallbackIndex === 'number' && fallbackIndex >= 0 && fallbackIndex < skills.length) {
                            return fallbackIndex;
                        }
                        return skills.length > 0 ? 0 : -1;
                    }
                function syncDragActiveVisual(draggedIndex, preserveMultiSelection) {
                    if (!preserveMultiSelection) {
                        selectedSkills.clear();
                    }
                    const draggedSkill = skills[draggedIndex];
                    if (!draggedSkill) return;
                        skillList.querySelectorAll('.skill-item').forEach(function(el) {
                            const index = parseInt(el.getAttribute('data-index'));
                            const skill = skills[index];
                            if (!skill) return;
                            el.classList.toggle('active', index === draggedIndex);
                            el.classList.toggle('selected', selectedSkills.has(skill.path));
                            const iconContainer = el.querySelector('.icon-container');
                            const iconSvg = iconContainer ? iconContainer.querySelector('svg') : null;
                            const isAtActive = selectedSkillsMap.has(skill.path);
                        if (iconContainer) {
                            iconContainer.classList.toggle('at-active', isAtActive);
                        }
                        if (iconSvg) {
                            iconSvg.style.color = isAtActive ? 'var(--vscode-button-foreground)' : 'var(--vscode-descriptionForeground)';
                            iconSvg.style.opacity = isAtActive ? '1' : '0.6';
                        }
                    });
                }
                    skillList.addEventListener('mousedown', (e) => {
                        if (e.button !== 0) return;
                        if (e.shiftKey || e.metaKey || e.ctrlKey || e.altKey) return;
                        if (e.target.closest('.favorite-star') || e.target.closest('.icon-container')) return;
                        const item = e.target.closest('.skill-item');
                        if (!item) return;
                        const draggedIndex = parseInt(item.getAttribute('data-index'));
                        const draggedSkill = skills[draggedIndex];
                        if (!draggedSkill) return;
                        const preserveMultiSelection = selectedSkills.size > 1 && selectedSkills.has(draggedSkill.path);
                        skillList.classList.add('drag-primed'); // Restore this to ensure transitions are ready
                        syncDragActiveVisual(draggedIndex, preserveMultiSelection);
                    });
                    document.addEventListener('mouseup', clearDragPrimedState);

	                    if (langSelect) {
	                        langSelect.addEventListener('change', (e) => {
	                            vscode.postMessage({ command: 'changeLang', lang: e.target.value, state: captureUiState() });
	                        });
	                    }

	                    // Search
	                    if (searchInput) {
	                        searchInput.addEventListener('input', (e) => {
                                searchQuery = e.target.value.toLowerCase();
                                renderList();
                                scheduleUiStateSave();
                            });
	                    }

	                    // Filter tabs
	                    if (filterTabs) {
	                        filterTabs.addEventListener('click', (e) => {
	                            const tab = e.target.closest('.filter-tab');
	                            if (!tab) return;
	                            filterType = tab.getAttribute('data-filter');
                                syncFilterTabs();
	                            renderList();
                                scheduleUiStateSave();
	                        });
	                    }
                        skillList.addEventListener('scroll', () => { scheduleUiStateSave(); }, { passive: true });
                        window.addEventListener('beforeunload', persistUiStateNow);
                        document.addEventListener('visibilitychange', () => {
                            if (document.visibilityState === 'hidden') persistUiStateNow();
                        });

	                    function renderEmptyState(message) {
	                        currentEditorSkillPath = null;
	                        currentEditorBaseline = '';
	                        vscode.postMessage({ command: 'setActiveSkill', skillPath: '' });
	                        mainArea.innerHTML = '<div class="empty-state"><svg viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" fill="currentColor"><path d="M13.5 2h-12l-.5.5v11l.5.5h12l.5-.5v-11l-.5-.5zM2 3h11v1H2V3zm7 4H2V6h7v1zm0 2H2V8h7v1zm-3 2H2v-1h4v1zm7 0h-2v-1h2v1zm0-2h-2V8h2v1zm0-2h-2V6h2v1z"/></svg><div>' + message + '</div></div>';
                            scheduleUiStateSave();
	                    }

	                    window.addEventListener('message', event => {
	                        const message = event.data;
		                        if (message.command === 'loadSkills') {
	                            const incomingRevision = typeof message.revision === 'number' ? message.revision : 0;
	                            if (incomingRevision < latestLoadRevision) return;
	                            latestLoadRevision = incomingRevision;
	                            const previousCurrentPath = getCurrentSkillPath();
                                const nextSkills = Array.isArray(message.skills) ? message.skills : [];
                                const nextTopLevelOrder = Array.isArray(message.topLevelOrder) ? message.topLevelOrder.slice() : topLevelOrder.slice();
                                const nextGroupOrder = Array.isArray(message.groupOrder) ? message.groupOrder.slice() : groupOrder.slice();
                                const nextManualEmptyGroups = Array.isArray(message.manualEmptyGroups) ? message.manualEmptyGroups.slice() : manualEmptyGroups.slice();
                                const skipLayoutRebuild = !!message.layoutSync && hasSameSkillLayout(nextSkills, nextTopLevelOrder, nextGroupOrder, nextManualEmptyGroups);
	                            skills = nextSkills;
	                            topLevelOrder = nextTopLevelOrder;
	                            groupOrder = nextGroupOrder;
	                            manualEmptyGroups = nextManualEmptyGroups;
	                            if (Array.isArray(message.favorites)) favoritePaths = new Set(message.favorites);
	                            if (Array.isArray(message.collapsedGroups)) collapsedGroups = new Set(message.collapsedGroups);
	                            if (Array.isArray(message.recentSkills)) recentSkillPaths = message.recentSkills.slice();
                            var validPaths = new Set(skills.map(function(s) { return s.path; }));
                            recentSkillPaths = recentSkillPaths.filter(function(path) { return validPaths.has(path); }).slice(0, RECENT_SKILLS_LIMIT);
                            selectedSkills.forEach(function(p) { if (!validPaths.has(p)) selectedSkills.delete(p); });
                            selectedSkillsMap.forEach(function(v, p) { if (!validPaths.has(p)) selectedSkillsMap.delete(p); });
                            unsavedPaths.forEach(function(p) { if (!validPaths.has(p)) unsavedPaths.delete(p); });
	                            if (lastSelectedPath && !validPaths.has(lastSelectedPath)) lastSelectedPath = null;
	                            let desiredCurrentPath = previousCurrentPath;
	                            let desiredCurrentIndex = currentIndex;
                                let desiredFilterType = filterType;
                                let desiredSearchQuery = searchQuery;
                                let desiredListScrollTop = null;
                                let desiredEditorScrollTop = null;
                                let desiredEditorSelectionStart = null;
                                let desiredEditorSelectionEnd = null;
                                let desiredSidebarWidth = null;
                                let desiredCompactSidebarRatio = null;
	                            if (message.restoreState) {
	                                if (Array.isArray(message.restoreState.collapsedGroups)) collapsedGroups = new Set(message.restoreState.collapsedGroups);
	                                if (typeof message.restoreState.currentPath === 'string' && message.restoreState.currentPath) desiredCurrentPath = message.restoreState.currentPath;
	                                if (typeof message.restoreState.currentIndex === 'number' && message.restoreState.currentIndex >= 0) desiredCurrentIndex = message.restoreState.currentIndex;
                                    if (typeof message.restoreState.filterType === 'string' && message.restoreState.filterType) desiredFilterType = message.restoreState.filterType;
                                    if (typeof message.restoreState.searchQuery === 'string') desiredSearchQuery = message.restoreState.searchQuery;
                                    if (typeof message.restoreState.listScrollTop === 'number') desiredListScrollTop = message.restoreState.listScrollTop;
                                    if (typeof message.restoreState.editorScrollTop === 'number') desiredEditorScrollTop = message.restoreState.editorScrollTop;
                                    if (typeof message.restoreState.editorSelectionStart === 'number') desiredEditorSelectionStart = message.restoreState.editorSelectionStart;
                                    if (typeof message.restoreState.editorSelectionEnd === 'number') desiredEditorSelectionEnd = message.restoreState.editorSelectionEnd;
                                    if (typeof message.restoreState.sidebarWidth === 'number') desiredSidebarWidth = message.restoreState.sidebarWidth;
                                    if (typeof message.restoreState.compactSidebarRatio === 'number' && isFinite(message.restoreState.compactSidebarRatio) && message.restoreState.compactSidebarRatio > 0) desiredCompactSidebarRatio = message.restoreState.compactSidebarRatio;
	                            }
                                filterType = desiredFilterType || 'all';
                                searchQuery = (typeof desiredSearchQuery === 'string' ? desiredSearchQuery : '').toLowerCase();
                                if (searchInput) searchInput.value = typeof desiredSearchQuery === 'string' ? desiredSearchQuery : '';
                                    if (typeof desiredCompactSidebarRatio === 'number') {
                                        compactSidebarRatio = desiredCompactSidebarRatio;
                                    }
                                    if (typeof desiredSidebarWidth === 'number' && desiredSidebarWidth >= 180) {
                                        desktopSidebarWidth = desiredSidebarWidth;
                                    }
                                    syncResponsiveSidebar();
		                                syncFilterTabs();
	                            if (skills.length > 0) {
	                                currentIndex = resolveIndexByPath(desiredCurrentPath, desiredCurrentIndex);
                                    const restoreEditorState = {
                                        scrollTop: desiredEditorScrollTop,
                                        selectionStart: desiredEditorSelectionStart,
                                        selectionEnd: desiredEditorSelectionEnd
                                    };
                                    if (skipLayoutRebuild) {
                                        if (typeof desiredListScrollTop === 'number') {
                                            skillList.scrollTop = desiredListScrollTop;
                                        }
                                        const activeSkill = currentIndex !== -1 ? skills[currentIndex] : null;
                                        const activePath = activeSkill ? activeSkill.path : null;
                                        const updatedPaths = Array.isArray(message.layoutUpdatedPaths) ? message.layoutUpdatedPaths : [];
                                        const activeSkillNeedsRefresh = !!(activeSkill && updatedPaths.indexOf(activePath) !== -1 && !isSkillDirty(activePath));
                                        if (activeSkillNeedsRefresh) {
                                            renderEditor(currentIndex, {
                                                syncList: false,
                                                restoreEditorState: restoreEditorState
                                            });
                                        } else if (activeSkill) {
                                            currentEditorSkillPath = activePath;
                                            if (!isSkillDirty(activePath)) currentEditorBaseline = activeSkill.content || currentEditorBaseline;
                                            vscode.postMessage({ command: 'setActiveSkill', skillPath: activePath });
                                        }
                                    } else {
	                                    renderList();
	                                        if (typeof desiredListScrollTop === 'number') {
	                                            skillList.scrollTop = desiredListScrollTop;
	                                        }
	                                    renderEditor(currentIndex, {
	                                            syncList: false,
	                                            restoreEditorState: restoreEditorState
	                                        });
                                    }

	                                // Explicitly sync baseline with newest disk content after save
	                                if (message.saveResult && message.saveResult.ok && currentIndex !== -1) {
	                                    const currentSkill = skills[currentIndex];
                                    if (currentSkill && currentSkill.path === message.saveResult.savedPath) {
                                        currentEditorBaseline = currentSkill.content || '';
                                        unsavedPaths.delete(currentSkill.path);
                                        renderList(); // Refresh icons
                                    }
                                }

                                if (message.saveResult && message.saveResult.ok && pendingSwitchPath) {
                                    const switchPath = pendingSwitchPath;
                                    pendingSwitchPath = null;
                                    const switchIndex = skills.findIndex(function(skill) { return skill.path === switchPath; });
                                    if (switchIndex !== -1) {
                                        lastSelectedPath = switchPath;
                                        renderEditor(switchIndex);
                                    }
                                }
                            } else {
                                currentIndex = -1;
                                renderList();
                                renderEmptyState(t.noSkills);
                            }
                        } else if (message.command === 'saveResult') {
                            if (!message.ok) {
                                pendingSwitchPath = null;
                                const saveBtn = document.getElementById('saveBtn');
                                if (saveBtn) {
                                    try { saveBtn.querySelector('span').textContent = t.saveBtn; } catch (e) { }
                                }
                            }
                        } else if (message.command === 'showImportModal') {
                            showImportModal(message.files, { source: message.source || 'picker' });
                        } else if (message.command === 'switchApproved') {
                            if (message.save && currentIndex !== -1 && skills[currentIndex]) {
                                const c = document.getElementById('skillContent');
                                if (c) {
                                    vscode.postMessage({ command: 'saveSkill', skillPath: skills[currentIndex].path, content: c.value });
                                }
                            } else if (!message.save && currentIndex !== -1 && skills[currentIndex]) {
                                unsavedPaths.delete(skills[currentIndex].path);
                                currentEditorBaseline = document.getElementById('skillContent') ? document.getElementById('skillContent').value : currentEditorBaseline;
                            }
                            if (!message.save && pendingSwitchPath) {
                                const switchPath = pendingSwitchPath;
                                pendingSwitchPath = null;
                                const switchIndex = skills.findIndex(function(skill) { return skill.path === switchPath; });
                                if (switchIndex !== -1) {
                                    renderEditor(switchIndex);
                                    lastSelectedPath = switchPath;
                                }
                            }
                        }
                    });

                    let lastSelectedPath = null;
                    let pendingSwitchPath = null;

                    function recordRecentSkillUse(skillPath) {
                        if (!skillPath) return;
                        if (recentSkillPaths.length > 0 && recentSkillPaths[0] === skillPath) return;
                        recentSkillPaths = [skillPath].concat(recentSkillPaths.filter(function(path) {
                            return path !== skillPath;
                        })).slice(0, RECENT_SKILLS_LIMIT);
                        vscode.postMessage({ command: 'saveRecentSkills', recentSkills: recentSkillPaths.slice() });
                    }
                    function getRecentSkills() {
                        return recentSkillPaths.map(function(path) {
                            return skills.find(function(skill) { return skill.path === path; }) || null;
                        }).filter(Boolean).slice(0, RECENT_SKILLS_LIMIT);
                    }
                    function getFilteredSkills() {
                        let filtered = filterType === 'recent'
                            ? getRecentSkills()
                            : skills.filter((s) => {
                            if (filterType === 'favorite') { if (!favoritePaths.has(s.path)) return false; }
                            else if (filterType !== 'all' && s.type !== filterType) return false;
                            if (searchQuery && !(s.displayName || s.name).toLowerCase().includes(searchQuery) && !s.name.toLowerCase().includes(searchQuery) && !(s.description || '').toLowerCase().includes(searchQuery)) return false;
                            return true;
                        });

                        if (filterType === 'recent' && searchQuery) {
                            filtered = filtered.filter((s) => {
                                return (s.displayName || s.name).toLowerCase().includes(searchQuery)
                                    || s.name.toLowerCase().includes(searchQuery)
                                    || (s.description || '').toLowerCase().includes(searchQuery);
                            });
                        }

                        return filtered;
                    }

                    function renderSkillItem(skill) {
                        var realIndex = skills.indexOf(skill);
                        var isSelected = selectedSkills.has(skill.path);
                        var isAtActive = selectedSkillsMap.has(skill.path);
                        var activeClass = (realIndex === currentIndex) ? ' active' : '';
                        var selectedClass = isSelected ? ' selected' : '';
                        var unsavedClass = unsavedPaths.has(skill.path) ? ' has-unsaved' : '';
                        var iconColor = isAtActive ? 'var(--vscode-button-foreground)' : 'var(--vscode-descriptionForeground)';
                        var iconOpacity = isAtActive ? '1' : '0.6';
                        var atClass = isAtActive ? ' at-active' : '';
                        var iconHtml = '<div class="icon-container' + atClass + '" data-action="toggle-select"><svg class="icon" style="color:' + iconColor + '; opacity:' + iconOpacity + '" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg"><circle cx="8" cy="8" r="6" fill="currentColor" opacity="0.3"/><text x="8" y="11" text-anchor="middle" font-size="9" font-weight="bold" fill="currentColor">@</text></svg></div>';
                        var isFav = favoritePaths.has(skill.path);
                        var starSvg = '<svg class="icon star-icon' + (isFav ? ' favorited' : '') + '" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg"><path fill="' + (isFav ? 'currentColor' : 'none') + '" stroke="currentColor" stroke-width="1.2" d="M8 1.5l2 4 4.5.5-3.2 3.2.8 4.5L8 11.2l-4.1 2.2.8-4.5L1.5 6l4.5-.5L8 1.5z"/></svg>';
                        var starHtml = '<div class="favorite-star" data-action="toggle-favorite" data-path="' + escHtml(skill.path) + '" title="' + (isFav ? (t.unfavorite || 'Unfavorite') : (t.favorite || 'Favorite')) + '">' + starSvg + '</div>';
                        var badge = '';
                        if (skill.type === 'Global') badge = '<span class="badge badge-global">' + (t.globalBadge || 'Global') + '</span>';
                        else if (skill.type === 'Project') badge = '<span class="badge badge-project">' + (t.projectBadge || 'Project') + '</span>';
                        var descLine = skill.description ? '<span class="skill-desc">' + escHtml(skill.description) + '</span>' : '';
                        var showName = skill.displayName || skill.name;
                        return '<div class="skill-item' + activeClass + selectedClass + unsavedClass + '" data-index="' + realIndex + '" draggable="false">'
                            + iconHtml
                            + '<div class="skill-info"><span class="skill-name">' + escHtml(showName) + '</span>' + descLine + '</div>'
                            + starHtml
                            + badge
                            + '</div>';
                    }

	                    function renderList() {
	                        const prevScrollTop = skillList.scrollTop;
	                        const filtered = getFilteredSkills();
	                        var html = '';
	                        if (filtered.length === 0 && skills.length > 0) {
                                const emptyMessage = filterType === 'recent'
                                    ? (t.noRecentSkills || 'No recent @ skills yet.')
                                    : (t.noResults || "No matching skills.");
	                            html = '<div style="padding:20px;text-align:center;color:var(--vscode-descriptionForeground);font-size:13px;">' + emptyMessage + '</div>';
	                        } else if (filterType === 'recent') {
                            filtered.forEach(function(skill) {
                                html += renderSkillItem(skill);
                            });
                        } else {
                            reconcileTopLevelOrder();
                            var ungroupedSkillMap = {};
                            var groupsMap = {};
                            for (var fi = 0; fi < filtered.length; fi++) {
                                var skill = filtered[fi];
                                if (isUngrouped(skill.group)) {
                                    ungroupedSkillMap[skill.path] = skill;
                                } else {
                                    var g = skill.group;
                                    if (!groupsMap[g]) groupsMap[g] = [];
                                    groupsMap[g].push(skill);
                                }
                            }

                            manualEmptyGroups = manualEmptyGroups.filter(function(g) { return !groupsMap[g]; });

                            for (var toi = 0; toi < topLevelOrder.length; toi++) {
                                var token = topLevelOrder[toi];
                                if (isSkillToken(token)) {
                                    var skillPath = tokenSkillPath(token);
                                    if (ungroupedSkillMap[skillPath]) {
                                        html += renderSkillItem(ungroupedSkillMap[skillPath]);
                                    }
                                } else if (isGroupToken(token)) {
                                    var gName = tokenGroupName(token);
                                    var groupSkills = groupsMap[gName];
                                    var isManualEmpty = manualEmptyGroups.indexOf(gName) !== -1;
                                    if (!groupSkills && !isManualEmpty) continue;
                                    var isCollapsedBool = collapsedGroups.has(gName);
                                    var isCollapsed = isCollapsedBool ? ' collapsed' : '';
                                    var displayGName = getGroupLabel(gName);
                                    var groupCount = groupSkills ? groupSkills.length : 0;
                                    html += '<div class="skill-group" data-group="' + escHtml(gName) + '">';
                                    var isGroupSelected = selectedGroups.has(gName) ? ' selected' : '';
                                    html += '<div class="group-header' + isCollapsed + isGroupSelected + '" data-action="toggle-group" draggable="false">' + getGroupArrowSvg(isCollapsedBool) + '<span>' + escHtml(displayGName) + '</span><span class="group-count">' + groupCount + '</span></div>';
                                    html += '<div class="group-items' + isCollapsed + '">';
                                    html += '<div class="group-drop-zone group-drop-zone-top" data-group="' + escHtml(gName) + '" data-position="top"></div>';
                                    if (groupSkills) {
                                        for (var si = 0; si < groupSkills.length; si++) {
                                            html += renderSkillItem(groupSkills[si]);
                                        }
                                    }
                                    html += '<div class="group-drop-zone group-drop-zone-bottom" data-group="' + escHtml(gName) + '" data-position="end"></div>';
                                    html += '</div></div>';
                                }
                            }
                        }
                        skillList.innerHTML = html;
                        ensureDragIndicatorElements();
                        skillList.scrollTop = prevScrollTop;
                        syncExpandCollapseIcon();
                        if (clearBtn) clearBtn.style.display = selectedSkillsMap.size > 0 ? 'flex' : 'none';
                        if (totalCount) totalCount.textContent = (t.totalSkills || 'Total Skills') + ': ' + skills.length;
                    }

                    function _toggleVisual(index, force) {
                        const skill = skills[index]; if (!skill) return;
                        if (force === true) { selectedSkills.add(skill.path); }
                        else if (force === false) { selectedSkills.delete(skill.path); }
                        else { if (selectedSkills.has(skill.path)) selectedSkills.delete(skill.path); else selectedSkills.add(skill.path); }
                    }
                    function _toggleWithClipboard(index, force) {
                        const skill = skills[index]; if (!skill) return;
                        if (force === true) {
                            selectedSkillsMap.set(skill.path, '[' + skill.name + '](file://' + skill.path + ')');
                            recordRecentSkillUse(skill.path);
                        }
                        else if (force === false) { selectedSkillsMap.delete(skill.path); }
                        else {
                            if (selectedSkillsMap.has(skill.path)) {
                                selectedSkillsMap.delete(skill.path);
                            } else {
                                selectedSkillsMap.set(skill.path, '[' + skill.name + '](file://' + skill.path + ')');
                                recordRecentSkillUse(skill.path);
                            }
                        }
                    }
                    function clearVisualSelection() {
                        selectedSkills.clear();
                    }
                    function clearGroupSelection() {
                        if (selectedGroups.size === 0 && !skillList.querySelector('.group-header.selected, .group-header.drag-proxy-peer')) return false;
                        selectedGroups.clear();
                        lastSelectedGroupName = null;
                        skillList.querySelectorAll('.group-header.selected, .group-header.drag-proxy-peer').forEach(function(headerEl) {
                            headerEl.classList.remove('selected', 'drag-proxy-peer');
                        });
                        return true;
                    }
                    function syncGroupSelectionVisuals() {
                        skillList.querySelectorAll('.skill-group[data-group]').forEach(function(groupEl) {
                            const groupName = groupEl.getAttribute('data-group');
                            const headerEl = groupEl.querySelector('.group-header');
                            if (!headerEl) return;
                            headerEl.classList.toggle('selected', selectedGroups.has(groupName));
                        });
                    }
                    function setSingleGroupSelection(groupName) {
                        if (!groupName) {
                            clearGroupSelection();
                            return;
                        }
                        selectedGroups = new Set([groupName]);
                        lastSelectedGroupName = groupName; 
                        syncGroupSelectionVisuals();
                    }
                    function getVisibleGroupNames() {
                        return Array.from(skillList.querySelectorAll('.skill-group[data-group]')).map(function(groupEl) {
                            return groupEl.getAttribute('data-group');
                        }).filter(Boolean);
                    }
                    function getVisibleGroupRange(anchorGroupName, targetGroupName) {
                        const visibleGroupNames = getVisibleGroupNames();
                        const targetIndex = visibleGroupNames.indexOf(targetGroupName);
                        if (targetIndex === -1) return [];
                        const anchorIndex = visibleGroupNames.indexOf(anchorGroupName);
                        if (anchorIndex === -1) return [targetGroupName];
                        const start = Math.min(anchorIndex, targetIndex);
                        const end = Math.max(anchorIndex, targetIndex);
                        return visibleGroupNames.slice(start, end + 1);
                    }
                    function clearAtSelection() {
                        selectedSkillsMap.clear();
                    }
                    function _flushClipboard() {
                        var payloadArray = Array.from(selectedSkillsMap.values());
                        vscode.postMessage({ command: 'writeToClipboardExact', payload: payloadArray.join(' '), count: payloadArray.length });
                    }
                    function _flushRender() {
                        renderList();
                        if (currentIndex !== -1) renderEditor(currentIndex, { syncList: false });
                    }
                    function toggleSkillSelection(index, force) {
                        _toggleWithClipboard(index, force);
                        _flushRender(); _flushClipboard();
                    }
                    function getVisibleSkillPaths() {
                        return Array.from(skillList.querySelectorAll('.skill-item')).map(function(el) {
                            const index = parseInt(el.getAttribute('data-index'));
                            return skills[index] ? skills[index].path : null;
                        }).filter(Boolean);
                    }
                    function getVisibleRangePaths(anchorPath, targetPath) {
                        const visiblePaths = getVisibleSkillPaths();
                        const anchorPos = visiblePaths.indexOf(anchorPath);
                        const targetPos = visiblePaths.indexOf(targetPath);
                        if (anchorPos === -1 || targetPos === -1) return [targetPath];
                        const start = Math.min(anchorPos, targetPos);
                        const end = Math.max(anchorPos, targetPos);
                        return visiblePaths.slice(start, end + 1);
                    }
                    function toggleSkillSelectionPaths(paths, force) {
                        paths.forEach(function(path) {
                            const index = skills.findIndex(function(skill) { return skill.path === path; });
                            if (index !== -1) _toggleWithClipboard(index, force);
                        });
                        _flushRender(); _flushClipboard();
                    }
                    function getEditorCopyTargetPaths(skillPath) {
                        if (selectedSkills.size > 1) {
                            return getOrderedSkillPaths(Array.from(selectedSkills));
                        }
                        if (skillPath && selectedSkillsMap.size > 1 && selectedSkillsMap.has(skillPath)) {
                            return getOrderedSkillPaths(Array.from(selectedSkillsMap.keys()));
                        }
                        return skillPath ? [skillPath] : [];
                    }
                    function getEditorDeleteTargetPaths(skillPath) {
                        if (selectedSkills.size > 1) {
                            return getOrderedSkillPaths(Array.from(selectedSkills));
                        }
                        return skillPath ? [skillPath] : [];
                    }
                    function areAllPathsAtSelected(paths) {
                        return Array.isArray(paths) && paths.length > 0 && paths.every(function(path) {
                            return selectedSkillsMap.has(path);
                        });
                    }
                    function syncCopyToChatButtonState(buttonEl, skillPath) {
                        if (!buttonEl) return;
                        const labelEl = buttonEl.querySelector('span');
                        const targetPaths = getEditorCopyTargetPaths(skillPath);
                        const count = targetPaths.length;
                        const allSelected = areAllPathsAtSelected(targetPaths);
                        buttonEl.classList.toggle('preview-active', allSelected);
                        buttonEl.classList.toggle('secondary', !allSelected);
                        if (!labelEl) return;
                        if (count > 1) {
                            labelEl.textContent = (allSelected ? (t.selected || 'Selected') : (t.copyToChat || 'Copy to Chat')) + ' ' + count;
                            buttonEl.title = (allSelected ? (t.selected || 'Selected') : (t.copyToChat || 'Copy to Chat')) + ' (' + count + ')';
                        } else {
                            labelEl.textContent = allSelected ? (t.selected || 'Selected') : (t.copyToChat || 'Copy to Chat');
                            buttonEl.title = allSelected ? (t.selected || 'Selected') : (t.copyToChat || 'Copy to Chat');
                        }
                    }
                    function selectVisualPaths(paths, force) {
                        paths.forEach(function(path) {
                            const index = skills.findIndex(function(skill) { return skill.path === path; });
                            if (index !== -1) _toggleVisual(index, force);
                        });
                        _flushRender();
                    }
                    function getSelectedSkills() {
                        return skills.filter(function(s) { return selectedSkills.has(s.path); });
                    }
                    function getNoChangesMessage() {
                        return t.noChangesMade || '您未做任何改动 (No changes made)';
                    }
                    function contentsMatch(a, b) {
                        const normalize = (s) => (s || '').replace(/\\r\\n/g, '\\n');
                        return normalize(a) === normalize(b);
                    }
                    function isSkillDirty(skillPath) {
                        if (!skillPath) return false;
                        if (currentEditorSkillPath === skillPath) {
                            const activeEditor = document.getElementById('skillContent');
                            if (activeEditor) return !contentsMatch(activeEditor.value, currentEditorBaseline);
                        }
                        return unsavedPaths.has(skillPath);
                    }
                    function syncCurrentEditorDirtyState() {
                        if (!currentEditorSkillPath) return false;
                        const activeEditor = document.getElementById('skillContent');
                        if (!activeEditor) return false;
                        const dirty = !contentsMatch(activeEditor.value, currentEditorBaseline);
                        if (dirty) unsavedPaths.add(currentEditorSkillPath);
                        else unsavedPaths.delete(currentEditorSkillPath);
                        renderList();
                        return dirty;
                    }

	                    function renderEditor(index, options) {
	                        const renderOptions = options || {};
                        const previousEditor = document.getElementById('skillContent');
                        const previousRenderedSkill = (currentIndex !== -1 && skills[currentIndex]) ? skills[currentIndex] : null;
                        const previousEditorValue = previousEditor ? previousEditor.value : null;
                        const previousRenderedPath = previousRenderedSkill ? previousRenderedSkill.path : null;
                        currentIndex = index;
                        if (renderOptions.syncList !== false) renderList();
                        const skill = skills[index];
                        if (!skill) {
                            renderEmptyState(t.empty);
                            return;
                        }
                        vscode.postMessage({ command: 'setActiveSkill', skillPath: skill.path });
                        const savedContent = skill.content || '';
                        const content = (previousRenderedPath === skill.path && previousEditorValue !== null && unsavedPaths.has(skill.path))
                            ? previousEditorValue
                            : savedContent;
                        currentEditorSkillPath = skill.path;
                        currentEditorBaseline = savedContent;
                        if (!contentsMatch(content, savedContent)) unsavedPaths.add(skill.path);
                        else unsavedPaths.delete(skill.path);

                        mainArea.innerHTML = '<div class="editor-header">'
                            + '<div class="skill-title-container"><div class="skill-title">' + escHtml(skill.displayName || skill.name) + '</div><div class="skill-path-wrapper"><div class="skill-path">' + escHtml(skill.path) + '</div><div class="copy-path-btn"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg><div class="copy-path-tooltip">' + t.copyPath + '</div></div></div></div>'
                            + '<div style="display:flex; gap:4px; flex-shrink:0;">'
                            + '<button class="save-btn secondary" id="exportBtn" title="' + t.exportBtn + '"><svg class="icon" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg"><path d="M8 1L5 4h2v5h2V4h2L8 1zM2 10v4h12v-4h-1v3H3v-3H2z"/></svg><span>' + t.exportBtn + '</span></button>'
	                            + (skill.type === 'Global' ? '<button class="save-btn secondary" id="copyToChatBtn" title="' + t.copyToChat + '"><svg class="icon" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg"><circle cx="8" cy="8" r="6" fill="currentColor" opacity="0.18"></circle><text x="8" y="11" text-anchor="middle" font-size="9" font-weight="700" fill="currentColor">@</text></svg><span>' + t.copyToChat + '</span></button>' : '')
                            + '<button class="save-btn destructive icon-only" id="deleteBtn" title="' + t.deleteConfirmTitle + '"><svg class="icon" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg"><path d="M14 3h-3V1H5v2H2v1h1v11h10V4h1V3zM6 2h4v1H6V2zm6 12H4V4h8v10z"/><path d="M6 6h1v6H6zm3 0h1v6H9z"/></svg></button>'
                            + '<button class="save-btn" id="saveBtn" title="' + t.saveBtn + '"><svg class="icon" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg"><path d="M13 1H3l-1.5 1.5v11L3 15h10l1.5-1.5v-11L13 1zM3 14V3h9v11H3zm7-10H4v4h6V4z"/></svg><span>' + t.saveBtn + '</span></button>'
                            + '</div></div>'
                            + '<div class="editor-container">'
                            + '<textarea id="skillContent" spellcheck="false"></textarea>'
                            + '</div>';

	                        const ta = document.getElementById('skillContent');
	                        ta.value = content;
                            const restoreEditorState = renderOptions.restoreEditorState || null;
                            if (restoreEditorState && typeof restoreEditorState.scrollTop === 'number') {
                                requestAnimationFrame(() => {
                                    ta.scrollTop = restoreEditorState.scrollTop;
                                    if (typeof restoreEditorState.selectionStart === 'number' && typeof restoreEditorState.selectionEnd === 'number') {
                                        try {
                                            ta.selectionStart = restoreEditorState.selectionStart;
                                            ta.selectionEnd = restoreEditorState.selectionEnd;
                                        } catch (err) { }
                                    }
                                });
                            }
	                        
                        // Copy path
                        const copyBtnEl = mainArea.querySelector('.copy-path-btn');
	                        if (copyBtnEl) {
	                            copyBtnEl.addEventListener('click', (e) => {
                                e.stopPropagation();
                                navigator.clipboard.writeText(skill.path).catch(err => {
                                    const tmp = document.createElement('textarea');
                                    tmp.value = skill.path;
                                    document.body.appendChild(tmp);
                                    tmp.select();
                                    document.execCommand('copy');
                                    document.body.removeChild(tmp);
                                });
                                const copiedText = t.copySuccess ? t.copySuccess.split('!')[0].split('！')[0] + (t.copySuccess.includes('！') ? '！' : '!') : 'Copied!';
                                vscode.postMessage({ command: 'showInfo', text: copiedText });
                            });
                        }

                        // Export
                        document.getElementById('exportBtn').addEventListener('click', () => { 
                            const paths = (selectedSkills.size > 1 && selectedSkills.has(skill.path)) 
                                ? getOrderedSkillPaths(Array.from(selectedSkills))
                                : [skill.path];
                            vscode.postMessage({ command: 'exportSkills', skillPaths: paths }); 
                        });

                        // Copy to chat
                        const copyToChatBtn = document.getElementById('copyToChatBtn');
	                        if (copyToChatBtn) {
                                syncCopyToChatButtonState(copyToChatBtn, skill.path);
	                            copyToChatBtn.addEventListener('click', () => {
                                    const targetPaths = getEditorCopyTargetPaths(skill.path);
                                    const nextState = !areAllPathsAtSelected(targetPaths);
                                    toggleSkillSelectionPaths(targetPaths, nextState);
                                    scheduleUiStateSave();
                                });
	                        }

                        // Delete
                        document.getElementById('deleteBtn').addEventListener('click', () => {
                            if (selectedGroups.size > 0) {
                                const targetGroupNames = Array.from(selectedGroups);
                                const targetGroupSet = new Set(targetGroupNames);
                                const targetSkills = skills.filter(function(sk) { return targetGroupSet.has(sk.group); });
                                const deleteTitle = targetGroupNames.length > 1
                                    ? (t.deleteGroupsBtn || t.deleteGroupBtn || 'Delete Groups')
                                    : (t.deleteGroupBtn || 'Delete Group');
                                const deleteMsg = targetGroupNames.length > 1
                                    ? (t.deleteGroupsMsg || 'Are you sure you want to completely delete these groups and ALL their skills? This cannot be undone.')
                                    : (t.deleteGroupMsg || 'Are you sure you want to completely delete this group and ALL its skills? This cannot be undone.');
                                showConfirm(deleteTitle, deleteMsg, () => {
                                    manualEmptyGroups = manualEmptyGroups.filter(function(groupName) { return !targetGroupSet.has(groupName); });
                                    targetGroupNames.forEach(function(groupName) { collapsedGroups.delete(groupName); });
                                    clearGroupSelection();
                                    vscode.postMessage({ command: 'saveCollapsedGroups', collapsedGroups: Array.from(collapsedGroups) });
                                    if (targetSkills.length > 0) {
                                        vscode.postMessage({ command: 'deleteSkills', skillPaths: targetSkills.map(function(sk) { return sk.path; }) });
                                    }
                                    renderList();
                                    persistOrdering();
                                }, true);
                                return;
                            }

                            const targetPaths = getEditorDeleteTargetPaths(skill.path);
                            if (targetPaths.length === 0) return;
                            const title = targetPaths.length > 1 ? (t.deleteSkillsConfirmTitle || 'Delete Skills') : (t.deleteConfirmTitle || 'Delete Skill');
                            const msg = targetPaths.length > 1
                                ? (t.deleteSkillsMsg || 'Are you sure you want to permanently delete these {0} skills? This cannot be undone.').replace('{0}', targetPaths.length)
                                : (t.deleteMsg || 'Are you sure you want to permanently delete this skill? This cannot be undone.');
                            showConfirm(title, msg, () => {
                                if (targetPaths.length === 1) {
                                    vscode.postMessage({ command: 'deleteSkill', skillPath: targetPaths[0] });
                                } else {
                                    vscode.postMessage({ command: 'deleteSkills', skillPaths: targetPaths });
                                }
                            }, true);
                        });

                        // Save
                        document.getElementById('saveBtn').addEventListener('click', () => { 
                            if (!isSkillDirty(skill.path)) { vscode.postMessage({ command: 'showInfo', text: getNoChangesMessage() }); return; }
                            showConfirm(t.saveConfirmTitle, t.saveMsg, () => {
                                const btn = document.getElementById('saveBtn');
                                btn.querySelector('span').textContent = t.saving;
                                const c = document.getElementById('skillContent');
                                if (c) {
                                    vscode.postMessage({ command: 'saveSkill', skillPath: skill.path, content: c.value });
                                }
                                setTimeout(() => { try { btn.querySelector('span').textContent = t.saveBtn; } catch(e){} }, 500);
                            }); 
                        });

                        // Track unsaved changes
	                        if (ta) {
	                            ta.addEventListener('input', () => { syncCurrentEditorDirtyState(); scheduleUiStateSave(); });
                                ta.addEventListener('scroll', () => { scheduleUiStateSave(); }, { passive: true });
	                            ta.addEventListener('keydown', (e) => {
	                                if ((e.metaKey || e.ctrlKey) && e.key === 's') { e.preventDefault(); document.getElementById('saveBtn').click(); }
	                                // Tab support
	                                if (e.key === 'Tab') { e.preventDefault(); const start = ta.selectionStart; const end = ta.selectionEnd; ta.value = ta.value.substring(0, start) + '    ' + ta.value.substring(end); ta.selectionStart = ta.selectionEnd = start + 4; }
	                            });
                                ta.addEventListener('click', () => { scheduleUiStateSave(); });
                                ta.addEventListener('keyup', () => { scheduleUiStateSave(); });
	                        }
                            scheduleUiStateSave();
	                    }

                    function refreshCurrentEditor() {
                        if (currentIndex !== -1) renderEditor(currentIndex, { syncList: false });
                    }

	                    function refreshListAndEditor() {
	                        renderList();
	                        refreshCurrentEditor();
                            scheduleUiStateSave();
	                    }

                    // Import button
                    if (importBtn) {
                        importBtn.addEventListener('click', () => { vscode.postMessage({ command: 'importSkills' }); });
                    }

                    // Confirm modal
                    const confirmModal = document.getElementById('confirmModal');
                    const cancelConfirmBtn = document.getElementById('cancelConfirmBtn');
                    const acceptConfirmBtn = document.getElementById('acceptConfirmBtn');
                    let confirmCallback = null;
                    function showConfirm(title, message, callback, isDestructive) {
                        document.getElementById('confirmTitle').innerText = title;
                        document.getElementById('confirmMessage').innerText = message;
                        confirmCallback = callback;
                        acceptConfirmBtn.style.backgroundColor = isDestructive ? 'var(--vscode-errorForeground)' : '';
                        confirmModal.classList.add('active');
                    }
                    function closeConfirmModal() { confirmModal.classList.remove('active'); confirmCallback = null; acceptConfirmBtn.style.backgroundColor = ''; }
                    cancelConfirmBtn.addEventListener('click', closeConfirmModal);
                    acceptConfirmBtn.addEventListener('click', () => { if (confirmCallback) confirmCallback(); closeConfirmModal(); });
                    confirmModal.addEventListener('click', (e) => { if (e.target === confirmModal) closeConfirmModal(); });

                    function toggleGroupCollapse(groupHeader) {
                        if (!groupHeader) return false;
                        const gName = groupHeader.parentElement.getAttribute('data-group');
                        if (!gName) return false;
                        if (collapsedGroups.has(gName)) collapsedGroups.delete(gName);
                        else collapsedGroups.add(gName);
                        clearGroupSelection();
                        vscode.postMessage({ command: 'saveCollapsedGroups', collapsedGroups: Array.from(collapsedGroups) });
                        renderList();
                        syncExpandCollapseIcon();
                        scheduleUiStateSave();
                        return true;
                    }

                    // Group header double-click to toggle collapse
                    skillList.addEventListener('dblclick', (e) => {
                        const groupHeader = e.target.closest('.group-header');
                        if (!groupHeader) return;
                        if (e.target.closest('.group-arrow')) return;
                        if (e.shiftKey || e.metaKey || e.ctrlKey) return;
                        toggleGroupCollapse(groupHeader);
                    });

                    // Arrow should toggle immediately on single click and never start a drag gesture.
                    skillList.addEventListener('mousedown', (e) => {
                        if (e.button !== 0) return;
                        const clickedArrow = e.target.closest('.group-arrow');
                        if (!clickedArrow) return;
                        e.preventDefault();
                        e.stopPropagation();
                    });

                    // Skill list click
                    skillList.addEventListener('click', (e) => {
                        if (Date.now() < suppressClickUntil) return;
                        const clickedArrow = e.target.closest('.group-arrow');
                        if (clickedArrow) {
                            e.preventDefault();
                            e.stopPropagation();
                            if (e.shiftKey || e.metaKey || e.ctrlKey) return;
                            const groupHeader = clickedArrow.closest('.group-header');
                            toggleGroupCollapse(groupHeader);
                            return;
                        }

                        const groupHeader = e.target.closest('.group-header');
		                        if (groupHeader) {
                            if (!e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey) {
                                const groupName = groupHeader.parentElement.getAttribute('data-group');
                                setSingleGroupSelection(groupName);
                            }
                            return;
                        }

                        const shouldClearGroupSelection = !e.shiftKey && !e.metaKey && !e.ctrlKey;
                        if (shouldClearGroupSelection) {
                            clearGroupSelection();
                        }

                        const favAction = e.target.closest('[data-action="toggle-favorite"]');
                        if (favAction) {
                            e.stopPropagation();
                            var path = favAction.getAttribute('data-path');
                            if (path) {
                                const isSelected = selectedSkills.has(path);
                                const isRange = e.shiftKey && lastSelectedPath;
                                let targetPaths = [];

                                if (isRange) {
                                    // Shift + Click on Star -> Range Toggle
                                    targetPaths = getVisibleRangePaths(lastSelectedPath, path);
                                // } else if (isSelected && selectedSkills.size > 1) {
                                //    // Multi-select Click on Star -> Batch Toggle
                                //    targetPaths = Array.from(selectedSkills);
                                } else {
                                    // Single Click -> Single Toggle
                                    targetPaths = [path];
                                }

                                const isCurrentlyFav = favoritePaths.has(path);
                                const newFavState = !isCurrentlyFav; // Toggle based on the clicked item's state

                                let changed = false;
                                targetPaths.forEach(p => {
                                    if (newFavState) {
                                        if (!favoritePaths.has(p)) { favoritePaths.add(p); changed = true; }
                                    } else {
                                        if (favoritePaths.has(p)) { favoritePaths.delete(p); changed = true; }
                                    }
                                });

                                if (changed) {
                                    vscode.postMessage({ command: 'saveFavorites', favorites: Array.from(favoritePaths) });
                                    refreshListAndEditor();
                                }
                            }
                            return;
                        }
                        const target = e.target.closest('.skill-item'); const toggleAction = e.target.closest('[data-action="toggle-select"]');
                        if (target) {
                            const index = parseInt(target.getAttribute('data-index'));
                            const skillPath = skills[index] ? skills[index].path : null;
                            
                            const clearSelection = () => {
                                clearVisualSelection();
                            };

                            if (toggleAction) {
                                // --- @ Button Click (Checkbox Logic) ---
                                if (e.shiftKey && lastSelectedPath && skillPath) {
                                    // Shift+Click @: Range Toggle
                                    const rangePaths = getVisibleRangePaths(lastSelectedPath, skillPath);
                                    // Determine target state based on the clicked item's current state (inverse it)
                                    const isCurrentlySelected = selectedSkillsMap.has(skillPath);
                                    const newState = !isCurrentlySelected;
                                    
                                    // Apply to all in range
                                    toggleSkillSelectionPaths(rangePaths, newState);
                                    // Do NOT update anchor
                                } else if (selectedSkills.size > 1 && selectedSkills.has(skillPath) && !e.ctrlKey && !e.metaKey) {
                                    const orderedSelectedPaths = getOrderedSkillPaths(Array.from(selectedSkills));
                                    const isCurrentlySelected = selectedSkillsMap.has(skillPath);
                                    const newState = !isCurrentlySelected;
                                    toggleSkillSelectionPaths(orderedSelectedPaths, newState);
                                    lastSelectedPath = skillPath;
                                } else {
                                    toggleSkillSelection(index);
                                    lastSelectedPath = skillPath;
                                }
                            } else {
                                // --- Item Body Click (Selection Logic) ---
                                if (e.shiftKey && lastSelectedPath && skillPath) {
                                    // Shift+Click: Range Selection
                                    const rangePaths = getVisibleRangePaths(lastSelectedPath, skillPath);
                                    clearSelection();
                                    selectVisualPaths(rangePaths, true);
                                    // Keep anchor (lastSelectedPath) same
                                } else if (e.ctrlKey || e.metaKey) {
                                    // Ctrl/Cmd+Click: Toggle Selection
                                    if (selectedSkills.has(skillPath)) {
                                        selectedSkills.delete(skillPath);
                                    } else {
                                        selectedSkills.add(skillPath);
                                    }
                                    _flushRender();
                                    lastSelectedPath = skillPath; // Update anchor
                                } else {
                                    // Single Click: Select Only This
                                    clearSelection();
                                    
                                    // Switch Editor
                                    if (currentIndex !== -1 && currentIndex !== index && skills[currentIndex] && isSkillDirty(skills[currentIndex].path)) {
                                        pendingSwitchPath = skillPath;
                                        vscode.postMessage({ command: 'confirmSwitch', skillName: skills[currentIndex].displayName || skills[currentIndex].name });
                                    } else {
                                        pendingSwitchPath = null;
                                        renderEditor(index); 
                                        lastSelectedPath = skillPath; 
                                    }
                                    renderList(); // Ensure visual update
                                }
                            }
                        } else {
                            let needsRender = false;
                            if (selectedSkills.size > 0) {
                                clearVisualSelection();
                                needsRender = true;
                            }
                            if (shouldClearGroupSelection) {
                                needsRender = clearGroupSelection() || needsRender;
                            }
                            if (needsRender) {
                                renderList();
                            }
                        }
                    });

                    // Expand/Collapse All
                    const expandCollapseBtn = document.getElementById('expandCollapseBtn');
                    function syncExpandCollapseIcon() {
                        if (!expandCollapseBtn) return;
                        const allGroupNames = [];
                        document.querySelectorAll('.skill-group[data-group]').forEach(el => { allGroupNames.push(el.getAttribute('data-group')); });
                        const allCollapsed = allGroupNames.length > 0 && allGroupNames.every(g => collapsedGroups.has(g));
                        if (allCollapsed) {
                            expandCollapseBtn.title = t.expandAllBtn || 'Expand All';
                            expandCollapseBtn.innerHTML = '<svg class="icon" viewBox="0 0 16 16"><path fill="currentColor" d="M1 2h14v12H1V2zm1 1v10h12V3H2zm2 4h8v2H4V7z"/></svg>';
                        } else {
                            expandCollapseBtn.title = t.collapseAllBtn || 'Collapse All';
                            expandCollapseBtn.innerHTML = '<svg class="icon" viewBox="0 0 16 16"><path fill="currentColor" d="M1 4h14v1H1V4zm0 4h14v1H1V8zm0 4h14v1H1v-1z"/></svg>';
                        }
                    }
	                    if (expandCollapseBtn) {
	                        expandCollapseBtn.addEventListener('click', () => {
	                            const allGroupNames = [];
	                            document.querySelectorAll('.skill-group[data-group]').forEach(el => { allGroupNames.push(el.getAttribute('data-group')); });
                            const allCollapsed = allGroupNames.length > 0 && allGroupNames.every(g => collapsedGroups.has(g));
                            if (allCollapsed) {
                                collapsedGroups.clear();
                                vscode.postMessage({ command: 'saveCollapsedGroups', collapsedGroups: [] });
                            } else {
                                allGroupNames.forEach(g => collapsedGroups.add(g));
                                vscode.postMessage({ command: 'saveCollapsedGroups', collapsedGroups: Array.from(collapsedGroups) });
	                            }
	                            renderList();
	                            syncExpandCollapseIcon();
                                scheduleUiStateSave();
	                        });
	                    }

                    // Smart Grouping
                    const smartGroupBtn = document.getElementById('smartGroupBtn');
                    if (smartGroupBtn) {
                        smartGroupBtn.addEventListener('click', () => {
                            function kwCount(text, kw) {
                                if (!text || !kw) return 0;
                                var lower = kw.toLowerCase();
                                function isWord(code) { return (code >= 48 && code <= 57) || (code >= 65 && code <= 90) || (code >= 97 && code <= 122) || code === 95; }
                                if (/^[\x20-\x7e]+$/.test(kw)) {
                                    var wc = 0; var wp = 0;
                                    while ((wp = text.indexOf(lower, wp)) !== -1) {
                                        var bc = wp > 0 ? text.charCodeAt(wp - 1) : 32;
                                        var ac = wp + lower.length < text.length ? text.charCodeAt(wp + lower.length) : 32;
                                        if (!isWord(bc) && !isWord(ac)) wc++;
                                        wp += lower.length;
                                    }
                                    if (wc > 0) return wc;
                                    return text.indexOf(lower) !== -1 ? 1 : 0;
                                }
                                var c = 0; var p = 0;
                                while ((p = text.indexOf(lower, p)) !== -1) { c++; p += lower.length; }
                                return c;
                            }
                            const categoryConfigs = [
                                {
                                    key: 'smart.security',
                                    minScore: 3,
                                    keywords: [
                                        'security', 'secure', 'vulnerability', 'exploit', 'attack', 'threat', 'threat model',
                                        'pentest', 'penetration', 'encryption', 'decrypt', 'hash', 'crypto', 'certificate',
                                        'ssl', 'tls', 'firewall', 'waf', 'xss', 'csrf', 'injection', 'sqli',
                                        'access control', 'rbac', 'audit', 'compliance', 'cve', 'cwe', 'owasp',
                                        'secret', 'credential', 'ownership', 'bus factor',
                                        '安全', '漏洞', '加密', '解密', '防火墙', '防火牆', '威胁', '威脅', '审计', '審計', '权限', '許可權'
                                    ]
                                },
                                {
                                    key: 'smart.testing',
                                    minScore: 3,
                                    keywords: [
                                        'test', 'testing', 'unit test', 'integration test', 'e2e', 'end-to-end',
                                        'jest', 'vitest', 'mocha', 'chai', 'jasmine', 'cypress', 'selenium',
                                        'playwright', 'puppeteer', 'qa', 'quality assurance',
                                        'debug', 'debugging', 'debugger', 'breakpoint', 'coverage', 'assertion',
                                        'mock', 'stub', 'spy', 'load test', 'regression test',
                                        '测试', '測試', '调试', '調試', '除錯', 'bug', '质量', '品質', '单元测试', '單元測試'
                                    ]
                                },
                                {
                                    key: 'smart.devops',
                                    minScore: 3,
                                    keywords: [
                                        'docker', 'dockerfile', 'container', 'kubernetes', 'k8s', 'helm',
                                        'ci/cd', 'pipeline', 'github actions', 'gitlab ci',
                                        'deploy', 'deployment', 'hosting', 'publish',
                                        'aws', 'azure', 'gcp', 'cloud', 'cloudflare', 'netlify', 'vercel',
                                        'render', 'heroku', 'railway', 'fly.io',
                                        'terraform', 'ansible', 'pulumi', 'nginx', 'apache', 'caddy', 'proxy',
                                        'load balancer', 'linux', 'ssh', 'systemd', 'cron',
                                        'monitoring', 'logging', 'grafana', 'prometheus', 'sentry',
                                        'infrastructure', 'scaling', 'cdn',
                                        '运维', '維運', '部署', '容器', '云', '雲', '服务器', '伺服器', '发布', '發佈'
                                    ]
                                },
                                {
                                    key: 'smart.ai',
                                    minScore: 3,
                                    keywords: [
                                        'machine learning', 'deep learning', 'neural network', 'ml', 'dl',
                                        'artificial intelligence', 'pytorch', 'tensorflow', 'keras', 'jax',
                                        'llm', 'large language model', 'prompt', 'prompt engineering',
                                        'openai', 'claude', 'anthropic', 'gemini', 'gpt', 'chatgpt',
                                        'embedding', 'vector', 'rag', 'fine-tune', 'finetune', 'fine tuning',
                                        'transformers', 'huggingface', 'hugging face',
                                        'stable diffusion', 'midjourney', 'dall-e', 'dalle', 'sora',
                                        'agent sdk', 'copilot', 'inference', 'training',
                                        'nlp', 'natural language', 'computer vision',
                                        'langchain', 'llamaindex', 'autogen',
                                        'speech', 'transcribe', 'tts', 'stt', 'whisper', 'voice',
                                        'chatbot', 'completion', 'token', 'tokenizer',
                                        '模型', '大模型', '提示词', '提示詞', '智能', '人工智能',
                                        '机器学习', '機器學習', '深度学习', '深度學習', '训练', '訓練', '推理',
                                        '语音', '語音', '识别', '辨識'
                                    ]
                                },
                                {
                                    key: 'smart.frontend',
                                    minScore: 3,
                                    keywords: [
                                        'javascript', 'js', 'typescript', 'ts', 'jquery', 'ajax',
                                        'react', 'vue', 'angular', 'svelte', 'solid', 'preact',
                                        'nextjs', 'next.js', 'nuxt', 'gatsby', 'remix', 'astro',
                                        'html', 'css', 'sass', 'scss', 'less', 'tailwind', 'bootstrap',
                                        'styled-components', 'emotion', 'css-in-js', 'css modules',
                                        'webpack', 'vite', 'rollup', 'esbuild', 'parcel', 'turbopack',
                                        'jsx', 'tsx', 'dom', 'component', 'responsive', 'browser',
                                        'frontend', 'front-end', 'webapp', 'spa', 'pwa', 'shadcn',
                                        'canvas', 'p5', 'three.js', 'threejs', 'webgl', 'svg', 'd3',
                                        'gsap', 'framer', 'lottie',
                                        'winui', 'xaml', 'blazor', 'electron', 'tauri',
                                        'landing page', 'dashboard', 'layout', 'navigation',
                                        '前端', '介面', '组件', '組件', '页面', '頁面', '网页', '網頁',
                                        '样式', '樣式', '响应式', '響應式', '落地页', '落地頁'
                                    ]
                                },
                                {
                                    key: 'smart.backend',
                                    minScore: 3,
                                    keywords: [
                                        'node', 'express', 'fastify', 'koa', 'nestjs', 'hapi',
                                        'django', 'flask', 'fastapi', 'spring', 'springboot',
                                        'ruby', 'rails', 'golang', 'gin', 'fiber',
                                        'rust', 'actix', 'axum', 'php', 'laravel',
                                        'api', 'rest', 'restful', 'graphql', 'grpc', 'websocket', 'webhook',
                                        'backend', 'back-end', 'server', 'microservice', 'middleware',
                                        'authentication', 'jwt', 'oauth', 'session', 'passport',
                                        'serverless', 'lambda', 'edge function',
                                        'mcp', 'mcp server', 'model context protocol',
                                        'asp.net', 'aspnet', 'dotnet', 'csharp',
                                        '后端', '後端', '服务端', '伺服端', '接口', '中间件', '中介層', '服务', '服務'
                                    ]
                                },
                                {
                                    key: 'smart.mobile',
                                    minScore: 3,
                                    keywords: [
                                        'mobile', 'ios', 'android', 'react native', 'expo', 'flutter', 'dart',
                                        'swift', 'swiftui', 'objective-c', 'kotlin', 'jetpack compose',
                                        'xcode', 'android studio', 'apk', 'ipa', 'app store', 'play store',
                                        'tablet', 'phone app',
                                        '移动端', '移動端', '移动开发', '行動開發', '安卓', '苹果', '蘋果'
                                    ]
                                },
                                {
                                    key: 'smart.data',
                                    minScore: 3,
                                    keywords: [
                                        'data pipeline', 'etl', 'elt', 'analytics', 'analyst',
                                        'business intelligence', 'warehouse', 'data warehouse', 'lakehouse',
                                        'bigquery', 'snowflake', 'redshift', 'spark', 'hadoop', 'airflow', 'dbt',
                                        'dataset', 'dataframe', 'parquet', 'tableau', 'power bi', 'metabase',
                                        'pandas', 'numpy', 'jupyter', 'notebook', 'ipynb', 'metrics', 'kpi',
                                        '数据分析', '數據分析', '数据管道', '數據管道', '报表', '報表', '指标', '指標'
                                    ]
                                },
                                {
                                    key: 'smart.database',
                                    minScore: 3,
                                    keywords: [
                                        'database', 'databases', 'sql', 'query', 'queries', 'schema', 'index',
                                        'postgres', 'postgresql', 'mysql', 'sqlite', 'mariadb', 'mongodb',
                                        'redis', 'elasticsearch', 'dynamodb', 'supabase', 'firebase',
                                        'orm', 'prisma', 'sequelize', 'typeorm', 'drizzle', 'migration',
                                        'sqlalchemy', 'vector database', 'pinecone', 'weaviate', 'qdrant', 'milvus',
                                        '数据库', '資料庫', '查询', '查詢', '索引', '迁移', '遷移'
                                    ]
                                },
                                {
                                    key: 'smart.design',
                                    minScore: 3,
                                    keywords: [
                                        'design', 'designer', 'ui design', 'ux design', 'ui/ux',
                                        'figma', 'sketch', 'adobe', 'photoshop', 'illustrator',
                                        'icon', 'logo', 'banner', 'poster', 'motion', 'animation',
                                        'art', 'artwork', 'generative art', 'algorithmic art', 'creative coding',
                                        'asset', 'sprite', 'texture', 'mockup', 'wireframe', 'prototype',
                                        'theme', 'color', 'palette', 'typography', 'font', 'brand',
                                        'game', 'game dev', 'game design',
                                        '设计', '設計', '图片', '圖片', '视觉', '視覺', '视频', '影片',
                                        '美学', '美學', '画', '畫', '图标', '圖標', '动画', '動畫',
                                        '海报', '海報', '游戏', '遊戲', '创意', '創意', '品牌', '主题', '主題'
                                    ]
                                },
                                {
                                    key: 'smart.docs',
                                    minScore: 3,
                                    keywords: [
                                        'document', 'documentation', 'docs',
                                        'writing', 'writer', 'draft', 'proofread', 'humanize', 'rewrite',
                                        'readme', 'changelog', 'wiki', 'guide', 'manual', 'tutorial', 'reference',
                                        'article', 'blog', 'content writing',
                                        'report', 'specification', 'rfc',
                                        'slide', 'presentation', 'deck',
                                        'docx', 'xlsx', 'pptx', 'pdf', 'csv', 'markdown',
                                        'spreadsheet', 'excel', 'word', 'powerpoint',
                                        'screenplay', 'storyline',
                                        '文档', '文件', '写作', '寫作', '文案', '文章',
                                        '报告', '報告', '剧本', '劇本', '提案', '规范', '規範',
                                        '演示', '簡報', '幻灯片', '幻燈片', '电子表格', '電子表格',
                                        '漫剧', '连载', '連載', '小说', '小說'
                                    ]
                                },
                                {
                                    key: 'smart.automation',
                                    minScore: 3,
                                    keywords: [
                                        'automation', 'automate', 'workflow automation', 'bot', 'bots',
                                        'orchestration', 'orchestrate', 'scheduler', 'scheduled', 'cron',
                                        'job runner', 'batch job', 'trigger', 'macro', 'repetitive task',
                                        'n8n', 'zapier', 'make.com', 'ifttt', 'workflow engine',
                                        '自动化', '自動化', '调度', '調度', '编排', '編排', '机器人', '機器人'
                                    ]
                                },
                                {
                                    key: 'smart.collab',
                                    minScore: 3,
                                    keywords: [
                                        'slack', 'discord', 'teams', 'zoom',
                                        'notion', 'confluence', 'jira', 'linear', 'trello', 'asana',
                                        'meeting', 'agenda', 'standup', 'retrospective',
                                        'collaboration', 'project management',
                                        'pull request', 'code review', 'merge request',
                                        'issue', 'ticket', 'kanban', 'scrum', 'agile', 'stakeholder sync',
                                        '协作', '協作', '沟通', '溝通', '会议', '會議',
                                        '项目管理', '專案管理', '代码审查', '程式碼審查'
                                    ]
                                },
                                {
                                    key: 'smart.product',
                                    minScore: 3,
                                    keywords: [
                                        'product', 'prd', 'roadmap', 'requirements', 'requirement',
                                        'user story', 'acceptance criteria', 'backlog', 'prioritization',
                                        'feature brief', 'release plan', 'milestone', 'product strategy',
                                        '产品', '產品', '路线图', '路線圖', '需求', '用户故事', '使用者故事', '验收标准', '驗收標準'
                                    ]
                                },
                                {
                                    key: 'smart.research',
                                    minScore: 3,
                                    keywords: [
                                        'research', 'researcher', 'paper', 'arxiv', 'literature review',
                                        'benchmark', 'evaluation', 'evaluate', 'experiment', 'survey',
                                        'comparison', 'compare', 'feasibility', 'investigate', 'discovery',
                                        'competitive analysis', 'market research',
                                        '研究', '调研', '調研', '论文', '論文', '评估', '評估', '实验', '實驗', '对比', '對比'
                                    ]
                                },
                                {
                                    key: 'smart.localization',
                                    minScore: 3,
                                    keywords: [
                                        'translate', 'translation', 'translator', 'localization', 'localisation',
                                        'i18n', 'l10n', 'locale', 'multilingual', 'glossary', 'subtitle',
                                        'transcreation', 'bilingual',
                                        '翻译', '翻譯', '本地化', '在地化', '多语言', '多語言', '术语', '術語', '字幕'
                                    ]
                                },
                                {
                                    key: 'smart.business',
                                    minScore: 3,
                                    keywords: [
                                        'business', 'marketing', 'growth', 'sales', 'crm', 'seo', 'sem',
                                        'campaign', 'customer', 'client', 'lead', 'funnel', 'pricing',
                                        'internal comms', 'stakeholder update', 'bizops', 'business operations', 'support',
                                        'commercial', 'go-to-market',
                                        '商业', '商業', '营销', '行销', '增长', '增長', '销售', '銷售', '客户', '客戶', '内宣', '內宣'
                                    ]
                                },
                                {
                                    key: 'smart.utilities',
                                    minScore: 3,
                                    keywords: [
                                        'utils', 'utility', 'utilities',
                                        'toolkit', 'toolbox', 'helper', 'snippet',
                                        'regex', 'regexp', 'regular expression',
                                        'bash', 'shell', 'zsh', 'terminal', 'cli', 'command line',
                                        'config', 'configuration', 'settings', 'preferences',
                                        'migration', 'conversion', 'transform', 'parser', 'formatter',
                                        'file system', 'directory', 'path', 'boilerplate', 'scaffold',
                                        'rule', 'cursor rule', 'skill creator',
                                        '工具', '脚本', '腳本', '正则', '正則', '辅助', '輔助',
                                        '命令行', '终端', '終端', '配置', '設定'
                                    ]
                                }
                            ];
                            var updated = 0;
                            var updates = [];
                            skills.forEach(function(skill) {
                                if (isUngrouped(skill.group)) {
                                    var nameDesc = (skill.name + ' ' + (skill.description || '')).toLowerCase();
                                    var body = (skill.content || '').toLowerCase();
                                    var bestMatch = null;
                                    var secondBestScore = 0;
                                    categoryConfigs.forEach(function(category) {
                                        var score = 0;
                                        category.keywords.forEach(function(kw) {
                                            score += kwCount(nameDesc, kw) * 5 + kwCount(body, kw);
                                        });
                                        if (!bestMatch || score > bestMatch.score) {
                                            secondBestScore = bestMatch ? Math.max(secondBestScore, bestMatch.score) : secondBestScore;
                                            bestMatch = { key: category.key, score: score, minScore: category.minScore || 2 };
                                        } else if (score > secondBestScore) {
                                            secondBestScore = score;
                                        }
                                    });
                                    var confidenceGap = bestMatch && bestMatch.score >= 12 ? 1 : 2;
                                    if (bestMatch && bestMatch.score >= bestMatch.minScore && bestMatch.score >= secondBestScore + confidenceGap) {
                                        skill.group = bestMatch.key;
                                        updates.push({ skillPath: skill.path, group: bestMatch.key });
                                        updated++;
                                    }
                                }
                            });
                            if (updated > 0) {
                                const updatesByGroup = {};
                                updates.forEach(function(update) {
                                    if (!updatesByGroup[update.group]) updatesByGroup[update.group] = [];
                                    updatesByGroup[update.group].push(update.skillPath);
                                });
                                Object.keys(updatesByGroup).forEach(function(groupName) {
                                    moveSkillBatch(updatesByGroup[groupName], { kind: 'group-boundary', groupName: groupName, position: 'end', newGroup: groupName });
                                });
                                renderList();
                                commitLayout(updates);
                                vscode.postMessage({ command: 'showInfo', text: (t.smartGroupSuccess || 'Successfully grouped {0} skills!').replace('{0}', updated) });
                            } else {
                                vscode.postMessage({ command: 'showInfo', text: t.noUngrouped || 'No ungrouped skills to process.' });
                            }
                        });
                    }

                    // New skill button
                    if (newSkillBtn && createModal && newSkillInput) {
                        newSkillBtn.addEventListener('click', () => { createModal.classList.add('active'); newSkillInput.value = ''; document.getElementById('newSkillDesc').value = ''; document.getElementById('newSkillBody').value = ''; setTimeout(() => newSkillInput.focus(), 100); });
                    }
                    function closeCreateModal() { if (createModal) createModal.classList.remove('active'); }
                    document.getElementById('cancelCreateBtn').addEventListener('click', closeCreateModal);
                    if (createModal) {
                        createModal.addEventListener('click', (e) => { if (e.target === createModal) closeCreateModal(); });
                    }
                    function createSkill() {
                        const val = newSkillInput.value.trim(); if (!val) { newSkillInput.focus(); return; }
                        const desc = document.getElementById('newSkillDesc').value.trim();
                        const body = document.getElementById('newSkillBody').value;
                        let isGlobal = true; const radios = document.getElementsByName('skillType'); for (const r of radios) { if (r.checked && r.value === 'project') isGlobal = false; }
                        vscode.postMessage({ command: 'createSkill', skillName: val, isGlobal, description: desc, body: body }); closeCreateModal();
                    }
                    document.getElementById('confirmCreateBtn').addEventListener('click', createSkill);
                    if (newSkillInput) {
                        newSkillInput.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeCreateModal(); });
                    }

                    // Clear selection
                    clearBtn.addEventListener('click', () => { clearAtSelection(); refreshListAndEditor(); _flushClipboard(); });

                    // Context menus
                    const ctxMenu = document.getElementById('ctxMenu');
                    const groupCtxMenu = document.getElementById('groupCtxMenu');
                    let ctxSkillIndex = -1;
                    let ctxGroupName = null;
                    const emptyCtxMenu = document.getElementById('emptyCtxMenu');
                    function hideCtxMenus() {
                        ctxMenu.classList.remove('active');
                        groupCtxMenu.classList.remove('active');
                        emptyCtxMenu.classList.remove('active');
                    }
                    function showCtxMenu(menuEl, x, y) {
                        menuEl.style.display = 'block';
                        const menuWidth = menuEl.offsetWidth;
                        const menuHeight = menuEl.offsetHeight;
                        menuEl.style.display = '';
                        let left = x;
                        let top = y;
                        if (left + menuWidth > window.innerWidth) left = window.innerWidth - menuWidth;
                        if (top + menuHeight > window.innerHeight) top = window.innerHeight - menuHeight;
                        menuEl.style.left = Math.max(0, left) + 'px';
                        menuEl.style.top = Math.max(0, top) + 'px';
                        menuEl.classList.add('active');
                    }
                    function getContextSkillTargets(options) {
                        const opts = options || {};
                        const clickedSkill = skills[ctxSkillIndex];
                        if (!clickedSkill) return [];
                        const selectedTargets = getSelectedSkills();
                        let targets = (selectedTargets.length > 1 && selectedSkills.has(clickedSkill.path))
                            ? selectedTargets
                            : [clickedSkill];
                        if (opts.groupedOnly) {
                            targets = targets.filter(function(skill) { return !isUngrouped(skill.group); });
                        }
                        return targets;
                    }
                    function removeRecentSkillPaths(paths) {
                        const removeSet = new Set((paths || []).filter(Boolean));
                        if (removeSet.size === 0) return;
                        const nextRecentPaths = recentSkillPaths.filter(function(path) {
                            return !removeSet.has(path);
                        });
                        if (nextRecentPaths.length === recentSkillPaths.length) return;
                        recentSkillPaths = nextRecentPaths;
                        vscode.postMessage({ command: 'saveRecentSkills', recentSkills: recentSkillPaths.slice() });
                    }
                    function getOrderedGroupNames(groupNames) {
                        const groupSet = new Set((groupNames || []).filter(Boolean));
                        if (groupSet.size === 0) return [];
                        const ordered = Array.from(topLevelOrder)
                            .filter(function(token) { return token.startsWith('group:') && groupSet.has(token.slice(6)); })
                            .map(function(token) { return token.slice(6); });
                        const seen = new Set(ordered);
                        groupSet.forEach(function(groupName) {
                            if (!seen.has(groupName)) ordered.push(groupName);
                        });
                        return ordered;
                    }
                    function getContextGroupTargets() {
                        if (!ctxGroupName || isUngrouped(ctxGroupName)) return [];
                        if (selectedGroups.size > 1 && selectedGroups.has(ctxGroupName)) {
                            return getOrderedGroupNames(Array.from(selectedGroups));
                        }
                        return [ctxGroupName];
                    }
                    skillList.addEventListener('contextmenu', (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        hideCtxMenus();
                        const skillTarget = e.target.closest('.skill-item');
                        const groupHeaderTarget = e.target.closest('.group-header');
                        if (skillTarget) {
                            ctxSkillIndex = parseInt(skillTarget.getAttribute('data-index'));
                            var clickedSkill = skills[ctxSkillIndex];
                            var skillSelectionChanged = false;
                            if (selectedGroups.size > 0) {
                                clearGroupSelection();
                                skillSelectionChanged = true;
                            }
                            if (clickedSkill) {
                                const keepExistingSkillSelection = selectedSkills.size > 1 && selectedSkills.has(clickedSkill.path);
                                if (!keepExistingSkillSelection) {
                                    const alreadyOnlyClickedSkill = selectedSkills.size === 1 && selectedSkills.has(clickedSkill.path);
                                    if (!alreadyOnlyClickedSkill) {
                                        selectedSkills.clear();
                                        selectedSkills.add(clickedSkill.path);
                                        skillSelectionChanged = true;
                                    }
                                }
                            } else if (selectedSkills.size > 0) {
                                selectedSkills.clear();
                                skillSelectionChanged = true;
                            }
                            if (skillSelectionChanged) {
                                renderList();
                            }
                            var removeBtn = document.getElementById('ctxRemoveFromGroup');
                            var renameBtn = document.getElementById('ctxRename');
                            var changeGroupBtn = document.getElementById('ctxChangeGroup');
                            var newGroupBtn = document.getElementById('ctxNewGroupSkill');
                            var hideFromRecentBtn = document.getElementById('ctxHideFromRecent');
                            var openInFinderBtn = document.getElementById('ctxOpenInFinder');
                            var favSelectedBtn = document.getElementById('ctxFavSelected');
                            var unfavSelectedBtn = document.getElementById('ctxUnfavSelected');
                            var isRecentView = filterType === 'recent';


                            var contextTargets = getContextSkillTargets();
                            var allFavorited = contextTargets.length > 0 && contextTargets.every(function(skill) {
                                return favoritePaths.has(skill.path);
                            });
                            if (changeGroupBtn) changeGroupBtn.style.display = isRecentView ? 'none' : 'flex';
                            if (newGroupBtn) newGroupBtn.style.display = isRecentView ? 'none' : 'flex';
                            if (removeBtn) {
                                var hasGrouped = !isRecentView && getContextSkillTargets({ groupedOnly: true }).length > 0;
                                removeBtn.style.display = hasGrouped ? 'flex' : 'none';
                            }
                            if (hideFromRecentBtn) hideFromRecentBtn.style.display = isRecentView ? 'flex' : 'none';
                            if (openInFinderBtn) openInFinderBtn.style.display = (contextTargets.length > 1) ? 'none' : 'flex';
                            if (favSelectedBtn) favSelectedBtn.style.display = allFavorited ? 'none' : 'flex';
                            if (unfavSelectedBtn) unfavSelectedBtn.style.display = allFavorited ? 'flex' : 'none';
                            if (renameBtn) renameBtn.style.display = (contextTargets.length > 1) ? 'none' : 'flex';


                            showCtxMenu(ctxMenu, e.clientX, e.clientY);
                            return;
                        }
                        if (groupHeaderTarget) {
                            ctxGroupName = groupHeaderTarget.parentElement.getAttribute('data-group');
                            if (isUngrouped(ctxGroupName)) return;
                            var groupSelectionChanged = false;
                            if (selectedSkills.size > 0) {
                                selectedSkills.clear();
                                groupSelectionChanged = true;
                            }
                            const keepExistingGroupSelection = selectedGroups.size > 1 && selectedGroups.has(ctxGroupName);
                            const alreadyOnlyClickedGroup = selectedGroups.size === 1 && selectedGroups.has(ctxGroupName);
                            if (!keepExistingGroupSelection && !alreadyOnlyClickedGroup) {
                                clearGroupSelection();
                                selectedGroups.add(ctxGroupName);
                                lastSelectedGroupName = ctxGroupName;
                                groupSelectionChanged = true;
                            }
                            if (groupSelectionChanged) {
                                renderList();
                            }
                            var contextGroupTargets = getContextGroupTargets();
                            var contextGroupSet = new Set(contextGroupTargets);
                            var groupSkillCount = skills.filter(function(s) { return contextGroupSet.has(s.group); }).length;
                            var renameGroupBtn = document.getElementById('ctxRenameGroup');
                            var dissolveBtn = document.getElementById('ctxDissolveGroup');
                            var deleteGroupBtn = document.getElementById('ctxDeleteGroup');

                            if (renameGroupBtn) renameGroupBtn.style.display = contextGroupTargets.length > 1 ? 'none' : 'flex';
                            if (dissolveBtn) {
                                var span = dissolveBtn.querySelector('span');
                                if (groupSkillCount === 0) {
                                    dissolveBtn.style.display = 'none';
                                } else {
                                    dissolveBtn.style.display = 'flex';
                                    if (span) span.textContent = contextGroupTargets.length > 1
                                        ? (t.dissolveGroupsBtn || t.dissolveGroupBtn || 'Dissolve Groups')
                                        : (t.dissolveGroupBtn || 'Ungroup All');
                                }
                            }
                            if (deleteGroupBtn) {
                                var deleteSpan = deleteGroupBtn.querySelector('span');
                                if (deleteSpan) {
                                    deleteSpan.textContent = contextGroupTargets.length > 1
                                        ? (t.deleteGroupsBtn || t.deleteGroupBtn || 'Delete Groups')
                                        : (t.deleteGroupBtn || 'Delete Group');
                                }
                                deleteGroupBtn.style.display = 'flex';
                            }
                            showCtxMenu(groupCtxMenu, e.clientX, e.clientY);
                            return;
                        }
                        showCtxMenu(emptyCtxMenu, e.clientX, e.clientY);
                    });
                    document.addEventListener('click', hideCtxMenus);
                    document.getElementById('sidebar').addEventListener('contextmenu', (e) => {
                        if (e.target.closest('#skillList') || e.target.closest('.context-menu')) return;
                        if (e.target.closest('.skill-item') || e.target.closest('.group-header')) return;
                        e.preventDefault();
                        e.stopPropagation();
                        hideCtxMenus();
                        showCtxMenu(emptyCtxMenu, e.clientX, e.clientY);
                    });

                    document.getElementById('ctxRename').addEventListener('click', (e) => { e.stopPropagation(); hideCtxMenus(); const skill = skills[ctxSkillIndex]; if (!skill) return; document.getElementById('renameSkillInput').value = skill.displayName || skill.name; pendingRenameSkillPath = skill.path; document.getElementById('renameModal').classList.add('active'); setTimeout(() => { document.getElementById('renameSkillInput').focus(); document.getElementById('renameSkillInput').select(); }, 150); });
                    document.getElementById('ctxOpenInFinder').addEventListener('click', () => {
                        hideCtxMenus();
                        const skill = skills[ctxSkillIndex];
                        if (!skill) return;
                        vscode.postMessage({ command: 'openInFinder', skillPath: skill.path });
                    });

                    document.getElementById('ctxDelete').addEventListener('click', () => {
                        hideCtxMenus();
                        var targets = getContextSkillTargets();
                        if (targets.length === 0) return;
                        showConfirm(t.deleteConfirmTitle, t.deleteMsg, () => {
                            if (targets.length === 1) {
                                vscode.postMessage({ command: 'deleteSkill', skillPath: targets[0].path });
                            } else {
                                vscode.postMessage({ command: 'deleteSkills', skillPaths: targets.map(function(sk) { return sk.path; }) });
                            }
                        }, true);
                    });
                    document.getElementById('ctxChangeGroup').addEventListener('click', (e) => {
                        e.stopPropagation();
                        hideCtxMenus();
                        var targets = getContextSkillTargets();
                        if (targets.length === 0) return;
                        pendingGroupSkillPaths = targets.map(function(s) { return s.path; });
                        const changeGroupInput = document.getElementById('changeGroupInput');
                        const changeGroupSelect = document.getElementById('changeGroupSelect');
                        const currentGroup = (targets.length === 1 && !isUngrouped(targets[0].group)) ? targets[0].group : '';

                        let groupsSet = new Set();
                        skills.forEach(s => {
                            if (!isUngrouped(s.group)) groupsSet.add(s.group);
                        });
                        manualEmptyGroups.forEach(g => {
                            if (!isUngrouped(g)) groupsSet.add(g);
                        });
                        const groupOptions = ['<option value="">' + escHtml(t.groupCustomOption || 'Custom group') + '</option>']
                            .concat(Array.from(groupsSet).sort((a, b) => getGroupLabel(a).localeCompare(getGroupLabel(b))).map(g => {
                                return '<option value="' + escHtml(g) + '">' + escHtml(getGroupLabel(g)) + '</option>';
                            }));
                        changeGroupSelect.innerHTML = groupOptions.join('');

                        if (currentGroup && groupsSet.has(currentGroup)) {
                            changeGroupSelect.value = currentGroup;
                            changeGroupInput.value = isBuiltInGroup(currentGroup) ? '' : currentGroup;
                            changeGroupInput.style.display = 'none';
                        } else {
                            changeGroupSelect.value = '';
                            changeGroupInput.value = currentGroup;
                            changeGroupInput.style.display = 'block';
                        }

                        document.getElementById('changeGroupModal').classList.add('active');
                        setTimeout(() => {
                            if (changeGroupInput.value) {
                                changeGroupInput.focus();
                                changeGroupInput.select();
                            } else {
                                changeGroupSelect.focus();
                            }
                        }, 150);
                    });
                    document.getElementById('ctxRemoveFromGroup').addEventListener('click', () => {
                        hideCtxMenus();
                        var targets = getContextSkillTargets({ groupedOnly: true });
                        if (targets.length === 0) return;
                        var paths = targets.map(function(s) { return s.path; });
                        var updates = paths.map(function(p) { return { skillPath: p, group: '' }; });
                        moveSkillPathsToUngrouped(paths);
                        refreshListAndEditor();
                        commitLayout(updates);
                    });
                    document.getElementById('ctxHideFromRecent').addEventListener('click', () => {
                        hideCtxMenus();
                        var targets = getContextSkillTargets();
                        if (targets.length === 0) return;
                        removeRecentSkillPaths(targets.map(function(s) { return s.path; }));
                        refreshListAndEditor();
                    });

                    // Change Group modal
                    let pendingGroupSkillPaths = null;
                    function closeGroupModal() { document.getElementById('changeGroupModal').classList.remove('active'); pendingGroupSkillPaths = null; }
                    document.getElementById('cancelGroupBtn').addEventListener('click', closeGroupModal);
                    document.getElementById('changeGroupModal').addEventListener('click', (e) => { if (e.target === document.getElementById('changeGroupModal')) closeGroupModal(); });
                    const changeGroupSelect = document.getElementById('changeGroupSelect');
                    const changeGroupInput = document.getElementById('changeGroupInput');
                    changeGroupSelect.addEventListener('change', () => {
                        if (changeGroupSelect.value) {
                            const isCustom = changeGroupSelect.value === '';
                            changeGroupInput.style.display = isCustom ? 'block' : 'none';
                            changeGroupInput.value = isBuiltInGroup(changeGroupSelect.value) ? '' : changeGroupSelect.value;
                            if (isCustom) changeGroupInput.focus();
                        } else {
                            changeGroupInput.style.display = 'block';
                            changeGroupInput.focus();
                        }
                    });
                    document.getElementById('confirmGroupBtn').addEventListener('click', () => { 
                        if (!pendingGroupSkillPaths || pendingGroupSkillPaths.length === 0) return; 
                        let ng = changeGroupInput.value.trim() || changeGroupSelect.value.trim(); 
                        if (!ng) ng = '';
                        const allAlreadyInGroup = pendingGroupSkillPaths.every(function(path) {
                            const sk = skills.find(function(skill) { return skill.path === path; });
                            return (sk ? (sk.group || '') : '') === ng;
                        });
                        if (allAlreadyInGroup) {
                            closeGroupModal();
                            return;
                        }
                        let moveResult;
                        if (isUngrouped(ng)) {
                            moveResult = moveSkillBatch(pendingGroupSkillPaths, { kind: 'bottom', newGroup: '' });
                        } else {
                            const targetExists = skills.some(function(skill) {
                                return skill.group === ng && pendingGroupSkillPaths.indexOf(skill.path) === -1;
                            });
                            if (targetExists) {
                                moveResult = moveSkillBatch(pendingGroupSkillPaths, { kind: 'group-boundary', groupName: ng, position: 'end', newGroup: ng });
                            } else {
                                const firstIndex = moveSkillBatch(pendingGroupSkillPaths, { kind: 'index', index: skills.findIndex(function(skill) { return pendingGroupSkillPaths.indexOf(skill.path) !== -1; }), newGroup: ng });
                                moveResult = firstIndex;
                            }
                        }
                        const updates = getGroupChangeUpdates(moveResult.movedPaths, ng, moveResult.originalGroups || {});
                        refreshListAndEditor();
                        commitLayout(updates);
                        closeGroupModal(); 
                    });
                    document.getElementById('changeGroupInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); document.getElementById('confirmGroupBtn').click(); } if (e.key === 'Escape') closeGroupModal(); });
                    document.getElementById('changeGroupSelect').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); document.getElementById('confirmGroupBtn').click(); } if (e.key === 'Escape') closeGroupModal(); });

                    // Group menu actions
                    let pendingRenameGroupName = null;
                    function closeRenameGroupModal() {
                        document.getElementById('renameGroupModal').classList.remove('active');
                        pendingRenameGroupName = null;
                    }
                    document.getElementById('ctxRenameGroup').addEventListener('click', () => {
                        hideCtxMenus();
                        const targetGroupNames = getContextGroupTargets();
                        if (targetGroupNames.length !== 1) return;
                        pendingRenameGroupName = targetGroupNames[0];
                        const renameGroupInput = document.getElementById('renameGroupInput');
                        renameGroupInput.value = isBuiltInGroup(pendingRenameGroupName) ? '' : pendingRenameGroupName;
                        document.getElementById('renameGroupModal').classList.add('active');
                        setTimeout(() => {
                            renameGroupInput.focus();
                            renameGroupInput.select();
                        }, 150);
                    });
                    document.getElementById('ctxDissolveGroup').addEventListener('click', () => {
                        hideCtxMenus();
                        const targetGroupNames = getContextGroupTargets();
                        if (targetGroupNames.length === 0) return;
                        const targetGroupSet = new Set(targetGroupNames);
                        const targetSkills = skills.filter(function(skill) { return targetGroupSet.has(skill.group); });
                        const orderedTargetSkillPaths = getOrderedSkillPaths(targetSkills.map(function(skill) { return skill.path; }));
                        if (targetSkills.length === 0) {
                            manualEmptyGroups = manualEmptyGroups.filter(function(groupName) { return !targetGroupSet.has(groupName); });
                            targetGroupNames.forEach(function(groupName) { collapsedGroups.delete(groupName); });
                            clearGroupSelection();
                            vscode.postMessage({ command: 'saveCollapsedGroups', collapsedGroups: Array.from(collapsedGroups) });
                            renderList();
                            persistOrdering();
                            return;
                        }
                        const dissolveTitle = targetGroupNames.length > 1
                            ? (t.dissolveGroupsTitle || t.dissolveGroupTitle || 'Dissolve Groups')
                            : (t.dissolveGroupTitle || 'Dissolve Group');
                        const dissolveMsg = targetGroupNames.length > 1
                            ? (t.dissolveGroupsMsg || t.dissolveGroupMsg || 'Move all skills out of these groups?')
                            : (t.dissolveGroupMsg || 'Move all skills out of this group?');
                        showConfirm(dissolveTitle, dissolveMsg, () => {
                            const updates = orderedTargetSkillPaths.map(function(skillPath) { return { skillPath: skillPath, group: '' }; });
                            moveSkillPathsToUngrouped(orderedTargetSkillPaths);
                            manualEmptyGroups = manualEmptyGroups.filter(function(groupName) { return !targetGroupSet.has(groupName); });
                            targetGroupNames.forEach(function(groupName) { collapsedGroups.delete(groupName); });
                            clearGroupSelection();
                            vscode.postMessage({ command: 'saveCollapsedGroups', collapsedGroups: Array.from(collapsedGroups) });
                            refreshListAndEditor();
                            commitLayout(updates);
                        }, true);
                    });

                    const deleteGroupBtnEl = document.getElementById('ctxDeleteGroup');
                    if (deleteGroupBtnEl) {
                        deleteGroupBtnEl.addEventListener('click', () => {
                            hideCtxMenus();
                            const targetGroupNames = getContextGroupTargets();
                            if (targetGroupNames.length === 0) return;
                            const targetGroupSet = new Set(targetGroupNames);
                            const targetSkills = skills.filter(function(skill) { return targetGroupSet.has(skill.group); });

                            const deleteTitle = targetGroupNames.length > 1
                                ? (t.deleteGroupsBtn || t.deleteGroupBtn || 'Delete Groups')
                                : (t.deleteGroupBtn || 'Delete Group');
                            const deleteMsg = targetGroupNames.length > 1
                                ? (t.deleteGroupsMsg || 'Are you sure you want to completely delete these groups and ALL their skills? This cannot be undone.')
                                : (t.deleteGroupMsg || 'Are you sure you want to completely delete this group and ALL its skills? This cannot be undone.');

                            showConfirm(deleteTitle, deleteMsg, () => {
                                manualEmptyGroups = manualEmptyGroups.filter(function(groupName) { return !targetGroupSet.has(groupName); });
                                targetGroupNames.forEach(function(groupName) { collapsedGroups.delete(groupName); });
                                clearGroupSelection();
                                vscode.postMessage({ command: 'saveCollapsedGroups', collapsedGroups: Array.from(collapsedGroups) });

                                if (targetSkills.length > 0) {
                                    vscode.postMessage({ command: 'deleteSkills', skillPaths: targetSkills.map(function(sk) { return sk.path; }) });
                                }
                                renderList();
                                persistOrdering();
                            }, true);
                        });
                    }

                    document.getElementById('cancelRenameGroupBtn').addEventListener('click', closeRenameGroupModal);
                    document.getElementById('renameGroupModal').addEventListener('click', (e) => { if (e.target === document.getElementById('renameGroupModal')) closeRenameGroupModal(); });
                    document.getElementById('confirmRenameGroupBtn').addEventListener('click', () => {
                        if (!pendingRenameGroupName) return;
                        const newGroupName = document.getElementById('renameGroupInput').value.trim();
                        if (!newGroupName) return;
                        const targetSkills = skills.filter(s => s.group === pendingRenameGroupName);
                        manualEmptyGroups = manualEmptyGroups.map(function(groupName) {
                            return groupName === pendingRenameGroupName ? newGroupName : groupName;
                        });
                        if (collapsedGroups.has(pendingRenameGroupName)) {
                            collapsedGroups.delete(pendingRenameGroupName);
                            collapsedGroups.add(newGroupName);
                            vscode.postMessage({ command: 'saveCollapsedGroups', collapsedGroups: Array.from(collapsedGroups) });
                        }
                        renameTopLevelGroup(pendingRenameGroupName, newGroupName);
                        if (targetSkills.length === 0) {
                            refreshListAndEditor();
                            commitLayout({ topLevelOrder: topLevelOrder.slice() });
                            closeRenameGroupModal();
                            return;
                        }
                        const updates = targetSkills.map(s => ({ skillPath: s.path, group: newGroupName }));
                        targetSkills.forEach(s => { s.group = newGroupName; });
                        refreshListAndEditor();
                        commitLayout({ updates: updates, topLevelOrder: topLevelOrder.slice() });
                        closeRenameGroupModal();
                    });
                    document.getElementById('renameGroupInput').addEventListener('keydown', (e) => {
                        if (e.key === 'Enter') { e.preventDefault(); document.getElementById('confirmRenameGroupBtn').click(); }
                        if (e.key === 'Escape') closeRenameGroupModal();
                    });

                    // New Group modal
                    let newGroupSourcePaths = [];
                    function closeNewGroupModal() { document.getElementById('newGroupModal').classList.remove('active'); newGroupSourcePaths = []; }
                    document.getElementById('cancelNewGroupBtn').addEventListener('click', closeNewGroupModal);
                    document.getElementById('newGroupModal').addEventListener('click', (e) => { if (e.target === document.getElementById('newGroupModal')) closeNewGroupModal(); });
                    function openNewGroupModal(skillPaths) {
                        newGroupSourcePaths = skillPaths || [];
                        document.getElementById('newGroupInput').value = '';
                        document.getElementById('newGroupModal').classList.add('active');
                        setTimeout(() => { document.getElementById('newGroupInput').focus(); }, 150);
                    }
                    document.getElementById('confirmNewGroupBtn').addEventListener('click', () => {
                        var gName = document.getElementById('newGroupInput').value.trim();
                        if (!gName) return;
                        let updates = [];
                        if (newGroupSourcePaths.length > 0) {
                            const firstIndex = skills.findIndex(function(skill) { return newGroupSourcePaths.indexOf(skill.path) !== -1; });
                            const moveResult = moveSkillBatch(newGroupSourcePaths, { kind: 'index', index: firstIndex, newGroup: gName });
                            updates = getGroupChangeUpdates(moveResult.movedPaths, gName, moveResult.originalGroups || {});
                        } else {
                            if (manualEmptyGroups.indexOf(gName) === -1) manualEmptyGroups.push(gName);
                        }
                        refreshListAndEditor();
                        if (updates.length > 0) commitLayout(updates);
                        else persistOrdering();
                        closeNewGroupModal();
                    });
                    document.getElementById('newGroupInput').addEventListener('keydown', (e) => {
                        if (e.key === 'Enter') { e.preventDefault(); document.getElementById('confirmNewGroupBtn').click(); }
                        if (e.key === 'Escape') closeNewGroupModal();
                    });
                    document.getElementById('ctxNewGroupEmpty').addEventListener('click', () => { hideCtxMenus(); openNewGroupModal([]); });
                    document.getElementById('ctxNewGroupSkill').addEventListener('click', () => {
                        hideCtxMenus();
                        var targets = getContextSkillTargets();
                        openNewGroupModal(targets.map(function(s) { return s.path; }));
                    });

                    document.getElementById('ctxFavSelected').addEventListener('click', () => {
                        hideCtxMenus();
                        var targets = getContextSkillTargets();
                        if (targets.length === 0) return;
                        targets.forEach(s => favoritePaths.add(s.path));
                        vscode.postMessage({ command: 'saveFavorites', favorites: Array.from(favoritePaths) });
                        refreshListAndEditor();
                    });

                    document.getElementById('ctxUnfavSelected').addEventListener('click', () => {
                        hideCtxMenus();
                        var targets = getContextSkillTargets();
                        if (targets.length === 0) return;
                        targets.forEach(s => favoritePaths.delete(s.path));
                        vscode.postMessage({ command: 'saveFavorites', favorites: Array.from(favoritePaths) });
                        refreshListAndEditor();
                    });

                    // Rename modal
                    let pendingRenameSkillPath = null;
                    function closeRenameModal() { document.getElementById('renameModal').classList.remove('active'); pendingRenameSkillPath = null; }
                    document.getElementById('cancelRenameBtn').addEventListener('click', closeRenameModal);
                    document.getElementById('renameModal').addEventListener('click', (e) => { if (e.target === document.getElementById('renameModal')) closeRenameModal(); });
                    document.getElementById('confirmRenameBtn').addEventListener('click', () => { if (!pendingRenameSkillPath) return; const nn = document.getElementById('renameSkillInput').value.trim(); if (!nn) return; vscode.postMessage({ command: 'renameSkill', skillPath: pendingRenameSkillPath, newName: nn }); closeRenameModal(); });
                    document.getElementById('renameSkillInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); document.getElementById('confirmRenameBtn').click(); } if (e.key === 'Escape') closeRenameModal(); });

                    // Keyboard shortcuts
                    document.addEventListener('keydown', (e) => {
                        // Cmd/Ctrl+A -> select all (when focus is in list)
                        if ((e.metaKey || e.ctrlKey) && e.key === 'a' && !e.target.closest('textarea') && !e.target.closest('input')) {
                            e.preventDefault();
                            const visiblePaths = getVisibleSkillPaths();
                            if (visiblePaths.length > 0) {
                                clearVisualSelection();
                                selectVisualPaths(visiblePaths, true);
                                lastSelectedPath = visiblePaths[0] || null;
                            }
                            return;
                        }
                        // Cmd/Ctrl+F -> focus search
                        if ((e.metaKey || e.ctrlKey) && e.key === 'f' && searchInput) { e.preventDefault(); searchInput.focus(); searchInput.select(); return; }
                        // Cmd/Ctrl+N -> new skill
                        if ((e.metaKey || e.ctrlKey) && e.key === 'n' && newSkillBtn) { e.preventDefault(); newSkillBtn.click(); return; }
                        // Up/Down arrow in list (only when not in textarea/input)
                        if (!e.target.closest('textarea') && !e.target.closest('input')) {
                            if (e.key === 'ArrowUp' && currentIndex > 0) { e.preventDefault(); clearVisualSelection(); renderEditor(currentIndex - 1); }
                            if (e.key === 'ArrowDown' && currentIndex < skills.length - 1) { e.preventDefault(); clearVisualSelection(); renderEditor(currentIndex + 1); }
                        }
                    });

                    vscode.postMessage({ command: 'requestSkills' });

	                    // Resizer
	                    const resizer = document.getElementById('resizer'); let isResizing = false;
                        let resizeFrame = 0;
                        let resizeAxis = 'x';
                        let pendingSidebarWidth = null;
                        let pendingCompactSidebarHeight = null;
                        function flushSidebarSize() {
                            resizeFrame = 0;
                            if (!sidebarEl) return;
                            if (resizeAxis === 'y') {
                                if (pendingCompactSidebarHeight === null) return;
                                applyCompactSidebarHeight(pendingCompactSidebarHeight);
                                pendingCompactSidebarHeight = null;
                                return;
                            }
                            if (pendingSidebarWidth === null) return;
                            const clampedWidth = clampSidebarWidthValue(pendingSidebarWidth);
                            desktopSidebarWidth = clampedWidth;
                            if (!isCompactLayout()) {
                                sidebarEl.style.width = clampedWidth + 'px';
                            }
                            pendingSidebarWidth = null;
                        }
                        function queueSidebarWidth(nextWidth) {
                            pendingSidebarWidth = nextWidth;
                            if (resizeFrame) return;
                            resizeFrame = requestAnimationFrame(flushSidebarSize);
                        }
                        function queueCompactSidebarHeight(nextHeight) {
                            pendingCompactSidebarHeight = nextHeight;
                            if (resizeFrame) return;
                            resizeFrame = requestAnimationFrame(flushSidebarSize);
                        }
                        function handleMouseMove(e) {
                            if (!isResizing || !sidebarEl) return;
                            if (resizeAxis === 'y') {
                                queueCompactSidebarHeight(e.clientY);
                                return;
                            }
                            queueSidebarWidth(e.clientX);
                        }
                        function stopResizing() {
                            if (!isResizing) return;
                            isResizing = false;
                            if (resizeFrame) {
                                cancelAnimationFrame(resizeFrame);
                                resizeFrame = 0;
                            }
                            if (pendingSidebarWidth !== null || pendingCompactSidebarHeight !== null) flushSidebarSize();
                            resizer.classList.remove('active');
                            document.body.classList.remove('is-resizing');
                            document.body.style.removeProperty('--resizer-cursor');
                            document.body.style.cursor = '';
                            document.documentElement.style.cursor = '';
                            document.removeEventListener('mousemove', handleMouseMove);
                            document.removeEventListener('mouseup', stopResizing);
                            scheduleUiStateSave();
                        }
                        resizer.addEventListener('mousedown', (e) => {
                            if (e.button !== 0) return;
                            e.preventDefault();
                            resizeAxis = isCompactLayout() ? 'y' : 'x';
                            isResizing = true;
                            resizer.classList.add('active');
                            document.body.classList.add('is-resizing');
                            const cursor = resizeAxis === 'y' ? 'row-resize' : 'col-resize';
                            document.body.style.setProperty('--resizer-cursor', cursor);
                            document.body.style.cursor = cursor;
                            document.documentElement.style.cursor = cursor;
                            if (resizeAxis === 'y') {
                                queueCompactSidebarHeight(e.clientY);
                            } else {
                                queueSidebarWidth(e.clientX);
                            }
                            document.addEventListener('mousemove', handleMouseMove, { passive: true });
                            document.addEventListener('mouseup', stopResizing);
                        });
                        window.addEventListener('resize', () => {
                            if (isResizing) return;
                            syncResponsiveSidebar();
                        });
                        syncResponsiveSidebar();

	                    // Smooth Drag Engine
                    let draggedSkillPaths = [];
                    let draggedPrimaryPath = null;
                    let selectedGroups = new Set(); // multi-select groups
                    let lastSelectedGroupName = null;
                    const dragEngine = {
                        isDragging: false,
                        type: null, // 'skill' or 'group'
                        item: null,
                        proxy: null,
                        placeholder: null,
                        startX: 0,
                        startY: 0,
                        offsetX: 0,
                        offsetY: 0,
                        initialRect: null,
                        sourceIndex: -1,
                        sourceGroup: null,
                        targetIndex: -1,
                        targetGroup: null,
                        targetIntent: 'before',
	                        siblings: [],
	                        itemHeights: [],
	                        dragThreshold: 4,
	                        originalParent: null,
                        originalNextSibling: null,
                        groupPlaceholder: null,
	                        originalGroupParent: null,
	                        originalGroupNextSibling: null,
	                        draggedPathSet: new Set(),
	                        draggedCount: 0,
                            pointerX: 0,
                            pointerY: 0,
                            frameHandle: 0,
                            lastResolvedTargetKey: null,

                        init() {
                            skillList.addEventListener('mousedown', (e) => this.onMouseDown(e));
                            document.addEventListener('mousemove', (e) => this.onMouseMove(e), { passive: false });
                            document.addEventListener('mouseup', (e) => this.onMouseUp(e));
                        },
                        applyBatchPeerState() {
                            this.clearBatchPeerState();
                            if (this.type !== 'skill' || this.draggedCount < 2) return;
                            skillList.querySelectorAll('.skill-item').forEach((el) => {
                                const index = parseInt(el.getAttribute('data-index'));
                                const skill = skills[index];
                                if (!skill) return;
                                if (skill.path !== draggedPrimaryPath && this.draggedPathSet.has(skill.path)) {
                                    el.classList.add('drag-batch-peer');
                                }
                            });
                        },
                        clearBatchPeerState() {
                            skillList.querySelectorAll('.drag-batch-peer').forEach((el) => {
                                el.classList.remove('drag-batch-peer');
                            });
                        },
                        getSkillDragProxyIconSvg() {
                            return '<svg width="12" height="12" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">'
                                + '<rect x="2" y="4" width="7" height="7" rx="1.5" stroke="currentColor" stroke-width="1.2"/>'
                                + '<rect x="7" y="2" width="7" height="7" rx="1.5" stroke="currentColor" stroke-width="1.2"/>'
                                + '</svg>';
                        },
                        buildBatchProxy() {
                            const primarySkill = skills.find((skill) => skill.path === draggedPrimaryPath) || skills[this.sourceIndex];
                            const title = escHtml((primarySkill && (primarySkill.displayName || primarySkill.name)) || 'Selected skills');
                            const countLabel = (t.dragBatchLabel || 'Selected {0} skills').replace('{0}', this.draggedCount);
                            const proxy = document.createElement('div');
                            proxy.className = 'batch-drag-proxy';
                            proxy.innerHTML =
                                '<div class="batch-drag-proxy__layer batch-drag-proxy__layer--back"></div>' +
                                '<div class="batch-drag-proxy__layer batch-drag-proxy__layer--mid"></div>' +
                                '<div class="batch-drag-proxy__card">' +
                                    '<div class="batch-drag-proxy__icon">' + this.getSkillDragProxyIconSvg() + '</div>' +
                                    '<div class="batch-drag-proxy__body">' +
                                        '<div class="batch-drag-proxy__title">' + title + '</div>' +
                                        '<div class="batch-drag-proxy__meta">' + escHtml(countLabel) + '</div>' +
                                    '</div>' +
                                    '<div class="drag-count-badge">' + (this.draggedCount > 99 ? '99+' : String(this.draggedCount)) + '</div>' +
                                '</div>';
                            return proxy;
                        },
	                        buildSingleProxy() {
                            const primarySkill = skills[this.sourceIndex];
                            const title = escHtml((primarySkill && (primarySkill.displayName || primarySkill.name)) || '');
                            const proxy = document.createElement('div');
                            proxy.className = 'single-drag-proxy';
	                            proxy.innerHTML =
	                                '<div class="single-drag-proxy__card">' +
	                                    '<div class="single-drag-proxy__icon">' + this.getSkillDragProxyIconSvg() + '</div>' +
	                                    '<div class="single-drag-proxy__title">' + title + '</div>' +
	                                '</div>';
	                            return proxy;
	                        },
                            buildGroupProxy() {
                                const groupName = this.sourceGroup || '';
                                const displayName = escHtml(getGroupLabel(groupName));
                                const groupSkills = skills.filter(function(s) { return s.group === groupName; });
                                const count = groupSkills.length;
                                const proxy = document.createElement('div');
                                proxy.className = 'group-drag-proxy';
                                proxy.innerHTML =
                                    '<div class="group-drag-proxy__card">' +
                                        '<div class="group-drag-proxy__icon">' +
                                            '<svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><path d="M1.5 1h13l.5.5v13l-.5.5h-13l-.5-.5v-13l.5-.5zM2 2v12h12V2H2z"/><path d="M3 5h10v1H3V5zm0 3h10v1H3V8zm0 3h7v1H3v-1z"/></svg>' +
                                        '</div>' +
                                        '<div class="group-drag-proxy__title">' + displayName + '</div>' +
                                        '<div class="group-drag-proxy__count">' + count + '</div>' +
                                    '</div>';
                                return proxy;
                            },
                            buildBatchGroupProxy() {
                                const draggedGroupNames = this.draggedGroupNames || [this.sourceGroup];
                                const totalCount = draggedGroupNames.reduce(function(acc, gName) {
                                    return acc + skills.filter(function(s) { return s.group === gName; }).length;
                                }, 0);
                                const proxy = document.createElement('div');
                                proxy.className = 'group-drag-proxy';
                                proxy.style.cssText = 'position:relative;';
                                // build 2 stacked layers for visual depth
                                const backLayer = document.createElement('div');
                                backLayer.style.cssText = 'position:absolute;left:4px;top:-4px;right:-4px;bottom:4px;border-radius:10px;background:color-mix(in srgb, var(--vscode-editor-background) 90%, black 10%);border:1.5px solid color-mix(in srgb, var(--vscode-textLink-foreground, #3794ff) 30%, transparent);';
                                proxy.appendChild(backLayer);
                                const card = document.createElement('div');
                                card.className = 'group-drag-proxy__card';
                                card.style.position = 'relative';
                                card.innerHTML =
                                    '<div class="group-drag-proxy__icon">' +
                                        '<svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><path d="M1.5 1h13l.5.5v13l-.5.5h-13l-.5-.5v-13l.5-.5zM2 2v12h12V2H2z"/><path d="M3 5h10v1H3V5zm0 3h10v1H3V8zm0 3h7v1H3v-1z"/></svg>' +
                                    '</div>' +
                                    '<div class="group-drag-proxy__title">' + draggedGroupNames.length + ' groups</div>' +
                                    '<div class="group-drag-proxy__count">' + totalCount + '</div>';
                                proxy.appendChild(card);
                                return proxy;
                            },
                            queueFrame() {
                                if (this.frameHandle) return;
                                this.frameHandle = requestAnimationFrame(() => {
                                    this.frameHandle = 0;
                                    if (!this.isDragging) return;
                                    this.placeProxy();
                                    this.updateReorder(this.pointerY);
                                });
                            },
                            cancelFrame() {
                                if (!this.frameHandle) return;
                                cancelAnimationFrame(this.frameHandle);
                                this.frameHandle = 0;
                            },
                        captureVisibleSkillRects() {
                            const rects = new Map();
                            skillList.querySelectorAll('.skill-item:not(.drag-placeholder)').forEach((el) => {
                                rects.set(el, el.getBoundingClientRect());
                            });
                            return rects;
                        },
                        animateSkillReflow(firstRects) {
                            if (!firstRects || firstRects.size === 0) return;
                            skillList.querySelectorAll('.skill-item:not(.drag-placeholder)').forEach((el) => {
                                const first = firstRects.get(el);
                                if (!first) return;
                                const last = el.getBoundingClientRect();
                                const deltaY = first.top - last.top;
                                if (Math.abs(deltaY) < 0.5) return;
                                el.style.transition = 'none';
                                el.style.transform = 'translateY(' + deltaY + 'px)';
                                el.getBoundingClientRect();
                                requestAnimationFrame(() => {
                                    el.style.transition = '';
                                    el.style.transform = '';
                                });
                            });
                        },
                        captureVisibleGroupRects() {
                            const rects = new Map();
                            skillList.querySelectorAll('.skill-group[data-group]:not(.drag-placeholder-group)').forEach((el) => {
                                rects.set(el, el.getBoundingClientRect());
                            });
                            return rects;
                        },
                        animateGroupReflow(firstRects) {
                            if (!firstRects || firstRects.size === 0) return;
                            const elements = [];
                            skillList.querySelectorAll('.skill-group[data-group]:not(.drag-placeholder-group)').forEach((el) => {
                                const first = firstRects.get(el);
                                if (!first) return;
                                const last = el.getBoundingClientRect();
                                const deltaY = first.top - last.top;
                                if (Math.abs(deltaY) < 0.5) return;
                                elements.push({ el, deltaY });
                            });
                            if (elements.length === 0) return;
                            // Apply inverse transform immediately (no transition)
                            elements.forEach(({ el, deltaY }) => {
                                el.style.transition = 'none';
                                el.style.transform = 'translate3d(0,' + deltaY + 'px,0)';
                            });
                            // Force layout
                            void skillList.offsetHeight;
                            // Double-rAF for reliable animation trigger
                            requestAnimationFrame(() => {
                                requestAnimationFrame(() => {
                                    elements.forEach(({ el }) => {
                                        el.style.transition = 'transform var(--group-reorder-duration) var(--group-reorder-ease)';
                                        el.style.transform = '';
                                    });
                                });
                            });
                        },
                        findGroupContainer(groupName) {
                            if (!groupName) return null;
                            const groups = Array.from(skillList.querySelectorAll('.skill-group[data-group]'));
                            return groups.find((el) => el.getAttribute('data-group') === groupName) || null;
                        },
                        restoreOriginalSkillPosition() {
                            if (this.type !== 'skill' || !this.item || !this.originalParent) return;
                            const desiredNext = (this.originalNextSibling && this.originalNextSibling.parentElement === this.originalParent)
                                ? this.originalNextSibling
                                : null;
                            if (this.item.parentElement === this.originalParent && this.item.nextSibling === desiredNext) return;
                            this.originalParent.insertBefore(this.item, desiredNext);
                        },
                        restoreOriginalGroupPosition() {
                            if (this.type !== 'group' || !this.groupPlaceholder || !this.originalGroupParent) return;
                            const desiredNext = (this.originalGroupNextSibling && this.originalGroupNextSibling.parentElement === this.originalGroupParent)
                                ? this.originalGroupNextSibling
                                : null;
                            if (this.groupPlaceholder.parentElement === this.originalGroupParent && this.groupPlaceholder.nextSibling === desiredNext) return;
                            this.originalGroupParent.insertBefore(this.groupPlaceholder, desiredNext);
                        },
                        cleanupDragDom(restoreOriginalPosition) {
                            skillList.classList.remove('drag-primed');
                            if (this.proxy) this.proxy.remove();
                            clearDropIndicators();
                            if (restoreOriginalPosition) {
                                if (this.type === 'skill') this.restoreOriginalSkillPosition();
                                if (this.type === 'group') this.restoreOriginalGroupPosition();
                            }
                            if (this.item) this.item.classList.remove('drag-placeholder');
                            if (this.groupPlaceholder) this.groupPlaceholder.classList.remove('drag-placeholder-group');
                            this.siblings.forEach((s) => { s.style.transform = ''; });
                            this.clearBatchPeerState();
                            document.body.style.cursor = '';
                            document.documentElement.style.cursor = '';
                        },
	                        moveSkillPlaceholder() {
	                            if (this.type !== 'skill' || !this.item) return;
	                            const targetEl = skillList.querySelector('.skill-item[data-index="' + this.targetIndex + '"]');
	                            if (!targetEl || targetEl === this.item) return;
                            const parent = targetEl.parentElement;
                            const nextSibling = this.targetIntent === 'after' ? targetEl.nextSibling : targetEl;
                            if (parent === this.item.parentElement && (nextSibling === this.item || nextSibling === this.item.nextSibling)) return;
                            const firstRects = this.captureVisibleSkillRects();
                            parent.insertBefore(this.item, nextSibling);
                            this.animateSkillReflow(firstRects);
                        },
                        moveGroupPlaceholder() {
                            if (this.type !== 'group' || !this.groupPlaceholder) return;
                            let parent = skillList;
                            let nextSibling = null;

                            if (this.targetIntent !== 'bottom') {
                                const targetGroupEl = this.findGroupContainer(this.targetGroup);
                                if (!targetGroupEl || targetGroupEl === this.groupPlaceholder) return;
                                parent = targetGroupEl.parentElement;
                                nextSibling = this.targetIntent === 'after' ? targetGroupEl.nextSibling : targetGroupEl;
                            }

                            if (parent === this.groupPlaceholder.parentElement && (nextSibling === this.groupPlaceholder || nextSibling === this.groupPlaceholder.nextSibling)) return;
                            const firstRects = this.captureVisibleGroupRects();
                            parent.insertBefore(this.groupPlaceholder, nextSibling);
                            this.animateGroupReflow(firstRects);
                        },
	                        placeProxy() {
	                            if (!this.proxy) return;
	                            const x = this.pointerX - this.offsetX;
	                            const y = this.pointerY - this.offsetY;
                                this.proxy.style.setProperty('--drag-x', x + 'px');
                                this.proxy.style.setProperty('--drag-y', y + 'px');
	                        },

                        onMouseDown(e) {
                            if (e.button !== 0) return;
                            if (e.target.closest('.favorite-star') || e.target.closest('.icon-container')) return;
                            if (e.target.closest('.group-arrow')) return;
                            if (e.target.closest('input') || e.target.closest('button')) return;

                            const item = e.target.closest('.skill-item');
                            const header = e.target.closest('.group-header');

                            // Shift+click selects a visible range of groups; Ctrl/Cmd+click toggles a single group.
                            if (header && !item && e.shiftKey) {
                                e.preventDefault();
                                const groupName = header.parentElement.getAttribute('data-group');
                                if (groupName) {
                                    const rangeGroupNames = getVisibleGroupRange(lastSelectedGroupName, groupName);
                                    selectedGroups = new Set(rangeGroupNames);
                                    /* keep anchor: lastSelectedGroupName = groupName; */
                                    syncGroupSelectionVisuals();
                                }
                                return;
                            }

                            const isMac = typeof navigator !== 'undefined' && navigator.platform.toUpperCase().indexOf('MAC') >= 0;
                            if (header && !item && (e.metaKey || (!isMac && e.ctrlKey))) {
                                e.preventDefault();
                                const groupName = header.parentElement.getAttribute('data-group');
                                if (groupName) {
                                    if (selectedGroups.has(groupName)) {
                                        selectedGroups.delete(groupName);
                                    } else {
                                        selectedGroups.add(groupName);
                                    }
                                    lastSelectedGroupName = groupName;
                                    syncGroupSelectionVisuals();
                                }
                                return;
                            }

                            if (e.shiftKey || e.metaKey || e.ctrlKey || e.altKey) return;

                            if (item || header) {
                                this.item = item || header;
	                                this.type = item ? 'skill' : 'group';
	                                this.startX = e.clientX;
	                                this.startY = e.clientY;
                                    this.pointerX = e.clientX;
                                    this.pointerY = e.clientY;
	                                const rect = this.item.getBoundingClientRect();
                                this.offsetX = e.clientX - rect.left;
                                this.offsetY = e.clientY - rect.top;
                                this.initialRect = rect;
                                
                                if (this.type === 'skill') {
                                    this.sourceIndex = parseInt(this.item.getAttribute('data-index'));
                                    const skill = skills[this.sourceIndex];
                                    this.sourceGroup = skill ? (skill.group || '') : '';
                                    if (selectedSkills.size > 1 && selectedSkills.has(skill.path)) {
                                        draggedSkillPaths = getOrderedSkillPaths(Array.from(selectedSkills));
                                    } else {
                                        draggedSkillPaths = [skill.path];
                                    }
                                    this.draggedPathSet = new Set(draggedSkillPaths);
                                    this.draggedCount = draggedSkillPaths.length;
                                    draggedPrimaryPath = skill.path;
                                } else {
                                    this.sourceGroup = this.item.parentElement.getAttribute('data-group');
                                    this.sourceIndex = -1;
                                    draggedSkillPaths = [];
	                                    this.draggedPathSet = new Set();
	                                    this.draggedCount = 0;
                                    // If dragging a selected group, include ALL selected groups
                                    if (selectedGroups.has(this.sourceGroup) && selectedGroups.size > 1) {
                                        // Preserve order from topLevelOrder
                                        this.draggedGroupNames = Array.from(topLevelOrder)
                                            .filter(function(t) { return t.startsWith('group:') && selectedGroups.has(t.slice(6)); })
                                            .map(function(t) { return t.slice(6); });
                                        if (this.draggedGroupNames.length === 0) this.draggedGroupNames = [this.sourceGroup];
                                    } else {
                                        this.draggedGroupNames = [this.sourceGroup];
                                    }
	                                }
                                    this.lastResolvedTargetKey = null;
	                            }
	                        },

                        startDrag(e) {
                            if (this.isDragging || !this.item) return;
                            if ((e.buttons & 1) !== 1) return;
                            this.isDragging = true;

                            if (this.type === 'skill') {
                                this.originalParent = this.item.parentElement;
                                this.originalNextSibling = this.item.nextSibling;
                                this.item.classList.add('drag-placeholder');
                                if (this.draggedCount > 1) {
                                    this.proxy = this.buildBatchProxy();
                                    this.proxy.style.width = Math.min(Math.max(this.initialRect.width, 220), 320) + 'px';
                                } else {
                                    this.proxy = this.buildSingleProxy();
                                    this.proxy.style.width = Math.min(Math.max(this.initialRect.width, 210), 320) + 'px';
                                }
                            } else {
                                this.groupPlaceholder = this.item.parentElement;
                                this.originalGroupParent = this.groupPlaceholder.parentElement;
                                this.originalGroupNextSibling = this.groupPlaceholder.nextSibling;
                                this.groupPlaceholder.classList.add('drag-placeholder-group');
                                const isBatch = this.draggedGroupNames && this.draggedGroupNames.length > 1;
                                if (isBatch) {
                                    // Hide all selected group placeholders
                                    this.extraGroupPlaceholders = [];
                                    const self = this;
                                    this.draggedGroupNames.forEach(function(gName) {
                                        if (gName === self.sourceGroup) return;
                                        const ge = self.findGroupContainer(gName);
                                        if (ge) {
                                            ge.classList.add('drag-placeholder-group');
                                            self.extraGroupPlaceholders.push(ge);
                                        }
                                    });
                                    this.proxy = this.buildBatchGroupProxy();
                                } else {
                                    this.proxy = this.buildGroupProxy();
                                }
                                this.proxy.style.width = Math.min(Math.max(this.initialRect.width, 200), 300) + 'px';
                                // Apply peer visual state on selected group headers
                                skillList.querySelectorAll('.group-header.selected').forEach(function(h) {
                                    h.classList.add('drag-proxy-peer');
                                });
	                            }
	                            document.body.appendChild(this.proxy);
                                this.pointerX = e.clientX;
                                this.pointerY = e.clientY;
	                            this.placeProxy();

	                            this.siblings = Array.from(skillList.querySelectorAll(this.type === 'skill' ? '.skill-item' : '.group-header'));
	                            this.itemHeights = this.siblings.map(s => s.offsetHeight + 8); // height + margin
	                            
	                            skillList.classList.add('drag-primed');
	                            document.body.style.cursor = 'grabbing';
                                document.documentElement.style.cursor = 'grabbing';
	                            this.applyBatchPeerState();
                                this.queueFrame();
	                        },

                        onMouseMove(e) {
                            if (!this.isDragging) {
                                if (!this.item) return;
                                if ((e.buttons & 1) !== 1) {
                                    this.reset();
                                    return;
                                }
                                const deltaX = e.clientX - this.startX;
                                const deltaY = e.clientY - this.startY;
                                const distance = Math.hypot(deltaX, deltaY);
                                if (distance >= this.dragThreshold) {
                                    this.startDrag(e);
                                }
                                return;
                            }

                            if ((e.buttons & 1) !== 1) {
                                this.onMouseUp(e);
                                return;
	                            }

	                            e.preventDefault();
                                this.pointerX = e.clientX;
                                this.pointerY = e.clientY;
                                this.queueFrame();
	                        },

	                        updateReorder(clientY) {
                                let nextTargetIndex = this.targetIndex;
                                let nextTargetGroup = this.targetGroup;
                                let nextTargetIntent = this.targetIntent;
                                let found = false;
	                            if (this.type === 'skill') {
                                    const collapsedHeaderTargets = Array.from(skillList.querySelectorAll('.skill-group[data-group] > .group-header.collapsed'));
                                    const hoveredCollapsedHeader = collapsedHeaderTargets.find((headerEl) => {
                                        const rect = headerEl.getBoundingClientRect();
                                        return this.pointerX >= rect.left && this.pointerX <= rect.right && clientY >= rect.top && clientY <= rect.bottom;
                                    });
                                    if (hoveredCollapsedHeader) {
                                        nextTargetIndex = -1;
                                        nextTargetGroup = hoveredCollapsedHeader.parentElement.getAttribute('data-group') || '';
                                        nextTargetIntent = 'into-group';
                                        found = true;
                                    }
	                                this.siblings = Array.from(skillList.querySelectorAll('.skill-item'));
                            } else {
                                this.siblings = Array.from(skillList.querySelectorAll('.group-header'));
                            }
                            const proxyMid = clientY;
                            let previousSkillCandidate = null;
                            let previousGroupCandidate = null;

                            for (let i = 0; i < this.siblings.length; i++) {
                                const sib = this.siblings[i];
                                if (sib === this.item) continue;

                                const rect = sib.getBoundingClientRect();
                                const mid = rect.top + rect.height / 2;

                                if (this.type === 'skill') {
                                    const idx = parseInt(sib.getAttribute('data-index'));
                                    const siblingSkill = skills[idx];
                                    if (!siblingSkill) continue;
                                    if (this.draggedPathSet.has(siblingSkill.path)) {
                                        sib.style.transform = '';
                                        continue;
                                    }

	                                    // If pointer is inside the gap above current item, prefer dropping after previous item.
	                                    if (!found && clientY < rect.top) {
	                                        if (previousSkillCandidate) {
	                                            nextTargetIndex = previousSkillCandidate.idx;
	                                            nextTargetIntent = 'after';
	                                            nextTargetGroup = previousSkillCandidate.group;
	                                        } else {
	                                            nextTargetIndex = idx;
	                                            nextTargetIntent = 'before';
	                                            nextTargetGroup = siblingSkill.group || '';
	                                        }
	                                        found = true;
	                                    } else if (proxyMid < mid && !found) {
	                                        nextTargetIndex = idx;
	                                        nextTargetIntent = 'before';
	                                        nextTargetGroup = siblingSkill.group || '';
	                                        found = true;
	                                    }
                                    previousSkillCandidate = { idx: idx, group: siblingSkill.group || '' };
	                                } else {
	                                    const gName = sib.parentElement.getAttribute('data-group');
                                        const beforeThreshold = rect.top + Math.min(rect.height * 0.34, 12);

	                                    if (!found && clientY < rect.top) {
	                                        if (previousGroupCandidate) {
	                                            nextTargetGroup = previousGroupCandidate;
	                                            nextTargetIntent = 'after';
	                                        } else {
	                                            nextTargetGroup = gName;
	                                            nextTargetIntent = 'before';
	                                        }
	                                        found = true;
	                                    } else if (proxyMid < beforeThreshold && !found) {
	                                        nextTargetGroup = gName;
	                                        nextTargetIntent = 'before';
	                                        found = true;
	                                    }
                                    previousGroupCandidate = gName;
                                }
                            }

	                            if (!found) {
	                                if (this.type === 'skill') {
	                                    nextTargetIndex = -1;
	                                    nextTargetIntent = 'bottom';
	                                    nextTargetGroup = '';
	                                } else {
	                                    nextTargetGroup = null;
	                                    nextTargetIntent = 'bottom';
	                                }
	                            }

                                const nextTargetKey = this.type === 'skill'
                                    ? [nextTargetIndex, nextTargetIntent, nextTargetGroup || ''].join('|')
                                    : [(nextTargetGroup || '__bottom__'), nextTargetIntent].join('|');

                                if (nextTargetKey === this.lastResolvedTargetKey) return;

                                this.targetIndex = nextTargetIndex;
                                this.targetGroup = nextTargetGroup;
                                this.targetIntent = nextTargetIntent;
                                this.lastResolvedTargetKey = nextTargetKey;

	                            if (this.type === 'skill') {
                                    if (this.targetIntent === 'into-group') {
                                        const targetGroupEl = this.findGroupContainer(this.targetGroup);
                                        const targetHeader = targetGroupEl ? targetGroupEl.querySelector('.group-header') : null;
                                        if (targetHeader) {
                                            showDropIntoForElement(targetHeader);
                                        } else {
                                            clearDropIndicators();
                                        }
                                        return;
                                    }
                                    if (this.targetIntent === 'bottom' && !found) {
                                        showDropLineAtListEnd();
                                        return;
                                    }
	                                const targetEl = skillList.querySelector('.skill-item[data-index="' + this.targetIndex + '"]');
	                                if (targetEl && targetEl !== this.item) {
	                                    showDropLineForElement(targetEl, this.targetIntent === 'after');
	                                }
	                                this.moveSkillPlaceholder();
	                            } else {
                                    if (this.targetIntent === 'bottom' && !found) {
                                        showDropLineAtListEnd();
                                    }
	                                const targetGroupEl = this.findGroupContainer(this.targetGroup);
                                const targetHeader = targetGroupEl ? targetGroupEl.querySelector('.group-header') : null;
                                if (targetHeader && targetHeader !== this.item) {
                                    showDropLineForElement(targetHeader, this.targetIntent === 'after');
                                }
                                this.moveGroupPlaceholder();
                            }
                        },

		                        onMouseUp(e) {
		                            if (!this.isDragging) {
		                                this.reset();
		                                return;
		                            }

		                            this.isDragging = false;
		                            this.cancelFrame();
		                            this.finalizeDrop();
	                        },

	                        finalizeDrop() {
	                            if (this.type === 'group') {
	                                if (!this.targetGroup && this.targetIntent !== 'bottom') {
	                                    this.cleanupDragDom(true);
                                        suppressClickUntil = Date.now() + 100;
	                                    this.reset();
	                                    return;
	                                }
	                                let target = null;
                                if (this.targetIntent === 'bottom') {
                                    target = { kind: 'bottom' };
                                } else {
                                    target = {
                                        kind: 'group-boundary',
                                        groupName: this.targetGroup,
                                        position: this.targetIntent === 'after' ? 'after' : 'before'
	                                    };
	                                }
                                // Move all dragged groups in order
                                const groupsToMove = (this.draggedGroupNames && this.draggedGroupNames.length > 0)
                                    ? this.draggedGroupNames
                                    : [this.sourceGroup];
                                let anyMoved = false;
                                let currentTarget = target;
                                for (let gi = 0; gi < groupsToMove.length; gi++) {
                                    const gName = groupsToMove[gi];
                                    if (moveGroupBlock(gName, currentTarget)) {
                                        anyMoved = true;
                                        // Each subsequent group is placed after the previous one
                                        currentTarget = {
                                            kind: 'group-boundary',
                                            groupName: gName,
                                            position: 'after'
                                        };
                                    }
                                }
	                                if (anyMoved) {
	                                    refreshListAndEditor();
	                                    persistOrdering();
                                        this.cleanupDragDom(false);
                                } else {
                                    this.cleanupDragDom(true);
	                                }
                                // Clear group selection after drop
                                selectedGroups.clear();
                                skillList.querySelectorAll('.group-header.selected, .group-header.drag-proxy-peer').forEach(function(h) {
                                    h.classList.remove('selected', 'drag-proxy-peer');
                                });
                                if ((this.extraGroupPlaceholders || []).length > 0) {
                                    this.extraGroupPlaceholders.forEach(function(ge) { ge.classList.remove('drag-placeholder-group'); });
                                    this.extraGroupPlaceholders = [];
                                }
	                            } else {
                                let target = null;
                                if (this.targetIntent === 'into-group') {
                                    target = {
                                        kind: 'group-boundary',
                                        groupName: this.targetGroup,
                                        position: 'end',
                                        newGroup: this.targetGroup || ''
                                    };
                                } else if (this.targetIntent === 'bottom') {
                                    target = {
                                        kind: 'bottom',
                                        newGroup: ''
                                    };
                                } else {
	                                    const targetSkill = skills[this.targetIndex];
	                                    if (!targetSkill) {
	                                        this.cleanupDragDom(true);
                                            suppressClickUntil = Date.now() + 100;
	                                        this.reset();
	                                        return;
	                                    }

                                    target = {
                                        kind: 'relative-path',
                                        targetPath: targetSkill.path,
                                        placeAfter: (this.targetIntent === 'after'),
                                        newGroup: typeof this.targetGroup === 'string' ? this.targetGroup : (targetSkill.group || '')
                                    };
                                }

                                const moveResult = moveSkillBatch(draggedSkillPaths, target);
	                                if (moveResult.movedPaths && moveResult.movedPaths.length > 0) {
	                                    normalizePostDragSelection(moveResult.movedPaths);
	                                    const updates = getGroupChangeUpdates(moveResult.movedPaths, target.newGroup || '', moveResult.originalGroups || {});
	                                    refreshListAndEditor();
	                                    if (updates.length > 0) commitLayout(updates);
	                                    else persistOrdering();
                                        this.cleanupDragDom(false);

	                                    // Only show toast if group actually changed (changedPaths > 0)
	                                    if (moveResult.changedPaths && moveResult.changedPaths.length > 0) {
	                                        const newGroup = (target.newGroup || '').trim();
                                        if (!isUngrouped(newGroup)) {
                                            const groupLabel = getGroupLabel(newGroup);
                                            const count = moveResult.changedPaths.length;
                                            const toastMsg = (t.movedToGroupToast || '已移入「{0}」组 ({1}个)').replace('{0}', groupLabel).replace('{1}', count);
	                                            vscode.postMessage({ command: 'showInfo', text: toastMsg });
	                                        }
	                                    }
	                                } else {
                                        this.cleanupDragDom(true);
                                    }
	                            }

	                            suppressClickUntil = Date.now() + 100;
	                            this.reset();
		                        },

	                        reset() {
                                this.cancelFrame();
	                            this.isDragging = false;
	                            this.clearBatchPeerState();
                            this.item = null;
                            this.proxy = null;
                            this.type = null;
                            this.initialRect = null;
                            this.offsetX = 0;
                            this.offsetY = 0;
                            this.startX = 0;
                            this.startY = 0;
                            this.sourceIndex = -1;
                            this.sourceGroup = null;
                            this.targetIndex = -1;
                            this.targetGroup = null;
                            this.targetIntent = 'before';
                            this.siblings = [];
                            this.itemHeights = [];
                            clearDropIndicators();
                            this.originalParent = null;
                            this.originalNextSibling = null;
                            this.groupPlaceholder = null;
                            this.originalGroupParent = null;
	                            this.originalGroupNextSibling = null;
	                            this.draggedPathSet = new Set();
	                            this.draggedCount = 0;
                                this.pointerX = 0;
                                this.pointerY = 0;
                                this.lastResolvedTargetKey = null;
                                document.body.style.cursor = '';
                                document.documentElement.style.cursor = '';
	                        }
	                    };
                    dragEngine.init();

                    function clearLockedDropTarget() {
                        lockedDropTargetKey = null;
                        lockedDropIntent = null;
                    }
                    function normalizePostDragSelection(draggedPaths) {
                        const normalizedPaths = (draggedPaths || []).filter(Boolean);
                        if (normalizedPaths.length === 0) return;
                        const activePath = draggedPrimaryPath || normalizedPaths[0];
                        if (normalizedPaths.length > 1) {
                            selectedSkills = new Set(normalizedPaths);
                        } else {
                            selectedSkills.clear();
                        }
                        lastSelectedPath = activePath || null;
                        const activeIndex = skills.findIndex(function(skill) { return skill.path === activePath; });
                        if (activeIndex !== -1) currentIndex = activeIndex;
                    }

                    // Import modal
                    const importModal = document.getElementById('importModal'); 
                    const importSummaryCard = document.getElementById('importSummaryCard');
                    const importSummaryPrimary = document.getElementById('importSummaryPrimary');
                    const importSummarySecondary = document.getElementById('importSummarySecondary');
                    const importSummaryCount = document.getElementById('importSummaryCount');
                    const importPreviewList = document.getElementById('importPreviewList');
                    const importSingleNameRow = document.getElementById('importSingleNameRow');
                    const importBatchInfo = document.getElementById('importBatchInfo');
                    const importStrategyRow = document.getElementById('importStrategyRow');
                    const importStrategySelect = document.getElementById('importStrategySelect');
                    const importSkillInput = document.getElementById('importSkillInput'); 
                    const confirmImportBtn = document.getElementById('confirmImportBtn');
                    let pendingImportFiles = null;
                    let pendingImportPlan = null;
                    let pendingImportSource = 'picker';

                    function normalizeImportDisplayName(name) {
                        var nextName = String(name || '').trim();
                        nextName = nextName.replace(/\\.(md|mdc)$/i, '');
                        if (['SKILL', 'README', 'skill', 'readme'].indexOf(nextName) !== -1) return '';
                        return nextName;
                    }

                    function getFolderTreeSkillNames(item) {
                        var files = Array.isArray(item && item.files) ? item.files : [];
                        if (files.length === 0) return [];
                        var normalizedPaths = files.map(function(file) {
                            return String((file && file.relativePath) || '').replace(/\\\\/g, '/').replace(/^\\/+/, '');
                        });
                        if (normalizedPaths.indexOf('SKILL.md') !== -1) {
                            return [normalizeImportDisplayName(item.name || item.suggestedName || '') || (item.name || item.suggestedName || 'SKILL')];
                        }
                        var seenRoots = new Set();
                        var roots = [];
                        normalizedPaths.forEach(function(relPath) {
                            if (!/(^|\\/)SKILL\\.md$/.test(relPath)) return;
                            var rootDir = relPath.replace(/\\/SKILL\\.md$/, '');
                            if (!rootDir || rootDir === '.') return;
                            if (seenRoots.has(rootDir)) return;
                            seenRoots.add(rootDir);
                            var parts = rootDir.split('/');
                            roots.push(parts[parts.length - 1] || rootDir);
                        });
                        return roots;
                    }

                    function extractSingleImportName(item) {
                        if (!item) return '';
                        if (item.content) {
                            var fm = String(item.content || '').match(/^---\\s*\\n([\\s\\S]*?)\\n---/);
                            if (fm) {
                                var nm = fm[1].match(/name:\\s*(.+)/);
                                if (nm && nm[1].trim()) return nm[1].trim();
                            }
                        }
                        return normalizeImportDisplayName(item.suggestedName || item.name || '');
                    }

                    function buildImportPlan(files) {
                        var names = [];
                        (files || []).forEach(function(file) {
                            if (!file) return;
                            if (file.kind === 'folderTree') {
                                names = names.concat(getFolderTreeSkillNames(file));
                                return;
                            }
                            names.push(extractSingleImportName(file) || normalizeImportDisplayName(file.name || file.suggestedName || '') || 'SKILL');
                        });
                        names = names.filter(function(name) { return !!String(name || '').trim(); });
                        var uniqueNames = [];
                        var seenNames = new Set();
                        names.forEach(function(name) {
                            if (seenNames.has(name)) return;
                            seenNames.add(name);
                            uniqueNames.push(name);
                        });
                        return {
                            sourceCount: Array.isArray(files) ? files.length : 0,
                            skillCount: uniqueNames.length,
                            skillNames: uniqueNames,
                            singleName: uniqueNames[0] || ''
                        };
                    }

                    function renderImportPreview(plan) {
                        importPreviewList.innerHTML = '';
                        var previewNames = (plan.skillNames || []).slice(0, 6);
                        previewNames.forEach(function(name) {
                            var chip = document.createElement('span');
                            chip.className = 'import-preview-chip';
                            chip.textContent = name;
                            importPreviewList.appendChild(chip);
                        });
                        if ((plan.skillNames || []).length > previewNames.length) {
                            var moreChip = document.createElement('span');
                            moreChip.className = 'import-preview-chip more';
                            moreChip.textContent = '+' + ((plan.skillNames || []).length - previewNames.length);
                            importPreviewList.appendChild(moreChip);
                        }
                    }

                    function showImportModal(files, options) { 
                        pendingImportFiles = files;
                        pendingImportPlan = buildImportPlan(files);
                        pendingImportSource = (options && options.source) || 'picker';
                        var isBatchImport = pendingImportPlan.skillCount !== 1;
                        var isDragImport = pendingImportSource === 'drag';

                        if (isDragImport) {
                            importSummaryCard.style.display = 'none';
                            importBatchInfo.style.display = 'none';
                            importStrategyRow.style.display = 'none';
                        } else {
                            importSummaryCard.style.display = 'flex';
                            importStrategyRow.style.display = 'block';
                            importStrategySelect.value = 'ask';
                            importSummaryPrimary.textContent = isBatchImport
                                ? ((t.batchImportLabel || 'Batch Import: {0} files selected').replace('{0}', pendingImportPlan.sourceCount))
                                : (t.importBtn || 'Import Skills');
                            importSummarySecondary.textContent = isBatchImport
                                ? ('预计将导入 ' + pendingImportPlan.skillCount + ' 个 skills')
                                : ('将导入 1 个 skill');
                            importSummaryCount.textContent = pendingImportPlan.skillCount + ' skill' + (pendingImportPlan.skillCount === 1 ? '' : 's');
                            renderImportPreview(pendingImportPlan);
                        }

                        if (isBatchImport) {
                            importSingleNameRow.style.display = 'none';
                            importSkillInput.value = '';
                            if (!isDragImport) {
                                importBatchInfo.style.display = 'block';
                                importBatchInfo.textContent = '批量导入时将按各自文件夹或技能名导入，重名时默认逐个询问。';
                                confirmImportBtn.textContent = (t.importBtn || 'Import') + ' (' + pendingImportPlan.skillCount + ')';
                            }
                        } else {
                            importSingleNameRow.style.display = 'block';
                            importSkillInput.value = pendingImportPlan.singleName || '';
                            if (!isDragImport) {
                                importBatchInfo.style.display = 'none';
                            }
                        }
                        if (isDragImport) {
                            confirmImportBtn.textContent = t.importBtn || 'Import';
                        } else if (!isBatchImport) {
                            confirmImportBtn.textContent = t.importBtn || 'Import';
                        }

                        importModal.classList.add('active'); 
                        if (!isBatchImport) {
                            importSkillInput.focus(); 
                            importSkillInput.select(); 
                        } else {
                            if (isDragImport) confirmImportBtn.focus();
                            else importStrategySelect.focus();
                        }
                    }

                    document.getElementById('cancelImportBtn').addEventListener('click', () => { importModal.classList.remove('active'); pendingImportFiles = null; pendingImportPlan = null; pendingImportSource = 'picker'; confirmImportBtn.textContent = t.importBtn || 'Import'; });
                    importModal.addEventListener('click', (e) => { if (e.target === importModal) { importModal.classList.remove('active'); pendingImportFiles = null; pendingImportPlan = null; pendingImportSource = 'picker'; confirmImportBtn.textContent = t.importBtn || 'Import'; } });
                    
                    confirmImportBtn.addEventListener('click', () => { 
                        if (!pendingImportFiles) return; 
                        
                        let sn = '';
                        if (pendingImportPlan && pendingImportPlan.skillCount === 1) {
                            sn = importSkillInput.value.trim(); 
                            if (!sn) { importSkillInput.focus(); return; } 
                        }

                        const isG = document.querySelector('input[name="importSkillType"]:checked').value === 'global'; 
                        const strategy = pendingImportSource === 'drag'
                            ? 'ask'
                            : ((importStrategySelect && importStrategySelect.value) || 'ask');

                        importModal.classList.remove('active'); 
                        vscode.postMessage({ 
                            command: 'dropFilesContent', 
                            files: pendingImportFiles, 
                            skillName: sn, // Empty for batch, will be auto-generated
                            isGlobal: isG,
                            strategy: strategy
                        }); 
                        pendingImportFiles = null; 
                        pendingImportPlan = null;
                        pendingImportSource = 'picker';
                        confirmImportBtn.textContent = t.importBtn || 'Import';
                    });
                    importSkillInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') confirmImportBtn.click(); if (e.key === 'Escape') document.getElementById('cancelImportBtn').click(); });

                    // External drag-drop
                    (function() {
                        let isDraggingExternal = false;
                        let externalDragResetTimer = 0;

                        function resetExternalDragState() {
                            isDraggingExternal = false;
                            if (externalDragResetTimer) {
                                clearTimeout(externalDragResetTimer);
                                externalDragResetTimer = 0;
                            }
                            document.body.classList.remove('file-drop-active');
                        }
                        function hasFileDrag(event) {
                            var dt = event && event.dataTransfer;
                            if (!dt || !dt.types) return false;
                            try {
                                return Array.from(dt.types).indexOf('Files') !== -1;
                            } catch (err) {
                                return false;
                            }
                        }
                        function armExternalDragReset() {
                            if (!isDraggingExternal) return;
                            if (externalDragResetTimer) clearTimeout(externalDragResetTimer);
                            externalDragResetTimer = setTimeout(function() {
                                resetExternalDragState();
                            }, 1200);
                        }

                        function normalizeNativeDroppedPath(nextPath) {
                            var normalizedPath = String(nextPath || '').trim();
                            if (!normalizedPath) return '';
                            if (/^\\/[A-Za-z]:[\\\\/]/.test(normalizedPath)) {
                                normalizedPath = normalizedPath.slice(1);
                            }
                            return normalizedPath;
                        }
                        function readStringDataTransferItem(item) {
                            return new Promise(function(resolve) {
                                if (!item || typeof item.getAsString !== 'function') {
                                    resolve('');
                                    return;
                                }
                                try {
                                    item.getAsString(function(value) {
                                        resolve(value || '');
                                    });
                                } catch (err) {
                                    resolve('');
                                }
                            });
                        }
                        async function getNativeDroppedPaths(dataTransfer) {
                            var seen = new Set();
                            var paths = [];
                            function pushNativePath(nextPath) {
                                var normalizedPath = normalizeNativeDroppedPath(nextPath);
                                if (!normalizedPath || seen.has(normalizedPath)) return;
                                seen.add(normalizedPath);
                                paths.push(normalizedPath);
                            }
                            function consumePathText(rawText) {
                                String(rawText || '').split(/[\\r\\n\\0]+/).forEach(function(line) {
                                    var trimmed = line.trim();
                                    if (!trimmed || trimmed.charAt(0) === '#') return;
                                    if (trimmed.indexOf('file://') === 0) {
                                        try {
                                            var url = new URL(trimmed);
                                            pushNativePath(decodeURIComponent(url.pathname || ''));
                                        } catch (err) {}
                                        return;
                                    }
                                    if (trimmed.charAt(0) === '/' || /^[A-Za-z]:[\\\\/]/.test(trimmed)) {
                                        pushNativePath(trimmed);
                                    }
                                });
                            }
                            var looseFiles = Array.from((dataTransfer && dataTransfer.files) || []);
                            for (var i = 0; i < looseFiles.length; i++) {
                                var nativePath = looseFiles[i] && looseFiles[i].path;
                                pushNativePath(nativePath);
                            }
                            var items = Array.from((dataTransfer && dataTransfer.items) || []);
                            for (var j = 0; j < items.length; j++) {
                                var item = items[j];
                                if (!item) continue;
                                if (item.kind === 'file') {
                                    var file = item.getAsFile ? item.getAsFile() : null;
                                    if (file && file.path) pushNativePath(file.path);
                                    continue;
                                }
                                if (item.kind === 'string') {
                                    var itemText = await readStringDataTransferItem(item);
                                    if (itemText) consumePathText(itemText);
                                }
                            }
                            var transferTypes = Array.from((dataTransfer && dataTransfer.types) || []);
                            var preferredTypes = ['text/uri-list', 'text/plain', 'public.file-url'];
                            preferredTypes.concat(transferTypes).forEach(function(typeName) {
                                if (!dataTransfer || typeof dataTransfer.getData !== 'function' || !typeName) return;
                                try {
                                    var rawValue = dataTransfer.getData(typeName);
                                    if (rawValue) consumePathText(rawValue);
                                } catch (err) {}
                            });
                            return paths;
                        }
                        function readTextFile(file) {
                            return new Promise(function(resolve, reject) {
                                var reader = new FileReader();
                                reader.onload = function(ev) { resolve(ev.target.result || ''); };
                                reader.onerror = function() { reject(reader.error || new Error('Failed to read file')); };
                                reader.readAsText(file);
                            });
                        }
                        function arrayBufferToBase64(buffer) {
                            var bytes = new Uint8Array(buffer);
                            var binary = '';
                            var chunkSize = 0x8000;
                            for (var i = 0; i < bytes.length; i += chunkSize) {
                                var chunk = bytes.subarray(i, i + chunkSize);
                                binary += String.fromCharCode.apply(null, chunk);
                            }
                            return btoa(binary);
                        }
                        function readBinaryFile(file) {
                            return new Promise(function(resolve, reject) {
                                var reader = new FileReader();
                                reader.onload = function(ev) { resolve(arrayBufferToBase64(ev.target.result)); };
                                reader.onerror = function() { reject(reader.error || new Error('Failed to read file')); };
                                reader.readAsArrayBuffer(file);
                            });
                        }
                        function readEntryFile(entry) {
                            return new Promise(function(resolve, reject) {
                                entry.file(resolve, reject);
                            });
                        }
                        function readDirectoryEntries(dirEntry) {
                            return new Promise(function(resolve, reject) {
                                var reader = dirEntry.createReader();
                                var entries = [];
                                function readBatch() {
                                    reader.readEntries(function(batch) {
                                        if (!batch || batch.length === 0) { resolve(entries); return; }
                                        entries = entries.concat(Array.from(batch));
                                        readBatch();
                                    }, reject);
                                }
                                readBatch();
                            });
                        }
                        async function collectDirectoryFiles(dirEntry, prefix) {
                            var entries = await readDirectoryEntries(dirEntry);
                            var files = [];
                            for (var i = 0; i < entries.length; i++) {
                                var entry = entries[i];
                                var relPath = prefix ? (prefix + '/' + entry.name) : entry.name;
                                if (entry.isDirectory) {
                                    var nestedFiles = await collectDirectoryFiles(entry, relPath);
                                    files = files.concat(nestedFiles);
                                } else if (entry.isFile) {
                                    var file = await readEntryFile(entry);
                                    var contentBase64 = await readBinaryFile(file);
                                    files.push({ relativePath: relPath, contentBase64: contentBase64 });
                                }
                            }
                            return files;
                        }
                        async function collectDroppedItems(dataTransfer) {
                            var imported = [];
                            var seenStandaloneFiles = new Set();
                            var items = Array.from((dataTransfer && dataTransfer.items) || []);

                            // CRITICAL: Collect ALL entries and File objects SYNCHRONOUSLY first!
                            // After any await, the browser invalidates the DataTransfer object,
                            // causing subsequent webkitGetAsEntry() calls to return null.
                            var collectedEntries = [];
                            var collectedFiles = [];
                            for (var i = 0; i < items.length; i++) {
                                var dtItem = items[i];
                                var entry = dtItem.webkitGetAsEntry ? dtItem.webkitGetAsEntry() : null;
                                var file = dtItem.getAsFile ? dtItem.getAsFile() : null;
                                collectedEntries.push(entry);
                                collectedFiles.push(file);
                            }
                            // Also snapshot loose files synchronously
                            var looseFiles = Array.from((dataTransfer && dataTransfer.files) || []);

                            // Now process entries asynchronously
                            for (var i = 0; i < collectedEntries.length; i++) {
                                var entry = collectedEntries[i];
                                if (!entry) continue;
                                if (entry.isDirectory) {
                                    var folderFiles = await collectDirectoryFiles(entry, '');
                                    if (folderFiles.length > 0) imported.push({ kind: 'folderTree', name: entry.name, suggestedName: entry.name, files: folderFiles });
                                } else if (entry.isFile) {
                                    var file = collectedFiles[i];
                                    if (!file || !/\.(md|mdc)$/i.test(file.name)) continue;
                                    seenStandaloneFiles.add(file.name + ':' + file.size + ':' + file.lastModified);
                                    var text = await readTextFile(file);
                                    imported.push({ kind: 'markdown', name: file.name, suggestedName: file.name.replace(/\.(md|mdc)$/i, ''), content: text });
                                }
                            }

                            for (var j = 0; j < looseFiles.length; j++) {
                                var looseFile = looseFiles[j];
                                var key = looseFile.name + ':' + looseFile.size + ':' + looseFile.lastModified;
                                if (seenStandaloneFiles.has(key) || !/\.(md|mdc)$/i.test(looseFile.name)) continue;
                                var looseText = await readTextFile(looseFile);
                                imported.push({ kind: 'markdown', name: looseFile.name, suggestedName: looseFile.name.replace(/\.(md|mdc)$/i, ''), content: looseText });
                            }
                            return imported;
                        }
                        document.addEventListener('dragenter', function(e) {
                            if (!hasFileDrag(e)) return;
                            isDraggingExternal = true;
                            armExternalDragReset();
                            e.preventDefault();
                            e.stopImmediatePropagation();
                            document.body.classList.add('file-drop-active');
                        }, true);
                        document.addEventListener('dragover', function(e) {
                            if (!isDraggingExternal && !hasFileDrag(e)) return;
                            isDraggingExternal = true;
                            armExternalDragReset();
                            e.preventDefault();
                            e.stopImmediatePropagation();
                            if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
                        }, true);
                        document.addEventListener('dragleave', function(e) {
                            if (!isDraggingExternal) return;
                            if (e.clientX <= 0 || e.clientY <= 0 || e.clientX >= window.innerWidth || e.clientY >= window.innerHeight) {
                                resetExternalDragState();
                            }
                        }, true);
                        document.addEventListener('drop', async function(e) {
                            if (!hasFileDrag(e) && !isDraggingExternal) return;
                            e.preventDefault();
                            e.stopImmediatePropagation();
                            resetExternalDragState();
                            if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                                try {
                                    var nativePaths = await getNativeDroppedPaths(e.dataTransfer);
                                    // If we have native paths AND the count matches (or exceeds) file count, trust native paths
                                    if (nativePaths.length > 0 && nativePaths.length >= e.dataTransfer.files.length) {
                                        vscode.postMessage({ command: 'importDroppedPaths', paths: nativePaths });
                                        return;
                                    }
                                    // Fallback: use webkitGetAsEntry to read items directly (works for folders in webview)
                                    var fc = await collectDroppedItems(e.dataTransfer);
                                    if (fc.length > 0) {
                                        // If we also have some native paths, try to supplement (for any files not captured by webkitGetAsEntry)
                                        if (nativePaths.length > 0) {
                                            vscode.postMessage({ command: 'importDroppedPaths', paths: nativePaths });
                                            return;
                                        }
                                        showImportModal(fc, { source: 'picker' });
                                    } else if (nativePaths.length > 0) {
                                        vscode.postMessage({ command: 'importDroppedPaths', paths: nativePaths });
                                    }
                                } catch (err) {
                                    console.error('Failed to read dropped files', err);
                                }
                            }
                        }, true);
                        window.addEventListener('blur', resetExternalDragState, true);
                        document.addEventListener('visibilitychange', function() {
                            if (document.visibilityState === 'hidden') resetExternalDragState();
                        }, true);
                        document.addEventListener('keydown', function(e) {
                            if (e.key === 'Escape') resetExternalDragState();
                        }, true);
                        document.addEventListener('pointerdown', function() { resetExternalDragState(); }, true);
                        document.addEventListener('mousedown', function() { resetExternalDragState(); }, true);
                    })();
                </script>
            </body>
            </html>
        `;
    }
}

/**
 * Static method: import files from explorer right-click context menu.
 */
SkillsPanel.importFromExplorer = function (filePaths) {
    if (!SkillsPanel.currentPanel) return;
    const panel = SkillsPanel.currentPanel;
    const t = panel._i18n;

    (async () => {
        const target = await vscode.window.showQuickPick([
            { label: '$(globe) ' + t.importGlobal, target: 'global' },
            { label: '$(folder) ' + t.importProject, target: 'project' }
        ], { placeHolder: t.importPickerTitle });
        if (!target) return;

        try {
            const items = [];
            for (const filePath of filePaths) {
                items.push(...panel._collectImportItemsFromPath(filePath));
            }
            await panel._importResolvedItems(items, '', target.target === 'global', 'ask');
        } catch (err) { vscode.window.showErrorMessage(t.importFailed + ' ' + err.message); }
    })();
};

module.exports = SkillsPanel;
