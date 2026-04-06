import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import electron from 'vite-plugin-electron/simple'
import path from 'path'
import fs from 'fs'

export default defineConfig({
  base: './',
  plugins: [
    react(),
    electron({
      main: {
        entry: 'electron/main.ts',
      },
      preload: {
        input: path.join(__dirname, 'electron/preload.ts'),
      },
      renderer: {},
    }),
    {
      name: 'debugger-patch',
      configureServer(server) {
        server.middlewares.use('/__patch', async (req, res) => {
          if (req.method !== 'POST') {
            res.writeHead(405); res.end(); return;
          }
          let body = '';
          req.on('data', c => body += c);
          req.on('end', () => {
            try {
              const { file, chars } = JSON.parse(body);
              const filePath = path.resolve(__dirname, file);
              let content = fs.readFileSync(filePath, 'utf-8');

              // Patch walkProb for each character
              chars?.forEach(({ name, scale, walkProb }: { name: string; scale: number; walkProb: number }) => {
                if (scale !== undefined) {
                  const re = new RegExp(`(${name}'?:\\s*\\{[^}]*scale:\\s*)([\\d.]+)`, 'g');
                  content = content.replace(re, `$1${Number(scale).toFixed(2)}`);
                }
                if (walkProb !== undefined) {
                  const re2 = new RegExp(`(${name}'?:\\s*\\{[^}]*walkProb:\\s*)([\\d.]+)`, 'g');
                  content = content.replace(re2, `$1${Number(walkProb).toFixed(2)}`);
                }
              });

              fs.writeFileSync(filePath, content);
              server.ws.send({ type: 'full-reload' });
              res.writeHead(200); res.end('ok');
            } catch (e: any) {
              res.writeHead(400); res.end(e.message);
            }
          });
        });
      },
    },
  ],
})
