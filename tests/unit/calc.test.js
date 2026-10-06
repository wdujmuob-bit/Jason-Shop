// Unit tests for js/calc.js — the single source of truth for money & household math.
// Run: npm run test:unit   (node --test, no dependencies)
const test = require("node:test");
const assert = require("node:assert/strict");
const C = require("../../js/calc.js");

test("num / money / round2 parse peso text safely", () => {
  assert.equal(C.num("₱1,250.50"), 1250.5);
  assert.equal(C.num(" 500 "), 500);
  assert.equal(C.num(""), null);
  assert.equal(C.num("abc"), null);
  assert.equal(C.num(null), null);
  assert.equal(C.num(Infinity), null);
  assert.equal(C.money(-5), 0);
  assert.equal(C.money("x"), 0);
  assert.equal(C.round2(0.1 + 0.2), 0.3);
  assert.equal(C.round2(1.005), 1.01);
  assert.equal(C.sum([{ a: 1.1 }, { a: 2.2 }, { a: "x" }], x => x.a), 3.3);
});

test("formatPeso and limitText never show a bare negative", () => {
  assert.equal(C.formatPeso(1234567), "₱1,234,567");
  assert.equal(C.formatPeso(1234.5), "₱1,234.50");
  assert.equal(C.formatPeso(0), "₱0");
  assert.equal(C.limitText(500), "₱500");
  assert.equal(C.limitText(-1000), "OVER LIMIT BY ₱1,000");
  assert.equal(C.limitText(-25.5, "OVER BY"), "OVER BY ₱25.50");
  assert.ok(!C.limitText(-1).includes("-"));
});

test("unit conversions within a dimension; null across dimensions", () => {
  assert.equal(C.convert(1, "kg", "g"), 1000);
  assert.equal(C.convert(500, "g", "kg"), 0.5);
  assert.equal(C.convert(1, "l", "ml"), 1000);
  assert.equal(C.convert(2, "dozen", "piece"), 24);
  assert.ok(Math.abs(C.convert(1, "lb", "g") - 453.592) < 0.01);
  assert.equal(C.convert(1, "kg", "l"), null);
  assert.equal(C.convert(1, "kg", "nonsense"), null);
  assert.equal(C.normalizeUnit("Kilos"), "kg");
  assert.equal(C.normalizeUnit("pcs"), "piece");
  assert.equal(C.normalizeUnit("Liters"), "l");
  assert.equal(C.normalizeUnit("???"), null);
  assert.ok(C.sameDimension("g", "kg"));
  assert.ok(!C.sameDimension("g", "ml"));
});

test("unitPrice: per kg / litre / piece, packs and quantities", () => {
  let r = C.unitPrice({ price: 345, size: 5, unit: "kg" });
  assert.equal(r.ok, true); assert.equal(r.value, 69); assert.equal(r.per, "kg");
  r = C.unitPrice({ price: 95, size: 500, unit: "g" });
  assert.equal(r.value, 190); assert.equal(r.per, "kg");
  r = C.unitPrice({ price: 180, size: 1, unit: "l", packCount: 6 });
  assert.equal(r.value, 30); assert.equal(r.per, "l");
  r = C.unitPrice({ price: 190, qty: 2, size: 1, unit: "l" });   // 2 bottles for ₱190
  assert.equal(r.itemPrice, 95); assert.equal(r.value, 95);
  r = C.unitPrice({ price: 120, size: 1, unit: "dozen" });
  assert.equal(r.value, 10); assert.equal(r.per, "piece");
  r = C.unitPrice({ price: 60, unit: "pack" });                   // no number → per 1 pack
  assert.equal(r.ok, true); assert.equal(r.value, 60);
});

test("unitPrice edge cases: zero, missing price/size, bad unit, bad qty", () => {
  assert.equal(C.unitPrice({ size: 1, unit: "kg" }).reason, "missing_price");
  assert.equal(C.unitPrice({ price: "", size: 1, unit: "kg" }).reason, "missing_price");
  assert.equal(C.unitPrice({ price: -1, size: 1, unit: "kg" }).reason, "negative_price");
  assert.equal(C.unitPrice({ price: 10, qty: 0, size: 1, unit: "kg" }).reason, "invalid_qty");
  let r = C.unitPrice({ price: 50 });
  assert.equal(r.reason, "missing_size"); assert.equal(r.itemPrice, 50);
  assert.equal(C.unitPrice({ price: 50, size: 2, unit: "furlong" }).reason, "unknown_unit");
  assert.equal(C.unitPrice({ price: 50, size: 0, unit: "kg" }).reason, "zero_size");
  r = C.unitPrice({ price: 0, size: 1, unit: "kg" });               // free item is valid
  assert.equal(r.ok, true); assert.equal(r.value, 0);
  assert.equal(C.unitPriceText(C.unitPrice({ price: 50 })), "₱50 each (no size)");
  assert.equal(C.unitPriceText(C.unitPrice({})), "No price");
});

test("compareUnitPrices refuses mixed units", () => {
  let c = C.compareUnitPrices({ price: 345, size: 5, unit: "kg" }, { price: 80, size: 1, unit: "kg" });
  assert.equal(c.comparable, true); assert.equal(c.cheaper, "a"); assert.equal(c.difference, 11);
  c = C.compareUnitPrices({ price: 100, size: 1, unit: "kg" }, { price: 100, size: 1, unit: "l" });
  assert.equal(c.comparable, false); assert.equal(c.reason, "mixed_units");
  c = C.compareUnitPrices({ price: 100 }, { price: 100, size: 1, unit: "l" });
  assert.equal(c.comparable, false); assert.equal(c.reason, "a_missing_size");
  c = C.compareUnitPrices({ price: 50, size: 500, unit: "g" }, { price: 100, size: 1, unit: "kg" });
  assert.equal(c.cheaper, "same");
});

test("parseSize reads common receipt sizes (pre-fill only)", () => {
  assert.deepEqual(C.parseSize("Jasmine Rice 5kg"), { size: 5, unit: "kg", packCount: 1 });
  assert.deepEqual(C.parseSize("Mineral Water 6x1L"), { size: 1, unit: "l", packCount: 6 });
  assert.deepEqual(C.parseSize("Eggs 12 pcs"), { size: 12, unit: "piece", packCount: 1 });
  assert.deepEqual(C.parseSize("Milk 1.5 liters"), { size: 1.5, unit: "l", packCount: 1 });
  assert.equal(C.parseSize("Banana"), null);
  assert.equal(C.parseSize("7-Eleven"), null);
});

test("thresholds: defaults, validation, state bands", () => {
  assert.deepEqual(C.DEFAULT_THRESHOLDS, { watch: 70, warning: 85, hardStop: 100 });
  assert.equal(C.warningState(0), "SAFE");
  assert.equal(C.warningState(69.99), "SAFE");
  assert.equal(C.warningState(70), "WATCH");
  assert.equal(C.warningState(84.9), "WATCH");
  assert.equal(C.warningState(85), "WARNING");
  assert.equal(C.warningState(99.9), "WARNING");
  assert.equal(C.warningState(100), "HARD_STOP");
  assert.equal(C.warningState(140), "HARD_STOP");
  assert.equal(C.warningState(null), "SETUP");
  const t = { watch: 50, warning: 75, hardStop: 90 };
  assert.equal(C.warningState(60, t), "WATCH");
  assert.equal(C.warningState(90, t), "HARD_STOP");
  assert.equal(C.validateThresholds(t).ok, true);
  assert.equal(C.validateThresholds({ watch: 80, warning: 70, hardStop: 100 }).ok, false);
  assert.equal(C.validateThresholds({ watch: 70, warning: 85, hardStop: 120 }).ok, false);
  assert.equal(C.validateThresholds({ watch: 0, warning: 85, hardStop: 100 }).ok, false);
  assert.equal(C.validateThresholds({ watch: "", warning: 85, hardStop: 100 }).ok, false);
  assert.deepEqual(C.thresholdsOrDefault({ watch: 99, warning: 1, hardStop: 3 }), C.DEFAULT_THRESHOLDS);
  for (const s of ["SETUP", "SAFE", "WATCH", "WARNING", "HARD_STOP"]) {
    assert.ok(C.STATE_INFO[s].icon && C.STATE_INFO[s].label, "state " + s + " has icon + text");
  }
});

test("budgetSummary: safe to spend = fund − spent − committed − reserve", () => {
  const b = C.budgetSummary({ fund: 50000, spent: 10000, committed: 5000, reserve: 15000 });
  assert.equal(b.safeFromFund, 20000);
  assert.equal(b.safeToSpend, 20000);
  assert.equal(b.availableCash, 40000);
  assert.equal(b.limit, 35000);
  assert.equal(b.usedPct, 42.86);
  assert.equal(b.state, "SAFE");
  assert.equal(b.limitedBy, "fund");
  assert.equal(b.overBy, 0);
});

test("budgetSummary: hard stop applies when lower", () => {
  const b = C.budgetSummary({ fund: 20000, spent: 9000, committed: 1000, reserve: 0, stop: 15000 });
  assert.equal(b.safeFromFund, 10000);
  assert.equal(b.safeFromStop, 5000);
  assert.equal(b.safeToSpend, 5000);
  assert.equal(b.limitedBy, "hardStop");
  assert.equal(b.usedPct, 66.67);
  assert.equal(b.state, "SAFE");
  assert.equal(C.budgetSummary({ fund: 20000, spent: 10500, stop: 15000 }).state, "WATCH");
  assert.equal(C.budgetSummary({ fund: 20000, spent: 13000, stop: 15000 }).state, "WARNING");
  assert.equal(C.budgetSummary({ fund: 20000, spent: 15000, stop: 15000 }).state, "HARD_STOP");
});

test("budgetSummary: over limit → ₱0 safe, overBy reported, HARD STOP", () => {
  const b = C.budgetSummary({ fund: 20000, spent: 16000, stop: 15000 });
  assert.equal(b.safeToSpend, 0);
  assert.equal(b.rawSafe, -1000);
  assert.equal(b.overBy, 1000);
  assert.equal(b.state, "HARD_STOP");
  assert.equal(C.limitText(b.rawSafe), "OVER LIMIT BY ₱1,000");
  // over because of commitments + reserve, even below the % threshold
  const c = C.budgetSummary({ fund: 10000, spent: 2000, committed: 3000, reserve: 6000 });
  assert.equal(c.rawSafe, -1000);
  assert.equal(c.state, "HARD_STOP");
});

test("budgetSummary: zero / missing / bad inputs", () => {
  const e = C.budgetSummary({});
  assert.equal(e.state, "SETUP"); assert.equal(e.safeToSpend, 0); assert.equal(e.rawSafe, null); assert.equal(e.availableCash, null);
  const onlyStop = C.budgetSummary({ stop: 15000, spent: 3000 });
  assert.equal(onlyStop.safeToSpend, 12000); assert.equal(onlyStop.state, "SAFE");
  const bad = C.budgetSummary({ fund: "abc", spent: -50, committed: null, reserve: undefined, stop: "₱15,000" });
  assert.equal(bad.fund, 0); assert.equal(bad.spent, 0); assert.equal(bad.stop, 15000); assert.equal(bad.safeToSpend, 15000);
  const allReserved = C.budgetSummary({ fund: 5000, reserve: 5000 });
  assert.equal(allReserved.safeToSpend, 0); assert.equal(allReserved.usedPct, 100); assert.equal(allReserved.state, "HARD_STOP");
  const custom = C.budgetSummary({ fund: 10000, spent: 6000, thresholds: { watch: 50, warning: 60, hardStop: 90 } });
  assert.equal(custom.state, "WARNING");
});

test("crossesHardStop keeps the legacy rule (reaching the limit counts)", () => {
  const b = { spent: 14000, committed: 500, stop: 15000 };
  assert.equal(C.crossesHardStop(b, 999), false);
  assert.equal(C.crossesHardStop(b, 1000), true);
  assert.equal(C.crossesHardStop(b, 500, { includeCommitted: true }), true);
  assert.equal(C.crossesHardStop(b, 0), false);
  assert.equal(C.crossesHardStop({ spent: 99999, stop: 0 }, 1), false);
});

test("categoryRemaining, variance, cycleRemaining", () => {
  let r = C.categoryRemaining(10000, 6000, 1500);
  assert.equal(r.remaining, 2500); assert.equal(r.usedPct, 75); assert.equal(r.state, "WATCH");
  r = C.categoryRemaining(5000, 5200, 0);
  assert.equal(r.remaining, 0); assert.equal(r.overBy, 200); assert.equal(r.state, "HARD_STOP");
  r = C.categoryRemaining(0, 300, 0);
  assert.equal(r.state, "UNPLANNED"); assert.equal(r.usedPct, null);
  r = C.categoryRemaining(0, 0, 0);
  assert.equal(r.state, "SAFE"); assert.equal(r.usedPct, 0);
  let v = C.variance(10000, 8500);
  assert.equal(v.variance, 1500); assert.equal(v.direction, "under"); assert.equal(v.saving, 1500); assert.equal(v.variancePct, 15);
  v = C.variance(10000, 11000);
  assert.equal(v.direction, "over"); assert.equal(v.overspend, 1000);
  assert.equal(C.variance(500, 500).direction, "on_plan");
  assert.equal(C.variance(0, 100).variancePct, null);
  const cyc = C.cycleRemaining([C.categoryRemaining(10000, 4000, 0), C.categoryRemaining(5000, 6000, 0)]);
  assert.equal(cyc.allocated, 15000); assert.equal(cyc.rawRemaining, 5000); assert.equal(cyc.state, "SAFE");
});

test("computeAllocation: peso mode, unallocated and over-allocated", () => {
  let a = C.computeAllocation({ base: 30000, mode: "peso", items: [{ id: "a", value: 15000 }, { id: "b", value: "₱10,000" }, { id: "c", value: "" }] });
  assert.equal(a.totalAllocated, 25000); assert.equal(a.unallocated, 5000); assert.equal(a.overAllocated, 0);
  assert.equal(a.ok, true); assert.equal(a.rows[0].percent, 50); assert.equal(a.warnings[0].code, "unallocated");
  a = C.computeAllocation({ base: 30000, mode: "peso", items: [{ id: "a", value: 20000 }, { id: "b", value: 12000 }] });
  assert.equal(a.overAllocated, 2000); assert.equal(a.ok, false); assert.equal(a.errors[0].code, "over_allocated");
  a = C.computeAllocation({ base: 30000, mode: "peso", items: [{ id: "a", value: -5, name: "Food" }] });
  assert.equal(a.ok, false); assert.match(a.errors[0].message, /Food/);
});

test("computeAllocation: percent mode and zero base", () => {
  let a = C.computeAllocation({ base: 40000, mode: "percent", items: [{ id: "a", value: 50 }, { id: "b", value: "25" }] });
  assert.equal(a.rows[0].amount, 20000); assert.equal(a.rows[1].amount, 10000);
  assert.equal(a.totalPercent, 75); assert.equal(a.unallocated, 10000); assert.equal(a.ok, true);
  a = C.computeAllocation({ base: 40000, mode: "percent", items: [{ id: "a", value: 60 }, { id: "b", value: 50 }] });
  assert.equal(a.overAllocated, 4000); assert.equal(a.ok, false);
  a = C.computeAllocation({ base: 0, mode: "percent", items: [{ id: "a", value: 50 }] });
  assert.equal(a.ok, false); assert.match(a.errors[0].message, /Shopping Fund/);
  a = C.computeAllocation({ base: 0, mode: "peso", items: [{ id: "a", value: 100 }] });
  assert.equal(a.rows[0].percent, null); assert.equal(a.overAllocated, 100);
  a = C.computeAllocation({ base: 30000, mode: "percent", items: [{ id: "a", value: 33.33 }, { id: "b", value: 33.33 }, { id: "c", value: 33.34 }] });
  assert.equal(a.totalAllocated, 30000); assert.equal(a.unallocated, 0); assert.equal(a.ok, true);
});

test("priceStats: latest/lowest/highest/average, cheapest store, trend", () => {
  const recs = [
    { price: 360, size: 5, unit: "kg", date: "2026-09-01", storeKey: "puregold", storeName: "Puregold" },
    { price: 345, size: 5, unit: "kg", date: "2026-09-15", storeKey: "landers", storeName: "Landers" },
    { price: 380, size: 5, unit: "kg", date: "2026-10-01", storeKey: "puregold", storeName: "Puregold" }
  ];
  const s = C.priceStats(recs);
  assert.equal(s.basis, "unit"); assert.equal(s.per, "kg");
  assert.equal(s.latest.value, 76); assert.equal(s.lowest.value, 69); assert.equal(s.highest.value, 76);
  assert.equal(s.average, 72.33);
  assert.equal(s.cheapestStore.storeName, "Landers");   // Puregold's LATEST is 76/kg
  assert.equal(s.storeCount, 2);
  assert.equal(s.cheapestTies, 1);
  const tie = C.priceStats([{ price: 50, date: "2026-10-01", storeKey: "a" }, { price: 50, date: "2026-10-02", storeKey: "b" }]);
  assert.equal(tie.cheapestTies, 2);
  assert.equal(s.trendPct, 10.14); assert.equal(s.trend, "up");
});

test("priceStats: empty, single, missing price, mixed units, archived", () => {
  assert.deepEqual(C.priceStats([]), { count: 0, missingPrice: 0, basis: null });
  const one = C.priceStats([{ price: 50, date: "2026-10-01" }]);
  assert.equal(one.count, 1); assert.equal(one.basis, "item"); assert.equal(one.trend, "none"); assert.equal(one.trendPct, null);
  assert.equal(one.cheapestStore, null);
  const miss = C.priceStats([{ price: null, date: "2026-10-01" }, { price: 40, date: "2026-10-02" }]);
  assert.equal(miss.count, 1); assert.equal(miss.missingPrice, 1);
  const mixed = C.priceStats([{ price: 100, size: 1, unit: "kg", date: "2026-10-01" }, { price: 50, size: 1, unit: "l", date: "2026-10-02" }]);
  assert.equal(mixed.basis, "item"); assert.equal(mixed.mixedUnits, true); assert.equal(mixed.trend, "down");
  const arch = C.priceStats([{ price: 10, date: "2026-01-01", archived: true }]);
  assert.equal(arch.count, 0);
  const qty = C.priceStats([{ price: 190, qty: 2, date: "2026-10-01" }]);
  assert.equal(qty.latest.value, 95);
  const flat = C.priceStats([{ price: 100, date: "2026-10-01" }, { price: 100.2, date: "2026-10-02" }]);
  assert.equal(flat.trend, "flat");
});

test("householdSize counts groups, staff, pets, weights and per-house", () => {
  const g = [
    { houseId: "h1", type: "adults", count: 2, weight: 1 },
    { houseId: "h1", type: "children", count: 3, weight: 0.5 },
    { houseId: "h1", type: "maids", count: 2 },
    { houseId: "h1", type: "pets", count: 2 },
    { houseId: "h2", type: "security", count: 1 },
    { houseId: "h2", type: "custom", count: 4, weight: 1 },
    { houseId: "h2", type: "drivers", count: 5, archived: true },
    { houseId: "h2", type: "nannies", count: -3 }
  ];
  const all = C.householdSize(g);
  assert.deepEqual(all, { people: 12, adults: 2, children: 3, staff: 3, pets: 2, custom: 4, weightedPeople: 10.5 });
  const h1 = C.householdSize(g, { houseId: "h1" });
  assert.equal(h1.people, 7); assert.equal(h1.pets, 2);
  assert.equal(C.householdSize([]).people, 0);
  assert.equal(C.scaleForHousehold(10, 4, 6), 15);
  assert.equal(C.scaleForHousehold(10, 0, 6), null);
});

test("periodRange: calendar months and payday cycles", () => {
  assert.deepEqual(C.periodRange({ startDay: 1 }, "2026-10-06"), { start: "2026-10-01", end: "2026-10-31", type: "monthly", startDay: 1 });
  let p = C.periodRange({ startDay: 15 }, "2026-10-06");
  assert.equal(p.start, "2026-09-15"); assert.equal(p.end, "2026-10-14");
  p = C.periodRange({ startDay: 15 }, "2026-10-15");
  assert.equal(p.start, "2026-10-15"); assert.equal(p.end, "2026-11-14");
  p = C.periodRange({ startDay: 10 }, "2026-01-05");
  assert.equal(p.start, "2025-12-10"); assert.equal(p.end, "2026-01-09");
  assert.equal(C.periodRange({ startDay: 31 }, "2026-02-27").startDay, 28);
  assert.equal(C.periodRange({}, "2024-02-10").end, "2024-02-29");
});

test("spendingByCategory and storeStats use only counted entries", () => {
  const e = [
    { date: "2026-10-01", amount: 500, category: "Groceries", counted: true, store: "A" },
    { date: "2026-10-03", amount: 250.5, category: "Groceries", counted: true, store: "A" },
    { date: "2026-10-02", amount: 999, category: "Groceries", counted: false },
    { date: "2026-09-30", amount: 100, category: "Pet", counted: true },
    { date: "2026-10-04", amount: 80, counted: true }
  ];
  const range = { start: "2026-10-01", end: "2026-10-31" };
  assert.deepEqual(C.spendingByCategory(e, range), { Groceries: 750.5, Other: 80 });
  assert.equal(C.inRange("", range), false);
  const s = C.storeStats(e.slice(0, 3));
  assert.equal(s.purchaseCount, 2); assert.equal(s.totalSpent, 750.5); assert.equal(s.averageBasket, 375.25);
  assert.equal(s.lastDate, "2026-10-03"); assert.equal(s.firstDate, "2026-10-01");
  assert.equal(C.storeStats([]).averageBasket, null);
});
