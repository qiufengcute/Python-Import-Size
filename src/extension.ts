// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as path from 'path';

const outputChannel = vscode.window.createOutputChannel('Python Import Size', {
    "log": true
});

let decorationType: vscode.TextEditorDecorationType;

// Regular expression to identify import statements
const IMPORT_REGEX = /^(?:\s*)(?:from\s+([a-zA-Z_][a-zA-Z0-9_.]*)\s+)?import\s+(?:\(([^)]*)|([a-zA-Z_][a-zA-Z0-9_,\s*.]*))/;

export function activate(context: vscode.ExtensionContext) {
    outputChannel.info('Python Import Size extension is now active!');

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
                const importedModules = (match[2] || match[3]).split(',')[0].trim().split('.')[0];
                moduleName = importedModules.split(/\s+/)[0]; // Handle aliases like "import numpy as np"
            }
            
            if (moduleName) {
                // Remove any alias part ("as xyz")
                if (moduleName.includes(' as ')) {
                    moduleName = moduleName.split(' as ')[0].trim();
                }
                
                // Get size for this module
                const size = await getModuleSize(moduleName.split(".")[0]);
                
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
    try {
        // Skip if it looks like an alias
        if (moduleName.includes(' as ')) {
            moduleName = moduleName.split(' as ')[0].trim();
        }

        // Try to find the module location using Python
        const execResult = await executePythonCommand([
            '-c', 
            `import ${moduleName}
import sys
from pathlib import Path

def is_only_file_package(path):
    target = Path(path)

    for path_entry in sys.path:
        if path_entry == "":
            dir_path = Path.cwd()
        else:
            dir_path = Path(path_entry)
        
        if not dir_path.is_dir():
            continue
        
        for file in dir_path.iterdir():
            if not file.is_dir():
                if file == target:
                    return True

    return False

if is_only_file_package(${moduleName}.__file__):
    print(${moduleName}.__file__)
else:
    print(${moduleName}.__path__[0])`
        ]);

        // Log for debugging purposes
        outputChannel.info(`Checking module: ${moduleName}`);
        outputChannel.info(`Execution result: ${JSON.stringify(execResult, null, 4)}`);

        if (execResult.error) {
            // Module likely not installed
            outputChannel.warn(`Error importing module ${moduleName}: ${execResult.stderr}`);
            return undefined;
        }

        if (execResult.stdout.trim()) {
            const modulePath = execResult.stdout.trim();
            outputChannel.info(`Found module path for ${moduleName}: ${modulePath}`);

            // Verify the path exists before calculating size
            try {
                const size = await calculateSize(modulePath);
                
                outputChannel.info(`Calculated size for ${moduleName}: ${size} bytes`);
                return size;
            } catch {
                outputChannel.warn(`Module path does not exist: ${modulePath}`);
                return undefined;
            }
        } else {
            // Unexpected case
            outputChannel.warn(`Unexpected output for module ${moduleName}: ${execResult.stdout}`);
            return undefined;
        }
    } catch (error) {
        outputChannel.error(`Exception getting module size for ${moduleName}:`, error);
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

async function calculateSize(dirPath: string): Promise<number> {
    try {
        const stats = await fs.stat(dirPath);
        
        if (stats.isFile()) {
            return stats.size;
        }
        
        if (stats.isDirectory()) {
            let totalSize = 0;
            const entries = await fs.readdir(dirPath);
            
            for (const entry of entries) {
                const fullPath = path.join(dirPath, entry);
                totalSize += await calculateSize(fullPath);
            }
            
            return totalSize;
        }
        
        return 0;
    } catch {
        return 0;
    }
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
