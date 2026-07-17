import fs from 'fs';
import path from 'path';
import os from 'os';

const logDir = path.join(os.homedir(), '.aiden', 'log', 'test-' + Date.now());
console.log('Trying to create:', logDir);
try {
  fs.mkdirSync(logDir, { recursive: true });
  console.log('SUCCESS: Directory created');
  fs.rmdirSync(logDir);
  console.log('SUCCESS: Directory removed');
} catch (e) {
  console.error('FAILED:', e.code, e.message);
}
