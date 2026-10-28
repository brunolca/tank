# Le jeu en pilote automatique (toutes les 12 h)

Le jeu évolue grâce à une **routine Claude Code** : une session Claude qui se lance toute seule dans le cloud d'Anthropic, à heure fixe, même ordinateur éteint. Elle lit `CLAUDE.md`, lit les retours des joueurs, écrit l'itération suivante et la pousse sur `main`. Le workflow GitHub `Publier l'itération` prend le relais : il vérifie le jeu, joue une partie en ligne à deux navigateurs, filme la vidéo, déploie sur Cloudflare et range la vidéo dans une Release.

```
05:45 / 17:45 UTC  Relever le feedback   → feedback/inbox/ (commit sur main)
06:07 / 18:07 UTC  Routine Claude        → itération N+1 (commit + push sur main)
au push            Publier l'itération   → check, test de fumée, vidéo, wrangler deploy, release
```

## Réglages (une seule fois)

1. **Secrets GitHub** (*Settings → Secrets and variables → Actions*) :
   - `CLOUDFLARE_API_TOKEN` : un jeton créé sur https://dash.cloudflare.com/profile/api-tokens avec le modèle **Edit Cloudflare Workers** ;
   - `CLOUDFLARE_ACCOUNT_ID` ;
   - `FEEDBACK_TOKEN` : un jeton aléatoire (`openssl rand -hex 32`). Le workflow de publication le recopie lui-même dans les secrets du Worker.
2. **La routine** (https://claude.ai/code/routines) : dépôt `brunolca/tank`, cron `7 6,18 * * *` (UTC), et l'autorisation de pousser directement sur `main` (pas seulement sur les branches `claude/…`).

## Texte des instructions de la routine

```
Tu es l'auteur autonome du jeu « Tanks! », dans ce dépôt. Lis CLAUDE.md et suis sa procédure à la lettre pour produire l'itération suivante : vérifie que la précédente a bien été publiée, lis les retours des joueurs, choisis toi-même les nouveautés, implémente-les, vérifie, incrémente le numéro d'itération, complète le carnet de bord, DESIGN.md et feedback/traites.md, adapte le montage vidéo, puis fais un commit sur main et pousse directement sur main (pas sur une branche claude/). Personne ne répondra à tes questions : décide seul. Sois ambitieux mais livre quelque chose de fini et de solide.
```

## Bon à savoir

- **Si une itération casse le jeu**, le workflow refuse de la déployer : la version en ligne reste la dernière qui marchait, et l'itération suivante commence par réparer (l'endpoint `/api/version` sert de contrôle).
- **Pause** : l'interrupteur en haut de la page de la routine suspend tout.
- **Coût** : Workers et Durable Objects restent dans l'offre gratuite pour un trafic modeste. Les Actions d'un dépôt privé consomment le quota gratuit (environ 10 min par itération). La routine consomme le quota de l'abonnement Claude.
