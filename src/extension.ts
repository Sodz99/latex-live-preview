import * as vscode from 'vscode';
import { PreviewPanel } from './previewPanel';
import { LatexCompiler } from './latexCompiler';
import { DiagnosticParser } from './diagnostics';
import { initLog, log, showLog } from './log';

let compiler: LatexCompiler;
let diagnosticParser: DiagnosticParser;
let debounceTimer: NodeJS.Timeout | undefined;

export function activate(context: vscode.ExtensionContext) {
  initLog();
  log('Extension activated');

  const diagnosticCollection = vscode.languages.createDiagnosticCollection('latex-preview');
  diagnosticParser = new DiagnosticParser(diagnosticCollection);
  compiler = new LatexCompiler();

  context.subscriptions.push(
    vscode.commands.registerCommand('latex-preview.showPreview', () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor || editor.document.languageId !== 'latex') {
        vscode.window.showWarningMessage('Open a LaTeX file first.');
        return;
      }
      log('Command: showPreview for ' + editor.document.uri.fsPath);
      PreviewPanel.createOrShow(context, editor.document.uri);
      triggerCompile(editor.document);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('latex-preview.compile', () => {
      const editor = vscode.window.activeTextEditor;
      if (editor && editor.document.languageId === 'latex') {
        log('Command: manual compile');
        triggerCompile(editor.document);
      }
    })
  );

  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument(doc => {
      if (doc.languageId === 'latex' && PreviewPanel.currentPanel) {
        log('Save detected: ' + doc.uri.fsPath);
        triggerCompile(doc);
      }
    })
  );

  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument(event => {
      if (event.document.languageId !== 'latex' || !PreviewPanel.currentPanel) {
        return;
      }
      const config = vscode.workspace.getConfiguration('latex-preview');
      if (!config.get<boolean>('liveMode', false)) {
        return;
      }

      if (debounceTimer) {
        clearTimeout(debounceTimer);
      }
      const delay = config.get<number>('debounceDelay', 2000);
      debounceTimer = setTimeout(() => triggerCompile(event.document), delay);
    })
  );

  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(editor => {
      if (editor && editor.document.languageId === 'latex' && PreviewPanel.currentPanel) {
        PreviewPanel.currentPanel.setTexUri(editor.document.uri);
      }
    })
  );

  context.subscriptions.push(diagnosticCollection);

  // Auto-show the log panel on first activation
  showLog();
}

async function triggerCompile(doc: vscode.TextDocument) {
  const rootPath = resolveRootFile(doc);
  const panel = PreviewPanel.currentPanel;
  if (!panel) {
    log('ERROR: No preview panel open, skipping compile');
    return;
  }

  log('Compile START: ' + rootPath);
  panel.setCompiling(true);

  const t0 = Date.now();
  const result = await compiler.compile(rootPath);
  const elapsed = Date.now() - t0;

  log('Compile END: ' + (result.success ? 'SUCCESS' : 'FAILED') + ' in ' + elapsed + 'ms');

  if (result.success && result.pdfPath) {
    log('PDF path: ' + result.pdfPath);
    log('Sending PDF to webview...');
    panel.updatePdf(result.pdfPath);
    log('PDF sent to webview');
    diagnosticParser.clear();
  } else {
    log('ERROR: ' + (result.error || 'unknown'));
    if (result.log) {
      const errorLines = result.log.split('\n').filter(l =>
        l.startsWith('!') || l.includes('Error:')
      );
      if (errorLines.length > 0) {
        log('LaTeX errors:\n  ' + errorLines.join('\n  '));
      }
    }
    panel.showError(result.error || 'Compilation failed', result.log);
  }

  if (result.log) {
    diagnosticParser.parse(result.log, rootPath);
  }

  panel.setCompiling(false);
}

function resolveRootFile(doc: vscode.TextDocument): string {
  const config = vscode.workspace.getConfiguration('latex-preview');
  const configRoot = config.get<string>('rootFile', '');
  if (configRoot) {
    const path = require('path');
    if (path.isAbsolute(configRoot)) return configRoot;
    const wsFolder = vscode.workspace.getWorkspaceFolder(doc.uri);
    if (wsFolder) return path.join(wsFolder.uri.fsPath, configRoot);
  }

  const text = doc.getText();
  const match = text.match(/^%\s*!TEX\s+root\s*=\s*(.+)\s*$/m);
  if (match) {
    const path = require('path');
    const rootRef = match[1].trim();
    if (path.isAbsolute(rootRef)) return rootRef;
    return path.resolve(path.dirname(doc.uri.fsPath), rootRef);
  }

  return doc.uri.fsPath;
}

export function deactivate() {
  compiler?.kill();
  PreviewPanel.currentPanel?.dispose();

  // Clean up temp build artifacts
  const path = require('path');
  const fs = require('fs');
  const os = require('os');
  const tempOut = path.join(os.tmpdir(), 'latex-live-preview');
  try {
    if (fs.existsSync(tempOut)) {
      fs.rmSync(tempOut, { recursive: true, force: true });
      log('Cleaned up temp dir: ' + tempOut);
    }
  } catch (_) {
    // Best-effort cleanup
  }
}
