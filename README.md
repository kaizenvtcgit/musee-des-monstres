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
| `node scripts/render-model/render-decor.mjs` | Refait les décorations d'enclos et les abris : le fichier 3D `src/assets/3d/decor.glb.json` et leurs icônes des menus (modèles Poly Haven téléchargés automatiquement, ou fabriqués dans `scripts/render-model/decor.html`). Il faut d'abord `npm install --no-save playwright` puis `npx playwright install chromium` |
| `node scripts/render-model/render-ground.mjs` | Refait les icônes des sols (allée, habitats) à partir de textures photo, téléchargées automatiquement |
| `node scripts/3d/glb-to-json.mjs fichier.glb` | Emballe un modèle `.glb` dans un `.glb.json` (voir « Modèles 3D ») |
| `node scripts/3d/atm-to-glb.cjs` | Refait le distributeur de billets (`src/assets/3d/atm.glb.json`) à partir de `models/parking/` (détails en tête du script) |
| `node scripts/3d/cars-to-glb.cjs` | Refait les voitures du parking (`src/assets/3d/cars.glb.json`) à partir de `models/cars/*.fbx` (détails en tête du script) |

## Comment jouer

Le parc est en 3D, vu du dessus.

**Caméra**

- **Clic droit maintenu** : tourner la vue librement (et l'incliner en montant / descendant la souris).
- **Molette** : zoomer.
- **Clic molette maintenu**, ou **glisser avec l'outil Sélection**, ou **Z Q S D / W A S D / flèches** : se déplacer
  (Maj : plus vite).
- **Écran tactile** : un doigt pour se déplacer (ou pour utiliser l'outil choisi), deux doigts pour zoomer et tourner.
- **🚶 Marche à pied** (barre du haut) : se promener dans le musée comme un visiteur, à la première personne
  (Z Q S D ou flèches pour marcher, Maj pour courir, la souris pour regarder ; sur écran tactile, pouce gauche
  pour marcher et pouce droit pour regarder). **🗺️ Vue du dessus** ou **Échap** pour revenir.

**Outils** (barre du bas) : le clic gauche utilise l'outil sur la case visée, quel que soit l'angle de la caméra ;
un aperçu montre les cases (vert : possible, rouge : impossible). **Échap** revient à la Sélection.

- **Sélection** : clic sur un monstre, un visiteur, un gardien, un bâtiment ou un enclos pour ouvrir sa fiche.
  Clique sur la **tente** (base d'expédition) pour lancer une expédition, puis sur l'**incubateur** pour placer le
  monstre né (on voit les œufs dedans, qui brillent et bougent à l'approche de l'éclosion).
- **Allée** : glisser pour tracer.
- **Enclos** : choisir l'habitat, puis glisser un rectangle. Deux enclos voisins du même habitat fusionnent.
- **Décoration** : le jardin (sur l'herbe : pot de plante, arbuste, lampadaire, banc, jardinière, rochers ou
  poubelle ; rend les visiteurs heureux), 3 décorations par habitat à placer dans un enclos du bon habitat
  (monstres plus heureux, visiteurs plus attirés ; les 4 premières comptent), et l'**abri** : antre volcanique,
  grotte sous-marine, mausolée, tertre moussu ou caverne de glace, sur 2 × 2 cases d'un enclos d'au moins 6 cases.
  Le monstre s'y réfugie de temps en temps (plus souvent s'il est stressé) : il se repose à l'entrée, ou s'y cache.
  Il y est plus heureux, mais caché il n'attire plus les visiteurs.
- **Snack**, **Souvenirs** (la Fabrique à Monstres) : les visiteurs y dépensent leur argent.
- **Distributeur** (400 pièces) : un distributeur de billets à poser au bord d'une allée. Les visiteurs qui passent
  devant retirent de l'argent et dépensent ensuite 25 % de plus au snack et à la boutique.
- **Parking** (1 500 pièces, un seul) : à poser sur l'herbe devant l'entrée, entre le parc et la route (pas devant le
  portail). Les visiteurs viennent 30 % plus souvent, en voiture : elle arrive par la route, se gare, ses passagers
  (1 à 3) marchent jusqu'à l'entrée, et quand ils sont tous revenus elle sort en marche arrière et repart. Plein
  (12 places), les visiteurs arrivent à pied comme avant. Clic dessus : sa fiche (places occupées, démolition).
- **Gardien** : rattrape les monstres évadés (un « ! » au-dessus de sa tête pendant la poursuite).
- **Démolir** : retire une allée, un enclos, un bâtiment ou une décoration.

**Le reste**

- **Habitats** : chaque monstre peut vivre dans 3 habitats (ex. le dragonnet : lave, champ de cendres, canyon de
  basalte). Varier les habitats fait monter la réputation ; certains (abysses, grotte de cristal) attirent davantage.
- Les monstres vivent leur vie : ils flânent, regardent autour d'eux, s'étirent, font la sieste, menacent quand ils
  sont malheureux. Un monstre malheureux s'évade : clique dessus pour l'attraper, ou embauche des gardiens.
- Les bulles au-dessus des têtes disent l'humeur (cœur : ravi, points : s'ennuie, pomme : a faim, « ! » rouge : a peur).
- La partie est **sauvegardée automatiquement** dans le navigateur (toutes les 20 secondes et quand on quitte la
  page) et reprend à la réouverture. Le bouton **Nouvelle partie** (deux clics) efface la sauvegarde.
- Sur un ordinateur modeste ou un téléphone, l'image s'allège toute seule si le jeu ralentit (moins de pixels,
  puis ombres réduites, puis sans ombres).

## Organisation du code

- `src/sim/` : toutes les règles du jeu (sans affichage), testées dans `tests/sim/`.
- `src/sim/save.js` : transforme une partie en données (et l'inverse) ; `src/save/storage.js` : l'enregistre dans le navigateur.
- `src/sim/parking.js` : le parking, ses voitures et leurs trajets (testés dans `tests/sim/parking.test.js`).
- `src/render3d/` : ce qu'on voit, en 3D (three.js).
  - `park-scene.js` : le parc (sol, allées, murs, bâtiments, forêt), reconstruit quand il change ; les monstres et
    les personnes ; le choix de ce qui est sous le pointeur ; les bulles ; les portraits des fiches.
  - `scenery.js` : les objets répétés, dessinés par instanciation (décorations, abris, arbres, mobilier du jardin).
  - `park3d.js` : la vue du dessus (caméra, outils), la bascule vers la marche à pied, la qualité adaptée à
    l'appareil, les sons entendus depuis la caméra.
  - `visit.js` : la marche à pied.
  - `parking3d.js` : la route, le parking et ses voitures (roues qui tournent, peintures variées).
- `src/render/GameScene.js` : une scène Phaser **cachée** qui fait tourner le jeu (rien n'y est dessiné) : elle
  avance la simulation, décide ce que fait chaque monstre (flâner, se reposer, une action, une sieste…) et joue son
  animation (sur une texture vide) ; la vue 3D joue le clip du même nom, au même moment. Elle porte aussi les outils
  (par case : `toolDown` / `toolMove` / `toolUp`).
- `src/render/sprites.js` : les animations (vitesses, comportements par espèce dans `MONSTER_FX`) ; leur nombre
  d'images est dans `src/config/anim-frames.json`, les instants des sons (pas, coups…) dans `src/config/anim-events/`.
- `src/render/ui.js` : l'interface (HTML, par-dessus la 3D) ; `src/render/sound.js` : les sons, synthétisés.
- `src/config/balance.js` : tous les chiffres à régler (prix, vitesses, probabilités).
- `src/i18n/fr.js` : tous les textes du jeu.

## Modèles 3D

- `src/assets/3d/*.glb.json` : copies allégées des monstres (`models/*.glb`), des bâtiments, de 5 personnages
  Quaternius, des décorations d'enclos (`decor.glb.json`) et du mobilier du parc (`props.glb.json`), emballées dans
  du JSON par `scripts/3d/glb-to-json.mjs` (certains hébergeurs ne servent pas les .glb). Pas de compression
  « meshopt » ni Draco : elles demandent du WebAssembly, que certaines pages intégrées interdisent.
- Pour en refaire un : `npx @gltf-transform/cli optimize in.glb out.glb --texture-compress webp --texture-size 1024
  --compress quantize --simplify-ratio 0.5 --simplify-error 0.002` (ajouter `--prune false` s'il contient des nœuds
  vides utiles, comme les `EggSlot` de l'incubateur), puis le script ci-dessus.
- `props.glb.json` : une scène nommée par objet (`entranceGate`, `firTree`, `pineTree`, `pineTreeLow` — le pin très
  simplifié des arbres lointains —, `parkBench`, `streetLamp`, `trashCan`, `pottedPlant`, `shrub`, `planterBox`).
- `shelters.glb.json` : les 5 abris (`shelter-lava`, `-water`, `-forest`, `-ice`, `-dark`), modelés dans Blender
  (`models/blender/musee-decors.blend`, scène `MuseeShelters`) pour 3 × 3 cases, leurs matières précalculées en
  textures (couleur, relief, lueur), avec une vraie grotte creusée où le monstre entre. Le jeu les met à l'échelle
  de leur monstre (`SHELTER_MODEL_SCALE`, `src/render/shelterpath.js`).
- `expedition-interior.glb.json` : l'aménagement de la tente d'expédition (plancher, table, lits de camp,
  caisses, œuf dans la paille, lampe), fait dans Blender (scène `TentInterior`) dans le repère du modèle de la tente,
  placé avec elle (`placeModel`, paramètre `inside`).
- `src/assets/3d/tex/` : textures de sol et de mur (ambientCG, CC0) en 512 px.
- Les personnes ne sont pas dans `models/` (trop lourdes) : les originaux sont les dossiers glTF « Individual
  Characters » des packs [Ultimate Modular Men](https://quaternius.com/packs/ultimatemodularcharacters.html)
  et [Ultimate Modular Women](https://quaternius.com/packs/ultimatemodularwomen.html).

## Crédits

- Monstres (dragonnet, kraken, spectre, golem, yéti), stands, Fabrique à Monstres, incubateur, base d'expédition :
  modèles 3D du projet (`models/`).
- Décorations d'enclos : modèles 3D de [Poly Haven](https://polyhaven.com) (licence CC0), ou fabriqués dans
  `scripts/render-model/decor.html`.
- Mobilier et arbres du parc (`src/assets/3d/props.glb.json`) : portail `large_iron_gate`, sapins `fir_sapling` et
  `pine_sapling_small`, banc `painted_wooden_bench`, lampadaire `street_lamp_01`, poubelle `metal_trash_can`,
  arbuste `shrub_03`, pot `potted_plant_02`, jardinière `planter_box_01`, de [Poly Haven](https://polyhaven.com)
  (licence CC0), allégés avec gltf-transform.
- Sols : textures photo de [ambientCG](https://ambientcg.com) (licence CC0) — pelouse Grass004, allées PavingStones070, enclos Lava003, Tiles093, Ground068, Snow013, Ground110, Ground111, Ground071, PavingStones138, Rock012, Snow015, Snow008A.
- Visiteurs et gardiens : packs « Ultimate Modular Men / Women » de [Quaternius](https://quaternius.com) (licence CC0).
- Voitures du parking : « [Cars Pack](https://quaternius.com/packs/cars.html) » de Quaternius (licence CC0),
  originaux dans `models/cars/`.
- Distributeur de billets : modèle fourni pour le projet (`models/parking/ATM.fbx` et ses textures), refait en
  `src/assets/3d/atm.glb.json` par `scripts/3d/atm-to-glb.cjs` (textures 512 px).
- Bibliothèques : [three.js](https://threejs.org) (3D) et [Phaser](https://phaser.io) (boucle de jeu), licence MIT.
- `docs/` : document de conception et plan de construction.

## Modèles 3D : défauts connus

- **Golem** (`models/golem.glb`) :
  - *Walk* est animée à l'envers (le pied d'appui avance) : la vue 3D la joue à l'envers, ce qui donne une vraie
    marche sans glissement (vitesse 0,45 case / s, mesurée sur la foulée).
  - *GroundSlam* : les poings s'arrêtent à environ 0,4 unité au-dessus du sol (hauteur des genoux) ; les effets
    d'impact sont placés au sol, sous les poings. À corriger dans le fichier 3D (accroupissement plus profond).
  - *ChestBeat* : les poings ne touchent pas le torse (ils restent écartés, à 0,93 unité contre 0,96 au repos). À
    corriger dans le fichier 3D.
  - *Turn Left / Turn Right* ne sont pas utilisés : la vue 3D tourne le modèle vers sa direction.
- **Yéti** (`models/yeti.glb`) :
  - Les mains sont **soudées aux cuisses** dans le maillage, et des sommets des flancs suivent les bras : bras levés
    (*Stretch*, *Happy*, *Threat*…), une membrane de peau se forme sous les aisselles. La correction est à faire dans
    le fichier 3D : séparer les mains des cuisses et revoir les poids des aisselles.
  - *Turn Left / Turn Right* ne sont pas utilisés : la vue 3D tourne le modèle vers sa direction.
  - Sa fourrure en coques (*shell fur*), qui était cuite dans les anciennes images 2D, n'existe pas (encore) en 3D.
