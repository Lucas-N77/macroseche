/* =============================================================================
   MacroSèche — foods.js
   Base d'aliments courants en France, utiles en sèche.

   - Valeurs pour 100 g (ou 100 ml pour les boissons et le lait).
   - Valeurs arrondies, cohérentes avec la table de composition nutritionnelle
     Ciqual de l'ANSES (https://ciqual.anses.fr). Elles varient selon les marques,
     les variétés et les recettes : pour un produit précis, le scan du code-barres
     (Open Food Facts) donne les valeurs exactes de l'étiquette.
   - « cru » / « cuit » est toujours indiqué quand ça change les valeurs :
     100 g de riz cru ≈ 250 g de riz cuit !

   Format de chaque ligne :
   [identifiant, nom, catégorie, kcal, protéines, glucides, lipides, fibres,
    portions, unité, mots-clés]
     - portions  : liste de [libellé, grammes] (facultatif)
     - unité     : 'g' (par défaut) ou 'ml'
     - mots-clés : synonymes pour la recherche (facultatif)

   ⚠️ Ne modifiez jamais un identifiant existant : il sert à retrouver
   vos aliments récents et favoris.
   ============================================================================= */
(function () {
  'use strict';

  /** Catégories affichées dans l'onglet « Aliments ». */
  const CATEGORIES = {
    viande: { label: 'Viandes & volailles', icon: '🍗' },
    poisson: { label: 'Poissons & fruits de mer', icon: '🐟' },
    laitier: { label: 'Œufs & produits laitiers', icon: '🥚' },
    complement: { label: 'Compléments protéinés', icon: '💪' },
    feculent: { label: 'Féculents & céréales', icon: '🍚' },
    legumineuse: { label: 'Légumineuses & soja', icon: '🫘' },
    legume: { label: 'Légumes', icon: '🥦' },
    fruit: { label: 'Fruits', icon: '🍎' },
    oleagineux: { label: 'Oléagineux & graines', icon: '🥜' },
    gras: { label: 'Matières grasses & sauces', icon: '🫒' },
    boisson: { label: 'Boissons', icon: '🥤' },
    divers: { label: 'Sucré, snacks & plats', icon: '🍫' },
    perso: { label: 'Mes aliments', icon: '⭐️' },
    off: { label: 'Produits scannés', icon: '🏷️' },
  };

  /* eslint-disable max-len */
  const ROWS = [
    // ---------------------------------------------------------------- Viandes & volailles
    ['poulet-filet-cru', 'Blanc de poulet (filet), cru', 'viande', 110, 23.5, 0, 1.8, 0, [['filet', 130]], 'g', 'escalope aiguillettes'],
    ['poulet-filet-cuit', 'Blanc de poulet (filet), cuit', 'viande', 153, 31, 0, 3.2, 0, [['filet cuit', 100]], 'g', 'escalope aiguillettes grille'],
    ['dinde-escalope-crue', 'Escalope de dinde, crue', 'viande', 105, 23.8, 0, 1.1, 0, [['escalope', 120]]],
    ['dinde-escalope-cuite', 'Escalope de dinde, cuite', 'viande', 139, 29.9, 0, 2.1, 0, [['escalope cuite', 90]]],
    ['poulet-cuisse-cuite', 'Cuisse de poulet sans peau, cuite', 'viande', 181, 26, 0, 8.5, 0, [['cuisse (viande)', 110]], 'g', 'pilon haut de cuisse'],
    ['poulet-roti-peau', 'Poulet rôti, viande et peau', 'viande', 208, 25, 0, 12, 0, [['part', 150]]],
    ['boeuf-hache-5-cru', 'Bœuf, steak haché 5 % MG, cru', 'viande', 125, 21, 0, 4.6, 0, [['steak haché', 100]], 'g', 'viande hachee'],
    ['boeuf-hache-5-cuit', 'Bœuf, steak haché 5 % MG, cuit', 'viande', 158, 26, 0, 6, 0, [['steak haché cuit', 80]], 'g', 'viande hachee'],
    ['boeuf-hache-15-cru', 'Bœuf, steak haché 15 % MG, cru', 'viande', 209, 18.5, 0, 15, 0, [['steak haché', 100]], 'g', 'viande hachee'],
    ['boeuf-hache-15-cuit', 'Bœuf, steak haché 15 % MG, cuit', 'viande', 228, 25.5, 0, 14, 0, [['steak haché cuit', 80]], 'g', 'viande hachee'],
    ['boeuf-rumsteck-cru', 'Bœuf, rumsteck (steak), cru', 'viande', 120, 21.6, 0, 3.7, 0, [['steak', 150]], 'g', 'pave'],
    ['boeuf-rumsteck-grille', 'Bœuf, rumsteck (steak), grillé', 'viande', 157, 28, 0, 5, 0, [['steak cuit', 120]], 'g', 'pave cuit'],
    ['boeuf-bavette-grillee', 'Bœuf, bavette, grillée', 'viande', 180, 27, 0, 8, 0, [['bavette cuite', 120]]],
    ['porc-filet-mignon-cru', 'Porc, filet mignon, cru', 'viande', 117, 21.5, 0, 3.4, 0, [['tranche', 100]]],
    ['porc-filet-mignon-cuit', 'Porc, filet mignon, cuit', 'viande', 161, 29, 0, 5, 0, [['tranche cuite', 80]]],
    ['porc-cote-grillee', 'Porc, côte, grillée', 'viande', 220, 28, 0, 12, 0, [['côte (sans os)', 120]]],
    ['veau-escalope-cuite', 'Veau, escalope, cuite', 'viande', 152, 30.5, 0, 3.3, 0, [['escalope cuite', 100]]],
    ['jambon-blanc-dd', 'Jambon blanc découenné dégraissé', 'viande', 110, 21, 1, 2.5, 0, [['tranche', 40]], 'g', 'jambon cuit'],
    ['blanc-volaille-tranches', 'Blanc de poulet ou de dinde (tranches)', 'viande', 104, 21, 1.5, 1.6, 0, [['tranche', 30]], 'g', 'charcuterie volaille'],
    ['viande-sechee', 'Viande séchée (bresaola, Grisons)', 'viande', 159, 33, 0.5, 2.8, 0, [['tranche', 10]]],

    // ---------------------------------------------------------------- Poissons & fruits de mer
    ['cabillaud-cru', 'Cabillaud, cru', 'poisson', 78, 18, 0, 0.7, 0, [['dos', 130]], 'g', 'poisson blanc'],
    ['cabillaud-cuit', 'Cabillaud, cuit', 'poisson', 98, 22.5, 0, 0.9, 0, [['dos cuit', 110]], 'g', 'poisson blanc'],
    ['lieu-cuit', 'Lieu noir ou colin, cuit', 'poisson', 93, 21, 0, 1, 0, [['filet cuit', 110]], 'g', 'poisson blanc merlu'],
    ['saumon-cru', 'Saumon, cru', 'poisson', 204, 20.4, 0, 13.6, 0, [['pavé', 125]]],
    ['saumon-cuit', 'Saumon, cuit', 'poisson', 226, 24.5, 0, 14.2, 0, [['pavé cuit', 110]]],
    ['saumon-fume', 'Saumon fumé', 'poisson', 181, 22.5, 0, 10.1, 0, [['tranche', 25]]],
    ['thon-naturel', 'Thon au naturel, égoutté (conserve)', 'poisson', 117, 26.6, 0, 1.2, 0, [['petite boîte égouttée', 104]], 'g', 'boite'],
    ['sardines-huile', "Sardines à l'huile, égouttées", 'poisson', 222, 24, 0, 14, 0, [['boîte égouttée', 87]], 'g', 'boite'],
    ['maquereau-cuit', 'Maquereau, cuit', 'poisson', 219, 21, 0, 15, 0, [['filet', 100]]],
    ['truite-cuite', 'Truite, cuite', 'poisson', 150, 23, 0, 6.5, 0, [['filet', 100]]],
    ['crevettes-cuites', 'Crevettes cuites, décortiquées', 'poisson', 93, 20.3, 0, 1.3, 0, [['portion', 100]], 'g', 'gambas'],
    ['moules-cuites', 'Moules, cuites (chair)', 'poisson', 127, 19, 3.7, 4, 0, [['portion (chair)', 150]]],
    ['surimi', 'Surimi (bâtonnets)', 'poisson', 106, 7.9, 14.3, 1.9, 0, [['bâtonnet', 16]]],
    ['poisson-pane-four', 'Poisson pané, cuit au four', 'poisson', 201, 13, 18, 8.3, 1, [['bâtonnet', 25], ['filet pané', 100]]],

    // ---------------------------------------------------------------- Œufs & produits laitiers
    ['oeuf', 'Œuf entier, cru', 'laitier', 140, 12.7, 0.3, 9.8, 0, [['œuf', 50]], 'g', 'oeufs omelette'],
    ['oeuf-dur', 'Œuf dur', 'laitier', 134, 13.5, 0.6, 8.6, 0, [['œuf', 50]], 'g', 'oeufs cuit coque'],
    ['blanc-oeuf', "Blanc d'œuf, cru", 'laitier', 45, 10.3, 0.5, 0.2, 0, [['blanc', 33]], 'g', 'blancs oeufs'],
    ['skyr', 'Skyr nature', 'laitier', 62, 11, 4, 0.2, 0, [['pot', 150]], 'g', 'yaourt islandais'],
    ['fromage-blanc-0', 'Fromage blanc 0 % nature', 'laitier', 46, 7.2, 4.1, 0.1, 0, [['pot individuel', 100], ['c. à soupe', 30]], 'g', 'faisselle'],
    ['fromage-blanc-3', 'Fromage blanc 3 % nature', 'laitier', 74, 7.3, 3.9, 3.2, 0, [['pot individuel', 100]]],
    ['yaourt-nature', 'Yaourt nature', 'laitier', 50, 4.3, 5, 1.4, 0, [['pot', 125]], 'g', 'yogourt'],
    ['yaourt-0', 'Yaourt nature 0 %', 'laitier', 41, 4.5, 5.5, 0.1, 0, [['pot', 125]], 'g', 'yogourt'],
    ['yaourt-grec-0', 'Yaourt grec 0 % (type grec filtré)', 'laitier', 55, 10.3, 3.2, 0.1, 0, [['pot', 150]], 'g', 'yogourt'],
    ['cottage', 'Cottage cheese', 'laitier', 98, 11.5, 3.3, 4.3, 0, [['c. à soupe', 30]]],
    ['lait-ecreme', 'Lait écrémé', 'laitier', 34, 3.4, 4.8, 0.1, 0, [['verre', 200], ['bol', 250]], 'ml'],
    ['lait-demi', 'Lait demi-écrémé', 'laitier', 46, 3.3, 4.8, 1.6, 0, [['verre', 200], ['bol', 250]], 'ml'],
    ['lait-entier', 'Lait entier', 'laitier', 64, 3.2, 4.7, 3.6, 0, [['verre', 200], ['bol', 250]], 'ml'],
    ['mozzarella', 'Mozzarella', 'laitier', 238, 18, 1, 18, 0, [['boule', 125]]],
    ['mozzarella-light', 'Mozzarella allégée', 'laitier', 160, 19.5, 1.5, 8.5, 0, [['boule', 125]]],
    ['emmental', 'Emmental (ou râpé)', 'laitier', 379, 28.6, 0, 29.4, 0, [['c. à soupe râpé', 10], ['portion', 30]], 'g', 'gruyere fromage rape'],
    ['comte', 'Comté', 'laitier', 412, 27.5, 0, 33.5, 0, [['portion', 30]], 'g', 'fromage'],
    ['parmesan', 'Parmesan', 'laitier', 389, 33, 0, 28.5, 0, [['c. à soupe râpé', 6]], 'g', 'fromage'],
    ['feta', 'Feta', 'laitier', 253, 15.5, 1, 20.8, 0, [['portion', 30]], 'g', 'fromage'],
    ['camembert', 'Camembert', 'laitier', 267, 20, 0.5, 20.5, 0, [['portion', 30]], 'g', 'fromage'],
    ['creme-15', 'Crème fraîche légère 15 %', 'laitier', 163, 2.7, 4.2, 15, 0, [['c. à soupe', 15]]],
    ['creme-30', 'Crème fraîche 30 %', 'laitier', 290, 2.3, 2.7, 30, 0, [['c. à soupe', 15]]],
    ['boisson-soja', 'Boisson au soja nature, non sucrée', 'laitier', 34, 3.4, 0.4, 2, 0.6, [['verre', 200]], 'ml', 'lait de soja'],
    ['boisson-amande', "Boisson à l'amande, non sucrée", 'laitier', 15, 0.5, 0.3, 1.2, 0.3, [['verre', 200]], 'ml', "lait d'amande"],

    // ---------------------------------------------------------------- Compléments protéinés
    ['whey', 'Whey protéine (concentrée)', 'complement', 385, 78, 6, 5.5, 0, [['dose', 30]], 'g', 'proteine poudre shaker'],
    ['whey-isolat', 'Whey isolat', 'complement', 369, 88, 2, 1, 0, [['dose', 30]], 'g', 'proteine poudre isolate shaker'],
    ['caseine', 'Caséine (poudre)', 'complement', 350, 80, 4, 1.5, 0, [['dose', 30]], 'g', 'proteine poudre'],
    ['barre-proteinee', 'Barre protéinée (moyenne)', 'complement', 351, 30, 35, 9, 5, [['barre', 60]], 'g', 'proteine'],

    // ---------------------------------------------------------------- Féculents & céréales
    ['riz-blanc-cru', 'Riz blanc, cru', 'feculent', 349, 7.4, 77.8, 0.7, 1.1, [['portion crue', 70]]],
    ['riz-blanc-cuit', 'Riz blanc, cuit', 'feculent', 145, 2.9, 32.2, 0.4, 0.6, [['portion cuite', 180]]],
    ['riz-basmati-cru', 'Riz basmati, cru', 'feculent', 355, 8.4, 77.7, 0.9, 1, [['portion crue', 70]]],
    ['riz-basmati-cuit', 'Riz basmati, cuit', 'feculent', 142, 3.3, 31, 0.4, 0.4, [['portion cuite', 180]]],
    ['riz-complet-cru', 'Riz complet, cru', 'feculent', 356, 7.5, 74, 2.5, 3.5, [['portion crue', 70]]],
    ['riz-complet-cuit', 'Riz complet, cuit', 'feculent', 137, 2.9, 28.5, 1, 1.4, [['portion cuite', 180]]],
    ['pates-crues', 'Pâtes, crues', 'feculent', 355, 12.5, 71.5, 1.5, 3, [['portion crue', 80]], 'g', 'spaghetti penne coquillettes macaroni'],
    ['pates-cuites', 'Pâtes, cuites', 'feculent', 150, 5.2, 30, 0.6, 1.8, [['assiette', 200]], 'g', 'spaghetti penne coquillettes macaroni'],
    ['pates-completes-crues', 'Pâtes complètes, crues', 'feculent', 347, 13, 64, 2.5, 8, [['portion crue', 80]], 'g', 'spaghetti penne'],
    ['pates-completes-cuites', 'Pâtes complètes, cuites', 'feculent', 141, 5.3, 26, 1, 3.5, [['assiette', 200]], 'g', 'spaghetti penne'],
    ['semoule-crue', 'Semoule de blé (couscous), crue', 'feculent', 360, 12, 73, 1.5, 3.5, [['portion crue', 70]]],
    ['semoule-cuite', 'Semoule de blé (couscous), cuite', 'feculent', 150, 5, 30.5, 0.6, 1.5, [['portion cuite', 160]]],
    ['quinoa-cru', 'Quinoa, cru', 'feculent', 377, 13.5, 63.5, 6.1, 7, [['portion crue', 60]]],
    ['quinoa-cuit', 'Quinoa, cuit', 'feculent', 125, 4.4, 21.3, 1.9, 2.8, [['portion cuite', 180]]],
    ['boulgour-cuit', 'Boulgour, cuit', 'feculent', 111, 3.5, 21.5, 0.5, 3.5, [['portion cuite', 180]], 'g', 'taboule'],
    ['pdt-crue', 'Pomme de terre, crue', 'feculent', 78, 2, 16.4, 0.1, 1.8, [['pomme de terre moyenne', 150]], 'g', 'patate'],
    ['pdt-cuite', "Pomme de terre, cuite à l'eau ou vapeur", 'feculent', 80, 1.9, 16.8, 0.1, 1.9, [['pomme de terre moyenne', 150]], 'g', 'patate'],
    ['puree-pdt', 'Purée de pommes de terre (au lait)', 'feculent', 90, 2, 13, 3, 1.4, [['portion', 200]], 'g', 'patate'],
    ['patate-douce-crue', 'Patate douce, crue', 'feculent', 82, 1.6, 17.1, 0.1, 3, [['patate douce moyenne', 200]]],
    ['patate-douce-cuite', 'Patate douce, cuite', 'feculent', 86, 2, 17.4, 0.2, 3.3, [['portion', 150]]],
    ['frites-four', 'Frites, cuites au four', 'feculent', 180, 3, 27, 6, 3, [['portion', 150]]],
    ['frites-friteuse', 'Frites, cuites en friteuse', 'feculent', 274, 3.5, 33, 13.5, 3, [['portion', 150]]],
    ['baguette', 'Pain blanc (baguette)', 'feculent', 266, 8.8, 53.5, 1.2, 2.9, [['1/4 de baguette', 60], ['morceau', 30]], 'g', 'pain'],
    ['pain-complet', 'Pain complet', 'feculent', 245, 9.5, 44, 2, 6.5, [['tranche', 35]]],
    ['pain-mie', 'Pain de mie', 'feculent', 266, 8, 48, 4, 3, [['tranche', 25]]],
    ['pain-mie-complet', 'Pain de mie complet', 'feculent', 250, 9.5, 42, 3.5, 6, [['tranche', 25]]],
    ['pain-burger', 'Pain à burger (bun)', 'feculent', 282, 9, 49, 5, 2.5, [['pain', 60]], 'g', 'hamburger'],
    ['wrap', 'Wrap / tortilla de blé', 'feculent', 308, 8.5, 50, 7.5, 3, [['wrap', 60]], 'g', 'tortilla galette'],
    ['biscotte', 'Biscotte', 'feculent', 407, 11, 73, 7, 4, [['biscotte', 9]]],
    ['galette-riz', 'Galette de riz soufflé', 'feculent', 385, 8, 80, 3, 3, [['galette', 8]]],
    ['pain-seigle-croustillant', 'Pain croustillant au seigle (type Wasa)', 'feculent', 326, 9, 60, 1.5, 18, [['tranche', 10]], 'g', 'cracker tartine'],
    ['flocons-avoine', "Flocons d'avoine", 'feculent', 371, 13.5, 58.5, 7, 10, [['portion', 40], ['c. à soupe', 10]], 'g', 'avoine porridge'],
    ['creme-riz', 'Crème de riz (poudre)', 'feculent', 359, 7, 80, 1, 1, [['portion', 40]]],
    ['muesli', 'Muesli sans sucres ajoutés', 'feculent', 360, 10, 60, 7, 8.5, [['bol', 45]], 'g', 'cereales'],
    ['granola', 'Granola', 'feculent', 450, 9, 60, 18, 6, [['bol', 45]], 'g', 'cereales'],
    ['corn-flakes', 'Corn flakes', 'feculent', 377, 7.5, 83, 1, 3, [['bol', 30]], 'g', 'cereales petales mais'],
    ['mais-doux', 'Maïs doux, en conserve, égoutté', 'feculent', 100, 3, 17.5, 1.4, 2.5, [['petite boîte égouttée', 140]]],

    // ---------------------------------------------------------------- Légumineuses & soja
    ['lentilles-crues', 'Lentilles vertes, crues', 'legumineuse', 323, 24, 46.5, 1.6, 13.5, [['portion crue', 60]]],
    ['lentilles-cuites', 'Lentilles, cuites', 'legumineuse', 121, 9, 16.3, 0.5, 7.9, [['portion cuite', 150]]],
    ['pois-chiches-cuits', 'Pois chiches, cuits ou en conserve égouttés', 'legumineuse', 145, 8.4, 18.5, 2.6, 7.2, [['portion', 150]]],
    ['haricots-rouges-cuits', 'Haricots rouges, cuits', 'legumineuse', 113, 8.5, 14, 0.6, 9, [['portion', 150]]],
    ['haricots-blancs-cuits', 'Haricots blancs, cuits', 'legumineuse', 111, 7.5, 14.5, 0.6, 9, [['portion', 150]]],
    ['edamame', 'Edamame (fèves de soja), cuits', 'legumineuse', 120, 11.9, 3.7, 5.2, 5.2, [['portion', 100]]],
    ['tofu', 'Tofu nature (ferme)', 'legumineuse', 132, 13.7, 1, 7.9, 1, [['portion', 100]], 'g', 'soja'],
    ['houmous', 'Houmous', 'legumineuse', 292, 7.5, 11, 23, 5.5, [['c. à soupe', 15]], 'g', 'hummus pois chiche'],

    // ---------------------------------------------------------------- Légumes
    ['brocoli-cuit', 'Brocoli, cuit', 'legume', 29, 2.5, 2.5, 0.4, 2.6, [['portion', 150]]],
    ['haricots-verts-cuits', 'Haricots verts, cuits', 'legume', 32, 1.9, 3.9, 0.2, 3.3, [['portion', 150]]],
    ['courgette-cuite', 'Courgette, cuite', 'legume', 19, 1, 2.3, 0.3, 1.3, [['portion', 150]]],
    ['epinards-cuits', 'Épinards, cuits', 'legume', 25, 3, 1, 0.5, 2.5, [['portion', 150]]],
    ['carotte-crue', 'Carotte, crue', 'legume', 37, 0.8, 6.6, 0.3, 2.6, [['carotte', 100]], 'g', 'carottes rapees'],
    ['carotte-cuite', 'Carotte, cuite', 'legume', 31, 0.6, 5.2, 0.3, 2.5, [['portion', 150]], 'g', 'carottes'],
    ['tomate', 'Tomate, crue', 'legume', 19, 0.8, 2.8, 0.3, 1.2, [['tomate moyenne', 120], ['tomate cerise', 15]]],
    ['concombre', 'Concombre, cru', 'legume', 13, 0.6, 2, 0.1, 0.7, [['1/2 concombre', 150]]],
    ['salade-verte', 'Salade verte (laitue, mâche…)', 'legume', 15, 1.2, 1.5, 0.2, 1.3, [['bol', 50]], 'g', 'laitue mache roquette'],
    ['poivron-cru', 'Poivron, cru', 'legume', 30, 0.9, 5, 0.3, 1.9, [['poivron', 150]]],
    ['champignons-cuits', 'Champignons de Paris, cuits', 'legume', 25, 2.6, 1.2, 0.5, 2.6, [['portion', 100]]],
    ['chou-fleur-cuit', 'Chou-fleur, cuit', 'legume', 24, 1.9, 2.3, 0.3, 2.4, [['portion', 150]]],
    ['poireau-cuit', 'Poireau, cuit', 'legume', 27, 1, 4, 0.3, 2.3, [['portion', 150]]],
    ['aubergine-cuite', 'Aubergine, cuite (sans matière grasse)', 'legume', 26, 1, 3.5, 0.3, 2.5, [['portion', 150]]],
    ['asperges-cuites', 'Asperges, cuites', 'legume', 25, 2.4, 2.5, 0.2, 2, [['portion', 120]]],
    ['petits-pois-cuits', 'Petits pois, cuits', 'legume', 78, 5.5, 10, 0.6, 5.5, [['portion', 150]]],
    ['butternut-cuite', 'Courge butternut, cuite', 'legume', 41, 1, 8, 0.1, 2, [['portion', 200]], 'g', 'potiron potimarron'],
    ['betterave-cuite', 'Betterave rouge, cuite', 'legume', 44, 1.6, 8, 0.1, 2.5, [['portion', 100]]],
    ['oignon-cru', 'Oignon, cru', 'legume', 40, 1.2, 7.5, 0.2, 1.7, [['oignon', 100]]],
    ['endive-crue', 'Endive, crue', 'legume', 19, 1, 2.2, 0.2, 2, [['endive', 100]]],
    ['ratatouille', 'Ratatouille cuisinée', 'legume', 55, 1.2, 5.5, 2.8, 1.8, [['portion', 200]]],
    ['poelee-legumes', 'Poêlée de légumes (surgelée), cuite', 'legume', 50, 1.8, 6, 1.5, 2.5, [['portion', 200]]],
    ['soupe-legumes', 'Soupe de légumes maison', 'legume', 30, 1, 4.5, 0.6, 1.2, [['bol', 250]], 'ml', 'veloute potage'],

    // ---------------------------------------------------------------- Fruits
    ['avocat', 'Avocat', 'fruit', 202, 1.6, 0.8, 20.6, 3.6, [['1/2 avocat', 70]]],
    ['pomme', 'Pomme', 'fruit', 53, 0.3, 11.6, 0.2, 2, [['pomme moyenne', 150]]],
    ['banane', 'Banane', 'fruit', 90, 1.1, 19.7, 0.3, 2, [['banane (sans peau)', 120]]],
    ['orange', 'Orange', 'fruit', 45, 0.9, 8.9, 0.2, 2, [['orange (pulpe)', 150]]],
    ['clementine', 'Clémentine', 'fruit', 46, 0.8, 9.5, 0.2, 1.7, [['clémentine', 60]], 'g', 'mandarine'],
    ['kiwi', 'Kiwi', 'fruit', 58, 1.1, 10.5, 0.6, 3, [['kiwi', 75]]],
    ['fraises', 'Fraises', 'fruit', 35, 0.7, 6.4, 0.3, 2, [['barquette', 250]]],
    ['framboises', 'Framboises', 'fruit', 48, 1.2, 6.4, 0.5, 6.7, [['barquette', 125]]],
    ['myrtilles', 'Myrtilles', 'fruit', 54, 0.7, 11, 0.3, 2.4, [['barquette', 125]]],
    ['fruits-rouges-surgeles', 'Fruits rouges (mélange surgelé)', 'fruit', 44, 1, 7, 0.4, 4, [['portion', 100]]],
    ['poire', 'Poire', 'fruit', 55, 0.4, 11.5, 0.2, 3, [['poire moyenne', 150]]],
    ['raisin', 'Raisin', 'fruit', 70, 0.6, 16, 0.2, 0.9, [['grappe', 125]]],
    ['ananas', 'Ananas', 'fruit', 54, 0.5, 11.9, 0.2, 1.4, [['tranche', 80]]],
    ['mangue', 'Mangue', 'fruit', 65, 0.6, 14, 0.3, 1.7, [['1/2 mangue', 150]]],
    ['melon', 'Melon', 'fruit', 35, 0.8, 7, 0.2, 0.9, [['1/2 melon', 250]]],
    ['pasteque', 'Pastèque', 'fruit', 33, 0.6, 7, 0.2, 0.3, [['tranche', 300]]],
    ['peche', 'Pêche ou nectarine', 'fruit', 42, 0.8, 8.5, 0.2, 1.6, [['fruit', 150]], 'g', 'brugnon'],
    ['abricot', 'Abricot', 'fruit', 44, 0.8, 9, 0.1, 2, [['abricot', 45]]],
    ['cerises', 'Cerises', 'fruit', 58, 1, 12, 0.3, 1.5, [['poignée', 100]]],
    ['pamplemousse', 'Pamplemousse', 'fruit', 37, 0.7, 7.5, 0.1, 1.4, [['1/2 pamplemousse', 150]]],
    ['compote-ssa', 'Compote sans sucres ajoutés', 'fruit', 55, 0.3, 12.5, 0.1, 1.5, [['pot ou gourde', 100]], 'g', 'pomme'],
    ['dattes', 'Dattes sèches', 'fruit', 300, 2.5, 68, 0.4, 7.5, [['datte', 8]]],

    // ---------------------------------------------------------------- Oléagineux & graines
    ['amandes', 'Amandes', 'oleagineux', 621, 21.4, 8.8, 53.4, 9.9, [['poignée', 25]]],
    ['noix', 'Noix (cerneaux)', 'oleagineux', 689, 15.2, 7, 65.2, 6.7, [['poignée', 20]]],
    ['noisettes', 'Noisettes', 'oleagineux', 656, 14.9, 7, 61, 9.7, [['poignée', 25]]],
    ['cajou', 'Noix de cajou', 'oleagineux', 605, 18.2, 26.9, 46.4, 3.3, [['poignée', 25]]],
    ['cacahuetes', 'Cacahuètes grillées', 'oleagineux', 612, 25.8, 13, 49, 8, [['poignée', 25]], 'g', 'arachides'],
    ['beurre-cacahuete', 'Beurre de cacahuète 100 %', 'oleagineux', 614, 25, 13, 50, 6, [['c. à soupe', 15], ['c. à café', 5]], 'g', 'peanut butter arachide'],
    ['chia', 'Graines de chia', 'oleagineux', 442, 16.5, 7.7, 30.7, 34.4, [['c. à soupe', 12]]],

    // ---------------------------------------------------------------- Matières grasses & sauces
    ['huile-olive', "Huile d'olive", 'gras', 900, 0, 0, 100, 0, [['c. à soupe', 10], ['c. à café', 4]]],
    ['huile-colza', 'Huile de colza', 'gras', 900, 0, 0, 100, 0, [['c. à soupe', 10], ['c. à café', 4]]],
    ['beurre', 'Beurre doux', 'gras', 744, 0.7, 0.7, 82, 0, [['noisette', 5], ['portion individuelle', 10]]],
    ['mayonnaise', 'Mayonnaise', 'gras', 696, 1.5, 1.5, 76, 0, [['c. à soupe', 15]]],
    ['vinaigrette', 'Vinaigrette classique', 'gras', 450, 0.2, 2, 49, 0, [['c. à soupe', 15]], 'g', 'sauce salade'],
    ['ketchup', 'Ketchup', 'gras', 106, 1.2, 25, 0.1, 0.3, [['c. à soupe', 15]]],
    ['moutarde', 'Moutarde', 'gras', 147, 7, 3.5, 11, 3, [['c. à café', 5]]],
    ['sauce-soja', 'Sauce soja', 'gras', 55, 8.1, 5.5, 0.1, 0, [['c. à soupe', 15]], 'ml'],
    ['sauce-tomate', 'Sauce tomate nature (coulis)', 'gras', 34, 1.5, 5.5, 0.3, 1.5, [['portion', 100]]],

    // ---------------------------------------------------------------- Boissons
    ['cafe', 'Café noir, sans sucre', 'boisson', 2, 0.1, 0.3, 0, 0, [['tasse', 150], ['expresso', 40]], 'ml', 'expresso the tisane'],
    ['jus-orange', "Jus d'orange (100 % pur jus)", 'boisson', 43, 0.7, 9.8, 0.1, 0.2, [['verre', 200]], 'ml'],
    ['soda-cola', 'Soda au cola', 'boisson', 42, 0, 10.6, 0, 0, [['canette', 330]], 'ml', 'coca'],
    ['soda-zero', 'Soda zéro ou light', 'boisson', 1, 0, 0, 0, 0, [['canette', 330]], 'ml', 'coca zero light'],
    // Bière et vin : l'alcool (7 kcal/g) est compté dans les kcal mais n'est ni une protéine, ni un glucide, ni un lipide.
    ['biere', 'Bière blonde (5 % vol.)', 'boisson', 42, 0.4, 3.2, 0, 0, [['demi', 250], ['canette', 330]], 'ml', 'alcool'],
    ['vin-rouge', 'Vin rouge (12,5 % vol.)', 'boisson', 80, 0.1, 0.3, 0, 0, [['verre', 125]], 'ml', 'alcool vin'],

    // ---------------------------------------------------------------- Sucré, snacks & plats
    ['sucre', 'Sucre blanc', 'divers', 400, 0, 100, 0, 0, [['morceau ou c. à café', 5]]],
    ['miel', 'Miel', 'divers', 326, 0.4, 81, 0, 0, [['c. à café', 7]]],
    ['confiture', 'Confiture', 'divers', 248, 0.4, 61, 0, 1, [['c. à café', 10]]],
    ['chocolat-noir', 'Chocolat noir 70 %', 'divers', 577, 9.5, 33.5, 42.5, 11, [['carré', 5]]],
    ['chocolat-lait', 'Chocolat au lait', 'divers', 543, 7, 56, 32, 1.5, [['carré', 5]]],
    ['pate-tartiner', 'Pâte à tartiner noisettes-cacao', 'divers', 537, 6, 57, 31, 3, [['c. à soupe', 15]]],
    ['croissant', 'Croissant', 'divers', 415, 8, 45, 22, 2.5, [['croissant', 50]], 'g', 'viennoiserie'],
    ['pain-chocolat', 'Pain au chocolat', 'divers', 418, 7.5, 45, 22.5, 2.8, [['pain au chocolat', 60]], 'g', 'chocolatine viennoiserie'],
    ['petit-beurre', 'Biscuit petit-beurre', 'divers', 435, 7.5, 73, 12, 2.5, [['biscuit', 8]], 'g', 'gateau sec'],
    ['barre-cereales', 'Barre de céréales', 'divers', 397, 6, 66, 11, 5, [['barre', 21]]],
    ['chips', 'Chips', 'divers', 539, 6, 50, 34, 4.5, [['petit paquet', 30]]],
    ['pizza', 'Pizza margherita', 'divers', 236, 10, 30, 8, 2, [['part', 100], ['pizza entière', 400]]],
    ['sandwich-jambon-beurre', 'Sandwich jambon-beurre (baguette)', 'divers', 261, 11.2, 35.8, 7.7, 1.9, [['sandwich', 200]]],
  ];
  /* eslint-enable max-len */

  /** Transforme chaque ligne en objet lisible par l'application. */
  const foods = ROWS.map((r) => ({
    id: r[0],
    name: r[1],
    cat: r[2],
    per100: { kcal: r[3], prot: r[4], gluc: r[5], lip: r[6], fib: r[7] },
    portions: (r[8] || []).map(([label, grams]) => ({ label, grams })),
    unit: r[9] || 'g',
    keywords: r[10] || '',
  }));

  window.FOOD_DB = { categories: CATEGORIES, foods };
})();
