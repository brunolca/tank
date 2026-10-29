# Tanks! : la bible

Document vivant, tenu à jour à chaque itération. Il décrit le jeu tel qu'il est, puis les idées pour la suite.

## Le concept

Des tanks jouets en bois s'affrontent sur une table de jeu vue de dessus, comme dans *Tanks* de Wii Play. Un obus tue en un coup et ricoche sur les murs. On gagne en lisant les angles, en esquivant et en posant des mines au bon endroit. Le jeu se joue en ligne jusqu'à quatre : en coopération contre l'IA, ou chacun pour soi.

Le jeu **s'améliore tout seul** : toutes les 12 heures, une nouvelle itération ajoute quelque chose. Le tampon rouge de l'accueil donne le numéro de l'itération, et le carnet de bord raconte l'histoire du jeu.

## Identité

- **Ton** : jouet, léger, nerveux. Les tanks sont des jouets ; les explosions sont des éclats de bois et de la fumée, jamais du gore.
- **Couleurs** : table sombre `#23262f`, terrain en papier crème (`#efdcb8` → `#e3cba0`), murs en bois clair, cadre en bois foncé, accent orange `#ffb43d`, rouge du tampon `#e2453c`.
- **Interface** : cartes en verre dépoli sombre, police Rubik, gros boutons orange en relief.
- **Couleurs des joueurs** : bleu, rouge, vert, orange, cyan, violet (`PLAYER_COLORS`).
- **Couleurs des ennemis** (elles disent le comportement, comme dans l'original) : brun, gris, turquoise, jaune, rose, vert, violet, blanc, noir (`ENEMY_COLORS`).

## Systèmes (itération 4)

- **Architecture** : Worker Cloudflare et un Durable Object `Room` par salle. La simulation autoritaire tourne à 30 Hz, avec deux sous-pas pour les obus. Le client prédit son propre tank (rejeu des entrées non confirmées) et affiche les autres tanks 100 ms en retard, par interpolation. Ses propres obus sont extrapolés.
- **Terrain** : grille de 22 × 17. Les murs (`#`) et les murs hauts (`H`) bloquent tout. Le liège (`o`) bloque aussi tout, mais saute avec les mines. Les trous (`_`) bloquent les tanks, pas les obus. Les portails (`*` bleu, `+` rose, voir plus bas) laissent tout passer.
- **Joueur** : vitesse 3, 5 obus en vol au maximum, 1 rebond, 2 mines. Le tir ami est actif et l'on peut se tuer avec son propre ricochet.
- **Mines** : elles explosent au bout de 10 s ; elles clignotent dans les 2,5 dernières secondes. Un tank adverse qui approche à moins de 1,25 les déclenche (0,55 s de mèche). Un obus aussi. Le souffle (rayon 1,55) détruit les tanks, les obus, le liège, et fait sauter les autres mines en chaîne.
- **Ennemis** (`SPECS`) :
  - brun : immobile, balaie lentement avec sa tourelle ;
  - gris : lent, 1 rebond ;
  - turquoise : missile rapide, sans rebond ;
  - jaune : rapide, sème jusqu'à 4 mines ;
  - rose : rafales de 3 obus ;
  - vert : immobile, missiles à 2 rebonds, vise au ricochet ;
  - violet : rapide, 5 obus, des mines ;
  - blanc : invisible (seules ses traces le trahissent) ;
  - noir : le plus rapide, missiles ;
  - Colosse (boss, rouge couronné d'or) : voir plus bas.
- **IA** : elle échantillonne des angles et lance des rayons avec ricochets (`castRicochet`) pour trouver un tir qui touche un adversaire avant un allié ou elle-même. Elle esquive les obus qui arrivent, fuit les mines, se déplace sur la grille (BFS) en visant une distance préférée à sa cible, et pose ses mines loin de ses alliés.
- **Campagne coop** : 18 missions faites main (`LEVELS`, la 10ᵉ est le premier boss), puis des missions générées à l'infini, symétriques, avec une difficulté qui monte (`proceduralLevel`). Toutes les missions multiples de 10 au-delà sont des combats de boss (`isBossMission`, `bossLevel` : deux arènes ouvertes en alternance, le Colosse et deux escortes de plus en plus coriaces). 3 vies partagées, +1 vie toutes les 5 missions. Les ennemis détruits restent détruits quand on recommence une mission.
- **Versus** : arènes tirées des missions, départs dans les coins, le dernier debout marque un point, premier à 5.
- **Salles** : codes de 5 caractères, lien `/r/CODE`, 4 joueurs au maximum. Un joueur qui se reconnecte garde sa place (`tanks.pid`). Celui qui arrive en cours de partie regarde, puis entre à la mission suivante.
- **Caisses bonus** (itération 2, `stepBonuses` dans `sim.ts`) : une caisse en bois tombe sur une case libre, loin des tanks, des mines et des autres caisses. En coop, la première arrive après 8 s, puis toutes les 13 à 19 s ; en versus, après 5 s puis toutes les 8 à 12 s. Deux caisses au plus sur la table ; chacune reste 16 s et clignote les 3 dernières. Seuls les tanks des joueurs les ramassent (les ennemis roulent dessus sans les prendre). Quatre bonus (`BONUS_INFO`, l'ordre de `BONUS_KINDS` est celui du réseau : on ajoute à la fin, on ne réordonne jamais) :
  - bouclier (bleu) : absorbe un coup, obus ou souffle de mine, puis 0,5 s de répit ;
  - super-ricochet (orange) : +1 rebond pendant 12 s ;
  - turbo (vert) : vitesse × 1,45 pendant 10 s (la prédiction du client en tient compte) ;
  - tir en éventail (rose) : deux obus de plus à ± 0,2 rad pendant 10 s.
  Les bonus actifs voyagent dans les drapeaux des tanks (bits 4, 8, 16, 32) ; les caisses dans le champ facultatif `P` des instantanés. Les tanks joueurs pilotés par l'IA (mode démo) foncent vers les caisses proches.
- **Boss : le Colosse** (itération 3, `SPECS.boss`, `updateBoss` et `bossVolley` dans `sim.ts`). Rayon 0,62 au lieu de 0,36 (chaque tank a désormais son rayon `r`, `tankRadius(kind)`), il pousse les petits tanks. Points de vie : 8, +3 par joueur au-delà du premier (`BOSS_HP_PER_PLAYER`) ; chaque obus ou souffle de mine retire 1 PV, puis 0,25 s de répit. Les PV restent acquis quand on recommence la mission (`enemyHp` dans `room.ts`). Toutes les 7,5 s environ, il s'arrête, s'illumine 0,9 s (drapeau 64) puis tire une salve circulaire de 10 obus sans rebond. À mi-vie, colère (drapeau 128) : vitesse × 1,35, cadence × 1/0,7, une mine de plus, salve de 14 obus toutes les 4,8 s. Son IA planifie ses trajets sur une grille « dilatée » (il ne passe que là où toutes les cases voisines sont libres). Réseau : 7ᵉ champ facultatif des tanks (PV), `hp` dans `TankInfo` (PV max), événements `hurt`, `volley`, `rage`. Client : barre de vie en haut, flash blanc à chaque coup, étincelles aspirées pendant la charge, fumée en colère, chute en chaîne d'explosions, musique de boss (intensité 2, 150 bpm, mode mineur).
- **Portails** (itération 4, `Tile.PortalA` / `Tile.PortalB`, `warpTarget` et `portalTwin` dans `physics.ts`). Chaque symbole apparaît exactement deux fois par carte (vérifié par `simtest`). Quand le centre d’un tank ou d’un obus entre dans une case portail depuis une autre case, il ressort au centre du portail jumeau, avec la même vitesse. La règle est purement positionnelle : la prédiction du client (`driveStep`, partagé) tombe d’accord avec le serveur sans état supplémentaire. Les tanks plus gros que `PORTAL_MAX_R` (le Colosse) ne passent pas. `castRicochet` suit les portails, donc l’IA vise à travers ; en revanche ses trajets (BFS) évitent les cases portail, et un tank qui y glisse par accident replanifie de l’autre côté. Missions : « Escouade » (6, aussi en versus), « Coalition » (14), « Va-et-vient » (18, un tank vert enfermé qu’on n’atteint que par un portail) ; les missions générées à partir de la 19ᵉ en ont une ou deux paires dans 65 % des cas (`addPortals`, flux aléatoire séparé). Réseau : événement `warp` (départ, arrivée, id du tank ou 0 pour un obus) ; les anciens clients l’ignorent. Client : cerceau de bois, spirale tournante additive, halo peint sur le papier, gerbes de lumière aux deux bouts, petit son glissé ; l’interpolation saute au lieu de glisser quand un objet se déplace de plus de 1,2 case entre deux instantanés. Un message rappelle la règle au début d’une mission qui a des portails.
- **Rendu** : Three.js, ombres douces, tone mapping ACES. Les traces de chenilles, les brûlures et les croix des tanks détruits sont dessinées dans la texture du sol. Particules instanciées (lueur, fumée, débris), onde de choc, éclair de lumière, tremblement de caméra.
- **Son** : tout est synthétisé en WebAudio (tirs, rebonds, explosions, jingles), avec une petite marche procédurale. `M` coupe la musique.
- **Équilibrage de l'IA** : chaque fiche a un temps de réaction (`reaction`) entre le moment où l'IA trouve un tir et celui où elle tire, et une erreur de visée (`aimError`). Les tanks simples (compétence < 2) repèrent les obus tard et pas à chaque fois. Les ennemis attendent 2 à 3,5 s avant leur premier tir de la mission.
- **Retours des joueurs** : le bouton « Ton avis » (touche F) capture l'écran. Le joueur peut y entourer jusqu'à 6 zones, dont le contenu est décrit dans le contexte (tanks, obus, mines, cases), et joindre un fichier. Le contexte automatique comprend l'itération, l'écran, le mode, la mission, la position des tanks, les 40 derniers événements, les erreurs, le ping, les FPS et l'appareil. Les retours sont stockés dans le Durable Object `FeedbackStore` (limite de 12 par heure et par IP), puis relevés dans `feedback/inbox/` deux fois par jour.
- **Mode démo** (`?demo=1`) : des tanks aux couleurs des joueurs, pilotés par l'IA, contre une mission. Il sert aux vidéos (`window.__demo` : `play(mission, héros, riche, pvBoss)` où « riche » fait pleuvoir les caisses, `crate(type)` pour poser une caisse, `buff(type)` pour donner un bonus aux héros, `hitBoss()` pour toucher le boss, `volley()` pour déclencher sa salve, `portal()` pour envoyer les héros vers le portail le plus proche). Les caisses tombent aussi dans le fond animé de l'accueil.

## Carnet d'idées

- Défi quotidien : une mission générée à partir de la date, même graine pour tout le monde, classement du jour (Durable Object dédié).
- Éditeur de missions dans le navigateur, missions partagées par lien.
- ~~Bonus ramassables : bouclier d'un coup, obus à 2 rebonds~~ (itération 2 : caisses bonus). Reste : mine télécommandée.
- ~~Boss toutes les 10 missions~~ (itération 3 : le Colosse). Reste : d'autres boss qui alternent (un boss foreur qui traverse le liège, un boss poseur de mines géantes, un boss à deux tourelles indépendantes), des renforts appelés à mi-vie, un mode « boss rush ».
- Nouveaux terrains : glace (glisse), sable (lent), ~~téléporteurs~~ (itération 4 : portails), ponts au-dessus des trous.
- Portails, la suite : portails mobiles ou qui s’ouvrent et se ferment en rythme, portail à sens unique, un boss qui ouvre ses propres portails, une mine qui traverse un portail quand on la pousse.
- Mode « capture du drapeau » en équipes 2 contre 2.
- Bots pour compléter le versus quand on est moins de 4.
- Écran des records : mission la plus loin atteinte en coop, par salle et au global.
- Météo et éclairage : nuit avec phares des tanks, orage qui illumine.
- Accessibilité : palette pour daltoniens, réglage de la vitesse du jeu en solo, sous-titres des sons.
- Chat rapide par émoticônes dans le salon et en jeu.
- Replays : la simulation est déjà autoritaire, on peut enregistrer les entrées.
- Bonus en plus : aimant à obus, mine téléguidée, fantôme (traverse un mur une fois), gel des ennemis 3 s.
- Ennemi « pilleur » qui vole les caisses bonus avant les joueurs.
- Mode « chasse aux caisses » en versus : la caisse rapporte un point.
- Tableau d'honneur des boss : temps pour vaincre le Colosse, par salle.
- Petits tanks qui tiennent deux coups (blindés) dans les missions générées tardives, avec la même barre de vie miniature.
