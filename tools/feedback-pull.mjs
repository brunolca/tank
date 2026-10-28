// Récupère les nouveaux retours des joueurs dans feedback/inbox/ (utilisé par le workflow « Relever le feedback »).
// Usage : FEEDBACK_TOKEN=… node tools/feedback-pull.mjs [https://tanks.brunofashionblog.workers.dev]
import fs from 'node:fs';

const base = process.argv[2] ?? 'https://tanks.brunofashionblog.workers.dev';
const token = process.env.FEEDBACK_TOKEN;
if (!token) { console.error('FEEDBACK_TOKEN manquant'); process.exit(1); }
const headers = { authorization: `Bearer ${token}` };
fs.mkdirSync('feedback/inbox', { recursive: true });
const lastFile = 'feedback/last-id.txt';
let since = fs.existsSync(lastFile) ? Number(fs.readFileSync(lastFile, 'utf8')) || 0 : 0;
let total = 0;
for (;;) {
  const r = await fetch(`${base}/api/feedback?since=${since}`, { headers });
  if (!r.ok) { console.error(`HTTP ${r.status} : ${await r.text()}`); process.exit(1); }
  const rows = await r.json();
  if (!rows.length) break;
  for (const row of rows) {
    const dir = `feedback/inbox/${String(row.id).padStart(5, '0')}`;
    fs.mkdirSync(dir, { recursive: true });
    const save = async (which, name) => {
      const f = await fetch(`${base}/api/feedback/${row.id}/${which}`, { headers });
      if (f.ok) fs.writeFileSync(`${dir}/${name}`, Buffer.from(await f.arrayBuffer()));
    };
    if (row.hasScreenshot) await save('screenshot', 'capture.jpg');
    if (row.attachment) await save('attachment', 'piece-jointe-' + row.attachment.name.replace(/[^\w.-]+/g, '_'));
    fs.writeFileSync(`${dir}/retour.json`, JSON.stringify(row, null, 2) + '\n');
    since = row.id;
    total++;
  }
}
fs.writeFileSync(lastFile, String(since) + '\n');
console.log(`${total} nouveau(x) retour(s), dernier id ${since}`);
