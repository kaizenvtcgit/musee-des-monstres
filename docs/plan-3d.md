# Plan : passer tout le jeu en 3D

Objectif : remplacer la vue 2D isométrique (Phaser) par une vue 3D (three.js) comme vue principale,
avec une caméra du dessus que l'on tourne **librement au clic droit**, et tous les outils de construction.
La « Visite 3D » à pied (déjà faite) devient un simple mode de caméra.

## Ce qui existe déjà

- `src/render3d/visit.js` (~1000 lignes) : visite 3D à la première personne, base du chantier.
  - `T = 2.5` m par case ; tuile (tx, ty) → monde (x = tx·T, z = ty·T).
  - Ciel + environnement PMREM, soleil avec ombres (suit le joueur), `buildGround` (pelouse, allées,
    sols d'enclos, bassins d'eau creusés), `buildWalls` (murs, poteaux, barreaux ou vitres côté allée),
    `buildBuildings` (stands, Fabrique à Monstres, incubateur avec œufs, base d'expédition),
    `buildTrees`, `syncMonsters` / `syncPeople` (modèles animés, positions lues dans la scène Phaser).
  - Modèles chargés depuis `src/assets/3d/*.glb.json` (`{"glb": base64}`), décodés puis `GLTFLoader.parseAsync`.
    Raison : l'hébergeur d'artifact ne sert pas les `.glb`, et la page intégrée interdit WASM (meshopt) et les `data:`.
  - `decor.glb.json` : tous les décors et abris d'enclos, exportés mais **pas encore affichés** en 3D
    (nœuds nommés ; maillages tagués `userData.lava` / `snow`, gueule `userData.mouth`).
- La simulation est dans `src/sim` (indépendante du rendu). Les outils de construction et la sélection
  sont dans `src/render/GameScene.js` : `setupInput`, `paintPath`, `handleClick(tile, pointer)`,
  `selectAt(tile, pointer)`, `drawGhost(tile)`.
- Menus et HUD : HTML dans `src/render/ui.js`, par-dessus le canvas ; à garder tels quels.

## Architecture choisie

- Nouveau `src/render3d/park3d.js`, construit à partir de `visit.js` (factoriser le commun plutôt que dupliquer).
- Canvas 3D plein écran sous `#ui`. Phaser continue de tourner **caché** (`scene.sys.setVisible(false)`,
  input désactivé) pour la simulation, l'errance des monstres et la logique d'animation.
- Caméra orbitale : cible, azimut 45°, élévation ~40°, distance ~45 m.
  Clic droit glissé = rotation libre ; molette = zoom ; clic milieu (ou gauche avec l'outil sélection) = déplacement ;
  ZQSD / WASD / flèches = déplacement. Un bouton bascule en marche à pied (mode visite actuel).
- Picking : rayon caméra → plan du sol → tuile `round(x/T), round(z/T)`.
  Exposer dans GameScene une API d'outils par tuile (down / move / up), extraire de `drawGhost`
  la liste des cases du fantôme (`ghostCells`), et `selectAt` avec l'entité touchée par le rayon.
  Fantômes 3D = quads instanciés colorés (vert valide / rouge invalide).
- Décors et abris : nœuds de `decor.glb.json`, échelle ×T ; réappliquer les retouches lave/neige
  (`onBeforeCompile`) ; gueule avec `depthTest` vrai.
- Comportements : clé d'animation 2D (`entry.sprite.anims.currentAnim.key`, avant-dernier segment séparé par `-`)
  → clip du GLB ; `sitdown` = `WakeUp` joué à l'envers. Orientation = `entry.dir × π/4`.
- Sons : remplacer `sounds.place` pour utiliser la position de la caméra 3D. Mettre à jour le texte `hud.help`.

## Étapes (une conversation chacune)

1. ✅ **Vue principale 3D** (fait : `park-scene.js` = scène commune, `park3d.js` = vue du dessus + bascule,
   `visit.js` = mode marche ; `?2d` dans l'adresse garde l'ancienne vue 2D pour les vérifications) : park3d.js, caméra orbitale (clic droit libre, molette, déplacement), Phaser caché,
   reconstruction de la scène quand le parc change (enclos / allées / bâtiments ajoutés ou démolis), bouton marche à pied.
2. ✅ **Outils et sélection** (fait : GameScene expose `toolDown` / `toolMove` / `toolUp` / `toolCancel` par case,
   `drawGhost` renvoie ses cases via `ghostCells`, `selectAt(tile, pointer, hit)` accepte ce que la 3D a touché ;
   `ParkScene.pick` = rayon → sol + monstre / personne / bâtiment, `showGhost` = cases colorées ; fiche « Gardien » ajoutée) : picking, fantômes 3D, tous les outils (allées, enclos, bâtiments, démolition), clic sur
   monstre / visiteur / bâtiment pour ouvrir sa fiche.
3. ✅ **Décors, abris, comportements, bulles, sons** (fait : `scenery.js` = instanciation + retouches lave/neige/lueur +
   gueule posée sur la roche + accessoires Poly Haven de `props.glb.json` (portail ouvert, sapins avec version légère au loin,
   banc, lampadaire, poubelle, pot, arbuste, jardinière) ; les monstres et personnes jouent le clip de leur animation 2D,
   temps calé sur `getProgress()` ; bulles dessinées par `src/render/bubbles.js` (2D 24 px, 3D 96 px, « ! » du gardien en
   poursuite) ; `Sounds.placer` = écoute depuis la caméra 3D ; `prop-gate.png` retiré pour rester à 511 fichiers) : remplacer le portail d'entrée (blocs blancs), la décoration
   de jardin (boule verte) et les arbres par des modèles (Poly Haven CC0 ou modèles fournis par l'utilisateur).
4. **Nettoyage et publication** : supprimer les images 2D devenues inutiles (la page en ligne est à la limite de
   511 fichiers), tests (`npx vitest run`), build, publication de l'artifact.

## Règles de travail

- **Ne pousser sur git que quand l'utilisateur le dit** (« envoie sur git »). Toujours committer en local.
- Économiser les tokens : peu de captures d'écran (seulement pour les points délicats),
  publier l'artifact seulement en fin d'étape.
- Outils utiles : build `npx vite build --base=./ --outDir <dossier> --emptyOutDir` ; serveur de dev
  `npx vite --port 5180 --strictPort` ; Chromium + Playwright préinstallés (WebGL via
  `--use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader`).
- Nouveau modèle GLB : `gltf-transform optimize in.glb out.glb --texture-compress webp --texture-size 1024
  --compress quantize --simplify-ratio 0.5 --simplify-error 0.002` (ajouter `--prune false` s'il contient des
  nœuds vides utiles, comme les `EggSlot` de l'incubateur), puis `node scripts/3d/glb-to-json.mjs <fichier.glb>`.
  Pas de meshopt ni de Draco (WASM interdit).
- Publication : artifact https://claude.ai/artifact/PgWdmUxkqwRVQubxAekMrm (lister ses fichiers avant de
  publier ; envoyer seulement les fichiers changés, `null` pour ceux à retirer).
