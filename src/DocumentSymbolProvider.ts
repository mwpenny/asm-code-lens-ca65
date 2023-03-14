import * as vscode from 'vscode';
import {stripAllComments} from './comments';
import {Config} from './config';
import {SymbolRegexes} from './regexes/symbolregexes';
import {CommonRegexes} from './regexes/commonregexes';



/**
 * ReferenceProvider for assembly language.
 */
export class DocumentSymbolProvider implements vscode.DocumentSymbolProvider {
    /**
     * Called by vscode to provide symbol information for the given document.
     * I.e. returns all labels of a document.
     *
     * @param document The document in which the command was invoked.
     * @param token A cancellation token.
     * @return An array of document highlights or a thenable that resolves to such. The lack of a result can be
     * signaled by returning `undefined`, `null`, or an empty array.
     */
    public provideDocumentSymbols(document: vscode.TextDocument, token: vscode.CancellationToken): vscode.ProviderResult<vscode.SymbolInformation[] | vscode.DocumentSymbol[]> {
        // Check which workspace
        const config = Config.getConfigForDoc(document);
        if (!config?.enableOutlineView)
            return undefined;   // Don't provide any outline

        // Loops through the whole document line by line and
        // extracts the labels.
        // Determines for each label if it is code-label,
        // a code-relative-label, an const-label (EQU) or a
        // data-label and creates symbols for each.
        // Those symbols are returned.
        const languageId = document.languageId;
        let symbols: vscode.DocumentSymbol[] = [];
        const regexLabel = CommonRegexes.regexLabel(config, languageId);

        const regexModule = SymbolRegexes.regexModuleLabel();
        const regexStruct = SymbolRegexes.regexStructLabel();

        const regexCA65 = CommonRegexes.regexAllCA65Directives();
        const regexCA65BlockEnd = CommonRegexes.regexCA65BlockEnd();

        //const regexNotLabels = /^(include|if|endif|else|elif)$/i;
        const excludes = ['include', ...config.labelsExcludes];
        const regexConst = SymbolRegexes.regexConst();
        const regexData = SymbolRegexes.regexData();
        const regexMacro = SymbolRegexes.regexMacro(languageId);
        let lastSymbol;
        let lastSymbols = new Array<vscode.DocumentSymbol>();
        let lastAbsSymbolChildren;
        let lastModules = new Array<vscode.DocumentSymbol>();
        let defaultSymbolKind = vscode.SymbolKind.Function;

        // Strip all comments
        const lines = document.getText().split('\n');
        stripAllComments(lines);

        // Go through all lines
        const len = lines.length;
        for (let line = 0; line < len; line++) {
            let lineContents = lines[line];

            const match = regexLabel.exec(lineContents);
            if (match) {
                // It is a label or module (or both)
                const labelPlus = match[0].trimEnd(); // Label plus e.g. ': '
                const label = match[1] + match[2]; // Label without ':'

                // Check that label is not excluded
                if (!excludes.includes(label)) {
                    // Check for label
                    // Create range
                    const range = new vscode.Range(line, 0, line, 10000);
                    const selRange = range; //new vscode.Range(line, 0, line, 3);

                    // Create Symbol
                    lastSymbol = new vscode.DocumentSymbol(label, '', defaultSymbolKind, range, selRange);
                    lastSymbols.push(lastSymbol);

                    // Insert as absolute or relative label
                    if (label.startsWith('.')) {
                        // Relative label
                        lastAbsSymbolChildren?.push(lastSymbol);
                    }
                    else if (!config.enableCA65CheapLocalLabelNestingInOutline && label.startsWith('@')) {
                        // Absolute label ignoring MODULE
                        symbols.push(lastSymbol);
                    }
                    else {
                        // Absolute label
                        // Add to children of last module
                        const len = lastModules.length;
                        if (len > 0) {
                            const lastModule = lastModules[len - 1];
                            lastModule.children.push(lastSymbol);
                        }
                        else {
                            symbols.push(lastSymbol);
                        }
                        lastAbsSymbolChildren = lastSymbol.children;
                    }

                    // Remove label from line contents.
                    const len = labelPlus.length;
                    lineContents = lineContents.substring(len);
                    // Add a whitespace to recognize a directly following MODULE
                    lineContents += ' ';
                }
            }

            // Check for CA65-style directives
            const matchCA65 = regexCA65.exec(lineContents);
            if (matchCA65) {
                const directive = matchCA65[1].toLowerCase().trim();
                const symbolName = matchCA65[2];

                const range = new vscode.Range(line, 0, line, 10000);
                const ca65Symbol = new vscode.DocumentSymbol(symbolName, '', vscode.SymbolKind.Method, range, range);

                if (lastModules.length > 0) {
                    // Add to children of last module
                    const lastModule = lastModules[lastModules.length - 1];
                    lastModule.children.push(ca65Symbol);
                } else {
                    symbols.push(ca65Symbol);
                }

                const canHaveChildren = !directive.startsWith(".define");
                if (canHaveChildren) {
                    lastModules.push(ca65Symbol);
                }
            } else {
                const matchCA65BlockEnd = regexCA65BlockEnd.exec(lineContents);
                if (matchCA65BlockEnd) {
                    lastModules.pop();
                    lastAbsSymbolChildren = undefined;
                }
            }

            // Check for MACRO
            if (regexMacro) {
                const matchMacro = regexMacro.exec(lineContents);
                if (matchMacro) {
                    const macroName = matchMacro[2];
                    const range = new vscode.Range(line, 0, line, 10000);
                    const macroSymbol = new vscode.DocumentSymbol(macroName, '', vscode.SymbolKind.Method, range, range);
                    symbols.push(macroSymbol);
                }
                continue;
            }

            // Now check for MODULE or STRUCT
            let matchModule = regexModule.exec(lineContents);
            if (!matchModule)
                matchModule = regexStruct.exec(lineContents);
            if (matchModule) {
                const keyword = matchModule[1].toLowerCase();
                const moduleName = matchModule[2];
                if (moduleName) {
                    // Handle MODULE
                    // Create range
                    const range = new vscode.Range(line, 0, line, 10000);
                    // Create symbol
                    const kind = (keyword.startsWith("module")) ? vscode.SymbolKind.Module : vscode.SymbolKind.Struct;
                    const moduleSymbol = new vscode.DocumentSymbol(moduleName, '', kind, range, range);
                    // Add to children of last module
                    const len = lastModules.length;
                    if (len > 0) {
                        const lastModule = lastModules[len - 1];
                        lastModule.children.push(moduleSymbol);
                    }
                    else {
                        symbols.push(moduleSymbol);
                    }
                    lastModules.push(moduleSymbol);
                }

                // Check for ENDMODULE
                if (keyword == "endmodule" || keyword == "ends") {
                    // Handle ENDMODULE
                    lastModules.pop();
                    lastAbsSymbolChildren = undefined;
                }

                lastSymbol = undefined;
                lastSymbols.length = 0;
                continue;
            }

            // Trim
            lineContents = lineContents.trim();
            // Now check which kind of data it is:
            // code, const or data
            if (!lineContents)
                defaultSymbolKind = vscode.SymbolKind.Function;
            if (lastSymbol) {
                if (lineContents) {
                    let kind;
                    // Check for EQU
                    let match = regexConst.exec(lineContents);
                    if (match) {
                        // It's const data, e.g. EQU
                        kind = vscode.SymbolKind.Constant
                    }
                    else {
                        // Check for data
                        match = regexData.exec(lineContents);
                        if (match) {
                            // It's data data, e.g. defb
                            kind = vscode.SymbolKind.Field;
                        }
                    }
                    // Check if found
                    if (kind != undefined) {
                        // It's something else than code
                        for (const elem of lastSymbols) {
                            elem.kind = kind;
                            elem.detail = match![1] + ' ' + match![2].trimEnd();
                        }
                        defaultSymbolKind = kind;
                    }
                    // Something different, so assume code
                    lastSymbol = undefined;
                    lastSymbols.length = 0;
                    continue;
                }
            }
        }
        return symbols;
    }
}
