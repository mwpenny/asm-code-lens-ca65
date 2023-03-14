import * as vscode from 'vscode';
import {ReferenceProvider} from './ReferenceProvider';
import {DefinitionProvider} from './DefinitionProvider';
import {HoverProvider} from './HoverProvider';
import {CodeLensProvider} from './CodeLensProvider';
import {RenameProvider} from './RenameProvider';
import {DocumentSymbolProvider} from './DocumentSymbolProvider';
import {CompletionProposalsProvider} from './CompletionProposalsProvider';
import {Commands} from './Commands';
import {setCustomCommentPrefix} from './comments';
import {HexCalcProvider} from './HexCalcProvider';
import {WhatsNewView} from './whatsnew/whatsnewview';
import {PackageInfo} from './whatsnew/packageinfo';
import {GlobalStorage} from './globalstorage';
import {Config} from './config';
import {DonateInfo} from './donate/donateinfo';
import {WorkspaceSymbolProvider} from './WorkspaceSymbolProvider';
import {FoldingProvider} from './FoldingRangeProvider';
import {LanguageId} from './languageId';



export function activate(context: vscode.ExtensionContext) {

    // Init package info
    PackageInfo.Init(context);

    // Init global storage
    GlobalStorage.Init(context);

    // Check version for donate info
    DonateInfo.checkVersion();

    // Check version and show 'What's new' if necessary.
    const mjrMnrChanged = WhatsNewView.updateVersion();
    if (mjrMnrChanged) {
        // Major or minor version changed so show the whatsnew page.
        new WhatsNewView(); // NOSONAR
    }
    // Register the additional command to view the "Whats' New" page.
    context.subscriptions.push(vscode.commands.registerCommand("asm-code-lens.whatsNew", () => new WhatsNewView()));


    // Register the hex calculator webviews
    hexCalcExplorerProvider = new HexCalcProvider();
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider("asm-code-lens.calcview-explorer", hexCalcExplorerProvider, {webviewOptions: {retainContextWhenHidden: true}})
    );
    hexCalcDebugProvider = new HexCalcProvider();
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider("asm-code-lens.calcview-debug", hexCalcDebugProvider, {webviewOptions: {retainContextWhenHidden: true}})
    );

    // Enable logging.
    configure(context);

    // Check for every change.
    context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(event => {
        configure(context, event);
    }));

    // Check for added/removed workspace folders.
    context.subscriptions.push(vscode.workspace.onDidChangeWorkspaceFolders(event => {
        // Simply removes and re-inits all workspace folders.
        configure(context);
        // Note: in my tests together with this event a 'onDidChangeConfiguration' was sent.
        // But because I'm not sure if that would always be the case I also
        // check for the 'onDidChangeWorkspaceFolders' event.
    }));

    // Register commands.
    vscode.commands.registerCommand('asm-code-lens.find-labels-with-no-reference', async () => {
        // Get current text editor to get current project/root folder.
        const editor = vscode.window.activeTextEditor;
        const doc = editor?.document;
        if (!doc)
            return;

        // Check which workspace
        const config = Config.getConfigForDoc(doc);
        if (!config)
            return;

        // Check if document matches configured selector
        const includePattern = new vscode.RelativePattern(doc.uri, config.includeFiles);
        const docIsIncluded = vscode.languages.match(includePattern, doc) > 0;
        if (!docIsIncluded)
            return;

        const languageId = doc.languageId;

        // Found. Find labels
        await Commands.findLabelsWithNoReference(config, languageId);
    });
}


/**
 * Reads the configuration.
 */
function configure(context: vscode.ExtensionContext, event?: vscode.ConfigurationChangeEvent) {
    // Note: configuration preferences scopes
    // - "window": user, workspace or remote.
    // - "resource": user, workspace, folder or remote.
    // - "application": user only.
    // So in multiroot different workspaces have different settings.

    // Check for the hex calculator params
    if (event) {
        if (event.affectsConfiguration('asm-code-lens.hexCalculator.hexPrefix')
            || event.affectsConfiguration('asm-code-lens.donated')) {
            // Update the hex calculators
            if (hexCalcExplorerProvider)
                hexCalcExplorerProvider.setMainHtml();
            if (hexCalcDebugProvider)
                hexCalcDebugProvider.setMainHtml();
            // Update the donate info
            DonateInfo.donatedPreferencesChanged();
        }
    }

    // Dispose (remove, deregister) all providers
    removeProvider(regCodeLensProvider, context);
    removeProvider(regHoverProvider, context);
    removeProvider(regCompletionProposalsProvider, context);
    removeProvider(regDefinitionProvider, context);
    removeProvider(regReferenceProvider, context);
    removeProvider(regRenameProvider, context);
    removeProvider(regDocumentSymbolProvider, context);
    removeProvider(regWorkspaceSymbolProvider, context);
    removeProvider(regFoldingProvider, context);

    // Re-read settings for all workspaces.
    Config.init();

    const asmSourceFiles: vscode.DocumentFilter[] = [
        {scheme: "file", language: LanguageId.ASM_COLLECTION}
    ];

    // Add configured filter for each workspace
    const workspaceFolders = vscode.workspace.workspaceFolders || [];
    for (const workspaceFolder of workspaceFolders) {
        const workspaceConfig = Config.getConfigForWorkspace(workspaceFolder);

        if (workspaceConfig) {
            const pattern = new vscode.RelativePattern(
                workspaceFolder,
                workspaceConfig.includeFiles
            );
            asmSourceFiles.push({ scheme: "file", pattern })
        }
    }

    // Both "languages": asm files and list files.
    const asmListFiles: vscode.DocumentFilter[] = [
        ...asmSourceFiles,
        {scheme: "file", language: LanguageId.ASM_LIST_FILE}
    ];

    // Multiroot: One provider for all workspace folders:

    // Register
    if (Config.globalEnableCodeLenses) {
        const codeLensProvider = new CodeLensProvider();
        regCodeLensProvider = vscode.languages.registerCodeLensProvider(asmListFiles, codeLensProvider);
        context.subscriptions.push(regCodeLensProvider);
    }

    // Register
    if (Config.globalEnableHovering) {
        regHoverProvider = vscode.languages.registerHoverProvider(asmListFiles, new HoverProvider());
        context.subscriptions.push(regHoverProvider);
    }

    // Register
    if (Config.globalEnableCompletions) {
        regCompletionProposalsProvider = vscode.languages.registerCompletionItemProvider(asmListFiles, new CompletionProposalsProvider());
        context.subscriptions.push(regCompletionProposalsProvider);
    }

    // Register
    if (Config.globalEnableGotoDefinition) {
        regDefinitionProvider = vscode.languages.registerDefinitionProvider(asmListFiles, new DefinitionProvider());
        context.subscriptions.push(regDefinitionProvider);
    }

    // Register
    if (Config.globalEnableFindAllReferences) {
        regReferenceProvider = vscode.languages.registerReferenceProvider(asmListFiles, new ReferenceProvider());
        context.subscriptions.push(regReferenceProvider);
    }

    // Register
    if (Config.globalEnableRenaming) {
        regRenameProvider = vscode.languages.registerRenameProvider(asmListFiles, new RenameProvider());
        context.subscriptions.push(regRenameProvider);
    }

    // Register
    if (Config.globalEnableOutlineView) {
        regDocumentSymbolProvider = vscode.languages.registerDocumentSymbolProvider(asmListFiles, new DocumentSymbolProvider());
        context.subscriptions.push(regDocumentSymbolProvider);
    }

    // Register
    if (Config.globalEnableWorkspaceSymbols) {
        regWorkspaceSymbolProvider = vscode.languages.registerWorkspaceSymbolProvider(new WorkspaceSymbolProvider());
        context.subscriptions.push(regWorkspaceSymbolProvider);
    }

    // Register (always, even if disabled)
    {
        regFoldingProvider = vscode.languages.registerFoldingRangeProvider(asmSourceFiles, new FoldingProvider());
        context.subscriptions.push(regFoldingProvider);
    }

    // Toggle line Comment configuration
    for (const fileType of asmSourceFiles) {
        vscode.languages.setLanguageConfiguration(fileType.language as string, {comments: {lineComment: Config.globalToggleCommentPrefix}});
    }

    // Store
    setCustomCommentPrefix(Config.globalToggleCommentPrefix);
}


/**
 * Removes a provider.
 * Disposes it and removes it from subscription list.
 */
function removeProvider(pv: vscode.Disposable|undefined, context: vscode.ExtensionContext) {
    if (pv) {
        pv.dispose();
        const i = context.subscriptions.indexOf(pv);
        context.subscriptions.splice(i, 1);
    }
}


let hexCalcExplorerProvider;
let hexCalcDebugProvider;
let regCodeLensProvider: vscode.Disposable;
let regHoverProvider: vscode.Disposable;
let regCompletionProposalsProvider: vscode.Disposable;
let regDefinitionProvider: vscode.Disposable;
let regReferenceProvider: vscode.Disposable;
let regRenameProvider: vscode.Disposable;
let regDocumentSymbolProvider: vscode.Disposable;
let regWorkspaceSymbolProvider: vscode.Disposable;
let regFoldingProvider: vscode.Disposable;


// this method is called when your extension is deactivated
/*
export function deactivate() {
}
*/
