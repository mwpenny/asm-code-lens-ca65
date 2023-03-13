import { AllowedLanguageIds } from './languageId';
import * as vscode from 'vscode';
import {Config} from './config';
import {CommonRegexes} from './regexes/commonregexes';
import {CompletionRegexes} from './regexes/completionregexes';
import {grepMultiple} from './grep';



/**
 * The WorkspaceSymbolProvider.
 * In a multiroot environment the WorkspaceSymbolProvider can take quite some time.
 * E.g. 5 secs.
 * Therefore the following restrictions have been used to not increase the search time further:
 * 1. The Symbol-kind is undefined, so that vscode does not show any symbol
 * Recognizing the correct symbol would be quite complicated as it depends also on
 * the previous lines (e.g. data vs. function).
 * 2. MODULE information is not extracted. This would also require more analyzes
 * on the file.
 * The benefit for both is quite minimal, so it has been dropped.
 */
export class WorkspaceSymbolProvider implements vscode.WorkspaceSymbolProvider {

    /**
     * Project-wide search for a symbol matching the given query string.
     *
     * The `query`-parameter should be interpreted in a *relaxed way* as the editor will apply its own highlighting
     * and scoring on the results. A good rule of thumb is to match case-insensitive and to simply check that the
     * characters of *query* appear in their order in a candidate symbol. Don't use prefix, substring, or similar
     * strict matching.
     *
     * To improve performance implementors can implement `resolveWorkspaceSymbol` and then provide symbols with partial
     * {SymbolInformation.location location}-objects, without a `range` defined. The editor will then call
     * `resolveWorkspaceSymbol` for selected symbols only, e.g. when opening a workspace symbol.
     *
     * @param query A query string, can be the empty string in which case all symbols should be returned.
     * @param token A cancellation token.
     * @return An array of document highlights or a thenable that resolves to such. The lack of a result can be
     * signaled by returning `undefined`, `null`, or an empty array.
     */
    public provideWorkspaceSymbols(query: string, token: vscode.CancellationToken): vscode.ProviderResult<vscode.SymbolInformation[]> {
        return new Promise<vscode.ProviderResult<vscode.SymbolInformation[]>>(async resolve => {
            const symbols: vscode.SymbolInformation[] = [];

            // Get a list of workspaces folders
            const wsFolders = vscode.workspace.workspaceFolders;
            if (wsFolders) {
                // Check each
                const len = query.length;
                for (const ws of wsFolders) {
                    // Check for cancellation (e.g. another key was typed)
                    if (token.isCancellationRequested) {
                        resolve(undefined);
                        return;
                    }

                    // Check if enabled
                    const config = Config.configs.get(ws.uri.fsPath);
                    if (!config?.enableWorkspaceSymbols)
                        continue;   // Skip

                    // Get required length
                    const requiredLen = config.workspaceSymbolsRequiredLength;
                    if (len < requiredLen)
                        continue;   // Skip

                    // Get all symbols
                    const wsSymbols = await this.getWsSymbols(config, query);
                    symbols.push(...wsSymbols);
                }
            }

            resolve(symbols);
        });
    }


    /** Returns the symbols found in one workspace folder that match the query.
     * @param config The workspace configuration (includes workspace folder.
     * @param query The query to check for symbols.
     */
    protected async getWsSymbols(config: Config, query: string): Promise<vscode.SymbolInformation[]> {
        // Allow symbols only for asm files (not list files)
        const languageId: AllowedLanguageIds = 'asm-collection';

        // Prepare search
        const fuzzySearchWord = CommonRegexes.regexPrepareFuzzy(query);

        // regexes for labels with and without colon
        const regexes = CompletionRegexes.regexesEveryLabelForWord(fuzzySearchWord, config, languageId);
        // Find all sjasmplus MODULEs in the document
        const searchSjasmModule = CompletionRegexes.regexEveryModuleForWord(fuzzySearchWord, languageId);
        regexes.push(searchSjasmModule);
        // Find all sjasmplus MACROs in the document
        const searchSjasmMacro = CompletionRegexes.regexEveryMacroForWord(fuzzySearchWord, languageId);
        regexes.push(searchSjasmMacro);
        // Find all CA65 directives in the document
        const searchCA65 = CommonRegexes.regexCA65DirectiveForWord(fuzzySearchWord, true);
        regexes.push(searchCA65);

        const locations = await grepMultiple(regexes, config.wsFolderPath, languageId, config.excludeFiles);

        // Go through all found locations
        const symbols: vscode.SymbolInformation[] = [];
        for (const loc of locations) {
            const text = loc.symbol;
            if (config.labelsExcludes.includes(text))
                continue;   // Skip if excluded

            // Add to symbol list
            const location = new vscode.Location(loc.uri, loc.range);
            const symb = new vscode.SymbolInformation(text, undefined as any, '', location);
            symbols.push(symb);
        }

        return symbols;
    }
}
