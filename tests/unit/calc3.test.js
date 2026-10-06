// Unit tests for the Stage 3 intelligence math in js/calc.js.
const test = require("node:test");
const assert = require("node:assert/strict");
const C = require("../../js/calc.js");
const T = "2026-10-06";

test("freshness and priceStatus labels", () => {
  assert.equal(C.freshness("2026-10-06", T).text, "today");
  assert.equal(C.freshness("2026-10-05", T).text, "yesterday");
  assert.equal(C.freshness("2026-09-01", T).level, "recent");
  assert.equal(C.freshness("2026-06-01", T).level, "stale");
  assert.equal(C.freshness("", T).level, "unknown");
  assert.equal(C.priceStatus({ price: null, source: "receipt" }, T), "UNKNOWN");
  assert.equal(C.priceStatus({ price: 50, source: "ai_estimate", date: T }, T), "ESTIMATED");
  assert.equal(C.priceStatus({ price: 50, source: "receipt", date: T }, T), "RECEIPT_VERIFIED");
  assert.equal(C.priceStatus({ price: 50, source: "manual", date: T }, T), "USER_ENTERED");
  assert.equal(C.priceStatus({ price: 50, source: "shelf", date: T }, T), "USER_ENTERED");
  assert.equal(C.priceStatus({ price: 50, source: "online", date: T }, T), "ONLINE_VERIFIED");
  assert.equal(C.priceStatus({ price: 50, source: "receipt", date: "2026-07-01" }, T), "HISTORICAL");
  const now = "2026-10-06T05:00:00Z";
  assert.equal(C.priceStatus({ price: 5000, source: "research", verified: true, hasSource: true, at: "2026-10-06T01:00:00Z", date: T }, T, { now }), "LIVE");
  assert.equal(C.priceStatus({ price: 5000, source: "research", verified: true, hasSource: true, at: "2026-10-01T01:00:00Z", date: "2026-10-01" }, T, { now }), "ONLINE_VERIFIED");
  assert.equal(C.priceStatus({ price: 5000, source: "research", verified: true, hasSource: false, at: now, date: T }, T, { now }), "ESTIMATED");
  assert.equal(C.priceStatus({ price: 5000, source: "research", verified: false, hasSource: true, at: now, date: T }, T, { now }), "ESTIMATED");
  for (const k of ["LIVE", "ONLINE_VERIFIED", "RECEIPT_VERIFIED", "USER_ENTERED", "HISTORICAL", "ESTIMATED", "UNKNOWN"]) assert.ok(C.PRICE_STATUS[k].label);
});

test("storeRanking: latest real price per store, per kg when sizes known, AI estimates ignored", () => {
  const recs = [
    { storeKey: "a", storeName: "A Mart", price: 300, qty: 1, size: 5, unit: "kg", date: "2026-09-01", source: "receipt" },
    { storeKey: "a", storeName: "A Mart", price: 280, qty: 1, size: 5, unit: "kg", date: "2026-10-01", source: "receipt" },
    { storeKey: "b", storeName: "B Store", price: 110, qty: 2, size: 1, unit: "kg", date: "2026-10-02", source: "manual" },
    { storeKey: "c", storeName: "C Shop", price: 10, qty: 1, size: 5, unit: "kg", date: "2026-10-05", source: "ai_estimate" }
  ];
  const r = C.storeRanking(recs, T);
  assert.equal(r.basis, "unit");
  assert.equal(r.rows.length, 2);
  assert.equal(r.best.storeKey, "b");               // 55/kg vs 56/kg
  assert.equal(r.best.value, 55);
  assert.equal(r.rows[1].value, 56);
  assert.equal(r.rows[1].records, 2);
  assert.equal(r.best.status, "USER_ENTERED");
  assert.ok(r.spreadPct > 0);
  assert.ok(r.why.join(" ").includes("B Store"));
  const none = C.storeRanking([{ storeKey: "c", price: 10, source: "ai_estimate" }], T);
  assert.equal(none.best, null);
  assert.match(none.why[0], /not enough data/);
  const mixed = C.storeRanking([{ storeKey: "a", storeName: "A", price: 50, date: T, source: "receipt" }, { storeKey: "b", storeName: "B", price: 40, size: 1, unit: "kg", date: T, source: "receipt" }], T);
  assert.equal(mixed.basis, "item");
  assert.equal(mixed.best.storeKey, "b");
  const one = C.storeRanking([{ storeKey: "a", storeName: "A", price: 50, date: "2026-05-01", source: "receipt" }], T);
  assert.match(one.why.join(" "), /nothing to compare/);
  assert.match(one.why.join(" "), /may have changed/);
});

test("splitList: cheapest per item, overrides, no invented saving", () => {
  const items = [
    { id: "1", prices: { a: 100, b: 90 } },
    { id: "2", prices: { a: 50 } },
    { id: "3", prices: { b: 20 } },
    { id: "4", prices: {} }
  ];
  const r = C.splitList(items, { a: "A", b: "B" });
  assert.deepEqual([r.assign["1"].storeKey, r.assign["2"].storeKey, r.assign["3"].reason, r.assign["4"].reason], ["b", "a", "only_store", "no_price"]);
  assert.equal(r.assign["1"].reason, "cheapest");
  assert.equal(r.total, 160);
  assert.deepEqual(r.unpriced, ["4"]);
  assert.equal(r.savingVsSingle, null);              // no single store prices items 1-3
  assert.match(r.why.join(" "), /can't say how much splitting saves/);
  const r2 = C.splitList([{ id: "1", prices: { a: 100, b: 90 } }, { id: "2", prices: { a: 50, b: 65 } }], { a: "A", b: "B" });
  assert.equal(r2.savingVsSingle, 10);               // A alone = 150 (B 155), split = 140
  assert.equal(r2.bestSingle.storeKey, "a");
  assert.match(r2.why.join(" "), /saves ₱10/);
  const r3 = C.splitList([{ id: "1", prices: { a: 100, b: 90 }, override: "a" }]);
  assert.equal(r3.assign["1"].reason, "override");
  assert.equal(r3.total, 100);
  const empty = C.splitList([{ id: "x", prices: {} }]);
  assert.match(empty.why[0], /not enough data/);
});

const ITEMS = [
  { id: "1", prices: { a: 100, b: 98, c: 95 } },
  { id: "2", prices: { a: 50, b: 40 } },
  { id: "3", prices: { b: 25, c: 30 } }
];
const STORES = { a: { name: "A", minutes: 5, km: 2 }, b: { name: "B", minutes: 30, km: 15 }, c: { name: "C", minutes: 10, km: 4 } };

test("planRoute: four modes pick different plans for clear reasons", () => {
  const ch = C.planRoute(ITEMS, STORES, {}, "cheapest");
  assert.equal(ch.mode, "cheapest");
  assert.equal(ch.best.itemsTotal, 160);            // c 95 + b 40 + b 25
  assert.deepEqual(ch.best.stores.slice().sort(), ["b", "c"]);
  const fw = C.planRoute(ITEMS, STORES, {}, "fewest");
  assert.equal(fw.best.stops, 1);
  assert.deepEqual(fw.best.stores, ["b"]);
  assert.equal(fw.best.itemsTotal, 163);
  const fa = C.planRoute(ITEMS, STORES, {}, "fastest");
  // a+c: 2*10 + 10 + 2*20 = 70 min vs b alone: 60+20 = 80
  assert.deepEqual(fa.best.stores, ["a", "c"]);
  assert.equal(fa.best.minutes, 70);
  const bal = C.planRoute(ITEMS, STORES, {});
  assert.equal(bal.mode, "balance");
  assert.ok(bal.best.balanceScore <= Math.min(...bal.plans.map(p => p.balanceScore)));
  assert.match(bal.why[0], /^BEST BALANCE/);
  assert.equal(bal.maxCover, 3);
  assert.deepEqual(bal.unpriced, []);
  // every plan uses every store it includes
  for (const p of bal.plans) for (const k of p.stores) assert.ok(Object.values(p.assign).some(x => x.storeKey === k));
});

test("planRoute: locks, unknown travel, unpriced items and empty input", () => {
  const locked = C.planRoute([{ id: "1", prices: { a: 100, c: 95 }, lock: "a" }, { id: "2", prices: { c: 30 } }], STORES, {}, "cheapest");
  assert.equal(locked.best.assign["1"].storeKey, "a");
  assert.ok(locked.best.assign["1"].locked);
  assert.match(locked.why.join(" "), /picked yourself/);
  const unknown = C.planRoute(ITEMS, { a: { name: "A" }, b: { name: "B" }, c: { name: "C" } }, {}, "balance");
  assert.equal(unknown.best.travelKnown, false);
  assert.equal(unknown.best.minutes, null);
  assert.match(unknown.why.join(" "), /Travel times aren't set/);
  const withUnpriced = C.planRoute([...ITEMS, { id: "4", prices: {} }], STORES, {}, "cheapest");
  assert.deepEqual(withUnpriced.unpriced, ["4"]);
  const none = C.planRoute([{ id: "x", prices: {} }], STORES, {});
  assert.equal(none.best, null);
  assert.match(none.why[0], /not enough data/);
  const fuel = C.planRoute(ITEMS, STORES, { fuelPerKm: 10 }, "fewest");
  assert.equal(fuel.best.km, 30);
  assert.equal(fuel.best.fuel, 300);
});

test("bulkBreakEven: unit saving, break-even, expiry and storage risk", () => {
  const ok = C.bulkBreakEven({ small: { price: 60, size: 1 }, bulk: { price: 250, size: 5 }, perDay: 0.25, shelfLifeDays: 180 });
  assert.equal(ok.verdict, "BUY_BULK");
  assert.equal(ok.savingPct, 16.67);
  assert.equal(ok.fullSaving, 50);
  assert.equal(ok.breakEvenUnits, 4.17);
  assert.equal(ok.daysToUse, 20);
  assert.equal(ok.expiryRisk, "LOW");
  assert.equal(ok.storageRisk, "LOW");
  const waste = C.bulkBreakEven({ small: { price: 60, size: 1 }, bulk: { price: 250, size: 5 }, perDay: 0.05, shelfLifeDays: 30 });
  assert.equal(waste.expiryRisk, "HIGH");
  assert.equal(waste.usable, 1.5);
  assert.equal(waste.verdict, "BUY_SMALL");          // 60*1.5 - 250 < 0
  const unknownUse = C.bulkBreakEven({ small: { price: 60, size: 1 }, bulk: { price: 250, size: 5 } });
  assert.equal(unknownUse.verdict, "BULK_IF_USED");
  assert.match(unknownUse.why[0], /not enough data/);
  const notCheaper = C.bulkBreakEven({ small: { price: 50, size: 1 }, bulk: { price: 260, size: 5 } });
  assert.equal(notCheaper.verdict, "BUY_SMALL");
  assert.equal(C.bulkBreakEven({ small: { price: 50 }, bulk: { price: 200, size: 5 } }).verdict, "NOT_ENOUGH_DATA");
});

test("packSizeValue compares sizes per unit and refuses mixed dimensions", () => {
  const r = C.packSizeValue([
    { id: "s", label: "1 kg", price: 60, size: 1, unit: "kg" },
    { id: "m", label: "500 g", price: 32, size: 500, unit: "g" },
    { id: "l", label: "5 kg", price: 250, size: 5, unit: "kg" }
  ]);
  assert.ok(r.comparable);
  assert.equal(r.best.id, "l");
  assert.equal(r.rows[2].id, "m");
  assert.equal(r.rows[2].morePct, 28);
  assert.equal(C.packSizeValue([{ id: "a", price: 10, size: 1, unit: "kg" }]).comparable, false);
  assert.equal(C.packSizeValue([{ id: "a", price: 10, size: 1, unit: "kg" }, { id: "b", price: 10, size: 1, unit: "L" }]).comparable, false);
});

test("buyAdvice uses recorded history only", () => {
  const h = [{ value: 50, date: "2026-08-01" }, { value: 55, date: "2026-09-01" }, { value: 52, date: "2026-09-15" }];
  assert.equal(C.buyAdvice({ history: h, current: { value: 60 } }).verdict, "WAIT");
  assert.equal(C.buyAdvice({ history: h, current: { value: 50.5 } }).verdict, "BUY_NOW");
  assert.equal(C.buyAdvice({ history: h, current: { value: 53 } }).verdict, "FAIR");
  const few = C.buyAdvice({ history: h.slice(0, 2), current: { value: 60 } });
  assert.equal(few.verdict, "NOT_ENOUGH_DATA");
  assert.match(few.why[0], /not enough data/);
  assert.equal(C.buyAdvice({ history: h.slice(0, 1), current: { value: 45 }, target: 48 }).verdict, "BUY_NOW");
  assert.equal(C.buyAdvice({ history: [] }).verdict, "NOT_ENOUGH_DATA");
  const r = C.buyAdvice({ history: h });                       // current = latest
  assert.equal(r.current, 52);
  assert.equal(r.suggestedTarget, 50);
  assert.equal(r.low, 50);
  assert.equal(r.high, 55);
});

test("fundCheck: AFFORDABLE / CAUTION / WAIT / EXCEEDS / SETUP", () => {
  const b = { fund: 20000, spent: 5000, committed: 0, reserve: 0 };
  assert.equal(C.fundCheck(1000, b).verdict, "AFFORDABLE");
  assert.equal(C.fundCheck(8000, b).verdict, "CAUTION");
  assert.equal(C.fundCheck(16000, b).verdict, "EXCEEDS");
  const w = C.fundCheck(4000, b, { upcoming: 12000 });
  assert.equal(w.verdict, "WAIT");
  assert.equal(w.leftAfterUpcoming, -1000);
  assert.equal(C.fundCheck(1000, { fund: 0 }).verdict, "SETUP");
  assert.equal(C.fundCheck(0, b).verdict, "SETUP");
  assert.equal(C.fundCheck(3000, { fund: 20000, spent: 5000, stop: 7000 }).verdict, "EXCEEDS");
});

test("advanceDate / occurrencesBetween", () => {
  assert.equal(C.advanceDate("2026-01-31", { unit: "months", n: 1 }), "2026-02-28");
  assert.equal(C.advanceDate("2026-11-15", { unit: "months", n: 2 }), "2027-01-15");
  assert.equal(C.advanceDate("2026-10-06", { unit: "weeks", n: 2 }), "2026-10-20");
  assert.equal(C.advanceDate("2026-10-06", { unit: "days", n: 3 }), "2026-10-09");
  assert.deepEqual(C.occurrencesBetween("2026-09-01", { unit: "weeks", n: 2 }, "2026-10-01", "2026-10-31"), ["2026-10-13", "2026-10-27"]);
});

test("forecast30: history baseline vs known items, never a guess", () => {
  const entries = [];
  for (let i = 0; i < 30; i++) entries.push({ date: C.addDays(T, -i), amount: 100 });
  const f = C.forecast30({ today: T, entries, scheduled: [{ date: "2026-10-20", amount: 500, label: "Rice sack" }], restock: [{ date: "2026-10-03", amount: 200, label: "Eggs" }, { date: "2026-10-10", amount: null, label: "Soap" }], safeNow: 5000, fund: 20000 });
  assert.equal(f.baselineDaily, 100);
  assert.equal(f.baseline, 3000);
  assert.equal(f.knownTotal, 700);
  assert.equal(f.known[0].date, "2026-10-07");        // overdue restock lands tomorrow
  assert.equal(f.projected, 3000);
  assert.equal(f.basis, "history");
  assert.equal(f.unpricedRestock.length, 1);
  assert.equal(f.endSafe, 2000);
  assert.equal(f.status, "OK");
  assert.equal(f.weeks.length, 5);
  const short = C.forecast30({ today: T, entries: [{ date: T, amount: 100 }], scheduled: [{ date: "2026-10-10", amount: 900 }], safeNow: 500 });
  assert.equal(short.baseline, null);
  assert.equal(short.basis, "known_only");
  assert.equal(short.projected, 900);
  assert.equal(short.status, "SHORT");
  assert.match(short.why[0], /not enough data/);
  assert.equal(C.forecast30({ today: T }).status, "SETUP");
});

test("forecast30: pace-based estimates are whole pesos (no fake centavos)", () => {
  const T = "2026-10-06";
  const entries = [{ date: "2026-09-10", amount: 1000.5 }, { date: "2026-09-20", amount: 333.33 }, { date: T, amount: 77.77 }];
  const f = C.forecast30({ today: T, entries, safeNow: 50000 });
  assert.equal(f.baseline, Math.round(f.baseline));
  assert.ok(f.baseline > 0 && f.weeks.every(w => w.baseline === null || w.baseline === Math.round(w.baseline)));
});

test("planRoute: in BEST BALANCE a store with unknown travel is never treated as free", () => {
  // d is slightly cheaper for item 1 but has no travel time; a alone is close (5 min)
  const items = [{ id: "1", prices: { a: 110, d: 100 } }, { id: "2", prices: { a: 50 } }];
  const stores = { a: { name: "A", minutes: 5 }, d: { name: "D" }, far: { name: "Far", minutes: 40 } };
  const bal = C.planRoute(items, stores, { timeValuePerHour: 100 }, "balance");
  // a+d assumed 2*40 + 10 + 40 = 130 min → 150 + 216.67 = 366.67; a alone 2*5 + 20 = 30 min → 160 + 50 = 210
  assert.deepEqual(bal.best.stores, ["a"]);
  assert.match(bal.why.join(" "), /treated as 40 min from home/);
  assert.equal(C.planRoute(items, stores, {}, "cheapest").best.itemsTotal, 150);
});
