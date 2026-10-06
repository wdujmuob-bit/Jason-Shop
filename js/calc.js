/* =====================================================================
   JASON SHOP — CENTRAL CALCULATION ENGINE  (spec §39–40)
   ---------------------------------------------------------------------
   ALL money and household maths lives here. Pure functions only:
   no DOM, no storage, no clock unless a date is passed in.
   Works in the browser (window.JasonCalc) and in Node (require) so it
   can be unit-tested: `npm run test:unit`.
   Amounts are pesos as plain numbers; results are rounded to centavos.
   ===================================================================== */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.JasonCalc = factory();
}(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  /* ---------- numbers ---------- */

  function round2(n) {
    if (!isFinite(n)) return n;
    return Math.round((Number(n) + (n >= 0 ? 1e-9 : -1e-9)) * 100) / 100;
  }

  // A usable amount: finite number (strings like "1,250" accepted). Else null.
  function num(value) {
    if (value === null || value === undefined || value === "") return null;
    if (typeof value === "number") return isFinite(value) ? value : null;
    var t = String(value).replace(/[₱,\s]/g, "").replace(/^php/i, "");
    if (!/^-?\d*\.?\d+$/.test(t)) return null;
    var n = parseFloat(t);
    return isFinite(n) ? n : null;
  }

  // Money that can't be negative (fund, spent, reserve…): bad → 0.
  function money(value) {
    var n = num(value);
    return n !== null && n > 0 ? round2(n) : 0;
  }

  function sum(list, pick) {
    var total = 0;
    (list || []).forEach(function (x) {
      var v = num(pick ? pick(x) : x);
      if (v !== null) total += v;
    });
    return round2(total);
  }

  function formatPeso(value, opts) {
    var n = num(value);
    if (n === null) return "—";
    var o = opts || {};
    var d = o.decimals;
    var abs = Math.abs(n);
    var text = d === undefined
      ? (Math.abs(abs - Math.round(abs)) < 0.005
        ? Math.round(abs).toLocaleString("en-PH")
        : abs.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 }))
      : abs.toLocaleString("en-PH", { minimumFractionDigits: d, maximumFractionDigits: d });
    return (n < 0 ? "−" : "") + "₱" + text;
  }

  // Never show a negative balance: "OVER LIMIT BY ₱X" instead (spec §40).
  function limitText(value, overWord) {
    var n = num(value);
    if (n === null) return "—";
    if (n < -0.004) return (overWord || "OVER LIMIT BY") + " " + formatPeso(-n);
    return formatPeso(Math.max(0, n));
  }

  function pct(part, whole) {
    var p = num(part), w = num(whole);
    if (p === null || w === null || w === 0) return null;
    return round2(p / w * 100);
  }

  /* ---------- units (spec §35, §46) ---------- */

  // dim = what can be compared. factor converts to the dimension's base
  // unit (g, ml, piece). Units without a shared dimension (roll, pack…)
  // only compare with themselves.
  var UNITS = {
    mg: { dim: "mass", factor: 0.001, label: "mg" },
    g: { dim: "mass", factor: 1, label: "g" },
    kg: { dim: "mass", factor: 1000, label: "kg" },
    lb: { dim: "mass", factor: 453.59237, label: "lb" },
    oz: { dim: "mass", factor: 28.349523125, label: "oz" },
    ml: { dim: "volume", factor: 1, label: "ml" },
    l: { dim: "volume", factor: 1000, label: "L" },
    gal: { dim: "volume", factor: 3785.411784, label: "gal" },
    piece: { dim: "count", factor: 1, label: "piece" },
    dozen: { dim: "count", factor: 12, label: "dozen" },
    roll: { dim: "roll", factor: 1, label: "roll" },
    pack: { dim: "pack", factor: 1, label: "pack" },
    sachet: { dim: "sachet", factor: 1, label: "sachet" },
    bottle: { dim: "bottle", factor: 1, label: "bottle" },
    can: { dim: "can", factor: 1, label: "can" },
    box: { dim: "box", factor: 1, label: "box" },
    tray: { dim: "tray", factor: 1, label: "tray" },
    bundle: { dim: "bundle", factor: 1, label: "bundle" },
    bag: { dim: "bag", factor: 1, label: "bag" },
    sack: { dim: "sack", factor: 1, label: "sack" }
  };

  var UNIT_ALIASES = {
    milligram: "mg", milligrams: "mg",
    gram: "g", grams: "g", gm: "g", gms: "g", gr: "g", grm: "g",
    kilo: "kg", kilos: "kg", kgs: "kg", kilogram: "kg", kilograms: "kg", kl: "kg",
    lbs: "lb", pound: "lb", pounds: "lb", ounce: "oz", ounces: "oz",
    milliliter: "ml", milliliters: "ml", millilitre: "ml", millilitres: "ml", mls: "ml", cc: "ml",
    liter: "l", liters: "l", litre: "l", litres: "l", ltr: "l", ltrs: "l", lt: "l",
    gallon: "gal", gallons: "gal",
    pc: "piece", pcs: "piece", pieces: "piece", ea: "piece", each: "piece", unit: "piece", units: "piece", item: "piece", items: "piece", ct: "piece",
    doz: "dozen", dozens: "dozen", dz: "dozen",
    rolls: "roll", packs: "pack", pk: "pack", pkt: "pack", packet: "pack", packets: "pack",
    sachets: "sachet", bottles: "bottle", btl: "bottle", cans: "can", tin: "can", tins: "can",
    boxes: "box", bx: "box", trays: "tray", bundles: "bundle", tali: "bundle", bags: "bag", sacks: "sack", kaban: "sack"
  };

  function normalizeUnit(unit) {
    if (!unit) return null;
    var u = String(unit).trim().toLowerCase().replace(/\.$/, "");
    if (UNITS[u]) return u;
    return UNIT_ALIASES[u] || null;
  }

  function unitLabel(unit) {
    var u = normalizeUnit(unit);
    return u ? UNITS[u].label : String(unit || "");
  }

  function sameDimension(a, b) {
    var ua = normalizeUnit(a), ub = normalizeUnit(b);
    return !!(ua && ub && UNITS[ua].dim === UNITS[ub].dim);
  }

  // convert(1, "kg", "g") → 1000 ; incompatible/unknown → null
  function convert(amount, from, to) {
    var n = num(amount), f = normalizeUnit(from), t = normalizeUnit(to);
    if (n === null || !f || !t || UNITS[f].dim !== UNITS[t].dim) return null;
    return n * UNITS[f].factor / UNITS[t].factor;
  }

  // The unit a price is quoted "per" for each dimension.
  var PER_UNIT = { mass: "kg", volume: "l", count: "piece" };

  /*
    unitPrice({ price, qty, size, unit, packCount })
      price      what was paid for the line (qty items)
      qty        how many items (default 1)
      size,unit  size of ONE item (e.g. 5 kg, 1 L, 12 piece)
      packCount  items inside one pack (e.g. "6x1L" → packCount 6, size 1, unit L)
    → { ok, value, per, perLabel, itemPrice, reason }
       reason: missing_price | invalid_qty | missing_size | unknown_unit | zero_size
  */
  function unitPrice(input) {
    var o = input || {};
    var price = num(o.price);
    var qty = o.qty === undefined || o.qty === null || o.qty === "" ? 1 : num(o.qty);
    if (price === null) return { ok: false, reason: "missing_price", value: null, itemPrice: null };
    if (price < 0) return { ok: false, reason: "negative_price", value: null, itemPrice: null };
    if (qty === null || qty <= 0) return { ok: false, reason: "invalid_qty", value: null, itemPrice: null };
    var itemPrice = round2(price / qty);
    var size = num(o.size);
    var unit = normalizeUnit(o.unit);
    if (size === null && !unit) return { ok: false, reason: "missing_size", value: null, itemPrice: itemPrice };
    if (!unit) return { ok: false, reason: o.unit ? "unknown_unit" : "missing_size", value: null, itemPrice: itemPrice };
    if (size === null) size = 1;            // "per pack", "per piece" without a number
    if (size <= 0) return { ok: false, reason: "zero_size", value: null, itemPrice: itemPrice };
    var pack = num(o.packCount);
    if (pack === null || pack <= 0) pack = 1;
    var def = UNITS[unit];
    var per = PER_UNIT[def.dim] || unit;
    var amountInPer = size * pack * def.factor / UNITS[per].factor;
    var value = itemPrice / amountInPer;
    return {
      ok: true,
      value: round2(value),
      exact: value,
      per: per,
      perLabel: UNITS[per].label,
      dim: def.dim,
      itemPrice: itemPrice,
      reason: null
    };
  }

  function unitPriceText(result) {
    if (!result) return "";
    if (result.ok) return formatPeso(result.value) + "/" + result.perLabel;
    if (result.itemPrice !== null && result.itemPrice !== undefined) return formatPeso(result.itemPrice) + " each (no size)";
    return "No price";
  }

  // Compare two unitPrice inputs fairly. Mixed units → not comparable.
  function compareUnitPrices(a, b) {
    var ua = unitPrice(a), ub = unitPrice(b);
    if (!ua.ok || !ub.ok) return { comparable: false, reason: !ua.ok ? "a_" + ua.reason : "b_" + ub.reason };
    if (ua.dim !== ub.dim) return { comparable: false, reason: "mixed_units" };
    var diff = ua.exact - ub.exact;
    return {
      comparable: true,
      cheaper: Math.abs(diff) < 1e-9 ? "same" : (diff < 0 ? "a" : "b"),
      difference: round2(Math.abs(diff)),
      differencePct: round2(Math.abs(diff) / Math.max(ua.exact, ub.exact) * 100),
      per: ua.perLabel
    };
  }

  /*
    parseSize("Rice Jasmine 5kg") → { size:5, unit:"kg", packCount:1 }
    parseSize("Mineral Water 6x1L") → { size:1, unit:"l", packCount:6 }
    parseSize("Eggs 12 pcs") → { size:12, unit:"piece", packCount:1 }
    Used only to PRE-FILL a product's size. Jason can correct it.
  */
  function parseSize(text) {
    var t = " " + String(text || "").toLowerCase().replace(/,/g, ".") + " ";
    var unitRe = "(mg|kgs?|kilos?|kilograms?|g|gms?|grams?|ml|mls|cc|l|ltrs?|liters?|litres?|lt|lbs?|oz|pcs?|pieces?|rolls?|packs?|sachets?|bottles?|cans?|dozens?|doz|trays?|bundles?|bags?|sacks?)";
    var pack = new RegExp("(\\d+)\\s*[x×]\\s*(\\d*\\.?\\d+)\\s*" + unitRe + "(?=[^a-z]|$)").exec(t);
    if (pack) {
      var u1 = normalizeUnit(pack[3]);
      if (u1) return { size: parseFloat(pack[2]), unit: u1, packCount: parseInt(pack[1], 10) };
    }
    var re = new RegExp("(\\d*\\.?\\d+)\\s*" + unitRe + "(?=[^a-z]|$)", "g");
    var m, found = null;
    while ((m = re.exec(t))) {
      var u = normalizeUnit(m[2]);
      if (u) { found = { size: parseFloat(m[1]), unit: u, packCount: 1 }; break; }
    }
    return found;
  }

  /* ---------- budget & warning states (spec §12–14, §39–40, §74–75) ---------- */

  var DEFAULT_THRESHOLDS = { watch: 70, warning: 85, hardStop: 100 };

  function validateThresholds(t) {
    var o = t || {};
    var w = num(o.watch), x = num(o.warning), h = num(o.hardStop);
    var errors = [];
    if (w === null || x === null || h === null) errors.push("All three levels need a number.");
    else {
      if (w <= 0) errors.push("WATCH must be above 0%.");
      if (!(w < x)) errors.push("WATCH must be lower than WARNING.");
      if (!(x < h)) errors.push("WARNING must be lower than HARD STOP.");
      if (h > 100) errors.push("HARD STOP can't be above 100%.");
    }
    return { ok: errors.length === 0, errors: errors };
  }

  function thresholdsOrDefault(t) {
    return t && validateThresholds(t).ok
      ? { watch: num(t.watch), warning: num(t.warning), hardStop: num(t.hardStop) }
      : { watch: DEFAULT_THRESHOLDS.watch, warning: DEFAULT_THRESHOLDS.warning, hardStop: DEFAULT_THRESHOLDS.hardStop };
  }

  var STATE_INFO = {
    SETUP: { icon: "⚙️", label: "SET UP", text: "Ready for setup" },
    SAFE: { icon: "✅", label: "SAFE", text: "Safe to shop" },
    WATCH: { icon: "👀", label: "WATCH", text: "Watch your spending" },
    WARNING: { icon: "⚠️", label: "WARNING", text: "Approaching hard stop" },
    HARD_STOP: { icon: "⛔", label: "HARD STOP", text: "HARD STOP ACTIVE" }
  };

  // usedPct 0–69 SAFE · 70–84 WATCH · 85–99 WARNING · 100+ HARD STOP (defaults)
  function warningState(usedPct, thresholds) {
    if (usedPct === null || usedPct === undefined || !isFinite(usedPct)) return "SETUP";
    var t = thresholdsOrDefault(thresholds);
    var p = round2(usedPct);
    if (p >= t.hardStop) return "HARD_STOP";
    if (p >= t.warning) return "WARNING";
    if (p >= t.watch) return "WATCH";
    return "SAFE";
  }

  /*
    budgetSummary({ fund, spent, committed, reserve, stop, thresholds })
      safe to spend   = fund − spent − committed − reserve
      (hard stop)       stop − spent − committed   (the lower one applies)
      available cash  = fund − spent  (still in the fund, incl. committed + reserve)
  */
  function budgetSummary(input) {
    var o = input || {};
    var fund = money(o.fund), spent = money(o.spent), committed = money(o.committed),
      reserve = money(o.reserve), stop = money(o.stop);
    var hasFund = fund > 0, hasStop = stop > 0;
    var fromFund = hasFund ? round2(fund - spent - committed - reserve) : null;
    var fromStop = hasStop ? round2(stop - spent - committed) : null;
    var raw = null, limitedBy = null;
    if (fromFund !== null && (fromStop === null || fromFund <= fromStop)) { raw = fromFund; limitedBy = "fund"; }
    if (fromStop !== null && (raw === null || fromStop < raw)) { raw = fromStop; limitedBy = "hardStop"; }

    var limit = null;
    if (hasFund) limit = round2(fund - reserve);
    if (hasStop) limit = limit === null ? stop : Math.min(limit, stop);
    var used = round2(spent + committed);
    var usedPct = limit === null ? null : (limit > 0 ? round2(used / limit * 100) : (used > 0 || reserve > 0 ? 100 : 0));
    var state = warningState(usedPct, o.thresholds);
    if (raw !== null && raw < 0) state = "HARD_STOP";

    return {
      fund: fund, spent: spent, committed: committed, reserve: reserve, stop: stop,
      availableCash: hasFund ? round2(fund - spent) : null,
      safeFromFund: fromFund, safeFromStop: fromStop,
      rawSafe: raw,
      safeToSpend: raw === null ? 0 : Math.max(0, raw),
      overBy: raw !== null && raw < 0 ? round2(-raw) : 0,
      limitedBy: limitedBy,
      limit: limit, used: used, usedPct: usedPct,
      state: state, stateInfo: STATE_INFO[state]
    };
  }

  // Would recording `amount` more spending cross the hard stop? (legacy rule:
  // reaching the limit counts as crossing it)
  function crossesHardStop(budget, amount, opts) {
    var stop = money(budget && budget.stop);
    if (!(stop > 0)) return false;
    var a = money(amount);
    var base = money(budget.spent) + (opts && opts.includeCommitted ? money(budget.committed) : 0);
    return a > 0 && base + a >= stop;
  }

  // Remaining for one category this cycle.
  function categoryRemaining(allocated, spent, committed, thresholds) {
    var a = money(allocated), s = money(spent), c = money(committed);
    var remaining = round2(a - s - c);
    var usedPct = a > 0 ? round2((s + c) / a * 100) : (s + c > 0 ? null : 0);
    var state = a > 0 ? warningState(usedPct, thresholds) : (s + c > 0 ? "UNPLANNED" : "SAFE");
    if (a > 0 && remaining < 0) state = "HARD_STOP";
    return {
      allocated: a, spent: s, committed: c,
      remaining: Math.max(0, remaining), rawRemaining: remaining,
      overBy: remaining < 0 ? round2(-remaining) : 0,
      usedPct: usedPct, state: state
    };
  }

  // variance = planned − actual (positive = under plan / saved)
  function variance(planned, actual) {
    var p = money(planned), a = money(actual);
    var v = round2(p - a);
    return {
      planned: p, actual: a, variance: v,
      variancePct: p > 0 ? round2(v / p * 100) : null,
      direction: Math.abs(v) < 0.005 ? "on_plan" : (v > 0 ? "under" : "over"),
      saving: v > 0 ? v : 0,
      overspend: v < 0 ? round2(-v) : 0
    };
  }

  function cycleRemaining(rows, thresholds) {
    var allocated = sum(rows, function (r) { return r.allocated; });
    var spent = sum(rows, function (r) { return r.spent; });
    var committed = sum(rows, function (r) { return r.committed; });
    return categoryRemaining(allocated, spent, committed, thresholds);
  }

  /*
    computeAllocation({ base, mode, items:[{ id, value }] })
      mode "peso": value is pesos · "percent": value is % of base
    → rows with amount + percent, totals, unallocated / overAllocated, errors
  */
  function computeAllocation(input) {
    var o = input || {};
    var base = money(o.base);
    var mode = o.mode === "percent" ? "percent" : "peso";
    var errors = [], warnings = [];
    var rows = (o.items || []).map(function (it) {
      var raw = it.value === "" || it.value === null || it.value === undefined ? 0 : num(it.value);
      var bad = raw === null || raw < 0;
      if (bad) errors.push({ id: it.id, message: "Check the amount for " + (it.name || "a category") + "." });
      var v = bad ? 0 : raw;
      var amount = mode === "percent" ? round2(base * v / 100) : round2(v);
      var percent = mode === "percent" ? round2(v) : (base > 0 ? round2(v / base * 100) : null);
      return { id: it.id, name: it.name, value: v, amount: amount, percent: percent, invalid: bad };
    });
    if (mode === "percent" && !(base > 0)) errors.push({ id: null, message: "Set your Shopping Fund first — percentages need a total to divide." });
    var total = sum(rows, function (r) { return r.amount; });
    var totalPct = mode === "percent" ? sum(rows, function (r) { return r.percent; }) : (base > 0 ? round2(total / base * 100) : null);
    var diff = round2(base - total);
    var overAllocated = diff < -0.004 ? round2(-diff) : 0;
    var unallocated = diff > 0.004 ? diff : 0;
    if (overAllocated > 0) errors.push({ id: null, code: "over_allocated", message: "Over-allocated by " + formatPeso(overAllocated) + ". Lower some categories." });
    if (unallocated > 0 && base > 0) warnings.push({ code: "unallocated", message: formatPeso(unallocated) + " is not allocated to any category yet." });
    return {
      base: base, mode: mode, rows: rows, totalAllocated: total, totalPercent: totalPct,
      unallocated: unallocated, overAllocated: overAllocated,
      errors: errors, warnings: warnings, ok: errors.length === 0
    };
  }

  /* ---------- price book (spec §6–7, §35, §38, §73) ---------- */

  // records: [{ price, qty, size, unit, packCount, date, storeKey, storeName, status }]
  function priceStats(records) {
    var valid = (records || []).filter(function (r) { return !r.archived && num(r.price) !== null && num(r.price) >= 0 && (r.qty === undefined || r.qty === null || r.qty === "" || num(r.qty) > 0); });
    var missingPrice = (records || []).filter(function (r) { return !r.archived && num(r.price) === null; }).length;
    if (!valid.length) return { count: 0, missingPrice: missingPrice, basis: null };

    var withUnit = valid.map(function (r) { return { r: r, u: unitPrice(r) }; });
    var dims = {};
    withUnit.forEach(function (x) { if (x.u.ok) dims[x.u.dim] = true; });
    var dimList = Object.keys(dims);
    var allUnit = withUnit.every(function (x) { return x.u.ok; }) && dimList.length === 1;
    var basis = allUnit ? "unit" : "item";
    var mixedUnits = dimList.length > 1;
    var val = function (x) { return basis === "unit" ? x.u.exact : x.u.itemPrice; };

    var sorted = withUnit.slice().sort(function (a, b) {
      return String(a.r.date || "").localeCompare(String(b.r.date || "")) || String(a.r.createdAt || "").localeCompare(String(b.r.createdAt || ""));
    });
    var latest = sorted[sorted.length - 1];
    var previous = sorted.length > 1 ? sorted[sorted.length - 2] : null;
    var lowest = withUnit.reduce(function (m, x) { return val(x) < val(m) ? x : m; });
    var highest = withUnit.reduce(function (m, x) { return val(x) > val(m) ? x : m; });
    var avg = withUnit.reduce(function (s, x) { return s + val(x); }, 0) / withUnit.length;

    // cheapest store = lowest LATEST price per store
    var byStore = {};
    sorted.forEach(function (x) {
      var k = x.r.storeKey || (x.r.storeName ? String(x.r.storeName).toLowerCase() : "");
      if (k) byStore[k] = x;
    });
    var storeKeys = Object.keys(byStore);
    var cheapest = null;
    storeKeys.forEach(function (k) { if (!cheapest || val(byStore[k]) < val(cheapest)) cheapest = byStore[k]; });

    var cheapestTies = cheapest ? storeKeys.filter(function (k) { return Math.abs(val(byStore[k]) - val(cheapest)) < 1e-9; }).length : 0;

    var trendPct = null;
    if (previous && val(previous) > 0) trendPct = round2((val(latest) - val(previous)) / val(previous) * 100);

    var per = basis === "unit" ? latest.u.perLabel : null;
    var pick = function (x) { return { value: round2(val(x)), date: x.r.date || null, storeName: x.r.storeName || "", storeKey: x.r.storeKey || null, record: x.r }; };
    return {
      count: valid.length, missingPrice: missingPrice, basis: basis, per: per, mixedUnits: mixedUnits,
      latest: pick(latest), previous: previous ? pick(previous) : null,
      lowest: pick(lowest), highest: pick(highest), average: round2(avg),
      cheapestStore: storeKeys.length ? pick(cheapest) : null,
      storeCount: storeKeys.length,
      cheapestTies: cheapestTies,          // >1 → several stores share the lowest latest price
      trendPct: trendPct,
      trend: trendPct === null ? "none" : (trendPct > 0.5 ? "up" : (trendPct < -0.5 ? "down" : "flat"))
    };
  }

  /* ---------- household (spec §3, §82) ---------- */

  var PEOPLE_TYPES = ["adults", "children", "nannies", "maids", "security", "drivers", "other_staff", "custom"];
  var STAFF_TYPES = ["nannies", "maids", "security", "drivers", "other_staff"];

  // groups: [{ houseId, type, count, weight }] ; opts.houseId limits to one house
  function householdSize(groups, opts) {
    var houseId = opts && opts.houseId;
    var out = { people: 0, adults: 0, children: 0, staff: 0, pets: 0, custom: 0, weightedPeople: 0 };
    (groups || []).forEach(function (g) {
      if (g.archived) return;
      if (houseId && g.houseId !== houseId) return;
      var c = num(g.count);
      if (c === null || c < 0) return;
      c = Math.floor(c);
      var w = num(g.weight);
      if (w === null || w < 0) w = 1;
      if (g.type === "pets") { out.pets += c; return; }
      out.people += c;
      out.weightedPeople += c * w;
      if (g.type === "adults") out.adults += c;
      else if (g.type === "children") out.children += c;
      else if (STAFF_TYPES.indexOf(g.type) >= 0) out.staff += c;
      else out.custom += c;
    });
    out.weightedPeople = round2(out.weightedPeople);
    return out;
  }

  // How a per-person quantity scales when household size changes (forecast hook).
  function scaleForHousehold(quantity, fromPeople, toPeople) {
    var q = num(quantity), f = num(fromPeople), t = num(toPeople);
    if (q === null || f === null || t === null || f <= 0) return null;
    return round2(q * t / f);
  }

  /* ---------- spending aggregation ---------- */

  // entries: history entries { date:"YYYY-MM-DD", amount, category, counted, store }
  function spendingByCategory(entries, range) {
    var out = {};
    (entries || []).forEach(function (e) {
      if (!e.counted) return;
      if (range && !inRange(e.date, range)) return;
      var k = e.category || "Other";
      out[k] = round2((out[k] || 0) + (num(e.amount) || 0));
    });
    return out;
  }

  function inRange(day, range) {
    if (!day) return false;
    return (!range.start || day >= range.start) && (!range.end || day <= range.end);
  }

  // Budget period containing `today` ("YYYY-MM-DD"). Monthly with a start day.
  function periodRange(period, today) {
    var p = period || {};
    var startDay = Math.min(28, Math.max(1, Math.floor(num(p.startDay) || 1)));
    var parts = String(today).split("-").map(Number);
    var y = parts[0], m = parts[1], d = parts[2];
    var sy = y, sm = m;
    if (d < startDay) { sm -= 1; if (sm < 1) { sm = 12; sy -= 1; } }
    var ey = sy, em = sm + 1;
    if (em > 12) { em = 1; ey += 1; }
    var pad = function (n) { return String(n).padStart(2, "0"); };
    var start = sy + "-" + pad(sm) + "-" + pad(startDay);
    var endDate = new Date(Date.UTC(ey, em - 1, startDay));
    endDate.setUTCDate(endDate.getUTCDate() - 1);
    var end = endDate.getUTCFullYear() + "-" + pad(endDate.getUTCMonth() + 1) + "-" + pad(endDate.getUTCDate());
    return { start: start, end: end, type: "monthly", startDay: startDay };
  }

  // Store profile numbers, computed only from recorded purchases.
  function storeStats(entries) {
    var counted = (entries || []).filter(function (e) { return e.counted && num(e.amount) !== null; });
    var total = sum(counted, function (e) { return e.amount; });
    var dates = counted.map(function (e) { return e.date; }).filter(Boolean).sort();
    return {
      purchaseCount: counted.length,
      totalSpent: total,
      averageBasket: counted.length ? round2(total / counted.length) : null,
      lastDate: dates.length ? dates[dates.length - 1] : null,
      firstDate: dates.length ? dates[0] : null
    };
  }

  /* =====================================================================
     STAGE 2 — operations: dates, cycles, inventory, forecasts, expiry,
     lists, budget fitting, trips, duplicate prevention
     ===================================================================== */

  /* ---------- dates ("YYYY-MM-DD", calendar days, no time zones) ---------- */

  function dayToUTC(day) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(day || ""));
    return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : null;
  }
  function utcToDay(ms) {
    var d = new Date(ms);
    return d.getUTCFullYear() + "-" + String(d.getUTCMonth() + 1).padStart(2, "0") + "-" + String(d.getUTCDate()).padStart(2, "0");
  }
  function addDays(day, n) {
    var t = dayToUTC(day);
    return t === null ? null : utcToDay(t + Math.round(n) * 86400000);
  }
  // b − a in whole days (null if either date is invalid)
  function daysBetween(a, b) {
    var x = dayToUTC(a), y = dayToUTC(b);
    return x === null || y === null ? null : Math.round((y - x) / 86400000);
  }

  /* ---------- shopping cycles (default every 15 days, configurable) ---------- */

  var DEFAULT_CYCLE = { mode: "days", lengthDays: 15, anchorDate: null };

  function validateCycle(c) {
    var o = c || {}, errors = [];
    if (o.mode !== "days" && o.mode !== "semimonthly") errors.push("Pick a cycle type.");
    if (o.mode === "days") {
      var n = num(o.lengthDays);
      if (n === null || Math.floor(n) !== n || n < 3 || n > 62) errors.push("Cycle length must be a whole number of days from 3 to 62.");
      if (dayToUTC(o.anchorDate) === null) errors.push("Pick the date a cycle starts.");
    }
    return { ok: errors.length === 0, errors: errors };
  }

  // → { start, end, index, lengthDays, dayNumber, daysLeft, mode }
  //   index counts cycles from the anchor (can be negative before it)
  function cycleRange(cycle, today) {
    var c = cycle || DEFAULT_CYCLE;
    if (c.mode === "semimonthly") {
      var p = String(today).split("-").map(Number);
      var y = p[0], m = p[1], d = p[2];
      var pad = function (n) { return String(n).padStart(2, "0"); };
      var lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
      var first = d <= 15;
      var start = y + "-" + pad(m) + "-" + (first ? "01" : "16");
      var end = y + "-" + pad(m) + "-" + (first ? "15" : pad(lastDay));
      var len = daysBetween(start, end) + 1;
      return { mode: "semimonthly", start: start, end: end, index: (y * 12 + (m - 1)) * 2 + (first ? 0 : 1),
        lengthDays: len, dayNumber: daysBetween(start, today) + 1, daysLeft: daysBetween(today, end) };
    }
    var L = Math.min(62, Math.max(3, Math.floor(num(c.lengthDays) || 15)));
    var anchor = dayToUTC(c.anchorDate) === null ? today : c.anchorDate;
    var diff = daysBetween(anchor, today);
    var idx = Math.floor(diff / L);
    var s = addDays(anchor, idx * L);
    var e = addDays(s, L - 1);
    return { mode: "days", start: s, end: e, index: idx, lengthDays: L, dayNumber: daysBetween(s, today) + 1, daysLeft: daysBetween(today, e) };
  }

  // the cycle before/after a given cycle range
  function shiftCycle(cycle, range, steps) {
    var day = steps < 0 ? addDays(range.start, -1) : addDays(range.end, 1);
    var r = cycleRange(cycle, day);
    var n = Math.abs(steps) - 1;
    return n > 0 ? shiftCycle(cycle, r, steps < 0 ? -n : n) : r;
  }

  /* ---------- consumption & forecasts (household-scaled) ---------- */

  // Learned daily use from "use" transactions (negative deltas) in the last windowDays.
  // Needs at least 2 uses spread over ≥ 3 days, otherwise null (not enough data).
  function learnedDailyUse(transactions, today, opts) {
    var w = (opts && opts.windowDays) || 60;
    var from = addDays(today, -w);
    var uses = (transactions || []).filter(function (t) {
      return t && t.type === "use" && num(t.qty) !== null && num(t.qty) < 0 && t.day && t.day >= from && t.day <= today;
    });
    if (uses.length < 2) return null;
    var days = uses.map(function (t) { return t.day; }).sort();
    var span = Math.max(daysBetween(days[0], today), 1);
    if (span < 3) return null;
    var total = uses.reduce(function (s, t) { return s - num(t.qty); }, 0);
    return Math.round(total / span * 10000) / 10000;
  }

  /*
    dailyUse(item, ctx) — how much of an item is used per day.
      item.usage = { mode: "auto"|"manual"|"per_person"|"none", perDay, perPersonPerDay, perPetPerDay }
      ctx = { household:{weightedPeople, pets}, learned, learnedAtPeople }
    auto: learned (scaled to today's household) → per person → manual → none
    → { value, source: "learned"|"per_person"|"manual"|null }
  */
  function dailyUse(item, ctx) {
    var u = (item && item.usage) || {};
    var c = ctx || {};
    var hh = c.household || {};
    var mode = u.mode || "auto";
    if (mode === "none") return { value: null, source: null };
    var people = num(hh.weightedPeople) || 0, pets = num(hh.pets) || 0;
    var perPerson = function () {
      var pp = num(u.perPersonPerDay), pet = num(u.perPetPerDay);
      var v = (pp > 0 ? pp * people : 0) + (pet > 0 ? pet * pets : 0);
      return (pp > 0 || pet > 0) && v > 0 ? { value: Math.round(v * 10000) / 10000, source: "per_person" } : null;
    };
    var manual = function () { var v = num(u.perDay); return v > 0 ? { value: v, source: "manual" } : null; };
    var learned = function () {
      var v = num(c.learned);
      if (!(v > 0)) return null;
      var at = num(c.learnedAtPeople);
      if (at > 0 && people > 0 && at !== people) v = v * people / at;   // household changed since we learned it
      return { value: Math.round(v * 10000) / 10000, source: "learned" };
    };
    var r = null;
    if (mode === "manual") r = manual();
    else if (mode === "per_person") r = perPerson();
    else r = learned() || perPerson() || manual();
    return r || { value: null, source: null };
  }

  function daysOfSupply(quantity, perDay) {
    var q = num(quantity), d = num(perDay);
    if (q === null) return null;
    if (q <= 0) return 0;
    if (!(d > 0)) return null;
    return Math.round(q / d * 10) / 10;
  }

  var DEFAULT_INVENTORY = { lowDays: 7, urgentDays: 3, expirySoonDays: 3, bufferDays: 3, duplicateWindowDays: 7 };

  var INVENTORY_STATES = {
    OUT: { icon: "⛔", label: "OUT" },
    URGENT: { icon: "🔴", label: "URGENT" },
    LOW: { icon: "🟠", label: "LOW" },
    OK: { icon: "✅", label: "OK" },
    UNTRACKED: { icon: "➖", label: "NO TARGET" }
  };

  /*
    inventoryStatus({ quantity, perDay, minQty }, settings)
      with daily use: days < urgentDays → URGENT, < lowDays → LOW
      without: quantity ≤ half of minQty → URGENT, ≤ minQty → LOW
  */
  function inventoryStatus(input, settings) {
    var s = Object.assign({}, DEFAULT_INVENTORY, settings || {});
    var q = num(input && input.quantity);
    var per = num(input && input.perDay);
    var min = num(input && input.minQty);
    if (q === null) return { state: "UNTRACKED", days: null };
    if (q <= 0) return { state: "OUT", days: 0 };
    var days = daysOfSupply(q, per);
    if (days !== null) {
      if (days < s.urgentDays) return { state: "URGENT", days: days };
      if (days < s.lowDays) return { state: "LOW", days: days };
      if (min > 0 && q <= min) return { state: "LOW", days: days };
      return { state: "OK", days: days };
    }
    if (min > 0) {
      if (q <= min / 2) return { state: "URGENT", days: null };
      if (q <= min) return { state: "LOW", days: null };
      return { state: "OK", days: null };
    }
    return { state: "UNTRACKED", days: null };
  }

  /*
    reorderQty({ quantity, perDay, minQty, packSize }, { targetDays })
    Enough to last targetDays (normally cycle length + buffer), rounded UP to whole packs.
    No daily use: top up to 2 × minQty. Nothing known → 1 pack. Never negative.
  */
  function reorderQty(input, opts) {
    var q = Math.max(0, num(input && input.quantity) || 0);
    var per = num(input && input.perDay), min = num(input && input.minQty);
    var pack = num(input && input.packSize); if (!(pack > 0)) pack = 1;
    var target = (opts && num(opts.targetDays)) || 18;
    var need;
    if (per > 0) need = per * target - q;
    else if (min > 0) need = min * 2 - q;
    else need = q > 0 ? 0 : pack;
    if (need <= 1e-9) return { qty: 0, packs: 0, basis: per > 0 ? "daily_use" : (min > 0 ? "min_qty" : "none") };
    var packs = Math.ceil(need / pack - 1e-9);
    return { qty: Math.round(packs * pack * 1000) / 1000, packs: packs, basis: per > 0 ? "daily_use" : (min > 0 ? "min_qty" : "none") };
  }

  // Forecast: run-out date and how much is needed for the next cycle.
  function forecast(input, today, opts) {
    var per = num(input && input.perDay);
    var days = daysOfSupply(input && input.quantity, per);
    var cycleDays = (opts && num(opts.cycleDays)) || 15;
    return {
      perDay: per > 0 ? per : null,
      daysOfSupply: days,
      runOutDate: days === null ? null : addDays(today, Math.floor(days)),
      neededPerCycle: per > 0 ? Math.round(per * cycleDays * 1000) / 1000 : null,
      lastsThisCycle: days === null || !(opts && num(opts.daysLeftInCycle) !== null) ? null : days >= num(opts.daysLeftInCycle)
    };
  }

  /* ---------- perishables & expiry ---------- */

  function expiryStatus(expiryDate, today, soonDays) {
    if (!expiryDate || dayToUTC(expiryDate) === null) return { state: "NONE", daysLeft: null };
    var left = daysBetween(today, expiryDate);
    var soon = num(soonDays); if (soon === null) soon = DEFAULT_INVENTORY.expirySoonDays;
    if (left < 0) return { state: "EXPIRED", daysLeft: left };
    if (left === 0) return { state: "TODAY", daysLeft: 0 };
    if (left <= soon) return { state: "SOON", daysLeft: left };
    return { state: "OK", daysLeft: left };
  }

  // Expiry after a restock: new stock gets today + shelf life; existing unexpired stock keeps the earlier date.
  function expiryAfterRestock(current, today, shelfLifeDays, hadStock) {
    var life = num(shelfLifeDays);
    if (!(life > 0)) return current || null;
    var fresh = addDays(today, life);
    if (!hadStock || !current || dayToUTC(current) === null || current < today) return fresh;
    return current < fresh ? current : fresh;
  }

  /* ---------- shopping lists ---------- */

  // Estimated line cost from a known per-item price. Unknown price → null (never guessed).
  function lineEstimate(itemPrice, qty) {
    var p = num(itemPrice), q = num(qty);
    if (p === null || p < 0) return null;
    if (q === null || q <= 0) q = 1;
    return round2(p * q);
  }

  // items: [{ kind:"need"|"want", amount|null, status }] (open items only are counted)
  function listTotals(items) {
    var out = { needs: 0, wants: 0, total: 0, needCount: 0, wantCount: 0, unpriced: 0, unpricedNeeds: 0 };
    (items || []).forEach(function (it) {
      if (!it || (it.status && it.status !== "open")) return;
      var a = num(it.amount);
      var need = it.kind !== "want";
      if (need) out.needCount++; else out.wantCount++;
      if (a === null) { out.unpriced++; if (need) out.unpricedNeeds++; return; }
      if (need) out.needs = round2(out.needs + a); else out.wants = round2(out.wants + a);
    });
    out.total = round2(out.needs + out.wants);
    return out;
  }

  /*
    fitToBudget(items, available) — optional-item protection.
    Needs are always kept. Wants are optional: kept in priority order (1 high → 3 low,
    then cheaper first) while the running total fits `available`. A want pinned by
    Jason ("keep") is never deferred automatically. Unpriced items are kept and flagged.
    → { kept:[ids], deferred:[ids], keptTotal, shortfall, fits, unpriced:[ids] }
  */
  function fitToBudget(items, available) {
    var avail = num(available); if (avail === null) avail = 0;
    var open = (items || []).filter(function (it) { return it && (!it.status || it.status === "open"); });
    var kept = [], deferred = [], unpriced = [];
    var total = 0;
    var must = open.filter(function (it) { return it.kind !== "want" || it.pinned; });
    var optional = open.filter(function (it) { return it.kind === "want" && !it.pinned; });
    must.forEach(function (it) { kept.push(it.id); var a = num(it.amount); if (a === null) unpriced.push(it.id); else total += a; });
    optional.sort(function (a, b) {
      var pa = num(a.priority) || 2, pb = num(b.priority) || 2;
      if (pa !== pb) return pa - pb;
      return (num(a.amount) === null ? 0 : num(a.amount)) - (num(b.amount) === null ? 0 : num(b.amount));
    });
    optional.forEach(function (it) {
      var a = num(it.amount);
      if (a === null) { kept.push(it.id); unpriced.push(it.id); return; }
      if (total + a <= avail + 1e-9) { kept.push(it.id); total += a; }
      else deferred.push(it.id);
    });
    total = round2(total);
    return { kept: kept, deferred: deferred, keptTotal: total, shortfall: total > avail ? round2(total - avail) : 0, fits: total <= avail + 1e-9, unpriced: unpriced };
  }

  /* ---------- duplicate-purchase prevention ---------- */

  /*
    duplicateWarnings({ onList, inCart, daysOfSupply, cycleDays, lastBoughtDay, today, windowDays })
    → [{ code, message }]
  */
  function duplicateWarnings(input) {
    var o = input || {}, out = [];
    if (o.inCart) out.push({ code: "in_cart", message: "Already in your cart." });
    else if (o.onList) out.push({ code: "on_list", message: "Already on your shopping list." });
    var cyc = num(o.cycleDays) || 15;
    var dos = num(o.daysOfSupply);
    if (dos !== null && dos >= cyc) out.push({ code: "plenty_in_stock", message: "You still have about " + Math.floor(dos) + " days' supply at home." });
    if (o.lastBoughtDay && o.today) {
      var ago = daysBetween(o.lastBoughtDay, o.today);
      var w = num(o.windowDays) || DEFAULT_INVENTORY.duplicateWindowDays;
      if (ago !== null && ago >= 0 && ago <= w) out.push({ code: "recently_bought", message: "Bought " + (ago === 0 ? "today" : ago === 1 ? "yesterday" : ago + " days ago") + "." });
    }
    return out;
  }

  /* ---------- shopping trip ---------- */

  /*
    tripSummary({ fund, spent, committed, reserve, stop, thresholds }, cart)
      cart: [{ amount|null, checked }]
    → cartTotal, unpriced, safeBefore, safeAfterRaw, safeAfter, overBy, crossesHardStop, stateAfter
  */
  function tripSummary(budget, cart) {
    var lines = (cart || []).filter(function (c) { return c && c.checked !== false; });
    var unpriced = lines.filter(function (c) { return num(c.amount) === null; }).length;
    var cartTotal = sum(lines, function (c) { return num(c.amount) === null ? 0 : c.amount; });
    var before = budgetSummary(budget);
    var after = budgetSummary(Object.assign({}, budget, { spent: money(budget && budget.spent) + cartTotal }));
    return {
      cartTotal: cartTotal, items: lines.length, unpriced: unpriced,
      safeBefore: before.safeToSpend, safeAfterRaw: after.rawSafe, safeAfter: after.safeToSpend, overBy: after.overBy,
      crossesHardStop: crossesHardStop(Object.assign({}, budget, { committed: before.committed }), cartTotal, { includeCommitted: true }),
      stateAfter: after.state, usedPctAfter: after.usedPct
    };
  }

  /* ---------- planned vs actual (per shopping cycle) ---------- */

  /*
    plannedVsActual({ planned:[{amount|null, status, boughtAmount}], actualEntries:[history entries], range })
    planned  = estimated cost of everything put on the list for the cycle (known prices only)
    actual   = all counted spending dated in the cycle
    fromPlan = what was actually paid for planned items (trip / receipt)
  */
  function plannedVsActual(input) {
    var o = input || {};
    // moved-to-next-cycle (deferred) and removed items are no longer part of this cycle's plan
    var all = (o.planned || []).filter(function (it) { return it && it.status !== "removed"; });
    var items = all.filter(function (it) { return it.status !== "deferred"; });
    var planned = sum(items, function (it) { return num(it.amount) === null ? 0 : it.amount; });
    var unpriced = items.filter(function (it) { return num(it.amount) === null; }).length;
    var bought = items.filter(function (it) { return it.status === "bought"; });
    var fromPlan = sum(bought, function (it) { return num(it.boughtAmount) === null ? 0 : it.boughtAmount; });
    var actual = sum((o.actualEntries || []).filter(function (e) { return e.counted && (!o.range || inRange(e.date, o.range)); }), function (e) { return e.amount; });
    var v = variance(planned, actual);
    return {
      planned: planned, unpriced: unpriced, plannedCount: items.length, boughtCount: bought.length,
      deferredCount: all.filter(function (it) { return it.status === "deferred"; }).length,
      actual: actual, fromPlan: fromPlan, unplanned: Math.max(0, round2(actual - fromPlan)),
      variance: v.variance, direction: v.direction, saving: v.saving, overspend: v.overspend,
      completionPct: items.length ? Math.round(bought.length / items.length * 100) : null
    };
  }

  /* =====================================================================
     STAGE 3 — intelligence: price status & freshness, where to buy,
     best-store split, route optimizer, bulk & pack-size value, buy/wait
     advice, fund protection, 30-day forecast, recurring dates.
     Nothing here invents a price or a saving: missing data → null /
     NOT_ENOUGH_DATA, and every recommendation carries its WHY.
     ===================================================================== */

  var PRICE_STATUS = {
    LIVE: { icon: "🟢", label: "LIVE", text: "Found by today's web search, with a source link" },
    ONLINE_VERIFIED: { icon: "🌐", label: "ONLINE VERIFIED", text: "Online listing with a source" },
    RECEIPT_VERIFIED: { icon: "🧾", label: "RECEIPT VERIFIED", text: "From a receipt" },
    USER_ENTERED: { icon: "✍️", label: "USER ENTERED", text: "Typed in by you" },
    HISTORICAL: { icon: "🕰️", label: "HISTORICAL", text: "Real price, but old" },
    ESTIMATED: { icon: "🤖", label: "ESTIMATED", text: "AI estimate — not verified" },
    UNKNOWN: { icon: "❔", label: "UNKNOWN", text: "No price" }
  };
  var DEFAULT_PRICE_AGE = { historicalDays: 60, liveHours: 24, freshDays: 14 };

  // How old a price is, in days (null when undated).
  function priceAge(date, today) {
    var d = daysBetween(String(date || "").slice(0, 10), today);
    return d === null ? null : Math.max(0, d);
  }
  function freshness(date, today, opts) {
    var o = Object.assign({}, DEFAULT_PRICE_AGE, opts || {});
    var a = priceAge(date, today);
    if (a === null) return { level: "unknown", days: null, text: "date unknown" };
    var text = a === 0 ? "today" : (a === 1 ? "yesterday" : a + " days ago");
    return { level: a <= o.freshDays ? "fresh" : (a <= o.historicalDays ? "recent" : "stale"), days: a, text: text };
  }

  /*
    priceStatus({ price, source, date, verified, hasSource, at }, today, { now })
    source: receipt | purchase | manual | shelf | online | ai_estimate | research
  */
  function priceStatus(rec, today, opts) {
    var r = rec || {}, o = Object.assign({}, DEFAULT_PRICE_AGE, opts || {});
    if (num(r.price) === null) return "UNKNOWN";
    if (r.source === "ai_estimate") return "ESTIMATED";
    var age = priceAge(r.date || r.at, today);
    var old = age !== null && age > o.historicalDays;
    if (r.source === "research") {
      if (!r.verified || !r.hasSource) return "ESTIMATED";
      var hrs = r.at && o.now ? (Date.parse(o.now) - Date.parse(r.at)) / 3600000 : null;
      if (hrs !== null && hrs >= 0 && hrs <= o.liveHours) return "LIVE";
      return old ? "HISTORICAL" : "ONLINE_VERIFIED";
    }
    if (old) return "HISTORICAL";
    if (r.source === "online") return "ONLINE_VERIFIED";
    if (r.source === "receipt") return "RECEIPT_VERIFIED";
    if (r.source === "purchase" || r.source === "manual" || r.source === "shelf") return "USER_ENTERED";
    return "UNKNOWN";
  }

  function isEstimateSource(r) { return r && (r.source === "ai_estimate" || r.status === "unverified"); }

  /*
    storeRanking(records, today) — "Where should I buy this?"
    records: priceStats-style inputs { price, qty, size, unit, packCount, date, createdAt, storeKey, storeName, source }
    Latest real price per store (AI estimates never count), compared per kg/L/pc when every
    record has a size, else per item. → { basis, per, rows:[…sorted cheapest first], best, spreadPct, why }
  */
  function storeRanking(records, today, opts) {
    var valid = (records || []).filter(function (r) {
      return r && !r.archived && !isEstimateSource(r) && num(r.price) !== null && num(r.price) > 0 && (r.storeKey || r.storeName);
    });
    if (!valid.length) return { basis: null, per: null, rows: [], best: null, spreadPct: null, why: ["No store prices recorded yet — not enough data."] };
    var withUnit = valid.map(function (r) { return { r: r, u: unitPrice(r) }; });
    var dims = {};
    withUnit.forEach(function (x) { if (x.u.ok) dims[x.u.dim] = true; });
    var basis = withUnit.every(function (x) { return x.u.ok; }) && Object.keys(dims).length === 1 ? "unit" : "item";
    var val = function (x) { return basis === "unit" ? x.u.exact : x.u.itemPrice; };
    var sorted = withUnit.slice().sort(function (a, b) {
      return String(a.r.date || "").localeCompare(String(b.r.date || "")) || String(a.r.createdAt || "").localeCompare(String(b.r.createdAt || ""));
    });
    var byStore = {}, counts = {};
    sorted.forEach(function (x) { var k = x.r.storeKey || ("name:" + String(x.r.storeName).toLowerCase()); byStore[k] = x; counts[k] = (counts[k] || 0) + 1; });
    var rows = Object.keys(byStore).map(function (k) {
      var x = byStore[k];
      var f = freshness(x.r.date, today, opts);
      return { storeKey: k, storeName: x.r.storeName || "", value: round2(val(x)), exact: val(x), itemPrice: x.u.itemPrice, per: basis === "unit" ? x.u.perLabel : null,
        date: x.r.date || null, freshness: f, status: priceStatus(x.r, today, opts), source: x.r.source, records: counts[k], record: x.r };
    }).sort(function (a, b) { return a.exact - b.exact || (a.freshness.days === null ? 999 : a.freshness.days) - (b.freshness.days === null ? 999 : b.freshness.days); });
    var best = rows[0];
    var worst = rows[rows.length - 1];
    var spreadPct = rows.length > 1 && worst.exact > 0 ? round2((worst.exact - best.exact) / worst.exact * 100) : null;
    var unitTxt = function (r) { return formatPeso(r.value) + (r.per ? "/" + r.per : " each"); };
    var why = [];
    if (rows.length === 1) why.push("Only " + (best.storeName || "one store") + " has a recorded price (" + unitTxt(best) + ", " + best.freshness.text + ") — nothing to compare yet.");
    else {
      why.push((best.storeName || "This store") + " has the lowest latest price: " + unitTxt(best) + " (" + best.freshness.text + ").");
      why.push("That's " + spreadPct + "% less than " + (worst.storeName || "the priciest store") + " at " + unitTxt(worst) + ".");
      var ties = rows.filter(function (r) { return Math.abs(r.exact - best.exact) < 1e-9; }).length;
      if (ties > 1) why.push(ties + " stores share the lowest price — pick the nearest.");
    }
    if (best.freshness.level === "stale") why.push("⚠️ The best price is " + best.freshness.text + " — it may have changed.");
    if (basis === "unit") why.push("Compared per " + best.per + " so different pack sizes are fair.");
    else if (Object.keys(dims).length > 1) why.push("Sizes use different units, so prices are compared per item.");
    return { basis: basis, per: basis === "unit" ? best.per : null, rows: rows, best: best, spreadPct: spreadPct, why: why };
  }

  /*
    splitList(items) — best store per item for a whole list.
    items: [{ id, name, prices:{ storeKey: lineAmount }, override: storeKey|null }]
    → { assign:{id:{storeKey, amount, reason}}, perStore:{k:{total,items}}, total, unpriced:[ids], bestSingle, savingVsSingle, why }
  */
  function splitList(items, storeNames) {
    var names = storeNames || {};
    var assign = {}, perStore = {}, unpriced = [], total = 0;
    var list = (items || []).filter(Boolean);
    list.forEach(function (it) {
      var prices = it.prices || {};
      var keys = Object.keys(prices).filter(function (k) { return num(prices[k]) !== null; });
      var k = null, reason = "cheapest";
      if (it.override) { k = it.override; reason = "override"; }
      else if (keys.length) {
        k = keys.reduce(function (m, x) { return prices[x] < prices[m] ? x : m; });
        if (keys.length === 1) reason = "only_store";
      }
      var amount = k && num(prices[k]) !== null ? round2(prices[k]) : null;
      if (amount === null) unpriced.push(it.id);
      assign[it.id] = { storeKey: k, amount: amount, reason: k ? reason : "no_price" };
      if (k) {
        perStore[k] = perStore[k] || { total: 0, items: [] };
        perStore[k].items.push(it.id);
        if (amount !== null) { perStore[k].total = round2(perStore[k].total + amount); total += amount; }
      }
    });
    total = round2(total);
    // compare with buying everything at one store — only when that store prices every item we priced
    var priced = list.filter(function (it) { return assign[it.id].amount !== null; });
    var allKeys = {};
    list.forEach(function (it) { Object.keys(it.prices || {}).forEach(function (k) { allKeys[k] = true; }); });
    var singles = Object.keys(allKeys).map(function (k) {
      var cover = priced.filter(function (it) { return num((it.prices || {})[k]) !== null; });
      return { storeKey: k, covers: cover.length, total: round2(cover.reduce(function (s, it) { return s + it.prices[k]; }, 0)) };
    }).sort(function (a, b) { return b.covers - a.covers || a.total - b.total; });
    var bestSingle = singles.length && singles[0].covers === priced.length && priced.length ? singles[0] : null;
    var saving = bestSingle ? round2(bestSingle.total - total) : null;
    var why = [];
    var stores = Object.keys(perStore);
    if (!priced.length) why.push("None of these items has a recorded price yet — not enough data to split.");
    else {
      why.push("Each item goes to the store with its lowest recorded price" + (list.some(function (it) { return it.override; }) ? " (except the ones you chose yourself)" : "") + ".");
      if (bestSingle && saving > 0.004) why.push("Splitting across " + stores.length + " stores saves " + formatPeso(saving) + " vs buying everything at " + (names[bestSingle.storeKey] || bestSingle.storeKey) + " (" + formatPeso(bestSingle.total) + ").");
      else if (bestSingle) why.push((names[bestSingle.storeKey] || bestSingle.storeKey) + " alone costs the same, so one stop is enough.");
      else why.push("No single store has prices for every item, so I can't say how much splitting saves — not enough data.");
    }
    if (unpriced.length) why.push(unpriced.length + " item" + (unpriced.length === 1 ? " has" : "s have") + " no price yet and " + (unpriced.length === 1 ? "isn't" : "aren't") + " counted.");
    return { assign: assign, perStore: perStore, total: total, unpriced: unpriced, bestSingle: bestSingle, savingVsSingle: saving, why: why };
  }

  /*
    planRoute(items, stores, settings, mode) — route optimizer.
      items:  [{ id, prices:{storeKey: lineAmount}, lock: storeKey|null }]
      stores: { storeKey: { name, minutes, km } }   (from home, typed by Jason; null = not set)
      settings: { betweenStoresMinutes, betweenStoresKm, shoppingMinutes, timeValuePerHour, fuelPerKm }
      mode: "balance" (default) | "cheapest" | "fewest" | "fastest"
    Travel model (no maps service): out to the farthest store and back, plus a fixed hop
    between stores and shopping time per stop — all from Jason's settings.
  */
  var ROUTE_MODES = {
    balance: { label: "BEST BALANCE", text: "Price, time and stops together" },
    cheapest: { label: "CHEAPEST", text: "Lowest total, even with more stops" },
    fewest: { label: "FEWEST STOPS", text: "As few stores as possible" },
    fastest: { label: "FASTEST", text: "Least time out of the house" }
  };
  var DEFAULT_ROUTE = { mode: "balance", betweenStoresMinutes: 10, betweenStoresKm: 3, shoppingMinutes: 20, timeValuePerHour: 100, fuelPerKm: null };

  function routeTravel(keys, stores, s) {
    var mins = keys.map(function (k) { return num((stores[k] || {}).minutes); });
    var kms = keys.map(function (k) { return num((stores[k] || {}).km); });
    var n = keys.length;
    var travel = mins.every(function (m) { return m !== null && m >= 0; }) ? 2 * Math.max.apply(null, mins) + (n - 1) * s.betweenStoresMinutes : null;
    var km = kms.every(function (m) { return m !== null && m >= 0; }) ? round2(2 * Math.max.apply(null, kms) + (n - 1) * s.betweenStoresKm) : null;
    var order = keys.slice().sort(function (a, b) { return (num((stores[a] || {}).minutes) === null ? 1e9 : stores[a].minutes) - (num((stores[b] || {}).minutes) === null ? 1e9 : stores[b].minutes); });
    return { travelMinutes: travel, shopMinutes: n * s.shoppingMinutes, minutes: travel === null ? null : travel + n * s.shoppingMinutes, km: km, order: order };
  }

  function planRoute(items, stores, settings, mode) {
    var s = Object.assign({}, DEFAULT_ROUTE, settings || {});
    var m = ROUTE_MODES[mode] ? mode : s.mode || "balance";
    var st = stores || {};
    var list = (items || []).filter(Boolean);
    var keySet = {};
    list.forEach(function (it) { Object.keys(it.prices || {}).forEach(function (k) { if (num(it.prices[k]) !== null) keySet[k] = true; }); if (it.lock) keySet[it.lock] = true; });
    var keys = Object.keys(keySet);
    // keep the search small: the 8 stores that price the most items
    if (keys.length > 8) keys = keys.sort(function (a, b) {
      var ca = list.filter(function (it) { return num((it.prices || {})[a]) !== null; }).length, cb = list.filter(function (it) { return num((it.prices || {})[b]) !== null; }).length;
      return cb - ca;
    }).slice(0, 8);
    var locks = {};
    list.forEach(function (it) { if (it.lock) locks[it.lock] = true; });
    var maxCover = list.filter(function (it) { return it.lock ? num((it.prices || {})[it.lock]) !== null : keys.some(function (k) { return num((it.prices || {})[k]) !== null; }); }).length;
    // For BEST BALANCE only: a store with no travel time is assumed to be as far as the farthest
    // store whose time you did set (never "free"). With no times at all, only stops are compared.
    var knownAll = Object.keys(st).map(function (k) { return num((st[k] || {}).minutes); }).filter(function (x) { return x !== null && x >= 0; });
    var assumeMinutes = knownAll.length ? Math.max.apply(null, knownAll) : null;
    var plans = [];
    for (var mask = 1; mask < (1 << keys.length); mask++) {
      var sub = keys.filter(function (k, i) { return mask & (1 << i); });
      if (Object.keys(locks).some(function (k) { return sub.indexOf(k) < 0; })) continue;
      var assign = {}, used = {}, total = 0, cover = 0;
      list.forEach(function (it) {
        var p = it.prices || {}, k = null;
        if (it.lock) k = it.lock;
        else sub.forEach(function (x) { if (num(p[x]) !== null && (k === null || p[x] < p[k])) k = x; });
        var amt = k !== null && num(p[k]) !== null ? p[k] : null;
        assign[it.id] = { storeKey: k, amount: amt === null ? null : round2(amt), locked: !!it.lock };
        if (k !== null) used[k] = true;
        if (amt !== null) { total += amt; cover++; }
      });
      if (cover < maxCover) continue;                      // every plan must cover the same priced items
      if (sub.some(function (k) { return !used[k]; })) continue;   // an unused stop is never better
      var tr = routeTravel(sub, st, s);
      var fuel = s.fuelPerKm > 0 && tr.km !== null ? round2(tr.km * s.fuelPerKm) : null;
      var knownMinutes = tr.minutes;
      if (knownMinutes === null) {
        var est = sub.map(function (k) { var x = num((st[k] || {}).minutes); return x !== null && x >= 0 ? x : assumeMinutes; });
        knownMinutes = est.every(function (x) { return x !== null; }) ? 2 * Math.max.apply(null, est) + (sub.length - 1) * s.betweenStoresMinutes + tr.shopMinutes
          : (sub.length - 1) * s.betweenStoresMinutes + tr.shopMinutes;
      }
      plans.push({ stores: tr.order, stops: sub.length, assign: assign, itemsTotal: round2(total), fuel: fuel, minutes: tr.minutes, travelMinutes: tr.travelMinutes, km: tr.km,
        travelKnown: tr.minutes !== null, balanceScore: round2(total + (fuel || 0) + knownMinutes * (num(s.timeValuePerHour) || 0) / 60) });
    }
    var cmp = {
      cheapest: function (a, b) { return (a.itemsTotal + (a.fuel || 0)) - (b.itemsTotal + (b.fuel || 0)) || a.stops - b.stops; },
      fewest: function (a, b) { return a.stops - b.stops || a.itemsTotal - b.itemsTotal; },
      fastest: function (a, b) { return (b.travelKnown - a.travelKnown) || ((a.minutes === null ? a.stops * s.shoppingMinutes : a.minutes) - (b.minutes === null ? b.stops * s.shoppingMinutes : b.minutes)) || a.itemsTotal - b.itemsTotal; },
      balance: function (a, b) { return a.balanceScore - b.balanceScore || a.stops - b.stops; }
    };
    var bestBy = {};
    Object.keys(cmp).forEach(function (k) { bestBy[k] = plans.slice().sort(cmp[k])[0] || null; });
    var ranked = plans.slice().sort(cmp[m]);
    var best = ranked[0] || null;
    var unpriced = list.filter(function (it) { return !best || best.assign[it.id].amount === null; }).map(function (it) { return it.id; });
    var why = [];
    var names = function (ks) { return ks.map(function (k) { return (st[k] && st[k].name) || k; }).join(" → "); };
    if (!best) why.push("No recorded prices for these items yet — not enough data to plan a route.");
    else {
      why.push(ROUTE_MODES[m].label + ": " + names(best.stores) + " · " + best.stops + " stop" + (best.stops === 1 ? "" : "s") + " · items " + formatPeso(best.itemsTotal) + (best.minutes !== null ? " · about " + Math.round(best.minutes) + " min" : "") + ".");
      var ch = bestBy.cheapest;
      if (ch && ch !== best && ch.itemsTotal < best.itemsTotal - 0.004) why.push("The cheapest plan (" + names(ch.stores) + ") saves " + formatPeso(round2(best.itemsTotal - ch.itemsTotal)) + " more but needs " + ch.stops + " stop" + (ch.stops === 1 ? "" : "s") + (ch.minutes !== null && best.minutes !== null ? " and about " + Math.round(ch.minutes - best.minutes) + " more minutes" : "") + ".");
      else if (m !== "cheapest") why.push("It's also the cheapest way to buy these items.");
      var fw = bestBy.fewest;
      if (fw && fw.stops < best.stops) why.push("One-stop option: " + names(fw.stores) + " for " + formatPeso(fw.itemsTotal) + " (" + formatPeso(round2(fw.itemsTotal - best.itemsTotal)) + " more).");
      if (m === "balance") why.push("Balance counts your time at " + formatPeso(num(s.timeValuePerHour) || 0) + "/hour" + (s.fuelPerKm > 0 ? " and fuel at " + formatPeso(s.fuelPerKm) + "/km" : "") + " — change it in route settings.");
      if (!best.travelKnown) why.push("Travel times aren't set for every store, so only shopping time (" + s.shoppingMinutes + " min per stop) is counted. Add minutes from home in My stores.");
      if (m === "balance" && assumeMinutes !== null && plans.some(function (p) { return !p.travelKnown; })) why.push("Stores without a travel time are treated as " + Math.round(assumeMinutes) + " min from home (your farthest set store) when balancing, so an unknown trip never looks free.");
      if (Object.keys(locks).length) why.push("Stores you picked yourself are kept.");
    }
    if (unpriced.length) why.push(unpriced.length + " item" + (unpriced.length === 1 ? " has" : "s have") + " no recorded price — buy " + (unpriced.length === 1 ? "it" : "them") + " wherever is convenient.");
    return { mode: m, best: best, bestBy: bestBy, plans: ranked.slice(0, 5), planCount: plans.length, unpriced: unpriced, maxCover: maxCover, why: why };
  }

  /*
    bulkBreakEven({ small:{price,size}, bulk:{price,size}, perDay, shelfLifeDays })
    sizes in the same unit. → verdict BUY_BULK | BUY_SMALL | BULK_IF_USED + numbers + why
  */
  function bulkBreakEven(input) {
    var o = input || {};
    var sp = num(o.small && o.small.price), ss = num(o.small && o.small.size), bp = num(o.bulk && o.bulk.price), bs = num(o.bulk && o.bulk.size);
    if (!(sp > 0 && ss > 0 && bp > 0 && bs > 0)) return { verdict: "NOT_ENOUGH_DATA", why: ["Need a real price and size for both packs — not enough data."] };
    var su = sp / ss, bu = bp / bs;
    var perDay = num(o.perDay), life = num(o.shelfLifeDays);
    var r = { smallUnit: round2(su), bulkUnit: round2(bu), savingPerUnit: round2(su - bu), savingPct: round2((su - bu) / su * 100),
      fullSaving: round2(su * bs - bp), breakEvenUnits: round2(bp / su), breakEvenPct: round2(bp / su / bs * 100),
      daysToUse: perDay > 0 ? round2(bs / perDay) : null, usable: null, waste: null, effectiveSaving: null, expiryRisk: "NONE", storageRisk: null, why: [] };
    if (perDay > 0 && life > 0) {
      r.usable = round2(Math.min(bs, perDay * life));
      r.waste = round2(bs - r.usable);
      r.effectiveSaving = round2(su * r.usable - bp);
      r.expiryRisk = r.daysToUse > life ? "HIGH" : (r.daysToUse > life * 0.75 ? "MEDIUM" : "LOW");
    } else if (life > 0) r.expiryRisk = "UNKNOWN";
    if (r.daysToUse !== null) r.storageRisk = r.daysToUse > 90 ? "HIGH" : (r.daysToUse > 45 ? "MEDIUM" : "LOW");
    if (bu >= su - 1e-9) {
      r.verdict = "BUY_SMALL";
      r.why.push("The big pack isn't cheaper per unit (" + formatPeso(r.bulkUnit) + " vs " + formatPeso(r.smallUnit) + ").");
    } else if (r.expiryRisk === "HIGH" && r.effectiveSaving <= 0) {
      r.verdict = "BUY_SMALL";
      r.why.push("Cheaper per unit, but at your pace about " + r.waste + " would expire before it's used, wiping out the saving.");
    } else if (r.daysToUse === null) {
      r.verdict = "BULK_IF_USED";
      r.why.push("The big pack is " + r.savingPct + "% cheaper per unit. You must use at least " + r.breakEvenPct + "% of it (" + r.breakEvenUnits + ") to come out ahead — I don't know how fast you use it yet (not enough data).");
    } else {
      r.verdict = "BUY_BULK";
      r.why.push("The big pack is " + r.savingPct + "% cheaper per unit — " + formatPeso(r.effectiveSaving !== null ? r.effectiveSaving : r.fullSaving) + " saved over " + Math.round(r.daysToUse) + " days of use.");
      r.why.push("Break-even: use at least " + r.breakEvenPct + "% of it (" + r.breakEvenUnits + ").");
    }
    if (r.expiryRisk === "MEDIUM") r.why.push("⚠️ It takes about " + Math.round(r.daysToUse) + " days to use, close to its " + life + "-day shelf life.");
    if (r.expiryRisk === "HIGH" && r.verdict !== "BUY_SMALL") r.why.push("⚠️ About " + r.waste + " may expire before you finish it; still cheaper overall by " + formatPeso(r.effectiveSaving) + ".");
    if (r.storageRisk === "HIGH") r.why.push("📦 Ties up storage (and " + formatPeso(bp) + ") for about " + Math.round(r.daysToUse) + " days.");
    return r;
  }

  // Compare pack sizes of the same thing by unit price. options: [{ id, label, price, qty, size, unit, packCount }]
  function packSizeValue(options) {
    var rows = (options || []).map(function (o) { return { o: o, u: unitPrice(o) }; }).filter(function (x) { return x.u.ok; });
    if (rows.length < 2) return { rows: [], comparable: false, why: ["Need at least two sizes with a price — not enough data."] };
    var dims = {};
    rows.forEach(function (x) { dims[x.u.dim] = true; });
    if (Object.keys(dims).length > 1) return { rows: [], comparable: false, why: ["These sizes use different kinds of units (weight vs volume), so they can't be compared."] };
    rows.sort(function (a, b) { return a.u.exact - b.u.exact; });
    var best = rows[0].u.exact;
    var out = rows.map(function (x) { return { id: x.o.id, label: x.o.label, unitValue: x.u.value, per: x.u.perLabel, itemPrice: x.u.itemPrice, morePct: best > 0 ? round2((x.u.exact - best) / best * 100) : 0 }; });
    return { rows: out, comparable: true, best: out[0], why: [out[0].label + " is the best value at " + formatPeso(out[0].unitValue) + "/" + out[0].per + (out.length > 1 ? "; " + out[out.length - 1].label + " costs " + out[out.length - 1].morePct + "% more per " + out[0].per : "") + "."] };
  }

  /*
    buyAdvice({ history:[{value,date}], current:{value,date}?, target, minRecords:3 })
    Based only on recorded prices. → { verdict: BUY_NOW|WAIT|FAIR|NOT_ENOUGH_DATA, low, high, avg, suggestedTarget, why }
  */
  var BUY_ADVICE = {
    BUY_NOW: { icon: "✅", label: "BUY NOW" }, WAIT: { icon: "⏳", label: "WAIT" },
    FAIR: { icon: "👌", label: "FAIR PRICE" }, NOT_ENOUGH_DATA: { icon: "❔", label: "NOT ENOUGH DATA" }
  };
  function buyAdvice(input) {
    var o = input || {};
    var hist = (o.history || []).filter(function (h) { return h && num(h.value) !== null && num(h.value) > 0; })
      .sort(function (a, b) { return String(a.date || "").localeCompare(String(b.date || "")); });
    var target = num(o.target);
    var cur = o.current && num(o.current.value) !== null ? o.current : hist[hist.length - 1];
    var min = o.minRecords || 3;
    if (!cur) return { verdict: "NOT_ENOUGH_DATA", why: ["No price recorded yet."] };
    var c = num(cur.value);
    if (target !== null && target > 0 && c <= target + 1e-9) {
      return { verdict: "BUY_NOW", current: c, target: target, why: ["At or below your target of " + formatPeso(target) + " (now " + formatPeso(c) + ")."] };
    }
    if (hist.length < min) return { verdict: "NOT_ENOUGH_DATA", current: c, target: target, count: hist.length, why: ["Only " + hist.length + " price" + (hist.length === 1 ? "" : "s") + " recorded — I need at least " + min + " to judge (not enough data)."] };
    var vals = hist.map(function (h) { return num(h.value); });
    var low = Math.min.apply(null, vals), high = Math.max.apply(null, vals);
    var avg = vals.reduce(function (s, v) { return s + v; }, 0) / vals.length;
    var srt = vals.slice().sort(function (a, b) { return a - b; });
    var q = srt[Math.floor((srt.length - 1) * 0.25)];
    var lowRec = hist.filter(function (h) { return num(h.value) === low; }).pop();
    var res = { current: c, low: round2(low), high: round2(high), avg: round2(avg), count: vals.length, target: target, suggestedTarget: round2(q), vsAvgPct: round2((c - avg) / avg * 100), why: [] };
    if (c <= low * 1.02) { res.verdict = "BUY_NOW"; res.why.push(formatPeso(c) + " is the lowest (or within 2% of the lowest) of your " + vals.length + " recorded prices."); }
    else if (c <= avg * 0.95) { res.verdict = "BUY_NOW"; res.why.push(formatPeso(c) + " is " + Math.abs(res.vsAvgPct) + "% below your average of " + formatPeso(res.avg) + "."); }
    else if (c >= avg * 1.05) { res.verdict = "WAIT"; res.why.push(formatPeso(c) + " is " + res.vsAvgPct + "% above your average of " + formatPeso(res.avg) + "; you've paid " + formatPeso(res.low) + (lowRec && lowRec.date ? " (" + lowRec.date + ")" : "") + "."); res.why.push("If you need it now, buy only what you need until the price drops."); }
    else { res.verdict = "FAIR"; res.why.push(formatPeso(c) + " is within 5% of your average (" + formatPeso(res.avg) + ")."); }
    if (target === null) res.why.push("Suggested target from your history: " + formatPeso(res.suggestedTarget) + ".");
    return res;
  }

  /*
    fundCheck(amount, budget, { upcoming }) — fund protection for bigger purchases.
    AFFORDABLE · CAUTION (pushes into WATCH/WARNING or uses half of Safe to Spend)
    · WAIT (fits now but leaves too little for upcoming needs/recurring) · EXCEEDS (over Safe to Spend / hard stop)
  */
  var FUND_VERDICTS = {
    AFFORDABLE: { icon: "✅", label: "AFFORDABLE" }, CAUTION: { icon: "🟠", label: "CAUTION" },
    WAIT: { icon: "⏳", label: "WAIT" }, EXCEEDS: { icon: "⛔", label: "EXCEEDS" }, SETUP: { icon: "⚙️", label: "SET UP BUDGET" }
  };
  function fundCheck(amount, budget, opts) {
    var a = num(amount);
    var b = budgetSummary(budget);
    var up = Math.max(0, num(opts && opts.upcoming) || 0);
    if (!(a > 0)) return { verdict: "SETUP", why: ["Enter an amount."] };
    if (b.state === "SETUP") return { verdict: "SETUP", why: ["Set your Shopping Fund first."] };
    var after = budgetSummary(Object.assign({}, budget, { committed: money(budget && budget.committed) + a }));
    var safe = b.safeToSpend;
    var r = { amount: a, safeBefore: safe, safeAfter: after.safeToSpend, rawAfter: after.rawSafe, upcoming: round2(up), leftAfterUpcoming: round2(safe - a - up), usedPctAfter: after.usedPct, stateAfter: after.state, why: [] };
    var stop = crossesHardStop(budget, a, { includeCommitted: true });
    if (a > safe + 1e-9 || stop) {
      r.verdict = "EXCEEDS";
      r.why.push(formatPeso(a) + " is more than you can safely spend (" + formatPeso(safe) + ")" + (after.overBy > 0 ? " — over by " + formatPeso(after.overBy) : "") + ".");
      if (stop) r.why.push("It would go past your hard stop.");
    } else if (up > 0 && a > safe - up + 1e-9) {
      r.verdict = "WAIT";
      r.why.push("It fits today, but leaves " + formatPeso(round2(safe - a)) + " for " + formatPeso(r.upcoming) + " of needs and recurring purchases coming up.");
      r.why.push("Short by " + formatPeso(round2(a + up - safe)) + " — wait for the next fund top-up or trim the list first.");
    } else if (after.state === "WATCH" || after.state === "WARNING" || a >= safe * 0.5) {
      r.verdict = "CAUTION";
      r.why.push("Affordable, but it " + (after.state === "WATCH" || after.state === "WARNING" ? "puts you at " + Math.round(after.usedPct) + "% used (" + after.state + ")" : "uses " + Math.round(a / safe * 100) + "% of what's safe to spend") + ".");
      r.why.push(formatPeso(after.safeToSpend) + " would be left" + (up > 0 ? ", " + formatPeso(r.leftAfterUpcoming) + " after upcoming needs" : "") + ".");
    } else {
      r.verdict = "AFFORDABLE";
      r.why.push("Fits comfortably: " + formatPeso(after.safeToSpend) + " left to spend" + (up > 0 ? " (" + formatPeso(r.leftAfterUpcoming) + " after upcoming needs)" : "") + ".");
    }
    return r;
  }

  /* ---------- recurring purchase dates ---------- */

  // every: { unit: "days"|"weeks"|"months", n }
  function advanceDate(day, every) {
    var e = every || { unit: "months", n: 1 };
    var n = Math.max(1, Math.floor(num(e.n) || 1));
    if (e.unit === "days") return addDays(day, n);
    if (e.unit === "weeks") return addDays(day, 7 * n);
    var p = String(day).split("-").map(Number);
    if (p.length !== 3 || p.some(isNaN)) return null;
    var y = p[0], m = p[1] - 1 + n, d = p[2];
    y += Math.floor(m / 12); m = ((m % 12) + 12) % 12;
    var last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    return y + "-" + String(m + 1).padStart(2, "0") + "-" + String(Math.min(d, last)).padStart(2, "0");
  }
  function occurrencesBetween(startDay, every, from, to, limit) {
    var out = [], d = startDay, guard = 0;
    while (d && d <= to && guard++ < (limit || 500)) {
      if (d >= from) out.push(d);
      d = advanceDate(d, every);
    }
    return out;
  }

  /*
    forecast30({ today, entries, scheduled, restock, safeNow, fund, days, minHistoryDays })
      entries: counted spending { date, amount } (history)
      scheduled: [{ date, amount, label, kind }] recurring not yet committed, etc.
      restock:   [{ date, amount|null, label }] items running out (priced from the Price Book)
    projected = the larger of (history-based baseline) and (known items) — never just a guess.
  */
  function forecast30(input) {
    var o = input || {};
    var days = o.days || 30, today = o.today;
    var start = addDays(today, 1), end = addDays(today, days);
    var histFrom = addDays(today, -60);
    var entries = (o.entries || []).filter(function (e) { return e && e.date && num(e.amount) > 0 && e.date <= today; });
    var recent = entries.filter(function (e) { return e.date >= histFrom; });
    var first = entries.map(function (e) { return e.date; }).sort()[0] || null;
    var span = first ? Math.min(60, daysBetween(first, today) + 1) : 0;
    var minDays = o.minHistoryDays || 14;
    var baselineDaily = span >= minDays ? round2(sum(recent, function (e) { return e.amount; }) / span) : null;
    var baseline = baselineDaily === null ? null : Math.round(baselineDaily * days);   // an estimate: whole pesos
    var known = [];
    (o.scheduled || []).forEach(function (x) { if (x && x.date >= start && x.date <= end && num(x.amount) > 0) known.push({ date: x.date, amount: round2(x.amount), label: x.label || "", kind: x.kind || "scheduled" }); });
    var unpricedRestock = [];
    (o.restock || []).forEach(function (x) {
      if (!x || !x.date || x.date > end) return;
      var d = x.date < start ? start : x.date;
      if (num(x.amount) > 0) known.push({ date: d, amount: round2(x.amount), label: x.label || "", kind: "restock" });
      else unpricedRestock.push({ date: d, label: x.label || "" });
    });
    known.sort(function (a, b) { return a.date.localeCompare(b.date); });
    var knownTotal = round2(sum(known, function (k) { return k.amount; }));
    var basis = baseline === null ? "known_only" : (baseline >= knownTotal ? "history" : "known");
    var projected = baseline === null ? knownTotal : Math.max(baseline, knownTotal);
    var weeks = [];
    for (var w = 0; w < Math.ceil(days / 7); w++) {
      var ws = addDays(start, w * 7), we = addDays(start, Math.min(days, (w + 1) * 7) - 1);
      var len = daysBetween(ws, we) + 1;
      var k = round2(sum(known.filter(function (x) { return x.date >= ws && x.date <= we; }), function (x) { return x.amount; }));
      var base = baselineDaily === null ? null : Math.round(baselineDaily * len);
      weeks.push({ start: ws, end: we, known: k, baseline: base, total: base === null ? k : Math.max(base, k) });
    }
    var safe = num(o.safeNow);
    var endSafe = safe === null ? null : round2(safe - projected);
    var fund = num(o.fund) || 0;
    var status = endSafe === null ? "SETUP" : (endSafe < 0 ? "SHORT" : (fund > 0 && endSafe < fund * 0.1 ? "TIGHT" : "OK"));
    var why = [];
    if (baseline !== null) why.push("Your recorded spending averages " + formatPeso(baselineDaily) + "/day over the last " + span + " days → about " + formatPeso(baseline) + " in " + days + " days.");
    else why.push("Less than " + minDays + " days of spending history, so only known items are counted (not enough data for a full forecast).");
    if (known.length) why.push("Known coming up: " + formatPeso(knownTotal) + " (" + known.length + " item" + (known.length === 1 ? "" : "s") + ": recurring purchases and things running out, priced from your Price Book).");
    if (baseline !== null && knownTotal > baseline) why.push("Known items are more than your usual pace, so the forecast uses them.");
    if (unpricedRestock.length) why.push(unpricedRestock.length + " item" + (unpricedRestock.length === 1 ? "" : "s") + " running out " + (unpricedRestock.length === 1 ? "has" : "have") + " no price yet and " + (unpricedRestock.length === 1 ? "isn't" : "aren't") + " counted.");
    if (status === "SHORT") why.push("⚠️ That's " + formatPeso(-endSafe) + " more than you can safely spend now.");
    else if (status === "TIGHT") why.push("Only " + formatPeso(endSafe) + " would be left — tight.");
    else if (status === "OK") why.push(formatPeso(endSafe) + " would still be safe to spend.");
    return { start: start, end: end, days: days, historyDays: span, baselineDaily: baselineDaily, baseline: baseline, known: known, knownTotal: knownTotal,
      unpricedRestock: unpricedRestock, projected: round2(projected), basis: basis, weeks: weeks, safeNow: safe, endSafe: endSafe, status: status, why: why };
  }

  /* =====================================================================
     STAGE 4 — analytics. Every number comes from recorded data; when there
     isn't enough, functions say so (notEnough / null) instead of guessing.
     ===================================================================== */

  function medianOf(values) {
    var v = (values || []).map(num).filter(function (x) { return x !== null; }).sort(function (a, b) { return a - b; });
    if (!v.length) return null;
    var mid = Math.floor(v.length / 2);
    return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
  }
  function madOf(values, med) {
    var m = med === undefined ? medianOf(values) : med;
    if (m === null) return null;
    return medianOf((values || []).map(function (x) { return Math.abs(num(x) - m); }));
  }
  function monthKey(day) {
    var m = /^(\d{4})-(\d{2})/.exec(String(day || ""));
    return m ? m[1] + "-" + m[2] : null;
  }
  var MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  function monthLabel(key, long) {
    var m = /^(\d{4})-(\d{2})$/.exec(String(key || ""));
    if (!m) return "—";
    return MONTH_NAMES[+m[2] - 1] + (long === false ? "" : " " + m[1]);
  }
  // Every month key from start..end inclusive.
  function monthsBetween(start, end) {
    var a = monthKey(start), b = monthKey(end), out = [];
    if (!a || !b || a > b) return out;
    var y = +a.slice(0, 4), m = +a.slice(5, 7);
    for (var guard = 0; guard < 600; guard++) {
      var k = y + "-" + String(m).padStart(2, "0");
      out.push(k);
      if (k === b) break;
      m++; if (m > 12) { m = 1; y++; }
    }
    return out;
  }

  var INSIGHT_RANGE_DAYS = { "30d": 30, "90d": 90, "180d": 180, "365d": 365 };
  // Date range for a preset ("30d"… or "all") or {start,end}. Includes today.
  function insightRange(preset, today, earliest) {
    if (preset && typeof preset === "object") {
      var s = preset.start || earliest || today, e = preset.end || today;
      if (s > e) { var t = s; s = e; e = t; }
      return { start: s, end: e, days: daysBetween(s, e) + 1, preset: "custom" };
    }
    var days = INSIGHT_RANGE_DAYS[preset];
    if (!days) {
      var st = earliest && earliest <= today ? earliest : today;
      return { start: st, end: today, days: daysBetween(st, today) + 1, preset: "all" };
    }
    return { start: addDays(today, -(days - 1)), end: today, days: days, preset: preset };
  }
  function previousRange(range) {
    var end = addDays(range.start, -1);
    return { start: addDays(end, -(range.days - 1)), end: end, days: range.days };
  }

  function groupTotals(list, keyOf, total) {
    var map = {};
    list.forEach(function (e) {
      var k = keyOf(e) || "Other";
      if (!map[k]) map[k] = { name: k, total: 0, count: 0, days: {} };
      map[k].total += num(e.amount);
      map[k].count += 1;
      if (e.date) map[k].days[e.date] = true;
    });
    return Object.keys(map).map(function (k) {
      var g = map[k];
      return { name: g.name, total: round2(g.total), count: g.count, visits: Object.keys(g.days).length, share: total > 0 ? round2(g.total / total * 100) : 0 };
    }).sort(function (a, b) { return b.total - a.total || a.name.localeCompare(b.name); });
  }

  // Spending trends from history entries {date, amount, category, store, counted}.
  function spendingTrends(entries, range) {
    var counted = (entries || []).filter(function (e) { return e && e.counted !== false && num(e.amount) !== null && num(e.amount) > 0 && e.date; });
    var inR = counted.filter(function (e) { return inRange(e.date, range); });
    var total = sum(inR, function (e) { return e.amount; });
    var prevR = previousRange(range);
    var prevList = counted.filter(function (e) { return inRange(e.date, prevR); });
    var prevTotal = sum(prevList, function (e) { return e.amount; });
    var months = monthsBetween(range.start, range.end).map(function (mk) {
      var list = inR.filter(function (e) { return monthKey(e.date) === mk; });
      return { month: mk, label: monthLabel(mk, false), total: sum(list, function (e) { return e.amount; }), count: list.length };
    });
    var earliest = counted.map(function (e) { return e.date; }).sort()[0] || null;
    var why = [];
    if (!inR.length) why.push("No counted spending recorded in this date range.");
    else why.push(inR.length + " counted entr" + (inR.length === 1 ? "y" : "ies") + " from " + range.start + " to " + range.end + ".");
    var change = null;
    if (prevList.length && prevTotal > 0 && earliest && earliest <= prevR.start) change = round2((total - prevTotal) / prevTotal * 100);
    else if (inR.length) why.push("Not enough earlier history to compare with the previous " + range.days + " days.");
    return {
      range: range, total: total, count: inR.length,
      dailyAvg: inR.length ? round2(total / range.days) : null,
      prevTotal: prevList.length ? prevTotal : null, changePct: change,
      months: months,
      byCategory: groupTotals(inR, function (e) { return e.category; }, total),
      byStore: groupTotals(inR, function (e) { return e.store; }, total),
      why: why
    };
  }

  // Personal basket index. records: [{productId, name, date, value}] where
  // value is a comparable per-unit price (real prices only — the caller
  // drops AI estimates). Base = first month with ≥ minProducts repeat items;
  // each later month compares the same products (matched pairs), weighted by
  // how often you record each product.
  function basketIndex(records, opts) {
    var o = opts || {};
    var minProducts = o.minProducts || 2;
    var byProd = {};
    (records || []).forEach(function (r) {
      var v = num(r.value), mk = monthKey(r.date);
      if (!r || !r.productId || v === null || v <= 0 || !mk) return;
      if (o.range && !inRange(r.date, { start: o.range.start, end: o.range.end })) return;
      var p = byProd[r.productId] || (byProd[r.productId] = { id: r.productId, name: r.name || r.productId, months: {}, count: 0 });
      (p.months[mk] = p.months[mk] || []).push(v);
      p.count++;
    });
    var basket = Object.keys(byProd).map(function (k) { return byProd[k]; }).filter(function (p) { return Object.keys(p.months).length >= 2; });
    var allMonths = {};
    basket.forEach(function (p) { Object.keys(p.months).forEach(function (m) { allMonths[m] = (allMonths[m] || 0) + 1; }); });
    var months = Object.keys(allMonths).sort();
    var base = null;
    for (var i = 0; i < months.length; i++) if (allMonths[months[i]] >= minProducts) { base = months[i]; break; }
    var res = { base: base, baseLabel: base ? monthLabel(base) : null, basketSize: basket.length, months: [], latest: null, items: [], notEnough: false, why: [] };
    if (!base) {
      res.notEnough = true;
      res.why.push("Not enough data: needs at least " + minProducts + " products with real prices recorded in two different months.");
      return res;
    }
    var med = function (p, m) { return medianOf(p.months[m]); };
    months.filter(function (m) { return m >= base; }).forEach(function (m) {
      var matched = basket.filter(function (p) { return p.months[base] && p.months[m]; });
      if (matched.length < minProducts) { res.months.push({ month: m, label: monthLabel(m, false), index: null, products: matched.length }); return; }
      var cur = 0, bas = 0;
      matched.forEach(function (p) { cur += p.count * med(p, m); bas += p.count * med(p, base); });
      res.months.push({ month: m, label: monthLabel(m, false), index: round2(cur / bas * 100), products: matched.length });
    });
    var withIdx = res.months.filter(function (m) { return m.index !== null; });
    var last = withIdx[withIdx.length - 1];
    if (last && last.month !== base) {
      res.latest = { month: last.month, label: monthLabel(last.month), index: last.index, changePct: round2(last.index - 100), products: last.products };
      res.items = basket.filter(function (p) { return p.months[base] && p.months[last.month]; }).map(function (p) {
        var b = med(p, base), l = med(p, last.month);
        return { productId: p.id, name: p.name, baseValue: round2(b), latestValue: round2(l), changePct: round2((l - b) / b * 100), weight: p.count };
      }).sort(function (a, b) { return b.changePct - a.changePct; });
      res.why.push("Compares the same " + last.products + " products in " + monthLabel(last.month) + " vs " + res.baseLabel + " (median real price per unit each month, weighted by how often you record them).");
    } else {
      res.notEnough = true;
      res.why.push("Not enough data yet: only " + res.baseLabel + " has enough repeat prices. A comparison appears once the same products are priced in a later month.");
    }
    return res;
  }

  // Savings achieved, only from real before/after prices of the same product.
  // purchases: [{id, productId, name, date, at, value, paid, store}] (value
  // = comparable per-unit price, paid = what you paid for that line).
  // history: every real record [{id, productId, date, at, value, store}].
  function savingsFromPrices(purchases, history) {
    var byProd = {};
    (history || []).forEach(function (r) {
      if (!r || !r.productId || num(r.value) === null || num(r.value) <= 0 || !r.date) return;
      (byProd[r.productId] = byProd[r.productId] || []).push(r);
    });
    var lines = [], notComparable = 0;
    (purchases || []).forEach(function (p) {
      var v = num(p.value), paid = num(p.paid);
      if (!p || v === null || v <= 0 || paid === null || paid <= 0) { notComparable++; return; }
      var earlier = (byProd[p.productId] || []).filter(function (r) {
        if (r.id && r.id === p.id) return false;
        return r.date < p.date || (r.date === p.date && String(r.at || "") < String(p.at || "") && r.at);
      }).sort(function (a, b) { return a.date < b.date ? 1 : a.date > b.date ? -1 : String(b.at || "").localeCompare(String(a.at || "")); });
      if (!earlier.length) { notComparable++; return; }
      var before = num(earlier[0].value);
      var units = paid / v;
      var diff = round2(units * before - paid); // + saved, − paid more
      lines.push({ id: p.id, productId: p.productId, name: p.name, date: p.date, store: p.store, before: round2(before), after: round2(v),
        beforeDate: earlier[0].date, beforeStore: earlier[0].store || null, paid: round2(paid), diff: diff });
    });
    var saved = sum(lines.filter(function (l) { return l.diff > 0; }), function (l) { return l.diff; });
    var paidMore = sum(lines.filter(function (l) { return l.diff < 0; }), function (l) { return -l.diff; });
    var why = [];
    if (!lines.length) why.push("Not enough data: savings need the same product bought after an earlier recorded price.");
    else why.push("Each purchase is compared with the previous real price you recorded for the same product (what you'd have paid at that price − what you paid).");
    if (notComparable) why.push(notComparable + " purchase" + (notComparable === 1 ? "" : "s") + " had no earlier price to compare, so " + (notComparable === 1 ? "it isn't" : "they aren't") + " counted.");
    return { saved: saved, paidMore: paidMore, net: round2(saved - paidMore), compared: lines.length, notComparable: notComparable,
      notEnough: !lines.length, lines: lines.sort(function (a, b) { return b.diff - a.diff; }), why: why };
  }

  // Store performance. entries: counted history {date, amount, store};
  // comparisons: [{productId, rows:[{store, value}]}] latest real price per
  // store for products seen at 2+ stores.
  function storePerformance(entries, comparisons, range) {
    var counted = (entries || []).filter(function (e) { return e && e.counted !== false && e.store && num(e.amount) > 0 && (!range || inRange(e.date, range)); });
    var total = sum(counted, function (e) { return e.amount; });
    var map = {};
    var get = function (name) { return map[name] || (map[name] = { name: name, spend: 0, count: 0, days: {}, lastDate: null, wins: 0, compared: 0, premiums: [] }); };
    counted.forEach(function (e) {
      var s = get(e.store);
      s.spend += num(e.amount); s.count++; s.days[e.date] = true;
      if (!s.lastDate || e.date > s.lastDate) s.lastDate = e.date;
    });
    (comparisons || []).forEach(function (c) {
      var rows = (c.rows || []).filter(function (r) { return r.store && num(r.value) > 0; });
      if (rows.length < 2) return;
      var best = Math.min.apply(null, rows.map(function (r) { return num(r.value); }));
      var seen = {};
      rows.forEach(function (r) {
        if (seen[r.store]) return; seen[r.store] = true;
        var s = get(r.store);
        s.compared++;
        if (num(r.value) <= best + 1e-9) s.wins++;
        s.premiums.push((num(r.value) - best) / best * 100);
      });
    });
    var rows = Object.keys(map).map(function (k) {
      var s = map[k], visits = Object.keys(s.days).length;
      return { name: s.name, spend: round2(s.spend), entries: s.count, visits: visits, avgBasket: visits ? round2(s.spend / visits) : null,
        share: total > 0 ? round2(s.spend / total * 100) : 0, lastDate: s.lastDate, wins: s.wins, compared: s.compared,
        winRate: s.compared ? round2(s.wins / s.compared * 100) : null,
        avgPremiumPct: s.premiums.length ? round2(s.premiums.reduce(function (a, b) { return a + b; }, 0) / s.premiums.length) : null };
    }).sort(function (a, b) { return b.spend - a.spend || (b.compared - a.compared) || a.name.localeCompare(b.name); });
    var why = [];
    if (!rows.length) why.push("No store spending or price comparisons recorded yet.");
    if (!(comparisons || []).some(function (c) { return (c.rows || []).length >= 2; })) why.push("Price comparison needs the same product priced at 2+ stores.");
    return { total: total, stores: rows, why: why };
  }

  // Usage, waste, expiry losses and stock-outs from inventory transactions.
  // txs: [{itemId, type, qty, before, after, day, reason}] ; items: {id: {name, unitValue}}
  var WASTE_REASONS = { expired: "Expired", spoiled: "Spoiled", other: "Thrown out" };
  function usageAnalytics(txs, items, range, today) {
    var info = items || {};
    var per = {};
    var get = function (id) {
      if (!per[id]) per[id] = { itemId: id, name: (info[id] && info[id].name) || "Item", used: 0, wasted: 0, expired: 0, wasteValue: 0, wastePriced: true, unclear: 0, stockouts: 0, daysOut: 0, outSince: null };
      return per[id];
    };
    var sorted = (txs || []).filter(function (t) { return t && t.itemId && t.day; }).slice().sort(function (a, b) { return a.day < b.day ? -1 : a.day > b.day ? 1 : String(a.at || "").localeCompare(String(b.at || "")); });
    var endDay = range.end < today ? range.end : today;
    sorted.forEach(function (t) {
      var s = get(t.itemId), q = Math.abs(num(t.qty) || 0);
      var after = num(t.after), before = num(t.before);
      // stock-out tracking (across all time, counted when overlapping the range)
      if (after !== null && after <= 0 && (before === null || before > 0)) {
        s.outSince = t.day;
        if (inRange(t.day, range)) s.stockouts++;
      } else if (after !== null && after > 0 && s.outSince) {
        var from = s.outSince > range.start ? s.outSince : range.start;
        var to = t.day < endDay ? t.day : endDay;
        if (to >= from) s.daysOut += Math.max(0, daysBetween(from, to));
        s.outSince = null;
      }
      if (!inRange(t.day, range)) return;
      if (t.type === "use") s.used += q;
      else if (t.type === "discard") {
        if (t.reason && WASTE_REASONS[t.reason]) {
          s.wasted += q;
          if (t.reason === "expired") s.expired += q;
          var uv = info[t.itemId] ? num(info[t.itemId].unitValue) : null;
          if (uv !== null && uv > 0) s.wasteValue += q * uv; else s.wastePriced = false;
        } else s.unclear += q;
      }
    });
    Object.keys(per).forEach(function (id) {
      var s = per[id];
      if (s.outSince) {
        var from = s.outSince > range.start ? s.outSince : range.start;
        if (endDay >= from) s.daysOut += daysBetween(from, endDay);
      }
      s.wasteValue = round2(s.wasteValue);
      s.stillOut = !!s.outSince;
    });
    var rows = Object.keys(per).map(function (k) { return per[k]; });
    var wasteRows = rows.filter(function (s) { return s.wasted > 0; });
    var res = {
      items: rows,
      usedItems: rows.filter(function (s) { return s.used > 0; }).sort(function (a, b) { return b.used - a.used; }),
      waste: wasteRows.sort(function (a, b) { return b.wasteValue - a.wasteValue || b.wasted - a.wasted; }),
      wasteValue: sum(wasteRows, function (s) { return s.wasteValue; }),
      expiredValue: 0,
      wasteUnpriced: wasteRows.filter(function (s) { return !s.wastePriced; }).length,
      unclearDiscards: rows.filter(function (s) { return s.unclear > 0; }).length,
      stockouts: rows.reduce(function (a, s) { return a + s.stockouts; }, 0),
      daysOut: rows.reduce(function (a, s) { return a + s.daysOut; }, 0),
      outNow: rows.filter(function (s) { return s.stillOut; }).length,
      stockoutItems: rows.filter(function (s) { return s.stockouts > 0 || s.daysOut > 0; }).sort(function (a, b) { return b.daysOut - a.daysOut || b.stockouts - a.stockouts; }),
      why: []
    };
    res.expiredValue = round2(wasteRows.reduce(function (a, s) { return a + (s.wasted ? s.wasteValue * s.expired / s.wasted : 0); }, 0));
    if (!sorted.length) res.why.push("No stock changes recorded yet.");
    if (res.wasteUnpriced) res.why.push(res.wasteUnpriced + " thrown-out item" + (res.wasteUnpriced === 1 ? " has" : "s have") + " no Price Book price, so the peso loss is partial.");
    if (res.unclearDiscards) res.why.push("Older \"used up / thrown out\" entries don't say which, so they aren't counted as waste.");
    return res;
  }

  // Accuracy of a plan or forecast: 100% = exact; never below 0.
  function accuracy(planned, actual) {
    var p = num(planned), a = num(actual);
    if (p === null || a === null || p <= 0) return null;
    var err = (a - p) / p * 100;
    return { planned: round2(p), actual: round2(a), errorPct: round2(err), accuracyPct: round2(Math.max(0, 100 - Math.abs(err))),
      direction: Math.abs(err) <= 2 ? "on" : err > 0 ? "over" : "under" };
  }
  function avgAccuracy(rows) {
    var ok = rows.filter(function (r) { return r.acc; });
    return ok.length ? round2(ok.reduce(function (s, r) { return s + r.acc.accuracyPct; }, 0) / ok.length) : null;
  }
  // cycles: [{id, start, end, planned, actual}] (closed cycles only)
  function cycleAccuracy(cycles) {
    var rows = (cycles || []).filter(function (c) { return c && c.start && c.end; }).map(function (c) {
      return { id: c.id, start: c.start, end: c.end, planned: num(c.planned), actual: num(c.actual), acc: accuracy(c.planned, c.actual) };
    }).sort(function (a, b) { return a.start < b.start ? -1 : 1; });
    var avg = avgAccuracy(rows);
    return { rows: rows, average: avg, notEnough: avg === null,
      why: avg === null ? ["Not enough data: needs a finished shopping cycle that had a planned amount."] : ["Average over " + rows.filter(function (r) { return r.acc; }).length + " finished cycle(s): 100% means you spent exactly what was planned."] };
  }
  // Plan accuracy by category. periods: [{start,end}] complete periods;
  // plans: planHistory [{at, mode, items:[{categoryId, value}], fund}];
  // categories: [{id, name}]; entries: counted history {date, amount, category}.
  function planForPeriod(plans, period) {
    var endIso = period.end + "T23:59:59.999Z";
    var cands = (plans || []).filter(function (p) { return p && p.at && String(p.at) <= endIso; }).sort(function (a, b) { return String(a.at).localeCompare(String(b.at)); });
    return cands.length ? cands[cands.length - 1] : null;
  }
  function planAccuracy(periods, plans, categories, entries) {
    var cats = categories || [];
    var counted = (entries || []).filter(function (e) { return e && e.counted !== false && num(e.amount) > 0; });
    var out = [];
    (periods || []).forEach(function (period) {
      var plan = planForPeriod(plans, period);
      if (!plan || !(plan.items || []).length) return;
      var fund = money(plan.fund);
      var rows = [];
      plan.items.forEach(function (it) {
        var cat = cats.filter(function (c) { return c.id === it.categoryId; })[0];
        if (!cat) return;
        var v = num(it.value);
        var planned = plan.mode === "percent" ? (fund > 0 && v !== null ? round2(fund * v / 100) : null) : v;
        if (planned === null || planned <= 0) return;
        var actual = sum(counted.filter(function (e) { return inRange(e.date, period) && e.category === cat.name; }), function (e) { return e.amount; });
        rows.push({ categoryId: cat.id, category: cat.name, planned: planned, actual: actual, acc: accuracy(planned, actual) });
      });
      if (rows.length) out.push({ start: period.start, end: period.end, planAt: plan.at, rows: rows, average: avgAccuracy(rows) });
    });
    var byCat = {};
    out.forEach(function (p) { p.rows.forEach(function (r) { (byCat[r.category] = byCat[r.category] || []).push(r); }); });
    var categoriesOut = Object.keys(byCat).map(function (k) {
      var list = byCat[k];
      return { category: k, periods: list.length, average: avgAccuracy(list), planned: sum(list, function (r) { return r.planned; }), actual: sum(list, function (r) { return r.actual; }) };
    }).sort(function (a, b) { return (a.average === null) - (b.average === null) || a.average - b.average; });
    return { periods: out, categories: categoriesOut, average: avgAccuracy([].concat.apply([], out.map(function (p) { return p.rows; }))), notEnough: !out.length,
      why: out.length ? ["Each finished budget period is compared with the plan you had saved by its end date."] : ["Not enough data: needs a finished budget period with a saved budget plan."] };
  }
  // Forecast accuracy. snapshots: [{at, start, end, projected}]; checked once end < today.
  function forecastAccuracy(snapshots, entries, today) {
    var counted = (entries || []).filter(function (e) { return e && e.counted !== false && num(e.amount) > 0; });
    var done = [], pending = [];
    (snapshots || []).forEach(function (s) {
      if (!s || !s.start || !s.end || num(s.projected) === null) return;
      if (s.end >= today) { pending.push(s); return; }
      var actual = sum(counted.filter(function (e) { return inRange(e.date, s); }), function (e) { return e.amount; });
      done.push({ at: s.at, start: s.start, end: s.end, projected: num(s.projected), actual: actual, acc: accuracy(s.projected, actual) });
    });
    done.sort(function (a, b) { return a.end < b.end ? -1 : 1; });
    var next = pending.map(function (s) { return addDays(s.end, 1); }).sort()[0] || null;
    var avg = avgAccuracy(done);
    return { rows: done, average: avg, pending: pending.length, nextCheck: next, notEnough: avg === null,
      why: avg === null ? ["Not enough data yet" + (next ? " — first check on " + next : "") + ". Forecasts are saved as you use the app and checked when their 30 days end."]
        : ["Average over " + done.length + " finished forecast(s)."] };
  }

  // Unusual spending. entries: counted history {key, date, amount, category, store, title}.
  function unusualSpending(entries, range, opts) {
    var o = opts || {};
    var minHistory = o.minHistory || 5;
    var counted = (entries || []).filter(function (e) { return e && e.counted !== false && num(e.amount) > 0 && e.date; })
      .slice().sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
    var flags = [], skippedThin = 0;
    counted.forEach(function (e) {
      if (!inRange(e.date, range)) return;
      var cat = e.category || "Other";
      var prior = counted.filter(function (x) { return x !== e && (x.category || "Other") === cat && x.date < e.date && daysBetween(x.date, e.date) <= 365; }).map(function (x) { return num(x.amount); });
      if (prior.length < minHistory) { skippedThin++; return; }
      var med = medianOf(prior), mad = madOf(prior, med);
      var limit = Math.max(med * 3, med + 4 * (mad || 0));
      if (num(e.amount) > limit && num(e.amount) - med >= 200) {
        flags.push({ kind: "big_purchase", severity: num(e.amount) > limit * 2 ? "high" : "medium", key: e.key, date: e.date, title: e.title || e.store || cat, amount: round2(num(e.amount)),
          why: formatPeso(e.amount) + " is about " + round2(num(e.amount) / med).toFixed(1).replace(/\.0$/, "") + "× your usual " + cat + " purchase (median " + formatPeso(med) + " from " + prior.length + " earlier).", category: cat });
      }
    });
    // category month spikes
    var monthsAll = {};
    counted.forEach(function (e) {
      var mk = monthKey(e.date), cat = e.category || "Other";
      monthsAll[cat] = monthsAll[cat] || {};
      monthsAll[cat][mk] = (monthsAll[cat][mk] || 0) + num(e.amount);
    });
    var firstMonth = counted.length ? monthKey(counted[0].date) : null;
    monthsBetween(range.start, range.end).forEach(function (mk) {
      var prev = monthsBetween(addDays(mk + "-01", -92), addDays(mk + "-01", -1));
      if (!firstMonth || prev[0] < firstMonth) return; // need 3 full earlier months of history
      Object.keys(monthsAll).forEach(function (cat) {
        var cur = monthsAll[cat][mk] || 0;
        var pv = prev.map(function (p) { return monthsAll[cat][p] || 0; });
        if (pv.filter(function (v) { return v > 0; }).length < 2) return;
        var avg = pv.reduce(function (a, b) { return a + b; }, 0) / pv.length;
        if (avg > 0 && cur > avg * 1.5 && cur - avg >= 500) {
          flags.push({ kind: "category_spike", severity: cur > avg * 2.5 ? "high" : "medium", date: mk + "-01", month: mk, title: cat + " in " + monthLabel(mk), amount: round2(cur), category: cat,
            why: cat + " spending in " + monthLabel(mk) + " (" + formatPeso(cur) + ") is " + Math.round((cur / avg - 1) * 100) + "% above your 3-month average (" + formatPeso(avg) + ")." });
        }
      });
    });
    // possible duplicates: same store, same amount, same day
    var seen = {};
    counted.forEach(function (e) {
      if (!inRange(e.date, range) || !e.store) return;
      var k = String(e.store).trim().toLowerCase() + "|" + e.date + "|" + round2(num(e.amount));
      if (seen[k]) {
        flags.push({ kind: "possible_duplicate", severity: "medium", key: e.key, otherKey: seen[k].key, date: e.date, title: e.title || e.store, amount: round2(num(e.amount)), category: e.category,
          why: "Two entries of " + formatPeso(e.amount) + " at " + e.store + " on " + e.date + " — counted twice?" });
      } else seen[k] = e;
    });
    flags.sort(function (a, b) { return (a.severity === "high" ? 0 : 1) - (b.severity === "high" ? 0 : 1) || (a.date < b.date ? 1 : a.date > b.date ? -1 : 0); });
    var why = [];
    if (skippedThin) why.push(skippedThin + " entr" + (skippedThin === 1 ? "y" : "ies") + " skipped for the size check: fewer than " + minHistory + " earlier purchases in that category.");
    return { flags: flags, checked: counted.filter(function (e) { return inRange(e.date, range); }).length, skippedThin: skippedThin, why: why };
  }

  // CSV text. columns: [{key, label}] ; rows: objects. Text that a
  // spreadsheet could run as a formula is prefixed with '.
  function csvCell(v) {
    if (v === null || v === undefined) return "";
    if (typeof v === "number") return isFinite(v) ? String(v) : "";
    var s = String(v);
    if (/^[=+@\t\r]/.test(s) || /^-[^\d.]/.test(s)) s = "'" + s;
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function toCSV(columns, rows) {
    var lines = [columns.map(function (c) { return csvCell(c.label); }).join(",")];
    (rows || []).forEach(function (r) { lines.push(columns.map(function (c) { return csvCell(r[c.key]); }).join(",")); });
    return lines.join("\r\n") + "\r\n";
  }

  return {
    round2: round2, num: num, money: money, sum: sum, pct: pct,
    formatPeso: formatPeso, limitText: limitText,
    UNITS: UNITS, normalizeUnit: normalizeUnit, unitLabel: unitLabel, sameDimension: sameDimension,
    convert: convert, unitPrice: unitPrice, unitPriceText: unitPriceText, compareUnitPrices: compareUnitPrices, parseSize: parseSize,
    DEFAULT_THRESHOLDS: DEFAULT_THRESHOLDS, STATE_INFO: STATE_INFO, validateThresholds: validateThresholds,
    thresholdsOrDefault: thresholdsOrDefault, warningState: warningState,
    budgetSummary: budgetSummary, crossesHardStop: crossesHardStop,
    categoryRemaining: categoryRemaining, cycleRemaining: cycleRemaining, variance: variance,
    computeAllocation: computeAllocation,
    priceStats: priceStats,
    PEOPLE_TYPES: PEOPLE_TYPES, STAFF_TYPES: STAFF_TYPES, householdSize: householdSize, scaleForHousehold: scaleForHousehold,
    spendingByCategory: spendingByCategory, inRange: inRange, periodRange: periodRange, storeStats: storeStats,
    // Stage 2
    addDays: addDays, daysBetween: daysBetween,
    DEFAULT_CYCLE: DEFAULT_CYCLE, validateCycle: validateCycle, cycleRange: cycleRange, shiftCycle: shiftCycle,
    learnedDailyUse: learnedDailyUse, dailyUse: dailyUse, daysOfSupply: daysOfSupply,
    DEFAULT_INVENTORY: DEFAULT_INVENTORY, INVENTORY_STATES: INVENTORY_STATES, inventoryStatus: inventoryStatus,
    reorderQty: reorderQty, forecast: forecast, expiryStatus: expiryStatus, expiryAfterRestock: expiryAfterRestock,
    lineEstimate: lineEstimate, listTotals: listTotals, fitToBudget: fitToBudget, duplicateWarnings: duplicateWarnings,
    tripSummary: tripSummary, plannedVsActual: plannedVsActual,
    // Stage 3
    PRICE_STATUS: PRICE_STATUS, DEFAULT_PRICE_AGE: DEFAULT_PRICE_AGE, priceAge: priceAge, freshness: freshness, priceStatus: priceStatus,
    storeRanking: storeRanking, splitList: splitList, ROUTE_MODES: ROUTE_MODES, DEFAULT_ROUTE: DEFAULT_ROUTE, planRoute: planRoute,
    bulkBreakEven: bulkBreakEven, packSizeValue: packSizeValue, BUY_ADVICE: BUY_ADVICE, buyAdvice: buyAdvice,
    FUND_VERDICTS: FUND_VERDICTS, fundCheck: fundCheck, advanceDate: advanceDate, occurrencesBetween: occurrencesBetween, forecast30: forecast30,
    // Stage 4
    medianOf: medianOf, madOf: madOf, monthKey: monthKey, monthLabel: monthLabel, monthsBetween: monthsBetween,
    INSIGHT_RANGE_DAYS: INSIGHT_RANGE_DAYS, insightRange: insightRange, previousRange: previousRange,
    spendingTrends: spendingTrends, basketIndex: basketIndex, savingsFromPrices: savingsFromPrices, storePerformance: storePerformance,
    WASTE_REASONS: WASTE_REASONS, usageAnalytics: usageAnalytics, accuracy: accuracy, cycleAccuracy: cycleAccuracy, planForPeriod: planForPeriod,
    planAccuracy: planAccuracy, forecastAccuracy: forecastAccuracy, unusualSpending: unusualSpending, csvCell: csvCell, toCSV: toCSV
  };
}));
