/* =============================================================================
   MacroSèche — app.js
   Suivi des calories et des macros repas par repas, pensé pour la sèche.

   - JavaScript « vanilla » : aucune dépendance, aucune étape de build.
   - Toutes les données restent sur le téléphone (localStorage). Aucun compte.
   - Organisation du fichier :
       1. Constantes et outils            6. Ajout d'aliments (feuilles)
       2. Données : stockage, migration   7. Open Food Facts et code-barres
       3. Base d'aliments                 8. Onglet Progrès (graphiques, coach)
       4. Calculs nutritionnels           9. Onglets Aliments et Réglages
       5. Interface et onglet Journal    10. Sauvegarde, service worker, démarrage
   ============================================================================= */
(function () {
  'use strict';

  /* ===========================================================================
     1. CONSTANTES ET OUTILS
     ========================================================================= */

  const STORAGE_KEY = 'macroseche:data';
  const SCHEMA_VERSION = 1;            // à incrémenter si la structure des données change
  const KCAL_PER_KG = 7700;            // ≈ énergie contenue dans 1 kg de graisse corporelle
  const BACKUP_REMINDER_DAYS = 7;      // rappel de sauvegarde au-delà de 7 jours
  const OFF_CACHE_MAX = 400;           // nombre max de produits Open Food Facts gardés en local

  // Lecteur de codes-barres de secours (si le navigateur n'a pas BarcodeDetector).
  // Chargé seulement à l'ouverture du scanner. Version figée + empreinte d'intégrité.
  const SCANNER_LIB_URL = 'https://cdn.jsdelivr.net/npm/barcode-detector@3.0.8/dist/iife/ponyfill.js';
  const SCANNER_LIB_SRI = 'sha384-Q49TeOaAN5rWcAFf63shXxfuJaPyQY2q9nk0JaqlRlyj3T1Yom5bljHeE7RW0R35';

  const OFF_PRODUCT_URL = 'https://world.openfoodfacts.org/api/v2/product/';
  const OFF_SEARCH_URL = 'https://fr.openfoodfacts.org/cgi/search.pl';
  const OFF_SEARCH_URL_WORLD = 'https://world.openfoodfacts.org/cgi/search.pl';
  const OFF_FIELDS = [
    'code', 'product_name', 'product_name_fr', 'generic_name_fr', 'brands',
    'nutriments', 'serving_size', 'serving_quantity', 'quantity',
  ].join(',');

  const ACTIVITY_LEVELS = [
    { id: 'sedentaire', factor: 1.2, label: 'Sédentaire', desc: 'travail assis, peu ou pas de sport' },
    { id: 'leger', factor: 1.375, label: 'Légèrement actif', desc: 'sport léger 1 à 3 fois par semaine' },
    { id: 'modere', factor: 1.55, label: 'Modérément actif', desc: 'sport 3 à 5 fois par semaine' },
    { id: 'actif', factor: 1.725, label: 'Très actif', desc: 'sport intense 6 à 7 fois par semaine' },
    { id: 'extreme', factor: 1.9, label: 'Extrêmement actif', desc: 'travail physique + entraînement quotidien' },
  ];
  const RATES = [0.5, 0.75, 1];       // % du poids perdu par semaine

  const MACROS = [
    { key: 'prot', label: 'Protéines', short: 'P' },
    { key: 'gluc', label: 'Glucides', short: 'G' },
    { key: 'lip', label: 'Lipides', short: 'L' },
    { key: 'fib', label: 'Fibres', short: 'F' },
  ];
  const NUTRI_KEYS = ['kcal', 'prot', 'gluc', 'lip', 'fib'];

  const DEFAULT_MEALS = [
    { id: 'm1', name: 'Petit-déjeuner', time: '08:00' },
    { id: 'm2', name: 'Déjeuner', time: '12:30' },
    { id: 'm3', name: 'Collation', time: '16:30' },
    { id: 'm4', name: 'Dîner', time: '20:00' },
  ];
  const MAX_MEALS = 8;
  const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];                    // lundi → dimanche
  const WEEKDAY_SHORT = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];
  const MEASURES = [
    { key: 'waist', label: 'Tour de taille' },
    { key: 'hips', label: 'Hanches' },
    { key: 'arm', label: 'Bras' },
    { key: 'thigh', label: 'Cuisse' },
  ];

  const DB = window.FOOD_DB || { categories: {}, foods: [] };

  /* ---------- Raccourcis DOM ---------- */
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  /** Échappe un texte avant de l'insérer dans du HTML (noms d'aliments, marques…). */
  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, (c) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
  }
  function icon(name, cls) {
    return `<svg class="ic ${cls || ''}" aria-hidden="true"><use href="#i-${name}"/></svg>`;
  }
  function uid(prefix) {
    return (prefix || '') + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }
  function isNum(v) { return typeof v === 'number' && Number.isFinite(v); }
  function isObj(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }
  function clamp(v, min, max) { return Math.min(max, Math.max(min, v)); }
  function round(v, d) { const m = Math.pow(10, d || 0); return Math.round(v * m) / m; }
  function sum(arr) { return arr.reduce((s, x) => s + x, 0); }
  function mean(arr) { return arr.length ? sum(arr) / arr.length : null; }
  function debounce(fn, ms) {
    let t = null;
    return function () { clearTimeout(t); t = setTimeout(fn, ms); };
  }
  function cloneData(v) { return JSON.parse(JSON.stringify(v)); }

  /**
   * Lit un nombre tapé par l'utilisateur.
   * Accepte la virgule française (« 2,5 » = 2.5) et les espaces. Renvoie null si invalide.
   */
  function parseNum(input) {
    if (input == null) return null;
    if (typeof input === 'number') return Number.isFinite(input) ? input : null;
    const s = String(input).trim().replace(/[\s  ]/g, '').replace(',', '.');
    if (!/^-?(\d+\.?\d*|\.\d+)$/.test(s)) return null;
    const n = parseFloat(s);
    return Number.isFinite(n) ? n : null;
  }
  function numOr(v, def) {
    const n = typeof v === 'number' ? v : parseNum(v);
    return isNum(n) ? n : def;
  }

  /* ---------- Formatage français des nombres ---------- */
  const NF = {};
  /** Nombre au format français (espace pour les milliers, virgule décimale). Jamais « NaN ». */
  function fmt(n, dec) {
    if (!isNum(n)) return '–';
    const d = dec || 0;
    let v = round(n, d);
    if (v === 0) v = 0; // évite « -0 »
    if (!NF[d]) NF[d] = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: d });
    return NF[d].format(v);
  }
  function fmtSigned(n, dec) {
    if (!isNum(n)) return '–';
    const r = round(n, dec || 0);
    return (r > 0 ? '+' : r < 0 ? '−' : '') + fmt(Math.abs(n), dec);
  }
  /** Grammes de macros : une décimale sous 10 g, entier au-delà. */
  function fmtG(n) { return isNum(n) ? fmt(n, Math.abs(n) < 10 ? 1 : 0) : '–'; }
  function fmtKg(n) { return fmt(n, 1); }
  function fmtL(ml) { return isNum(ml) ? fmt(ml / 1000, 2) : '–'; }
  /** Valeur à mettre dans un champ de saisie (virgule décimale, sans séparateur de milliers). */
  function fmtInput(n, dec) {
    return isNum(n) ? String(round(n, dec == null ? 1 : dec)).replace('.', ',') : '';
  }

  /* ---------- Dates : toujours la date LOCALE (jamais toISOString, qui est en UTC) ---------- */
  function pad2(n) { return String(n).padStart(2, '0'); }
  /** Clé d'une journée « AAAA-MM-JJ » en heure locale. */
  function keyOf(d) { return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }
  function todayKey() { return keyOf(new Date()); }
  /** Date locale à midi : évite les décalages liés au passage à l'heure d'été. */
  function dateOf(key) {
    const p = key.split('-').map(Number);
    return new Date(p[0], p[1] - 1, p[2], 12, 0, 0);
  }
  function addDays(key, n) { const d = dateOf(key); d.setDate(d.getDate() + n); return keyOf(d); }
  /** Nombre de jours entre a et b (b − a). */
  function diffDays(a, b) {
    const pa = a.split('-').map(Number);
    const pb = b.split('-').map(Number);
    return Math.round((Date.UTC(pb[0], pb[1] - 1, pb[2]) - Date.UTC(pa[0], pa[1] - 1, pa[2])) / 86400000);
  }
  function isKey(k) { return typeof k === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(k) && !isNaN(dateOf(k).getTime()); }
  function weekdayOf(key) { return dateOf(key).getDay(); }
  function keyFromIso(iso) {
    if (!iso) return null;
    const d = new Date(iso);
    return isNaN(d.getTime()) ? null : keyOf(d);
  }
  const DF = {
    long: new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }),
    short: new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short' }),
    shortY: new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' }),
    full: new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }),
    weekday: new Intl.DateTimeFormat('fr-FR', { weekday: 'long' }),
    wdShort: new Intl.DateTimeFormat('fr-FR', { weekday: 'short' }),
  };
  function cap(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }
  function fmtDate(key, style) { return key && isKey(key) ? DF[style || 'short'].format(dateOf(key)) : '–'; }
  /** « 12 mars » (date proche : l'année est évidente), sinon « 12 mars 2028 ». */
  function fmtDateSmart(key) {
    if (!key || !isKey(key)) return '–';
    return Math.abs(diffDays(todayKey(), key)) < 300 ? fmtDate(key, 'short') : fmtDate(key, 'shortY');
  }
  function dayLabel(key) {
    const d = diffDays(todayKey(), key);
    if (d === 0) return 'Aujourd’hui';
    if (d === -1) return 'Hier';
    if (d === 1) return 'Demain';
    return cap(DF.weekday.format(dateOf(key)));
  }
  function daysAgoText(iso) {
    const k = keyFromIso(iso);
    if (!k) return 'jamais';
    const d = diffDays(k, todayKey());
    if (d <= 0) return 'aujourd’hui';
    if (d === 1) return 'hier';
    return `il y a ${d} jours`;
  }

  /** Texte normalisé pour la recherche : minuscules, sans accents (« crème » → « creme »). */
  function norm(s) {
    return String(s || '').toLowerCase().replace(/œ/g, 'oe').replace(/æ/g, 'ae')
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9%]+/g, ' ').trim();
  }

  /* ===========================================================================
     2. DONNÉES : STOCKAGE, SCHÉMA VERSIONNÉ, MIGRATION
     ========================================================================= */

  let state = null;
  let bootWarning = '';
  let persistGranted = null;

  function defaultSettings() {
    return {
      proteinPerKg: 2.2,        // g de protéines par kg
      fatPerKg: 0.8,            // g de lipides par kg (minimum 0,6)
      fiberG: 30,
      waterPerKg: 35,           // ml d'eau par kg
      carbCycling: false,       // cyclage des glucides
      cyclingGap: 20,           // écart entre jour d'entraînement et jour de repos (% de l'objectif)
      trainingDays: [1, 3, 5],  // 0 = dimanche … 6 = samedi
      stepsGoal: 8000,
      theme: 'auto',
      meals: DEFAULT_MEALS.map((m) => Object.assign({}, m, { hidden: false })),
    };
  }

  function defaultState() {
    return {
      schemaVersion: SCHEMA_VERSION,
      createdAt: new Date().toISOString(),   // horodatage (pas une clé de jour)
      profile: null,
      settings: defaultSettings(),
      manualGoals: { kcal: null, prot: null, gluc: null, lip: null, fib: null, water: null },
      days: {},          // 'AAAA-MM-JJ' → { entries: [], water: ml, steps: nombre|null, training: bool|null }
      weights: {},       // 'AAAA-MM-JJ' → kg
      measures: {},      // 'AAAA-MM-JJ' → { waist, hips, arm, thigh } en cm
      customFoods: [],   // aliments créés par l'utilisateur
      offFoods: {},      // produits Open Food Facts déjà consultés (code-barres → produit)
      favorites: [],     // références d'aliments ('b:id', 'c:id', 'o:code')
      savedMeals: [],    // repas types : { id, name, items: [...] }
      dietBreak: null,   // pause diète : { start, end, kcal }
      coach: { snoozeUntil: null, history: [] },
      meta: { lastBackupAt: null, backupSnoozeUntil: null, installHintHidden: false, profileUpdatedAt: null },
    };
  }

  /**
   * Migrations : chaque fonction transforme la version N en N+1.
   * Exemple pour une future version 2 :
   *   1: (d) => { d.settings.nouveauReglage = 'valeur'; },
   */
  const MIGRATIONS = {};

  /** Met à niveau des données (stockées ou importées) puis les nettoie. */
  function migrate(input) {
    if (!isObj(input)) throw new Error('format inconnu');
    const d = input;
    let v = parseInt(d.schemaVersion, 10) || 1;
    if (v > SCHEMA_VERSION) throw new Error('données créées par une version plus récente de l’app');
    while (v < SCHEMA_VERSION) {
      if (typeof MIGRATIONS[v] === 'function') MIGRATIONS[v](d);
      v += 1;
    }
    d.schemaVersion = SCHEMA_VERSION;
    return sanitize(d);
  }

  function clampNum(v, min, max, def) { return clamp(numOr(v, def), min, max); }

  function cleanNutri(n) {
    const o = {};
    NUTRI_KEYS.forEach((k) => {
      const v = n ? numOr(n[k], 0) : 0;
      o[k] = v >= 0 ? v : 0;
    });
    return o;
  }

  function sanitizeProfile(p) {
    if (!isObj(p)) return null;
    const age = numOr(p.age, null);
    const height = numOr(p.height, null);
    const weight = numOr(p.weight, null);
    if (!isNum(age) || !isNum(height) || !isNum(weight)) return null;
    const bf = numOr(p.bodyFat, null);
    const goal = numOr(p.goalWeight, null);
    return {
      sex: p.sex === 'f' ? 'f' : 'h',
      age: clamp(Math.round(age), 14, 100),
      height: clamp(height, 120, 230),
      weight: clamp(weight, 30, 300),
      bodyFat: isNum(bf) ? clamp(bf, 3, 60) : null,
      activity: ACTIVITY_LEVELS.some((a) => a.id === p.activity) ? p.activity : 'modere',
      sessions: clamp(Math.round(numOr(p.sessions, 3)), 0, 14),
      goalWeight: isNum(goal) ? clamp(goal, 30, 300) : clamp(weight, 30, 300),
      rate: RATES.indexOf(Number(p.rate)) >= 0 ? Number(p.rate) : 0.75,
    };
  }

  function sanitizeEntry(e) {
    const portion = isObj(e.portion) && numOr(e.portion.grams, 0) > 0
      ? { label: String(e.portion.label || 'portion').slice(0, 40), grams: numOr(e.portion.grams, 0), count: numOr(e.portion.count, 1) }
      : null;
    const qty = numOr(e.qty, null);
    return {
      id: String(e.id || uid('e')),
      meal: String(e.meal || 'm1'),
      ref: typeof e.ref === 'string' && e.ref ? e.ref : null,
      name: String(e.name || 'Aliment').slice(0, 120),
      brand: String(e.brand || '').slice(0, 60),
      unit: e.unit === 'ml' ? 'ml' : 'g',
      qty: isNum(qty) && qty > 0 ? qty : null,
      portion,
      per100: isObj(e.per100) ? cleanNutri(e.per100) : null,
      n: cleanNutri(e.n),
      t: numOr(e.t, Date.now()),
    };
  }

  function sanitizePortions(list) {
    return Array.isArray(list)
      ? list.filter((p) => isObj(p) && numOr(p.grams, 0) > 0)
        .map((p) => ({ label: String(p.label || 'portion').slice(0, 40), grams: numOr(p.grams, 0) }))
      : [];
  }

  function sanitizeCustom(f) {
    return {
      id: String(f.id || uid('c')),
      name: String(f.name || 'Aliment perso').slice(0, 120),
      brand: String(f.brand || '').slice(0, 60),
      unit: f.unit === 'ml' ? 'ml' : 'g',
      per100: cleanNutri(f.per100),
      sugars: numOr(f.sugars, null),
      salt: numOr(f.salt, null),
      portions: sanitizePortions(f.portions),
      barcode: f.barcode ? String(f.barcode).replace(/\D/g, '').slice(0, 14) : '',
    };
  }

  function sanitizeOff(p, code) {
    return {
      code: String(p.code || code),
      name: String(p.name || 'Produit').slice(0, 120),
      brand: String(p.brand || '').slice(0, 60),
      quantity: String(p.quantity || '').slice(0, 30),
      unit: p.unit === 'ml' ? 'ml' : 'g',
      per100: cleanNutri(p.per100),
      sugars: numOr(p.sugars, null),
      salt: numOr(p.salt, null),
      portions: sanitizePortions(p.portions),
      fetchedAt: numOr(p.fetchedAt, Date.now()),
      usedAt: numOr(p.usedAt, 0),
    };
  }

  /** Vérifie chaque champ et complète ce qui manque avec les valeurs par défaut. */
  function sanitize(d) {
    const out = defaultState();
    out.createdAt = typeof d.createdAt === 'string' && keyFromIso(d.createdAt) ? d.createdAt : out.createdAt;
    out.profile = sanitizeProfile(d.profile);

    const s = Object.assign(defaultSettings(), isObj(d.settings) ? d.settings : {});
    s.proteinPerKg = round(clampNum(s.proteinPerKg, 1.8, 2.7, 2.2), 2);
    s.fatPerKg = round(clampNum(s.fatPerKg, 0.6, 1.2, 0.8), 2);
    s.fiberG = Math.round(clampNum(s.fiberG, 10, 80, 30));
    s.waterPerKg = clampNum(s.waterPerKg, 20, 60, 35);
    s.cyclingGap = [10, 20, 30].indexOf(Number(s.cyclingGap)) >= 0 ? Number(s.cyclingGap) : 20;
    s.carbCycling = !!s.carbCycling;
    s.trainingDays = Array.isArray(s.trainingDays)
      ? Array.from(new Set(s.trainingDays.map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n <= 6)))
      : [1, 3, 5];
    s.stepsGoal = Math.round(clampNum(s.stepsGoal, 0, 100000, 8000));
    s.theme = ['auto', 'light', 'dark'].indexOf(s.theme) >= 0 ? s.theme : 'auto';
    let meals = Array.isArray(s.meals) ? s.meals.filter((m) => isObj(m) && m.id) : [];
    if (!meals.length) meals = defaultSettings().meals;
    s.meals = meals.slice(0, MAX_MEALS).map((m) => ({
      id: String(m.id),
      name: String(m.name || 'Repas').slice(0, 30),
      time: /^\d{2}:\d{2}$/.test(m.time) ? m.time : '12:00',
      hidden: !!m.hidden,
    }));
    if (!s.meals.some((m) => !m.hidden)) s.meals[0].hidden = false;
    out.settings = s;

    ['kcal', 'prot', 'gluc', 'lip', 'fib', 'water'].forEach((k) => {
      const v = numOr(isObj(d.manualGoals) ? d.manualGoals[k] : null, null);
      out.manualGoals[k] = isNum(v) && v >= 0 ? v : null;
    });

    if (isObj(d.days)) {
      Object.keys(d.days).forEach((key) => {
        const day = d.days[key];
        if (!isKey(key) || !isObj(day)) return;
        const steps = numOr(day.steps, null);
        out.days[key] = {
          entries: Array.isArray(day.entries) ? day.entries.filter(isObj).map(sanitizeEntry) : [],
          water: clampNum(day.water, 0, 20000, 0),
          steps: isNum(steps) ? Math.round(clamp(steps, 0, 200000)) : null,
          training: typeof day.training === 'boolean' ? day.training : null,
        };
      });
    }
    if (isObj(d.weights)) {
      Object.keys(d.weights).forEach((key) => {
        const w = numOr(d.weights[key], null);
        if (isKey(key) && isNum(w) && w >= 20 && w <= 400) out.weights[key] = w;
      });
    }
    if (isObj(d.measures)) {
      Object.keys(d.measures).forEach((key) => {
        const m = d.measures[key];
        if (!isKey(key) || !isObj(m)) return;
        const o = {};
        let any = false;
        MEASURES.forEach((x) => {
          const v = numOr(m[x.key], null);
          o[x.key] = isNum(v) && v > 0 ? v : null;
          if (o[x.key] != null) any = true;
        });
        if (any) out.measures[key] = o;
      });
    }
    out.customFoods = Array.isArray(d.customFoods) ? d.customFoods.filter(isObj).map(sanitizeCustom) : [];
    if (isObj(d.offFoods)) {
      Object.keys(d.offFoods).forEach((code) => {
        if (/^\d{6,14}$/.test(code) && isObj(d.offFoods[code])) out.offFoods[code] = sanitizeOff(d.offFoods[code], code);
      });
    }
    out.favorites = Array.isArray(d.favorites)
      ? Array.from(new Set(d.favorites.filter((r) => typeof r === 'string' && /^[bco]:/.test(r))))
      : [];
    out.savedMeals = Array.isArray(d.savedMeals)
      ? d.savedMeals.filter((m) => isObj(m) && Array.isArray(m.items)).map((m) => ({
        id: String(m.id || uid('r')),
        name: String(m.name || 'Repas type').slice(0, 40),
        items: m.items.filter(isObj).map(sanitizeEntry),
      })).filter((m) => m.items.length)
      : [];
    if (isObj(d.dietBreak) && isKey(d.dietBreak.start) && isKey(d.dietBreak.end) && isNum(numOr(d.dietBreak.kcal, null))) {
      out.dietBreak = { start: d.dietBreak.start, end: d.dietBreak.end, kcal: numOr(d.dietBreak.kcal, 2000) };
    }
    if (isObj(d.coach)) {
      out.coach.snoozeUntil = isKey(d.coach.snoozeUntil) ? d.coach.snoozeUntil : null;
      out.coach.history = Array.isArray(d.coach.history) ? d.coach.history.filter(isObj).slice(-50) : [];
    }
    if (isObj(d.meta)) {
      out.meta.lastBackupAt = typeof d.meta.lastBackupAt === 'string' && keyFromIso(d.meta.lastBackupAt) ? d.meta.lastBackupAt : null;
      out.meta.backupSnoozeUntil = isKey(d.meta.backupSnoozeUntil) ? d.meta.backupSnoozeUntil : null;
      out.meta.installHintHidden = !!d.meta.installHintHidden;
      out.meta.profileUpdatedAt = typeof d.meta.profileUpdatedAt === 'string' ? d.meta.profileUpdatedAt : null;
    }
    return out;
  }

  function loadState() {
    let raw = null;
    try {
      raw = localStorage.getItem(STORAGE_KEY);
    } catch (err) {
      bootWarning = 'Le stockage du navigateur est bloqué : tes données ne pourront pas être enregistrées.';
    }
    if (!raw) return defaultState();
    try {
      return migrate(JSON.parse(raw));
    } catch (err) {
      console.error('Données illisibles :', err);
      try { localStorage.setItem(STORAGE_KEY + ':secours-' + Date.now(), raw); } catch (e) { /* stockage plein */ }
      bootWarning = 'Tes données n’ont pas pu être relues. Une copie de secours a été gardée ; tu peux aussi importer une sauvegarde (Réglages).';
      return defaultState();
    }
  }

  /** Enregistre tout l'état (synchrone : rien n'est perdu si iOS ferme l'app). */
  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      return true;
    } catch (err) {
      console.error(err);
      toast('Enregistrement impossible : stockage plein ou bloqué. Exporte une sauvegarde.', { error: true, duration: 6000 });
      return false;
    }
  }

  /** Demande au navigateur de ne pas effacer les données automatiquement. */
  function requestPersistence() {
    const sm = navigator.storage;
    if (!sm || typeof sm.persist !== 'function') return;
    const already = typeof sm.persisted === 'function' ? sm.persisted() : Promise.resolve(false);
    already
      .then((p) => (p ? true : sm.persist()))
      .then((granted) => { persistGranted = !!granted; })
      .catch(() => { persistGranted = false; });
  }

  /* ===========================================================================
     3. BASE D'ALIMENTS (base fournie + aliments perso + produits Open Food Facts)
     ========================================================================= */

  /* Un « aliment » a toujours la même forme :
     { ref, source: 'base'|'custom'|'off'|'entry', id, name, brand, cat, unit,
       per100: { kcal, prot, gluc, lip, fib }, portions: [{ label, grams }], sugars, salt, search } */

  const BASE_FOODS = DB.foods.map((f) => ({
    ref: 'b:' + f.id,
    source: 'base',
    id: f.id,
    name: f.name,
    brand: '',
    cat: f.cat,
    unit: f.unit === 'ml' ? 'ml' : 'g',
    per100: cleanNutri(f.per100),
    portions: (f.portions || []).slice(),
    sugars: null,
    salt: null,
    search: norm(f.name + ' ' + (f.keywords || '')),
  }));
  const BASE_BY_ID = new Map(BASE_FOODS.map((f) => [f.id, f]));

  function customToFood(c) {
    return {
      ref: 'c:' + c.id, source: 'custom', id: c.id, name: c.name, brand: c.brand, cat: 'perso',
      unit: c.unit, per100: c.per100, portions: c.portions, sugars: c.sugars, salt: c.salt,
      barcode: c.barcode, search: norm(c.name + ' ' + c.brand),
    };
  }
  function offToFood(p) {
    return {
      ref: 'o:' + p.code, source: 'off', id: p.code, name: p.name, brand: p.brand, cat: 'off',
      unit: p.unit, per100: p.per100, portions: p.portions, sugars: p.sugars, salt: p.salt,
      barcode: p.code, quantity: p.quantity, search: norm(p.name + ' ' + p.brand),
    };
  }

  /** Retrouve un aliment à partir de sa référence ('b:poulet-filet-cuit', 'c:…', 'o:3017620422003'). */
  function getFood(ref) {
    if (typeof ref !== 'string') return null;
    const i = ref.indexOf(':');
    const type = ref.slice(0, i);
    const id = ref.slice(i + 1);
    if (type === 'b') return BASE_BY_ID.get(id) || null;
    if (type === 'c') {
      const c = state.customFoods.find((x) => x.id === id);
      return c ? customToFood(c) : null;
    }
    if (type === 'o') {
      const p = state.offFoods[id];
      return p ? offToFood(p) : null;
    }
    return null;
  }

  /** Aliment correspondant à une entrée du journal (l'aliment actuel s'il existe encore, sinon la copie enregistrée). */
  function foodFromEntry(e) {
    const f = e.ref ? getFood(e.ref) : null;
    if (f) return f;
    if (!e.per100) return null;
    return {
      ref: null, source: 'entry', id: null, name: e.name, brand: e.brand, cat: 'divers', unit: e.unit,
      per100: e.per100, portions: e.portion ? [{ label: e.portion.label, grams: e.portion.grams }] : [],
      sugars: null, salt: null, search: norm(e.name),
    };
  }

  /** Pour modifier une entrée : on garde ses valeurs enregistrées (l'historique ne change pas). */
  function foodForEdit(e) {
    const cur = e.ref ? getFood(e.ref) : null;
    const portions = cur ? cur.portions.slice() : [];
    return {
      ref: cur ? cur.ref : null, source: cur ? cur.source : 'entry', id: cur ? cur.id : null,
      name: e.name, brand: e.brand, cat: cur ? cur.cat : 'divers', unit: e.unit,
      per100: e.per100, portions, sugars: cur ? cur.sugars : null, salt: cur ? cur.salt : null,
      quantity: cur ? cur.quantity : '', search: norm(e.name),
    };
  }

  function allFoods() {
    return BASE_FOODS.concat(
      state.customFoods.map(customToFood),
      Object.keys(state.offFoods).map((c) => offToFood(state.offFoods[c])),
    );
  }

  function catInfo(cat) { return DB.categories[cat] || { label: 'Divers', icon: '🍽️' }; }

  /** Recherche insensible aux accents et aux majuscules, plusieurs mots possibles. */
  function searchFoods(query, opts) {
    const o = opts || {};
    const tokens = norm(query).split(' ').filter(Boolean)
      .map((t) => (t.length > 3 ? t.replace(/[sx]$/, '') : t)); // « oeufs » trouve « oeuf »
    const list = o.list || allFoods();
    if (!tokens.length) return list.slice().sort((a, b) => a.name.localeCompare(b.name, 'fr')).slice(0, o.limit || 1000);
    const favs = new Set(state.favorites);
    // 1er passage : chaque mot doit correspondre au DÉBUT d'un mot (« oeuf » ne trouve pas « boeuf »).
    // 2e passage (si rien trouvé) : correspondance n'importe où dans le nom.
    const run = (anywhere) => {
      const scored = [];
      list.forEach((f) => {
        const hay = ' ' + f.search;
        let score = 0;
        for (let i = 0; i < tokens.length; i++) {
          const w = hay.indexOf(' ' + tokens[i]);
          if (w < 0 && !(anywhere && hay.indexOf(tokens[i]) >= 0)) return;
          score += w === 0 ? 4 : w > 0 ? 2 : 1;
        }
        if (favs.has(f.ref)) score += 2;
        if (f.source === 'custom') score += 1;
        score -= f.name.length / 200;
        scored.push({ f, score });
      });
      return scored;
    };
    let scored = run(false);
    if (!scored.length) scored = run(true);
    scored.sort((a, b) => b.score - a.score || a.f.name.localeCompare(b.f.name, 'fr'));
    return scored.slice(0, o.limit || 60).map((x) => x.f);
  }

  /** Aliments récents : dernières entrées du journal, sans doublon, avec la dernière quantité utilisée. */
  function getRecents(limit) {
    const out = [];
    const seen = new Set();
    const keys = Object.keys(state.days).sort().reverse().slice(0, 120);
    for (let k = 0; k < keys.length; k++) {
      const entries = state.days[keys[k]].entries.slice().sort((a, b) => b.t - a.t);
      for (let i = 0; i < entries.length; i++) {
        const e = entries[i];
        if (!e.ref || !e.per100 || seen.has(e.ref)) continue;
        seen.add(e.ref);
        out.push(e);
        if (out.length >= (limit || 30)) return out;
      }
    }
    return out;
  }

  function isFav(ref) { return !!ref && state.favorites.indexOf(ref) >= 0; }
  function toggleFav(food) {
    if (!food || !food.ref) return false;
    const i = state.favorites.indexOf(food.ref);
    if (i >= 0) state.favorites.splice(i, 1);
    else {
      state.favorites.unshift(food.ref);
      if (food.source === 'off') touchOff(food.id);
    }
    save();
    return i < 0;
  }
  function favoriteFoods() { return state.favorites.map(getFood).filter(Boolean); }

  /** Garde un produit Open Food Facts en mémoire locale (disponible hors ligne ensuite). */
  function storeOffProduct(p) {
    const prev = state.offFoods[p.code] || {};
    state.offFoods[p.code] = sanitizeOff(Object.assign({}, prev, p, { fetchedAt: Date.now(), usedAt: prev.usedAt || 0 }), p.code);
    pruneOff();
    save();
  }
  function touchOff(code) { if (state.offFoods[code]) state.offFoods[code].usedAt = Date.now(); }
  function pruneOff() {
    const codes = Object.keys(state.offFoods);
    if (codes.length <= OFF_CACHE_MAX) return;
    const keep = new Set(state.favorites);
    Object.keys(state.days).forEach((k) => state.days[k].entries.forEach((e) => { if (e.ref) keep.add(e.ref); }));
    codes.filter((c) => !keep.has('o:' + c))
      .sort((a, b) => (state.offFoods[a].usedAt || state.offFoods[a].fetchedAt) - (state.offFoods[b].usedAt || state.offFoods[b].fetchedAt))
      .slice(0, codes.length - OFF_CACHE_MAX)
      .forEach((c) => { delete state.offFoods[c]; });
  }

  /* ===========================================================================
     4. CALCULS NUTRITIONNELS
     ========================================================================= */

  function scaleNutri(per100, qty) {
    const f = qty / 100;
    const o = {};
    NUTRI_KEYS.forEach((k) => { o[k] = round((per100[k] || 0) * f, 2); });
    return o;
  }
  function sumNutri(entries) {
    const t = { kcal: 0, prot: 0, gluc: 0, lip: 0, fib: 0 };
    entries.forEach((e) => NUTRI_KEYS.forEach((k) => { t[k] += e.n[k] || 0; }));
    return t;
  }
  function getDay(key, create) {
    let d = state.days[key];
    if (!d && create) {
      d = { entries: [], water: 0, steps: null, training: null };
      state.days[key] = d;
    }
    return d || null;
  }
  function dayTotals(key) { const d = state.days[key]; return sumNutri(d ? d.entries : []); }
  /** Une journée « renseignée » contient au moins un aliment (les jours vides ne comptent pas comme 0 kcal). */
  function isLogged(key) { const d = state.days[key]; return !!(d && d.entries.length); }

  function makeEntry(food, qty, portion, mealId) {
    return {
      id: uid('e'),
      meal: mealId,
      ref: food.ref || null,
      name: food.name,
      brand: food.brand || '',
      unit: food.unit === 'ml' ? 'ml' : 'g',
      qty,
      portion: portion || null,
      per100: cleanNutri(food.per100),
      n: scaleNutri(food.per100, qty),
      t: Date.now(),
    };
  }
  function entryQtyText(e) {
    if (!isNum(e.qty)) return 'Ajout rapide';
    const u = e.unit === 'ml' ? 'ml' : 'g';
    if (e.portion) return `${fmt(e.portion.count, 2)} × ${e.portion.label} (${fmt(e.qty, 1)} ${u})`;
    return `${fmt(e.qty, 1)} ${u}`;
  }

  function activityOf(id) { return ACTIVITY_LEVELS.find((a) => a.id === id) || ACTIVITY_LEVELS[2]; }
  function floorKcal(p) { return (p || state.profile || {}).sex === 'f' ? 1200 : 1500; }

  /** Jours d'entraînement proposés par défaut selon le nombre de séances. */
  function defaultTrainingDays(sessions) {
    const map = { 0: [], 1: [3], 2: [2, 5], 3: [1, 3, 5], 4: [1, 2, 4, 5], 5: [1, 2, 3, 4, 5], 6: [1, 2, 3, 4, 5, 6] };
    return (map[Math.min(7, sessions)] || [0, 1, 2, 3, 4, 5, 6]).slice();
  }

  /**
   * Objectifs calculés à partir du profil.
   * - Métabolisme de base : Mifflin-St Jeor, ou Katch-McArdle si la masse grasse est connue.
   * - Dépense totale = métabolisme × facteur d'activité.
   * - Déficit = rythme visé × 7 700 kcal ÷ 7, plafonné à 25 % de la dépense.
   * - Protéines et lipides en g/kg ; glucides = le reste des calories.
   */
  function computeTargets(p, s) {
    const male = p.sex !== 'f';
    const w = p.weight;
    let bmr;
    let formula;
    let lbm = null;
    if (isNum(p.bodyFat)) {
      lbm = w * (1 - p.bodyFat / 100);
      bmr = 370 + 21.6 * lbm;
      formula = 'katch';
    } else {
      bmr = 10 * w + 6.25 * p.height - 5 * p.age + (male ? 5 : -161);
      formula = 'mifflin';
    }
    const act = activityOf(p.activity);
    const tdee = bmr * act.factor;
    const weeklyLossKg = w * p.rate / 100;
    const wantedDeficit = weeklyLossKg * KCAL_PER_KG / 7;
    const maxDeficit = tdee * 0.25;
    const deficit = Math.max(0, Math.min(wantedDeficit, maxDeficit));
    const capped = wantedDeficit > maxDeficit + 0.5;
    const kcal = Math.max(0, Math.round((tdee - deficit) / 10) * 10);
    const bmi = w / Math.pow(p.height / 100, 2);
    const highFat = isNum(p.bodyFat) && p.bodyFat >= (male ? 25 : 32);
    const overweight = bmi >= 30 || highFat;
    const useGoal = overweight && isNum(p.goalWeight) && p.goalWeight < w;
    const refWeight = useGoal ? p.goalWeight : w;
    const prot = Math.round(s.proteinPerKg * refWeight);
    const lip = Math.round(Math.max(0.6, s.fatPerKg) * refWeight);
    const glucRaw = (kcal - prot * 4 - lip * 9) / 4;
    const gluc = Math.max(0, Math.round(glucRaw));
    const water = Math.round((w * s.waterPerKg) / 50) * 50;
    const realRate = (deficit * 7 / KCAL_PER_KG) / w * 100;
    return {
      male, bmr, formula, lbm, act, tdee, weeklyLossKg, wantedDeficit, maxDeficit, deficit, capped,
      kcal, bmi, overweight, useGoal, refWeight, prot, lip, gluc, glucRaw, fib: s.fiberG, water, realRate,
    };
  }

  /** Objectifs de base (calculés, ou saisis à la main dans Réglages). */
  function goalsFor(p, s, manual) {
    const t = computeTargets(p, s);
    const m = manual || {};
    const kcal = isNum(m.kcal) ? m.kcal : t.kcal;
    const prot = isNum(m.prot) ? m.prot : t.prot;
    const lip = isNum(m.lip) ? m.lip : t.lip;
    const glucAuto = Math.max(0, Math.round((kcal - prot * 4 - lip * 9) / 4));
    const gluc = isNum(m.gluc) ? m.gluc : glucAuto;
    const fib = isNum(m.fib) ? m.fib : t.fib;
    const water = isNum(m.water) ? m.water : t.water;
    return { t, kcal, prot, lip, gluc, glucAuto, fib, water, manual: Object.assign({}, m) };
  }
  function baseGoals() { return goalsFor(state.profile, state.settings, state.manualGoals); }

  /**
   * Cyclage des glucides : plus de calories (glucides) les jours d'entraînement, moins les jours
   * de repos, avec la MÊME moyenne sur la semaine.
   * Écart E entre les deux types de jours : bonus = E × repos/7, réduction = E × entraînements/7.
   */
  function cyclingPlan(base, s) {
    const set = s || state.settings;
    const T = set.trainingDays.length;
    const R = 7 - T;
    if (!set.carbCycling || T === 0 || R === 0) return null;
    let gap = base.kcal * set.cyclingGap / 100;
    let rest = gap * T / 7;
    // Garde-fou : au moins 50 g de glucides (ou la moitié de la moyenne) les jours de repos
    const minRestGluc = Math.min(50, base.gluc * 0.5);
    const maxRest = Math.max(0, (base.gluc - minRestGluc) * 4);
    let limited = false;
    if (rest > maxRest) {
      rest = maxRest;
      gap = rest * 7 / T;
      limited = true;
    }
    const train = gap * R / 7;
    return { train: Math.round(train / 5) * 5, rest: Math.round(rest / 5) * 5, T, R, limited };
  }

  function isTraining(key) {
    const d = state.days[key];
    if (d && typeof d.training === 'boolean') return d.training;
    return state.settings.trainingDays.indexOf(weekdayOf(key)) >= 0;
  }
  function activeDietBreak(key) {
    const b = state.dietBreak;
    return b && key >= b.start && key <= b.end ? b : null;
  }

  /** Objectifs d'une journée précise (cyclage, pause diète et entraînement pris en compte). */
  function dayGoals(key) {
    const base = baseGoals();
    const training = isTraining(key);
    const db = activeDietBreak(key);
    let kcal = base.kcal;
    let gluc = base.gluc;
    let delta = 0;
    if (db) {
      delta = Math.round(db.kcal - base.kcal);
      kcal = db.kcal;
      gluc = Math.max(0, base.gluc + Math.round(delta / 4));
    } else {
      const plan = cyclingPlan(base);
      if (plan) {
        delta = training ? plan.train : -plan.rest;
        kcal = base.kcal + delta;
        gluc = Math.max(0, base.gluc + Math.round(delta / 4));
      }
    }
    const water = base.water + (training ? 500 : 0);
    return { kcal, prot: base.prot, gluc, lip: base.lip, fib: base.fib, water, training, delta, dietBreak: db, base };
  }

  /** Garde-fous : objectifs trop bas, rythme trop rapide, macros incohérentes. */
  function warningsFor(p, s, manual) {
    const out = [];
    if (!p) return out;
    const base = goalsFor(p, s, manual);
    const t = base.t;
    const floor = floorKcal(p);
    const plan = cyclingPlan(base, s);
    const lowest = plan ? base.kcal - plan.rest : base.kcal;
    if (lowest < floor) {
      out.push({ level: 'bad', text: `Objectif sous ${fmt(floor)} kcal par jour${plan ? ' (jours de repos)' : ''} : trop bas pour ${p.sex === 'f' ? 'une femme' : 'un homme'} sans suivi médical. Choisis un rythme plus lent ou bouge davantage.` });
    }
    const rate = ((t.tdee - base.kcal) * 7 / KCAL_PER_KG) / p.weight * 100;
    if (rate > 1.005) {
      out.push({ level: 'bad', text: `Rythme estimé : ${fmt(rate, 2)} % du poids par semaine. Au-delà de 1 %, le risque de perdre du muscle augmente.` });
    }
    if (base.kcal - base.prot * 4 - base.lip * 9 < 0 && !isNum(base.manual.gluc)) {
      out.push({ level: 'warn', text: 'Protéines + lipides dépassent ton objectif calorique : les glucides tombent à 0. Baisse les lipides ou relève les calories.' });
    }
    if (!isNum(base.manual.kcal) && t.capped) {
      out.push({ level: 'info', text: `Déficit plafonné à 25 % de ta dépense : le rythme réel sera d’environ ${fmt(t.realRate, 2)} % par semaine.` });
    }
    if (p.goalWeight >= p.weight) {
      out.push({ level: 'info', text: 'Ton poids objectif n’est pas inférieur à ton poids actuel : l’app est pensée pour une sèche (perte de gras).' });
    }
    return out;
  }
  function goalWarnings() { return warningsFor(state.profile, state.settings, state.manualGoals); }

  /* ---------- Poids ---------- */

  /** Moyenne des pesées sur les `days` jours se terminant à endKey. */
  function avgWeight(endKey, days) {
    const vals = [];
    for (let i = 0; i < (days || 7); i++) {
      const w = state.weights[addDays(endKey, -i)];
      if (isNum(w)) vals.push(w);
    }
    return vals.length ? { avg: mean(vals), n: vals.length } : null;
  }
  function latestWeight() {
    const keys = Object.keys(state.weights).sort();
    if (!keys.length) return null;
    const k = keys[keys.length - 1];
    return { key: k, kg: state.weights[k] };
  }

  /** Moyenne 7 jours, perte de la semaine et date estimée d'atteinte de l'objectif. */
  function weightStats() {
    const today = todayKey();
    const p = state.profile;
    const cur = avgWeight(today, 7);
    const prev = avgWeight(addDays(today, -7), 7);
    const res = { cur, prev, latest: latestWeight() };
    if (cur && prev) {
      res.weekly = cur.avg - prev.avg;
      res.weeklyPct = res.weekly / prev.avg * 100;
    }
    const ref = cur ? cur.avg : (res.latest ? res.latest.kg : p.weight);
    res.ref = ref;
    res.remaining = ref - p.goalWeight;
    if (res.remaining <= 0.05) {
      res.reached = true;
      return res;
    }
    // Au rythme visé : perte de X % du poids chaque semaine
    const r = p.rate / 100;
    const weeksPlan = Math.log(p.goalWeight / ref) / Math.log(1 - r);
    if (isNum(weeksPlan) && weeksPlan > 0 && weeksPlan < 520) res.etaPlan = addDays(today, Math.round(weeksPlan * 7));
    // Au rythme réellement observé
    if (isNum(res.weekly) && res.weekly < -0.05) {
      const weeks = res.remaining / -res.weekly;
      if (weeks < 520) res.etaActual = addDays(today, Math.round(weeks * 7));
    }
    return res;
  }

  /** Bilan des 7 jours se terminant à endKey (moyennes sur les jours renseignés uniquement). */
  function weekSummary(endKey) {
    const keys = [];
    for (let i = 6; i >= 0; i--) keys.push(addDays(endKey, -i));
    const logged = keys.filter(isLogged);
    const totals = logged.map(dayTotals);
    const goals = logged.map(dayGoals);
    const avgOf = (arr, k) => (arr.length ? mean(arr.map((x) => x[k])) : null);
    const protHit = logged.filter((k, i) => totals[i].prot >= goals[i].prot * 0.9).length;
    const kcalOk = logged.filter((k, i) => Math.abs(totals[i].kcal - goals[i].kcal) <= goals[i].kcal * 0.1).length;
    const water = keys.map((k) => (state.days[k] ? state.days[k].water : 0)).filter((v) => v > 0);
    const steps = keys.map((k) => (state.days[k] ? state.days[k].steps : null)).filter(isNum);
    return {
      keys,
      loggedCount: logged.length,
      avgKcal: avgOf(totals, 'kcal'),
      avgProt: avgOf(totals, 'prot'),
      avgGluc: avgOf(totals, 'gluc'),
      avgLip: avgOf(totals, 'lip'),
      avgFib: avgOf(totals, 'fib'),
      avgGoalKcal: avgOf(goals, 'kcal'),
      avgGoalProt: avgOf(goals, 'prot'),
      protHitPct: logged.length ? protHit / logged.length * 100 : null,
      kcalOk,
      avgWater: water.length ? mean(water) : null,
      avgSteps: steps.length ? mean(steps) : null,
    };
  }

  /** Nombre de jours consécutifs avec le journal rempli (jusqu'à aujourd'hui ou hier). */
  function logStreak() {
    let k = todayKey();
    if (!isLogged(k)) k = addDays(k, -1);
    let n = 0;
    while (isLogged(k) && n < 3650) {
      n += 1;
      k = addDays(k, -1);
    }
    return n;
  }

  /* ---------- Coach adaptatif ---------- */

  /**
   * Estime la VRAIE dépense à partir des données (14 jours minimum, 28 au plus) :
   *   dépense ≈ calories moyennes − (variation du poids moyen en kg × 7 700 ÷ nombre de jours)
   * La variation est négative quand on perd du poids. Les jours sans journal ne comptent pas.
   */
  function coachAnalysis() {
    const p = state.profile;
    const today = todayKey();
    const res = { ready: false, span: 0, logged: 0, weighA: 0, weighB: 0 };
    if (!p) return res;
    const keys = Object.keys(state.weights).concat(Object.keys(state.days).filter(isLogged)).sort();
    if (!keys.length) return res;
    const span = diffDays(keys[0], today);
    const start = span > 28 ? addDays(today, -28) : keys[0];
    const L = diffDays(start, today);
    let kSum = 0;
    let kN = 0;
    for (let i = 0; i < L; i++) {          // de start à hier (la journée en cours n'est pas finie)
      const k = addDays(start, i);
      if (isLogged(k)) { kSum += dayTotals(k).kcal; kN += 1; }
    }
    const A = [];
    const B = [];
    for (let i = 0; i <= L; i++) {
      const w = state.weights[addDays(start, i)];
      if (!isNum(w)) continue;
      if (i <= 6) A.push([i, w]);            // 7 premiers jours
      if (i >= L - 6) B.push([i, w]);        // 7 derniers jours
    }
    Object.assign(res, { span: L, logged: kN, weighA: A.length, weighB: B.length });
    if (L < 14 || kN < 10 || A.length < 3 || B.length < 3) return res;
    const avgA = mean(A.map((x) => x[1]));
    const avgB = mean(B.map((x) => x[1]));
    const days = mean(B.map((x) => x[0])) - mean(A.map((x) => x[0]));
    if (days < 7) return res;
    const delta = avgB - avgA;
    const avgKcal = kSum / kN;
    const tdee = avgKcal - (delta * KCAL_PER_KG) / days;
    const weeklyPct = ((-delta / days) * 7) / avgA * 100;   // positif = perte
    const wanted = Math.min((avgB * p.rate / 100) * KCAL_PER_KG / 7, tdee * 0.25);
    let suggested = Math.round((tdee - wanted) / 10) * 10;
    const floor = floorKcal();
    let floored = false;
    if (suggested < floor) { suggested = floor; floored = true; }
    const current = baseGoals().kcal;
    Object.assign(res, {
      ready: true, start, avgA, avgB, days, delta, avgKcal, tdee, weeklyPct, suggested, floored, current,
      diff: suggested - current, suspicious: tdee < 1000 || tdee > 6000,
    });
    return res;
  }

  /** Plateau : moyenne de poids stable depuis 14 jours malgré un suivi régulier. */
  function plateauCheck() {
    const p = state.profile;
    if (!p) return null;
    const today = todayKey();
    if (activeDietBreak(today)) return null;
    const now = avgWeight(today, 7);
    const mid = avgWeight(addDays(today, -7), 7);
    const before = avgWeight(addDays(today, -14), 7);
    if (!now || !mid || !before || now.n < 3 || mid.n < 2 || before.n < 3) return null;
    if (now.avg <= p.goalWeight) return null;
    let logged = 0;
    for (let i = 1; i <= 14; i++) if (isLogged(addDays(today, -i))) logged += 1;
    if (logged < 10) return null;
    const change = now.avg - before.avg;           // négatif = perte
    if (change > -0.0025 * before.avg) return { change, before: before.avg, now: now.avg };
    return null;
  }

  /** Calories de maintien estimées (coach si possible, sinon calcul du profil). */
  function maintenanceKcal() {
    const c = coachAnalysis();
    const v = c.ready && !c.suspicious ? c.tdee : baseGoals().t.tdee;
    return Math.round(v / 10) * 10;
  }

  /* ===========================================================================
     5. INTERFACE : rendu, événements, feuilles, dialogues, notifications
     ========================================================================= */

  const ui = {
    tab: 'today',          // today | progress | foods | settings
    day: todayKey(),       // journée affichée dans le journal
    lastToday: todayKey(),
    range: 30,             // période des graphiques (jours)
    foodsFilter: 'all',
    foodsQuery: '',
    scroll: {},
    swVersion: null,
    onbDraft: null,
    onbResult: false,
    animate: false,
  };

  const ACTIONS = {};   // clic sur [data-action]
  const CHANGES = {};   // événement change sur [data-change]
  const INPUTS = {};    // événement input sur [data-input]
  const FORMS = {};     // envoi d'un formulaire [data-form]

  /** Affiche l'onglet courant (ou l'écran de démarrage si le profil n'existe pas encore). */
  function render() {
    const v = $('#view');
    const tabbar = $('#tabbar');
    if (!state.profile) {
      document.body.classList.add('no-tabbar');
      tabbar.hidden = true;
      v.innerHTML = renderOnboarding();
      mountOnboarding();
      return;
    }
    document.body.classList.remove('no-tabbar');
    tabbar.hidden = false;
    const y = window.scrollY;
    let html;
    if (ui.tab === 'progress') html = renderProgress();
    else if (ui.tab === 'foods') html = renderFoods();
    else if (ui.tab === 'settings') html = renderSettings();
    else html = renderToday();
    v.innerHTML = html;
    if (ui.animate) {
      v.classList.remove('view-enter');
      void v.offsetWidth;
      v.classList.add('view-enter');
      ui.animate = false;
    }
    $$('#tabbar .tab[data-tab]').forEach((b) => {
      const on = b.dataset.tab === ui.tab;
      b.classList.toggle('active', on);
      if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
    });
    if (ui.tab === 'progress') drawCharts();
    if (ui.tab === 'foods') scrollActiveChips(v);
    if (!document.body.style.position) window.scrollTo(0, y);
  }

  function switchTab(tab) {
    if (tab === ui.tab) {
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    ui.scroll[ui.tab] = window.scrollY;
    ui.tab = tab;
    ui.animate = true;
    render();
    window.scrollTo(0, ui.scroll[tab] || 0);
  }

  /* ---------- Délégation d'événements ---------- */
  document.addEventListener('click', (ev) => {
    const el = ev.target.closest('[data-action]');
    if (!el || el.disabled) return;
    const fn = ACTIONS[el.dataset.action];
    if (!fn) return;
    ev.preventDefault();
    fn(el, ev);
  });
  document.addEventListener('change', (ev) => {
    const el = ev.target.closest('[data-change]');
    if (el && CHANGES[el.dataset.change]) CHANGES[el.dataset.change](el, ev);
  });
  document.addEventListener('input', (ev) => {
    const el = ev.target.closest('[data-input]');
    if (el && INPUTS[el.dataset.input]) INPUTS[el.dataset.input](el, ev);
  });
  document.addEventListener('submit', (ev) => {
    const f = ev.target.closest('[data-form]');
    if (!f) return;
    ev.preventDefault();
    if (FORMS[f.dataset.form]) FORMS[f.dataset.form](f, ev);
  });

  /* ---------- Blocage du défilement quand une feuille est ouverte ---------- */
  let lockedY = 0;
  function lockScroll() {
    lockedY = window.scrollY;
    const b = document.body.style;
    b.position = 'fixed';
    b.top = `-${lockedY}px`;
    b.left = '0';
    b.right = '0';
  }
  function unlockScroll() {
    const b = document.body.style;
    b.position = '';
    b.top = '';
    b.left = '';
    b.right = '';
    window.scrollTo(0, lockedY);
  }

  /* ---------- Feuilles (panneaux qui montent du bas) ---------- */
  const sheetStack = [];

  /**
   * Ouvre une feuille. Options : title, body (HTML), foot (HTML), full (pleine hauteur),
   * closeLabel, closeEnd (bouton de fermeture à droite), onClose.
   */
  function openSheet(o) {
    const wrap = document.createElement('div');
    wrap.className = 'sheet-wrap';
    const closeBtn = `<button class="sheet-head-btn ${o.closeEnd ? 'end' : 'start'}" type="button" data-sheet="close">${esc(o.closeLabel || 'Fermer')}</button>`;
    wrap.innerHTML = `
      <div class="sheet-backdrop"></div>
      <section class="sheet ${o.full ? 'sheet-full' : ''}" role="dialog" aria-modal="true" aria-label="${esc(o.title)}">
        <div class="sheet-grab" aria-hidden="true"></div>
        <header class="sheet-head">
          ${o.closeEnd ? '<span class="sheet-head-btn start"></span>' : closeBtn}
          <h2 class="sheet-title">${esc(o.title)}</h2>
          ${o.closeEnd ? closeBtn : '<span class="sheet-head-btn end"></span>'}
        </header>
        <div class="sheet-body"></div>
        <footer class="sheet-foot" hidden></footer>
      </section>`;
    $('#sheets').appendChild(wrap);
    const sheet = {
      el: wrap,
      body: $('.sheet-body', wrap),
      foot: $('.sheet-foot', wrap),
      closed: false,
      onClose: o.onClose,
      setBody(html) { this.body.innerHTML = html; scrollActiveChips(this.body); },
      setFoot(html) { this.foot.innerHTML = html || ''; this.foot.hidden = !html; },
      setTitle(t) { $('.sheet-title', wrap).textContent = t; },
      close() { closeSheet(sheet); },
    };
    $('.sheet-backdrop', wrap).addEventListener('click', () => closeSheet(sheet));
    $('[data-sheet="close"]', wrap).addEventListener('click', () => closeSheet(sheet));
    if (!sheetStack.length) lockScroll();
    sheetStack.push(sheet);
    if (o.body) sheet.setBody(o.body);
    if (o.foot) sheet.setFoot(o.foot);
    void wrap.offsetHeight; // force le navigateur à calculer la position de départ (animation)
    wrap.classList.add('open');
    return sheet;
  }
  function closeSheet(sheet) {
    if (!sheet || sheet.closed) return;
    sheet.closed = true;
    const i = sheetStack.indexOf(sheet);
    if (i >= 0) sheetStack.splice(i, 1);
    if (document.activeElement && sheet.el.contains(document.activeElement)) document.activeElement.blur();
    sheet.el.classList.remove('open');
    setTimeout(() => sheet.el.remove(), 340);
    if (!sheetStack.length) unlockScroll();
    if (typeof sheet.onClose === 'function') sheet.onClose();
  }
  function closeAllSheets() { sheetStack.slice().reverse().forEach(closeSheet); }

  /** Fait défiler les rangées de puces pour que la puce sélectionnée soit visible. */
  function scrollActiveChips(root) {
    $$('.chips', root).forEach((row) => {
      const a = $('.chip.active', row);
      if (a && row.scrollWidth > row.clientWidth) row.scrollLeft = Math.max(0, a.offsetLeft - row.offsetLeft - 16);
    });
  }
  function topSheet() { return sheetStack[sheetStack.length - 1] || null; }

  /** Clavier de l'iPhone : on remonte les feuilles au-dessus du clavier (API visualViewport). */
  function setupViewport() {
    const vv = window.visualViewport;
    if (!vv) return;
    const root = document.documentElement;
    const update = () => {
      const kb = Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop));
      root.style.setProperty('--vvh', Math.round(vv.height) + 'px');
      root.style.setProperty('--kb', kb + 'px');
      document.body.classList.toggle('kb-open', kb > 80);
    };
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    update();
  }

  /* ---------- Dialogues (confirmation / saisie) ---------- */
  function dialog(o) {
    return new Promise((resolve) => {
      const wrap = document.createElement('div');
      wrap.className = 'dialog-wrap';
      wrap.innerHTML = `
        <div class="dialog" role="alertdialog" aria-modal="true" aria-label="${esc(o.title)}">
          <div class="dialog-body">
            <div class="dialog-title">${esc(o.title)}</div>
            ${o.message ? `<div class="dialog-msg">${esc(o.message)}</div>` : ''}
            ${o.input ? `<input class="input dialog-input" type="text" maxlength="40" autocomplete="off" value="${esc(o.value || '')}" placeholder="${esc(o.placeholder || '')}">` : ''}
          </div>
          <div class="dialog-actions">
            ${o.cancel === false ? '' : `<button type="button" data-r="0">${esc(o.cancel || 'Annuler')}</button>`}
            <button type="button" data-r="1" class="ok ${o.danger ? 'danger' : ''}">${esc(o.ok || 'OK')}</button>
          </div>
        </div>`;
      $('#dialogs').appendChild(wrap);
      const input = $('.dialog-input', wrap);
      let done = false;
      const finish = (ok) => {
        if (done) return;
        done = true;
        wrap.classList.remove('open');
        setTimeout(() => wrap.remove(), 220);
        resolve(o.input ? (ok ? input.value.trim() : null) : ok);
      };
      wrap.addEventListener('click', (ev) => {
        const b = ev.target.closest('[data-r]');
        if (b) finish(b.dataset.r === '1');
      });
      if (input) {
        input.addEventListener('keydown', (ev) => {
          if (ev.key === 'Enter') { ev.preventDefault(); finish(true); }
        });
      }
      void wrap.offsetHeight;
      wrap.classList.add('open');
      if (input) input.focus();
    });
  }
  const confirmDialog = (o) => dialog(o);
  const promptDialog = (o) => dialog(Object.assign({ input: true }, o));

  /* ---------- Notifications (toasts) ---------- */
  function toast(msg, o) {
    const opt = o || {};
    const root = $('#toasts');
    if (!root) return () => {};
    const el = document.createElement('div');
    el.className = 'toast' + (opt.error ? ' error' : '');
    el.setAttribute('role', opt.error ? 'alert' : 'status');
    el.innerHTML = `<span class="toast-msg"></span>${opt.action ? `<button class="toast-action" type="button">${esc(opt.action)}</button>` : ''}`;
    $('.toast-msg', el).textContent = msg;
    root.appendChild(el);
    while (root.children.length > 2) root.firstElementChild.remove();
    let timer = null;
    const hide = () => {
      clearTimeout(timer);
      el.classList.remove('show');
      setTimeout(() => el.remove(), 260);
    };
    if (opt.action) {
      $('.toast-action', el).addEventListener('click', () => {
        hide();
        if (opt.onAction) opt.onAction();
      });
    }
    void el.offsetHeight;
    el.classList.add('show');
    timer = setTimeout(hide, opt.duration || (opt.action ? 5000 : 2600));
    return hide;
  }

  let errorShown = false;
  window.addEventListener('error', (ev) => {
    if (ev.filename && ev.filename.indexOf(location.origin) !== 0) return; // erreur d'un script externe
    console.error(ev.error || ev.message);
    if (!errorShown && state) {
      errorShown = true;
      toast('Un problème est survenu. Si ça se répète, ferme et rouvre l’app.', { error: true });
    }
  });
  window.addEventListener('unhandledrejection', (ev) => console.error(ev.reason));

  /* ---------- Petits composants HTML réutilisables ---------- */
  function statTile(label, value, unit, sub) {
    return `<div class="stat"><div class="stat-label">${esc(label)}</div><div class="stat-value">${esc(value)}${unit ? ` <small>${esc(unit)}</small>` : ''}</div>${sub ? `<div class="stat-sub">${esc(sub)}</div>` : ''}</div>`;
  }
  function emptyHTML(ic, title, text) {
    return `<div class="empty">${icon(ic)}<div class="empty-title">${esc(title)}</div><div>${esc(text)}</div></div>`;
  }
  function banner(kind, ic, title, text, actions) {
    return `<div class="banner banner-${kind}">${icon(ic)}<div class="banner-body"><div class="banner-title">${esc(title)}</div>${text ? `<p>${esc(text)}</p>` : ''}${actions ? `<div class="banner-actions">${actions}</div>` : ''}</div></div>`;
  }
  function warningsHTML(list) {
    if (!list.length) return '';
    return list.map((w) => {
      const kind = w.level === 'bad' ? 'bad' : w.level === 'warn' ? 'warn' : 'info';
      return `<div class="banner banner-${kind}">${icon('info')}<div class="banner-body"><p>${esc(w.text)}</p></div></div>`;
    }).join('');
  }
  /** Champ numérique (clavier décimal de l'iPhone, virgule acceptée). */
  function numField(name, label, unit, value, opts) {
    const o = opts || {};
    return `<label class="field"><span class="field-label">${esc(label)}${o.sub ? `<small>${esc(o.sub)}</small>` : ''}</span>`
      + `<input class="input input-num" type="text" inputmode="${o.mode || 'decimal'}" enterkeyhint="done" name="${name}" autocomplete="off" `
      + `placeholder="${esc(o.placeholder != null ? o.placeholder : '0')}" value="${fmtInput(value, o.dec == null ? 1 : o.dec)}">`
      + `<span class="input-unit">${esc(unit || '')}</span></label>`;
  }
  function mealName(id) {
    const m = state.settings.meals.find((x) => x.id === id);
    return m ? m.name : 'Autre';
  }
  function activeMeals() { return state.settings.meals.filter((m) => !m.hidden); }
  /** Choisit le repas le plus proche de l'heure actuelle (selon les heures définies dans Réglages). */
  function guessMeal() {
    const meals = activeMeals();
    if (!meals.length) return state.settings.meals[0].id;
    const now = new Date();
    const mins = now.getHours() * 60 + now.getMinutes();
    let best = meals[0];
    let bestD = Infinity;
    meals.forEach((m) => {
      const p = m.time.split(':').map(Number);
      const d = Math.abs(p[0] * 60 + p[1] - mins);
      if (d < bestD) { bestD = d; best = m; }
    });
    return best.id;
  }
  function mealChips(selected) {
    const meals = state.settings.meals.filter((m) => !m.hidden || m.id === selected);
    return meals.map((m) => `<button type="button" class="chip ${m.id === selected ? 'active' : ''}" data-meal-chip="${esc(m.id)}">${esc(m.name)}</button>`).join('');
  }
  /** Gère la sélection d'un repas dans une rangée de puces ; renvoie l'id choisi. */
  function pickMealChip(ev, root) {
    const chip = ev.target.closest('[data-meal-chip]');
    if (!chip) return null;
    $$('[data-meal-chip]', root).forEach((c) => c.classList.toggle('active', c === chip));
    return chip.dataset.mealChip;
  }

  /* ---------- Installation sur l'iPhone ---------- */
  function isStandalone() {
    return window.navigator.standalone === true
      || (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);
  }
  function isIOS() {
    return /iphone|ipad|ipod/i.test(navigator.userAgent)
      || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  }
  function installHintBanner(onboarding) {
    if (isStandalone() || !isIOS() || state.meta.installHintHidden) return '';
    return banner('info', 'share', 'Installe MacroSèche sur ton iPhone',
      `Elle s’ouvrira en plein écran et fonctionnera hors ligne.${onboarding ? ' Installe-la avant de commencer : Safari et l’app installée ne partagent pas leurs données.' : ''}`,
      '<button class="btn btn-small btn-primary" data-action="install-guide">Voir comment</button><button class="btn btn-small" data-action="hide-install">Plus tard</button>');
  }
  function openInstallGuide() {
    openSheet({
      title: 'Installer sur l’iPhone',
      body: `
        <ol class="steps">
          <li><span>Ouvre le lien de l’app dans <b>Safari</b>.</span></li>
          <li><span>Touche le bouton <b>Partager</b> <span class="inline-ic">${icon('share')}</span> (en bas de l’écran ; sur iOS 26, il se trouve dans le menu <b>•••</b>).</span></li>
          <li><span>Fais défiler et choisis <b>« Sur l’écran d’accueil »</b>. Si l’option « Ouvrir comme app web » apparaît, laisse-la activée.</span></li>
          <li><span>Touche <b>Ajouter</b> : l’icône MacroSèche apparaît sur ton écran d’accueil.</span></li>
          <li><span>Ouvre ensuite toujours l’app depuis cette icône : elle s’affiche en plein écran et marche hors ligne.</span></li>
        </ol>
        ${banner('warn', 'info', 'Important', 'L’app installée et Safari ne partagent pas leurs données. Si tu as déjà saisi des données dans Safari, exporte une sauvegarde (Réglages › Sauvegarde) puis importe-la dans l’app installée.')}
        ${banner('info', 'info', 'Pense aux sauvegardes', 'Si tu supprimes l’icône de l’écran d’accueil, ses données sont effacées. Exporte une sauvegarde de temps en temps (Fichiers, iCloud Drive…).')}`,
    });
  }
  ACTIONS['install-guide'] = () => openInstallGuide();
  ACTIONS['hide-install'] = () => { state.meta.installHintHidden = true; save(); render(); };

  /* ---------- Écran de démarrage et formulaire du profil ---------- */
  function renderOnboarding() {
    return `
      <div class="onb-hero">
        <div class="onb-logo">${icon('flame')}</div>
        <h1>MacroSèche</h1>
        <p>Calcule tes objectifs de sèche et suis tes repas. Tout reste sur ton téléphone : pas de compte, pas de serveur.</p>
      </div>
      ${bootWarning ? banner('bad', 'info', 'Problème de données', bootWarning) : ''}
      ${installHintBanner(true)}
      <div id="onb-step"></div>
      <div class="center" style="margin-top:18px">
        <button class="link-btn" type="button" data-action="import-backup">J’ai déjà une sauvegarde : l’importer</button>
      </div>
      <p class="disclaimer">Les calculs sont des estimations et ne remplacent pas un avis médical.</p>`;
  }
  function mountOnboarding() {
    const box = $('#onb-step');
    if (!box) return;
    if (ui.onbResult && ui.onbDraft) { renderOnbResult(box); return; }
    mountProfileForm(box, ui.onbDraft, 'Calculer mes objectifs', (profile) => {
      ui.onbDraft = profile;
      ui.onbResult = true;
      render();
      window.scrollTo(0, 0);
    });
  }
  function renderOnbResult(box) {
    const p = ui.onbDraft;
    const t = computeTargets(p, state.settings);
    box.innerHTML = `
      <h2 class="section-title">Tes objectifs quotidiens</h2>
      <div class="card">
        <div class="result-big">
          ${statTile('Calories', fmt(t.kcal), 'kcal')}
          ${statTile('Protéines', fmt(t.prot), 'g')}
          ${statTile('Glucides', fmt(t.gluc), 'g')}
          ${statTile('Lipides', fmt(t.lip), 'g')}
        </div>
        <p class="card-sub" style="margin-top:10px">Fibres ${fmt(t.fib)} g · Eau ≈ ${fmtL(t.water)} L (+ 0,5 L les jours d’entraînement)</p>
      </div>
      ${warningsHTML(warningsFor(p, state.settings, {}))}
      <h2 class="section-title">Détail du calcul</h2>
      <div class="card calc-detail">${calcDetailHTML(p, t, state.settings)}</div>
      <p class="section-note">Tu pourras tout modifier ensuite dans Réglages (profil, objectifs, repas).</p>
      <div class="btn-row" style="margin-top:16px">
        <button class="btn" type="button" data-action="onb-back">Modifier</button>
        <button class="btn btn-primary" type="button" data-action="onb-start">C’est parti</button>
      </div>`;
  }
  ACTIONS['onb-back'] = () => { ui.onbResult = false; render(); window.scrollTo(0, 0); };
  ACTIONS['onb-start'] = () => {
    const p = ui.onbDraft;
    if (!p) return;
    const today = todayKey();
    state.profile = p;
    state.settings.trainingDays = defaultTrainingDays(p.sessions);
    if (!isNum(state.weights[today])) state.weights[today] = p.weight;
    state.meta.profileUpdatedAt = new Date().toISOString();
    ui.onbDraft = null;
    ui.onbResult = false;
    ui.tab = 'today';
    ui.day = today;
    save();
    render();
    window.scrollTo(0, 0);
    toast('Profil enregistré. Bonne sèche ! 💪');
  };

  function profileFormHTML(p, submitLabel) {
    const v = p || {};
    const sex = v.sex || 'h';
    const rate = v.rate || 0.75;
    const act = v.activity || 'modere';
    return `
      <form data-role="profile-form" novalidate>
        <h2 class="section-title">Toi</h2>
        <div class="form-list">
          <div class="field"><span class="field-label">Sexe</span>
            <div class="seg seg-inline" data-seg="sex">${[['h', 'Homme'], ['f', 'Femme']].map(([k, l]) => `<button type="button" data-v="${k}" class="${sex === k ? 'active' : ''}">${l}</button>`).join('')}</div>
          </div>
          ${numField('age', 'Âge', 'ans', v.age, { placeholder: '30', mode: 'numeric', dec: 0 })}
          ${numField('height', 'Taille', 'cm', v.height, { placeholder: '178', mode: 'numeric' })}
          ${numField('weight', 'Poids actuel', 'kg', v.weight, { placeholder: '82,5' })}
          ${numField('bodyFat', 'Masse grasse', '%', v.bodyFat, { placeholder: '–', sub: 'facultatif, rend le calcul plus précis' })}
        </div>
        <h2 class="section-title">Activité</h2>
        <div class="form-list">
          <div class="field field-col">
            <span class="field-label">Niveau d’activité (hors séances : métier, déplacements…)</span>
            <select class="input" name="activity" style="margin-top:8px" aria-label="Niveau d’activité">
              ${ACTIVITY_LEVELS.map((a) => `<option value="${a.id}" ${a.id === act ? 'selected' : ''}>${a.label} (× ${fmt(a.factor, 3)}) – ${a.desc}</option>`).join('')}
            </select>
          </div>
          ${numField('sessions', 'Séances par semaine', '', isNum(v.sessions) ? v.sessions : null, { placeholder: '3', mode: 'numeric', dec: 0 })}
        </div>
        <h2 class="section-title">Objectif</h2>
        <div class="form-list">
          ${numField('goalWeight', 'Poids objectif', 'kg', v.goalWeight, { placeholder: '75' })}
          <div class="field field-col">
            <span class="field-label">Rythme de perte visé (par semaine)</span>
            <div class="seg" data-seg="rate" style="margin-top:8px">${RATES.map((r) => `<button type="button" data-v="${r}" class="${rate === r ? 'active' : ''}">${fmt(r, 2)} %</button>`).join('')}</div>
            <span class="field-hint" data-role="rate-hint"></span>
          </div>
        </div>
        <p class="field-hint">0,5 % : le plus doux pour garder le muscle · 0,75 % : bon compromis · 1 % : rapide, à réserver si tu as beaucoup de gras à perdre.</p>
        <div class="field-error" data-role="err" hidden></div>
        <button class="btn btn-primary btn-block" type="submit" style="margin-top:16px">${esc(submitLabel)}</button>
      </form>`;
  }

  function mountProfileForm(box, profile, submitLabel, onSubmit) {
    box.innerHTML = profileFormHTML(profile, submitLabel);
    const form = $('[data-role="profile-form"]', box);
    const segVal = (name) => {
      const b = $(`[data-seg="${name}"] button.active`, form);
      return b ? b.dataset.v : null;
    };
    const updateHint = () => {
      const w = parseNum(form.elements.weight.value);
      const r = parseFloat(segVal('rate'));
      $('[data-role="rate-hint"]', form).textContent = isNum(w) && w > 0 && isNum(r) ? `≈ ${fmt(w * r / 100, 2)} kg par semaine` : '';
    };
    form.addEventListener('click', (ev) => {
      const b = ev.target.closest('[data-seg] button');
      if (!b) return;
      ev.preventDefault();
      $$('button', b.parentElement).forEach((x) => x.classList.toggle('active', x === b));
      updateHint();
    });
    form.addEventListener('input', updateHint);
    form.addEventListener('submit', (ev) => {
      ev.preventDefault();
      const res = readProfileForm(form, segVal);
      const err = $('[data-role="err"]', form);
      if (res.error) {
        err.textContent = res.error;
        err.hidden = false;
        const f = res.field && form.elements[res.field];
        if (f) { f.classList.add('invalid'); f.focus(); }
        return;
      }
      err.hidden = true;
      onSubmit(res.profile);
    });
    updateHint();
  }

  function readProfileForm(form, segVal) {
    const raw = (n) => form.elements[n].value.trim();
    const num = (n) => parseNum(raw(n));
    $$('.invalid', form).forEach((x) => x.classList.remove('invalid'));
    const age = num('age');
    const height = num('height');
    const weight = num('weight');
    const bf = raw('bodyFat') === '' ? null : num('bodyFat');
    const sessions = raw('sessions') === '' ? 3 : num('sessions');
    const goal = num('goalWeight');
    if (!isNum(age) || age < 14 || age > 100) return { error: 'Indique ton âge (entre 14 et 100 ans).', field: 'age' };
    if (!isNum(height) || height < 120 || height > 230) return { error: 'Indique ta taille en centimètres (ex. : 178).', field: 'height' };
    if (!isNum(weight) || weight < 30 || weight > 300) return { error: 'Indique ton poids en kg (ex. : 82,5).', field: 'weight' };
    if (raw('bodyFat') !== '' && (!isNum(bf) || bf < 3 || bf > 60)) return { error: 'Masse grasse : entre 3 et 60 %, ou laisse le champ vide.', field: 'bodyFat' };
    if (!isNum(sessions) || sessions < 0 || sessions > 14) return { error: 'Séances par semaine : entre 0 et 14.', field: 'sessions' };
    if (!isNum(goal) || goal < 30 || goal > 300) return { error: 'Indique ton poids objectif en kg (ex. : 75).', field: 'goalWeight' };
    return {
      profile: {
        sex: segVal('sex') === 'f' ? 'f' : 'h',
        age: Math.round(age),
        height: round(height, 1),
        weight: round(weight, 1),
        bodyFat: bf == null ? null : round(bf, 1),
        activity: form.elements.activity.value,
        sessions: Math.round(sessions),
        goalWeight: round(goal, 1),
        rate: parseFloat(segVal('rate')) || 0.75,
      },
    };
  }

  /** Détail lisible de chaque étape du calcul des objectifs. */
  function calcDetailHTML(p, t, s) {
    const male = p.sex !== 'f';
    const bmrLine = t.formula === 'katch'
      ? `<p>Formule de <b>Katch-McArdle</b> (tu as indiqué ta masse grasse) :</p>
         <div class="formula">masse maigre = ${fmt(p.weight, 1)} × (1 − ${fmt(p.bodyFat, 1)} %) = ${fmt(t.lbm, 1)} kg<br>370 + 21,6 × ${fmt(t.lbm, 1)} = ${fmt(t.bmr)} kcal</div>`
      : `<p>Formule de <b>Mifflin-St Jeor</b> (${male ? 'homme' : 'femme'}) :</p>
         <div class="formula">10 × ${fmt(p.weight, 1)} + 6,25 × ${fmt(p.height, 1)} − 5 × ${fmt(p.age)} ${male ? '+ 5' : '− 161'} = ${fmt(t.bmr)} kcal</div>`;
    return `
      <h4>1. Métabolisme de base</h4>${bmrLine}
      <h4>2. Dépense totale (TDEE)</h4>
      <div class="formula">${fmt(t.bmr)} × ${fmt(t.act.factor, 3)} (${esc(t.act.label)}) = ${fmt(t.tdee)} kcal</div>
      <h4>3. Déficit</h4>
      <p>Rythme visé : ${fmt(p.rate, 2)} % du poids par semaine = ${fmt(t.weeklyLossKg, 2)} kg (1 kg de gras ≈ 7 700 kcal).</p>
      <div class="formula">${fmt(t.weeklyLossKg, 2)} × 7 700 ÷ 7 = ${fmt(t.wantedDeficit)} kcal par jour</div>
      <p>Plafond : 25 % de la dépense = ${fmt(t.maxDeficit)} kcal. Déficit retenu : <b>${fmt(t.deficit)} kcal</b>${t.capped ? ' (plafonné)' : ''}.</p>
      <div class="formula">${fmt(t.tdee)} − ${fmt(t.deficit)} ≈ ${fmt(t.kcal)} kcal par jour</div>
      <h4>4. Macros</h4>
      ${t.useGoal ? `<p>Surpoids important (IMC ${fmt(t.bmi, 1)}${isNum(p.bodyFat) ? `, masse grasse ${fmt(p.bodyFat, 1)} %` : ''}) : protéines et lipides calculés sur ton <b>poids objectif</b> (${fmt(t.refWeight, 1)} kg).</p>` : ''}
      <div class="formula">Protéines : ${fmt(s.proteinPerKg, 2)} g × ${fmt(t.refWeight, 1)} kg = ${fmt(t.prot)} g (${fmt(t.prot * 4)} kcal)<br>Lipides : ${fmt(Math.max(0.6, s.fatPerKg), 2)} g × ${fmt(t.refWeight, 1)} kg = ${fmt(t.lip)} g (${fmt(t.lip * 9)} kcal)<br>Glucides : (${fmt(t.kcal)} − ${fmt(t.prot * 4)} − ${fmt(t.lip * 9)}) ÷ 4 = ${fmt(t.gluc)} g</div>
      <p>1 g de protéines ou de glucides = 4 kcal, 1 g de lipides = 9 kcal. Les lipides ne descendent jamais sous 0,6 g/kg.</p>
      <h4>5. Fibres et eau</h4>
      <p>Fibres : ${fmt(t.fib)} g par jour. Eau : ${fmt(s.waterPerKg)} ml × ${fmt(p.weight, 1)} kg ≈ ${fmtL(t.water)} L, + 0,5 L les jours d’entraînement.</p>`;
  }

  /* ===========================================================================
     ONGLET « AUJOURD'HUI » (journal)
     ========================================================================= */

  function renderToday() {
    const key = ui.day;
    const today = todayKey();
    const goals = dayGoals(key);
    const tot = dayTotals(key);
    return `
      <header class="topbar daynav">
        <button class="icon-btn" type="button" data-action="day-prev" aria-label="Jour précédent">${icon('chev-left')}</button>
        <div class="day-title">
          <span class="day-main">${esc(dayLabel(key))}</span>
          <span class="day-sub">${esc(fmtDate(key, 'full'))}</span>
          <input class="day-input" type="date" value="${key}" data-change="day-pick" aria-label="Choisir une date">
        </div>
        <button class="icon-btn" type="button" data-action="day-next" aria-label="Jour suivant">${icon('chev-right')}</button>
      </header>
      ${key !== today ? `<div class="back-today"><button class="chip" type="button" data-action="day-today">${icon('chev-left', 'ic-s')} Revenir à aujourd’hui</button></div>` : ''}
      ${summaryCard(goals, tot)}
      ${todayBanners(key)}
      ${isLogged(key) ? '' : `<p class="section-note center" style="margin-top:14px">Journée vide : touche <b>＋</b> pour ajouter ton premier aliment${isLogged(addDays(key, -1)) ? ', ou copie la journée précédente (en bas)' : ''}.</p>`}
      ${mealsHTML(key)}
      ${trackerCard(key, goals)}
      ${proteinDistribution(key)}
      ${dayActions(key)}
      <p class="disclaimer">Estimations indicatives : elles ne remplacent pas un avis médical.</p>`;
  }

  function summaryCard(g, tot) {
    const remaining = g.kcal - tot.kcal;
    const over = remaining < 0;
    const ratio = g.kcal > 0 ? clamp(tot.kcal / g.kcal, 0, 1) : 0;
    const C = 2 * Math.PI * 52;
    const pills = [];
    if (g.dietBreak) pills.push(`<span class="pill-day">${icon('info')}Pause diète</span>`);
    if (g.training) pills.push(`<span class="pill-day">${icon('dumbbell')}Entraînement${state.settings.carbCycling && g.delta && !g.dietBreak ? ` · ${fmtSigned(g.delta)} kcal` : ''}</span>`);
    else if (state.settings.carbCycling && g.delta && !g.dietBreak) pills.push(`<span class="pill-day">Repos · ${fmtSigned(g.delta)} kcal</span>`);
    return `
      <section class="card">
        <div class="summary">
          <div class="ring-wrap" role="img" aria-label="${esc(`${fmt(tot.kcal)} kcal consommées sur ${fmt(g.kcal)}`)}">
            <svg class="ring" viewBox="0 0 120 120" aria-hidden="true">
              <circle class="ring-track" cx="60" cy="60" r="52"/>
              ${tot.kcal > 0 ? `<circle class="ring-val ${over ? 'over' : ''}" cx="60" cy="60" r="52" stroke-dasharray="${C.toFixed(2)}" stroke-dashoffset="${(C * (1 - (over ? 1 : ratio))).toFixed(2)}"/>` : ''}
            </svg>
            <div class="ring-center">
              <span class="ring-num">${fmt(Math.abs(remaining))}</span>
              <span class="ring-label">${over ? 'kcal au-dessus de l’objectif' : 'kcal restantes'}</span>
            </div>
          </div>
          <div class="summary-stats">
            <div class="sstat"><span>Objectif</span><b>${fmt(g.kcal)} kcal</b></div>
            <div class="sstat"><span>Consommé</span><b>${fmt(tot.kcal)} kcal</b></div>
            ${pills.join('')}
          </div>
        </div>
        <div class="macro-bars">${MACROS.map((m) => macroBar(m, tot[m.key], g[m.key])).join('')}</div>
      </section>`;
  }

  function macroBar(m, val, goal) {
    const pct = goal > 0 ? clamp(val / goal * 100, 0, 100) : 0;
    return `
      <div class="mbar">
        <div class="mbar-head"><span class="lbl"><i class="dot bg-${m.key}"></i>${m.label}</span><span class="val"><b>${fmtG(val)}</b> / ${fmt(goal)} g</span></div>
        <div class="mbar-track" role="progressbar" aria-label="${m.label}" aria-valuemin="0" aria-valuemax="${Math.round(goal)}" aria-valuenow="${Math.round(val)}"><div class="mbar-fill bg-${m.key}" style="width:${pct.toFixed(1)}%"></div></div>
      </div>`;
  }

  function backupDue() {
    const today = todayKey();
    if (state.meta.backupSnoozeUntil && today < state.meta.backupSnoozeUntil) return false;
    const hasData = Object.keys(state.days).some(isLogged) || Object.keys(state.weights).length > 1;
    if (!hasData) return false;
    const last = state.meta.lastBackupAt ? keyFromIso(state.meta.lastBackupAt) : keyFromIso(state.createdAt);
    return !last || diffDays(last, today) > BACKUP_REMINDER_DAYS;
  }

  function todayBanners(key) {
    const out = [];
    if (bootWarning) out.push(banner('bad', 'info', 'Problème de données', bootWarning));
    out.push(installHintBanner(false));
    const db = activeDietBreak(key);
    if (db) {
      out.push(banner('good', 'info', 'Pause diète en cours',
        `Jusqu’au ${fmtDate(db.end, 'long')} : objectif au maintien (${fmt(db.kcal)} kcal). Garde tes protéines et ton entraînement.`,
        '<button class="btn btn-small" data-action="end-diet-break">Terminer la pause</button>'));
    }
    if (backupDue()) {
      out.push(banner('warn', 'share', 'Pense à sauvegarder',
        state.meta.lastBackupAt ? `Dernière sauvegarde ${daysAgoText(state.meta.lastBackupAt)}. Tes données n’existent que sur ce téléphone.` : 'Tu n’as encore jamais sauvegardé. Tes données n’existent que sur ce téléphone.',
        '<button class="btn btn-small btn-primary" data-action="export-json">Sauvegarder</button><button class="btn btn-small" data-action="snooze-backup">Plus tard</button>'));
    }
    if (key === todayKey()) out.push(coachNudge());
    return out.join('');
  }

  function coachNudge() {
    const today = todayKey();
    if (state.coach.snoozeUntil && today < state.coach.snoozeUntil) return '';
    if (activeDietBreak(today)) return '';   // pas de proposition pendant une pause diète
    const actions = '<button class="btn btn-small btn-primary" data-action="coach-view">Voir</button><button class="btn btn-small" data-action="coach-later">Plus tard</button>';
    if (plateauCheck()) return banner('warn', 'coach', 'Plateau détecté', 'Ton poids moyen ne baisse plus depuis 14 jours. Le coach te propose des solutions.', actions);
    const c = coachAnalysis();
    if (c.ready && !c.suspicious && Math.abs(c.diff) >= 50) {
      return banner('info', 'coach', 'Le coach a une proposition', `D’après tes dernières semaines, vise ${fmt(c.suggested)} kcal par jour au lieu de ${fmt(c.current)}.`, actions);
    }
    return '';
  }

  /** Repas affichés : ceux qui sont actifs + ceux masqués qui contiennent des aliments ce jour-là. */
  function mealsForDay(key) {
    const day = state.days[key];
    const entries = day ? day.entries : [];
    const known = new Set(state.settings.meals.map((m) => m.id));
    const list = state.settings.meals.filter((m) => !m.hidden || entries.some((e) => e.meal === m.id));
    const orphans = Array.from(new Set(entries.filter((e) => !known.has(e.meal)).map((e) => e.meal)));
    orphans.forEach((id) => list.push({ id, name: 'Autre', time: '23:59', hidden: false, orphan: true }));
    return list;
  }

  function mealsHTML(key) {
    const day = state.days[key];
    return mealsForDay(key).map((m) => {
      const entries = day ? day.entries.filter((e) => e.meal === m.id) : [];
      const t = sumNutri(entries);
      return `
        <section class="card meal">
          <div class="meal-head">
            <div class="grow">
              <h3 class="meal-name">${esc(m.name)}</h3>
              <div class="meal-macros">${entries.length ? `P ${fmtG(t.prot)} · G ${fmtG(t.gluc)} · L ${fmtG(t.lip)} g` : 'Aucun aliment'}</div>
            </div>
            <div class="meal-kcal">${fmt(t.kcal)} <small>kcal</small></div>
            <button class="icon-btn plain" type="button" data-action="meal-menu" data-meal="${esc(m.id)}" aria-label="Options : ${esc(m.name)}">${icon('more')}</button>
          </div>
          ${entries.length ? `<ul class="entries">${entries.map(entryRow).join('')}</ul>` : ''}
          <button class="meal-add" type="button" data-action="add-food" data-meal="${esc(m.id)}">${icon('plus')} Ajouter</button>
        </section>`;
    }).join('');
  }

  function entryRow(e) {
    return `<li><button class="entry" type="button" data-action="entry-edit" data-id="${esc(e.id)}">
      <div class="entry-main">
        <div class="entry-name">${esc(e.name)}</div>
        <div class="entry-sub">${esc(entryQtyText(e))} · P ${fmtG(e.n.prot)} · G ${fmtG(e.n.gluc)} · L ${fmtG(e.n.lip)}</div>
      </div>
      <div class="entry-kcal">${fmt(e.n.kcal)}</div>
    </button></li>`;
  }

  function trackerCard(key, g) {
    const day = state.days[key] || { water: 0, steps: null };
    const water = day.water || 0;
    const wPct = g.water > 0 ? clamp(water / g.water * 100, 0, 100) : 0;
    const weight = state.weights[key];
    return `
      <h2 class="section-title">Suivi du jour</h2>
      <section class="card">
        <div class="water-block">
          <div class="row-between">
            <div class="row"><span class="track-ico water">${icon('drop')}</span><span class="strong">Eau</span></div>
            <span class="muted"><b class="num water-val">${fmtL(water)}</b> / ${fmtL(g.water)} L</span>
          </div>
          <div class="water-bar" role="progressbar" aria-label="Eau" aria-valuemin="0" aria-valuemax="${g.water}" aria-valuenow="${water}"><i style="width:${wPct.toFixed(1)}%"></i></div>
          <div class="water-btns">
            <button class="btn btn-small btn-minus" type="button" data-action="water" data-ml="-250" aria-label="Retirer 250 ml" ${water <= 0 ? 'disabled' : ''}>${icon('minus')}</button>
            <button class="btn btn-small btn-tinted" type="button" data-action="water" data-ml="250">+250 ml</button>
            <button class="btn btn-small btn-tinted" type="button" data-action="water" data-ml="500">+500 ml</button>
          </div>
        </div>
        <label class="track-row">
          <span class="track-ico">${icon('steps')}</span>
          <span class="grow">Pas<span class="track-sub">Objectif ${fmt(state.settings.stepsGoal)}</span></span>
          <input class="input input-wide num" type="text" inputmode="numeric" enterkeyhint="done" placeholder="0" autocomplete="off" value="${isNum(day.steps) ? day.steps : ''}" data-change="steps" aria-label="Nombre de pas">
        </label>
        <label class="track-row">
          <span class="track-ico">${icon('scale')}</span>
          <span class="grow">Pesée<span class="track-sub">Le matin, à jeun</span></span>
          <input class="input input-num" type="text" inputmode="decimal" enterkeyhint="done" placeholder="kg" autocomplete="off" value="${fmtInput(weight, 1)}" data-change="weight-day" aria-label="Poids du jour en kg">
          <span class="input-unit">kg</span>
        </label>
        <label class="track-row">
          <span class="track-ico">${icon('dumbbell')}</span>
          <span class="grow">Jour d’entraînement<span class="track-sub">${state.settings.carbCycling ? 'Plus de glucides ce jour-là' : '+ 0,5 L d’eau'}</span></span>
          <input class="switch" type="checkbox" ${g.training ? 'checked' : ''} data-change="training" aria-label="Jour d’entraînement">
        </label>
      </section>`;
  }

  /** Répartition des protéines : idéalement 3 à 5 prises de 25 à 40 g. */
  function proteinDistribution(key) {
    const day = state.days[key];
    if (!day || !day.entries.length) return '';
    const rows = mealsForDay(key)
      .map((m) => ({ m, p: sumNutri(day.entries.filter((e) => e.meal === m.id)).prot }))
      .filter((x) => x.p > 0);
    if (!rows.length) return '';
    const max = Math.max(50, Math.max.apply(null, rows.map((x) => x.p)));
    const good = rows.filter((x) => x.p >= 25).length;
    const big = rows.filter((x) => x.p > 45);
    let tip;
    if (good >= 3 && good <= 5) tip = `${good} prises de 25 g ou plus : parfait pour préserver ton muscle.`;
    else if (good > 5) tip = `${good} prises de 25 g ou plus : plus que nécessaire, mais ce n’est pas un problème.`;
    else tip = `${good} prise${good > 1 ? 's' : ''} de 25 g ou plus. Vise 3 à 5 prises de 25 à 40 g (skyr, œufs, viande, poisson, whey…).`;
    if (big.length && good < 3) tip += ` Astuce : déplace une partie des ${fmt(big[0].p)} g du repas « ${big[0].m.name} » vers un autre repas.`;
    return `
      <h2 class="section-title">Répartition des protéines</h2>
      <section class="card">
        <div class="pdist">
          ${rows.map((x) => `
            <div class="pdist-row">
              <span class="pdist-name">${esc(x.m.name)}</span>
              <span class="pdist-val">${fmt(x.p)} g</span>
              <div class="pdist-track" aria-hidden="true">
                <div class="pdist-zone" style="left:${(25 / max * 100).toFixed(1)}%;width:${(15 / max * 100).toFixed(1)}%"></div>
                <div class="pdist-fill" style="width:${clamp(x.p / max * 100, 0, 100).toFixed(1)}%"></div>
              </div>
            </div>`).join('')}
        </div>
        <div class="pdist-legend"><i></i>zone idéale : 25 à 40 g par prise</div>
        <p class="card-sub" style="margin-top:8px">${good >= 3 && good <= 5 ? icon('check', 'ic-s good') + ' ' : ''}${esc(tip)}</p>
      </section>`;
  }

  function dayActions(key) {
    const prev = addDays(key, -1);
    const has = isLogged(prev);
    const label = key === todayKey() ? 'Copier toute la journée d’hier' : 'Copier la journée précédente';
    return `
      <div class="list" style="margin-top:12px">
        <button class="list-item" type="button" data-action="copy-day" ${has ? '' : 'disabled'}>
          <span class="li-ico">${icon('copy')}</span>
          <span class="li-main"><span class="li-title">${label}</span><span class="li-sub">${has ? `${state.days[prev].entries.length} aliment(s) · ${fmt(dayTotals(prev).kcal)} kcal` : 'Rien à copier'}</span></span>
        </button>
      </div>`;
  }

  /* ---------- Actions du journal ---------- */
  ACTIONS.tab = (el) => switchTab(el.dataset.tab);
  ACTIONS['day-prev'] = () => { ui.day = addDays(ui.day, -1); render(); };
  ACTIONS['day-next'] = () => { ui.day = addDays(ui.day, 1); render(); };
  ACTIONS['day-today'] = () => { ui.day = todayKey(); render(); };
  CHANGES['day-pick'] = (el) => { if (isKey(el.value)) { ui.day = el.value; render(); } };
  // Sur ordinateur, un clic sur la date ouvre le calendrier (sur iPhone c'est automatique).
  document.addEventListener('click', (ev) => {
    const el = ev.target.closest('.day-input');
    if (el && typeof el.showPicker === 'function') { try { el.showPicker(); } catch (e) { /* déjà ouvert */ } }
  });

  ACTIONS['add-food'] = (el) => {
    if (!state.profile) return;
    if (ui.tab !== 'today') { ui.day = todayKey(); switchTab('today'); }
    openAddSheet(el.dataset.meal || null);
  };

  ACTIONS.water = (el) => {
    const ml = parseInt(el.dataset.ml, 10) || 0;
    const day = getDay(ui.day, true);
    day.water = Math.max(0, (day.water || 0) + ml);
    save();
    render();
  };

  CHANGES.steps = (el) => {
    const day = getDay(ui.day, true);
    const raw = el.value.trim();
    const v = parseNum(raw);
    if (raw === '') day.steps = null;
    else if (!isNum(v) || v < 0 || v > 200000) {
      toast('Nombre de pas invalide', { error: true });
      el.value = isNum(day.steps) ? day.steps : '';
      return;
    } else day.steps = Math.round(v);
    save();
    render();
  };

  CHANGES['weight-day'] = (el) => {
    const raw = el.value.trim();
    if (raw === '') { delete state.weights[ui.day]; save(); render(); return; }
    const v = parseNum(raw);
    if (!isNum(v) || v < 25 || v > 350) {
      toast('Poids invalide (exemple : 82,4)', { error: true });
      el.value = fmtInput(state.weights[ui.day], 1);
      return;
    }
    state.weights[ui.day] = round(v, 2);
    save();
    render();
    toast(`Pesée enregistrée : ${fmt(v, 1)} kg`);
  };

  CHANGES.training = (el) => {
    const day = getDay(ui.day, true);
    const scheduled = state.settings.trainingDays.indexOf(weekdayOf(ui.day)) >= 0;
    day.training = el.checked === scheduled ? null : el.checked;
    save();
    render();
  };

  ACTIONS['entry-edit'] = (el) => {
    const day = state.days[ui.day];
    const e = day && day.entries.find((x) => x.id === el.dataset.id);
    if (!e) return;
    if (!e.per100 || !isNum(e.qty)) openQuickAdd({ entry: e });
    else openQtySheet(foodForEdit(e), { entry: e });
  };

  ACTIONS['meal-menu'] = (el) => openMealMenu(el.dataset.meal);

  function openMealMenu(mealId) {
    const key = ui.day;
    const prev = addDays(key, -1);
    const day = state.days[key];
    const entries = day ? day.entries.filter((e) => e.meal === mealId) : [];
    const prevEntries = state.days[prev] ? state.days[prev].entries.filter((e) => e.meal === mealId) : [];
    const sheet = openSheet({
      title: mealName(mealId),
      body: `
        <div class="list" style="margin-top:6px">
          <button class="list-item" type="button" data-act="copy-prev" ${prevEntries.length ? '' : 'disabled'}>
            <span class="li-ico">${icon('copy')}</span>
            <span class="li-main"><span class="li-title">Copier le même repas de la veille</span><span class="li-sub">${prevEntries.length ? `${prevEntries.length} aliment(s) · ${fmt(sumNutri(prevEntries).kcal)} kcal` : 'Rien la veille pour ce repas'}</span></span>
          </button>
          <button class="list-item" type="button" data-act="save-meal" ${entries.length ? '' : 'disabled'}>
            <span class="li-ico">${icon('star')}</span>
            <span class="li-main"><span class="li-title">Enregistrer comme repas type</span><span class="li-sub">Pour l’ajouter ensuite en un seul geste</span></span>
          </button>
          <button class="list-item li-danger" type="button" data-act="clear" ${entries.length ? '' : 'disabled'}>
            <span class="li-ico">${icon('trash')}</span>
            <span class="li-main"><span class="li-title">Vider ce repas</span></span>
          </button>
        </div>`,
    });
    sheet.el.addEventListener('click', (ev) => {
      const b = ev.target.closest('[data-act]');
      if (!b || b.disabled) return;
      if (b.dataset.act === 'copy-prev') {
        sheet.close();
        copyEntries(prevEntries, key, mealId, 'Repas de la veille copié');
      } else if (b.dataset.act === 'save-meal') {
        saveMealTemplate(entries, `${mealName(mealId)} du ${fmtDate(key, 'short')}`).then((ok) => { if (ok) sheet.close(); });
      } else if (b.dataset.act === 'clear') {
        sheet.close();
        const d = state.days[key];
        const before = d.entries.slice();
        d.entries = d.entries.filter((e) => e.meal !== mealId);
        save();
        render();
        toast('Repas vidé', { action: 'Annuler', onAction: () => { d.entries = before; save(); render(); } });
      }
    });
  }

  /** Copie des aliments (repas ou journée) vers une journée, avec possibilité d'annuler. */
  function copyEntries(src, key, mealId, msg) {
    if (!src.length) return;
    const day = getDay(key, true);
    const before = day.entries.slice();
    const now = Date.now();
    src.forEach((e, i) => {
      day.entries.push(Object.assign(cloneData(e), { id: uid('e'), meal: mealId || e.meal, t: now + i }));
    });
    save();
    render();
    toast(msg, { action: 'Annuler', onAction: () => { day.entries = before; save(); render(); } });
  }

  ACTIONS['copy-day'] = () => {
    const key = ui.day;
    const prev = addDays(key, -1);
    const src = state.days[prev] ? state.days[prev].entries : [];
    if (!src.length) return;
    if (!isLogged(key)) { copyEntries(src, key, null, 'Journée copiée'); return; }
    confirmDialog({
      title: 'Ajouter la journée précédente ?',
      message: 'Ses aliments seront ajoutés à ceux déjà saisis aujourd’hui.',
      ok: 'Ajouter',
    }).then((ok) => { if (ok) copyEntries(src, key, null, 'Journée copiée'); });
  };

  /** Enregistre des entrées comme « repas type » réutilisable. */
  function saveMealTemplate(entries, defaultName) {
    return promptDialog({ title: 'Nom du repas type', message: 'Tu le retrouveras dans « Ajouter » › Repas types.', value: defaultName, ok: 'Enregistrer' })
      .then((name) => {
        if (name == null) return false;
        const items = entries.map((e) => {
          const c = cloneData(e);
          delete c.id; delete c.meal; delete c.t;
          return c;
        });
        state.savedMeals.unshift({ id: uid('r'), name: (name || defaultName).slice(0, 40), items });
        save();
        toast('Repas type enregistré');
        return true;
      });
  }

  /** Ajoute une entrée au journal du jour affiché, avec possibilité d'annuler. */
  function addEntry(entry, opts) {
    const key = ui.day;
    getDay(key, true).entries.push(entry);
    if (entry.ref && entry.ref.indexOf('o:') === 0) touchOff(entry.ref.slice(2));
    save();
    render();
    const when = key === todayKey() ? '' : ` (${dayLabel(key).toLowerCase()})`;
    toast(`Ajouté à ${mealName(entry.meal)}${when} · ${fmt(entry.n.kcal)} kcal`, {
      action: 'Annuler',
      onAction: () => {
        const d = state.days[key];
        if (d) d.entries = d.entries.filter((x) => x.id !== entry.id);
        save();
        render();
      },
    });
    if (opts && typeof opts.onAdded === 'function') opts.onAdded(entry);
  }

  /* ===========================================================================
     6. AJOUT D'ALIMENTS : recherche, récents, favoris, quantité, ajout rapide
     ========================================================================= */

  function foodRowHTML(f, attrs) {
    const p = f.per100;
    const per = f.unit === 'ml' ? '100 ml' : '100 g';
    const fav = isFav(f.ref) ? '<svg class="food-fav" aria-label="favori"><use href="#i-star"/></svg> ' : '';
    const src = f.source === 'custom' ? '<span class="src">perso</span>' : f.source === 'off' ? '<span class="src">OFF</span>' : '';
    return `<div class="food-row"><button class="food-open" type="button" ${attrs}>
      <span class="food-ico" aria-hidden="true">${catInfo(f.cat).icon}</span>
      <span class="food-main">
        <span class="food-name">${fav}${esc(f.name)}${f.brand ? ` <span class="muted">· ${esc(f.brand)}</span>` : ''}${src}</span>
        <span class="food-meta">${fmt(p.kcal)} kcal · P ${fmtG(p.prot)} · G ${fmtG(p.gluc)} · L ${fmtG(p.lip)} <span class="faint">/ ${per}</span></span>
      </span>
    </button></div>`;
  }

  function sourceLabel(food) {
    if (food.source === 'custom') return 'Aliment perso';
    if (food.source === 'off') return `Open Food Facts${food.brand ? ' · ' + food.brand : ''}${food.quantity ? ' · ' + food.quantity : ''}`;
    if (food.source === 'entry') return 'Valeurs enregistrées dans ton journal';
    return `${catInfo(food.cat).label} · valeurs moyennes (Ciqual)`;
  }

  function per100Table(food) {
    const u = food.unit === 'ml' ? 'ml' : 'g';
    const p = food.per100;
    const rows = [
      ['Calories', `${fmt(p.kcal)} kcal`],
      ['Protéines', `${fmt(p.prot, 1)} g`],
      ['Glucides', `${fmt(p.gluc, 1)} g`],
    ];
    if (isNum(food.sugars)) rows.push(['dont sucres', `${fmt(food.sugars, 1)} g`]);
    rows.push(['Lipides', `${fmt(p.lip, 1)} g`], ['Fibres', `${fmt(p.fib, 1)} g`]);
    if (isNum(food.salt)) rows.push(['Sel', `${fmt(food.salt, 2)} g`]);
    return `<table class="kv-table" aria-label="Valeurs pour 100 ${u}">${rows.map((r) => `<tr><td>${r[0]}</td><td>${r[1]}</td></tr>`).join('')}</table>`;
  }

  /* ---------- Feuille « Ajouter » ---------- */
  function openAddSheet(mealId) {
    const st = { meal: mealId || guessMeal(), tab: 'recents', q: '', off: null, offQ: '', offLoading: false, offError: '', recents: [], added: 0, addedKcal: 0 };
    const dayTxt = ui.day === todayKey() ? '' : ` · ${dayLabel(ui.day)}`;
    const sheet = openSheet({ title: `Ajouter${dayTxt}`, full: true, closeLabel: 'Terminé', closeEnd: true, onClose: () => render() });
    sheet.setBody(`
      <div class="add-top">
        <div class="chips" data-role="meals">${mealChips(st.meal)}</div>
        <form class="search" data-role="search-form" role="search" action="#">
          ${icon('search')}
          <input type="search" enterkeyhint="search" placeholder="Rechercher un aliment" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" aria-label="Rechercher un aliment" data-role="q">
          <button type="button" class="search-clear" data-act="clear-q" aria-label="Effacer la recherche" hidden>${icon('close', 'ic-s')}</button>
        </form>
      </div>
      <div class="quick-actions">
        <button class="qa-btn" type="button" data-act="scan">${icon('barcode')}Scanner</button>
        <button class="qa-btn" type="button" data-act="quick">${icon('bolt')}Ajout rapide</button>
        <button class="qa-btn" type="button" data-act="create">${icon('plus')}Créer</button>
      </div>
      <div class="add-counter" data-role="counter" hidden></div>
      <div data-role="results"></div>`);
    const qInput = $('[data-role="q"]', sheet.body);
    const clearBtn = $('[data-act="clear-q"]', sheet.body);
    const results = $('[data-role="results"]', sheet.body);
    const counter = $('[data-role="counter"]', sheet.body);

    const onAdded = (entry) => {
      st.added += entry.count || 1;
      st.addedKcal += entry.n.kcal;
      counter.hidden = false;
      counter.textContent = `✓ ${st.added} aliment${st.added > 1 ? 's' : ''} ajouté${st.added > 1 ? 's' : ''} · ${fmt(st.addedKcal)} kcal`;
      if (!st.q) renderResults();
    };
    const itemOpts = () => ({ meal: st.meal, onAdded });

    function renderResults() { results.innerHTML = addResultsHTML(st); }

    async function runOffSearch() {
      const q = st.q;
      if (q.length < 2) return;
      st.offQ = q;
      if (navigator.onLine === false) {
        st.off = null;
        st.offError = 'Hors ligne : la recherche Open Food Facts nécessite une connexion. Utilise l’ajout rapide ou crée l’aliment.';
        renderResults();
        return;
      }
      st.offLoading = true;
      st.offError = '';
      renderResults();
      try {
        const list = await offSearch(q);
        st.off = list;
      } catch (err) {
        st.off = null;
        st.offError = offErrorText(err);
      }
      st.offLoading = false;
      if (st.q === q && !sheet.closed) renderResults();
    }

    qInput.addEventListener('input', () => {
      st.q = qInput.value.trim();
      clearBtn.hidden = !qInput.value;
      renderResults();
    });
    $('[data-role="search-form"]', sheet.body).addEventListener('submit', (ev) => {
      ev.preventDefault();
      qInput.blur();
      if (st.q.length >= 2) runOffSearch();
    });

    sheet.body.addEventListener('click', (ev) => {
      const meal = pickMealChip(ev, sheet.body);
      if (meal) { st.meal = meal; return; }
      const b = ev.target.closest('[data-act]');
      if (!b) return;
      const act = b.dataset.act;
      if (act === 'clear-q') {
        qInput.value = '';
        st.q = '';
        clearBtn.hidden = true;
        renderResults();
        qInput.focus();
      } else if (act === 'tab') {
        st.tab = b.dataset.tab;
        renderResults();
      } else if (act === 'scan') {
        openScanner(itemOpts());
      } else if (act === 'quick') {
        openQuickAdd(itemOpts());
      } else if (act === 'create') {
        openFoodForm({ prefill: { name: st.q }, onSaved: (food) => openQtySheet(food, itemOpts()) });
      } else if (act === 'open') {
        const food = getFood(b.dataset.ref);
        if (food) openQtySheet(food, itemOpts());
      } else if (act === 'open-recent' || act === 'quick-recent') {
        const e = st.recents.find((x) => x.id === b.dataset.id);
        const food = e && foodFromEntry(e);
        if (!food) return;
        if (act === 'open-recent') openQtySheet(food, Object.assign(itemOpts(), { defaults: { qty: e.qty, portion: e.portion } }));
        else addEntry(makeEntry(food, e.qty, e.portion ? Object.assign({}, e.portion) : null, st.meal), itemOpts());
      } else if (act === 'off-search') {
        runOffSearch();
      } else if (act === 'off-open') {
        const p = st.off && st.off[parseInt(b.dataset.i, 10)];
        if (!p) return;
        storeOffProduct(p);
        openQtySheet(offToFood(state.offFoods[p.code]), itemOpts());
      } else if (act === 'saved-meal') {
        openSavedMeal(b.dataset.id, itemOpts());
      }
    });
    renderResults();
  }

  function addResultsHTML(st) {
    if (st.q) {
      const local = searchFoods(st.q, { limit: 40 });
      let html = local.length
        ? `<div class="food-list">${local.map((f) => foodRowHTML(f, `data-act="open" data-ref="${esc(f.ref)}"`)).join('')}</div>`
        : '<div class="empty"><div class="empty-title">Rien dans ta base d’aliments</div>Essaie un autre mot, ou cherche le produit sur Open Food Facts.</div>';
      if (st.q.length >= 2) html += offSectionHTML(st);
      return html;
    }
    const tabs = [['recents', 'Récents'], ['favs', 'Favoris'], ['meals', 'Repas types']];
    let body;
    if (st.tab === 'favs') {
      const favs = favoriteFoods();
      body = favs.length
        ? `<div class="food-list">${favs.map((f) => foodRowHTML(f, `data-act="open" data-ref="${esc(f.ref)}"`)).join('')}</div>`
        : emptyHTML('star', 'Aucun favori', 'Touche l’étoile sur un aliment pour le retrouver ici.');
    } else if (st.tab === 'meals') {
      body = state.savedMeals.length
        ? `<div class="list" style="margin-top:10px">${state.savedMeals.map((sm) => savedMealRow(sm, 'data-act')).join('')}</div>`
        : emptyHTML('copy', 'Aucun repas type', 'Dans le journal, touche ⋯ sur un repas puis « Enregistrer comme repas type ».');
    } else {
      st.recents = getRecents(30);
      body = st.recents.length
        ? `<div class="food-list">${st.recents.map(recentRowHTML).join('')}</div><p class="field-hint center">Touche ＋ pour ajouter la même quantité en un geste.</p>`
        : emptyHTML('today', 'Pas encore d’aliments récents', 'Tes derniers aliments apparaîtront ici pour les ajouter en 2 touches.');
    }
    return `<div class="seg" style="margin-top:12px">${tabs.map(([id, label]) => `<button type="button" data-act="tab" data-tab="${id}" class="${st.tab === id ? 'active' : ''}">${label}</button>`).join('')}</div>${body}`;
  }

  function recentRowHTML(e) {
    const f = foodFromEntry(e) || { cat: 'divers' };
    return `<div class="food-row">
      <button class="food-open" type="button" data-act="open-recent" data-id="${esc(e.id)}">
        <span class="food-ico" aria-hidden="true">${catInfo(f.cat).icon}</span>
        <span class="food-main">
          <span class="food-name">${esc(e.name)}</span>
          <span class="food-meta">${esc(entryQtyText(e))} · ${fmt(e.n.kcal)} kcal · P ${fmtG(e.n.prot)} g</span>
        </span>
      </button>
      <button class="food-quick" type="button" data-act="quick-recent" data-id="${esc(e.id)}" aria-label="${esc(`Ajouter ${e.name}, ${entryQtyText(e)}`)}"><span>${icon('plus')}</span></button>
    </div>`;
  }

  /** Ligne d'un repas type. attr = 'data-act' (dans une feuille) ou 'data-action' (dans un onglet). */
  function savedMealRow(sm, attr) {
    const t = sumNutri(sm.items);
    return `<button class="list-item" type="button" ${attr === 'data-action' ? 'data-action' : 'data-act'}="saved-meal" data-id="${esc(sm.id)}">
      <span class="li-ico">${icon('copy')}</span>
      <span class="li-main"><span class="li-title">${esc(sm.name)}</span><span class="li-sub">${sm.items.length} aliment(s) · P ${fmtG(t.prot)} g</span></span>
      <span class="li-end">${fmt(t.kcal)} kcal</span>${icon('chev-right', 'li-chev')}
    </button>`;
  }

  function offSectionHTML(st) {
    if (st.offLoading) return '<div class="empty"><span class="spinner"></span><div style="margin-top:8px">Recherche sur Open Food Facts…</div></div>';
    if (st.offQ === st.q && st.offError) return banner('warn', 'info', 'Recherche impossible', st.offError, '<button class="btn btn-small btn-primary" type="button" data-act="off-search">Réessayer</button>');
    if (st.offQ === st.q && st.off) {
      if (!st.off.length) return `<div class="empty">Aucun produit trouvé sur Open Food Facts pour « ${esc(st.q)} ».</div>`;
      return `<h3 class="section-title">Open Food Facts</h3><div class="food-list">${st.off.map((p, i) => foodRowHTML(offToFood(p), `data-act="off-open" data-i="${i}"`)).join('')}</div>
        <p class="field-hint center">Données collaboratives : vérifie avec l’étiquette en cas de doute.</p>`;
    }
    return `<button class="btn btn-tinted btn-block off-search" type="button" data-act="off-search">${icon('search')} Chercher « ${esc(st.q)} » sur Open Food Facts</button>
      <p class="field-hint center">Produits du commerce (marques). Connexion nécessaire.</p>`;
  }

  /* ---------- Feuille « Quantité » ---------- */
  function openQtySheet(food, o) {
    const opts = o || {};
    const edit = opts.entry || null;
    const unitLbl = food.unit === 'ml' ? 'ml' : 'g';
    const portions = (food.portions || []).filter((p) => p.grams > 0).map((p) => ({ label: p.label, grams: p.grams }));
    const st = { meal: edit ? edit.meal : (opts.meal || guessMeal()), mode: -1, value: 100 };
    const def = edit ? { qty: edit.qty, portion: edit.portion } : (opts.defaults || null);
    if (def && def.portion) {
      let idx = portions.findIndex((p) => p.label === def.portion.label && Math.abs(p.grams - def.portion.grams) < 0.01);
      if (idx < 0) { portions.push({ label: def.portion.label, grams: def.portion.grams }); idx = portions.length - 1; }
      st.mode = idx;
      st.value = def.portion.count;
    } else if (def && isNum(def.qty)) {
      st.value = def.qty;
    } else if (portions.length) {
      st.mode = 0;
      st.value = 1;
    }
    const grams = () => (st.mode >= 0 ? st.value * portions[st.mode].grams : st.value);
    const canFav = !!food.ref && food.source !== 'entry';

    const sheet = openSheet({ title: edit ? 'Modifier' : 'Quantité', closeLabel: 'Annuler' });
    sheet.setBody(`
      <div class="qty-head">
        <div class="grow"><div class="qty-name">${esc(food.name)}</div><div class="qty-src">${esc(sourceLabel(food))}</div></div>
        ${canFav ? `<button class="star-btn ${isFav(food.ref) ? 'on' : ''}" type="button" data-act="fav" aria-label="Favori" aria-pressed="${isFav(food.ref)}">${icon('star')}</button>` : ''}
      </div>
      <div class="qty-box">
        <div class="chips" data-role="units"></div>
        <div class="qty-row">
          <button class="icon-btn" type="button" data-act="minus" aria-label="Diminuer">${icon('minus')}</button>
          <label class="qty-input-wrap"><input class="qty-input num" type="text" inputmode="decimal" enterkeyhint="done" autocomplete="off" data-role="qty" aria-label="Quantité"><span class="qty-unit" data-role="unit"></span></label>
          <button class="icon-btn" type="button" data-act="plus" aria-label="Augmenter">${icon('plus')}</button>
        </div>
        <div class="qty-equiv" data-role="equiv"></div>
        <div class="presets" data-role="presets"></div>
      </div>
      <div class="nutri" data-role="nutri"></div>
      <h3 class="section-title">Repas</h3>
      <div class="chips">${mealChips(st.meal)}</div>
      <details class="per100"><summary>Valeurs pour 100 ${unitLbl}</summary>${per100Table(food)}</details>`);
    sheet.setFoot(`<div class="btn-row">${edit ? `<button class="btn btn-danger" type="button" data-act="delete" style="flex:0 0 56px" aria-label="Supprimer">${icon('trash')}</button>` : ''}<button class="btn btn-primary" type="button" data-act="save">${edit ? 'Enregistrer' : 'Ajouter'}</button></div>`);

    const qtyInput = $('[data-role="qty"]', sheet.body);
    const saveBtn = $('[data-act="save"]', sheet.foot);

    function refresh(fromInput) {
      if (!fromInput) qtyInput.value = fmtInput(st.value, 2);
      $('[data-role="units"]', sheet.body).innerHTML = `<button type="button" class="chip ${st.mode === -1 ? 'active' : ''}" data-unit="-1">${unitLbl}</button>`
        + portions.map((p, i) => `<button type="button" class="chip ${st.mode === i ? 'active' : ''}" data-unit="${i}">${esc(p.label)} · ${fmt(p.grams)} ${unitLbl}</button>`).join('');
      $('[data-role="unit"]', sheet.body).textContent = st.mode >= 0 ? `× ${portions[st.mode].label}` : unitLbl;
      const g = grams();
      const valid = isNum(g) && g > 0 && g <= 5000;
      $('[data-role="equiv"]', sheet.body).textContent = st.mode >= 0 && valid ? `= ${fmt(g)} ${unitLbl}` : (valid ? '' : 'Quantité invalide');
      const presets = st.mode >= 0 ? [0.5, 1, 2, 3] : (unitLbl === 'ml' ? [100, 200, 250, 330] : [50, 100, 150, 200]);
      $('[data-role="presets"]', sheet.body).innerHTML = presets.map((v) => `<button type="button" class="chip ${round(st.value, 2) === v ? 'active' : ''}" data-preset="${v}">${st.mode >= 0 ? fmt(v, 1) + ' ×' : fmt(v) + ' ' + unitLbl}</button>`).join('');
      const n = valid ? scaleNutri(food.per100, g) : { kcal: 0, prot: 0, gluc: 0, lip: 0, fib: 0 };
      $('[data-role="nutri"]', sheet.body).innerHTML = `
        <div class="nutri-kcal">${fmt(n.kcal)} <small>kcal</small></div>
        <div class="nutri-grid">${MACROS.map((m) => `<div class="ncell"><i class="dot bg-${m.key}"></i>${m.label}<b>${fmtG(n[m.key])} g</b></div>`).join('')}</div>`;
      saveBtn.disabled = !valid;
    }

    qtyInput.addEventListener('input', () => {
      const v = parseNum(qtyInput.value);
      st.value = isNum(v) ? v : NaN;
      refresh(true);
    });
    qtyInput.addEventListener('focus', () => setTimeout(() => { try { qtyInput.setSelectionRange(0, qtyInput.value.length); } catch (e) { /* ignore */ } }, 0));
    qtyInput.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); qtyInput.blur(); } });

    sheet.el.addEventListener('click', (ev) => {
      const meal = pickMealChip(ev, sheet.body);
      if (meal) { st.meal = meal; return; }
      const unitBtn = ev.target.closest('[data-unit]');
      if (unitBtn) {
        const idx = parseInt(unitBtn.dataset.unit, 10);
        if (idx === -1 && st.mode >= 0) { const g = grams(); st.mode = -1; st.value = isNum(g) ? round(g, 1) : 100; }
        else if (idx >= 0 && idx !== st.mode) { st.mode = idx; st.value = 1; }
        refresh();
        return;
      }
      const preset = ev.target.closest('[data-preset]');
      if (preset) { st.value = parseFloat(preset.dataset.preset); refresh(); return; }
      const b = ev.target.closest('[data-act]');
      if (!b || b.disabled) return;
      const act = b.dataset.act;
      const step = st.mode >= 0 ? 0.5 : (st.value < 50 ? 5 : 10);
      const cur = isNum(st.value) ? st.value : 0;
      if (act === 'minus') { st.value = Math.max(step, round(cur - step, 2)); refresh(); }
      else if (act === 'plus') { st.value = round(cur + step, 2); refresh(); }
      else if (act === 'fav') {
        const on = toggleFav(food);
        b.classList.toggle('on', on);
        b.setAttribute('aria-pressed', String(on));
        toast(on ? 'Ajouté aux favoris' : 'Retiré des favoris');
      } else if (act === 'save') doSave();
      else if (act === 'delete') doDelete();
    });

    function doSave() {
      const g = grams();
      if (!isNum(g) || g <= 0 || g > 5000) { toast('Quantité invalide', { error: true }); return; }
      const portion = st.mode >= 0 ? { label: portions[st.mode].label, grams: portions[st.mode].grams, count: round(st.value, 2) } : null;
      if (edit) {
        edit.qty = round(g, 1);
        edit.portion = portion;
        edit.meal = st.meal;
        edit.n = scaleNutri(edit.per100, edit.qty);
        save();
        sheet.close();
        render();
        toast('Entrée modifiée');
      } else {
        sheet.close();
        addEntry(makeEntry(food, round(g, 1), portion, st.meal), opts);
      }
    }
    function doDelete() {
      const key = ui.day;
      const day = state.days[key];
      if (!day) return;
      const idx = day.entries.findIndex((x) => x.id === edit.id);
      if (idx < 0) return;
      const removed = day.entries.splice(idx, 1)[0];
      save();
      sheet.close();
      render();
      toast('Aliment supprimé', {
        action: 'Annuler',
        onAction: () => {
          const d = getDay(key, true);
          d.entries.splice(Math.min(idx, d.entries.length), 0, removed);
          save();
          render();
        },
      });
    }
    refresh();
  }

  /* ---------- Ajout rapide (kcal et macros saisis directement) ---------- */
  function openQuickAdd(o) {
    const opts = o || {};
    const edit = opts.entry || null;
    const st = { meal: edit ? edit.meal : (opts.meal || guessMeal()) };
    const v = edit ? edit.n : {};
    const sheet = openSheet({ title: edit ? 'Modifier l’ajout rapide' : 'Ajout rapide', closeLabel: 'Annuler' });
    sheet.setBody(`
      <p class="section-note" style="margin-top:4px">Plat au restaurant, recette maison, étiquette : saisis directement les valeurs totales.</p>
      <div class="form-list" style="margin-top:10px">
        <label class="field"><span class="field-label">Nom</span><input class="input input-text" type="text" name="name" maxlength="60" placeholder="Ajout rapide" autocomplete="off" value="${esc(edit ? edit.name : '')}"></label>
        ${numField('kcal', 'Calories', 'kcal', edit ? v.kcal : null, { placeholder: 'auto', dec: 0 })}
        ${numField('prot', 'Protéines', 'g', edit ? v.prot : null)}
        ${numField('gluc', 'Glucides', 'g', edit ? v.gluc : null)}
        ${numField('lip', 'Lipides', 'g', edit ? v.lip : null)}
        ${numField('fib', 'Fibres', 'g', edit ? v.fib : null)}
      </div>
      <p class="field-hint" data-role="hint">Laisse les calories vides pour les calculer à partir des macros.</p>
      <h3 class="section-title">Repas</h3>
      <div class="chips">${mealChips(st.meal)}</div>`);
    sheet.setFoot(`<div class="btn-row">${edit ? `<button class="btn btn-danger" type="button" data-act="delete" style="flex:0 0 56px" aria-label="Supprimer">${icon('trash')}</button>` : ''}<button class="btn btn-primary" type="button" data-act="save">${edit ? 'Enregistrer' : 'Ajouter'}</button></div>`);

    const field = (n) => $(`[name="${n}"]`, sheet.body);
    const read = () => {
      const out = {};
      let bad = null;
      NUTRI_KEYS.forEach((k) => {
        const raw = field(k).value.trim();
        const val = raw === '' ? null : parseNum(raw);
        if (raw !== '' && (!isNum(val) || val < 0)) bad = k;
        out[k] = val;
      });
      return { out, bad };
    };
    const hint = $('[data-role="hint"]', sheet.body);
    sheet.body.addEventListener('input', () => {
      const r = read().out;
      const fromMacros = 4 * (r.prot || 0) + 4 * (r.gluc || 0) + 9 * (r.lip || 0) + 2 * (r.fib || 0);
      if (!isNum(r.kcal) && fromMacros > 0) hint.textContent = `≈ ${fmt(fromMacros)} kcal calculées à partir des macros.`;
      else if (isNum(r.kcal) && fromMacros > 0 && Math.abs(fromMacros - r.kcal) > Math.max(30, r.kcal * 0.2)) hint.textContent = `Attention : les macros correspondent à ≈ ${fmt(fromMacros)} kcal.`;
      else hint.textContent = 'Laisse les calories vides pour les calculer à partir des macros.';
    });
    sheet.el.addEventListener('click', (ev) => {
      const meal = pickMealChip(ev, sheet.body);
      if (meal) { st.meal = meal; return; }
      const b = ev.target.closest('[data-act]');
      if (!b) return;
      if (b.dataset.act === 'delete' && edit) {
        const key = ui.day;
        const d = state.days[key];
        if (!d) return;
        const idx = d.entries.findIndex((x) => x.id === edit.id);
        if (idx < 0) return;
        const removed = d.entries.splice(idx, 1)[0];
        save(); sheet.close(); render();
        toast('Supprimé', { action: 'Annuler', onAction: () => { getDay(key, true).entries.splice(idx, 0, removed); save(); render(); } });
        return;
      }
      if (b.dataset.act !== 'save') return;
      const r = read();
      if (r.bad) { toast('Valeur invalide : vérifie les chiffres', { error: true }); field(r.bad).focus(); return; }
      const n = r.out;
      const fromMacros = 4 * (n.prot || 0) + 4 * (n.gluc || 0) + 9 * (n.lip || 0) + 2 * (n.fib || 0);
      const kcal = isNum(n.kcal) ? n.kcal : fromMacros;
      if (!(kcal > 0)) { toast('Indique au moins les calories ou les macros', { error: true }); return; }
      if (kcal > 10000) { toast('Valeur trop élevée', { error: true }); return; }
      const nutri = { kcal: round(kcal, 1), prot: round(n.prot || 0, 1), gluc: round(n.gluc || 0, 1), lip: round(n.lip || 0, 1), fib: round(n.fib || 0, 1) };
      const name = field('name').value.trim() || 'Ajout rapide';
      if (edit) {
        Object.assign(edit, { name, n: nutri, meal: st.meal });
        save(); sheet.close(); render();
        toast('Entrée modifiée');
      } else {
        sheet.close();
        addEntry({ id: uid('e'), meal: st.meal, ref: null, name, brand: '', unit: 'g', qty: null, portion: null, per100: null, n: nutri, t: Date.now() }, opts);
      }
    });
  }

  /* ---------- Créer / modifier un aliment perso ---------- */
  function openFoodForm(o) {
    const opts = o || {};
    const edit = opts.custom || null;
    const pre = edit || opts.prefill || {};
    const per = pre.per100 || {};
    const portion = (pre.portions && pre.portions[0]) || {};
    let unit = pre.unit === 'ml' ? 'ml' : 'g';
    const sheet = openSheet({ title: edit ? 'Modifier l’aliment' : 'Nouvel aliment', closeLabel: 'Annuler' });
    sheet.setBody(`
      ${opts.notice ? banner('info', 'info', '', opts.notice) : ''}
      <div class="form-list" style="margin-top:6px">
        <label class="field"><span class="field-label">Nom</span><input class="input input-text" type="text" name="name" maxlength="80" placeholder="ex. : Galette maison" autocomplete="off" value="${esc(pre.name || '')}"></label>
        <label class="field"><span class="field-label">Marque<small>facultatif</small></span><input class="input input-text" type="text" name="brand" maxlength="40" autocomplete="off" value="${esc(pre.brand || '')}"></label>
        <div class="field"><span class="field-label">Unité</span><div class="seg seg-inline" data-role="unit"><button type="button" data-v="g" class="${unit === 'g' ? 'active' : ''}">grammes</button><button type="button" data-v="ml" class="${unit === 'ml' ? 'active' : ''}">ml</button></div></div>
      </div>
      <h3 class="section-title" data-role="per-title">Valeurs pour 100 ${unit}</h3>
      <div class="form-list">
        ${numField('kcal', 'Calories', 'kcal', per.kcal, { placeholder: 'auto' })}
        ${numField('prot', 'Protéines', 'g', per.prot)}
        ${numField('gluc', 'Glucides', 'g', per.gluc)}
        ${numField('sugars', 'dont sucres', 'g', pre.sugars, { placeholder: '–' })}
        ${numField('lip', 'Lipides', 'g', per.lip)}
        ${numField('fib', 'Fibres', 'g', per.fib)}
        ${numField('salt', 'Sel', 'g', pre.salt, { placeholder: '–', dec: 2 })}
      </div>
      <p class="field-hint">Recopie les valeurs « pour 100 g » de l’étiquette. Calories vides = calculées à partir des macros.</p>
      <h3 class="section-title">Portion (facultatif)</h3>
      <div class="form-list">
        <label class="field"><span class="field-label">Nom de la portion</span><input class="input input-text" type="text" name="plabel" maxlength="30" placeholder="ex. : part, pot" autocomplete="off" value="${esc(portion.label || '')}"></label>
        ${numField('pgrams', 'Poids de la portion', unit, portion.grams, { placeholder: '–' })}
      </div>
      <div class="form-list" style="margin-top:12px">
        <label class="field"><span class="field-label">Code-barres<small>facultatif</small></span><input class="input input-wide num" type="text" name="barcode" inputmode="numeric" maxlength="14" autocomplete="off" value="${esc(pre.barcode || '')}"></label>
      </div>
      <div class="field-error" data-role="err" hidden></div>`);
    sheet.setFoot(`<button class="btn btn-primary btn-block" type="button" data-act="save">${edit ? 'Enregistrer' : 'Créer l’aliment'}</button>`);

    const val = (n) => $(`[name="${n}"]`, sheet.body).value.trim();
    const errBox = $('[data-role="err"]', sheet.body);
    const fail = (msg) => { errBox.textContent = msg; errBox.hidden = false; errBox.scrollIntoView({ block: 'center', behavior: 'smooth' }); };

    sheet.el.addEventListener('click', (ev) => {
      const u = ev.target.closest('[data-role="unit"] button');
      if (u) {
        unit = u.dataset.v;
        $$('[data-role="unit"] button', sheet.body).forEach((x) => x.classList.toggle('active', x === u));
        $('[data-role="per-title"]', sheet.body).textContent = `Valeurs pour 100 ${unit}`;
        return;
      }
      const b = ev.target.closest('[data-act="save"]');
      if (!b) return;
      const name = val('name');
      if (!name) { fail('Donne un nom à l’aliment.'); return; }
      const nums = {};
      const labels = { kcal: 'Calories', prot: 'Protéines', gluc: 'Glucides', sugars: 'Sucres', lip: 'Lipides', fib: 'Fibres', salt: 'Sel', pgrams: 'Poids de la portion' };
      const keys = Object.keys(labels);
      for (let i = 0; i < keys.length; i++) {
        const k = keys[i];
        const raw = val(k);
        const x = raw === '' ? null : parseNum(raw);
        if (raw !== '' && (!isNum(x) || x < 0)) { fail(`Valeur invalide : ${labels[k]}.`); return; }
        nums[k] = x;
      }
      if (!isNum(nums.kcal)) {
        if ([nums.prot, nums.gluc, nums.lip].some(isNum)) nums.kcal = 4 * (nums.prot || 0) + 4 * (nums.gluc || 0) + 9 * (nums.lip || 0) + 2 * (nums.fib || 0);
        else { fail('Indique au moins les calories ou les macros pour 100 g.'); return; }
      }
      if (nums.kcal > 950 || (nums.prot || 0) > 100 || (nums.gluc || 0) > 100 || (nums.lip || 0) > 100 || (nums.prot || 0) + (nums.gluc || 0) + (nums.lip || 0) > 105) {
        fail('Valeurs impossibles pour 100 g : vérifie l’étiquette.');
        return;
      }
      const plabel = val('plabel');
      const portions = [];
      if (isNum(nums.pgrams) || plabel) {
        if (!isNum(nums.pgrams) || nums.pgrams <= 0 || nums.pgrams > 3000) { fail('Indique le poids de la portion (en g).'); return; }
        portions.push({ label: (plabel || 'portion').slice(0, 30), grams: round(nums.pgrams, 1) });
      }
      const barcode = val('barcode').replace(/\D/g, '');
      if (barcode && (barcode.length < 8 || barcode.length > 14)) { fail('Le code-barres doit faire de 8 à 14 chiffres.'); return; }
      const obj = sanitizeCustom({
        id: edit ? edit.id : uid('c'),
        name,
        brand: val('brand'),
        unit,
        per100: { kcal: round(nums.kcal, 1), prot: nums.prot || 0, gluc: nums.gluc || 0, lip: nums.lip || 0, fib: nums.fib || 0 },
        sugars: nums.sugars,
        salt: nums.salt,
        portions,
        barcode,
      });
      if (edit) {
        const i = state.customFoods.findIndex((x) => x.id === edit.id);
        if (i >= 0) state.customFoods[i] = obj; else state.customFoods.unshift(obj);
      } else state.customFoods.unshift(obj);
      save();
      sheet.close();
      render();
      toast(edit ? 'Aliment modifié' : 'Aliment créé');
      if (typeof opts.onSaved === 'function') opts.onSaved(customToFood(obj));
    });
  }

  /* ---------- Fiche d'un aliment (onglet Aliments) ---------- */
  function openFoodDetail(ref) {
    const food = getFood(ref);
    if (!food) return;
    const u = food.unit === 'ml' ? 'ml' : 'g';
    const sheet = openSheet({
      title: food.source === 'custom' ? 'Mon aliment' : 'Aliment',
      body: `
        <div class="qty-head">
          <div class="grow"><div class="qty-name">${esc(food.name)}</div><div class="qty-src">${esc(sourceLabel(food))}</div></div>
          <button class="star-btn ${isFav(food.ref) ? 'on' : ''}" type="button" data-act="fav" aria-label="Favori" aria-pressed="${isFav(food.ref)}">${icon('star')}</button>
        </div>
        <h3 class="section-title">Pour 100 ${u}</h3>
        <div class="card" style="margin-top:0">${per100Table(food)}</div>
        ${food.portions.length ? `<h3 class="section-title">Portions</h3><div class="list">${food.portions.map((p) => `<div class="list-item"><span class="li-main"><span class="li-title">${esc(p.label)}</span><span class="li-sub">${fmt(p.grams)} ${u}</span></span><span class="li-end">${fmt(food.per100.kcal * p.grams / 100)} kcal</span></div>`).join('')}</div>` : ''}
        <div class="stack" style="margin-top:16px">
          ${food.source === 'custom' ? '<button class="btn btn-block" type="button" data-act="edit">Modifier</button>' : '<button class="btn btn-block" type="button" data-act="dup">Copier en aliment perso (pour l’ajuster)</button>'}
          ${food.source === 'custom' ? '<button class="btn btn-danger btn-block" type="button" data-act="delete">Supprimer cet aliment</button>' : ''}
          ${food.source === 'off' ? '<button class="btn btn-danger btn-block" type="button" data-act="forget">Retirer des produits scannés</button>' : ''}
        </div>`,
      foot: '<button class="btn btn-primary btn-block" type="button" data-act="add">Ajouter au journal</button>',
    });
    sheet.el.addEventListener('click', (ev) => {
      const b = ev.target.closest('[data-act]');
      if (!b) return;
      const act = b.dataset.act;
      if (act === 'fav') {
        const on = toggleFav(food);
        b.classList.toggle('on', on);
        b.setAttribute('aria-pressed', String(on));
        render();
      } else if (act === 'add') {
        sheet.close();
        openQtySheet(food, { meal: guessMeal() });
      } else if (act === 'edit') {
        const c = state.customFoods.find((x) => x.id === food.id);
        sheet.close();
        if (c) openFoodForm({ custom: c });
      } else if (act === 'dup') {
        sheet.close();
        openFoodForm({ prefill: { name: food.name + ' (perso)', brand: food.brand, unit: food.unit, per100: food.per100, sugars: food.sugars, salt: food.salt, portions: food.portions } });
      } else if (act === 'delete') {
        confirmDialog({ title: 'Supprimer cet aliment ?', message: 'Les entrées déjà présentes dans ton journal sont conservées.', ok: 'Supprimer', danger: true }).then((ok) => {
          if (!ok) return;
          state.customFoods = state.customFoods.filter((x) => x.id !== food.id);
          state.favorites = state.favorites.filter((r) => r !== food.ref);
          save(); sheet.close(); render();
          toast('Aliment supprimé');
        });
      } else if (act === 'forget') {
        delete state.offFoods[food.id];
        state.favorites = state.favorites.filter((r) => r !== food.ref);
        save(); sheet.close(); render();
        toast('Produit retiré');
      }
    });
  }

  /* ---------- Repas types ---------- */
  function openSavedMeal(id, o) {
    const opts = o || {};
    const sm = state.savedMeals.find((x) => x.id === id);
    if (!sm) return;
    const st = { meal: opts.meal || guessMeal() };
    const tot = sumNutri(sm.items);
    const sheet = openSheet({
      title: sm.name,
      body: `
        <div class="card" style="margin-top:4px"><div class="row-between"><span class="strong">${fmt(tot.kcal)} kcal</span><span class="muted small">P ${fmtG(tot.prot)} · G ${fmtG(tot.gluc)} · L ${fmtG(tot.lip)} g</span></div></div>
        <div class="list" style="margin-top:10px">${sm.items.map((e) => `<div class="list-item"><span class="li-main"><span class="li-title">${esc(e.name)}</span><span class="li-sub">${esc(entryQtyText(e))}</span></span><span class="li-end">${fmt(e.n.kcal)} kcal</span></div>`).join('')}</div>
        <h3 class="section-title">Ajouter à</h3>
        <div class="chips">${mealChips(st.meal)}</div>
        <div class="btn-row" style="margin-top:18px"><button class="btn" type="button" data-act="rename">Renommer</button><button class="btn btn-danger" type="button" data-act="delete">Supprimer</button></div>`,
      foot: `<button class="btn btn-primary btn-block" type="button" data-act="add">Ajouter les ${sm.items.length} aliment${sm.items.length > 1 ? 's' : ''}</button>`,
    });
    sheet.el.addEventListener('click', (ev) => {
      const meal = pickMealChip(ev, sheet.body);
      if (meal) { st.meal = meal; return; }
      const b = ev.target.closest('[data-act]');
      if (!b) return;
      if (b.dataset.act === 'add') {
        const key = ui.day;
        const day = getDay(key, true);
        const now = Date.now();
        const ids = [];
        sm.items.forEach((it, i) => {
          const e = Object.assign(cloneData(it), { id: uid('e'), meal: st.meal, t: now + i });
          ids.push(e.id);
          day.entries.push(e);
        });
        save();
        sheet.close();
        render();
        toast(`« ${sm.name} » ajouté · ${fmt(tot.kcal)} kcal`, {
          action: 'Annuler',
          onAction: () => { const d = state.days[key]; if (d) d.entries = d.entries.filter((x) => ids.indexOf(x.id) < 0); save(); render(); },
        });
        if (typeof opts.onAdded === 'function') opts.onAdded({ n: tot, count: sm.items.length });
      } else if (b.dataset.act === 'rename') {
        promptDialog({ title: 'Renommer le repas type', value: sm.name, ok: 'Renommer' }).then((name) => {
          if (!name) return;
          sm.name = name.slice(0, 40);
          save(); sheet.setTitle(sm.name); render();
        });
      } else if (b.dataset.act === 'delete') {
        confirmDialog({ title: 'Supprimer ce repas type ?', ok: 'Supprimer', danger: true }).then((ok) => {
          if (!ok) return;
          state.savedMeals = state.savedMeals.filter((x) => x.id !== sm.id);
          save(); sheet.close(); render();
          toast('Repas type supprimé');
        });
      }
    });
  }

  /* ===========================================================================
     7. OPEN FOOD FACTS ET SCAN DE CODE-BARRES
     ========================================================================= */

  function fetchWithTimeout(url, ms) {
    const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = setTimeout(() => { if (ctrl) ctrl.abort(); }, ms || 12000);
    return fetch(url, ctrl ? { signal: ctrl.signal } : {}).then(
      (res) => { clearTimeout(timer); return res; },
      (err) => { clearTimeout(timer); throw err; },
    );
  }

  function offErrorText(err) {
    if (navigator.onLine === false) return 'Hors ligne : connecte-toi à Internet pour interroger Open Food Facts.';
    if (err && err.name === 'AbortError') return 'Open Food Facts ne répond pas (délai dépassé). Réessaie dans un instant.';
    if (err && err.status === 429) return 'Trop de recherches d’affilée : attends une minute puis réessaie.';
    if (err && err.status >= 500) return 'Open Food Facts est momentanément surchargé. Réessaie dans quelques instants.';
    // Quand le serveur est surchargé, sa page d'erreur bloque la lecture (erreur « réseau »).
    return 'Open Food Facts ne répond pas pour le moment (serveur surchargé ou connexion faible). Réessaie dans quelques instants.';
  }

  /**
   * Télécharge du JSON en essayant plusieurs adresses l'une après l'autre (pause de 1,2 s) :
   * le serveur d'Open Food Facts refuse parfois une requête quand il est surchargé.
   */
  async function fetchJsonRetry(urls, ms) {
    let lastErr = null;
    for (let i = 0; i < urls.length; i++) {
      if (i > 0) await new Promise((r) => setTimeout(r, 1200));
      try {
        const res = await fetchWithTimeout(urls[i], ms);
        if (res.status === 404) return { notFound: true };
        if (!res.ok) { const e = new Error('HTTP ' + res.status); e.status = res.status; throw e; }
        return { data: await res.json() };
      } catch (err) {
        lastErr = err;
        if ((err && err.status === 429) || navigator.onLine === false) break;   // inutile d'insister
      }
    }
    throw lastErr;
  }

  function offNum(v) {
    if (v == null || v === '') return null;
    const n = typeof v === 'number' ? v : parseNum(String(v));
    return isNum(n) && n >= 0 ? n : null;
  }

  /** Convertit un produit Open Food Facts au format de l'app (valeurs pour 100 g). */
  function normalizeOff(p, codeHint) {
    const n = p.nutriments || {};
    let kcal = offNum(n['energy-kcal_100g']);
    if (kcal == null) {
      const kj = offNum(n['energy-kj_100g']) != null ? offNum(n['energy-kj_100g']) : offNum(n.energy_100g);
      if (kj != null) kcal = kj / 4.184;               // conversion kJ → kcal
    }
    const prot = offNum(n.proteins_100g);
    const gluc = offNum(n.carbohydrates_100g);
    const lip = offNum(n.fat_100g);
    const fib = offNum(n.fiber_100g);
    if (kcal == null && (prot != null || gluc != null || lip != null)) {
      kcal = 4 * (prot || 0) + 4 * (gluc || 0) + 9 * (lip || 0) + 2 * (fib || 0);
    }
    let salt = offNum(n.salt_100g);
    if (salt == null && offNum(n.sodium_100g) != null) salt = offNum(n.sodium_100g) * 2.5;
    const name = String(p.product_name_fr || p.product_name || p.generic_name_fr || '').trim() || 'Produit sans nom';
    const brand = String(p.brands || '').split(',')[0].trim();
    const quantity = String(p.quantity || '').trim();
    const liquid = /\d\s*(ml|cl|l)\b/i.test(quantity);
    const portions = [];
    const sq = offNum(p.serving_quantity);
    if (sq && sq > 0 && sq <= 2000) portions.push({ label: 'portion', grams: round(sq, 1) });
    return {
      code: String(p.code || codeHint || ''),
      name: name.slice(0, 120),
      brand: brand.slice(0, 60),
      quantity: quantity.slice(0, 30),
      unit: liquid ? 'ml' : 'g',
      per100: {
        kcal: round(kcal || 0, 1), prot: round(prot || 0, 2), gluc: round(gluc || 0, 2),
        lip: round(lip || 0, 2), fib: round(fib || 0, 2),
      },
      sugars: offNum(n.sugars_100g),
      salt: salt != null ? round(salt, 2) : null,
      portions,
      incomplete: kcal == null,
      fetchedAt: Date.now(),
    };
  }

  /** Produit par code-barres (API v2). Renvoie null s'il n'existe pas. */
  async function offGetProduct(code) {
    const tries = code.length === 12 ? ['0' + code, code] : [code];   // UPC-A → EAN-13
    for (let i = 0; i < tries.length; i++) {
      const url = `${OFF_PRODUCT_URL}${encodeURIComponent(tries[i])}.json?fields=${OFF_FIELDS}`;
      const r = await fetchJsonRetry([url, url], 12000);
      if (r.notFound) continue;
      if (r.data && r.data.status === 1 && r.data.product) return normalizeOff(r.data.product, tries[i]);
    }
    return null;
  }

  /** Recherche de produits par nom (lancée à la validation, jamais à chaque lettre). */
  async function offSearch(q) {
    const params = `search_terms=${encodeURIComponent(q)}&search_simple=1&action=process&json=1&page_size=20&sort_by=unique_scans_n&fields=${OFF_FIELDS}`;
    const r = await fetchJsonRetry([
      `${OFF_SEARCH_URL}?${params}`,                                                          // produits vendus en France
      `${OFF_SEARCH_URL_WORLD}?${params}&tagtype_0=countries&tag_contains_0=contains&tag_0=france`,
      `${OFF_SEARCH_URL}?${params}`,
    ], 15000);
    const list = r.data && Array.isArray(r.data.products) ? r.data.products : [];
    const tokens = norm(q).split(' ').filter(Boolean);
    // Les produits dont le nom ou la marque contient les mots cherchés passent en premier.
    return list.map((p) => normalizeOff(p))
      .filter((p) => /^\d{6,14}$/.test(p.code) && !p.incomplete)
      .map((p, i) => {
        const hay = norm(p.name + ' ' + p.brand);
        return { p, i, score: tokens.filter((t) => hay.indexOf(t) >= 0).length };
      })
      .sort((a, b) => b.score - a.score || a.i - b.i)
      .map((x) => x.p);
  }

  /** Cherche un code-barres : aliments perso, puis produits déjà connus, puis Open Food Facts. */
  async function lookupBarcode(code) {
    const variants = [code, code.length === 12 ? '0' + code : null, code.length === 13 && code[0] === '0' ? code.slice(1) : null].filter(Boolean);
    const custom = state.customFoods.find((c) => c.barcode && variants.indexOf(c.barcode) >= 0);
    if (custom) return { food: customToFood(custom) };
    for (let i = 0; i < variants.length; i++) {
      const p = state.offFoods[variants[i]];
      if (p) return { food: offToFood(p) };
    }
    if (navigator.onLine === false) return { offline: true };
    const p = await offGetProduct(code);
    if (!p) return { notFound: true };
    if (p.incomplete) return { incomplete: p };
    storeOffProduct(p);
    return { food: offToFood(state.offFoods[p.code]) };
  }

  /* ---------- Lecteur de code-barres ---------- */
  let scanLibPromise = null;
  function loadScannerLib() {
    const lib = () => window.BarcodeDetectionAPI && window.BarcodeDetectionAPI.BarcodeDetector;
    if (lib()) return Promise.resolve(lib());
    if (scanLibPromise) return scanLibPromise;
    scanLibPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = SCANNER_LIB_URL;
      s.async = true;
      s.crossOrigin = 'anonymous';
      if (SCANNER_LIB_SRI.indexOf('sha') === 0) s.integrity = SCANNER_LIB_SRI;
      s.onload = () => (lib() ? resolve(lib()) : reject(new Error('lecteur indisponible')));
      s.onerror = () => { scanLibPromise = null; s.remove(); reject(new Error('chargement impossible')); };
      document.head.appendChild(s);
    });
    return scanLibPromise;
  }

  /** BarcodeDetector natif si le navigateur le propose, sinon la librairie compatible Safari iOS. */
  async function createDetector() {
    const formats = ['ean_13', 'ean_8', 'upc_a', 'upc_e'];
    if ('BarcodeDetector' in window) {
      try {
        const supported = await window.BarcodeDetector.getSupportedFormats();
        const f = formats.filter((x) => supported.indexOf(x) >= 0);
        if (f.length) return new window.BarcodeDetector({ formats: f });
      } catch (e) { /* on bascule sur la librairie */ }
    }
    const Lib = await loadScannerLib();
    return new Lib({ formats });
  }

  function openScanner(o) {
    const opts = o || {};
    const wrap = document.createElement('div');
    wrap.className = 'scanner';
    wrap.setAttribute('role', 'dialog');
    wrap.setAttribute('aria-label', 'Scanner un code-barres');
    wrap.innerHTML = `
      <video playsinline muted autoplay></video>
      <div class="scan-top">
        <button class="sheet-head-btn start" type="button" data-act="close">Fermer</button>
        <span class="scan-title">Code-barres</span>
        <span class="sheet-head-btn end"></span>
      </div>
      <div class="scan-frame" aria-hidden="true"></div>
      <div class="scan-bottom">
        <div class="scan-msg" data-role="msg" aria-live="polite">Démarrage de la caméra…</div>
        <div class="btn-row" data-role="after" hidden style="margin-bottom:10px"></div>
        <form class="scan-manual" data-role="manual">
          <input class="input" type="text" inputmode="numeric" pattern="[0-9]*" maxlength="14" autocomplete="off" placeholder="Ou tape le code (8 à 13 chiffres)" aria-label="Code-barres">
          <button class="btn btn-primary" type="submit">OK</button>
        </form>
      </div>`;
    document.body.appendChild(wrap);
    const video = $('video', wrap);
    const msg = $('[data-role="msg"]', wrap);
    const after = $('[data-role="after"]', wrap);
    const manual = $('[data-role="manual"]', wrap);
    let stream = null;
    let detector = null;
    let timer = null;
    let active = true;
    let busy = false;
    let closed = false;
    const setMsg = (t) => { msg.textContent = t; };

    function stopCamera() {
      clearTimeout(timer);
      if (stream) stream.getTracks().forEach((t) => t.stop());
      stream = null;
      video.srcObject = null;
    }
    function close() {
      if (closed) return;
      closed = true;
      active = false;
      stopCamera();
      wrap.remove();
      document.removeEventListener('visibilitychange', onVis);
      document.removeEventListener('keydown', onKey);
    }
    function onVis() { if (document.visibilityState === 'hidden') close(); }   // libère la caméra
    function onKey(ev) { if (ev.key === 'Escape') close(); }
    document.addEventListener('visibilitychange', onVis);
    document.addEventListener('keydown', onKey);
    $('[data-act="close"]', wrap).addEventListener('click', close);

    function showChoices(code, failed) {
      after.hidden = false;
      after.innerHTML = (failed ? '<button class="btn btn-small" type="button" data-act="again">Réessayer</button>' : '')
        + '<button class="btn btn-small" type="button" data-act="retry">Rescanner</button><button class="btn btn-small btn-primary" type="button" data-act="create">Créer l’aliment</button>';
      after.onclick = (ev) => {
        const b = ev.target.closest('[data-act]');
        if (!b) return;
        if (b.dataset.act === 'again') { handleCode(code); return; }
        if (b.dataset.act === 'retry') { after.hidden = true; startCamera(); }
        if (b.dataset.act === 'create') {
          close();
          openFoodForm({ prefill: { barcode: code }, notice: 'Recopie les valeurs « pour 100 g » de l’étiquette : la prochaine fois, ce code-barres sera reconnu directement.', onSaved: (food) => openQtySheet(food, opts) });
        }
      };
    }

    async function handleCode(code) {
      if (busy) return;
      busy = true;
      stopCamera();
      after.hidden = true;
      setMsg(`Code ${code} : recherche…`);
      try {
        const r = await lookupBarcode(code);
        if (closed) return;
        if (r.food) {
          close();
          openQtySheet(r.food, opts);
          return;
        }
        if (r.incomplete) {
          close();
          openFoodForm({ prefill: { name: r.incomplete.name, brand: r.incomplete.brand, barcode: code, unit: r.incomplete.unit }, notice: 'Ce produit n’a pas de valeurs nutritionnelles sur Open Food Facts : complète-les depuis l’étiquette.', onSaved: (food) => openQtySheet(food, opts) });
          return;
        }
        if (r.offline) setMsg('Hors ligne : ce produit n’est pas encore connu sur ce téléphone. Crée-le, ou utilise l’ajout rapide.');
        else setMsg(`Produit ${code} introuvable sur Open Food Facts.`);
        showChoices(code);
      } catch (err) {
        if (closed) return;
        setMsg(offErrorText(err));
        showChoices(code, true);
      }
      busy = false;
    }

    async function loop() {
      if (!active || busy || closed) return;
      if (video.readyState >= 2 && detector) {
        try {
          const codes = await detector.detect(video);
          if (codes && codes.length && active && !busy) {
            const raw = String(codes[0].rawValue || '').replace(/\D/g, '');
            if (raw.length >= 8) { handleCode(raw); return; }
          }
        } catch (e) { /* image illisible : on réessaie */ }
      }
      timer = setTimeout(loop, 180);
    }

    async function startCamera() {
      busy = false;
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        setMsg('Caméra indisponible ici : tape le code-barres ci-dessous.');
        return;
      }
      try {
        if (!detector) {
          setMsg('Préparation du lecteur…');
          detector = await createDetector();
        }
      } catch (e) {
        setMsg('Le lecteur de code-barres n’a pas pu se charger (connexion ?). Tape le code ci-dessous.');
        return;
      }
      try {
        setMsg('Démarrage de la caméra…');
        const s = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        });
        if (closed) { s.getTracks().forEach((t) => t.stop()); return; }
        stream = s;
        video.srcObject = stream;
        await video.play().catch(() => {});
        setMsg('Place le code-barres dans le cadre');
        active = true;
        loop();
      } catch (err) {
        setMsg(err && err.name === 'NotAllowedError'
          ? 'Accès à la caméra refusé. Autorise-le (Réglages de l’iPhone › Safari › Caméra) ou tape le code ci-dessous.'
          : 'Impossible d’ouvrir la caméra. Tape le code-barres ci-dessous.');
      }
    }

    manual.addEventListener('submit', (ev) => {
      ev.preventDefault();
      const input = $('input', manual);
      const code = input.value.replace(/\D/g, '');
      if (code.length < 8 || code.length > 14) { setMsg('Code incomplet : 8 à 14 chiffres.'); return; }
      input.blur();
      handleCode(code);
    });
    startCamera();
  }
  ACTIONS['scan-food'] = () => openScanner({ meal: guessMeal() });

  /* ===========================================================================
     8. ONGLET PROGRÈS : poids, graphiques SVG, bilan, coach, mensurations
     ========================================================================= */

  function renderProgress() {
    const ws = weightStats();
    return `
      <header class="topbar"><h1 class="topbar-title">Progrès</h1></header>
      ${weighCard(ws)}
      ${profileWeightNudge(ws)}
      <div class="seg" style="margin-top:16px" role="group" aria-label="Période des graphiques">
        ${[7, 30, 90].map((r) => `<button type="button" data-action="range" data-range="${r}" class="${ui.range === r ? 'active' : ''}" aria-pressed="${ui.range === r}">${r} jours</button>`).join('')}
      </div>
      <section class="card"><div class="card-head"><h2 class="card-title">Poids</h2></div><div class="chart" data-chart="weight"></div></section>
      <section class="card"><div class="card-head"><h2 class="card-title">Calories</h2></div><div class="chart" data-chart="kcal"></div></section>
      <section class="card"><div class="card-head"><h2 class="card-title">Protéines</h2></div><div class="chart" data-chart="prot"></div></section>
      ${weekCard()}
      ${coachCard()}
      ${measuresCard()}
      <p class="disclaimer">Les calculs sont des estimations et ne remplacent pas un avis médical.</p>`;
  }

  function weighCard(ws) {
    const p = state.profile;
    const w = state.weights[todayKey()];
    let eta = '–';
    let etaSub = 'au rythme visé';
    if (ws.reached) { eta = 'Atteint'; etaSub = 'bravo ! 🎉'; }
    else if (ws.etaActual) { eta = fmtDateSmart(ws.etaActual); etaSub = `au rythme actuel${ws.etaPlan ? ` · visé : ${fmtDateSmart(ws.etaPlan)}` : ''}`; }
    else if (ws.etaPlan) { eta = fmtDateSmart(ws.etaPlan); etaSub = 'au rythme visé'; }
    return `
      <section class="card">
        <div class="card-head"><h2 class="card-title">Pesée du jour</h2><button class="link-btn" type="button" data-action="weights-history">Historique</button></div>
        <form class="weigh" data-form="weigh">
          <input class="input grow" type="text" inputmode="decimal" enterkeyhint="done" name="kg" autocomplete="off" placeholder="ex. : 82,4" value="${fmtInput(w, 1)}" aria-label="Poids du jour en kg">
          <span class="input-unit">kg</span>
          <button class="btn btn-primary" type="submit">OK</button>
        </form>
        <div class="stats" style="margin-top:14px">
          ${statTile('Moyenne 7 jours', ws.cur ? fmtKg(ws.cur.avg) : '–', ws.cur ? 'kg' : '', ws.cur ? `${ws.cur.n} pesée${ws.cur.n > 1 ? 's' : ''}` : 'aucune pesée')}
          ${statTile('Sur 7 jours', isNum(ws.weekly) ? fmtSigned(ws.weekly, 2) : '–', isNum(ws.weekly) ? 'kg' : '', isNum(ws.weeklyPct) ? `${fmtSigned(ws.weeklyPct, 2)} % (visé −${fmt(p.rate, 2)} %)` : '2 semaines de pesées nécessaires')}
          ${statTile('Objectif', fmtKg(p.goalWeight), 'kg', ws.reached ? 'atteint' : `encore ${fmtKg(Math.max(0, ws.remaining))} kg`)}
          ${statTile('Date estimée', eta, '', etaSub)}
        </div>
      </section>`;
  }

  /** Propose de recalculer les objectifs quand le poids moyen a bien bougé depuis le profil. */
  function profileWeightNudge(ws) {
    const p = state.profile;
    if (!ws.cur || ws.cur.n < 3) return '';
    const diff = ws.cur.avg - p.weight;
    if (Math.abs(diff) < 2) return '';
    return banner('info', 'scale', 'Mettre à jour tes objectifs ?',
      `Ton poids moyen (${fmtKg(ws.cur.avg)} kg) a changé de ${fmtSigned(diff, 1)} kg depuis le calcul de tes objectifs (${fmtKg(p.weight)} kg).`,
      `<button class="btn btn-small btn-primary" data-action="profile-weight-update" data-kg="${round(ws.cur.avg, 1)}">Recalculer avec ${fmtKg(ws.cur.avg)} kg</button>`);
  }

  ACTIONS['profile-weight-update'] = (el) => {
    const kg = parseFloat(el.dataset.kg);
    if (!isNum(kg)) return;
    state.profile.weight = kg;
    state.meta.profileUpdatedAt = new Date().toISOString();
    save();
    render();
    toast(isNum(state.manualGoals.kcal) ? 'Profil mis à jour (tes calories restent celles fixées à la main)' : 'Objectifs recalculés');
  };

  FORMS.weigh = (f) => {
    const input = f.elements.kg;
    const v = parseNum(input.value);
    if (!isNum(v) || v < 25 || v > 350) { toast('Poids invalide (exemple : 82,4)', { error: true }); return; }
    input.blur();
    state.weights[todayKey()] = round(v, 2);
    save();
    render();
    toast(`Pesée enregistrée : ${fmt(v, 1)} kg`);
  };

  ACTIONS.range = (el) => { ui.range = parseInt(el.dataset.range, 10) || 30; render(); };

  function weekCard() {
    const s = weekSummary(todayKey());
    const streak = logStreak();
    const title = '<h2 class="section-title">Bilan des 7 derniers jours</h2>';
    if (!s.loggedCount) return `${title}<section class="card">${emptyHTML('today', 'Pas encore de données', 'Remplis ton journal quelques jours pour voir ton bilan.')}</section>`;
    return `${title}
      <section class="card">
        <div class="stats">
          ${statTile('Calories moy.', fmt(s.avgKcal), 'kcal', `objectif ${fmt(s.avgGoalKcal)}`)}
          ${statTile('Protéines moy.', fmt(s.avgProt), 'g', `objectif ${fmt(s.avgGoalProt)}`)}
          ${statTile('Objectif protéines', fmt(s.protHitPct), '%', 'des jours (≥ 90 %)')}
          ${statTile('Série en cours', fmt(streak), streak > 1 ? 'jours' : 'jour', 'de journal rempli d’affilée')}
        </div>
        <div class="calc-lines">
          <div>Jours remplis : <b>${s.loggedCount} / 7</b> · dans l’objectif calorique (± 10 %) : <b>${s.kcalOk}</b></div>
          <div>Moyennes : glucides <b>${fmt(s.avgGluc)} g</b> · lipides <b>${fmt(s.avgLip)} g</b> · fibres <b>${fmt(s.avgFib)} g</b></div>
          ${isNum(s.avgWater) ? `<div>Eau : <b>${fmtL(s.avgWater)} L</b> par jour en moyenne</div>` : ''}
          ${isNum(s.avgSteps) ? `<div>Pas : <b>${fmt(s.avgSteps)}</b> par jour (objectif ${fmt(state.settings.stepsGoal)})</div>` : ''}
        </div>
      </section>`;
  }

  function coachCard() {
    const c = coachAnalysis();
    const pl = plateauCheck();
    const p = state.profile;
    let html = '<h2 class="section-title" id="coach">Coach adaptatif</h2>';
    if (!c.ready) {
      html += `
        <section class="card">
          <div class="row" style="align-items:flex-start">${icon('coach', 'ic-l accent')}
            <div class="grow">
              <div class="strong">Le coach apprend ton métabolisme</div>
              <p class="card-sub">Après 14 jours de pesées et de journal, il estime ta vraie dépense et te propose un objectif ajusté. Il ne change jamais rien sans ton accord.</p>
              <div class="calc-lines">
                <div>Jours de données : <b>${Math.min(c.span, 14)} / 14</b></div>
                <div>Jours de journal rempli : <b>${Math.min(c.logged, 10)} / 10</b></div>
                <div>Pesées en début et en fin de période : <b>${Math.min(c.weighA, 3)} / 3</b> et <b>${Math.min(c.weighB, 3)} / 3</b></div>
              </div>
            </div>
          </div>
        </section>`;
    } else {
      const db = activeDietBreak(todayKey());
      const big = Math.abs(c.diff) >= 50 && !db;
      html += `
        <section class="card coach-box">
          <div class="row-between" style="align-items:flex-start">
            <div><div class="card-sub">Dépense réelle estimée</div><div class="coach-num">${fmt(round(c.tdee, -1))} <small class="muted" style="font-size:15px;font-weight:500">kcal/j</small></div></div>
            <div style="text-align:right"><div class="card-sub">Calcul initial</div><div class="strong">${fmt(round(baseGoals().t.tdee, -1))} kcal</div></div>
          </div>
          <div class="calc-lines">
            <div>Consommation moyenne : <b>${fmt(c.avgKcal)} kcal</b> (${c.logged} jours renseignés)</div>
            <div>Poids moyen : <b>${fmtKg(c.avgA)} → ${fmtKg(c.avgB)} kg</b> (${fmtSigned(c.delta, 2)} kg en ${fmt(c.days, 1)} jours)</div>
            <div>Rythme réel : <b>${fmtSigned(-c.weeklyPct, 2)} % par semaine</b> (visé : −${fmt(p.rate, 2)} %)</div>
            <div class="tiny">Dépense ≈ ${fmt(c.avgKcal)} − (${fmtSigned(c.delta, 2)} × 7 700 ÷ ${fmt(c.days, 1)})</div>
          </div>
          ${c.suspicious ? banner('warn', 'info', 'Données à vérifier', 'Le résultat est peu plausible : vérifie que tu notes bien tous tes repas et tes pesées.') : `
          <p style="margin-top:12px">${db
            ? `Pause diète en cours jusqu’au ${esc(fmtDate(db.end, 'long'))} : le coach reprendra ses propositions ensuite.`
            : big
              ? `Pour tenir ${fmt(p.rate, 2)} % par semaine, vise <b>${fmt(c.suggested)} kcal par jour</b> (actuellement ${fmt(c.current)}).`
              : 'Ton objectif actuel colle à ta progression : garde le cap !'}</p>
          ${c.floored ? `<p class="card-sub warn">Proposition limitée au plancher de sécurité (${fmt(floorKcal())} kcal).</p>` : ''}
          ${big ? `<div class="btn-row" style="margin-top:12px"><button class="btn" type="button" data-action="coach-later">Plus tard</button><button class="btn btn-primary" type="button" data-action="coach-apply" data-kcal="${c.suggested}">Appliquer</button></div>` : ''}`}
        </section>`;
    }
    if (pl) html += plateauCard(pl);
    return html;
  }

  function plateauCard(pl) {
    const cur = baseGoals().kcal;
    const floor = floorKcal();
    const steps = state.settings.stepsGoal;
    const maint = maintenanceKcal();
    return `
      <section class="card">
        <div class="row" style="align-items:flex-start">${icon('info', 'ic-l warn')}
          <div class="grow">
            <div class="strong">Plateau détecté</div>
            <p class="card-sub">Ton poids moyen n’a quasiment pas bougé en 14 jours (${fmtKg(pl.before)} → ${fmtKg(pl.now)} kg) alors que ton suivi est régulier. C’est fréquent en sèche : voici des solutions concrètes.</p>
          </div>
        </div>
        <div class="option-list">
          <div class="option">
            <div class="option-title">1. Réduire de 150 kcal par jour</div>
            <p>${fmt(cur)} → ${fmt(cur - 150)} kcal. Petit ajustement, facile à tenir.${cur - 150 < floor ? ' Impossible : tu es déjà proche du plancher de sécurité.' : ''}</p>
            <button class="btn btn-small btn-tinted" type="button" data-action="plateau-cut" ${cur - 150 < floor ? 'disabled' : ''}>Appliquer −150 kcal</button>
          </div>
          <div class="option">
            <div class="option-title">2. Bouger plus</div>
            <p>Environ 2 000 pas de plus par jour (≈ 80 à 100 kcal) : objectif ${fmt(steps)} → ${fmt(steps + 2000)} pas.</p>
            <button class="btn btn-small btn-tinted" type="button" data-action="plateau-steps">Monter mon objectif de pas</button>
          </div>
          <div class="option">
            <div class="option-title">3. Faire une pause diète (diet break)</div>
            <p>7 à 14 jours au maintien (≈ ${fmt(maint)} kcal) pour récupérer, mieux t’entraîner et relancer la suite. Le poids peut remonter un peu (eau, glycogène) : c’est normal.</p>
            <div class="btn-row"><button class="btn btn-small btn-tinted" type="button" data-action="diet-break" data-days="7">7 jours</button><button class="btn btn-small btn-tinted" type="button" data-action="diet-break" data-days="14">14 jours</button></div>
          </div>
        </div>
        <p class="card-sub" style="margin-top:10px">Vérifie aussi que tu pèses tes aliments et que tu notes tout (huile, sauces, boissons, grignotages).</p>
      </section>`;
  }

  ACTIONS['coach-view'] = () => {
    switchTab('progress');
    setTimeout(() => { const el = $('#coach'); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 60);
  };
  ACTIONS['coach-later'] = () => {
    state.coach.snoozeUntil = addDays(todayKey(), 7);
    save();
    render();
    toast('Le coach te le reproposera dans 7 jours');
  };
  ACTIONS['coach-apply'] = (el) => {
    const kcal = parseInt(el.dataset.kcal, 10);
    if (!isNum(kcal)) return;
    const from = baseGoals().kcal;
    confirmDialog({
      title: `Passer à ${fmt(kcal)} kcal par jour ?`,
      message: `Objectif actuel : ${fmt(from)} kcal. Les glucides s’ajustent automatiquement. Tu pourras revenir au calcul automatique dans Réglages › Objectifs.`,
      ok: 'Appliquer',
    }).then((ok) => {
      if (!ok) return;
      state.manualGoals.kcal = kcal;
      state.coach.history.push({ date: todayKey(), from, to: kcal, source: 'coach' });
      state.coach.snoozeUntil = null;
      save();
      render();
      toast('Nouvel objectif appliqué');
    });
  };
  ACTIONS['plateau-cut'] = () => {
    const from = baseGoals().kcal;
    const to = from - 150;
    if (to < floorKcal()) return;
    confirmDialog({ title: `Passer à ${fmt(to)} kcal par jour ?`, message: `Objectif actuel : ${fmt(from)} kcal.`, ok: 'Appliquer' }).then((ok) => {
      if (!ok) return;
      state.manualGoals.kcal = to;
      state.coach.history.push({ date: todayKey(), from, to, source: 'plateau' });
      save();
      render();
      toast('Objectif réduit de 150 kcal');
    });
  };
  ACTIONS['plateau-steps'] = () => {
    const to = state.settings.stepsGoal + 2000;
    confirmDialog({ title: `Objectif de ${fmt(to)} pas par jour ?`, message: 'Une marche de 20 minutes en plus suffit souvent.', ok: 'Valider' }).then((ok) => {
      if (!ok) return;
      state.settings.stepsGoal = to;
      save();
      render();
      toast('Objectif de pas mis à jour');
    });
  };
  ACTIONS['diet-break'] = (el) => {
    const days = parseInt(el.dataset.days, 10) || 7;
    const kcal = maintenanceKcal();
    const start = todayKey();
    const end = addDays(start, days - 1);
    confirmDialog({
      title: `Pause diète de ${days} jours ?`,
      message: `Jusqu’au ${fmtDate(end, 'long')}, ton objectif passe au maintien (${fmt(kcal)} kcal). Ton objectif de sèche reprendra ensuite automatiquement.`,
      ok: 'Commencer',
    }).then((ok) => {
      if (!ok) return;
      state.dietBreak = { start, end, kcal };
      save();
      render();
      toast('Pause diète lancée');
    });
  };
  ACTIONS['end-diet-break'] = () => {
    confirmDialog({ title: 'Terminer la pause diète ?', message: 'Ton objectif de sèche reprend dès aujourd’hui.', ok: 'Terminer' }).then((ok) => {
      if (!ok) return;
      state.dietBreak = null;
      save();
      render();
    });
  };

  /* ---------- Mensurations ---------- */
  function measuresCard() {
    const keys = Object.keys(state.measures).sort();
    const lastKey = keys[keys.length - 1];
    const last = lastKey ? state.measures[lastKey] : null;
    const valueFor = (m) => {
      const k = keys.slice().reverse().find((x) => isNum(state.measures[x][m.key]));
      return k ? { key: k, v: state.measures[k][m.key] } : null;
    };
    const firstFor = (m) => {
      const k = keys.find((x) => isNum(state.measures[x][m.key]));
      return k ? { key: k, v: state.measures[k][m.key] } : null;
    };
    return `
      <h2 class="section-title">Mensurations</h2>
      <section class="card">
        ${last ? `<div class="stats">${MEASURES.map((m) => {
          const cur = valueFor(m);
          const first = firstFor(m);
          const sub = cur && first && first.key !== cur.key ? `${fmtSigned(cur.v - first.v, 1)} cm depuis le ${fmtDate(first.key)}` : (cur ? `le ${fmtDate(cur.key)}` : 'non mesuré');
          return statTile(m.label, cur ? fmt(cur.v, 1) : '–', cur ? 'cm' : '', sub);
        }).join('')}</div>`
        : '<p class="card-sub" style="margin-top:0">Facultatif : mesure ton tour de taille, tes hanches, ton bras et ta cuisse toutes les 2 à 4 semaines. Le tour de taille baisse souvent même quand la balance stagne.</p>'}
        <div class="btn-row" style="margin-top:12px">
          <button class="btn btn-tinted" type="button" data-action="measure-add">Ajouter</button>
          ${keys.length ? '<button class="btn" type="button" data-action="measure-history">Historique</button>' : ''}
        </div>
      </section>`;
  }

  ACTIONS['measure-add'] = () => {
    const today = todayKey();
    const sheet = openSheet({ title: 'Mensurations', closeLabel: 'Annuler' });
    sheet.setBody(`
      <div class="form-list" style="margin-top:6px">
        <label class="field"><span class="field-label">Date</span><input class="input input-wide" type="date" name="date" value="${today}" max="${today}"></label>
        ${MEASURES.map((m) => numField(m.key, m.label, 'cm', state.measures[today] ? state.measures[today][m.key] : null, { placeholder: '–' })).join('')}
      </div>
      <p class="field-hint">Mesure toujours au même endroit, le matin : taille au niveau du nombril, bras et cuisse au plus large.</p>`);
    sheet.setFoot('<button class="btn btn-primary btn-block" type="button" data-act="save">Enregistrer</button>');
    const dateInput = $('[name="date"]', sheet.body);
    dateInput.addEventListener('change', () => {
      const m = state.measures[dateInput.value] || {};
      MEASURES.forEach((x) => { $(`[name="${x.key}"]`, sheet.body).value = fmtInput(m[x.key], 1); });
    });
    sheet.el.addEventListener('click', (ev) => {
      if (!ev.target.closest('[data-act="save"]')) return;
      const date = dateInput.value;
      if (!isKey(date) || date > today) { toast('Date invalide', { error: true }); return; }
      const o = {};
      let any = false;
      for (let i = 0; i < MEASURES.length; i++) {
        const m = MEASURES[i];
        const raw = $(`[name="${m.key}"]`, sheet.body).value.trim();
        if (raw === '') { o[m.key] = null; continue; }
        const v = parseNum(raw);
        if (!isNum(v) || v < 10 || v > 250) { toast(`${m.label} : valeur invalide (en cm)`, { error: true }); return; }
        o[m.key] = round(v, 1);
        any = true;
      }
      if (!any) { delete state.measures[date]; } else state.measures[date] = o;
      save();
      sheet.close();
      render();
      toast(any ? 'Mensurations enregistrées' : 'Mensurations effacées pour cette date');
    });
  };

  ACTIONS['measure-history'] = () => {
    const sheet = openSheet({ title: 'Historique des mensurations' });
    const draw = () => {
      const keys = Object.keys(state.measures).sort().reverse();
      sheet.setBody(keys.length ? `<div class="list" style="margin-top:6px">${keys.map((k) => {
        const m = state.measures[k];
        const txt = MEASURES.filter((x) => isNum(m[x.key])).map((x) => `${x.label.replace('Tour de taille', 'Taille')} ${fmt(m[x.key], 1)}`).join(' · ');
        return `<div class="list-item"><span class="li-main"><span class="li-title">${esc(cap(fmtDate(k, 'full')))}</span><span class="li-sub">${esc(txt)} cm</span></span><button class="icon-btn plain" type="button" data-act="del" data-key="${k}" aria-label="Supprimer">${icon('trash')}</button></div>`;
      }).join('')}</div>` : emptyHTML('info', 'Aucune mensuration', 'Ajoute tes premières mesures depuis l’onglet Progrès.'));
    };
    draw();
    sheet.el.addEventListener('click', (ev) => {
      const b = ev.target.closest('[data-act="del"]');
      if (!b) return;
      const k = b.dataset.key;
      const old = state.measures[k];
      delete state.measures[k];
      save(); draw(); render();
      toast('Mesure supprimée', { action: 'Annuler', onAction: () => { state.measures[k] = old; save(); draw(); render(); } });
    });
  };

  ACTIONS['weights-history'] = () => {
    const today = todayKey();
    const sheet = openSheet({ title: 'Historique des pesées' });
    const draw = () => {
      const keys = Object.keys(state.weights).sort().reverse();
      sheet.setBody(`
        <form class="card" data-role="add-past" style="margin-top:4px">
          <div class="strong" style="margin-bottom:8px">Ajouter ou corriger une pesée</div>
          <div class="row">
            <input class="input" type="date" name="date" value="${today}" max="${today}" aria-label="Date de la pesée" style="flex:1">
            <input class="input input-num" type="text" inputmode="decimal" name="kg" placeholder="kg" autocomplete="off" aria-label="Poids en kg">
            <button class="btn btn-primary btn-small" type="submit" style="min-height:44px">OK</button>
          </div>
        </form>
        ${keys.length ? `<div class="list" style="margin-top:12px">${keys.map((k, i) => {
          const prev = keys[i + 1];
          const d = prev ? state.weights[k] - state.weights[prev] : null;
          return `<div class="list-item"><span class="li-main"><span class="li-title">${fmtKg(state.weights[k])} kg</span><span class="li-sub">${esc(cap(fmtDate(k, 'long')))}${k.slice(0, 4) !== today.slice(0, 4) ? ' ' + k.slice(0, 4) : ''}${isNum(d) ? ` · ${fmtSigned(d, 1)} kg` : ''}</span></span><button class="icon-btn plain" type="button" data-act="del" data-key="${k}" aria-label="Supprimer cette pesée">${icon('trash')}</button></div>`;
        }).join('')}</div>` : emptyHTML('scale', 'Aucune pesée', 'Pèse-toi le matin, à jeun, après être passé aux toilettes.')}`);
    };
    draw();
    sheet.el.addEventListener('submit', (ev) => {
      ev.preventDefault();
      const f = ev.target;
      const date = f.elements.date.value;
      const v = parseNum(f.elements.kg.value);
      if (!isKey(date) || date > today) { toast('Date invalide', { error: true }); return; }
      if (!isNum(v) || v < 25 || v > 350) { toast('Poids invalide (exemple : 82,4)', { error: true }); return; }
      state.weights[date] = round(v, 2);
      save(); draw(); render();
      toast(`Pesée du ${fmtDate(date)} enregistrée`);
    });
    sheet.el.addEventListener('click', (ev) => {
      const b = ev.target.closest('[data-act="del"]');
      if (!b) return;
      const k = b.dataset.key;
      const old = state.weights[k];
      delete state.weights[k];
      save(); draw(); render();
      toast('Pesée supprimée', { action: 'Annuler', onAction: () => { state.weights[k] = old; save(); draw(); render(); } });
    });
  };

  /* ---------- Graphiques SVG faits maison ---------- */

  /** Graduations « rondes » pour l'axe vertical. */
  function niceTicks(min, max, count) {
    const span = Math.max(max - min, 1e-6);
    const raw = span / count;
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const r = raw / mag;
    const step = (r <= 1 ? 1 : r <= 2 ? 2 : r <= 2.5 ? 2.5 : r <= 5 ? 5 : 10) * mag;
    const out = [];
    for (let v = Math.floor(min / step) * step; v <= Math.ceil(max / step) * step + step / 2; v += step) out.push(round(v, 6));
    return out;
  }
  function barPath(cx, w, yBase, yTop) {
    const h = yBase - yTop;
    if (h <= 0.5) return '';
    const r = Math.min(4, w / 2, h);
    const x0 = cx - w / 2;
    const x1 = cx + w / 2;
    return `M${x0.toFixed(1)},${yBase.toFixed(1)}V${(yTop + r).toFixed(1)}Q${x0.toFixed(1)},${yTop.toFixed(1)} ${(x0 + r).toFixed(1)},${yTop.toFixed(1)}H${(x1 - r).toFixed(1)}Q${x1.toFixed(1)},${yTop.toFixed(1)} ${x1.toFixed(1)},${(yTop + r).toFixed(1)}V${yBase.toFixed(1)}Z`;
  }
  function linePath(values, X, Y) {
    let d = '';
    values.forEach((v, i) => { if (isNum(v)) d += `${d ? 'L' : 'M'}${X(i).toFixed(1)},${Y(v).toFixed(1)}`; });
    return d;
  }
  function stepPath(values, X, Y, slot) {
    let d = '';
    let prev = null;
    values.forEach((v, i) => {
      if (!isNum(v)) { prev = null; return; }
      const yy = Y(v).toFixed(1);
      d += prev === null ? `M${(X(i) - slot / 2).toFixed(1)},${yy}` : `V${yy}`;
      d += `H${(X(i) + slot / 2).toFixed(1)}`;
      prev = v;
    });
    return d;
  }
  function xLabelIdx(n) {
    if (n <= 7) return Array.from({ length: n }, (_, i) => i);
    return [0, Math.round((n - 1) / 3), Math.round(2 * (n - 1) / 3), n - 1];
  }

  /**
   * Dessine un graphique. cfg = { keys, series: [...], zeroBase, minSpan, aria, empty, legend, tip(i), table }
   * Séries : { type: 'bar'|'line'|'dots'|'step'|'hline', values, cls, value, scale }
   */
  function drawChart(el, cfg) {
    const n = cfg.keys.length;
    const hasData = cfg.series.some((s) => (s.type === 'bar' || s.type === 'dots') && s.values.some(isNum));
    if (!hasData) { el.innerHTML = `<div class="chart-empty">${esc(cfg.empty)}</div>`; return; }
    const W = Math.max(240, Math.round(el.getBoundingClientRect().width || 320));
    const H = 200;
    const m = { l: 44, r: 8, t: 14, b: 26 };
    const pw = W - m.l - m.r;
    const ph = H - m.t - m.b;
    const slot = pw / n;
    let vals = [];
    cfg.series.forEach((s) => { if (s.scale !== false) vals = vals.concat((s.values || [s.value]).filter(isNum)); });
    let lo = Math.min.apply(null, vals);
    let hi = Math.max.apply(null, vals);
    if (cfg.zeroBase) { lo = 0; hi = Math.max(hi * 1.08, 1); }
    else {
      const pad = Math.max((hi - lo) * 0.15, (cfg.minSpan || 1) / 2);
      lo -= pad;
      hi += pad;
    }
    const ticks = niceTicks(lo, hi, 4);
    lo = ticks[0];
    hi = ticks[ticks.length - 1];
    const X = (i) => m.l + (i + 0.5) * slot;
    const Y = (v) => m.t + ph - ((v - lo) / (hi - lo)) * ph;
    const step = ticks.length > 1 ? ticks[1] - ticks[0] : 1;
    const dec = step < 1 ? 1 : 0;
    let g = '';
    ticks.forEach((t) => {
      const yy = Y(t).toFixed(1);
      g += `<line class="ax-grid" x1="${m.l}" x2="${W - m.r}" y1="${yy}" y2="${yy}"/>`;
      g += `<text class="ax-label" x="${m.l - 6}" y="${yy}" text-anchor="end" dominant-baseline="middle">${fmt(t, dec)}</text>`;
    });
    const yBase = m.t + ph;
    g += `<line class="ax-base" x1="${m.l}" x2="${W - m.r}" y1="${yBase.toFixed(1)}" y2="${yBase.toFixed(1)}"/>`;
    const idx = xLabelIdx(n);
    idx.forEach((i, j) => {
      let anchor = 'middle';
      let xx = X(i);
      if (n > 7 && j === 0) { anchor = 'start'; xx = m.l; }
      if (n > 7 && j === idx.length - 1) { anchor = 'end'; xx = W - m.r; }
      const label = n <= 7 ? DF.wdShort.format(dateOf(cfg.keys[i])) : fmtDate(cfg.keys[i], 'short');
      g += `<text class="ax-label" x="${xx.toFixed(1)}" y="${H - 7}" text-anchor="${anchor}">${esc(label)}</text>`;
    });
    cfg.series.forEach((s) => {
      if (s.type === 'bar') {
        const bw = clamp(slot * 0.62, 1.5, 24);
        s.values.forEach((v, i) => { if (isNum(v) && v > 0) g += `<path class="${s.cls}" d="${barPath(X(i), bw, yBase, Y(Math.min(v, hi)))}"/>`; });
      } else if (s.type === 'step') {
        g += `<path class="s-goal" d="${stepPath(s.values, X, Y, slot)}"/>`;
      } else if (s.type === 'line') {
        g += `<path class="s-line ${s.cls}" d="${linePath(s.values, X, Y)}"/>`;
      } else if (s.type === 'dots') {
        const r = n > 45 ? 2.8 : 4;
        s.values.forEach((v, i) => { if (isNum(v)) g += `<circle class="s-dot ${s.cls}" cx="${X(i).toFixed(1)}" cy="${Y(v).toFixed(1)}" r="${r}"/>`; });
      } else if (s.type === 'hline' && isNum(s.value) && s.value >= lo && s.value <= hi) {
        const yy = Y(s.value).toFixed(1);
        g += `<line class="s-goal" x1="${m.l}" x2="${W - m.r}" y1="${yy}" y2="${yy}"/>`;
      }
    });
    g += `<line class="s-cross" x1="0" x2="0" y1="${m.t}" y2="${yBase.toFixed(1)}" visibility="hidden"/>`;
    g += `<rect class="s-hit" x="${m.l}" y="0" width="${pw}" height="${H}"/>`;

    el.innerHTML = `
      <svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" tabindex="0" aria-label="${esc(cfg.aria)}">${g}</svg>
      <div class="chart-tip" hidden></div>
      <div class="legend">${cfg.legend}</div>
      <details class="table-view"><summary>Voir les valeurs</summary><div class="table-scroll">${cfg.table}</div></details>`;

    /* Infobulle : un trait vertical suit le doigt et se cale sur le jour le plus proche. */
    const svg = $('svg', el);
    const tip = $('.chart-tip', el);
    const cross = $('.s-cross', el);
    let current = -1;
    let hideTimer = null;
    const show = (i) => {
      current = clamp(i, 0, n - 1);
      const xx = X(current);
      cross.setAttribute('x1', xx.toFixed(1));
      cross.setAttribute('x2', xx.toFixed(1));
      cross.removeAttribute('visibility');
      const info = cfg.tip(current);
      tip.textContent = '';
      const date = document.createElement('div');
      date.className = 'tip-date';
      date.textContent = cap(fmtDate(cfg.keys[current], 'long'));
      tip.appendChild(date);
      info.forEach((row) => {
        const r = document.createElement('div');
        r.className = 'tip-row';
        const key = document.createElement('i');
        key.className = row.key;
        const b = document.createElement('b');
        b.textContent = row.value;
        const sp = document.createElement('span');
        sp.textContent = row.label;
        r.appendChild(key); r.appendChild(b); r.appendChild(sp);
        tip.appendChild(r);
      });
      tip.hidden = false;
      const scale = svg.getBoundingClientRect().width / W;
      const tw = tip.offsetWidth;
      const left = clamp(xx * scale - tw / 2, 0, Math.max(0, svg.getBoundingClientRect().width - tw));
      tip.style.left = `${left}px`;
      tip.style.top = '-6px';
    };
    const hide = () => { current = -1; tip.hidden = true; cross.setAttribute('visibility', 'hidden'); };
    const fromEvent = (ev) => {
      const r = svg.getBoundingClientRect();
      const px = (ev.clientX - r.left) * (W / r.width);
      return Math.floor((px - m.l) / slot);
    };
    svg.addEventListener('pointerdown', (ev) => {
      clearTimeout(hideTimer);
      show(fromEvent(ev));
      if (ev.pointerType !== 'mouse') hideTimer = setTimeout(hide, 4000);
    });
    svg.addEventListener('pointermove', (ev) => {
      if (ev.pointerType === 'mouse' || ev.buttons) { clearTimeout(hideTimer); show(fromEvent(ev)); }
    });
    svg.addEventListener('pointerleave', (ev) => { if (ev.pointerType === 'mouse') hide(); });
    svg.addEventListener('focus', () => show(current >= 0 ? current : n - 1));
    svg.addEventListener('blur', hide);
    svg.addEventListener('keydown', (ev) => {
      if (ev.key === 'ArrowLeft') { ev.preventDefault(); show((current < 0 ? n : current) - 1); }
      if (ev.key === 'ArrowRight') { ev.preventDefault(); show((current < 0 ? -1 : current) + 1); }
      if (ev.key === 'Escape') hide();
    });
  }

  function tableHTML(head, rows) {
    if (!rows.length) return '<p class="chart-empty">Aucune valeur sur la période.</p>';
    return `<table class="data-table"><thead><tr>${head.map((h) => `<th scope="col">${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
  }

  function drawCharts() {
    const n = ui.range;
    const today = todayKey();
    const keys = [];
    for (let i = n - 1; i >= 0; i--) keys.push(addDays(today, -i));
    $$('[data-chart]').forEach((el) => {
      const kind = el.dataset.chart;
      if (kind === 'weight') drawWeightChart(el, keys);
      else drawNutriChart(el, keys, kind);
    });
  }

  function drawWeightChart(el, keys) {
    const goal = state.profile.goalWeight;
    const raw = keys.map((k) => (isNum(state.weights[k]) ? state.weights[k] : null));
    const avg = keys.map((k) => { const a = avgWeight(k, 7); return a ? round(a.avg, 2) : null; });
    const data = raw.concat(avg).filter(isNum);
    const dMin = data.length ? Math.min.apply(null, data) : goal;
    const dMax = data.length ? Math.max.apply(null, data) : goal;
    const near = goal >= dMin - Math.max(2, dMax - dMin) && goal <= dMax + 2;
    const rows = keys.map((k, i) => [k, raw[i], avg[i]]).filter((r) => isNum(r[1])).reverse()
      .map((r) => [fmtDate(r[0], 'shortY'), `${fmtKg(r[1])} kg`, isNum(r[2]) ? `${fmtKg(r[2])} kg` : '–']);
    drawChart(el, {
      keys,
      minSpan: 2,
      aria: `Poids sur ${keys.length} jours`,
      empty: 'Aucune pesée sur cette période. Enregistre ton poids ci-dessus.',
      series: [
        { type: 'hline', value: goal, scale: near, values: near ? [goal] : [] },
        { type: 'line', values: avg, cls: 'st-trend' },
        { type: 'dots', values: raw, cls: 'f-weight' },
      ],
      legend: `<span><i class="lg-dot bg-weight"></i>Pesées</span><span><i class="lg-line bg-trend"></i>Moyenne 7 jours</span><span><i class="lg-dash"></i>Objectif ${fmtKg(goal)} kg${near ? '' : ' (hors graphique)'}</span>`,
      tip: (i) => {
        const out = [];
        if (isNum(raw[i])) out.push({ key: 'bg-weight', value: `${fmtKg(raw[i])} kg`, label: 'pesée' });
        if (isNum(avg[i])) out.push({ key: 'bg-trend', value: `${fmtKg(avg[i])} kg`, label: 'moyenne 7 j' });
        if (!out.length) out.push({ key: '', value: '–', label: 'pas de pesée' });
        return out;
      },
      table: tableHTML(['Date', 'Pesée', 'Moyenne 7 j'], rows),
    });
  }

  function drawNutriChart(el, keys, kind) {
    const isK = kind === 'kcal';
    const unit = isK ? 'kcal' : 'g';
    const vals = keys.map((k) => (isLogged(k) ? round(dayTotals(k)[kind], 1) : null));
    const goals = keys.map((k) => dayGoals(k)[kind]);
    const label = isK ? 'Calories' : 'Protéines';
    const rows = keys.map((k, i) => [k, vals[i], goals[i]]).filter((r) => isNum(r[1])).reverse()
      .map((r) => [fmtDate(r[0], 'shortY'), `${fmt(r[1])} ${unit}`, `${fmt(r[2])} ${unit}`, `${fmt(r[2] > 0 ? r[1] / r[2] * 100 : 0)} %`]);
    drawChart(el, {
      keys,
      zeroBase: true,
      aria: `${label} par jour sur ${keys.length} jours, comparées à l’objectif`,
      empty: 'Aucun journal rempli sur cette période.',
      series: [
        { type: 'bar', values: vals, cls: isK ? 'f-kcal' : 'f-prot' },
        { type: 'step', values: goals },
      ],
      legend: `<span><i class="lg-rect ${isK ? 'bg-kcal' : 'bg-prot'}"></i>${label} consommé${isK ? 'es' : 'es'}</span><span><i class="lg-dash"></i>Objectif</span>`,
      tip: (i) => {
        const out = [];
        out.push(isNum(vals[i])
          ? { key: isK ? 'bg-kcal' : 'bg-prot', value: `${fmt(vals[i])} ${unit}`, label: isK ? 'consommées' : 'consommées' }
          : { key: '', value: '–', label: 'journal vide' });
        out.push({ key: 'bg-goal', value: `${fmt(goals[i])} ${unit}`, label: 'objectif' });
        return out;
      },
      table: tableHTML(['Date', label, 'Objectif', '%'], rows),
    });
  }

  /* ===========================================================================
     9. ONGLET ALIMENTS
     ========================================================================= */

  function foodsResults() {
    const f = ui.foodsFilter;
    let list;
    if (f === 'favs') list = favoriteFoods();
    else if (f === 'perso') list = state.customFoods.map(customToFood);
    else if (f === 'off') list = Object.keys(state.offFoods).map((c) => offToFood(state.offFoods[c]));
    else if (f === 'all') list = allFoods();
    else list = BASE_FOODS.filter((x) => x.cat === f);
    if (ui.foodsQuery) return searchFoods(ui.foodsQuery, { list, limit: 400 });
    if (f === 'favs') return list;
    return list.slice().sort((a, b) => a.name.localeCompare(b.name, 'fr'));
  }

  function foodsListHTML() {
    const list = foodsResults();
    if (!list.length) {
      if (ui.foodsQuery) return emptyHTML('search', 'Aucun résultat', 'Essaie un autre mot, ou crée l’aliment avec le bouton ＋ en haut.');
      if (ui.foodsFilter === 'favs') return emptyHTML('star', 'Aucun favori', 'Touche l’étoile d’un aliment pour le retrouver ici.');
      if (ui.foodsFilter === 'perso') return emptyHTML('plus', 'Aucun aliment perso', 'Crée tes recettes ou produits avec le bouton ＋ en haut.');
      if (ui.foodsFilter === 'off') return emptyHTML('barcode', 'Aucun produit scanné', 'Les produits scannés ou trouvés sur Open Food Facts apparaîtront ici, même hors ligne.');
      return emptyHTML('foods', 'Aucun aliment', '');
    }
    return `<div class="food-list">${list.map((f) => foodRowHTML(f, `data-action="food-detail" data-ref="${esc(f.ref)}"`)).join('')}</div>
      <p class="list-more">${list.length} aliment${list.length > 1 ? 's' : ''}</p>`;
  }

  function renderFoods() {
    const chips = [['all', 'Tous'], ['favs', '★ Favoris'], ['perso', 'Mes aliments'], ['off', 'Scannés']]
      .concat(Object.keys(DB.categories).filter((c) => c !== 'perso' && c !== 'off').map((c) => [c, `${DB.categories[c].icon} ${DB.categories[c].label}`]));
    return `
      <header class="topbar">
        <h1 class="topbar-title">Aliments</h1>
        <button class="icon-btn" type="button" data-action="scan-food" aria-label="Scanner un produit">${icon('barcode')}</button>
        <button class="icon-btn" type="button" data-action="create-food" aria-label="Créer un aliment">${icon('plus')}</button>
      </header>
      <div class="search" style="margin-top:4px">${icon('search')}
        <input type="search" enterkeyhint="search" placeholder="Rechercher (ex. : creme, poulet cuit)" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" value="${esc(ui.foodsQuery)}" data-input="foods-q" aria-label="Rechercher un aliment">
      </div>
      <div class="chips" style="margin-top:10px">${chips.map(([id, label]) => `<button class="chip ${ui.foodsFilter === id ? 'active' : ''}" type="button" data-action="foods-filter" data-filter="${id}">${esc(label)}</button>`).join('')}</div>
      <div data-role="foods-results">${foodsListHTML()}</div>
      ${state.savedMeals.length ? `<h2 class="section-title">Mes repas types</h2><div class="list">${state.savedMeals.map((sm) => savedMealRow(sm, 'data-action')).join('')}</div>` : ''}
      <p class="disclaimer">Valeurs moyennes pour 100 g, d’après la table Ciqual (ANSES), arrondies. Pour un produit précis, scanne son code-barres.</p>`;
  }

  INPUTS['foods-q'] = (el) => {
    ui.foodsQuery = el.value.trim();
    const box = $('[data-role="foods-results"]');
    if (box) box.innerHTML = foodsListHTML();
  };
  ACTIONS['foods-filter'] = (el) => { ui.foodsFilter = el.dataset.filter; render(); };
  ACTIONS['food-detail'] = (el) => openFoodDetail(el.dataset.ref);
  ACTIONS['create-food'] = () => openFoodForm({ onSaved: () => { ui.foodsFilter = 'perso'; render(); } });
  ACTIONS['saved-meal'] = (el) => openSavedMeal(el.dataset.id, { meal: guessMeal() });

  /* ===========================================================================
     ONGLET RÉGLAGES
     ========================================================================= */

  function goalRow(key, label, value, unit, manual) {
    const txt = key === 'water' ? `${fmtL(value)} L` : `${fmt(value)} ${unit}`;
    return `<button class="list-item goal-row" type="button" data-action="edit-goal" data-key="${key}">
      <i class="dot bg-${key}"></i>
      <span class="li-main"><span class="li-title">${label}</span></span>
      <span class="li-end"><b>${txt}</b> <span class="badge ${manual ? 'badge-accent' : ''}">${manual ? 'manuel' : 'auto'}</span></span>${icon('chev-right', 'li-chev')}
    </button>`;
  }

  function renderSettings() {
    const p = state.profile;
    const s = state.settings;
    const base = baseGoals();
    const mg = state.manualGoals;
    const anyManual = Object.keys(mg).some((k) => isNum(mg[k]));
    const plan = cyclingPlan(base);
    const act = activityOf(p.activity);
    return `
      <header class="topbar"><h1 class="topbar-title">Réglages</h1></header>

      <h2 class="section-title">Profil</h2>
      <div class="list">
        <button class="list-item" type="button" data-action="edit-profile">
          <span class="li-ico">${icon('edit')}</span>
          <span class="li-main"><span class="li-title">${p.sex === 'f' ? 'Femme' : 'Homme'} · ${fmt(p.age)} ans · ${fmt(p.height)} cm</span>
          <span class="li-sub">${fmtKg(p.weight)} kg → ${fmtKg(p.goalWeight)} kg · ${fmt(p.rate, 2)} %/sem. · ${esc(act.label)}${isNum(p.bodyFat) ? ` · MG ${fmt(p.bodyFat, 1)} %` : ''}</span></span>
          ${icon('chev-right', 'li-chev')}
        </button>
      </div>

      <h2 class="section-title">Objectifs quotidiens</h2>
      <div class="list">
        ${goalRow('kcal', 'Calories', base.kcal, 'kcal', isNum(mg.kcal))}
        ${goalRow('prot', 'Protéines', base.prot, 'g', isNum(mg.prot))}
        ${goalRow('gluc', 'Glucides', base.gluc, 'g', isNum(mg.gluc))}
        ${goalRow('lip', 'Lipides', base.lip, 'g', isNum(mg.lip))}
        ${goalRow('fib', 'Fibres', base.fib, 'g', isNum(mg.fib))}
        ${goalRow('water', 'Eau', base.water, 'ml', isNum(mg.water))}
        <button class="list-item" type="button" data-action="calc-detail"><span class="li-main"><span class="li-title accent">Voir le détail des calculs</span></span>${icon('chev-right', 'li-chev')}</button>
        ${anyManual ? '<button class="list-item" type="button" data-action="reset-goals"><span class="li-main"><span class="li-title accent">Tout remettre en automatique</span></span></button>' : ''}
      </div>
      <p class="section-note">Eau : + 0,5 L les jours d’entraînement.${state.dietBreak ? ' Une pause diète est programmée.' : ''}</p>
      ${warningsHTML(goalWarnings())}

      <h2 class="section-title">Répartition des macros</h2>
      <div class="card">
        <div class="row-between"><span class="strong">Protéines</span><span class="muted num" data-role="ppk-label">${fmt(s.proteinPerKg, 1)} g/kg · ${fmt(round(s.proteinPerKg * base.t.refWeight))} g</span></div>
        <input type="range" min="1.8" max="2.7" step="0.1" value="${s.proteinPerKg}" data-input="ppk-live" data-change="protein-per-kg" aria-label="Protéines en grammes par kilo">
        <div class="row-between" style="margin-top:12px"><span class="strong">Lipides</span><span class="muted num" data-role="fpk-label">${fmt(s.fatPerKg, 2)} g/kg · ${fmt(round(s.fatPerKg * base.t.refWeight))} g</span></div>
        <input type="range" min="0.6" max="1.2" step="0.05" value="${s.fatPerKg}" data-input="fpk-live" data-change="fat-per-kg" aria-label="Lipides en grammes par kilo">
        <p class="card-sub">Calculés sur ${base.t.useGoal ? 'ton poids objectif' : 'ton poids'} (${fmtKg(base.t.refWeight)} kg). Les glucides prennent le reste des calories. Lipides : jamais moins de 0,6 g/kg.${isNum(mg.prot) || isNum(mg.lip) ? ' Un objectif fixé à la main reste prioritaire.' : ''}</p>
      </div>

      <h2 class="section-title">Entraînement et cyclage</h2>
      <div class="card">
        <div class="strong" style="margin-bottom:8px">Jours d’entraînement</div>
        <div class="daypick">${WEEK_ORDER.map((d) => `<button type="button" data-action="toggle-train-day" data-day="${d}" class="${s.trainingDays.indexOf(d) >= 0 ? 'active' : ''}" aria-pressed="${s.trainingDays.indexOf(d) >= 0}">${WEEKDAY_SHORT[d]}</button>`).join('')}</div>
        <p class="card-sub">${s.trainingDays.length} jour${s.trainingDays.length > 1 ? 's' : ''} par semaine (profil : ${p.sessions} séance${p.sessions > 1 ? 's' : ''}). Tu peux aussi changer un jour précis depuis le journal.</p>
        <div class="divider"></div>
        <label class="row-between">
          <span><span class="strong">Cyclage des glucides</span><span class="track-sub">Plus de glucides les jours d’entraînement, même moyenne sur la semaine</span></span>
          <input class="switch" type="checkbox" data-change="carb-cycling" ${s.carbCycling ? 'checked' : ''} aria-label="Cyclage des glucides">
        </label>
        ${s.carbCycling ? `
          <div class="seg" style="margin-top:12px" role="group" aria-label="Écart entre les jours">${[10, 20, 30].map((v) => `<button type="button" data-action="cycling-gap" data-v="${v}" class="${s.cyclingGap === v ? 'active' : ''}">Écart ${v} %</button>`).join('')}</div>
          ${plan ? `<div class="calc-lines">
              <div>Jours d’entraînement : <b>${fmt(base.kcal + plan.train)} kcal</b> · glucides ${fmt(base.gluc + Math.round(plan.train / 4))} g</div>
              <div>Jours de repos : <b>${fmt(base.kcal - plan.rest)} kcal</b> · glucides ${fmt(Math.max(0, base.gluc - Math.round(plan.rest / 4)))} g</div>
              <div>Moyenne sur la semaine : <b>${fmt((plan.T * (base.kcal + plan.train) + plan.R * (base.kcal - plan.rest)) / 7)} kcal</b>${plan.limited ? ' (écart réduit pour garder assez de glucides les jours de repos)' : ''}</div>
            </div>` : '<p class="card-sub warn">Choisis entre 1 et 6 jours d’entraînement pour pouvoir cycler.</p>'}` : ''}
        <div class="divider"></div>
        <label class="row-between"><span class="strong">Objectif de pas</span>
          <input class="input input-wide num" type="text" inputmode="numeric" enterkeyhint="done" autocomplete="off" data-change="steps-goal" value="${s.stepsGoal}" aria-label="Objectif de pas par jour">
        </label>
      </div>

      <h2 class="section-title">Repas</h2>
      <div class="list">${s.meals.map((m, i) => `
        <div class="meal-edit ${m.hidden ? 'is-hidden' : ''}">
          <input class="input" type="text" maxlength="30" value="${esc(m.name)}" data-change="meal-name" data-id="${esc(m.id)}" aria-label="Nom du repas">
          <input class="input input-time" type="time" value="${esc(m.time)}" data-change="meal-time" data-id="${esc(m.id)}" aria-label="Heure habituelle de ${esc(m.name)}">
          <button class="icon-btn plain" type="button" data-action="meal-move" data-id="${esc(m.id)}" ${i === 0 ? 'disabled' : ''} aria-label="Monter ${esc(m.name)}">${icon('up')}</button>
          <button class="icon-btn plain" type="button" data-action="meal-hide" data-id="${esc(m.id)}" aria-label="${m.hidden ? 'Réafficher' : 'Masquer'} ${esc(m.name)}">${icon(m.hidden ? 'plus' : 'trash')}</button>
        </div>`).join('')}
      </div>
      <p class="section-note">L’heure sert à choisir le bon repas quand tu touches ＋. Un repas masqué reste visible les jours où il contient des aliments.</p>
      ${s.meals.length < MAX_MEALS ? `<button class="btn btn-tinted btn-block" type="button" style="margin-top:10px" data-action="meal-add-setting">${icon('plus')} Ajouter un repas</button>` : ''}

      <h2 class="section-title">Apparence</h2>
      <div class="seg" role="group" aria-label="Thème">${[['auto', 'Automatique'], ['light', 'Clair'], ['dark', 'Sombre']].map(([v, l]) => `<button type="button" data-action="theme" data-v="${v}" class="${s.theme === v ? 'active' : ''}">${l}</button>`).join('')}</div>

      <h2 class="section-title">Sauvegarde</h2>
      <div class="list">
        <button class="list-item" type="button" data-action="export-json"><span class="li-ico">${icon('share')}</span><span class="li-main"><span class="li-title">Exporter une sauvegarde</span><span class="li-sub">Dernière : ${esc(daysAgoText(state.meta.lastBackupAt))}</span></span></button>
        <button class="list-item" type="button" data-action="import-backup"><span class="li-ico">${icon('import')}</span><span class="li-main"><span class="li-title">Importer une sauvegarde</span><span class="li-sub">Remplace les données de ce téléphone</span></span></button>
        <button class="list-item" type="button" data-action="export-csv"><span class="li-ico">${icon('today')}</span><span class="li-main"><span class="li-title">Exporter en CSV</span><span class="li-sub">Pour Excel ou Numbers</span></span></button>
      </div>
      <p class="section-note">Tes données ne quittent jamais ce téléphone, sauf quand tu exportes. Enregistre la sauvegarde dans Fichiers ou iCloud Drive au moins une fois par semaine.</p>

      <h2 class="section-title">Application</h2>
      <div class="list">
        <button class="list-item" type="button" data-action="install-guide"><span class="li-ico">${icon('share')}</span><span class="li-main"><span class="li-title">Installer sur l’iPhone</span><span class="li-sub">${isStandalone() ? 'App installée ✓' : 'Ajouter à l’écran d’accueil'}</span></span>${icon('chev-right', 'li-chev')}</button>
        <div class="list-item"><span class="li-main"><span class="li-title">Version</span></span><span class="li-end" data-role="version">${esc(ui.swVersion || '–')}</span></div>
        <div class="list-item"><span class="li-main"><span class="li-title">Stockage</span><span class="li-sub">${esc(storageText())}</span></span></div>
        <button class="list-item li-danger" type="button" data-action="reset-app"><span class="li-ico">${icon('trash')}</span><span class="li-main"><span class="li-title">Réinitialiser l’app</span><span class="li-sub">Efface toutes les données de ce téléphone</span></span></button>
      </div>
      <p class="disclaimer">MacroSèche · Les calculs sont des estimations et ne remplacent pas un avis médical.<br>Aliments : table Ciqual (ANSES), valeurs arrondies · Produits : Open Food Facts (licence ODbL).</p>`;
  }

  function storageText() {
    let kb = 0;
    try { kb = Math.round(JSON.stringify(state).length / 1024); } catch (e) { kb = 0; }
    const persist = persistGranted === true ? 'protégées contre l’effacement automatique' : persistGranted === false ? 'stockage standard' : 'stockage local';
    return `${fmt(kb)} Ko de données · ${persist}`;
  }

  ACTIONS['edit-profile'] = () => {
    const sheet = openSheet({ title: 'Mon profil', closeLabel: 'Annuler' });
    mountProfileForm(sheet.body, state.profile, 'Enregistrer', (profile) => {
      const sessionsChanged = profile.sessions !== state.profile.sessions;
      state.profile = profile;
      state.meta.profileUpdatedAt = new Date().toISOString();
      if (sessionsChanged) state.settings.trainingDays = defaultTrainingDays(profile.sessions);
      save();
      sheet.close();
      render();
      toast(sessionsChanged ? 'Profil enregistré · jours d’entraînement mis à jour' : 'Profil enregistré, objectifs recalculés');
    });
  };

  ACTIONS['calc-detail'] = () => {
    const t = baseGoals().t;
    openSheet({ title: 'Détail des calculs', body: `<div class="card calc-detail" style="margin-top:4px">${calcDetailHTML(state.profile, t, state.settings)}</div>${warningsHTML(goalWarnings())}` });
  };

  const GOAL_META = {
    kcal: { label: 'Calories', unit: 'kcal', min: 800, max: 6000 },
    prot: { label: 'Protéines', unit: 'g', min: 30, max: 400 },
    gluc: { label: 'Glucides', unit: 'g', min: 0, max: 900 },
    lip: { label: 'Lipides', unit: 'g', min: 20, max: 300 },
    fib: { label: 'Fibres', unit: 'g', min: 5, max: 100 },
    water: { label: 'Eau', unit: 'ml', min: 500, max: 8000 },
  };
  ACTIONS['edit-goal'] = (el) => {
    const key = el.dataset.key;
    const meta = GOAL_META[key];
    if (!meta) return;
    const base = baseGoals();
    const auto = key === 'gluc' ? base.glucAuto : base.t[key];
    const cur = state.manualGoals[key];
    const minLip = Math.ceil(0.6 * base.t.refWeight);
    const hints = {
      kcal: 'Si tu fixes les calories, les glucides s’ajustent automatiquement (sauf s’ils sont aussi fixés).',
      prot: 'Repère : 1,8 à 2,7 g par kg de poids en sèche.',
      gluc: 'Attention : fixer les glucides peut rendre le total différent de ton objectif calorique.',
      lip: `Minimum conseillé : ${fmt(minLip)} g (0,6 g/kg), pour l’équilibre hormonal.`,
      fib: 'Repère : 25 à 35 g par jour (légumes, fruits, légumineuses, céréales complètes).',
      water: 'En millilitres. 500 ml sont ajoutés les jours d’entraînement.',
    };
    const sheet = openSheet({ title: meta.label, closeLabel: 'Annuler' });
    sheet.setBody(`
      <p class="section-note" style="margin-top:4px">Valeur calculée : <b>${key === 'water' ? fmtL(auto) + ' L' : fmt(auto) + ' ' + meta.unit}</b>${key === 'gluc' ? ' (le reste des calories)' : ''}.</p>
      <div class="form-list" style="margin-top:10px">${numField('v', 'Valeur fixée à la main', meta.unit, cur, { placeholder: fmtInput(auto, 0), dec: 0, mode: 'numeric' })}</div>
      <p class="field-hint">${esc(hints[key])}</p>`);
    sheet.setFoot('<div class="btn-row"><button class="btn" type="button" data-act="auto">Valeur auto</button><button class="btn btn-primary" type="button" data-act="save">Enregistrer</button></div>');
    sheet.el.addEventListener('click', (ev) => {
      const b = ev.target.closest('[data-act]');
      if (!b) return;
      if (b.dataset.act === 'auto') {
        state.manualGoals[key] = null;
        save(); sheet.close(); render();
        toast(`${meta.label} : calcul automatique`);
        return;
      }
      const raw = $('[name="v"]', sheet.body).value.trim();
      if (raw === '') { state.manualGoals[key] = null; save(); sheet.close(); render(); return; }
      const v = parseNum(raw);
      if (!isNum(v) || v < meta.min || v > meta.max) { toast(`Valeur entre ${fmt(meta.min)} et ${fmt(meta.max)} ${meta.unit}`, { error: true }); return; }
      if (key === 'lip' && v < minLip) { toast(`Minimum ${fmt(minLip)} g de lipides (0,6 g/kg)`, { error: true }); return; }
      state.manualGoals[key] = Math.round(v);
      save(); sheet.close(); render();
      toast(`${meta.label} fixé à ${key === 'water' ? fmtL(v) + ' L' : fmt(v) + ' ' + meta.unit}`);
    });
  };
  ACTIONS['reset-goals'] = () => {
    confirmDialog({ title: 'Revenir aux objectifs calculés ?', message: 'Toutes les valeurs fixées à la main seront remplacées par le calcul automatique.', ok: 'Confirmer' }).then((ok) => {
      if (!ok) return;
      Object.keys(state.manualGoals).forEach((k) => { state.manualGoals[k] = null; });
      save(); render();
      toast('Objectifs recalculés automatiquement');
    });
  };

  INPUTS['ppk-live'] = (el) => {
    const v = parseFloat(el.value);
    const lbl = $('[data-role="ppk-label"]');
    if (lbl) lbl.textContent = `${fmt(v, 1)} g/kg · ${fmt(round(v * baseGoals().t.refWeight))} g`;
  };
  INPUTS['fpk-live'] = (el) => {
    const v = parseFloat(el.value);
    const lbl = $('[data-role="fpk-label"]');
    if (lbl) lbl.textContent = `${fmt(v, 2)} g/kg · ${fmt(round(v * baseGoals().t.refWeight))} g`;
  };
  CHANGES['protein-per-kg'] = (el) => { state.settings.proteinPerKg = round(clamp(parseFloat(el.value), 1.8, 2.7), 1); save(); render(); };
  CHANGES['fat-per-kg'] = (el) => { state.settings.fatPerKg = round(clamp(parseFloat(el.value), 0.6, 1.2), 2); save(); render(); };

  ACTIONS['toggle-train-day'] = (el) => {
    const d = parseInt(el.dataset.day, 10);
    const list = state.settings.trainingDays;
    const i = list.indexOf(d);
    if (i >= 0) list.splice(i, 1); else list.push(d);
    save(); render();
  };
  CHANGES['carb-cycling'] = (el) => { state.settings.carbCycling = el.checked; save(); render(); };
  ACTIONS['cycling-gap'] = (el) => { state.settings.cyclingGap = parseInt(el.dataset.v, 10) || 20; save(); render(); };
  CHANGES['steps-goal'] = (el) => {
    const v = parseNum(el.value);
    if (!isNum(v) || v < 0 || v > 100000) { toast('Objectif de pas invalide', { error: true }); el.value = state.settings.stepsGoal; return; }
    state.settings.stepsGoal = Math.round(v);
    save(); render();
  };

  CHANGES['meal-name'] = (el) => {
    const m = state.settings.meals.find((x) => x.id === el.dataset.id);
    if (!m) return;
    const name = el.value.trim().slice(0, 30);
    if (!name) { el.value = m.name; return; }
    m.name = name;
    save();
  };
  CHANGES['meal-time'] = (el) => {
    const m = state.settings.meals.find((x) => x.id === el.dataset.id);
    if (m && /^\d{2}:\d{2}$/.test(el.value)) { m.time = el.value; save(); }
  };
  ACTIONS['meal-move'] = (el) => {
    const meals = state.settings.meals;
    const i = meals.findIndex((x) => x.id === el.dataset.id);
    if (i <= 0) return;
    const tmp = meals[i - 1];
    meals[i - 1] = meals[i];
    meals[i] = tmp;
    save(); render();
  };
  ACTIONS['meal-hide'] = (el) => {
    const m = state.settings.meals.find((x) => x.id === el.dataset.id);
    if (!m) return;
    if (!m.hidden && activeMeals().length <= 1) { toast('Il faut garder au moins un repas', { error: true }); return; }
    m.hidden = !m.hidden;
    save(); render();
    toast(m.hidden ? `« ${m.name} » masqué` : `« ${m.name} » réaffiché`);
  };
  ACTIONS['meal-add-setting'] = () => {
    if (state.settings.meals.length >= MAX_MEALS) return;
    state.settings.meals.push({ id: uid('m'), name: `Repas ${state.settings.meals.length + 1}`, time: '18:00', hidden: false });
    save(); render();
  };

  ACTIONS.theme = (el) => { state.settings.theme = el.dataset.v; save(); applyTheme(); render(); };

  function applyTheme() {
    const t = state.settings.theme;
    const root = document.documentElement;
    if (t === 'auto') root.removeAttribute('data-theme'); else root.setAttribute('data-theme', t);
    $$('meta[name="theme-color"]').forEach((m) => {
      if (!m.dataset.orig) m.dataset.orig = m.getAttribute('content');
      m.setAttribute('content', t === 'auto' ? m.dataset.orig : (t === 'dark' ? '#000000' : '#f2f2f7'));
    });
  }

  /* ===========================================================================
     10. SAUVEGARDE (JSON, CSV), RÉINITIALISATION, SERVICE WORKER, DÉMARRAGE
     ========================================================================= */

  function downloadFile(text, filename, mime) {
    const blob = new Blob([text], { type: `${mime};charset=utf-8` });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.rel = 'noopener';
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }

  /**
   * Partage un fichier via le menu Partager de l'iPhone (Enregistrer dans Fichiers, AirDrop…),
   * sinon le télécharge. Doit être appelé directement depuis un toucher (pas après un délai).
   * Renvoie une promesse : true si le fichier a été partagé ou téléchargé.
   */
  function shareOrDownload(text, filename, mime) {
    if (navigator.share && navigator.canShare) {
      const types = [mime, 'text/plain'];
      for (let i = 0; i < types.length; i++) {
        let file = null;
        try { file = new File([text], filename, { type: types[i] }); } catch (e) { break; }
        let ok = false;
        try { ok = navigator.canShare({ files: [file] }); } catch (e) { ok = false; }
        if (ok) {
          return navigator.share({ files: [file] }).then(() => true).catch((err) => {
            if (err && err.name === 'AbortError') return false;   // l'utilisateur a annulé
            downloadFile(text, filename, mime);
            return true;
          });
        }
      }
    }
    downloadFile(text, filename, mime);
    return Promise.resolve(true);
  }

  ACTIONS['export-json'] = () => {
    const payload = JSON.stringify({ app: 'MacroSeche', schemaVersion: SCHEMA_VERSION, exportedAt: new Date().toISOString(), data: state });
    shareOrDownload(payload, `macroseche-sauvegarde-${todayKey()}.json`, 'application/json').then((ok) => {
      if (!ok) return;
      state.meta.lastBackupAt = new Date().toISOString();
      state.meta.backupSnoozeUntil = null;
      save();
      render();
      toast('Sauvegarde exportée ✓');
    });
  };
  ACTIONS['snooze-backup'] = () => { state.meta.backupSnoozeUntil = addDays(todayKey(), 3); save(); render(); };

  ACTIONS['import-backup'] = () => {
    $$('input[data-import]').forEach((x) => x.remove());
    const input = document.createElement('input');
    input.type = 'file';
    input.setAttribute('data-import', '1');
    input.style.display = 'none';
    document.body.appendChild(input);
    input.addEventListener('change', () => {
      const file = input.files && input.files[0];
      input.remove();
      if (!file) return;
      file.text().then((text) => {
        let next;
        let exportedAt = null;
        try {
          let parsed;
          try { parsed = JSON.parse(text); } catch (e) { throw new Error('ce fichier n’est pas une sauvegarde MacroSèche'); }
          exportedAt = parsed && parsed.exportedAt;
          const data = parsed && parsed.app === 'MacroSeche' && parsed.data ? parsed.data : parsed;
          if (!isObj(data) || !('days' in data || 'profile' in data || 'settings' in data)) {
            throw new Error('ce fichier n’est pas une sauvegarde MacroSèche');
          }
          next = migrate(cloneData(data));
        } catch (err) {
          toast(`Import impossible : ${err.message}`, { error: true, duration: 5000 });
          return;
        }
        const nDays = Object.keys(next.days).filter((k) => next.days[k].entries.length).length;
        const nW = Object.keys(next.weights).length;
        const when = exportedAt && keyFromIso(exportedAt) ? `, exportée le ${fmtDate(keyFromIso(exportedAt), 'full')}` : '';
        confirmDialog({
          title: 'Importer cette sauvegarde ?',
          message: `${nDays} jour(s) de journal et ${nW} pesée(s)${when}.\nToutes les données actuelles de ce téléphone seront remplacées.`,
          ok: 'Importer',
          danger: true,
        }).then((ok) => {
          if (!ok) return;
          state = next;
          bootWarning = '';
          ui.day = todayKey();
          ui.tab = 'today';
          closeAllSheets();
          save();
          applyTheme();
          render();
          window.scrollTo(0, 0);
          toast('Sauvegarde importée ✓');
        });
      }).catch(() => toast('Lecture du fichier impossible', { error: true }));
    }, { once: true });
    input.click();
  };

  function csvCell(v) {
    if (v == null) return '';
    if (typeof v === 'number') return isNum(v) ? String(round(v, 2)).replace('.', ',') : '';
    let s = String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;   // évite les formules dans Excel
    return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }

  function exportCSV(kind) {
    const rows = [];
    const keys = Object.keys(state.days).sort();
    if (kind === 'entries') {
      rows.push(['Date', 'Repas', 'Aliment', 'Marque', 'Quantité', 'Unité', 'Portion', 'kcal', 'Protéines (g)', 'Glucides (g)', 'Lipides (g)', 'Fibres (g)']);
      keys.forEach((k) => state.days[k].entries.forEach((e) => rows.push([
        k, mealName(e.meal), e.name, e.brand, e.qty, isNum(e.qty) ? e.unit : '',
        e.portion ? `${fmt(e.portion.count, 2)} × ${e.portion.label}` : '',
        round(e.n.kcal, 0), e.n.prot, e.n.gluc, e.n.lip, e.n.fib,
      ])));
    } else {
      rows.push(['Date', 'kcal', 'Objectif kcal', 'Protéines (g)', 'Objectif protéines (g)', 'Glucides (g)', 'Lipides (g)', 'Fibres (g)', 'Eau (ml)', 'Pas', 'Poids (kg)', 'Entraînement']);
      Array.from(new Set(keys.concat(Object.keys(state.weights)))).sort().forEach((k) => {
        const logged = isLogged(k);
        const t = dayTotals(k);
        const g = dayGoals(k);
        const d = state.days[k];
        rows.push([k, logged ? round(t.kcal, 0) : null, g.kcal, logged ? t.prot : null, g.prot, logged ? t.gluc : null, logged ? t.lip : null, logged ? t.fib : null,
          d ? d.water : null, d ? d.steps : null, isNum(state.weights[k]) ? state.weights[k] : null, g.training ? 'oui' : 'non']);
      });
    }
    if (rows.length <= 1) { toast('Rien à exporter pour le moment'); return; }
    const csv = '﻿' + rows.map((r) => r.map(csvCell).join(';')).join('\r\n');
    shareOrDownload(csv, `macroseche-${kind === 'entries' ? 'journal' : 'resume'}-${todayKey()}.csv`, 'text/csv');
  }

  ACTIONS['export-csv'] = () => {
    const sheet = openSheet({
      title: 'Exporter en CSV',
      body: `
        <div class="list" style="margin-top:6px">
          <button class="list-item" type="button" data-act="entries"><span class="li-ico">${icon('today')}</span><span class="li-main"><span class="li-title">Journal détaillé</span><span class="li-sub">Une ligne par aliment</span></span></button>
          <button class="list-item" type="button" data-act="days"><span class="li-ico">${icon('progress')}</span><span class="li-main"><span class="li-title">Résumé par jour</span><span class="li-sub">Totaux, objectifs, eau, pas, poids</span></span></button>
        </div>
        <p class="section-note">Séparateur « ; » et virgule décimale : s’ouvre directement dans Excel ou Numbers.</p>`,
    });
    sheet.el.addEventListener('click', (ev) => {
      const b = ev.target.closest('[data-act]');
      if (!b) return;
      exportCSV(b.dataset.act);
      sheet.close();
    });
  };

  ACTIONS['reset-app'] = () => {
    confirmDialog({ title: 'Réinitialiser l’app ?', message: 'Journal, pesées, aliments perso et réglages seront effacés de ce téléphone.', ok: 'Continuer', danger: true }).then((ok1) => {
      if (!ok1) return;
      confirmDialog({ title: 'Vraiment tout effacer ?', message: 'Action irréversible. Exporte une sauvegarde avant si tu veux garder tes données.', ok: 'Tout effacer', danger: true }).then((ok2) => {
        if (!ok2) return;
        try { localStorage.removeItem(STORAGE_KEY); } catch (e) { /* ignore */ }
        state = defaultState();
        bootWarning = '';
        Object.assign(ui, { tab: 'today', day: todayKey(), onbDraft: null, onbResult: false, foodsFilter: 'all', foodsQuery: '' });
        closeAllSheets();
        save();
        applyTheme();
        render();
        window.scrollTo(0, 0);
        toast('Toutes les données ont été effacées');
      });
    });
  };

  /* ---------- Service worker : hors ligne et mises à jour ---------- */
  let waitingWorker = null;
  let updateAccepted = false;

  function showUpdateBanner(worker) {
    waitingWorker = worker;
    $('#update-banner').hidden = false;
  }
  ACTIONS['apply-update'] = () => {
    save();
    if (!waitingWorker) { location.reload(); return; }
    updateAccepted = true;
    waitingWorker.postMessage({ type: 'SKIP_WAITING' });
    setTimeout(() => location.reload(), 3000);   // filet de sécurité
  };

  function fetchSWVersion() {
    const ctrl = navigator.serviceWorker && navigator.serviceWorker.controller;
    if (!ctrl || typeof MessageChannel !== 'function') return;
    const ch = new MessageChannel();
    ch.port1.onmessage = (e) => {
      ui.swVersion = e.data && e.data.version ? String(e.data.version) : null;
      const el = $('[data-role="version"]');
      if (el && ui.swVersion) el.textContent = ui.swVersion;
    };
    ctrl.postMessage({ type: 'GET_VERSION' }, [ch.port2]);
  }

  function registerSW() {
    if (!('serviceWorker' in navigator) || location.protocol === 'file:') return;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (updateAccepted) location.reload();
      else fetchSWVersion();
    });
    navigator.serviceWorker.register('./sw.js').then((reg) => {
      if (reg.waiting && navigator.serviceWorker.controller) showUpdateBanner(reg.waiting);
      reg.addEventListener('updatefound', () => {
        const nw = reg.installing;
        if (!nw) return;
        nw.addEventListener('statechange', () => {
          if (nw.state === 'installed' && navigator.serviceWorker.controller) showUpdateBanner(nw);
        });
      });
      // Une app installée peut rester ouverte longtemps : on vérifie les mises à jour au retour.
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') reg.update().catch(() => {});
      });
    }).catch((err) => console.warn('Service worker non enregistré :', err));
    fetchSWVersion();
  }

  /* ---------- Démarrage ---------- */
  function init() {
    state = loadState();
    applyTheme();
    setupViewport();
    document.addEventListener('touchstart', () => {}, { passive: true });   // active l'effet :active sur iOS
    document.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape' && !$('.dialog-wrap') && !$('.scanner')) { const s = topSheet(); if (s) s.close(); }
    });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible' || !state) return;
      const t = todayKey();
      if (t !== ui.lastToday) {          // l'app est restée ouverte après minuit
        if (ui.day === ui.lastToday) ui.day = t;
        ui.lastToday = t;
        if (!sheetStack.length) render();
      }
    });
    window.addEventListener('resize', debounce(() => {
      if (ui.tab === 'progress' && state.profile) drawCharts();
    }, 200));
    // Si l'app est ouverte dans un autre onglet (ordinateur), on recharge ses données modifiées.
    window.addEventListener('storage', (ev) => {
      if (ev.key !== STORAGE_KEY || !ev.newValue) return;
      try { state = migrate(JSON.parse(ev.newValue)); render(); } catch (e) { /* données illisibles : on garde l'état actuel */ }
    });
    render();
    requestPersistence();
    registerSW();
  }

  // Accès pour le débogage depuis la console : window.MacroSeche.state
  window.MacroSeche = {
    get state() { return state; },
    version: SCHEMA_VERSION,
  };

  init();
})();
