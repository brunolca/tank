// Tourne la vidéo de gameplay de l'itération : videos/iteration-N.mp4 (45 à 90 s).
// Le serveur local sert le jeu en mode démo (?demo=1) : des tanks aux couleurs des joueurs, pilotés par l'IA,
// affrontent les ennemis d'une mission. Adapter le MONTAGE à chaque itération pour montrer les nouveautés.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { launchBrowser, readMeta, sleep, startServer } from './lib.mjs';

// ------------------------------------------------------------------ montage (à adapter à chaque itération)
const MONTAGE = [
  { home: 5, seconds: 5, caption: 'Nouveau : la ronde des boss', sub: 'Les quatre boss à la suite… et le meilleur chrono de la semaine' },
  { rush: 1, arms: ['canon', 'ricochet'], seconds: 11, caption: 'Les quatre boss, l’un après l’autre', sub: 'Trois vies pour toute la ronde, le chrono tourne' },
  { rush: 3, arms: ['fusee', 'canon'], seconds: 9, hits: [4], caption: 'Un ordre différent chaque lundi', sub: 'Le même pour tout le monde' },
  { rush: 5, arms: ['canon', 'ricochet'], seconds: 17, volley: true, hits: [7, 11], caption: 'Le bouquet final', sub: 'Deux boss à la fois : la barre de vie compte les deux' },
  { rush: 5, rushWeek: 2, arms: ['ricochet', 'sapeur'], seconds: 11, caption: 'Un duo différent chaque semaine', sub: 'Le Colosse et le Grondeur, le Foreur et le Semeur…' },
  { rushResults: 6, seconds: 6, caption: 'Ton temps contre chaque boss', sub: 'Et le classement de la semaine' },
  { mission: 37, arms: ['canon', 'ricochet'], seconds: 8, magnetShots: [1.5], caption: 'Et toujours l’Aimant', sub: 'Dix-huit tanks au bestiaire, quatre boss en rotation' },
];// ------------------------------------------------------------------

const meta = readMeta();
const tag = `iteration-${meta.iteration}`;
fs.mkdirSync('videos', { recursive: true });
const server = await startServer(Number(process.env.PORT) || 8791);
const browser = await launchBrowser();
const errors = [];
try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${server.url}/?demo=1&mission=${MONTAGE[0].mission ?? 1}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__demo?.state?.tick > 0, null, { timeout: 30000 });

  // CDP screencast -> system ffmpeg at a constant 30 fps (frames are duplicated to fill the gaps)
  const out = `videos/${tag}.mp4`;
  const FPS = 30;
  const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-i', '-',
    '-vf', 'scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'veryfast', '-crf', '23', '-movflags', '+faststart', out], { stdio: ['pipe', 'inherit', 'inherit'] });
  const ffDone = new Promise((res, rej) => ff.on('exit', (c) => (c === 0 ? res() : rej(new Error('ffmpeg a échoué')))));
  const cdp = await ctx.newCDPSession(page);
  let last = null, t0 = null, written = 0;
  cdp.on('Page.screencastFrame', async (f) => {
    cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {});
    const buf = Buffer.from(f.data, 'base64');
    const ts = f.metadata.timestamp;
    if (t0 === null) t0 = ts;
    const target = Math.round((ts - t0) * FPS);
    while (last && written < target) { ff.stdin.write(last); written++; }
    last = buf;
  });
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 85, maxWidth: 1280, maxHeight: 720, everyNthFrame: 1 });

  await page.evaluate(() => window.__demo.title());
  await sleep(3200);
  for (const shot of MONTAGE) {
    await page.evaluate((shot) => {
      const d = window.__demo;
      if (shot.home) d.home(shot.home * 1000);
      else if (shot.bestiary) d.bestiary(shot.bestiary * 1000); // the bestiary on the home screen (iteration 25)
      else if (shot.atelier) d.atelier(shot.atelier * 1000);
      else if (shot.playAtelier) { const a = d.atelierSample(); d.playAtelier({ ...a, ...shot.playAtelier }, shot.arms); }
      else if (shot.arsenal) { d.play(3, true, false, undefined, undefined, ['canon', 'fusee']); d.arsenal(shot.arsenal * 1000); }
      else if (shot.versus) d.versus(shot.versus[0], shot.versus[1], shot.arms);
      else if (shot.drapeau) d.drapeau(shot.drapeau[0], shot.drapeau[1], shot.arms, true, !!shot.drapeau[2]); // « Drapeaux » (iteration 24)
      else if (shot.rivals) d.rivals(shot.rivals * 1000, shot.lobby); // the game goes on behind the lobby (versus, or coop teammates)
      else if (shot.daily) d.daily(shot.daily[0], shot.daily[1]);
      else if (shot.rushResults) d.rushResults(shot.rushResults * 1000); // « La ronde des boss » (iteration 28): the results
      else if (shot.rush) d.rush(shot.rush, shot.arms, shot.rushWeek === undefined ? undefined : 2940 + shot.rushWeek); // a stage (2940 % 6 = 0: rushWeek picks the duo)
      else if (shot.taupe) { if (!shot.keep) d.taupe(shot.taupe, 8, shot.arms); } // keep: the stage goes on behind
      else d.play(shot.mission, true, !!shot.rich, shot.bossHp, shot.night, shot.arms, shot.storm, shot.ranks);
      if (shot.skills) d.skills(shot.skills[0] * 1000, shot.skills[1], shot.skills[2], shot.skills[3]); // the skill tree over the table (iteration 19)
      if (shot.role) setTimeout(() => d.role(true, 4000), 400); // after the title banner has gone
      if (shot.council) d.council(shot.council[0] * 1000, shot.council[1], shot.council[2], shot.council[3]);
      if (shot.volley) setTimeout(() => d.volley?.(), 2500);
      for (const s of shot.hits ?? []) setTimeout(() => d.hitBoss?.(), s * 1000);
      for (const s of shot.portals ?? []) setTimeout(() => d.portal?.(), s * 1000);
      for (const s of shot.bolts ?? []) setTimeout(() => d.bolt?.(), s * 1000);
      for (const s of shot.armor ?? []) setTimeout(() => d.armor?.(), s * 1000);
      for (const s of shot.digs ?? []) setTimeout(() => d.dig?.(), s * 1000);
      for (const s of shot.builds ?? []) setTimeout(() => d.build?.(), s * 1000);
      for (const s of shot.tunnels ?? []) setTimeout(() => d.tunnel?.(), s * 1000);
      for (const s of shot.baits ?? []) setTimeout(() => d.bait?.(), s * 1000);
      for (const s of shot.beltCrates ?? []) setTimeout(() => d.beltCrate?.(), s * 1000);
      for (const s of shot.rallies ?? []) setTimeout(() => d.rally?.(), s * 1000); // « Suis-moi ! » (iteration 20)
      for (const s of shot.shieldShots ?? []) setTimeout(() => d.shieldShot?.(), s * 1000); // the Rempart's shield (iteration 22)
      for (const s of shot.magnetShots ?? []) setTimeout(() => d.magnetShot?.(), s * 1000); // the Aimant (iteration 27)
      for (const s of shot.gusts ?? []) setTimeout(() => d.gustShot?.(), s * 1000); // shells across the wind (iteration 23)
      for (const s of shot.sows ?? []) setTimeout(() => d.sow?.(), s * 1000); // the Semeur sows (iteration 25)
      for (const s of shot.seedShots ?? []) setTimeout(() => d.seedShot?.(), s * 1000); // and a hero shoots a seed next to it
      d.caption(shot.caption, shot.sub);
      for (const k of shot.crates ?? []) d.crate?.(k);
      for (const k of shot.buffs ?? []) d.buff?.(k);
    }, shot);
    await sleep(shot.seconds * 1000);
  }
  await page.evaluate(() => window.__demo.caption(''));
  await page.evaluate(() => window.__demo.title());
  await sleep(3000);
  await cdp.send('Page.stopScreencast');
  if (last) { ff.stdin.write(last); written++; }
  ff.stdin.end();
  await ffDone;
  await ctx.close();
  if (written < FPS * 20) errors.push(`vidéo trop courte (${written} images)`);
  console.log(`OK : ${out} (${(written / FPS).toFixed(0)} s, ${(fs.statSync(out).size / 1e6).toFixed(1)} Mo)`);
} finally {
  await browser.close();
  server.stop();
}
if (errors.length) { console.error('Erreurs pendant le tournage :\n- ' + errors.join('\n- ')); process.exit(1); }
process.exit(0);
