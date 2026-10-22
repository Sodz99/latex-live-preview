import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { log } from './log';

export class PreviewPanel {
  static currentPanel: PreviewPanel | undefined;

  private readonly _panel: vscode.WebviewPanel;
  private readonly _context: vscode.ExtensionContext;
  private _texUri: vscode.Uri;
  private _disposables: vscode.Disposable[] = [];

  private constructor(
    panel: vscode.WebviewPanel,
    context: vscode.ExtensionContext,
    texUri: vscode.Uri,
  ) {
    this._panel = panel;
    this._context = context;
    this._texUri = texUri;

    this._panel.onDidDispose(() => this._dispose(), null, this._disposables);

    // Listen for log messages from the webview
    this._panel.webview.onDidReceiveMessage(
      (msg) => {
        if (msg.type === 'log') {
          log('[webview] ' + msg.text);
        }
      },
      null,
      this._disposables,
    );

    this._panel.webview.html = this._getHtml();
  }

  static createOrShow(context: vscode.ExtensionContext, texUri: vscode.Uri) {
    if (PreviewPanel.currentPanel) {
      PreviewPanel.currentPanel._texUri = texUri;
      PreviewPanel.currentPanel._panel.reveal(vscode.ViewColumn.Beside);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      'latexPreview',
      'LaTeX Preview',
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.joinPath(context.extensionUri, 'node_modules', 'pdfjs-dist'),
        ],
      },
    );

    PreviewPanel.currentPanel = new PreviewPanel(panel, context, texUri);
  }

  setTexUri(uri: vscode.Uri) {
    this._texUri = uri;
  }

  setCompiling(compiling: boolean) {
    this._panel.webview.postMessage({
      type: compiling ? 'compiling' : 'idle',
    });
  }

  updatePdf(pdfPath: string) {
    const pdfData = fs.readFileSync(pdfPath);
    const base64 = pdfData.toString('base64');
    log('Sending PDF as base64, length: ' + base64.length);
    this._panel.webview.postMessage({
      type: 'pdf',
      data: base64,
    });
  }

  showError(message: string, logText?: string) {
    this._panel.webview.postMessage({
      type: 'error',
      message,
      log: logText || '',
    });
  }

  dispose() {
    this._dispose();
  }

  private _dispose() {
    PreviewPanel.currentPanel = undefined;
    this._panel.dispose();
    this._disposables.forEach((d) => d.dispose());
    this._disposables = [];
  }

  private _getHtml(): string {
    const webview = this._panel.webview;
    const nonce = getNonce();

    const pdfjsPath = vscode.Uri.joinPath(
      this._context.extensionUri, 'node_modules', 'pdfjs-dist', 'legacy', 'build',
    );
    const pdfjsUri = webview.asWebviewUri(vscode.Uri.joinPath(pdfjsPath, 'pdf.min.mjs'));
    const workerUri = webview.asWebviewUri(vscode.Uri.joinPath(pdfjsPath, 'pdf.worker.min.mjs'));

    return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none';
             script-src 'nonce-${nonce}' ${webview.cspSource};
             style-src 'nonce-${nonce}';
             img-src data: blob:;
             worker-src blob: ${webview.cspSource};
             connect-src ${webview.cspSource};">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>LaTeX Preview</title>
  <style nonce="${nonce}">
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      background: #1e1e1e;
      color: #ccc;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      height: 100vh;
      display: flex;
      flex-direction: column;
    }
    #toolbar {
      padding: 6px 12px;
      background: #2d2d2d;
      border-bottom: 1px solid #444;
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 12px;
      flex-shrink: 0;
    }
    #status { flex: 1; }
    #status.compiling { color: #f0a500; }
    #status.error { color: #f44; }
    #status.ok { color: #4ec9b0; }
    button {
      background: #3a3a3a;
      border: 1px solid #555;
      color: #ccc;
      padding: 3px 10px;
      cursor: pointer;
      border-radius: 3px;
      font-size: 11px;
    }
    button:hover { background: #505050; }
    #viewer {
      flex: 1;
      overflow: auto;
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: 16px;
      gap: 12px;
    }
    #error-box {
      display: none;
      background: #2a0000;
      border: 1px solid #f44;
      border-radius: 4px;
      padding: 12px;
      font-family: 'Cascadia Code', 'Fira Code', monospace;
      font-size: 11px;
      white-space: pre-wrap;
      max-height: 200px;
      overflow: auto;
      width: 100%;
      max-width: 900px;
      color: #f88;
    }
    canvas {
      box-shadow: 0 2px 12px rgba(0,0,0,0.6);
      background: white;
    }
    #page-info { font-size: 12px; color: #888; }
    .spinner {
      display: none;
      width: 14px; height: 14px;
      border: 2px solid #555;
      border-top: 2px solid #f0a500;
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
    }
    .spinner.active { display: inline-block; }
    @keyframes spin { to { transform: rotate(360deg); } }
  </style>
</head>
<body>
  <div id="toolbar">
    <div class="spinner" id="spinner"></div>
    <span id="status">Loading PDF.js...</span>
    <button id="zoom-out" title="Zoom out">&#8722;</button>
    <span id="zoom-label">100%</span>
    <button id="zoom-in" title="Zoom in">+</button>
    <button id="fit-width">Fit Width</button>
    <span id="page-info"></span>
  </div>
  <div id="viewer">
    <div id="error-box"></div>
    <div id="canvas-container"></div>
  </div>

  <script nonce="${nonce}">
    // Logging bridge: sends log messages back to the extension
    var vscodeApi = acquireVsCodeApi();
    function wvlog(msg) {
      vscodeApi.postMessage({ type: 'log', text: msg });
    }

    wvlog('Webview script starting...');

    (async function() {
      wvlog('Importing PDF.js from: ${pdfjsUri}');
      var pdfjsLib;
      try {
        pdfjsLib = await import('${pdfjsUri}');
        wvlog('PDF.js imported successfully, version: ' + (pdfjsLib.version || 'unknown'));
      } catch(e) {
        wvlog('FAILED to import PDF.js: ' + e.message);
        document.getElementById('status').textContent = 'Failed to load PDF.js: ' + e.message;
        document.getElementById('status').className = 'error';
        return;
      }

      // Set worker src but we'll disable it per-call to avoid 27s cold start
      pdfjsLib.GlobalWorkerOptions.workerSrc = '${workerUri}';
      wvlog('PDF.js configured (will use main-thread rendering)');

      var scale = 1.0;
      var pdfDoc = null;
      var container = document.getElementById('canvas-container');
      var viewer = document.getElementById('viewer');
      var statusEl = document.getElementById('status');
      var spinnerEl = document.getElementById('spinner');
      var errorBox = document.getElementById('error-box');
      var pageInfo = document.getElementById('page-info');
      var zoomLabel = document.getElementById('zoom-label');

      function setStatus(text, cls) {
        statusEl.textContent = text;
        statusEl.className = cls || '';
        spinnerEl.className = cls === 'compiling' ? 'spinner active' : 'spinner';
      }

      setStatus('PDF.js loaded, waiting for compile...', 'ok');

      async function renderAllPages(pdf) {
        var scrollRatio = viewer.scrollHeight > 0 ? viewer.scrollTop / viewer.scrollHeight : 0;
        container.innerHTML = '';
        var numPages = pdf.numPages;
        wvlog('Rendering ' + numPages + ' pages at scale ' + scale);
        pageInfo.textContent = numPages + ' page' + (numPages > 1 ? 's' : '');

        for (var i = 1; i <= numPages; i++) {
          var page = await pdf.getPage(i);
          var viewport = page.getViewport({ scale: scale });
          var canvas = document.createElement('canvas');
          var ctx = canvas.getContext('2d');
          var dpr = window.devicePixelRatio || 1;
          canvas.width = Math.floor(viewport.width * dpr);
          canvas.height = Math.floor(viewport.height * dpr);
          canvas.style.width = viewport.width + 'px';
          canvas.style.height = viewport.height + 'px';
          ctx.scale(dpr, dpr);
          container.appendChild(canvas);
          await page.render({ canvasContext: ctx, viewport: viewport }).promise;
          wvlog('Page ' + i + ' rendered');
        }

        requestAnimationFrame(function() {
          viewer.scrollTop = scrollRatio * viewer.scrollHeight;
        });
      }

      async function loadPdf(base64str) {
        wvlog('loadPdf called, base64 length: ' + base64str.length);
        try {
          var binary = atob(base64str);
          var bytes = new Uint8Array(binary.length);
          for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
          wvlog('Decoded to ' + bytes.length + ' bytes, calling getDocument...');

          pdfDoc = await pdfjsLib.getDocument({ data: bytes, disableWorker: true }).promise;
          wvlog('getDocument resolved, numPages: ' + pdfDoc.numPages);

          await renderAllPages(pdfDoc);
          setStatus('Ready', 'ok');
          errorBox.style.display = 'none';
        } catch (e) {
          wvlog('loadPdf ERROR: ' + e.message + '\\n' + e.stack);
          setStatus('Render error: ' + e.message, 'error');
        }
      }

      async function rerender() {
        if (pdfDoc) {
          await renderAllPages(pdfDoc);
          zoomLabel.textContent = Math.round(scale * 100) + '%';
        }
      }

      var firstLoad = true;

      function fitWidth() {
        if (!pdfDoc) return;
        pdfDoc.getPage(1).then(function(page) {
          var viewport = page.getViewport({ scale: 1 });
          scale = (viewer.clientWidth - 48) / viewport.width;
          rerender();
        });
      }

      document.getElementById('zoom-in').addEventListener('click', function() {
        scale = Math.min(scale + 0.2, 5.0); rerender();
      });
      document.getElementById('zoom-out').addEventListener('click', function() {
        scale = Math.max(scale - 0.2, 0.2); rerender();
      });
      document.getElementById('fit-width').addEventListener('click', fitWidth);

      document.addEventListener('keydown', function(e) {
        if (e.ctrlKey || e.metaKey) {
          if (e.key === '=' || e.key === '+') { e.preventDefault(); scale = Math.min(scale + 0.2, 5.0); rerender(); }
          if (e.key === '-') { e.preventDefault(); scale = Math.max(scale - 0.2, 0.2); rerender(); }
          if (e.key === '0') { e.preventDefault(); scale = 1.0; rerender(); }
        }
      });

      window.addEventListener('message', function(event) {
        var msg = event.data;
        wvlog('Message received: type=' + msg.type);
        switch (msg.type) {
          case 'compiling':
            setStatus('Compiling...', 'compiling');
            break;
          case 'idle':
            break;
          case 'pdf':
            setStatus('Rendering...', 'compiling');
            loadPdf(msg.data).then(function() {
              if (firstLoad) {
                firstLoad = false;
                fitWidth();
              }
            });
            break;
          case 'error':
            setStatus(msg.message || 'Compilation error', 'error');
            if (msg.log) {
              var lines = msg.log.split('\\n');
              var errorLines = lines.filter(function(l) {
                return l.startsWith('!') || l.includes('Error') || l.includes('Warning')
                  || l.startsWith('l.') || l.includes('Undefined control sequence');
              });
              errorBox.textContent = errorLines.length > 0
                ? errorLines.join('\\n')
                : msg.log.slice(-2000);
              errorBox.style.display = 'block';
            }
            break;
        }
      });

      wvlog('Message listener registered, ready');
    })().catch(function(e) {
      wvlog('TOP-LEVEL ERROR: ' + e.message + '\\n' + e.stack);
      document.getElementById('status').textContent = 'Fatal: ' + e.message;
      document.getElementById('status').className = 'error';
    });
  </script>
</body>
</html>`;
  }
}

function getNonce(): string {
  let text = '';
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return text;
}
