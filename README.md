# Orrery — Simulateur de trajectoires d'astéroïdes

Application web 100% front-end (HTML/CSS/JS vanilla, aucune dépendance,
aucun build) simulant le système solaire et des trajectoires d'astéroïdes,
conçue mobile-first et installable en PWA.

## Fonctionnalités

- Positions du Soleil, des 8 planètes et de la Lune calculées à partir
  d'éléments orbitaux képlériens (époque J2000, précision de l'ordre de
  l'arcminute — voir panneau "À propos" dans l'app).
- Interface en onglets : une barre de bulles en bas (Temps / Astéroïdes /
  Fusée / Position) ouvre chacune son propre panneau non-modal — la
  carte reste toujours visible et utilisable, et un seul panneau est
  ouvert à la fois.
- Défilement du temps bidirectionnel : un curseur "flux du temps" à
  échelle **logarithmique** (le temps réel — 1 s simulée/s — est
  accessible juste après la pause, puis ça grimpe vite jusqu'à 300 j/s),
  un curseur de navigation temporelle (±10 ans), des boutons de saut
  ponctuel, et un bouton "Maintenant" — tous dans l'onglet "Temps".
- Rotation propre de chaque astre (période sidérale réelle) en plus de
  la révolution orbitale.
- Pan / zoom tactile (glisser, pincer) et souris (glisser, molette),
  ancrés sur le point sous les doigts/curseur, boutons +/- dédiés,
  raccourcis rapides vers chaque astre, et un tap direct sur un astre
  (ou un astéroïde) dans la carte pour le sélectionner, avec un bouton
  "Suivre" pour verrouiller la caméra dessus.
- Zoom progressif : au-delà d'un certain niveau de zoom sur un astre,
  l'échelle réelle prend le relais et une atmosphère + texture de
  surface stylisées apparaissent (utile pour "voir" la Terre de près).
- Repère de position au sol (📍) : choisissez une ville dans une liste,
  un trait part du centre de la Terre dans cette direction (via le temps
  sidéral de Greenwich), pour visualiser l'alignement des planètes vues
  depuis cet endroit ; il tourne avec la rotation réelle de la Terre et
  son déplacement orbital.
- Simulation d'astéroïdes : distance au Soleil, vitesse, angle de
  trajectoire, inclinaison, orientation du plan orbital, masse — ou en
  plaçant directement la position et la vitesse (glisser une flèche) sur
  la carte. Propagation par intégration numérique (Runge-Kutta 4) sous
  la gravité du Soleil + des 8 planètes, avec **pas de temps adaptatif
  par corps** : pour chaque astre, le pas se cale sur l'échelle de temps
  dynamique locale (racine de r³/GM à cet astre), et pas seulement sur la
  force totale dominée par le Soleil — ce qui permet de bien résoudre une
  approche rapprochée d'une planète même quand sa force reste faible
  devant celle du Soleil, sans trajectoires erratiques. L'échantillonnage
  se densifie aussi automatiquement pendant ces approches. La trajectoire
  est calculée à la fois vers l'avenir et vers le passé depuis l'instant
  courant.
- Panneau d'informations sur l'astre sélectionné (bouton ⓘ) : distance au
  Soleil, vitesse héliocentrique et cap, accélération totale subie,
  force totale (F=ma, quand une masse est connue), distances à tous les
  autres astres/objets suivis, avec une flèche de vitesse affichée sur
  la carte.
- Lancement de fusées depuis la Terre (🚀) : delta-v et angle de poussée
  (prograde/rétrograde/radial, comme dans un jeu de simulation orbitale),
  à l'instant courant de l'horloge — pour un mini-jeu d'interception
  d'astéroïdes. Même moteur physique, même système d'incertitudes.
- Aperçu en temps réel : pendant que vous ajustez les paramètres d'un
  astéroïde ou d'une fusée, une trajectoire rapide et approximative se
  dessine immédiatement sur la carte ; le calcul précis n'est fait qu'au
  clic sur "Calculer"/"Lancer".
- Avertissements de rencontre rapprochée : chaque trajectoire calculée
  (astéroïde ou fusée) est comparée au Soleil, aux planètes, à la Lune et
  à tous les autres objets suivis pour détecter les passages proches.
- Génération d'une "famille" de trajectoires en faisant varier tous les
  paramètres dans une marge réglable (±5% par défaut) pour visualiser
  la sensibilité / l'incertitude de la trajectoire.
- PWA installable, fonctionne hors-ligne après premier chargement, et se
  met à jour automatiquement au rechargement dès qu'une nouvelle version
  est en ligne (stratégie "réseau d'abord", pas besoin de vider le cache).
- Astéroïdes réels (Apophis, Bennu, Éros, Cérès, Vesta) modélisés comme
  des astres à part entière, avec leurs propres éléments orbitaux, propagés
  par intégration à N corps (pas par simple ellipse képlérienne figée) sur
  une fenêtre de ±20 ans autour d'aujourd'hui — ce qui permet de voir
  correctement un vrai survol rapproché, comme celui d'Apophis à ~32 000 km
  de la Terre le 13 avril 2029.
- Panneaux astéroïde/fusée : aperçu de trajectoire recalculé en direct
  à chaque changement de paramètre, sans jamais bloquer la carte.
- Placement d'un astéroïde sur la carte en deux gestes indépendants
  (un tap pour la position, un second tap ou un glisser pour la
  direction/vitesse) — fonctionne de façon fiable au tactile.
- Générateur de fusées avec plusieurs types pré-configurés (sonde
  légère, satellite standard, lanceur lourd, sonde rapide type New
  Horizons), une date de lancement réglable par curseur (bascule
  grossier ±10 ans / fin ±10 jours) sans jamais fermer le panneau, et
  des repères temporels synchronisés sur la carte montrant où se
  trouvent la fusée et l'astre le plus proche au même instant — pour
  viser une vraie interception plutôt qu'un simple croisement de
  trajectoires.
- Générateur de "gros-croiseur" : donnez une date d'impact, une vitesse
  et un angle d'approche, l'outil recherche numériquement (par
  itérations) les paramètres exacts qui font percuter la Terre à cette
  date précise, et ajoute l'astéroïde résultant à la simulation.
- Seuil d'interception configurable et lecture en direct de la
  rencontre la plus proche pendant le réglage d'une fusée.

## Limites connues (assumées, voir aussi le panneau "À propos")

- Éléments planétaires : précision "arcminute", valables env. 1800–2050,
  pas une éphéméride de précision (pas de VSOP87/DE440).
- Lune : éléments moyens simplifiés (période et précession correctes,
  précision absolue faible).
- La masse d'un astéroïde n'influence pas sa trajectoire (particule de
  masse négligeable, principe d'équivalence) — elle est affichée à
  titre informatif seulement.
- Une trajectoire s'arrête si elle entre en collision avec le Soleil
  (passage sous son rayon) ou si elle s'échappe au-delà de 250 UA.
- Une fusée est modélisée par simplification "conique raccordée" :
  elle démarre son trajet héliocentrique juste à la limite de la sphère
  de Hill terrestre (~0,01 UA) avec la vitesse de la Terre plus le
  delta-v choisi — la phase de décollage proprement dite n'est pas
  simulée, et sa trajectoire n'est calculée que vers l'avenir (pas de
  "passé" avant le lancement). Le site de lancement choisi est indicatif
  (narratif) et n'affecte pas la trajectoire à cette échelle.
- Le repère de position au sol ignore l'inclinaison de l'axe terrestre
  (23,4°) — c'est une projection sur le plan de l'écliptique, donc la
  direction est orientée et animée correctement mais approximative.
- Rendu 2D "vue de dessus" (plan de l'écliptique), pas de vue 3D.

## Lancer en local

Comme l'app utilise des modules ES (`type="module"`), il faut la servir
via HTTP (l'ouverture directe du fichier `index.html` via `file://` ne
fonctionnera pas dans tous les navigateurs). Par exemple :

```bash
cd asteroid-sim
python3 -m http.server 8000
# puis ouvrir http://localhost:8000
```

## Déployer sur GitHub Pages

1. Créez un dépôt GitHub et poussez le contenu de ce dossier à la racine
   (ou dans un sous-dossier, voir remarque ci-dessous) :

   ```bash
   git init
   git add .
   git commit -m "Orrery: simulateur de trajectoires d'astéroïdes"
   git branch -M main
   git remote add origin https://github.com/<votre-utilisateur>/<votre-repo>.git
   git push -u origin main
   ```

2. Sur GitHub : *Settings → Pages → Build and deployment → Source:
   Deploy from a branch*, choisissez la branche `main` et le dossier `/`
   (racine), puis enregistrez.

3. L'app sera disponible à `https://<votre-utilisateur>.github.io/<votre-repo>/`.

Tous les chemins (CSS, JS, manifest, icônes, service worker) sont
**relatifs**, donc l'app fonctionne aussi bien à la racine d'un domaine
que dans un sous-dossier de type `username.github.io/repo/` — aucune
modification n'est nécessaire.

### Installer en PWA

Une fois le site ouvert sur mobile (Chrome/Android ou Safari/iOS),
utilisez "Ajouter à l'écran d'accueil" (Safari) ou l'invite
d'installation / menu ⋮ → "Installer l'application" (Chrome). Le
service worker met en cache les fichiers de l'app pour un fonctionnement
hors-ligne après la première visite.

## Structure du projet

```
index.html            structure de la page et des panneaux (sheets)
css/style.css          thème HUD mobile-first
js/orbitalData.js       constantes physiques, éléments orbitaux, métadonnées des astres
js/kepler.js            résolution de l'équation de Kepler, positions héliocentriques
js/physics.js           construction d'état initial + intégrateur RK4 (astéroïdes)
js/render.js             caméra, rendu canvas, textures procédurales de surface
js/main.js               orchestration UI, entrées tactiles/souris, boucle d'animation
manifest.json            manifeste PWA
service-worker.js        cache app-shell pour le mode hors-ligne
icons/                   icônes de l'app
```
