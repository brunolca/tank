// Vérifications sans navigateur : types, build, simulation de toutes les missions, cohérence de l'itération.
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readMeta } from './lib.mjs';

const errors = [];
const run = (label, cmd) => {
  try { execSync(cmd, { stdio: 'pipe' }); console.log(`✓ ${label}`); }
  catch (e) { errors.push(`${label} :\n${(e.stdout ?? '') + (e.stderr ?? '')}`.trim()); console.log(`✗ ${label}`); }
};

run('types serveur', 'npx tsc -p tsconfig.json');
run('types client', 'npx tsc -p tsconfig.client.json');
run('build client', 'npm run build --silent');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tanks-'));
run('simulation des missions', `npx esbuild tools/simtest.ts --bundle --platform=node --log-level=warning --outfile=${tmp}/simtest.cjs && node ${tmp}/simtest.cjs`);

const m = readMeta();
if (!Number.isInteger(m.iteration) || m.iteration < 1) errors.push('meta.iteration doit être un entier >= 1');
if (!/^\d{4}-\d{2}-\d{2}$/.test(m.date)) errors.push('meta.date doit être au format AAAA-MM-JJ');
if (!m.title) errors.push('meta.title manquant');
m.journal.forEach((j, i) => {
  if (j.iteration !== i + 1) errors.push(`journal[${i}] devrait être l'itération ${i + 1} (trouvé ${j.iteration}) : ne jamais supprimer d'entrée`);
  if (!j.title || !Array.isArray(j.notes) || !j.notes.length) errors.push(`journal[${i}] : titre ou notes manquants`);
});
const last = m.journal[m.journal.length - 1];
if (last?.iteration !== m.iteration) errors.push(`la dernière entrée du journal (${last?.iteration}) ne correspond pas à meta.iteration (${m.iteration})`);
if (last && (last.title !== m.title || last.date !== m.date)) errors.push('le titre/la date de la dernière entrée du journal doivent être ceux de meta');
const main = fs.readFileSync('src/client/main.ts', 'utf8');
for (const hook of ['__demo', '__debug']) if (!main.includes(hook)) errors.push(`le crochet window.${hook} a disparu : les outils ne pourront plus tester ni filmer`);

if (errors.length) { console.error('\nProblèmes :\n- ' + errors.join('\n- ')); process.exit(1); }
console.log(`\nOK : itération ${m.iteration} « ${m.title} », ${m.journal.length} entrée(s) au carnet.`);
