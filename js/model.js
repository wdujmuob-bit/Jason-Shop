/* =====================================================================
   JASON SHOP — DATA MODEL, SCHEMA MIGRATIONS & INTEGRITY  (spec §49, §98–120)
   ---------------------------------------------------------------------
   Local-first: everything lives on Jason's phone. The saved object keeps
   the original (v1) fields untouched — fund, stop, spent, requests,
   receipts, manual, reportSummaries — so older app versions and old
   backups still work. New entities are added beside them.

   Pure functions only (no DOM/storage) → unit-tested in Node.
   Designed so a cloud database / multi-user roles can be added later:
   every entity has a stable string id, createdAt/updatedAt, and
   soft-delete (archived) instead of hard delete.
   ===================================================================== */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./calc.js"));
  else root.JasonModel = factory(root.JasonCalc);
}(typeof self !== "undefined" ? self : this, function (C) {
  "use strict";

  var SCHEMA_VERSION = 4;
  var APP_VERSION = "4.0.0-stage3";

  /* ---------- ids & helpers ---------- */

  var idCounter = 0;
  function newId(prefix) {
    idCounter = (idCounter + 1) % 1296;
    return (prefix || "id") + "_" + Date.now().toString(36) +
      idCounter.toString(36).padStart(2, "0") + Math.random().toString(36).slice(2, 6);
  }

  function nowISO() { return new Date().toISOString(); }

  function clone(x) { return x === undefined ? undefined : JSON.parse(JSON.stringify(x)); }

  function pad2(n) { return String(n).padStart(2, "0"); }

  // "YYYY-MM-DD" in the phone's own time zone.
  function localDay(value) {
    if (!value) return "";
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
    var d = new Date(value);
    if (isNaN(d)) return "";
    return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
  }

  // For matching names: "Johnny's Supermarket" → "johnnys supermarket", "S & R" → "s&r"
  function normalizeName(text) {
    return String(text || "").toLowerCase()
      .replace(/[’'`]/g, "")
      .replace(/[^a-z0-9&]+/g, " ")
      .replace(/\s*&\s*/g, "&")
      .replace(/\s+/g, " ")
      .trim();
  }

  function slug(text) { return normalizeName(text).replace(/&/g, " and ").replace(/\s+/g, "_"); }

  function arr(x) { return Array.isArray(x) ? x : []; }
  function firstOfMonth(day) { return String(day).slice(0, 8) + "01"; }

  /* ---------- reference data ---------- */

  var DEFAULT_CATEGORIES = [
    { name: "Groceries", icon: "🛒", color: "#67e09a" },
    { name: "Household", icon: "🧴", color: "#7fb0ff" },
    { name: "Electronics & Appliances", icon: "🔌", color: "#1769ff" },
    { name: "Baby & Kids", icon: "🍼", color: "#ff9ad5" },
    { name: "Pet", icon: "🐶", color: "#c49a6c" },
    { name: "Health & Personal Care", icon: "💊", color: "#ff6b6b" },
    { name: "Clothing", icon: "👕", color: "#b18cff" },
    { name: "Home & Furniture", icon: "🛋️", color: "#ffbd66" },
    { name: "Food & Dining", icon: "🍔", color: "#ff8a3d" },
    { name: "Other", icon: "📦", color: "#8e99ad" }
  ];

  // What a store tends to be used for (spec §2/§5). Labels only.
  var SHOPPING_TYPES = ["Groceries", "Fresh food", "Meat", "Poultry", "Seafood", "Vegetables", "Fruits",
    "Household supplies", "Cleaning supplies", "Personal care", "Baby & kids", "Pet supplies",
    "Bulk buying", "Imported products", "Electronics", "General"];

  // Seeded preferred stores (spec §4). Tendencies are starting guesses,
  // shown as "tendency" — never as facts — and Jason can edit them.
  var SEED_STORES = [
    { key: "newstar", name: "Newstar Shopping Mart", type: "supermarket",
      aliases: ["newstar", "new star", "newstar shopping mart", "newstar supermarket", "newstar mart"],
      tendencies: ["Groceries", "Household supplies"] },
    { key: "johnnys", name: "Johnny's Supermarket", type: "supermarket",
      aliases: ["johnnys", "johnny", "johnnys supermarket", "johnnys grocery"],
      tendencies: ["Groceries", "Household supplies"] },
    { key: "pampang", name: "Pampang Public Market", shortName: "Pampang Palengke", type: "public_market", location: "Angeles City",
      aliases: ["pampang", "pampang market", "pampang public market", "pampang palengke", "palengke pampang"],
      tendencies: ["Fresh food", "Meat", "Poultry", "Seafood", "Vegetables", "Fruits"] },
    { key: "landers", name: "Landers Superstore Angeles", shortName: "Landers", type: "membership", membership: true, location: "Angeles City",
      aliases: ["landers", "landers superstore", "landers angeles", "landers superstore angeles"],
      tendencies: ["Bulk buying", "Imported products", "Groceries", "Household supplies"] },
    { key: "snr", name: "S&R Membership Shopping", shortName: "S&R", type: "membership", membership: true,
      aliases: ["s&r", "snr", "s and r", "s&r membership", "s&r membership shopping", "s&r warehouse"],
      tendencies: ["Bulk buying", "Imported products", "Groceries"] },
    { key: "puregold", name: "Puregold", type: "supermarket",
      aliases: ["puregold", "puregold price club", "puregold supermarket"],
      tendencies: ["Groceries", "Household supplies", "Personal care"] },
    { key: "dutyfree", name: "Puregold Duty Free Clark", shortName: "Duty Free", type: "duty_free", location: "Clark",
      aliases: ["duty free", "puregold duty free", "duty free clark", "puregold duty free clark", "dfp clark"],
      tendencies: ["Imported products"] }
  ];

  var STORE_TYPES = {
    supermarket: "Supermarket", public_market: "Public market (palengke)", membership: "Membership store",
    duty_free: "Duty free", online: "Online shop", pharmacy: "Pharmacy", hardware: "Hardware", other: "Other"
  };

  var MEMBER_TYPES = [
    { type: "adults", label: "Adults", icon: "🧑" },
    { type: "children", label: "Children", icon: "🧒" },
    { type: "nannies", label: "Nannies", icon: "👩‍🍼" },
    { type: "maids", label: "Maids", icon: "🧹" },
    { type: "security", label: "Security / bodyguards", icon: "🛡️" },
    { type: "drivers", label: "Drivers", icon: "🚗" },
    { type: "other_staff", label: "Other staff", icon: "👷" },
    { type: "pets", label: "Pets", icon: "🐾" }
  ];

  // Who a product is for (spec §3).
  var SCOPE_TYPES = { household: "Whole household", house: "Specific house", adults: "Adults", children: "Children", staff: "Staff", pets: "Pets", group: "Custom group" };

  // Every price carries its source and status (spec §38). Never invented.
  var PRICE_SOURCES = {
    receipt: { label: "From receipt", icon: "🧾", status: "confirmed" },
    purchase: { label: "What you paid", icon: "🛍️", status: "confirmed" },
    manual: { label: "Entered by you", icon: "✍️", status: "confirmed" },
    shelf: { label: "Shelf price you saw", icon: "🏷️", status: "confirmed" },
    online: { label: "Online listing you saw", icon: "🌐", status: "listing" },
    ai_estimate: { label: "AI estimate — unverified", icon: "🤖", status: "unverified" }
  };

  var DEFAULT_SETTINGS = {
    thresholds: { watch: 70, warning: 85, hardStop: 100 },
    budgetPeriod: { type: "monthly", startDay: 1 },
    currency: "PHP",
    // Stage 2
    cycle: { mode: "days", lengthDays: 15, anchorDate: null },     // anchor set at upgrade (1st of that month)
    inventory: { lowDays: 7, urgentDays: 3, expirySoonDays: 3, bufferDays: 3, duplicateWindowDays: 7 },
    // Stage 3
    route: { mode: "balance", betweenStoresMinutes: 10, betweenStoresKm: 3, shoppingMinutes: 20, timeValuePerHour: 100, fuelPerKm: null },
    fund: { expensiveAt: 5000 },                    // fund check shown automatically from this amount
    priceAlerts: { dropPct: 5, enabled: true },
    recurring: { autoCommitDaysBefore: 7 }
  };

  // Stage 3: alert center kinds, recurring purchase units.
  var ALERT_KINDS = {
    price_drop: { icon: "📉", label: "Price drop" }, target_hit: { icon: "🎯", label: "Target price reached" },
    recurring: { icon: "🔁", label: "Recurring purchase" }, low_stock: { icon: "🥫", label: "Running low" },
    expiry: { icon: "⏰", label: "Expiring" }, fund: { icon: "💰", label: "Budget" }
  };
  var RECURRING_UNITS = { days: "day(s)", weeks: "week(s)", months: "month(s)" };

  // Where things are kept at home (Stage 2 inventory).
  var INVENTORY_LOCATIONS = { pantry: "Pantry", fridge: "Fridge", freezer: "Freezer", storeroom: "Storeroom", bathroom: "Bathroom", laundry: "Laundry", pets: "Pet supplies", other: "Other" };
  var LIST_PRIORITIES = { 1: "High", 2: "Normal", 3: "Low" };
  var MATCH_CONFIDENCE = {
    high: { icon: "✅", label: "High", text: "Exact name or a name you confirmed" },
    review: { icon: "🔎", label: "Review", text: "Looks similar — please check" },
    unknown: { icon: "❔", label: "Unknown", text: "New name — added as a new product" }
  };

  // §49 entity collections (Stage 2+ ones are reserved now so the layout is stable).
  var COLLECTIONS = ["requests", "receipts", "manual",
    "houses", "memberGroups", "stores", "products", "priceRecords",
    "budgetCategories", "commitments", "reserves", "auditLog", "backupLog",
    "inventoryItems", "inventoryTransactions", "shoppingLists", "shoppingCycles", "trips",
    "recurring", "alerts"];

  /* ---------- factories ---------- */

  function seedStores(at) {
    return SEED_STORES.map(function (s) {
      return {
        id: "store_" + s.key, name: s.name, shortName: s.shortName || "", type: s.type,
        location: s.location || "", aliases: s.aliases.slice(), tendencies: s.tendencies.slice(),
        membership: s.membership === true ? true : null, preferred: true, custom: false, seeded: true,
        notes: "", archived: false, createdAt: at, updatedAt: at
      };
    });
  }

  function seedCategories(at) {
    return DEFAULT_CATEGORIES.map(function (c) {
      return { id: "cat_" + slug(c.name), name: c.name, icon: c.icon, color: c.color, builtIn: true, archived: false, createdAt: at };
    });
  }

  function seedHousehold(at) {
    var house = { id: "house_main", name: "Main house", primary: true, notes: "", archived: false, createdAt: at, updatedAt: at };
    var groups = MEMBER_TYPES.map(function (m) {
      return { id: "grp_main_" + m.type, houseId: house.id, type: m.type, label: m.label, count: 0, weight: 1, archived: false, createdAt: at, updatedAt: at };
    });
    return { houses: [house], memberGroups: groups };
  }

  function createEmpty() {
    var at = nowISO();
    var d = { fund: 0, stop: 0, spent: 0, requests: [], receipts: [], manual: [], reportSummaries: {} };
    return migrate(d).data;
  }

  /* ---------- legacy (v1) normalisation — exactly what the app always did ---------- */

  function normalizeLegacy(d) {
    d = d && typeof d === "object" ? d : {};
    d.fund = Number(d.fund) || 0;
    d.stop = Number(d.stop) || 0;
    d.spent = Number(d.spent) || 0;
    d.requests = arr(d.requests);
    d.receipts = arr(d.receipts);
    d.manual = arr(d.manual);
    d.reportSummaries = d.reportSummaries && typeof d.reportSummaries === "object" ? d.reportSummaries : {};
    d.requests.forEach(function (r, i) {
      if (!r.id) r.id = "R" + Date.now() + "-" + i;
      if (r.status === "researching" && !r.jobId) { r.status = "error"; r.error = "Research was interrupted. Tap Retry."; }
    });
    d.receipts.forEach(function (r, i) {
      if (!r.id) r.id = "RC" + Date.now() + "-" + i;
      if (r.amount && r.total == null) { r.total = Number(r.amount) || 0; r.addedToSpent = true; }
      delete r.amount;
    });
    d.manual.forEach(function (m, i) { if (!m.id) m.id = "M" + Date.now() + "-" + i; });
    return d;
  }

  // Every load (any version): containers exist, settings valid. Additive only.
  function ensureShape(d) {
    normalizeLegacy(d);
    COLLECTIONS.forEach(function (k) { d[k] = arr(d[k]); });
    d.settings = d.settings && typeof d.settings === "object" ? d.settings : {};
    if (!d.settings.thresholds || !C.validateThresholds(d.settings.thresholds).ok) d.settings.thresholds = clone(DEFAULT_SETTINGS.thresholds);
    if (!d.settings.budgetPeriod) d.settings.budgetPeriod = clone(DEFAULT_SETTINGS.budgetPeriod);
    if (!d.settings.currency) d.settings.currency = "PHP";
    var cyc = d.settings.cycle;
    if (!cyc || !C.validateCycle(Object.assign({}, cyc, { anchorDate: cyc.anchorDate || firstOfMonth(localDay(new Date())) })).ok) cyc = clone(DEFAULT_SETTINGS.cycle);
    if (!cyc.anchorDate) cyc.anchorDate = firstOfMonth(localDay(new Date()));
    d.settings.cycle = cyc;
    d.settings.inventory = Object.assign({}, DEFAULT_SETTINGS.inventory, d.settings.inventory && typeof d.settings.inventory === "object" ? d.settings.inventory : {});
    ["route", "fund", "priceAlerts", "recurring"].forEach(function (k) {
      d.settings[k] = Object.assign({}, DEFAULT_SETTINGS[k], d.settings[k] && typeof d.settings[k] === "object" ? d.settings[k] : {});
    });
    if (!C.ROUTE_MODES[d.settings.route.mode]) d.settings.route.mode = "balance";
    var L = d.learning && typeof d.learning === "object" ? d.learning : {};
    d.learning = {
      terms: L.terms && typeof L.terms === "object" ? L.terms : {},              // "bigas" → product id / name Jason corrected to
      storePrefs: L.storePrefs && typeof L.storePrefs === "object" ? L.storePrefs : {},   // productId → { storeId, count }
      routeModeCounts: L.routeModeCounts && typeof L.routeModeCounts === "object" ? L.routeModeCounts : {},
      corrections: arr(L.corrections),
      alertScanAt: L.alertScanAt || null
    };
    if (!d.budgetPlan || typeof d.budgetPlan !== "object") d.budgetPlan = { mode: "peso", items: [], updatedAt: null };
    d.budgetPlan.items = arr(d.budgetPlan.items);
    if (d.budgetPlan.mode !== "percent") d.budgetPlan.mode = "peso";
    d.meta = d.meta && typeof d.meta === "object" ? d.meta : {};
    d.meta.migrations = arr(d.meta.migrations);
    return d;
  }

  /* ---------- matching (exact only — different things are never merged) ---------- */

  function findStoreByName(stores, name) {
    var n = normalizeName(name);
    if (!n) return null;
    var list = arr(stores).filter(function (s) { return !s.archived; });
    return list.find(function (s) { return normalizeName(s.name) === n || normalizeName(s.shortName) === n; }) ||
      list.find(function (s) { return arr(s.aliases).some(function (a) { return normalizeName(a) === n; }); }) || null;
  }

  function productKey(p) {
    return [normalizeName(p.name), normalizeName(p.brand), normalizeName(p.variant),
      p.size === null || p.size === undefined || p.size === "" ? "" : String(Number(p.size)), C.normalizeUnit(p.unit) || ""].join("|");
  }

  function findProductByName(products, name) {
    var n = normalizeName(name);
    if (!n) return null;
    var list = arr(products).filter(function (p) { return !p.archived; });
    return list.find(function (p) { return normalizeName(p.name) === n; }) ||
      list.find(function (p) { return arr(p.aliases).some(function (a) { return normalizeName(a) === n; }); }) || null;
  }

  /* ---------- receipt-line → product matching with confidence (Stage 2) ---------- */

  var SIZE_TOKEN = /^(\d+(\.\d+)?)?(x\d+(\.\d+)?)?(mg|g|gm|gms|grams?|kg|kgs|kilos?|ml|l|lt|ltr|ltrs|liters?|litres?|cc|oz|lb|lbs|pcs?|pieces?|rolls?|packs?|sachets?|bottles?|cans?|doz|dozen|trays?|bundles?|bags?|sacks?|x)?$/;
  function coreTokens(text) {
    return normalizeName(text).replace(/&/g, " ").split(" ").filter(function (t) { return t && !SIZE_TOKEN.test(t) && t.length > 1; });
  }
  function jaccard(a, b) {
    if (!a.length || !b.length) return 0;
    var A = {}, inter = 0, union = {};
    a.forEach(function (t) { A[t] = true; union[t] = true; });
    b.forEach(function (t) { if (A[t] && !union["#" + t]) { inter++; union["#" + t] = true; } union[t] = true; });
    var u = Object.keys(union).filter(function (k) { return k[0] !== "#"; }).length;
    return inter / u;
  }
  function sameSize(a, b) {
    if (!a || !b) return null;                       // unknown on one side
    return a.unit === b.unit && Math.abs(a.size - b.size) < 1e-9 && (a.packCount || 1) === (b.packCount || 1);
  }

  /*
    matchProduct(products, name) → { confidence: "high"|"review"|"unknown", product, score, reason }
      high    — exact name or a saved alias (incl. names Jason confirmed before)
      review  — similar words (≥ 50% overlap) or same words with a different size → suggested, never merged silently
      unknown — nothing similar
  */
  function matchProduct(products, name) {
    var n = normalizeName(name);
    var list = arr(products).filter(function (p) { return !p.archived; });
    if (!n) return { confidence: "unknown", product: null, score: 0, reason: "empty" };
    var exact = findProductByName(list, name);
    if (exact) return { confidence: "high", product: exact, score: 1, reason: normalizeName(exact.name) === n ? "exact_name" : "alias" };
    var tok = coreTokens(name), size = C.parseSize(name);
    var best = null;
    list.forEach(function (p) {
      [p.name].concat(arr(p.aliases)).forEach(function (label) {
        var t = coreTokens([p.brand, label, p.variant].filter(Boolean).join(" "));
        var t2 = coreTokens(label);
        var sc = Math.max(jaccard(tok, t), jaccard(tok, t2));
        if (!best || sc > best.score) best = { product: p, score: sc, label: label };
      });
    });
    if (best && best.score >= 0.5) {
      var ps = best.product.size ? { size: best.product.size, unit: best.product.unit, packCount: best.product.packCount || 1 } : C.parseSize(best.label);
      var same = sameSize(size, ps);
      return { confidence: "review", product: best.product, score: Math.round(best.score * 100) / 100, reason: same === false ? "different_size" : "similar_name" };
    }
    return { confidence: "unknown", product: null, score: best ? Math.round(best.score * 100) / 100 : 0, reason: "no_match" };
  }

  // Same receipt saved twice? Same receipt number at the same store, or same store + date + total.
  function findDuplicateReceipt(receipts, cand) {
    var c = cand || {};
    var store = normalizeName(c.store), num = String(c.receiptNumber || "").replace(/\s+/g, "").toLowerCase();
    var total = Number(c.total);
    var date = c.receiptDate || "";
    var hit = null;
    arr(receipts).some(function (r) {
      if (!r || r.id === c.id) return false;
      var rs = normalizeName(r.store), rn = String(r.receiptNumber || "").replace(/\s+/g, "").toLowerCase();
      if (num && rn && num === rn && (!store || !rs || store === rs)) { hit = { receipt: r, reason: "same_number" }; return true; }
      var rd = r.receiptDate || (r.date ? localDay(r.date) : "");
      if (store && rs === store && date && rd === date && isFinite(total) && Math.abs((Number(r.total) || 0) - total) < 0.01) { hit = { receipt: r, reason: "same_store_date_total" }; return true; }
      return false;
    });
    return hit;
  }

  function makeInventoryItem(fields, at) {
    var f = fields || {};
    var q = C.num(f.quantity);
    return {
      id: f.id || newId("inv"),
      name: String(f.name || "").trim(),
      productId: f.productId || null,
      location: INVENTORY_LOCATIONS[f.location] ? f.location : "pantry",
      unit: String(f.unit || "pcs").trim() || "pcs",
      quantity: q !== null && q >= 0 ? q : 0,
      minQty: C.num(f.minQty) > 0 ? C.num(f.minQty) : null,
      packSize: C.num(f.packSize) > 0 ? C.num(f.packSize) : 1,
      usage: { mode: f.usage && f.usage.mode || "auto", perDay: C.num(f.usage && f.usage.perDay), perPersonPerDay: C.num(f.usage && f.usage.perPersonPerDay), perPetPerDay: C.num(f.usage && f.usage.perPetPerDay) },
      houseId: f.houseId || null,
      perishable: f.perishable === true,
      expiryDate: f.expiryDate || null,
      shelfLifeDays: C.num(f.shelfLifeDays) > 0 ? C.num(f.shelfLifeDays) : null,
      learnedAtPeople: null,
      notes: f.notes || "",
      archived: false,
      createdAt: at, updatedAt: at
    };
  }

  function makeList(name, at) {
    return { id: newId("list"), name: name || "Shopping list", status: "active", items: [], createdAt: at, updatedAt: at };
  }

  function makeListItem(fields, at) {
    var f = fields || {};
    var q = C.num(f.qty);
    return {
      id: f.id || newId("li"),
      name: String(f.name || "").trim(),
      productId: f.productId || null,
      inventoryItemId: f.inventoryItemId || null,
      qty: q > 0 ? q : 1,
      unit: f.unit || "",
      kind: f.kind === "want" ? "want" : "need",
      priority: [1, 2, 3].indexOf(Number(f.priority)) >= 0 ? Number(f.priority) : 2,
      pinned: f.pinned === true,
      storeId: f.storeId || null,
      categoryName: f.categoryName || "",
      status: "open",
      addedFrom: f.addedFrom || "manual",
      cycleStart: f.cycleStart || null,
      note: f.note || "",
      createdAt: at, updatedAt: at
    };
  }

  var NOT_A_PRODUCT = /^(vat|vatable|vat exempt|discount|less|subtotal|sub total|total|change|cash|amount due|senior|pwd|service charge|tip|delivery fee|shipping|bag fee|points?)\b/i;

  function makeProduct(fields, at) {
    var size = C.num(fields.size);
    return {
      id: fields.id || newId("prod"),
      name: String(fields.name || "").trim(),
      brand: String(fields.brand || "").trim(),
      variant: String(fields.variant || "").trim(),
      size: size !== null && size > 0 ? size : null,
      unit: C.normalizeUnit(fields.unit) || null,
      packCount: C.num(fields.packCount) > 1 ? C.num(fields.packCount) : null,
      categoryName: fields.categoryName || "",
      aliases: arr(fields.aliases).map(function (a) { return String(a).trim(); }).filter(Boolean),
      scope: fields.scope && fields.scope.type ? { type: fields.scope.type, refId: fields.scope.refId || null } : { type: "household", refId: null },
      notes: fields.notes || "",
      createdFrom: fields.createdFrom || "manual",
      sizeSource: fields.sizeSource || (size ? "entered" : null),
      archived: false,
      createdAt: at, updatedAt: at
    };
  }

  // Receipt lines → products (exact-name match or new) + price records.
  // Idempotent: a line that already has a price record is skipped.
  function priceRecordsFromReceipt(d, receipt, opts) {
    var at = (opts && opts.at) || nowISO();
    var legacy = !!(opts && opts.legacy);
    var created = { products: 0, priceRecords: 0, high: 0, review: 0, unknown: 0, lines: [] };
    if (!receipt || !receipt.id) return created;
    var existing = {};
    d.priceRecords.forEach(function (pr) {
      if (pr.sourceRef && pr.sourceRef.type === "receipt" && pr.sourceRef.id === receipt.id) existing[pr.sourceRef.line] = true;
    });
    var store = findStoreByName(d.stores, receipt.store);
    var date = receipt.receiptDate || localDay(receipt.date);
    arr(receipt.items).forEach(function (it, line) {
      if (existing[line]) return;
      var name = String((it && it.name) || "").trim();
      var price = C.num(it && it.price);
      if (!name || price === null || price <= 0 || NOT_A_PRODUCT.test(name)) return;
      var m = legacy ? (function () { var x = findProductByName(d.products, name); return x ? { confidence: "high", product: x, reason: "exact_name" } : { confidence: "unknown", product: null, reason: "no_match" }; })() : matchProduct(d.products, name);
      var product = m.product;
      var confidence = legacy ? "high" : m.confidence;     // v1 upgrade: each new product IS that exact receipt name
      if (!product) {
        var parsed = C.parseSize(name);
        product = makeProduct({
          name: name, size: parsed ? parsed.size : null, unit: parsed ? parsed.unit : null,
          packCount: parsed ? parsed.packCount : null, categoryName: receipt.category || "",
          createdFrom: "receipt", sizeSource: parsed ? "read_from_name" : null
        }, at);
        d.products.push(product);
        created.products++;
      }
      var qty = C.num(it.qty);
      d.priceRecords.push({
        id: newId("price"), productId: product.id, itemName: name,
        storeId: store ? store.id : null, storeName: String(receipt.store || "").trim(),
        price: C.round2(price), qty: qty !== null && qty > 0 ? qty : 1,
        date: date || localDay(at), source: "receipt", status: PRICE_SOURCES.receipt.status,
        sourceRef: { type: "receipt", id: receipt.id, line: line },
        matchConfidence: confidence, matchReason: m.reason, needsReview: confidence !== "high",
        note: "", archived: false, createdAt: at
      });
      created.priceRecords++;
      created[confidence]++;
      created.lines.push({ line: line, productId: product.id, confidence: confidence, recordId: d.priceRecords[d.priceRecords.length - 1].id, qty: qty !== null && qty > 0 ? qty : 1 });
    });
    return created;
  }

  /* ---------- Stage 3 helpers ---------- */

  function makeRecurring(fields, at) {
    var every = fields.every || {};
    var n = Math.max(1, Math.floor(Number(every.n) || 1));
    return {
      id: fields.id || newId("rec"),
      title: String(fields.title || "").trim(),
      amount: C.round2(Math.max(0, Number(fields.amount) || 0)),
      categoryName: fields.categoryName || "",
      storeId: fields.storeId || null,
      productId: fields.productId || null,
      every: { unit: RECURRING_UNITS[every.unit] ? every.unit : "months", n: n },
      nextDue: fields.nextDue || localDay(at),
      autoCommit: fields.autoCommit !== false,
      active: fields.active !== false,
      history: [],                 // { due, commitmentId, at }
      notes: fields.notes || "",
      archived: false, createdAt: at, updatedAt: at
    };
  }

  // Same kind of thing (for substitutions): shares a core word and a comparable unit.
  function substitutesFor(products, product) {
    if (!product) return [];
    var me = coreTokens(product.name);
    var rejected = arr(product.rejectedSubstitutes), chosen = arr(product.substitutes);
    var out = [];
    arr(products).forEach(function (p) {
      if (!p || p.archived || p.id === product.id || rejected.indexOf(p.id) >= 0) return;
      var mine = chosen.indexOf(p.id) >= 0;
      var other = coreTokens(p.name);
      var shared = me.filter(function (t) { return other.indexOf(t) >= 0; });
      var unitOk = !product.unit || !p.unit || C.sameDimension(product.unit, p.unit);
      if (mine || (shared.length && unitOk)) out.push({ product: p, chosen: mine, shared: shared, score: mine ? 2 : jaccard(me, other) });
    });
    return out.sort(function (a, b) { return b.score - a.score; });
  }

  // How trustworthy a research source is, from its web address.
  var SOURCE_QUALITY = {
    official: { label: "Official store", rank: 1, icon: "🏬" },
    marketplace: { label: "Marketplace — check the seller", rank: 2, icon: "🛒" },
    review: { label: "Review site", rank: 3, icon: "📝" },
    community: { label: "Community / forum", rank: 4, icon: "💬" },
    other: { label: "Other website", rank: 5, icon: "🔗" },
    none: { label: "No source link", rank: 6, icon: "❔" }
  };
  function sourceQuality(url) {
    var host = "";
    try { host = String(url || "").match(/^https?:\/\/([^\/?#]+)/i)[1].toLowerCase().replace(/^www\./, ""); } catch (e) { host = ""; }
    if (!host) return { kind: "none", host: "", label: SOURCE_QUALITY.none.label, icon: SOURCE_QUALITY.none.icon, rank: 6 };
    var test = function (list) { return list.some(function (d) { return host === d || host.slice(-(d.length + 1)) === "." + d; }); };
    var kind = "other";
    if (test(["lazada.com.ph", "lazada.com", "shopee.ph", "shopee.com", "tiktok.com", "carousell.ph", "carousell.com", "facebook.com", "zalora.com.ph", "amazon.com", "ebay.com", "aliexpress.com"])) kind = "marketplace";
    else if (test(["rtings.com", "gsmarena.com", "yugatech.com", "techradar.com", "consumerreports.org", "wirecutter.com", "nytimes.com", "cnet.com", "tomsguide.com", "pcmag.com", "unbox.ph", "noypigeeks.com", "priceprice.com"])) kind = "review";
    else if (test(["reddit.com", "youtube.com", "youtu.be", "quora.com", "pinoyexchange.com", "tipidpc.com"])) kind = "community";
    else if (test(["sm-store.com", "smmarkets.ph", "puregold.com.ph", "robinsons.com.ph", "landers.ph", "smstore.com", "abenson.com", "anson.com.ph", "complink.com.ph", "pcexpress.com.ph", "samsung.com", "apple.com", "xiaomi.com", "mi.com", "philips.com.ph", "philips.com", "lg.com", "sony.com.ph", "mercurydrug.com", "watsons.com.ph", "southstardrug.com.ph", "metromart.com", "datablitz.com.ph", "octagon.com.ph", "power-mac.com", "beyondthebox.ph", "imarketsolutions.ph", "allhome.com.ph", "wilcon.com.ph", "ace.com.ph", "handyman.com.ph", "truevalue.com.ph"])) kind = "official";
    var q = SOURCE_QUALITY[kind];
    return { kind: kind, host: host, label: q.label, icon: q.icon, rank: q.rank };
  }

  /*
    parseOffers(report) — reads the research report's machine lines
      OFFER: product | price in PHP or "unknown" | store/seller | source URL or "none" | verified or estimate
    → [{ product, price (number|null), seller, url, verified }]. Prices are never made up here.
  */
  function parseOffers(report) {
    var out = [];
    String(report || "").split(/\r?\n/).forEach(function (line) {
      var m = /^\s*[-*]?\s*\**OFFER\**\s*:\s*(.+)$/i.exec(line);
      if (!m) return;
      var parts = m[1].split("|").map(function (x) { return x.trim(); });
      if (parts.length < 2 || !parts[0]) return;
      var priceTxt = String(parts[1] || "").replace(/,/g, "");
      var pm = /(\d+(?:\.\d+)?)/.exec(priceTxt);
      var price = /unknown|n\/a|none/i.test(priceTxt) || !pm ? null : C.round2(parseFloat(pm[1]));
      var url = /^https?:\/\//i.test(parts[3] || "") ? parts[3].replace(/[).,]+$/, "") : null;
      out.push({ product: parts[0].replace(/\*\*/g, ""), price: price > 0 ? price : null, seller: parts[2] && !/^(none|unknown)$/i.test(parts[2]) ? parts[2] : "", url: url, verified: /verified/i.test(parts[4] || "") && !/unverified/i.test(parts[4] || "") });
    });
    return out.slice(0, 8);
  }
  function stripOfferLines(text) {
    return String(text || "").split(/\r?\n/).filter(function (l) { return !/^\s*[-*]?\s*\**OFFER\**\s*:/i.test(l); }).join("\n");
  }

  /* ---------- counts & validation ---------- */

  function countsOf(d) {
    var x = d || {};
    var receiptItems = 0;
    arr(x.receipts).forEach(function (r) { receiptItems += arr(r.items).length; });
    var c = {
      requests: arr(x.requests).length,
      purchases: arr(x.requests).filter(function (r) { return r && r.purchased; }).length,
      receipts: arr(x.receipts).length,
      receiptItems: receiptItems,
      manual: arr(x.manual).length,
      fund: C.round2(Number(x.fund) || 0),
      stop: C.round2(Number(x.stop) || 0),
      spent: C.round2(Number(x.spent) || 0),
      receiptTotal: C.sum(arr(x.receipts), function (r) { return Number(r.total) || 0; }),
      manualTotal: C.sum(arr(x.manual), function (m) { return Number(m.amount) || 0; }),
      purchaseTotal: C.sum(arr(x.requests), function (r) { return r && r.purchased ? Number(r.purchased.amount) || 0 : 0; })
    };
    ["houses", "memberGroups", "stores", "products", "priceRecords", "budgetCategories", "commitments", "reserves", "auditLog", "backupLog",
      "inventoryItems", "inventoryTransactions", "shoppingLists", "shoppingCycles", "trips", "recurring", "alerts"].forEach(function (k) {
      c[k] = arr(x[k]).length;
    });
    c.listItems = 0;
    arr(x.shoppingLists).forEach(function (l) { c.listItems += arr(l && l.items).length; });
    return c;
  }

  var LEGACY_COUNT_KEYS = ["requests", "purchases", "receipts", "receiptItems", "manual", "fund", "stop", "spent", "receiptTotal", "manualTotal", "purchaseTotal"];
  // Stage 1 lists that later upgrades must never lose
  var STAGE1_COUNT_KEYS = ["houses", "memberGroups", "stores", "products", "priceRecords", "budgetCategories", "commitments", "reserves"];
  var STAGE2_COUNT_KEYS = ["inventoryItems", "inventoryTransactions", "shoppingLists", "listItems", "shoppingCycles", "trips"];

  function compareCounts(before, after, keys) {
    var problems = [];
    (keys || LEGACY_COUNT_KEYS).forEach(function (k) {
      if (before[k] !== after[k]) problems.push(k + ": " + before[k] + " → " + after[k]);
    });
    return problems;
  }

  /* ---------- migrations ---------- */

  var MIGRATIONS = {
    // v1 = the app up to PR #4 (no schemaVersion). → v2 = Stage 1 foundation.
    1: function (d, at) {
      ensureShape(d);
      if (!d.stores.length) d.stores = seedStores(at);
      if (!d.budgetCategories.length) d.budgetCategories = seedCategories(at);
      if (!d.houses.length) {
        var hh = seedHousehold(at);
        d.houses = hh.houses;
        if (!d.memberGroups.length) d.memberGroups = hh.memberGroups;
      }
      // Categories Jason already used that aren't in the defaults become custom ones.
      var known = {};
      d.budgetCategories.forEach(function (c) { known[c.name] = true; });
      var used = [];
      d.requests.forEach(function (r) { if (r.purchased && r.purchased.category) used.push(r.purchased.category); if (r.category) used.push(r.category); });
      d.receipts.forEach(function (r) { if (r.category) used.push(r.category); });
      d.manual.forEach(function (m) { if (m.category) used.push(m.category); });
      used.forEach(function (name) {
        if (name && !known[name]) {
          known[name] = true;
          d.budgetCategories.push({ id: "cat_" + slug(name) + "_" + Math.random().toString(36).slice(2, 5), name: name, icon: "🏷️", color: "#8e99ad", builtIn: false, archived: false, createdAt: at, createdFrom: "history" });
        }
      });
      // Learn prices from existing receipts (where the data allows).
      var learned = { products: 0, priceRecords: 0 };
      d.receipts.slice().reverse().forEach(function (r) {
        var x = priceRecordsFromReceipt(d, r, { at: at, legacy: true });
        learned.products += x.products; learned.priceRecords += x.priceRecords;
      });
      return { note: "Added household, stores, products, price book, budget plan, commitments, reserve, audit trail", learned: learned };
    },
    // v2 = Stage 1. → v3 = Stage 2 operations (inventory, cycles, lists, trips, receipt matching).
    2: function (d, at) {
      ensureShape(d);
      d.settings.cycle.anchorDate = d.settings.cycle.anchorDate || firstOfMonth(localDay(at));
      if (!d.shoppingLists.some(function (l) { return l && l.status === "active"; })) d.shoppingLists.push(makeList("Shopping list", at));
      // Stage 1 price records were exact-name links → High confidence.
      var marked = 0;
      d.priceRecords.forEach(function (pr) { if (!pr.matchConfidence) { pr.matchConfidence = "high"; pr.matchReason = pr.source === "receipt" ? "exact_name" : "entered"; pr.needsReview = false; marked++; } });
      return { note: "Added inventory, shopping cycles, shopping list, trips and receipt matching", learned: { pricesMarkedHigh: marked } };
    },
    // v3 = Stage 2. → v4 = Stage 3 intelligence (route, alerts, recurring, learning). Additive only.
    3: function (d, at) {
      ensureShape(d);
      // Price-drop alerts only for prices recorded from now on (old history is not re-announced).
      d.learning.alertScanAt = d.learning.alertScanAt || at;
      var stores = 0;
      d.stores.forEach(function (st) { if (!st.travel || typeof st.travel !== "object") { st.travel = { minutes: null, km: null }; stores++; } });
      var prods = 0;
      d.products.forEach(function (p) {
        if (!("targetPrice" in p)) { p.targetPrice = null; prods++; }
        if (!Array.isArray(p.substitutes)) p.substitutes = [];
        if (!Array.isArray(p.rejectedSubstitutes)) p.rejectedSubstitutes = [];
      });
      return { note: "Added where-to-buy, route planner, price alerts, recurring purchases, forecasts and learning", learned: { storesWithTravel: stores, productsWithTargets: prods } };
    }
  };

  /*
    migrate(raw) → { data, fromVersion, toVersion, migrated, valid, problems, before, after, steps }
    Never mutates `raw`. Old fields are never removed. Validation compares the
    v1 record counts and peso totals before and after.
  */
  function migrate(raw) {
    var src = raw && typeof raw === "object" ? clone(raw) : {};
    var from = Number(src.schemaVersion) || 1;
    if (from > SCHEMA_VERSION) {
      ensureShape(src);
      return { data: src, fromVersion: from, toVersion: from, migrated: false, valid: true, futureVersion: true, problems: [], steps: [] };
    }
    var before = countsOf(normalizeLegacy(clone(src)));
    var d = src;
    var steps = [];
    var at = nowISO();
    for (var v = from; v < SCHEMA_VERSION; v++) {
      var info = MIGRATIONS[v](d, at) || {};
      d.schemaVersion = v + 1;
      steps.push({ from: v, to: v + 1, at: at, note: info.note || "", learned: info.learned || null });
    }
    ensureShape(d);
    d.schemaVersion = SCHEMA_VERSION;
    if (!d.meta.createdAt) d.meta.createdAt = at;
    var after = countsOf(d);
    var problems = steps.length ? compareCounts(before, after) : [];
    if (steps.length && from >= 2) problems = problems.concat(compareCounts(before, after, STAGE1_COUNT_KEYS));
    if (steps.length && from >= 3) problems = problems.concat(compareCounts(before, after, STAGE2_COUNT_KEYS));
    if (steps.length) {
      if (after.stores < SEED_STORES.length) problems.push("stores missing");
      if (after.budgetCategories < DEFAULT_CATEGORIES.length) problems.push("categories missing");
      d.meta.migrations.push({ from: from, to: SCHEMA_VERSION, at: at, appVersion: APP_VERSION, counts: { before: before, after: after }, ok: problems.length === 0 });
    }
    return { data: d, fromVersion: from, toVersion: SCHEMA_VERSION, migrated: steps.length > 0, valid: problems.length === 0, problems: problems, before: before, after: after, steps: steps };
  }

  /* ---------- integrity check (spec §110–112) ---------- */

  function integrityCheck(d, opts) {
    var issues = [];
    var add = function (level, code, message, entity, id) { issues.push({ level: level, code: code, message: message, entity: entity || null, id: id || null }); };
    if (!d || typeof d !== "object") { add("error", "no_data", "No data found."); return { ok: false, issues: issues, counts: {} }; }

    if (Number(d.schemaVersion) !== SCHEMA_VERSION) add("warning", "schema", "Data version is " + (d.schemaVersion || 1) + " (app expects " + SCHEMA_VERSION + ").");
    COLLECTIONS.forEach(function (k) { if (!Array.isArray(d[k])) add("error", "missing_collection", "Missing list: " + k, k); });

    ["fund", "stop", "spent"].forEach(function (k) {
      var v = d[k];
      if (typeof v !== "number" || !isFinite(v)) add("error", "bad_number", k + " is not a valid number.", "budget");
      else if (v < 0) add("error", "negative", k + " is negative.", "budget");
    });

    COLLECTIONS.forEach(function (k) {
      var seen = {};
      arr(d[k]).forEach(function (x, i) {
        if (!x || typeof x !== "object") { add("error", "bad_record", k + " #" + (i + 1) + " is not a record.", k); return; }
        if (!x.id) add("error", "missing_id", k + " #" + (i + 1) + " has no id.", k);
        else if (seen[x.id]) add("error", "duplicate_id", "Duplicate id " + x.id + " in " + k + ".", k, x.id);
        seen[x.id] = true;
      });
    });

    var money = function (v) { return typeof v === "number" && isFinite(v) && v >= 0; };
    arr(d.receipts).forEach(function (r) {
      if (r.total != null && !money(Number(r.total))) add("error", "bad_amount", "Receipt " + (r.store || r.id) + " has an invalid total.", "receipts", r.id);
    });
    arr(d.manual).forEach(function (m) {
      if (!money(Number(m.amount))) add("error", "bad_amount", "Spending entry " + (m.item || m.id) + " has an invalid amount.", "manual", m.id);
      if (m.date && !/^\d{4}-\d{2}-\d{2}$/.test(m.date)) add("warning", "bad_date", "Spending entry " + (m.item || m.id) + " has an unusual date.", "manual", m.id);
    });
    arr(d.requests).forEach(function (r) {
      if (r.purchased && !money(Number(r.purchased.amount))) add("error", "bad_amount", "Purchase " + (r.text || r.id) + " has an invalid amount.", "requests", r.id);
    });

    var ids = function (k) { var o = {}; arr(d[k]).forEach(function (x) { if (x && x.id) o[x.id] = x; }); return o; };
    var products = ids("products"), stores = ids("stores"), houses = ids("houses"), cats = ids("budgetCategories");
    arr(d.priceRecords).forEach(function (pr) {
      if (pr.productId && !products[pr.productId]) add("error", "broken_link", "Price record " + pr.id + " points to a missing product.", "priceRecords", pr.id);
      if (pr.storeId && !stores[pr.storeId]) add("warning", "broken_link", "Price record " + pr.id + " points to a missing store.", "priceRecords", pr.id);
      if (pr.price != null && !money(Number(pr.price))) add("error", "bad_amount", "Price record " + pr.id + " has an invalid price.", "priceRecords", pr.id);
      if (!pr.source || !PRICE_SOURCES[pr.source]) add("error", "no_source", "Price record " + pr.id + " has no source.", "priceRecords", pr.id);
    });
    arr(d.memberGroups).forEach(function (g) {
      if (!houses[g.houseId]) add("warning", "broken_link", "Household group " + (g.label || g.id) + " belongs to a missing house.", "memberGroups", g.id);
      var c = Number(g.count);
      if (!(c >= 0) || Math.floor(c) !== c) add("error", "bad_count", "Household group " + (g.label || g.id) + " has an invalid count.", "memberGroups", g.id);
    });
    arr(d.commitments).forEach(function (c) {
      if (["committed", "paid", "cancelled"].indexOf(c.status) < 0) add("error", "bad_status", "Commitment " + (c.title || c.id) + " has an unknown status.", "commitments", c.id);
      if (!money(Number(c.amount))) add("error", "bad_amount", "Commitment " + (c.title || c.id) + " has an invalid amount.", "commitments", c.id);
    });
    arr(d.reserves).forEach(function (r) { if (!money(Number(r.amount))) add("error", "bad_amount", "Reserve " + (r.name || r.id) + " has an invalid amount.", "reserves", r.id); });
    arr(d.inventoryItems).forEach(function (it) {
      var q = Number(it.quantity);
      if (!(q >= 0) || !isFinite(q)) add("error", "bad_quantity", "Inventory item " + (it.name || it.id) + " has an invalid quantity.", "inventoryItems", it.id);
      if (it.productId && !products[it.productId]) add("warning", "broken_link", "Inventory item " + (it.name || it.id) + " points to a missing product.", "inventoryItems", it.id);
    });
    var inv = ids("inventoryItems");
    arr(d.inventoryTransactions).forEach(function (t) {
      if (!inv[t.itemId]) add("warning", "broken_link", "Stock change " + t.id + " points to a missing inventory item.", "inventoryTransactions", t.id);
    });
    arr(d.shoppingLists).forEach(function (l) {
      var seenLi = {};
      arr(l.items).forEach(function (it) {
        if (!it.id) add("error", "missing_id", "A list item in " + (l.name || l.id) + " has no id.", "shoppingLists", l.id);
        else if (seenLi[it.id]) add("error", "duplicate_id", "Duplicate list item id " + it.id + ".", "shoppingLists", it.id);
        seenLi[it.id] = true;
        if (["open", "in_cart", "bought", "deferred", "removed"].indexOf(it.status) < 0) add("error", "bad_status", "List item " + (it.name || it.id) + " has an unknown status.", "shoppingLists", it.id);
        if (it.productId && !products[it.productId]) add("warning", "broken_link", "List item " + (it.name || it.id) + " points to a missing product.", "shoppingLists", it.id);
      });
    });
    arr(d.trips).forEach(function (t) {
      if (["active", "finished", "cancelled"].indexOf(t.status) < 0) add("error", "bad_status", "Trip " + t.id + " has an unknown status.", "trips", t.id);
    });
    arr(d.recurring).forEach(function (r) {
      if (!money(Number(r.amount))) add("error", "bad_amount", "Recurring purchase " + (r.title || r.id) + " has an invalid amount.", "recurring", r.id);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(r.nextDue || ""))) add("error", "bad_date", "Recurring purchase " + (r.title || r.id) + " has no next date.", "recurring", r.id);
      if (!RECURRING_UNITS[r.every && r.every.unit]) add("error", "bad_repeat", "Recurring purchase " + (r.title || r.id) + " has an unknown repeat.", "recurring", r.id);
    });
    arr(d.alerts).forEach(function (a) { if (!ALERT_KINDS[a.kind]) add("warning", "bad_kind", "Alert " + a.id + " has an unknown kind.", "alerts", a.id); });
    if (arr(d.trips).filter(function (t) { return t.status === "active"; }).length > 1) add("warning", "multiple_trips", "More than one shopping trip is open.", "trips");
    arr(d.budgetPlan && d.budgetPlan.items).forEach(function (it) {
      if (!cats[it.categoryId]) add("warning", "broken_link", "Budget plan line points to a missing category.", "budgetPlan", it.categoryId);
    });

    // Reconciliation (information only): Spent vs recorded entries.
    if (opts && typeof opts.recordedSpent === "number") {
      var diff = C.round2((Number(d.spent) || 0) - opts.recordedSpent);
      if (Math.abs(diff) >= 0.01) add("info", "spent_unreconciled", "Spent differs from your recorded purchases by " + C.formatPeso(Math.abs(diff)) + (diff > 0 ? " (amounts typed directly into Spent)." : " (some recorded purchases are not counted in Spent)."), "budget");
    }

    var errors = issues.filter(function (i) { return i.level === "error"; }).length;
    return { ok: errors === 0, errors: errors, warnings: issues.filter(function (i) { return i.level === "warning"; }).length, issues: issues, counts: countsOf(d) };
  }

  /* ---------- backup envelope helpers ---------- */

  // FNV-1a 32-bit — detects damaged/edited backup files (not security).
  function checksum(text) {
    var h = 0x811c9dc5;
    var s = String(text);
    for (var i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
    }
    return ("0000000" + h.toString(16)).slice(-8);
  }

  function makeBackup(d, extra) {
    var dataText = JSON.stringify(d);
    var env = {
      app: "Jason Shop", type: "backup",
      version: 1,              // envelope stays v1-compatible: older app versions can still restore it
      format: 2, schemaVersion: d.schemaVersion || 1, appVersion: APP_VERSION,
      backupId: newId("bk"), exportedAt: nowISO(),
      counts: countsOf(d),
      checksum: { algo: "fnv1a32", value: checksum(dataText) }
    };
    Object.keys(extra || {}).forEach(function (k) { env[k] = extra[k]; });
    // data last so the summary fields are at the top of the file
    return "{" + JSON.stringify(env).slice(1, -1) + ',"data":' + dataText + "}";
  }

  // → { ok, error, payload, data (migrated), counts, checksumOk, migratedFrom }
  function readBackup(text) {
    var payload = null;
    try { payload = JSON.parse(text); } catch (e) { payload = null; }
    var d = payload && payload.data;
    if (!payload || payload.app !== "Jason Shop" || !d || typeof d !== "object" || !Array.isArray(d.requests) || !Array.isArray(d.receipts)) {
      return { ok: false, error: "not_backup" };
    }
    if (Number(d.schemaVersion) > SCHEMA_VERSION) return { ok: false, error: "newer_version", payload: payload };
    var checksumOk = null;
    if (payload.checksum && payload.checksum.value) checksumOk = checksum(JSON.stringify(d)) === payload.checksum.value;
    var m = migrate(d);
    if (!m.valid) return { ok: false, error: "migration_failed", problems: m.problems, payload: payload };
    if (payload.counts) {
      var p = compareCounts(payload.counts, countsOf(normalizeLegacy(clone(d))), ["requests", "receipts", "manual", "spent"]);
      if (p.length) return { ok: false, error: "counts_mismatch", problems: p, payload: payload };
    }
    return { ok: true, payload: payload, data: m.data, counts: countsOf(m.data), checksumOk: checksumOk, migratedFrom: m.migrated ? m.fromVersion : null };
  }

  return {
    SCHEMA_VERSION: SCHEMA_VERSION, APP_VERSION: APP_VERSION,
    newId: newId, nowISO: nowISO, clone: clone, localDay: localDay, normalizeName: normalizeName, slug: slug,
    DEFAULT_CATEGORIES: DEFAULT_CATEGORIES, SHOPPING_TYPES: SHOPPING_TYPES, SEED_STORES: SEED_STORES, STORE_TYPES: STORE_TYPES,
    MEMBER_TYPES: MEMBER_TYPES, SCOPE_TYPES: SCOPE_TYPES, PRICE_SOURCES: PRICE_SOURCES, DEFAULT_SETTINGS: DEFAULT_SETTINGS, COLLECTIONS: COLLECTIONS,
    seedStores: seedStores, seedCategories: seedCategories, seedHousehold: seedHousehold, createEmpty: createEmpty,
    normalizeLegacy: normalizeLegacy, ensureShape: ensureShape,
    findStoreByName: findStoreByName, findProductByName: findProductByName, productKey: productKey, makeProduct: makeProduct,
    priceRecordsFromReceipt: priceRecordsFromReceipt,
    countsOf: countsOf, compareCounts: compareCounts, LEGACY_COUNT_KEYS: LEGACY_COUNT_KEYS, STAGE1_COUNT_KEYS: STAGE1_COUNT_KEYS, STAGE2_COUNT_KEYS: STAGE2_COUNT_KEYS,
    ALERT_KINDS: ALERT_KINDS, RECURRING_UNITS: RECURRING_UNITS, SOURCE_QUALITY: SOURCE_QUALITY,
    makeRecurring: makeRecurring, substitutesFor: substitutesFor, sourceQuality: sourceQuality, parseOffers: parseOffers, stripOfferLines: stripOfferLines,
    INVENTORY_LOCATIONS: INVENTORY_LOCATIONS, LIST_PRIORITIES: LIST_PRIORITIES, MATCH_CONFIDENCE: MATCH_CONFIDENCE,
    matchProduct: matchProduct, coreTokens: coreTokens, findDuplicateReceipt: findDuplicateReceipt,
    makeInventoryItem: makeInventoryItem, makeList: makeList, makeListItem: makeListItem, firstOfMonth: firstOfMonth,
    migrate: migrate, integrityCheck: integrityCheck,
    checksum: checksum, makeBackup: makeBackup, readBackup: readBackup
  };
}));
