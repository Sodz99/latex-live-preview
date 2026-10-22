import * as cp from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import * as vscode from 'vscode';
import { log } from './log';

export interface CompileResult {
  success: boolean;
  pdfPath?: string;
  log?: string;
  error?: string;
}

// Temp directory for all build artifacts — nothing pollutes the source dir
const TEMP_OUT = path.join(os.tmpdir(), 'latex-live-preview');

export class LatexCompiler {
  private _process: cp.ChildProcess | undefined;

  async compile(texPath: string): Promise<CompileResult> {
    this.kill();

    const dir = path.dirname(texPath);
    const base = path.basename(texPath, '.tex');

    // Ensure temp output dir exists
    if (!fs.existsSync(TEMP_OUT)) {
      fs.mkdirSync(TEMP_OUT, { recursive: true });
    }

    const pdfPath = path.join(TEMP_OUT, `${base}.pdf`);

    const config = vscode.workspace.getConfiguration('latex-preview');
    const engine = config.get<string>('engine', 'pdflatex');
    const useLatexmk = config.get<boolean>('useLatexmk', true);

    let cmd: string;
    let args: string[];

    if (useLatexmk) {
      cmd = 'latexmk';
      args = [
        '-pdf',
        `-pdflatex=${engine} -interaction=nonstopmode -synctex=1 %O %S`,
        '-interaction=nonstopmode',
        `-outdir=${TEMP_OUT}`,
        path.basename(texPath),
      ];
    } else {
      cmd = engine;
      args = [
        '-interaction=nonstopmode',
        '-synctex=1',
        `-output-directory=${TEMP_OUT}`,
        path.basename(texPath),
      ];
    }

    log(`Spawning: ${cmd} ${args.join(' ')}`);
    log(`CWD: ${dir}`);
    log(`Output dir: ${TEMP_OUT}`);

    return new Promise<CompileResult>((resolve) => {
      let compileLog = '';

      try {
        this._process = cp.spawn(cmd, args, {
          cwd: dir,
          stdio: ['ignore', 'pipe', 'pipe'],
        });
        log(`Process spawned, PID: ${this._process.pid}`);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        log(`SPAWN FAILED: ${msg}`);
        resolve({
          success: false,
          error: `Failed to start ${cmd}: ${msg}. Is it installed and on PATH?`,
        });
        return;
      }

      this._process.stdout?.on('data', (data) => { compileLog += data.toString(); });
      this._process.stderr?.on('data', (data) => { compileLog += data.toString(); });

      this._process.on('error', (err) => {
        log(`Process error event: ${err.message}`);
        this._process = undefined;
        resolve({
          success: false,
          error: `Failed to start ${cmd}: ${err.message}. Is it installed and on PATH?`,
          log: compileLog,
        });
      });

      this._process.on('close', (code, signal) => {
        log(`Process closed: code=${code}, signal=${signal}`);
        this._process = undefined;

        if (signal === 'SIGTERM' || signal === 'SIGKILL') {
          resolve({ success: false, error: 'Compilation cancelled', log: compileLog });
          return;
        }

        const pdfExists = fs.existsSync(pdfPath);
        log(`PDF exists at ${pdfPath}: ${pdfExists}`);

        if (code === 0 && pdfExists) {
          const stat = fs.statSync(pdfPath);
          log(`PDF size: ${stat.size} bytes`);
          resolve({ success: true, pdfPath, log: compileLog });
        } else {
          resolve({
            success: false,
            log: compileLog,
            error: `${cmd} exited with code ${code}`,
          });
        }
      });
    });
  }

  kill() {
    if (this._process) {
      log(`Killing stale process PID: ${this._process.pid}`);
      this._process.kill('SIGTERM');
      this._process = undefined;
    }
  }
}
