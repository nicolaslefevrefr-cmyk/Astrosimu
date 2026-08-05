# Orrery — Simulateur de trajectoires d'astéroïdes

Application web 100% front-end (HTML/CSS/JS vanilla, aucune dépendance,
aucun build) simulant le système solaire et des trajectoires d'astéroïdes,
conçue mobile-first et installable en PWA.

## Fonctionnalités

- Positions du Soleil, des 8 planètes et de la Lune calculées à partir
  d'éléments orbitaux képlériens (époque J2000, précision de l'ordre de
  l'arcminute — voir panneau "À propos" dans l'app).
- Défilement du temps bidirectionnel : un seul curseur "flux du temps"
  (jours simulés par seconde réelle, positif ou négatif), un curseur de
  navigation temporelle (±10 ans autour de l'instant présent), et un
  bouton "Maintenant".
- Rotation propre de chaque astre (période sidérale réelle) en plus de
  la révolution orbitale.
- Pan / zoom tactile (glisser, pincer) et souris (glisser, molette),
  boutons +/- dédiés, raccourcis rapides vers chaque astre, et un
  bouton "Suivre" pour verrouiller la caméra sur un astre en mouvement.
- Zoom progressif : au-delà d'un certain niveau de zoom sur un astre,
  l'échelle réelle prend le relais et une atmosphère + texture de
  surface stylisées apparaissent (utile pour "voir" la Terre de près).
- Simulation d'astéroïdes : distance au Soleil, vitesse, angle de
  trajectoire, inclinaison, orientation du plan orbital, masse.
  Propagation par intégration numérique (Runge-Kutta 4) sous la
  gravité du Soleil + des 8 planètes — pas d'approximation analytique.
- Génération d'une "famille" de trajectoires en faisant varier tous les
  paramètres dans une marge réglable (±5% par défaut) pour visualiser
  la sensibilité / l'incertitude de la trajectoire.
- PWA installable, fonctionne hors-ligne après premier chargement.

## Limites connues (assumées, voir aussi le panneau "À propos")

- Éléments planétaires : précision "arcminute", valables env. 1800–2050,
  pas une éphéméride de précision (pas de VSOP87/DE440).
- Lune : éléments moyens simplifiés (période et précession correctes,
  précision absolue faible).
- La masse d'un astéroïde n'influence pas sa trajectoire (particule de
  masse négligeable, principe d'équivalence) — elle est affichée à
  titre informatif seulement.
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
