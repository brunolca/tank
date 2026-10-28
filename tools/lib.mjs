// Shared helpers for the tools: local server (wrangler dev) and headless browser.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { chromium } from 'playwright';

export async function startServer(port = 8790) {
  const proc = spawn('npx', ['wrangler', 'dev', '--port', String(port), '--ip', '127.0.0.1', '--log-level', 'info'], {
    env: { ...process.env, WRANGLER_SEND_METRICS: 'false', CI: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  });
  let log = '';
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('wrangler dev ne démarre pas :\n' + log)), 90000);
    const onData = (d) => {
      log += d;
      if (/Ready on/.test(log)) { clearTimeout(timer); resolve(); }
    };
    proc.stdout.on('data', onData);
    proc.stderr.on('data', onData);
    proc.on('exit', (code) => reject(new Error(`wrangler dev s'est arrêté (${code}) :\n${log}`)));
  });
  return {
    url: `http://127.0.0.1:${port}`,
    stop() { try { process.kill(-proc.pid, 'SIGTERM'); } catch {} },
  };
}

export async function launchBrowser() {
  const mac = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  const executablePath = process.env.CHROME_PATH || (process.platform === 'darwin' && fs.existsSync(mac) ? mac : undefined);
  return chromium.launch({ executablePath, headless: true, args: ['--autoplay-policy=no-user-gesture-required', '--use-gl=angle', '--ignore-gpu-blocklist', '--window-size=1280,720'] });
}

export function readMeta() {
  return JSON.parse(fs.readFileSync('src/shared/meta.json', 'utf8'));
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
