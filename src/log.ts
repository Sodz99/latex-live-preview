import * as vscode from 'vscode';

let channel: vscode.OutputChannel;

export function initLog() {
  channel = vscode.window.createOutputChannel('LaTeX Preview');
}

export function log(msg: string) {
  const ts = new Date().toISOString().slice(11, 23);
  const line = `[${ts}] ${msg}`;
  channel.appendLine(line);
  console.log(line);
}

export function showLog() {
  channel.show(true);
}
