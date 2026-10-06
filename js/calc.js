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
    spendingByCategory: spendingByCategory, inRange: inRange, periodRange: periodRange, storeStats: storeStats
  };
}));
