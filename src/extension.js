const vscode = require('vscode');
const SkillsPanel = require('./SkillsPanel');
const translations = require('./i18n');

function getMergedI18n(lang) {
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

/**
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {
    const commandIds = {
        open: 'antigravity-skills-editor.openSkillsEditor',
        import: 'antigravity-skills-editor.importSkillFromExplorer',
        export: 'antigravity-skills-editor.exportSkill'
    };

    let lang = context.globalState.get('antigravitySkillsLang');
    if (!lang) {
        lang = (vscode.env.language || 'en').toLowerCase();
    }
    const safeLang = lang && translations[lang] ? lang :
        (lang && lang.split('-')[0] && translations[lang.split('-')[0]] ? lang.split('-')[0] : 'en');
    const i18n = getMergedI18n(safeLang);

    // Create a status bar item
    const myStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    myStatusBarItem.command = commandIds.open;
    myStatusBarItem.text = `$(tools) ${i18n.title}`;
    myStatusBarItem.tooltip = i18n.create;
    myStatusBarItem.show();
    context.subscriptions.push(myStatusBarItem);

    SkillsPanel.statusBarItem = myStatusBarItem;



    // Register command: open skills editor
    let disposable = vscode.commands.registerCommand(commandIds.open, function () {
        SkillsPanel.createOrShow(context);
    });
    context.subscriptions.push(disposable);

    // Register command: import skill from file explorer right-click menu
    const importHandler = function (uri, selectedUris) {
        const uris = (selectedUris && selectedUris.length > 0) ? selectedUris : (uri ? [uri] : []);
        if (uris.length === 0) return;

        SkillsPanel.createOrShow(context);

        setTimeout(() => {
            SkillsPanel.importFromExplorer(uris.map(u => u.fsPath));
        }, 300);
    };
    let importDisposable = vscode.commands.registerCommand(commandIds.import, importHandler);
    context.subscriptions.push(importDisposable);

    // Register command: export current skill
    const exportHandler = function () {
        if (SkillsPanel.currentPanel) {
            SkillsPanel.currentPanel._exportCurrentSkill();
        }
    };
    let exportDisposable = vscode.commands.registerCommand(commandIds.export, exportHandler);
    context.subscriptions.push(exportDisposable);
}

function deactivate() { }

module.exports = {
    activate,
    deactivate
}
