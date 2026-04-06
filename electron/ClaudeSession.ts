import { spawn, ChildProcessWithoutNullStreams } from 'child_process';
import { ipcMain, app } from 'electron';
import path from 'path';
import fs from 'fs';

interface ClaudeState {
  process: ChildProcessWithoutNullStreams;
  lineBuffer: string;
  startedAt: number;
}

const MAX_SESSIONS = 2;
const sessions = new Map<string, ClaudeState>();

// Resolve the claude CLI path directly to bypass PowerShell wrapper issues
function getClaudeCliPath(): string {
  const appData = process.env.APPDATA || '';
  const globalPath = path.join(appData, 'npm', 'node_modules', '@anthropic-ai', 'claude-code', 'cli.js');
  // Fallback: try npx resolution if global install not found
  if (!fs.existsSync(globalPath)) return 'cli.js';
  return globalPath;
}

// Find template CLAUDE.md with multiple fallback locations
function findTemplateClaudeMd(sessionId: string): string | null {
  const candidates: string[] = [];

  // 1. Packaged app resources
  if (app.isPackaged) {
    candidates.push(path.join(process.resourcesPath, 'personas', sessionId, 'CLAUDE.md'));
  }

  // 2. Development working directory
  candidates.push(path.join(process.cwd(), 'personas', sessionId, 'CLAUDE.md'));

  // 3. App installation path relative
  const appPath = app.getAppPath();
  candidates.push(path.join(appPath, 'personas', sessionId, 'CLAUDE.md'));

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
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

    // Enforce session limit: kill oldest if we exceed MAX_SESSIONS
    if (sessions.size >= MAX_SESSIONS) {
      let oldestId = '';
      let oldestTime = Infinity;
      for (const [id, state] of sessions) {
        if (state.startedAt < oldestTime) {
          oldestTime = state.startedAt;
          oldestId = id;
        }
      }
      if (oldestId) {
        console.warn(`[ClaudeSession] Max sessions (${MAX_SESSIONS}) exceeded, killing oldest session: ${oldestId}`);
        const oldestState = sessions.get(oldestId);
        if (oldestState) {
          oldestState.process.kill();
          sessions.delete(oldestId);
        }
      }
    }

    // Use AppData (userData) for session persistence, cwd for templates in dev
    const userDataDir = app.getPath('userData');
    const personaDir = path.join(userDataDir, 'personas', sessionId);

    if (!fs.existsSync(personaDir)) {
      fs.mkdirSync(personaDir, { recursive: true });
    }

    // Copy template CLAUDE.md if it doesn't exist yet
    const targetClaudeMd = path.join(personaDir, 'CLAUDE.md');
    if (!fs.existsSync(targetClaudeMd)) {
      const templatePath = findTemplateClaudeMd(sessionId);
      if (templatePath) {
        try {
          // Atomic write: write to tmp then rename to avoid partial reads
          const tmpPath = targetClaudeMd + '.tmp';
          fs.copyFileSync(templatePath, tmpPath);
          fs.renameSync(tmpPath, targetClaudeMd);
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
      env: {
        ...process.env,
        FORCE_COLOR: '0',
        NO_COLOR: '1',
        CLAUDE_CODE_DISABLE_CONTEXT_MANAGEMENT: '1',
      },
    });

    sessions.set(sessionId, { process: currentSession, lineBuffer: '', startedAt: Date.now() });

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
