// Test de fumée bout en bout : serveur local, deux navigateurs, une vraie partie coop en ligne, puis le mode démo.
import { launchBrowser, readMeta, sleep, startServer } from './lib.mjs';

const meta = readMeta();
const server = await startServer(Number(process.env.PORT) || 8790);
const browser = await launchBrowser();
const errors = [];
const fail = (msg) => { errors.push(msg); };

try {
  const v = await fetch(server.url + '/api/version').then((r) => r.json());
  if (v.iteration !== meta.iteration) fail(`/api/version renvoie ${v.iteration}, attendu ${meta.iteration}`);

  const page = async (name, url) => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const p = await ctx.newPage();
    p.on('pageerror', (e) => fail(`${name} : ${e.message}`));
    p.on('console', (m) => { if (m.type() === 'error') fail(`${name} console : ${m.text()}`); });
    p.setDefaultTimeout(60000);
    await p.goto(url, { waitUntil: 'domcontentloaded' });
    await p.waitForFunction(() => window.__debug, null, { timeout: 60000 });
    return p;
  };
  const state = (p) => p.evaluate(() => window.__debug.state);

  const a = await page('A', server.url + '/');
  await sleep(1500);
  await a.click('#btn-create');
  await a.waitForURL(/\/r\/[A-Z0-9]+/, { timeout: 20000 });
  const b = await page('B', a.url());
  await sleep(1500);
  const lobbyCount = await a.locator('#lobby-players li:not(.empty)').count();
  if (lobbyCount !== 2) fail(`le salon devrait afficher 2 joueurs, il en affiche ${lobbyCount}`);
  await a.click('#btn-start');
  await sleep(4500); // intro
  await a.mouse.move(900, 400);
  await a.keyboard.down('KeyD');
  await b.keyboard.down('KeyS');
  for (let i = 0; i < 6; i++) { await a.mouse.down(); await a.mouse.up(); await sleep(300); }
  await a.keyboard.up('KeyD');
  await b.keyboard.up('KeyS');
  await sleep(1000);
  for (const [name, p] of [['A', a], ['B', b]]) {
    const s = await state(p);
    if (!s.online) fail(`${name} n'est pas en partie (écran ${s.screen}, phase ${s.phase})`);
    if (s.myTankId < 0) fail(`${name} n'a pas de tank`);
    if (s.snaps < 30) fail(`${name} reçoit trop peu d'états du serveur (${s.snaps})`);
    if (!['playing', 'failed', 'cleared'].includes(s.phase)) fail(`${name} : phase inattendue ${s.phase}`);
  }

  // feedback: open with F, highlight a zone, send
  await a.keyboard.press('KeyF');
  await a.waitForSelector('#feedback:not([hidden])');
  const box = await a.locator('#fb-canvas').boundingBox();
  await a.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.3);
  await a.mouse.down();
  await a.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.6, { steps: 5 });
  await a.mouse.up();
  await a.fill('#fb-text', 'Test de fumée automatique : ce retour vérifie le formulaire.');
  const ctxText = await a.locator('#fb-context').textContent();
  if (!ctxText.includes('"regions"') || !ctxText.includes('"contents"')) fail('le contexte du feedback ne décrit pas la zone entourée');
  const [resp] = await Promise.all([a.waitForResponse((r) => r.url().endsWith('/api/feedback')), a.click('#fb-send')]);
  if (resp.status() !== 200) fail(`envoi du feedback : HTTP ${resp.status()} ${await resp.text()}`);
  try { await a.waitForSelector('#feedback', { state: 'hidden', timeout: 15000 }); }
  catch { fail('la fenêtre de feedback ne se ferme pas après envoi'); }
  // free the (software-rendered, on CI) GPU before the demo page
  await a.context().close();
  await b.context().close();

  const d = await page('démo', server.url + '/?demo=1&mission=3');
  await sleep(1500);
  const t0 = (await d.evaluate(() => window.__demo.state)).tick;
  await sleep(1500);
  const t1 = (await d.evaluate(() => window.__demo.state)).tick;
  if (!(t1 > t0)) fail('le mode démo ne tourne pas');
} catch (e) {
  fail(e.stack || String(e));
} finally {
  await browser.close();
  server.stop();
}

if (errors.length) { console.error('Test de fumée en échec :\n- ' + errors.join('\n- ')); process.exit(1); }
console.log('OK : test de fumée (partie en ligne à 2, feedback, mode démo).');
process.exit(0);
