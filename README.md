# LaTeX Live Preview

A VS Code extension that compiles LaTeX to PDF and shows the result side-by-side, recompiling automatically — an Overleaf-style workflow inside VS Code.

## Features
- **Live preview panel** next to the editor (`Ctrl+Alt+V` / `Cmd+Alt+V`)
- **Compile on save**, or **live mode** that recompiles as you type (debounced, default 2 s)
- **Engines:** `pdflatex`, `xelatex`, `lualatex`, optionally through `latexmk` for multi-file projects
- **Root-file detection** from the `%!TEX root` magic comment, or set it manually
- **Diagnostics:** LaTeX errors and warnings from the log appear in the VS Code Problems panel, with SyncTeX enabled

## Settings
| Setting | Default | What it does |
|---|---|---|
| `latex-preview.engine` | `pdflatex` | Compilation engine |
| `latex-preview.useLatexmk` | `true` | Use latexmk (recommended for multi-file projects) |
| `latex-preview.liveMode` | `false` | Recompile while typing instead of only on save |
| `latex-preview.debounceDelay` | `2000` | Delay in ms before recompiling in live mode |
| `latex-preview.rootFile` | — | Root `.tex` file (auto-detected if empty) |

## Install
Download the `.vsix` from [Releases](../../releases) and run:
```bash
code --install-extension latex-live-preview-0.0.1.vsix
```
Requires a TeX distribution (TeX Live or MiKTeX) on your PATH.

## Build from source
```bash
npm install
npm run compile      # or: npm run watch
npm run package      # builds the .vsix with vsce
```
Press `F5` in VS Code to launch an Extension Development Host; `test/sample.tex` is a sample document.

## Project structure
```
src/
  extension.ts      activation, commands, save / live-mode triggers
  latexCompiler.ts  runs latexmk / the engine with SyncTeX
  previewPanel.ts   webview that renders the PDF
  diagnostics.ts    parses the LaTeX log into VS Code diagnostics
  log.ts            output-channel logging
```

## Tech stack
TypeScript · VS Code Extension API · latexmk
