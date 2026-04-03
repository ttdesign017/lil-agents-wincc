import { spawn, ChildProcessWithoutNullStreams } from 'child_process';
import { ipcMain, app } from 'electron';
import path from 'path';
import fs from 'fs';

interface ClaudeState {
  process: ChildProcessWithoutNullStreams;
  lineBuffer: string;
}

const sessions = new Map<string, ClaudeState>();

// Resolve the claude CLI path directly to bypass PowerShell wrapper issues
function getClaudeCliPath(): string {
  const appData = process.env.APPDATA || '';
  return path.join(appData, 'npm', 'node_modules', '@anthropic-ai', 'claude-code', 'cli.js');
}

function processLine(line: string, mainWindow: Electron.BrowserWindow, sessionId: string) {
  if (!line.trim()) return;
  try {
    const json = JSON.parse(line) as Record<string, any>;
    const type = json['type'] as string;

    if (type === 'assistant') {
      const message = json['message'] as Record<string, any>;
      const content = message?.['content'] as any[];
      if (Array.isArray(content)) {
        for (const block of content) {
          if (block['type'] === 'text') {
            const text = block['text'] as string;
            if (text) mainWindow.webContents.send('claude-data', sessionId, text);
          }
        }
      }
    } else if (type === 'result') {
      // Turn complete
      mainWindow.webContents.send('claude-turn-complete', sessionId);
    }
  } catch {
    // Not JSON or unrecognized, ignore silently
  }
}

export function setupClaudeSession(mainWindow: Electron.BrowserWindow) {

  function startSession(sessionId: string) {
    if (sessions.has(sessionId)) return;

    // Use AppData (userData) instead of projectRoot/personas for persistence in packaged apps
    // Use local personas folder relative to the app's root directory or resources folder
    const personaRoot = app.isPackaged ? process.resourcesPath : process.cwd();
    const personaDir = path.join(personaRoot, 'personas', sessionId);
    
    if (!fs.existsSync(personaDir)) {
      fs.mkdirSync(personaDir, { recursive: true });
    }

    // Try to copy template CLAUDE.md from the bundled app to userData if it doesn't exist
    const targetClaudeMd = path.join(personaDir, 'CLAUDE.md');
    if (!fs.existsSync(targetClaudeMd)) {
      const templatePath = path.join(app.getAppPath(), 'personas', sessionId, 'CLAUDE.md');
      if (fs.existsSync(templatePath)) {
        try {
          fs.copyFileSync(templatePath, targetClaudeMd);
        } catch (e) {
          console.error(`Failed to copy template for ${sessionId}:`, e);
        }
      }
    }

    const cliPath = getClaudeCliPath();
    const currentSession = spawn('node', [
      cliPath,
      '--output-format', 'stream-json',
      '--input-format', 'stream-json',
      '--verbose',
      '--dangerously-skip-permissions'
    ], {
      cwd: personaDir,
      env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' },
    });

    sessions.set(sessionId, { process: currentSession, lineBuffer: '' });

    currentSession.stdout.on('data', (data: Buffer) => {
      const state = sessions.get(sessionId);
      if (!state) return;

      state.lineBuffer += data.toString();
      const lines = state.lineBuffer.split('\n');
      state.lineBuffer = lines.pop() ?? '';
      for (const line of lines) {
        processLine(line, mainWindow, sessionId);
      }
    });

    currentSession.stderr.on('data', (data: Buffer) => {
      // Only show real errors, not warnings
      const msg = data.toString();
      if (msg.includes('Error') && !msg.includes('Warning')) {
        mainWindow.webContents.send('claude-error', sessionId, msg);
      }
    });

    currentSession.on('close', (code) => {
      sessions.delete(sessionId);
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('claude-exit', sessionId, code ?? 0);
      }
    });
  }

  ipcMain.on('start-claude', (event, sessionId: string) => {
    startSession(sessionId);
  });

  ipcMain.on('send-claude-input', (event, sessionId: string, input: string) => {
    if (!sessions.has(sessionId)) {
      startSession(sessionId);
      // Give it a moment to boot before sending
      setTimeout(() => sendMessage(sessionId, input), 800);
    } else {
      sendMessage(sessionId, input);
    }
  });

  function sendMessage(sessionId: string, input: string) {
    const state = sessions.get(sessionId);
    if (!state) return;
    const payload = {
      type: 'user',
      message: { role: 'user', content: input }
    };
    state.process.stdin.write(JSON.stringify(payload) + '\n');
  }

  ipcMain.on('kill-claude', (event, sessionId: string) => {
    const state = sessions.get(sessionId);
    if (state) {
      state.process.kill();
      sessions.delete(sessionId);
    }
  });
}
