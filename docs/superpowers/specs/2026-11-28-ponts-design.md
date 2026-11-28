# Ponts au-dessus des enclos — design

## Pourquoi

Dans un grand parc, les enclos coupent les allées : les visiteurs doivent faire le tour. Le pont sert à deux choses :
1. **un raccourci** : traverser un grand enclos sans le contourner ;
2. **un point de vue spectaculaire** : regarder les monstres d'en haut, depuis le milieu de l'enclos.

## Objectifs

- Un outil **« Pont »** dans la barre d'outils, à côté de l'outil Allée.
- Le pont se trace **librement** (pas forcément en ligne droite) : on appuie, on glisse case par case, on relâche.
- Les deux bouts du pont doivent se raccorder à une **allée** (ou à de l'herbe, où une allée est posée automatiquement — voir « Pose »).
- Les visiteurs marchent dessus comme sur une allée, et peuvent **s'y arrêter pour regarder l'enclos**, avec un peu plus de satisfaction que derrière la vitre.
- Les monstres continuent de vivre **sous** le pont, même les plus grands.

## Hors sujet

- Pas de « deuxième étage » général de la grille, pas de ponts au-dessus d'autre chose que des enclos (bâtiments, stands, herbe).
- Pas de ponts qui se croisent ou se superposent.
- Pas de modèle 3D fait dans Blender pour l'instant : le pont est construit en géométrie dans la scène (comme les murs).

## Ce qui serait un échec

- Un pont posé sans le vouloir en traçant une allée normale.
- Un pont qui « traverse » un monstre, un abri ou une décoration de façon visible.
- Un pont dont un bout tombe dans le vide (pas raccordé) : les visiteurs y resteraient coincés.
- Une ancienne sauvegarde qui ne se charge plus.

## Approches envisagées

1. **L'allée se prolonge toute seule sur l'enclos** — rien à apprendre, mais ponts posés par accident et rendu 3D difficile à soigner. Écartée.
2. **Un outil « Pont » à part** — **choisie** par l'utilisateur, avec un tracé libre (virages autorisés) plutôt qu'une ligne droite.
3. **Un deuxième étage de grille pour tout le parc** — beaucoup de travail pour un seul usage. Écartée.

## Comment ça marche

### Données

- Une case garde son `ground` et son `occupant` (l'enclos dessous). On ajoute un indicateur **`bridge`** (vrai/faux) sur la case.
- Une case `bridge` appartient donc à l'enclos (pour les monstres) **et** au réseau de marche (pour les visiteurs et le personnel).
- Sauvegarde : chaque case devient `[ground, occupant, bridge?]` ; une ancienne sauvegarde (deux valeurs) se charge sans pont.

### Pose (outil Pont)

- On appuie sur une case, on glisse : chaque case traversée s'ajoute au tracé si elle touche (4 voisins) la précédente ; revenir en arrière sur la case précédente l'enlève (comme un serpent).
- À la case relâchée, le tracé est vérifié :
  - il passe au-dessus d'**au moins une** case d'enclos ;
  - ses deux bouts sont **hors enclos**, sur une allée ou de l'herbe libre ;
  - les cases hors enclos du tracé sont des allées ou de l'herbe libre (sur l'herbe, une allée est posée, au prix d'une allée) ;
  - aucune case d'enclos du tracé n'a d'**abri** ni n'est déjà un pont ; une **décoration** basse reste dessous, une décoration haute (arbre, lanterne…) empêche le pont (même règle de hauteur que pour l'enjambement des monstres) ;
  - assez d'argent pour le tout.
- Prix : `BALANCE.bridgeCostPerTile` par case au-dessus d'un enclos (proposition : 5 × le prix d'une allée), plus le prix d'allée pour les cases d'herbe.
- L'aperçu montre le tracé en vert s'il est valide, en rouge sinon, avec le prix total.

### Effets sur le reste du jeu

- **Trajets** (`pathfinding.js`) : une case `bridge` est marchable comme une allée, même si son `occupant` est un enclos.
- **Regarder un enclos** : les cases de pont d'un enclos comptent parmi les endroits d'où l'on peut le regarder (`accessTiles`), donc un enclos traversé par un pont est visitable même sans allée le long. Un visiteur qui regarde depuis un pont gagne un bonus de satisfaction (`BALANCE.bridgeViewBonus`, proposition : +25 %).
- **Monstres** : ils ignorent le pont et passent dessous. Les abris ne peuvent plus être posés sur une case de pont, ni les décorations hautes.
- **Murs** : là où le pont franchit le mur de l'enclos, le mur reste (le pont passe au-dessus) ; il n'est pas vitré.
- **Démolir** : l'outil Démolir sur une case de pont enlève **tout le pont** (toutes ses cases au-dessus de l'enclos), avec le remboursement habituel ; les allées des bouts restent. Démolir un enclos enlève d'abord les ponts qui le traversent (remboursés).
- **Fusion d'enclos** : les ponts restent tels quels.

### Rendu 3D

- Tablier en bois ou en pierre à une hauteur fixe au-dessus du sol, assez haute pour le plus grand monstre (à mesurer sur les modèles), avec rambardes des deux côtés et des piliers plantés dans l'enclos toutes les deux cases environ.
- Dans un virage, le tablier fait un coin plein, les rambardes suivent le bord extérieur et intérieur.
- Aux bouts, une petite rampe descend jusqu'à l'allée.
- Les visiteurs sur le pont sont affichés à la hauteur du tablier (et montent/descendent sur la rampe).
- Le rendu 2D (Phaser) reçoit un simple dessin de planches par-dessus l'enclos, pour que la vue 2D reste lisible.

## Laissé au constructeur

- La hauteur exacte du tablier (selon le plus grand monstre), l'aspect précis (bois ou pierre), l'espacement des piliers.
- Les prix et le bonus exacts, à ajuster en jouant.
- Les textes français de l'outil et des messages d'erreur (`fr.js`).
