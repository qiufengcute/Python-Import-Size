// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

let decorationType: vscode.TextEditorDecorationType;
const importSizesCache = new Map<string, number>(); // Cache for storing import sizes

// Regular expression to identify import statements
const IMPORT_REGEX = /^(?:\s*)(?:from\s+([a-zA-Z_][a-zA-Z0-9_.]*)\s+)?import\s+([a-zA-Z_][a-zA-Z0-9_,\s*.]*)(?:\s+.*)?$/;

export function activate(context: vscode.ExtensionContext) {
    console.log('Python Import Size extension is now active!');

    // Create decoration type for displaying import sizes
    decorationType = vscode.window.createTextEditorDecorationType({
        after: {
            margin: '0 0 0 3em',
            textDecoration: 'none; opacity: 0.7;',
            fontWeight: 'normal'
        },
        rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed
    });

    // Register command to manually refresh import sizes
    const refreshCommand = vscode.commands.registerCommand('python-import-size.refresh', () => {
        updateImportSizeDecorations();
    });
    
    context.subscriptions.push(refreshCommand);

    // Listen for document changes to update decorations automatically
    const docChangeDisposable = vscode.workspace.onDidChangeTextDocument((event) => {
        if (event.document.languageId === 'python') {
            setTimeout(() => updateImportSizeDecorations(), 500); // Delay to allow full document update
        }
    });

    // Listen for editor changes to apply decorations to visible editors
    const editorChangeDisposable = vscode.window.onDidChangeActiveTextEditor((editor) => {
        if (editor && editor.document.languageId === 'python') {
            setTimeout(() => updateImportSizeDecorations(editor), 100);
        }
    });

    context.subscriptions.push(docChangeDisposable, editorChangeDisposable);

    // Process currently opened Python documents
    vscode.window.visibleTextEditors.forEach(editor => {
        if (editor.document.languageId === 'python') {
            updateImportSizeDecorations(editor);
        }
    });
}

async function updateImportSizeDecorations(editor?: vscode.TextEditor) {
    if (!editor) {
        editor = vscode.window.activeTextEditor;
    }

    if (!editor || editor.document.languageId !== 'python') {
        return;
    }

    const document = editor.document;
    const decorations: vscode.DecorationOptions[] = [];

    for (let i = 0; i < document.lineCount; i++) {
        const line = document.lineAt(i);
        const text = line.text.trim();

        // Check if this line contains an import statement
        const match = text.match(IMPORT_REGEX);
        
        if (match) {
            let moduleName: string | null = null;
            
            // Extract module name depending on import type
            if (match[1]) { // from ... import ...
                moduleName = match[1];
            } else { // import ...
                // Get the first module name if there are multiple imports
                const importedModules = match[2].split(',')[0].trim().split('.')[0];
                moduleName = importedModules.split(/\s+/)[0]; // Handle aliases like "import numpy as np"
            }
            
            if (moduleName) {
                // Remove any alias part ("as xyz")
                if (moduleName.includes(' as ')) {
                    moduleName = moduleName.split(' as ')[0].trim();
                }
                
                // Get size for this module
                const size = await getModuleSize(moduleName);
                
                if (size !== undefined) {
                    const sizeString = formatBytes(size);
                    
                    // Position decoration at the end of the line
                    const position = new vscode.Position(i, line.range.end.character);
                    const decorationOption: vscode.DecorationOptions = {
                        range: new vscode.Range(position, position),
                        renderOptions: {
                            after: {
                                contentText: ` ≈ ${sizeString}`,
                                color: '#666666',
                                fontStyle: 'italic'
                            }
                        }
                    };
                    
                    decorations.push(decorationOption);
                }
            }
        }
    }

    // Apply decorations to the editor
    editor.setDecorations(decorationType, decorations);
}

/**
 * Gets the size of a Python module in bytes
 */
async function getModuleSize(moduleName: string): Promise<number | undefined> {
    // Check cache first
    if (importSizesCache.has(moduleName)) {
        return importSizesCache.get(moduleName);
    }

    try {
        // Skip if it looks like an alias
        if (moduleName.includes(' as ')) {
            moduleName = moduleName.split(' as ')[0].trim();
        }

        // Try to find the module location using Python
        const pythonPath = getPythonPath();
        const execResult = await executePythonCommand([
            '-c', 
            `import ${moduleName}; import os; print(os.path.dirname(${moduleName}.__file__) if hasattr(${moduleName}, '__file__') and ${moduleName}.__file__ is not None else "BUILTIN")`
        ]);

        // Log for debugging purposes
        console.log(`Checking module: ${moduleName}`);
        console.log(`Execution result:`, execResult);

        if (execResult.error) {
            // Module likely not installed
            console.log(`Error importing module ${moduleName}: ${execResult.stderr}`);
            return undefined;
        }

        if (execResult.stdout.trim() === 'BUILTIN' || !execResult.stdout.trim()) {
            // Module is built-in or doesn't have physical files
            const size = 0;
            importSizesCache.set(moduleName, size);
            return size;
        } else if (execResult.stdout.trim()) {
            const modulePath = execResult.stdout.trim();
            console.log(`Found module path for ${moduleName}: ${modulePath}`);

            // Verify the path exists before calculating size
            if (fs.existsSync(modulePath)) {
                const size = await calculateDirectorySize(modulePath);
                
                // Cache the result
                importSizesCache.set(moduleName, size);
                console.log(`Calculated size for ${moduleName}: ${size} bytes`);
                return size;
            } else {
                console.log(`Module path does not exist: ${modulePath}`);
                return undefined;
            }
        } else {
            // Unexpected case
            console.log(`Unexpected output for module ${moduleName}: ${execResult.stdout}`);
            return undefined;
        }
    } catch (error) {
        console.error(`Exception getting module size for ${moduleName}:`, error);
        // Could not determine module size, possibly because:
        // - Module is not installed
        // - Module is built-in
        // - Other error
        
        // We won't cache negative results since they might change
        return undefined;
    }
}

function getPythonPath(): string {
    // Try common Python executable names
    const possiblePaths = ['python3', 'python'];
    
    for (const pyPath of possiblePaths) {
        try {
            require('child_process').execSync(`${pyPath} --version`);
            return pyPath;
        } catch (e) {
            continue;
        }
    }
    
    // Default fallback
    return 'python3';
}

import * as cp from 'child_process';

function executePythonCommand(args: string[]): Promise<{ stdout: string; stderr: string; error?: any }> {
    return new Promise((resolve) => {
        const pythonPath = getPythonPath();
        
        cp.execFile(pythonPath, args, (error: any, stdout: string, stderr: string) => {
            if (error) {
                resolve({ stdout: '', stderr, error });
            } else {
                resolve({ stdout, stderr });
            }
        });
    });
}

async function calculateDirectorySize(dirPath: string): Promise<number> {
    if (!fs.existsSync(dirPath)) {
        return 0;
    }

    let totalSize = 0;
    const entries = fs.readdirSync(dirPath);

    for (const entry of entries) {
        const fullPath = path.join(dirPath, entry);
        const stat = fs.statSync(fullPath);

        if (stat.isDirectory()) {
            totalSize += await calculateDirectorySize(fullPath);
        } else if (stat.isFile()) {
            totalSize += stat.size;
        }
    }

    return totalSize;
}

function formatBytes(bytes: number): string {
    if (bytes === 0) return '0 Bytes';
    
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    
    if (i === 0) {
        return `${bytes} ${sizes[i]}`;
    }
    
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

// This method is called when your extension is deactivated
export function deactivate() {
    decorationType.dispose();
}
