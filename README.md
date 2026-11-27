# Musée des Monstres

Prototype d'un jeu de gestion dans le navigateur : construis un musée de monstres vivants, envoie des expéditions chercher des œufs, rends les visiteurs heureux… et rattrape les monstres qui s'évadent.

## Lancer le jeu

Il faut [Node.js](https://nodejs.org) (version 20 ou plus).

```powershell
npm install
```

```powershell
npm run dev
```

Puis ouvre l'adresse affichée (http://localhost:5180).

## Commandes

| Commande | Rôle |
|---|---|
| `npm run dev` | Lance le jeu en mode développement |
| http://localhost:5180/?test | **Mode test** : argent illimité, et une partie de test sauvegardée à part (ta vraie partie n'est pas touchée). N'existe qu'en développement, jamais dans la version publiée |
| `npm test` | Lance les tests automatiques des règles du jeu |
| `npm run build` | Crée la version à publier dans le dossier `dist/` |
| `npm run preview` | Ouvre la version publiable pour la vérifier |
| `node scripts/balance-sim.js` | Simule 15 minutes de jeu pour régler l'équilibre |
| `node scripts/render-model/render.mjs dragonnet` | Refait les images animées d'un monstre (`dragonnet`, `kraken`, `kraken_water`, `spectre`, `golem`, `yeti`) ou des personnes (`people`) à partir des modèles 3D. Il faut d'abord `npm install --no-save playwright` puis `npx playwright install chromium` |
| `node scripts/render-model/render-fence.mjs` | Refait les images des barrières des enclos (barreaux de fer, et vitres là où un enclos touche une allée), dessinées dans `scripts/render-model/fence.html` |
| `node scripts/render-model/render-ground.mjs` | Refait les sols des enclos (lave, eau, crypte, forêt, neige) à partir de textures photo, téléchargées automatiquement |
| `node scripts/render-model/render-decor.mjs` | Refait les images des décorations d'enclos (modèles Poly Haven téléchargés automatiquement, ou fabriqués dans `scripts/render-model/decor.html`) |

## Comment jouer

- **Clic gauche** : utiliser l'outil choisi (glisser pour tracer une allée ou un enclos).
- **Clic droit, ou glisser avec l'outil Sélection** : déplacer la vue. **Molette** : zoomer. **Échap** : annuler l'outil.
- Clique sur la **tente** pour lancer une expédition, puis sur la **couveuse** pour placer le monstre né.
- **Habitats** : chaque monstre peut vivre dans 3 habitats (ex. le dragonnet : lave, champ de cendres, canyon de basalte), avec chacun son sol et ses 3 décorations. Varier les habitats fait monter la réputation ; certains (abysses, grotte de cristal) attirent davantage les visiteurs.
- **Abri** (dans le sélecteur Décoration) : antre volcanique, grotte sous-marine, mausolée, tertre moussu ou caverne de glace, sur 2 × 2 cases d'un enclos d'au moins 6 cases. Le monstre s'y réfugie de temps en temps (plus souvent s'il est stressé) : il se repose à l'entrée, ou s'y cache et on ne voit plus que ses yeux. Il y est plus heureux, mais caché il n'attire plus les visiteurs.
- **Décoration** : le jardin (sur l'herbe, rend les visiteurs heureux) ou 3 décorations par habitat, à placer dans un enclos du bon habitat : monstres plus heureux, visiteurs plus attirés (les 4 premières comptent).
- Un monstre malheureux s'évade : clique dessus pour l'attraper, ou embauche des gardiens.
- La partie est **sauvegardée automatiquement** dans le navigateur (toutes les 20 secondes et quand on quitte la page) et reprend à la réouverture. Le bouton **Nouvelle partie** (deux clics) efface la sauvegarde.

## Organisation du code

- `src/sim/` : toutes les règles du jeu (sans affichage), testées dans `tests/sim/`.
- `src/sim/save.js` : transforme une partie en données (et l'inverse) ; `src/save/storage.js` : l'enregistre dans le navigateur.
- `src/render/` : l'affichage (Phaser) et l'interface (HTML).
- `src/render/monsterfx.js` : effets en plus de certains monstres (fondus entre animations ; spectre : brume, lueur, apparition), réglés par espèce dans `MONSTER_FX` (`src/render/sprites.js`).
- `src/config/balance.js` : tous les chiffres à régler (prix, vitesses, probabilités).
- `src/i18n/fr.js` : tous les textes du jeu.
- `models/` : les modèles 3D animés (.glb, .gltf), transformés en images par `scripts/render-model/`.
  Les personnes ne sont pas dans le dépôt (trop lourdes) : pour refaire leurs images, télécharge le dossier glTF
  « Individual Characters » des packs [Ultimate Modular Men](https://quaternius.com/packs/ultimatemodularcharacters.html)
  et [Ultimate Modular Women](https://quaternius.com/packs/ultimatemodularwomen.html) dans `models/people/men/` et `models/people/women/`.

## Visite 3D

Le bouton « 🚶 Visite 3D » (barre du haut) fait marcher le joueur dans le musée, à la première personne,
en vraie 3D (three.js, `src/render3d/visit.js`) : le parc est reconstruit à partir de la partie en cours
(pelouse, allées, sols des enclos, murs avec grilles ou vitres, bâtiments, forêt), et les monstres 3D,
les visiteurs et les gardiens se déplacent là où le jeu 2D les place. Le jeu continue pendant la visite.

- Z Q S D (ou W A S D) ou flèches : marcher · Maj : courir · souris : regarder (clic pour capturer la souris)
  · Échap : quitter. Sur écran tactile : pouce gauche pour marcher, pouce droit pour regarder.
- Ce code et ses fichiers (≈ 15 Mo) ne sont téléchargés qu'au lancement de la visite.
- `src/assets/3d/*.glb.json` : copies allégées des monstres (`models/*.glb`) et de 5 personnages Quaternius
  (textures 1024 px en WebP, maillages simplifiés et quantifiés, animations utiles seulement),
  emballées dans du JSON par `scripts/3d/glb-to-json.mjs` (certains hébergeurs ne servent pas les .glb) ; pas de
  compression « meshopt » ni Draco : elles demandent du WebAssembly, que certaines pages intégrées interdisent.
  Pour les refaire : `npx @gltf-transform/cli optimize models/<m>.glb out.glb --texture-compress webp
  --texture-size 1024 --compress quantize --simplify-ratio 0.5 --simplify-error 0.002`, puis le script ci-dessus.
- `src/assets/3d/tex/` : textures de sol et de mur (ambientCG, CC0) en 512 px.

## Crédits

- Décorations d'enclos : modèles 3D de [Poly Haven](https://polyhaven.com) (licence CC0).
- Sols : textures photo de [ambientCG](https://ambientcg.com) (licence CC0) — pelouse Grass004, allées PavingStones070, enclos Lava003, Tiles093, Ground068, Snow013, Ground110, Ground111, Ground071, PavingStones138, Rock012, Snow015, Snow008A.
- Visiteurs et gardiens : packs « Ultimate Modular Men / Women » de [Quaternius](https://quaternius.com) (licence CC0).
- `docs/` : document de conception et plan de construction.

## Fourrure du yéti

La fourrure est fabriquée par l'outil de rendu (`scripts/render-model/render.html`, fonction `addFur`) avec la technique
des **coques** (*shell fur*) : le maillage animé est redessiné 20 fois, chaque copie un peu plus loin de la peau, et on ne
garde que la section des poils sur chaque copie. Les poils suivent donc le squelette et toutes les animations, et se
voient sur la silhouette. Ils sont « cuits » dans les images du jeu : **aucun coût pendant le jeu**, quel que soit le
nombre de yétis (pas besoin de niveaux de détail ni de mode « configuration faible » pour la fourrure).

- Zones à poils : le masque `models/yeti/yeti_fur_mask.webp` (dans les UV du modèle), préparé en
  `yeti_fur_mask_prepared.png` (petits trous bouchés, bords adoucis) ; pas de poils sur les mains et les pieds.
- Réglages dans `scripts/render-model/render.mjs` (`MODELS.yeti.fur`) : `length` (longueur), `cell` (écart entre les
  poils), `thickness` (épaisseur), `density`, `layers` (nombre de couches = qualité), `colors` / `colorMix` (blanc,
  blanc cassé, gris clair, mêlés à la texture d'origine), `rootShade` (ombre à la racine), `gravity`, `regions`
  (longueur par os : plus longue sur la tête, les épaules et le torse, plus courte sur les jambes et les avant-bras).
- Mouvement : par animation, `furMove` (`trail` : les pointes traînent derrière le mouvement ; `shake` : secousse
  pendant *ShakeFur*).

## Modèles 3D : défauts connus

- **Golem** (`models/golem.glb`) :
  - *Walk* est animée à l'envers (le pied d'appui avance) : le jeu la joue à l'envers, ce qui donne une vraie marche
    sans glissement (vitesse 0,45 case / s, mesurée sur la foulée).
  - *GroundSlam* : les poings s'arrêtent à environ 0,4 unité au-dessus du sol (hauteur des genoux) ; les effets
    d'impact sont placés au sol, sous les poings. À corriger dans le fichier 3D (accroupissement plus profond).
  - *ChestBeat* : les poings ne touchent pas le torse (ils restent écartés, à 0,93 unité contre 0,96 au repos). À
    corriger dans le fichier 3D.
  - *Turn Left / Turn Right* ne sont pas utilisés : le jeu oriente le golem selon 8 directions pré-rendues.
- **Yéti** (`models/yeti.glb`) :
  - Les mains sont **soudées aux cuisses** dans le maillage, et des sommets des flancs suivent les bras : bras levés
    (*Stretch*, *Happy*, *Threat*…), une membrane de peau se formait sous les aisselles. Corrigé au chargement, sans
    modifier le fichier : sous les épaules chaque sommet suit soit le bras soit le corps, et les rares triangles étirés
    à l'extrême ne sont pas dessinés. Il reste quelques filaments et de petites zones claires sur les cuisses, bras levés.
    La vraie correction est dans le fichier 3D : séparer les mains des cuisses et revoir les poids des aisselles.
  - Le masque de fourrure est prudent : environ un tiers de ses zones noires ont une texture de poils (pelage moins
    dense par endroits).
  - *Turn Left / Turn Right* ne sont pas utilisés : le jeu oriente le yéti selon 8 directions pré-rendues.
