import { BRANCHES, RANK_COST, XP_PER_GALON, canBuy, freeGalons, type Progress } from '../shared/skills';

// The skill tree card of the coop campaign (iteration 19): three branches of three ranks, bought with galons.

const hex = (c: number) => `#${c.toString(16).padStart(6, '0')}`;

export interface TreeView {
  prog: Progress;
  training: boolean; // end of a mission: the « Prêt ! » button, the timer bar
  left?: number; // seconds left of the end-of-mission screen (training only)
  total?: number;
  flash?: number; // branch whose last rank was just bought (a little pop)
}

/** Draw the card into `el` (#skills). Buttons carry data-b (branch) and data-ready. */
export function renderTree(el: HTMLElement, v: TreeView) {
  const { prog } = v;
  const free = freeGalons(prog);
  const next = XP_PER_GALON - (prog.xp % XP_PER_GALON);
  const cols = BRANCHES.map((br, b) => {
    const k = prog.r[b];
    const nodes = br.ranks.map((rk, i) => {
      const owned = i < k;
      const isNext = i === k;
      const can = isNext && canBuy(prog, b);
      const cls = owned ? 'owned' : can ? 'next can' : isNext ? 'next' : 'locked';
      const pop = owned && v.flash === b && i === k - 1 ? ' pop' : '';
      const cost = owned ? '<span class="tick">✓</span>' : `<span class="cost">${'★'.repeat(RANK_COST[i])}</span>`;
      return `<button class="node ${cls}${pop}" data-b="${b}" ${can ? '' : 'disabled'}><span class="rk">${['I', 'II', 'III'][i]}</span><b>${rk.label}</b><small>${rk.desc}</small>${cost}</button>`;
    }).join('<i class="link"></i>');
    return `<div class="branch" style="--c:${hex(br.color)}"><div class="br-head"><span class="ico">${br.icon}</span>${br.label}<kbd>${b + 1}</kbd></div>${nodes}</div>`;
  }).join('');
  el.hidden = false;
  el.innerHTML = `
    <div class="s-kicker">${v.training ? 'Mission réussie · entre deux missions' : 'Campagne'}</div>
    <div class="s-title">L’arbre des galons</div>
    <div class="s-sub"><span class="galons">${free ? `<b>${free}</b> galon${free > 1 ? 's' : ''} à dépenser` : 'Aucun galon à dépenser'}</span>
      <span class="xp"><i style="width:${(100 * (prog.xp % XP_PER_GALON)) / XP_PER_GALON}%"></i></span>
      <span class="muted">${prog.xp} XP · prochain galon dans ${next} XP</span></div>
    ${v.training ? `<div class="s-timer"><i style="width:${v.total ? (100 * (v.left ?? 0)) / v.total : 0}%"></i></div>` : ''}
    <div class="branches">${cols}</div>
    <div class="s-foot"><span class="muted">Chaque ennemi détruit rapporte de l’XP, chaque mission réussie aussi. Les compétences comptent dès la mission suivante.</span>
      <button class="btn primary" data-ready="1">${v.training ? 'Prêt !' : 'Fermer'} <kbd>K</kbd></button></div>`;
}
