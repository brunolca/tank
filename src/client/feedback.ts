// In-game feedback: screenshot with player-drawn highlight boxes, optional attachment, and a rich
// automatic context (game state, entities inside the highlighted boxes, recent events, errors, device).

export interface Region { x0: number; y0: number; x1: number; y1: number } // client px

export interface FeedbackHooks {
  capture(): string; // data URL of the game canvas
  context(): Record<string, unknown>;
  describeRegion(r: Region): unknown;
  onOpen(): void;
  onClose(): void;
  toast(msg: string): void;
}

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector(sel) as T;
const MAX_FILE = 1_800_000;

export function setupFeedback(hooks: FeedbackHooks) {
  const modal = $('#feedback');
  const cv = $<HTMLCanvasElement>('#fb-canvas');
  const g = cv.getContext('2d')!;
  const text = $<HTMLTextAreaElement>('#fb-text');
  const include = $<HTMLInputElement>('#fb-include');
  const fileInput = $<HTMLInputElement>('#fb-file');
  const fileName = $('#fb-file-name');
  const pre = $('#fb-context');
  const send = $<HTMLButtonElement>('#fb-send');
  let shot: HTMLImageElement | null = null;
  let regions: Region[] = []; // normalised 0..1 in the screenshot
  let drag: Region | null = null;
  let category = 'bug';
  let ctx: Record<string, unknown> = {};
  let attachment: File | Blob | null = null;
  let viewW = 1, viewH = 1;

  const toClient = (r: Region): Region => ({ x0: r.x0 * viewW, y0: r.y0 * viewH, x1: r.x1 * viewW, y1: r.y1 * viewH });
  const norm = (r: Region): Region => ({ x0: Math.min(r.x0, r.x1), y0: Math.min(r.y0, r.y1), x1: Math.max(r.x0, r.x1), y1: Math.max(r.y0, r.y1) });

  function fullContext() {
    return {
      ...ctx,
      regions: regions.map((r, i) => ({ n: i + 1, ...roundRegion(r), contents: hooks.describeRegion(toClient(r)) })),
    };
  }
  function roundRegion(r: Region) {
    const k = (v: number) => Math.round(v * 1000) / 1000;
    return { x0: k(r.x0), y0: k(r.y0), x1: k(r.x1), y1: k(r.y1) };
  }
  function refreshContext() {
    pre.textContent = JSON.stringify(fullContext(), null, 2);
  }

  function draw() {
    if (!shot) return;
    g.drawImage(shot, 0, 0, cv.width, cv.height);
    if (!include.checked) {
      g.fillStyle = 'rgba(20,22,30,0.85)';
      g.fillRect(0, 0, cv.width, cv.height);
    }
    const all = drag ? [...regions, norm(drag)] : regions;
    all.forEach((r, i) => {
      const x = r.x0 * cv.width, y = r.y0 * cv.height, w = (r.x1 - r.x0) * cv.width, h = (r.y1 - r.y0) * cv.height;
      g.lineWidth = Math.max(3, cv.width / 300);
      g.strokeStyle = '#ffb43d';
      g.shadowColor = 'rgba(0,0,0,0.6)';
      g.shadowBlur = 6;
      g.strokeRect(x, y, w, h);
      g.shadowBlur = 0;
      const fs = Math.max(16, cv.width / 50);
      g.font = `800 ${fs}px Rubik, sans-serif`;
      g.fillStyle = '#ffb43d';
      g.fillRect(x, y - fs * 1.2, fs * 1.3, fs * 1.2);
      g.fillStyle = '#2a1a00';
      g.fillText(String(i + 1), x + fs * 0.35, y - fs * 0.25);
    });
  }

  function pos(e: PointerEvent) {
    const r = cv.getBoundingClientRect();
    return { x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) };
  }
  cv.addEventListener('pointerdown', (e) => {
    if (!include.checked) return;
    const p = pos(e);
    drag = { x0: p.x, y0: p.y, x1: p.x, y1: p.y };
    cv.setPointerCapture(e.pointerId);
  });
  cv.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const p = pos(e);
    drag.x1 = p.x; drag.y1 = p.y;
    draw();
  });
  cv.addEventListener('pointerup', () => {
    if (!drag) return;
    const r = norm(drag);
    drag = null;
    if (r.x1 - r.x0 > 0.01 && r.y1 - r.y0 > 0.01 && regions.length < 6) regions.push(r);
    draw();
    refreshContext();
  });
  $('#fb-clear').addEventListener('click', () => { regions = []; draw(); refreshContext(); });
  include.addEventListener('change', () => { draw(); });

  document.querySelectorAll<HTMLButtonElement>('#fb-cats button').forEach((b) =>
    b.addEventListener('click', () => {
      category = b.dataset.cat!;
      document.querySelectorAll('#fb-cats button').forEach((o) => o.classList.toggle('on', o === b));
    }),
  );

  fileInput.addEventListener('change', async () => {
    const f = fileInput.files?.[0];
    attachment = null;
    fileName.textContent = 'Ajouter une pièce jointe';
    if (!f) return;
    try {
      attachment = f.type.startsWith('image/') && (f.size > MAX_FILE || f.type === 'image/heic') ? await shrinkImage(f) : f;
      if (attachment.size > MAX_FILE) throw new Error('Fichier trop lourd (1,8 Mo max).');
      fileName.textContent = `${f.name} (${Math.round(attachment.size / 1024)} Ko)`;
    } catch (e) {
      attachment = null;
      fileInput.value = '';
      hooks.toast((e as Error).message);
    }
  });

  function open() {
    if (!modal.hidden) return;
    const url = hooks.capture();
    ctx = hooks.context();
    viewW = innerWidth; viewH = innerHeight;
    regions = [];
    attachment = null;
    fileInput.value = '';
    fileName.textContent = 'Ajouter une pièce jointe';
    shot = new Image();
    shot.onload = () => {
      const maxW = 1600;
      const k = Math.min(1, maxW / shot!.naturalWidth);
      cv.width = Math.round(shot!.naturalWidth * k);
      cv.height = Math.round(shot!.naturalHeight * k);
      draw();
    };
    shot.src = url;
    refreshContext();
    modal.hidden = false;
    hooks.onOpen();
    setTimeout(() => text.focus(), 50);
  }
  function close() {
    modal.hidden = true;
    hooks.onClose();
  }

  $('#btn-feedback').addEventListener('click', open);
  $('#fb-cancel').addEventListener('click', close);
  addEventListener('keydown', (e) => {
    if (e.code === 'Escape' && !modal.hidden) { close(); e.stopImmediatePropagation(); }
    const tag = (e.target as HTMLElement)?.tagName;
    if (e.code === 'KeyF' && modal.hidden && tag !== 'INPUT' && tag !== 'TEXTAREA' && !e.repeat) { open(); e.preventDefault(); }
  }, true);

  send.addEventListener('click', async () => {
    if (!text.value.trim()) { hooks.toast('Écris quelques mots pour décrire ton retour.'); text.focus(); return; }
    send.disabled = true;
    send.textContent = 'Envoi…';
    try {
      const form = new FormData();
      form.set('text', text.value.trim());
      form.set('category', category);
      form.set('context', JSON.stringify(fullContext()));
      if (include.checked && shot) {
        drag = null;
        draw();
        const blob = await new Promise<Blob | null>((res) => cv.toBlob(res, 'image/jpeg', 0.85));
        if (blob) form.set('screenshot', blob, 'capture.jpg');
      }
      if (attachment) form.set('attachment', attachment, (attachment as File).name ?? 'piece-jointe.jpg');
      const r = await fetch('/api/feedback', { method: 'POST', body: form });
      const body = (await r.json().catch(() => ({}))) as { id?: number; error?: string };
      if (!r.ok) throw new Error(body.error ?? `Erreur ${r.status}`);
      text.value = '';
      close();
      hooks.toast(`Merci ! Retour n° ${body.id} transmis : il sera lu à la prochaine itération.`);
    } catch (e) {
      hooks.toast(`Envoi impossible : ${(e as Error).message}`);
    } finally {
      send.disabled = false;
      send.textContent = 'Envoyer';
    }
  });

  return { open };
}

async function shrinkImage(f: File): Promise<Blob> {
  const bmp = await createImageBitmap(f);
  const k = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * k);
  c.height = Math.round(bmp.height * k);
  c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height);
  const blob = await new Promise<Blob | null>((res) => c.toBlob(res, 'image/jpeg', 0.82));
  if (!blob) throw new Error('Image illisible.');
  return new File([blob], f.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' });
}
