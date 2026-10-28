// node tools/meta.mjs iteration|title|tag|notes
import { readMeta } from './lib.mjs';

const m = readMeta();
const what = process.argv[2];
const last = m.journal[m.journal.length - 1];
if (what === 'iteration') console.log(m.iteration);
else if (what === 'title') console.log(m.title);
else if (what === 'tag') console.log(`iteration-${m.iteration}`);
else if (what === 'notes') console.log(`**Itération ${m.iteration} : ${m.title}** (${m.date})\n\n${last.notes.map((n) => `- ${n}`).join('\n')}\n\nVidéo de gameplay ci-dessous. Jouer : https://tanks.brunofashionblog.workers.dev`);
else { console.error('usage: node tools/meta.mjs iteration|title|tag|notes'); process.exit(1); }
