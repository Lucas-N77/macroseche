# MacroSèche 🔥

Application web (PWA) pour suivre tes **calories et tes macros repas par repas** pendant ta sèche.
Elle s'installe sur l'iPhone comme une vraie app, fonctionne **hors ligne**, **sans compte**, **sans serveur** :
tes données restent uniquement sur ton téléphone.

> Les calculs sont des estimations et ne remplacent pas un avis médical.

**👉 Lien de l'app : https://lucas-n77.github.io/macroseche/**
(ouvre-le dans Safari sur ton iPhone, puis Partager › « Sur l'écran d'accueil »)

---

## Ce que fait l'app

- **Objectifs calculés** : métabolisme de base (Mifflin-St Jeor, ou Katch-McArdle si tu connais ta masse grasse), dépense totale, déficit selon ton rythme (0,5 / 0,75 / 1 % par semaine, plafonné à 25 % de ta dépense), protéines, lipides, glucides, fibres, eau. Détail de chaque calcul et modification manuelle possible.
- **Journal du jour** : repas modifiables, calories restantes, barres protéines / glucides / lipides / fibres, eau, pas, pesée, jour d'entraînement, répartition des protéines.
- **Ajout d'aliments** : 187 aliments courants (valeurs d'après la table Ciqual), récents (ajout en 2 touches), favoris, repas types, aliments perso, ajout rapide, **scan de code-barres** et recherche **Open Food Facts**.
- **Photo IA (facultatif)** : prends ton assiette en photo, l'IA Claude estime les aliments, les quantités, les calories, les macros, les sucres et le sel, et te dit ce qu'il te restera dans la journée. Tu corriges avant d'ajouter. Nécessite ta propre clé API Anthropic (payant à l'usage, voir plus bas).
- **Progrès** : moyenne 7 jours, perte par semaine, date estimée, graphiques poids / calories / protéines (7, 30, 90 jours), bilan de la semaine, mensurations.
- **Coach adaptatif** : après 14 jours, estimation de ta vraie dépense, proposition d'objectif (jamais appliquée sans ton accord), détection de plateau et solutions (−150 kcal, plus de pas, pause diète).
- **Sauvegarde** : export JSON via le menu Partager, import, export CSV, rappel hebdomadaire.

## Les fichiers

| Fichier | Rôle |
|---|---|
| `index.html` | La page de l'app |
| `style.css` | L'apparence (thème clair / sombre) |
| `app.js` | Toute la logique de l'app |
| `foods.js` | La base d'aliments |
| `manifest.json` | Nom, icônes et mode plein écran de l'app installée |
| `sw.js` | Le « service worker » : fonctionnement hors ligne et mises à jour |
| `icons/` | Les 4 icônes PNG (180, 192, 512 px et 512 px « maskable ») |
| `README.md` | Ce guide (facultatif sur GitHub) |

---

## Mettre l'app en ligne avec GitHub Pages (gratuit)

### 1. Créer un compte GitHub

1. Va sur **https://github.com** et touche **Sign up**.
2. Saisis ton e-mail, un mot de passe et un **nom d'utilisateur** (ton « pseudo » : il apparaîtra dans le lien de l'app).
3. Valide l'e-mail de confirmation.

### 2. Créer un dépôt PUBLIC

1. Une fois connecté, touche le **+** en haut à droite › **New repository**.
2. **Repository name** : `macroseche` (en minuscules, sans espace ni accent).
3. Choisis **Public** (obligatoire pour GitHub Pages en gratuit).
   👉 Seul le **code** est public. **Tes données** (journal, poids…) restent sur ton iPhone et ne sont jamais envoyées sur GitHub.
4. Ne coche rien d'autre et touche **Create repository**.

### 3a. Déposer les fichiers depuis un ordinateur

1. Sur la page du dépôt, clique sur le lien **uploading an existing file** (ou **Add file › Upload files**).
2. Ouvre le dossier de l'app dans le Finder et **glisse-dépose** dans la page : `index.html`, `style.css`, `app.js`, `foods.js`, `manifest.json`, `sw.js`, `README.md` **et le dossier `icons`** entier.
3. Vérifie que la liste montre bien `icons/icon-180.png`, etc.
4. En bas, clique sur **Commit changes**.

### 3b. Déposer les fichiers depuis un iPhone seul

1. Mets les fichiers sur l'iPhone (par exemple AirDrop depuis le Mac vers l'app **Fichiers**, ou un dossier iCloud Drive).
2. Ouvre **github.com** dans **Safari** et connecte-toi. Si les boutons manquent, touche **aA** dans la barre d'adresse › **Demander le site pour ordinateur**.
3. Dans ton dépôt : **Add file › Upload files › choose your files** › sélectionne les 7 fichiers de la racine (`index.html`, `style.css`, `app.js`, `foods.js`, `manifest.json`, `sw.js`, `README.md`) › **Commit changes**.
4. Pour le dossier des icônes (Safari ne sait pas envoyer un dossier) :
   - **Add file › Create new file**, tape comme nom `icons/LISEZMOI.txt`, écris n'importe quel texte, puis **Commit changes** : le dossier `icons` est créé ;
   - ouvre le dossier **icons** dans le dépôt › **Add file › Upload files** › sélectionne les 4 fichiers PNG › **Commit changes**.

### 4. Activer GitHub Pages

1. Dans le dépôt : **Settings** (roue dentée) › menu de gauche **Pages**.
2. **Source** : **Deploy from a branch**.
3. **Branch** : `main` et dossier **`/ (root)`**, puis **Save**.
4. Attends 1 à 2 minutes et recharge la page : le lien apparaît en haut, du type
   **https://TON-PSEUDO.github.io/macroseche/**

### 5. Installer l'app sur l'iPhone

1. Ouvre ce lien dans **Safari** (pas dans une autre app).
2. Touche le bouton **Partager** (carré avec une flèche vers le haut). Sur iOS 26, il se trouve dans le menu **•••**.
3. Choisis **« Sur l'écran d'accueil »** (fais défiler si besoin). Si l'option **« Ouvrir comme app web »** apparaît, laisse-la activée.
4. Touche **Ajouter** : l'icône flamme **MacroSèche** apparaît sur l'écran d'accueil.
5. Ouvre l'app **depuis cette icône**, puis remplis ton profil.

> ⚠️ **Important** : l'app installée et Safari ne partagent pas leurs données. Installe l'app **avant** de commencer à saisir.
> Si tu supprimes l'icône, ses données sont effacées : exporte une sauvegarde régulièrement (Réglages › Sauvegarde).

### 6. Mettre l'app à jour plus tard

1. Modifie le fichier concerné sur GitHub (ouvre-le puis touche le **crayon ✏️**), ou dépose la nouvelle version avec **Add file › Upload files** (elle remplace l'ancienne).
2. **Toujours** : ouvre `sw.js`, et incrémente la ligne
   `const CACHE_VERSION = 'v1';` → `'v2'` (puis `'v3'` la fois suivante, etc.), puis **Commit changes**.
3. Attends 1 à 2 minutes (le temps que GitHub Pages republie).
4. Ouvre l'app sur l'iPhone : la bannière **« Nouvelle version disponible – Recharger »** apparaît. Touche **Recharger**.
   Si rien n'apparaît : ferme complètement l'app (glisse-la vers le haut dans le sélecteur d'apps) et rouvre-la.

> Ne modifie jamais les identifiants des aliments dans `foods.js` (le premier texte de chaque ligne) : ils servent à retrouver tes récents et favoris.

---

## Analyse photo par IA (facultatif)

L'app peut estimer un repas à partir d'une photo grâce à **Claude**, l'IA d'Anthropic. C'est facultatif : sans clé, tout le reste fonctionne normalement.

### Activer la fonction

1. Va sur **https://platform.claude.com** et crée un compte (le site des développeurs d'Anthropic).
2. Dans **Billing**, ajoute des crédits (par exemple 5 $).
3. Dans **API Keys**, touche **Create Key** et copie la clé (elle commence par `sk-ant-`).
4. Conseil : dans **Limits**, fixe une limite de dépense mensuelle.
5. Dans l'app : **Réglages › Analyse photo par IA**, colle la clé, choisis le modèle, puis **Vérifier et enregistrer** (la vérification est gratuite).

### Utilisation

**＋ › Photo IA** › prends la photo (vue de dessus, assiette entière) › ajoute si tu veux des précisions (« 200 g de riz cuit », « cuit avec 1 c. à soupe d'huile ») › **Analyser**.
L'IA affiche le plat, chaque aliment avec sa quantité estimée, le total (kcal, protéines, glucides, lipides, fibres, sucres, sel), la part de protéines, ce qu'il te restera dans la journée et un conseil pour la sèche. **Corrige les quantités**, décoche ce qui est faux, puis **Ajouter**.

### Coût (facturé par Anthropic sur ta clé)

| Réglage | Modèle | Coût estimé par photo | 5 $ de crédits ≈ |
|---|---|---|---|
| Précision maximale (par défaut) | Claude Opus 5.5 | ≈ 0,04 $ | 120 photos |
| Équilibré | Claude Sonnet 5.5 | ≈ 0,02 $ | 250 photos |
| Économique | Claude Haiku 5.5 | ≈ 0,001 $ | plusieurs milliers |

Le coût réel de chaque analyse s'affiche sous le résultat. Tarifs Anthropic d'octobre 2026 : ils peuvent évoluer.

### Confidentialité et limites

- La clé est enregistrée **uniquement sur ton téléphone** : elle n'est ni dans le code publié sur GitHub, ni dans tes sauvegardes. Si tu perds ton téléphone, supprime-la sur platform.claude.com.
- Pour chaque analyse, la photo (réduite), tes précisions et tes objectifs restants du jour sont envoyés à Anthropic.
- C'est une **estimation** : l'IA reconnaît bien les aliments, mais les quantités, l'huile et les sauces restent approximatives. En sèche, pèse tes aliments quand c'est possible et utilise la photo pour les repas à l'extérieur.

---

## Checklist de tests sur l'iPhone

**Installation et affichage**
- [ ] Le lien s'ouvre dans Safari et affiche l'écran de démarrage, avec la bannière « Installe MacroSèche ».
- [ ] Après « Sur l'écran d'accueil », l'icône flamme et le nom « MacroSèche » s'affichent correctement.
- [ ] L'app s'ouvre en plein écran, sans barre Safari ; l'heure et la batterie restent lisibles (thème clair et sombre).
- [ ] Rien n'est caché par l'encoche / la Dynamic Island ; la barre d'onglets est au-dessus de la barre d'accueil.
- [ ] Le thème suit le réglage clair / sombre de l'iPhone ; « Clair » et « Sombre » forcés fonctionnent (Réglages).

**Saisie**
- [ ] Les champs numériques ouvrent le clavier avec la virgule ; « 82,5 » est accepté ; la page ne zoome pas.
- [ ] Profil rempli → objectifs cohérents ; « Voir le détail des calculs » affiche chaque étape.
- [ ] Recherche « creme » → trouve « Crème fraîche » ; « riz cuit » ne propose que du riz **cuit**.
- [ ] Quantité en grammes et en portions (1 œuf = 50 g, tranche de pain, dose de whey).
- [ ] Ajout d'un aliment récent : ＋ › aliment › Ajouter (3 touches), ou ＋ › bouton ＋ du récent (2 touches).
- [ ] Modifier / supprimer une entrée ; « Annuler » dans la notification restaure l'aliment.
- [ ] Le lendemain : « Copier toute la journée d'hier » et « Copier le même repas de la veille ».
- [ ] Eau +250 / +500 ml, pas, pesée, interrupteur « Jour d'entraînement ».
- [ ] Un repas saisi après 23 h reste bien sur la journée en cours (et pas sur le lendemain).

**Code-barres et Open Food Facts**
- [ ] « Scanner » demande l'accès à la caméra (il peut être redemandé à chaque ouverture de l'app : c'est le fonctionnement normal d'iOS pour les web apps).
- [ ] Un produit du commerce est reconnu (ex. pot de skyr, boîte de thon) et ses valeurs s'affichent.
- [ ] Un code inconnu propose « Créer l'aliment » avec le code prérempli ; au scan suivant il est reconnu directement.
- [ ] Saisie manuelle du code (13 chiffres) quand la caméra n'y arrive pas.
- [ ] Recherche « skyr » sur Open Food Facts ; si le serveur est occupé, un message clair et un bouton « Réessayer » s'affichent.

**Hors ligne et sauvegarde**
- [ ] En mode avion, l'app s'ouvre et le journal fonctionne ; les produits déjà scannés restent disponibles.
- [ ] Export JSON → menu Partager → « Enregistrer dans Fichiers » ; la date de dernière sauvegarde se met à jour.
- [ ] Import de ce fichier (Réglages › Importer) → les données reviennent après confirmation.
- [ ] Export CSV → le fichier s'ouvre dans Numbers (colonnes séparées, virgules décimales).

**Photo IA (si tu as configuré une clé)**
- [ ] Réglages › Analyse photo par IA : la clé est vérifiée et enregistrée ; une clé fausse affiche « Clé API invalide ».
- [ ] ＋ › Photo IA › « Photo » ouvre l'appareil photo ; « Photothèque » ouvre tes photos.
- [ ] L'analyse affiche le plat, les aliments, les quantités et le total en 10 à 40 secondes ; « Annuler l'analyse » fonctionne.
- [ ] Modifier une quantité ou décocher un aliment met le total à jour ; « Ajouter » les place dans le bon repas.
- [ ] En mode avion, un message clair indique qu'une connexion est nécessaire.

**Progrès et coach**
- [ ] Pesées sur plusieurs jours → moyenne 7 jours, graphique du poids ; toucher un graphique affiche les valeurs du jour.
- [ ] Graphiques 7 / 30 / 90 jours ; « Voir les valeurs » affiche le tableau.
- [ ] Après 14 jours de journal et de pesées : le coach affiche ta dépense réelle et propose un objectif (bouton « Appliquer »).

**Mise à jour**
- [ ] Après avoir incrémenté `CACHE_VERSION`, la bannière « Nouvelle version disponible – Recharger » apparaît et la mise à jour conserve les données.

---

## Choix et hypothèses

- **Nom** : « MacroSèche » (10 caractères, s'affiche en entier sous l'icône).
- **Valeurs nutritionnelles** : moyennes arrondies d'après la table Ciqual de l'ANSES ; elles varient selon les marques. Pour un produit précis, scanne son code-barres.
- **Surpoids important** : IMC ≥ 30, ou masse grasse ≥ 25 % (homme) / ≥ 32 % (femme). Dans ce cas, protéines **et** lipides sont calculés sur le poids objectif.
- **Poids des calculs** : celui du profil. Quand ta moyenne 7 jours s'en écarte de 2 kg, l'onglet Progrès propose de recalculer.
- **Cyclage des glucides** : écart de 10, 20 ou 30 % entre jour d'entraînement et jour de repos, même moyenne sur la semaine, au moins 50 g de glucides les jours de repos.
- **Objectif protéines « atteint »** : au moins 90 % de l'objectif du jour.
- **Plateau** : la moyenne 7 jours n'a pas baissé d'au moins 0,25 % du poids en 14 jours, avec au moins 10 jours de journal sur 14.
- **Coach** : fenêtre de 14 à 28 jours, au moins 10 jours renseignés et 3 pesées au début et à la fin de la période.
- **Barre d'état** : style « default » (texte lisible en clair comme en sombre ; « black-translucent » rendrait l'heure illisible sur fond clair).
- **Non utilisés**, car indisponibles ou peu fiables dans une web app iPhone : notifications programmées, vibrations, Apple Santé.
- **Scanner** : `BarcodeDetector` si Safari le propose, sinon la librairie [barcode-detector](https://github.com/Sec-ant/barcode-detector) (version figée, vérifiée par empreinte d'intégrité) chargée depuis jsDelivr à la première ouverture du scanner, puis gardée en cache.
- **Open Food Facts** est un service gratuit et collaboratif : il peut être lent ou momentanément indisponible, et certaines fiches sont incomplètes.
- **Photo IA** : modèle par défaut Claude Opus 5.5 (le plus précis), modifiable dans les Réglages. Réponse au format structuré (JSON imposé), réflexion adaptative en effort moyen. En cas de refus par les filtres de sécurité, l'API relance automatiquement sur un autre modèle (option « fallbacks » d'Anthropic, Opus et Sonnet). Le kit officiel d'Anthropic (`@anthropic-ai/sdk` 1.3.0) est chargé depuis jsDelivr à la première analyse. La photo est réduite à 1 280 px avant l'envoi.

## Données et confidentialité

- Tout est enregistré dans le stockage local de l'app sur ton iPhone (rien sur un serveur, pas de compte).
- Seules sorties réseau : les requêtes Open Food Facts (code-barres / nom de produit cherché), le téléchargement unique du lecteur de codes-barres et, seulement si tu actives la Photo IA, l'envoi de la photo analysée à Anthropic.

## Crédits

- Valeurs nutritionnelles : table de composition Ciqual (ANSES).
- Produits du commerce : [Open Food Facts](https://world.openfoodfacts.org) (licence ODbL).
