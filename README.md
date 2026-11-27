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
| `node scripts/render-model/render.mjs dragonnet` | Refait les images animées d'un monstre (`dragonnet`) ou des personnes (`people`) à partir des modèles 3D. Il faut d'abord `npm install --no-save playwright` puis `npx playwright install chromium` |
| `node scripts/render-model/render-fence.mjs` | Refait les images des barrières des enclos (barreaux de fer, et vitres là où un enclos touche une allée), dessinées dans `scripts/render-model/fence.html` |
| `node scripts/render-model/render-ground.mjs` | Refait les sols des enclos (lave, eau, crypte, forêt, neige) à partir de textures photo, téléchargées automatiquement |

## Comment jouer

- **Clic gauche** : utiliser l'outil choisi (glisser pour tracer une allée ou un enclos).
- **Clic droit, ou glisser avec l'outil Sélection** : déplacer la vue. **Molette** : zoomer. **Échap** : annuler l'outil.
- Clique sur la **tente** pour lancer une expédition, puis sur la **couveuse** pour placer le monstre né.
- Un monstre malheureux s'évade : clique dessus pour l'attraper, ou embauche des gardiens.
- La partie est **sauvegardée automatiquement** dans le navigateur (toutes les 20 secondes et quand on quitte la page) et reprend à la réouverture. Le bouton **Nouvelle partie** (deux clics) efface la sauvegarde.

## Organisation du code

- `src/sim/` : toutes les règles du jeu (sans affichage), testées dans `tests/sim/`.
- `src/sim/save.js` : transforme une partie en données (et l'inverse) ; `src/save/storage.js` : l'enregistre dans le navigateur.
- `src/render/` : l'affichage (Phaser) et l'interface (HTML).
- `src/config/balance.js` : tous les chiffres à régler (prix, vitesses, probabilités).
- `src/i18n/fr.js` : tous les textes du jeu.
- `models/` : les modèles 3D animés (.glb, .gltf), transformés en images par `scripts/render-model/`.
  Les personnes ne sont pas dans le dépôt (trop lourdes) : pour refaire leurs images, télécharge le dossier glTF
  « Individual Characters » des packs [Ultimate Modular Men](https://quaternius.com/packs/ultimatemodularcharacters.html)
  et [Ultimate Modular Women](https://quaternius.com/packs/ultimatemodularwomen.html) dans `models/people/men/` et `models/people/women/`.

## Crédits

- Sols des enclos : textures photo de [ambientCG](https://ambientcg.com) (Lava003, Tiles093, Ground037, Snow013 — licence CC0).
- Visiteurs et gardiens : packs « Ultimate Modular Men / Women » de [Quaternius](https://quaternius.com) (licence CC0).
- `docs/` : document de conception et plan de construction.
