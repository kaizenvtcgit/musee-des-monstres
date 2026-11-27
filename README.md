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
| `node scripts/render-model/render.mjs dragonnet` | Refait les images animées d'un monstre à partir de son modèle 3D (`models/dragonnet.glb`). Il faut d'abord `npm install --no-save playwright` puis `npx playwright install chromium` |
| `node scripts/render-model/render-fence.mjs` | Refait les images des barrières des enclos (muret de pierre et barreaux de fer, dessinés dans `scripts/render-model/fence.html`) |

## Comment jouer

- **Clic gauche** : utiliser l'outil choisi (glisser pour tracer une allée ou un enclos).
- **Clic droit, ou glisser avec l'outil Sélection** : déplacer la vue. **Molette** : zoomer. **Échap** : annuler l'outil.
- Clique sur la **tente** pour lancer une expédition, puis sur la **couveuse** pour placer le monstre né.
- Un monstre malheureux s'évade : clique dessus pour l'attraper, ou embauche des gardiens.

## Organisation du code

- `src/sim/` : toutes les règles du jeu (sans affichage), testées dans `tests/sim/`.
- `src/render/` : l'affichage (Phaser) et l'interface (HTML).
- `src/config/balance.js` : tous les chiffres à régler (prix, vitesses, probabilités).
- `src/i18n/fr.js` : tous les textes du jeu.
- `models/` : les modèles 3D animés des monstres (.glb), transformés en images par `scripts/render-model/`.
- `docs/` : document de conception et plan de construction.
