// Unit tests for the Stage 2 math in js/calc.js (cycles, inventory, forecasts, expiry, lists, trips).
const test = require("node:test");
const assert = require("node:assert/strict");
const C = require("../../js/calc.js");

test("addDays / daysBetween cross months, years and leap days", () => {
  assert.equal(C.addDays("2026-10-31", 1), "2026-11-01");
  assert.equal(C.addDays("2026-12-31", 1), "2027-01-01");
  assert.equal(C.addDays("2028-02-28", 1), "2028-02-29");
  assert.equal(C.addDays("2026-03-01", -1), "2026-02-28");
  assert.equal(C.daysBetween("2026-10-01", "2026-10-15"), 14);
  assert.equal(C.daysBetween("2026-10-15", "2026-10-01"), -14);
  assert.equal(C.addDays("bad", 1), null);
  assert.equal(C.daysBetween("2026-10-01", ""), null);
});

test("validateCycle accepts 3–62 day cycles and semimonthly", () => {
  assert.ok(C.validateCycle({ mode: "days", lengthDays: 15, anchorDate: "2026-10-01" }).ok);
  assert.ok(C.validateCycle({ mode: "semimonthly" }).ok);
  assert.ok(!C.validateCycle({ mode: "days", lengthDays: 2, anchorDate: "2026-10-01" }).ok);
  assert.ok(!C.validateCycle({ mode: "days", lengthDays: 7.5, anchorDate: "2026-10-01" }).ok);
  assert.ok(!C.validateCycle({ mode: "days", lengthDays: 15, anchorDate: "" }).ok);
  assert.ok(!C.validateCycle({ mode: "weekly" }).ok);
});

test("cycleRange: 15-day cycle from an anchor, before the anchor, and semimonthly", () => {
  const cyc = { mode: "days", lengthDays: 15, anchorDate: "2026-10-01" };
  const r = C.cycleRange(cyc, "2026-10-06");
  assert.deepEqual([r.start, r.end, r.index, r.dayNumber, r.daysLeft, r.lengthDays], ["2026-10-01", "2026-10-15", 0, 6, 9, 15]);
  const r2 = C.cycleRange(cyc, "2026-10-16");
  assert.deepEqual([r2.start, r2.end, r2.index, r2.dayNumber], ["2026-10-16", "2026-10-30", 1, 1]);
  const before = C.cycleRange(cyc, "2026-09-30");
  assert.deepEqual([before.start, before.end, before.index], ["2026-09-16", "2026-09-30", -1]);
  const semi = C.cycleRange({ mode: "semimonthly" }, "2026-10-20");
  assert.deepEqual([semi.start, semi.end, semi.lengthDays, semi.daysLeft], ["2026-10-16", "2026-10-31", 16, 11]);
  const feb = C.cycleRange({ mode: "semimonthly" }, "2026-02-20");
  assert.equal(feb.end, "2026-02-28");
  const first = C.cycleRange({ mode: "semimonthly" }, "2026-10-15");
  assert.deepEqual([first.start, first.end, first.daysLeft], ["2026-10-01", "2026-10-15", 0]);
  // shiftCycle walks to neighbouring cycles
  assert.equal(C.shiftCycle(cyc, r, -1).start, "2026-09-16");
  assert.equal(C.shiftCycle(cyc, r, 2).start, "2026-10-31");
  assert.equal(C.shiftCycle({ mode: "semimonthly" }, semi, 1).start, "2026-11-01");
});

test("learnedDailyUse needs enough history and averages over the span", () => {
  const today = "2026-10-06";
  assert.equal(C.learnedDailyUse([], today), null);
  assert.equal(C.learnedDailyUse([{ type: "use", qty: -1, day: "2026-10-05" }], today), null);
  assert.equal(C.learnedDailyUse([{ type: "use", qty: -1, day: "2026-10-05" }, { type: "use", qty: -1, day: "2026-10-06" }], today), null, "span < 3 days");
  const tx = [
    { type: "use", qty: -2, day: "2026-09-26" },
    { type: "use", qty: -3, day: "2026-10-01" },
    { type: "add", qty: 10, day: "2026-10-02" },
    { type: "use", qty: -5, day: "2026-10-05" },
    { type: "use", qty: -9, day: "2026-06-01" }   // outside the 60-day window
  ];
  assert.equal(C.learnedDailyUse(tx, today), 1);  // 10 used over 10 days
});

test("dailyUse: manual, per person, learned scaled to household, none", () => {
  const hh = { weightedPeople: 4, pets: 1 };
  assert.deepEqual(C.dailyUse({ usage: { mode: "manual", perDay: 0.5 } }, { household: hh }), { value: 0.5, source: "manual" });
  assert.deepEqual(C.dailyUse({ usage: { mode: "per_person", perPersonPerDay: 0.25, perPetPerDay: 0.5 } }, { household: hh }), { value: 1.5, source: "per_person" });
  assert.deepEqual(C.dailyUse({ usage: { mode: "none", perDay: 3 } }, { household: hh }), { value: null, source: null });
  // auto prefers learned, scaled when household grew from 2 to 4 people
  assert.deepEqual(C.dailyUse({ usage: { mode: "auto", perDay: 9 } }, { household: hh, learned: 1, learnedAtPeople: 2 }), { value: 2, source: "learned" });
  assert.deepEqual(C.dailyUse({ usage: { mode: "auto", perDay: 0.3 } }, { household: hh }), { value: 0.3, source: "manual" });
  assert.deepEqual(C.dailyUse({ usage: { mode: "auto", perPersonPerDay: 0.1 } }, { household: hh }), { value: 0.4, source: "per_person" });
  assert.deepEqual(C.dailyUse({}, { household: hh }), { value: null, source: null });
});

test("daysOfSupply and inventoryStatus (days-based and min-qty-based)", () => {
  assert.equal(C.daysOfSupply(10, 2), 5);
  assert.equal(C.daysOfSupply(0, 2), 0);
  assert.equal(C.daysOfSupply(3, null), null);
  assert.deepEqual(C.inventoryStatus({ quantity: 0, perDay: 1 }), { state: "OUT", days: 0 });
  assert.deepEqual(C.inventoryStatus({ quantity: 2, perDay: 1 }), { state: "URGENT", days: 2 });
  assert.deepEqual(C.inventoryStatus({ quantity: 2, perDay: 0.5 }), { state: "LOW", days: 4 });
  assert.deepEqual(C.inventoryStatus({ quantity: 10, perDay: 1 }), { state: "OK", days: 10 });
  assert.deepEqual(C.inventoryStatus({ quantity: 10, perDay: 1, minQty: 12 }), { state: "LOW", days: 10 });
  assert.equal(C.inventoryStatus({ quantity: 1, minQty: 4 }).state, "URGENT");
  assert.equal(C.inventoryStatus({ quantity: 3, minQty: 4 }).state, "LOW");
  assert.equal(C.inventoryStatus({ quantity: 5, minQty: 4 }).state, "OK");
  assert.equal(C.inventoryStatus({ quantity: 5 }).state, "UNTRACKED");
  assert.equal(C.inventoryStatus({ quantity: 6, perDay: 1 }, { lowDays: 5, urgentDays: 2 }).state, "OK", "custom thresholds");
});

test("reorderQty rounds up to whole packs and never goes negative", () => {
  assert.deepEqual(C.reorderQty({ quantity: 2, perDay: 0.5, packSize: 5 }, { targetDays: 18 }), { qty: 10, packs: 2, basis: "daily_use" });
  assert.deepEqual(C.reorderQty({ quantity: 20, perDay: 0.5, packSize: 5 }, { targetDays: 18 }), { qty: 0, packs: 0, basis: "daily_use" });
  assert.deepEqual(C.reorderQty({ quantity: 1, minQty: 3 }), { qty: 5, packs: 5, basis: "min_qty" });
  assert.deepEqual(C.reorderQty({ quantity: 0 }), { qty: 1, packs: 1, basis: "none" });
  assert.deepEqual(C.reorderQty({ quantity: 0, perDay: 1, packSize: 0.5 }, { targetDays: 3 }), { qty: 3, packs: 6, basis: "daily_use" });
});

test("forecast gives run-out date, per-cycle need and whether it lasts the cycle", () => {
  const f = C.forecast({ quantity: 5, perDay: 0.5 }, "2026-10-06", { cycleDays: 15, daysLeftInCycle: 9 });
  assert.deepEqual(f, { perDay: 0.5, daysOfSupply: 10, runOutDate: "2026-10-16", neededPerCycle: 7.5, lastsThisCycle: true });
  const g = C.forecast({ quantity: 2, perDay: 0.5 }, "2026-10-06", { cycleDays: 15, daysLeftInCycle: 9 });
  assert.equal(g.lastsThisCycle, false);
  assert.equal(C.forecast({ quantity: 3 }, "2026-10-06").runOutDate, null);
});

test("expiryStatus and expiryAfterRestock", () => {
  const t = "2026-10-06";
  assert.deepEqual(C.expiryStatus("2026-10-05", t), { state: "EXPIRED", daysLeft: -1 });
  assert.deepEqual(C.expiryStatus("2026-10-06", t), { state: "TODAY", daysLeft: 0 });
  assert.deepEqual(C.expiryStatus("2026-10-09", t), { state: "SOON", daysLeft: 3 });
  assert.deepEqual(C.expiryStatus("2026-10-10", t), { state: "OK", daysLeft: 4 });
  assert.deepEqual(C.expiryStatus("2026-10-10", t, 5).state, "SOON");
  assert.deepEqual(C.expiryStatus(null, t), { state: "NONE", daysLeft: null });
  assert.equal(C.expiryAfterRestock(null, t, 7, false), "2026-10-13");
  assert.equal(C.expiryAfterRestock("2026-10-08", t, 7, true), "2026-10-08", "older stock still expires first");
  assert.equal(C.expiryAfterRestock("2026-10-01", t, 7, true), "2026-10-13", "expired date replaced");
  assert.equal(C.expiryAfterRestock("2026-10-08", t, null, true), "2026-10-08", "no shelf life → unchanged");
});

test("lineEstimate and listTotals never invent prices", () => {
  assert.equal(C.lineEstimate(null, 3), null);
  assert.equal(C.lineEstimate(45.5, 2), 91);
  assert.equal(C.lineEstimate(10, 0), 10);
  const t = C.listTotals([
    { kind: "need", amount: 100, status: "open" },
    { kind: "need", amount: null, status: "open" },
    { kind: "want", amount: 50.25, status: "open" },
    { kind: "want", amount: 999, status: "bought" }
  ]);
  assert.deepEqual(t, { needs: 100, wants: 50.25, total: 150.25, needCount: 2, wantCount: 1, unpriced: 1, unpricedNeeds: 1 });
});

test("fitToBudget keeps needs and pinned wants, defers low-priority wants first", () => {
  const items = [
    { id: "n1", kind: "need", amount: 600 },
    { id: "w1", kind: "want", amount: 300, priority: 3 },
    { id: "w2", kind: "want", amount: 200, priority: 1 },
    { id: "w3", kind: "want", amount: 500, priority: 2, pinned: true },
    { id: "w4", kind: "want", amount: null, priority: 3 },
    { id: "x", kind: "want", amount: 1, status: "bought" }
  ];
  const r = C.fitToBudget(items, 1400);
  assert.deepEqual(r.kept.sort(), ["n1", "w2", "w3", "w4"].sort());
  assert.deepEqual(r.deferred, ["w1"]);
  assert.equal(r.keptTotal, 1300);
  assert.ok(r.fits);
  assert.deepEqual(r.unpriced, ["w4"]);
  const tight = C.fitToBudget(items, 900);
  assert.deepEqual(tight.deferred.sort(), ["w1", "w2"]);
  assert.equal(tight.shortfall, 200, "needs + pinned exceed the budget → shortfall shown, never deferred");
  assert.ok(!tight.fits);
});

test("duplicateWarnings flags cart, list, stock and recent purchases", () => {
  assert.deepEqual(C.duplicateWarnings({}).length, 0);
  const w = C.duplicateWarnings({ onList: true, daysOfSupply: 20, cycleDays: 15, lastBoughtDay: "2026-10-04", today: "2026-10-06" });
  assert.deepEqual(w.map(x => x.code), ["on_list", "plenty_in_stock", "recently_bought"]);
  assert.match(w[2].message, /2 days ago/);
  assert.deepEqual(C.duplicateWarnings({ inCart: true, onList: true }).map(x => x.code), ["in_cart"]);
  assert.equal(C.duplicateWarnings({ lastBoughtDay: "2026-09-01", today: "2026-10-06" }).length, 0);
  assert.equal(C.duplicateWarnings({ daysOfSupply: 3, cycleDays: 15 }).length, 0);
});

test("tripSummary shows Safe to Spend after the cart and the hard-stop crossing", () => {
  const budget = { fund: 50000, spent: 12197, committed: 3000, reserve: 10000, stop: 45000 };
  const s = C.tripSummary(budget, [{ amount: 1000, checked: true }, { amount: null, checked: true }, { amount: 500, checked: false }]);
  assert.equal(s.cartTotal, 1000);
  assert.equal(s.items, 2);
  assert.equal(s.unpriced, 1);
  assert.equal(s.safeBefore, 24803);
  assert.equal(s.safeAfter, 23803);
  assert.equal(s.crossesHardStop, false);
  const big = C.tripSummary(budget, [{ amount: 30000, checked: true }]);
  assert.equal(big.crossesHardStop, true);
  assert.equal(big.safeAfter, 0);
  assert.equal(big.overBy, 5197);
});

test("plannedVsActual compares the cycle plan with what was spent", () => {
  const range = { start: "2026-10-01", end: "2026-10-15" };
  const r = C.plannedVsActual({
    planned: [
      { amount: 500, status: "bought", boughtAmount: 480 },
      { amount: 300, status: "open" },
      { amount: null, status: "deferred" },
      { amount: 999, status: "removed" }
    ],
    actualEntries: [
      { date: "2026-10-03", amount: 480, counted: true },
      { date: "2026-10-04", amount: 200, counted: true },
      { date: "2026-10-04", amount: 77, counted: false },
      { date: "2026-09-30", amount: 1000, counted: true }
    ],
    range
  });
  assert.equal(r.planned, 800);
  assert.equal(r.unpriced, 0, "the unpriced item was moved to next cycle");
  assert.equal(r.plannedCount, 2);
  assert.equal(r.boughtCount, 1);
  assert.equal(r.deferredCount, 1);
  assert.equal(r.actual, 680);
  assert.equal(r.fromPlan, 480);
  assert.equal(r.unplanned, 200);
  assert.equal(r.completionPct, 50);
  assert.equal(r.direction, "under");
  assert.equal(r.saving, 120);
});
