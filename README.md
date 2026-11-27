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
| `npm test` | Lance les tests automatiques des règles du jeu |
| `npm run build` | Crée la version à publier dans le dossier `dist/` |
| `npm run preview` | Ouvre la version publiable pour la vérifier |
| `node scripts/balance-sim.js` | Simule 15 minutes de jeu pour régler l'équilibre |
| `node scripts/render-model/render.mjs dragonnet` | Refait les images animées d'un monstre (`dragonnet`, `kraken`, `kraken_water`, `spectre`, `golem`) ou des personnes (`people`) à partir des modèles 3D. Il faut d'abord `npm install --no-save playwright` puis `npx playwright install chromium` |
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

## Crédits

- Décorations d'enclos : modèles 3D de [Poly Haven](https://polyhaven.com) (licence CC0).
- Sols des enclos : textures photo de [ambientCG](https://ambientcg.com) (Lava003, Tiles093, Ground037, Snow013, Ground110, Ground111, Ground071, PavingStones138, Rock012, Snow015, Snow008A — licence CC0).
- Visiteurs et gardiens : packs « Ultimate Modular Men / Women » de [Quaternius](https://quaternius.com) (licence CC0).
- `docs/` : document de conception et plan de construction.

## Modèles 3D : défauts connus

- **Golem** (`models/golem.glb`) :
  - *Walk* est animée à l'envers (le pied d'appui avance) : le jeu la joue à l'envers, ce qui donne une vraie marche
    sans glissement (vitesse 0,45 case / s, mesurée sur la foulée).
  - *GroundSlam* : les poings s'arrêtent à environ 0,4 unité au-dessus du sol (hauteur des genoux) ; les effets
    d'impact sont placés au sol, sous les poings. À corriger dans le fichier 3D (accroupissement plus profond).
  - *ChestBeat* : les poings ne touchent pas le torse (ils restent écartés, à 0,93 unité contre 0,96 au repos). À
    corriger dans le fichier 3D.
  - *Turn Left / Turn Right* ne sont pas utilisés : le jeu oriente le golem selon 8 directions pré-rendues.
