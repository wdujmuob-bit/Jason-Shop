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

  var SCHEMA_VERSION = 2;
  var APP_VERSION = "2.0.0-stage1";

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
    currency: "PHP"
  };

  // §49 entity collections (Stage 2+ ones are reserved now so the layout is stable).
  var COLLECTIONS = ["requests", "receipts", "manual",
    "houses", "memberGroups", "stores", "products", "priceRecords",
    "budgetCategories", "commitments", "reserves", "auditLog", "backupLog",
    "inventoryItems", "inventoryTransactions", "shoppingLists", "shoppingCycles", "trips"];

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
    var created = { products: 0, priceRecords: 0 };
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
      var product = findProductByName(d.products, name);
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
        note: "", archived: false, createdAt: at
      });
      created.priceRecords++;
    });
    return created;
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
    ["houses", "memberGroups", "stores", "products", "priceRecords", "budgetCategories", "commitments", "reserves", "auditLog", "backupLog"].forEach(function (k) {
      c[k] = arr(x[k]).length;
    });
    return c;
  }

  var LEGACY_COUNT_KEYS = ["requests", "purchases", "receipts", "receiptItems", "manual", "fund", "stop", "spent", "receiptTotal", "manualTotal", "purchaseTotal"];

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
        var x = priceRecordsFromReceipt(d, r, { at: at });
        learned.products += x.products; learned.priceRecords += x.priceRecords;
      });
      return { note: "Added household, stores, products, price book, budget plan, commitments, reserve, audit trail", learned: learned };
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
    countsOf: countsOf, compareCounts: compareCounts, LEGACY_COUNT_KEYS: LEGACY_COUNT_KEYS,
    migrate: migrate, integrityCheck: integrityCheck,
    checksum: checksum, makeBackup: makeBackup, readBackup: readBackup
  };
}));
