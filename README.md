# Tanks!

Remake moderne de *Tanks* (Wii Play) en 3D (Three.js), multijoueur en ligne sur Cloudflare Workers + Durable Objects.

- **Campagne coop** (1 à 4 joueurs) : 16 missions faites main, puis des missions générées à l'infini. 9 types de tanks ennemis (brun, gris, turquoise, jaune, rose, vert, violet, blanc invisible, noir). Vies partagées.
- **Versus** (2 à 4 joueurs) : chacun pour soi, premier à 5 manches.
- Obus qui ricochent, mines, blocs de liège destructibles, trous.
- Contrôles : clavier + souris, manette, tactile.
- **Le jeu s'améliore tout seul** : toutes les 12 h, une routine Claude Code écrit une nouvelle itération en tenant compte des retours des joueurs (bouton « Ton avis » dans le jeu). Voir `CLAUDE.md`, `DESIGN.md` et `ROUTINE.md`. Chaque itération a sa vidéo dans les Releases.

## Dev

```sh
npm install
npm run dev        # build du client + wrangler dev sur http://localhost:8787
npm run check      # types, build, simulation de toutes les missions, carnet de bord
npm run smoke      # partie en ligne à deux navigateurs + feedback + mode démo
npm run record     # vidéo de gameplay de l'itération (videos/)
npm run deploy     # build + wrangler deploy
```

## Architecture

- `src/server/worker.ts` : `/api/new` crée un code de salle, `/api/room/:code/ws` route vers le Durable Object `Room` de la salle. Tout le reste est servi depuis `public/`.
- `src/server/room.ts` : un Durable Object par salle. Il gère le salon, le déroulé des missions et des manches, et fait tourner la simulation autoritaire à 30 Hz avec une boucle `setInterval`. Les WebSockets sont hibernables.
- `src/shared/` : simulation (`sim.ts`, IA comprise), physique, niveaux et protocole. Ce code est partagé par le serveur et le client.
- `src/client/` : rendu Three.js, prédiction côté client du tank local avec réconciliation, interpolation des autres entités 100 ms en retard, audio synthétisé (WebAudio).
