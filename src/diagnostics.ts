import * as vscode from 'vscode';
import * as path from 'path';

export class DiagnosticParser {
  constructor(private readonly _collection: vscode.DiagnosticCollection) {}

  clear() {
    this._collection.clear();
  }

  parse(log: string, rootTexPath: string) {
    this._collection.clear();

    const diagnostics = new Map<string, vscode.Diagnostic[]>();
    const rootDir = path.dirname(rootTexPath);
    const lines = log.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Match LaTeX errors: lines starting with "!"
      // e.g. "! Undefined control sequence."
      if (line.startsWith('!')) {
        const message = line.slice(2).trim();

        // Look for the line number reference: "l.42 \badcommand"
        let lineNum = 0;
        let file = rootTexPath;
        for (let j = i + 1; j < Math.min(i + 6, lines.length); j++) {
          const lnMatch = lines[j].match(/^l\.(\d+)\s/);
          if (lnMatch) {
            lineNum = parseInt(lnMatch[1], 10) - 1; // VS Code lines are 0-indexed
            break;
          }
        }

        // Try to find the file context from the log
        // LaTeX logs show file opens as "(/path/to/file.tex"
        const fileForError = findCurrentFile(lines, i, rootDir) || rootTexPath;

        const diag = new vscode.Diagnostic(
          new vscode.Range(
            Math.max(0, lineNum), 0,
            Math.max(0, lineNum), Number.MAX_SAFE_INTEGER,
          ),
          message,
          vscode.DiagnosticSeverity.Error,
        );
        diag.source = 'LaTeX';

        const existing = diagnostics.get(fileForError) || [];
        existing.push(diag);
        diagnostics.set(fileForError, existing);
      }

      // Match LaTeX warnings
      // e.g. "LaTeX Warning: Reference `fig:foo' on page 2 undefined"
      const warnMatch = line.match(/^(?:LaTeX|Package \w+) Warning:\s*(.+)/);
      if (warnMatch) {
        let message = warnMatch[1];
        // Warnings can span multiple lines until a blank line
        for (let j = i + 1; j < lines.length; j++) {
          if (lines[j].trim() === '') break;
          message += ' ' + lines[j].trim();
        }

        const lineNumMatch = message.match(/on input line (\d+)/);
        const lineNum = lineNumMatch ? parseInt(lineNumMatch[1], 10) - 1 : 0;
        const fileForWarn = findCurrentFile(lines, i, rootDir) || rootTexPath;

        const diag = new vscode.Diagnostic(
          new vscode.Range(
            Math.max(0, lineNum), 0,
            Math.max(0, lineNum), Number.MAX_SAFE_INTEGER,
          ),
          message.replace(/\s+/g, ' ').trim(),
          vscode.DiagnosticSeverity.Warning,
        );
        diag.source = 'LaTeX';

        const existing = diagnostics.get(fileForWarn) || [];
        existing.push(diag);
        diagnostics.set(fileForWarn, existing);
      }

      // Overfull/underfull box warnings
      const boxMatch = line.match(/^(Over|Under)full \\[hv]box .+ at lines? (\d+)/);
      if (boxMatch) {
        const lineNum = parseInt(boxMatch[2], 10) - 1;
        const fileForBox = findCurrentFile(lines, i, rootDir) || rootTexPath;

        const diag = new vscode.Diagnostic(
          new vscode.Range(Math.max(0, lineNum), 0, Math.max(0, lineNum), Number.MAX_SAFE_INTEGER),
          line.trim(),
          vscode.DiagnosticSeverity.Information,
        );
        diag.source = 'LaTeX';

        const existing = diagnostics.get(fileForBox) || [];
        existing.push(diag);
        diagnostics.set(fileForBox, existing);
      }
    }

    // Apply all diagnostics
    for (const [filePath, diags] of diagnostics) {
      this._collection.set(vscode.Uri.file(filePath), diags);
    }
  }
}

/**
 * Walk backwards through the log to find the most recently opened file.
 * LaTeX logs track file opens with "(" and closes with ")".
 */
function findCurrentFile(lines: string[], upToLine: number, rootDir: string): string | null {
  let depth = 0;
  const fileStack: string[] = [];

  for (let i = 0; i <= upToLine; i++) {
    const line = lines[i];
    // Scan character by character for ( and ) tracking
    for (let c = 0; c < line.length; c++) {
      if (line[c] === '(') {
        // Check if followed by a file path
        const rest = line.slice(c + 1);
        const fileMatch = rest.match(/^(\/[^\s)]+\.tex|\.\/[^\s)]+\.tex|[^\s)]+\.tex)/);
        if (fileMatch) {
          let filePath = fileMatch[1];
          if (!path.isAbsolute(filePath)) {
            filePath = path.resolve(rootDir, filePath);
          }
          fileStack.push(filePath);
          c += fileMatch[0].length;
        }
        depth++;
      } else if (line[c] === ')') {
        if (fileStack.length > 0) fileStack.pop();
        depth--;
      }
    }
  }

  return fileStack.length > 0 ? fileStack[fileStack.length - 1] : null;
}
