// Unit tests for Stage 4 analytics math (calc.js) and the PDF writer.
const test = require("node:test");
const assert = require("node:assert/strict");
const C = require("../../js/calc.js");
const P = require("../../js/pdf.js");

const E = (date, amount, category, store, extra) => Object.assign({ key: date + amount + (store || ""), date, amount, category: category || "Food", store: store || "SM", counted: true, title: "x" }, extra || {});

test("month helpers and ranges", () => {
  assert.equal(C.monthKey("2026-10-06"), "2026-10");
  assert.equal(C.monthKey("bad"), null);
  assert.equal(C.monthLabel("2026-01"), "Jan 2026");
  assert.deepEqual(C.monthsBetween("2025-11-20", "2026-02-01"), ["2025-11", "2025-12", "2026-01", "2026-02"]);
  assert.deepEqual(C.monthsBetween("2026-03-01", "2026-01-01"), []);
  const r = C.insightRange("30d", "2026-10-06");
  assert.equal(r.start, "2026-09-07"); assert.equal(r.end, "2026-10-06"); assert.equal(r.days, 30);
  const all = C.insightRange("all", "2026-10-06", "2026-08-01");
  assert.equal(all.start, "2026-08-01"); assert.equal(all.days, 67);
  const custom = C.insightRange({ start: "2026-10-05", end: "2026-10-01" }, "2026-10-06");
  assert.equal(custom.start, "2026-10-01"); assert.equal(custom.days, 5);
  assert.deepEqual(C.previousRange(r), { start: "2026-08-08", end: "2026-09-06", days: 30 });
  assert.equal(C.medianOf([5, 1, 3]), 3); assert.equal(C.medianOf([1, 2, 3, 4]), 2.5); assert.equal(C.medianOf([]), null);
  assert.equal(C.madOf([1, 2, 3, 4, 100]), 1);
});

test("spending trends by month, category and store, with previous-period change", () => {
  const entries = [
    E("2026-07-20", 90, "Food", "SM"), // history reaches back before the previous period
    E("2026-08-20", 1000, "Food", "SM"),
    E("2026-09-10", 500, "Food", "SM"), E("2026-09-11", 300, "Toiletries", "Puregold"),
    E("2026-10-01", 700, "Food", "Puregold"), E("2026-10-02", 200, "Food", "SM", { counted: false }),
    E("2026-10-03", 999, "Food", "SM", { amount: "bad" })
  ];
  const r = C.spendingTrends(entries, C.insightRange({ start: "2026-09-01", end: "2026-10-06" }, "2026-10-06"));
  assert.equal(r.total, 1500); assert.equal(r.count, 3);
  assert.deepEqual(r.months.map(m => [m.month, m.total]), [["2026-09", 800], ["2026-10", 700]]);
  assert.deepEqual(r.byCategory.map(c => [c.name, c.total, c.share]), [["Food", 1200, 80], ["Toiletries", 300, 20]]);
  assert.equal(r.byStore[0].name, "Puregold"); assert.equal(r.byStore[0].visits, 2);
  assert.equal(r.prevTotal, 1000);
  assert.equal(r.changePct, 50);
  assert.equal(r.dailyAvg, C.round2(1500 / 36));
  const empty = C.spendingTrends([], C.insightRange("30d", "2026-10-06"));
  assert.equal(empty.total, 0); assert.equal(empty.dailyAvg, null); assert.equal(empty.changePct, null);
  assert.match(empty.why[0], /No counted spending/);
});

test("no previous-period change when history doesn't reach back", () => {
  const r = C.spendingTrends([E("2026-10-01", 100), E("2026-09-30", 50)], C.insightRange("7d" in C.INSIGHT_RANGE_DAYS ? "7d" : { start: "2026-10-01", end: "2026-10-06" }, "2026-10-06"));
  assert.equal(r.changePct, null);
});

test("basket index: matched products vs base month, weighted, with not-enough-data", () => {
  const recs = [
    { productId: "rice", name: "Rice", date: "2026-08-03", value: 76 },
    { productId: "rice", name: "Rice", date: "2026-09-03", value: 74 },
    { productId: "rice", name: "Rice", date: "2026-10-03", value: 69 },
    { productId: "eggs", name: "Eggs", date: "2026-09-04", value: 8.5 },
    { productId: "eggs", name: "Eggs", date: "2026-09-20", value: 8.0 },
    { productId: "eggs", name: "Eggs", date: "2026-10-04", value: 9.0 },
    { productId: "soap", name: "Soap", date: "2026-10-04", value: 55 }
  ];
  const r = C.basketIndex(recs);
  assert.equal(r.base, "2026-09");
  assert.equal(r.basketSize, 2);
  // weights: rice 3 records, eggs 3 records. Sep: rice 74, eggs 8.25. Oct: rice 69, eggs 9
  const exp = C.round2((3 * 69 + 3 * 9) / (3 * 74 + 3 * 8.25) * 100);
  assert.equal(r.latest.index, exp);
  assert.equal(r.latest.changePct, C.round2(exp - 100));
  assert.equal(r.items[0].productId, "eggs"); // biggest riser first
  assert.equal(r.items[0].changePct, C.round2((9 - 8.25) / 8.25 * 100));
  assert.equal(r.notEnough, false);
  const thin = C.basketIndex([{ productId: "a", date: "2026-09-01", value: 5 }, { productId: "a", date: "2026-10-01", value: 6 }]);
  assert.equal(thin.notEnough, true); assert.equal(thin.latest, null);
  assert.match(thin.why[0], /Not enough data/);
  assert.equal(C.basketIndex([{ productId: "a", date: "2026-09-01", value: 0 }]).notEnough, true);
});

test("savings come only from real before/after prices", () => {
  const history = [
    { id: "h1", productId: "rice", date: "2026-09-01", value: 76, store: "SM" },
    { id: "h2", productId: "rice", date: "2026-09-20", value: 74, store: "SM" },
    { id: "p1", productId: "rice", date: "2026-10-01", at: "2026-10-01T02:00:00Z", value: 69, store: "Landers" },
    { id: "h3", productId: "eggs", date: "2026-09-02", value: 8, store: "SM" },
    { id: "p2", productId: "eggs", date: "2026-10-02", value: 9, store: "SM" },
    { id: "p3", productId: "oil", date: "2026-10-02", value: 89, store: "SM" }
  ];
  const purchases = [
    { id: "p1", productId: "rice", name: "Rice 5kg", date: "2026-10-01", at: "2026-10-01T02:00:00Z", value: 69, paid: 345, store: "Landers" }, // 5 kg
    { id: "p2", productId: "eggs", name: "Eggs", date: "2026-10-02", value: 9, paid: 270, store: "SM" }, // 30 pc
    { id: "p3", productId: "oil", name: "Oil", date: "2026-10-02", value: 89, paid: 89, store: "SM" } // no earlier price
  ];
  const s = C.savingsFromPrices(purchases, history);
  assert.equal(s.compared, 2); assert.equal(s.notComparable, 1);
  assert.equal(s.saved, 25);       // 5 × 74 − 345
  assert.equal(s.paidMore, 30);    // 270 − 30 × 8
  assert.equal(s.net, -5);
  assert.equal(s.lines[0].before, 74); assert.equal(s.lines[0].beforeDate, "2026-09-20");
  assert.match(s.why[1], /1 purchase had no earlier price/);
  const none = C.savingsFromPrices([purchases[2]], history);
  assert.equal(none.notEnough, true); assert.equal(none.saved, 0);
  assert.match(none.why[0], /Not enough data/);
});

test("same-day savings use the earlier time, never the record itself", () => {
  const h = [{ id: "a", productId: "x", date: "2026-10-01", at: "2026-10-01T01:00:00Z", value: 10 }, { id: "b", productId: "x", date: "2026-10-01", at: "2026-10-01T05:00:00Z", value: 8 }];
  const s = C.savingsFromPrices([{ id: "b", productId: "x", date: "2026-10-01", at: "2026-10-01T05:00:00Z", value: 8, paid: 16 }], h);
  assert.equal(s.saved, 4);
  const s2 = C.savingsFromPrices([{ id: "a", productId: "x", date: "2026-10-01", at: "2026-10-01T01:00:00Z", value: 10, paid: 10 }], h);
  assert.equal(s2.compared, 0);
});

test("store performance: spend, visits, basket, cheapest wins", () => {
  const entries = [E("2026-10-01", 600, "Food", "SM"), E("2026-10-01", 400, "Food", "SM"), E("2026-10-03", 1000, "Food", "Puregold")];
  const comps = [
    { productId: "rice", rows: [{ store: "SM", value: 74 }, { store: "Puregold", value: 72 }] },
    { productId: "eggs", rows: [{ store: "SM", value: 8 }, { store: "Puregold", value: 8.8 }] },
    { productId: "solo", rows: [{ store: "SM", value: 1 }] }
  ];
  const r = C.storePerformance(entries, comps);
  const sm = r.stores.find(s => s.name === "SM"), pg = r.stores.find(s => s.name === "Puregold");
  assert.equal(sm.spend, 1000); assert.equal(sm.visits, 1); assert.equal(sm.avgBasket, 1000); assert.equal(sm.share, 50);
  assert.equal(sm.wins, 1); assert.equal(sm.compared, 2); assert.equal(sm.winRate, 50);
  assert.equal(sm.avgPremiumPct, C.round2(((74 - 72) / 72 * 100 + 0) / 2));
  assert.equal(pg.avgPremiumPct, C.round2((0 + 10) / 2));
  assert.equal(C.storePerformance([], []).stores.length, 0);
});

test("usage, waste value, expiry losses and stock-outs", () => {
  const range = { start: "2026-10-01", end: "2026-10-31" };
  const items = { milk: { name: "Milk", unitValue: 95 }, bread: { name: "Bread", unitValue: null }, rice: { name: "Rice", unitValue: 70 } };
  const txs = [
    { itemId: "milk", type: "use", qty: -1, before: 3, after: 2, day: "2026-10-01" },
    { itemId: "milk", type: "discard", qty: -1, before: 2, after: 1, day: "2026-10-02", reason: "expired" },
    { itemId: "milk", type: "use", qty: -1, before: 1, after: 0, day: "2026-10-03" },
    { itemId: "milk", type: "trip", qty: 2, before: 0, after: 2, day: "2026-10-06" },
    { itemId: "bread", type: "discard", qty: -2, before: 2, after: 0, day: "2026-10-04", reason: "spoiled" },
    { itemId: "rice", type: "discard", qty: -1, before: 5, after: 4, day: "2026-10-04" }, // legacy: unclear
    { itemId: "rice", type: "use", qty: -1, before: 4, after: 3, day: "2026-09-04" }      // outside range
  ];
  const u = C.usageAnalytics(txs, items, range, "2026-10-08");
  const milk = u.items.find(i => i.itemId === "milk");
  assert.equal(milk.used, 2); assert.equal(milk.wasted, 1); assert.equal(milk.wasteValue, 95);
  assert.equal(milk.stockouts, 1); assert.equal(milk.daysOut, 3); assert.equal(milk.stillOut, false);
  const bread = u.items.find(i => i.itemId === "bread");
  assert.equal(bread.wasted, 2); assert.equal(bread.wastePriced, false); assert.equal(bread.stillOut, true);
  assert.equal(bread.daysOut, 4); // Oct 4 → today Oct 8
  assert.equal(u.wasteValue, 95); assert.equal(u.expiredValue, 95);
  assert.equal(u.wasteUnpriced, 1); assert.equal(u.unclearDiscards, 1);
  assert.equal(u.stockouts, 2); assert.equal(u.outNow, 1);
  assert.equal(u.items.find(i => i.itemId === "rice").used, 0);
  assert.ok(u.why.some(w => /partial/.test(w)));
  assert.match(C.usageAnalytics([], {}, range, "2026-10-08").why[0], /No stock changes/);
});

test("accuracy: plans, cycles and forecasts", () => {
  assert.deepEqual(C.accuracy(1000, 1100), { planned: 1000, actual: 1100, errorPct: 10, accuracyPct: 90, direction: "over" });
  assert.equal(C.accuracy(1000, 990).direction, "on");
  assert.equal(C.accuracy(1000, 0).accuracyPct, 0);
  assert.equal(C.accuracy(100, 500).accuracyPct, 0);
  assert.equal(C.accuracy(0, 5), null);
  const cy = C.cycleAccuracy([{ id: "c1", start: "2026-09-01", end: "2026-09-15", planned: 5000, actual: 4500 }, { id: "c2", start: "2026-09-16", end: "2026-09-30", planned: 0, actual: 100 }]);
  assert.equal(cy.average, 90); assert.equal(cy.rows[1].acc, null);
  assert.equal(C.cycleAccuracy([]).notEnough, true);

  const cats = [{ id: "food", name: "Food" }, { id: "home", name: "Home" }];
  const plans = [
    { at: "2026-08-01T00:00:00Z", mode: "peso", items: [{ categoryId: "food", value: 1000 }], fund: 5000 },
    { at: "2026-09-05T00:00:00Z", mode: "percent", items: [{ categoryId: "food", value: 20 }, { categoryId: "home", value: 10 }], fund: 5000 },
    { at: "2026-10-05T00:00:00Z", mode: "peso", items: [{ categoryId: "food", value: 9999 }], fund: 5000 }
  ];
  const entries = [E("2026-08-10", 800, "Food"), E("2026-09-10", 1100, "Food"), E("2026-09-11", 500, "Home"), E("2026-10-02", 50, "Food")];
  const pa = C.planAccuracy([{ start: "2026-08-01", end: "2026-08-31" }, { start: "2026-09-01", end: "2026-09-30" }], plans, cats, entries);
  assert.equal(pa.periods.length, 2);
  assert.equal(pa.periods[0].rows[0].acc.accuracyPct, 80);   // 800 vs 1000
  assert.equal(pa.periods[1].rows[0].planned, 1000);         // 20% of 5000
  assert.equal(pa.periods[1].rows[0].acc.accuracyPct, 90);   // 1100 vs 1000
  assert.equal(pa.periods[1].rows[1].acc.accuracyPct, 100);  // 500 vs 500
  assert.equal(pa.categories.find(c => c.category === "Food").average, 85);
  assert.equal(C.planAccuracy([{ start: "2026-07-01", end: "2026-07-31" }], plans, cats, entries).notEnough, true);

  const fa = C.forecastAccuracy([
    { at: "2026-09-01T00:00:00Z", start: "2026-09-01", end: "2026-09-30", projected: 2000 },
    { at: "2026-10-01T00:00:00Z", start: "2026-10-01", end: "2026-10-30", projected: 900 }
  ], entries, "2026-10-06");
  assert.equal(fa.rows.length, 1); assert.equal(fa.rows[0].actual, 1600); assert.equal(fa.average, 80);
  assert.equal(fa.pending, 1); assert.equal(fa.nextCheck, "2026-10-31");
  const fn = C.forecastAccuracy([{ start: "2026-10-01", end: "2026-10-30", projected: 900 }], entries, "2026-10-06");
  assert.equal(fn.notEnough, true); assert.match(fn.why[0], /first check on 2026-10-31/);
});

test("unusual spending: big purchase, category spike, duplicates — and silence without history", () => {
  const base = ["2026-05-03", "2026-05-20", "2026-06-04", "2026-06-21", "2026-07-05", "2026-07-22", "2026-08-06", "2026-08-23"].map((d, i) => E(d, 400 + i * 10, "Food", "SM", { key: "k" + i }));
  const big = E("2026-09-15", 3000, "Food", "SM", { key: "big", title: "Party" });
  const dupA = E("2026-09-20", 250, "Home", "Puregold", { key: "d1" }), dupB = E("2026-09-20", 250, "Home", "Puregold", { key: "d2" });
  const r = C.unusualSpending(base.concat([big, dupA, dupB]), { start: "2026-09-01", end: "2026-09-30" });
  const kinds = r.flags.map(f => f.kind).sort();
  assert.deepEqual(kinds, ["big_purchase", "category_spike", "possible_duplicate"]);
  const bp = r.flags.find(f => f.kind === "big_purchase");
  assert.equal(bp.key, "big"); assert.match(bp.why, /usual Food purchase/);
  const sp = r.flags.find(f => f.kind === "category_spike");
  assert.equal(sp.month, "2026-09"); assert.equal(sp.amount, 3000);
  const dup = r.flags.find(f => f.kind === "possible_duplicate");
  assert.equal(dup.key, "d2"); assert.equal(dup.otherKey, "d1");
  // thin history → no size flags
  const thin = C.unusualSpending([E("2026-09-01", 100), E("2026-09-15", 5000)], { start: "2026-09-01", end: "2026-09-30" });
  assert.equal(thin.flags.length, 0); assert.equal(thin.skippedThin, 2);
});

test("CSV escaping and formula safety", () => {
  const csv = C.toCSV([{ key: "a", label: "Name" }, { key: "b", label: "Amount" }], [
    { a: 'Rice, "jasmine"', b: 345 }, { a: "=SUM(A1)", b: -5 }, { a: "-cmd", b: null }, { a: "line\nbreak", b: 1.5 }
  ]);
  assert.equal(csv, 'Name,Amount\r\n"Rice, ""jasmine""",345\r\n\'=SUM(A1),-5\r\n\'-cmd,\r\n"line\nbreak",1.5\r\n');
  assert.equal(C.csvCell("-12.5"), "-12.5");
});

test("PDF writer makes a valid multi-page PDF with correct xref offsets", () => {
  const rows = Array.from({ length: 120 }, (_, i) => ["Item " + i, "₱" + (i * 10)]);
  const pdf = P.build({ title: "Jason Shop — Insights ₱", subtitle: "Oct 2026", sections: [
    { heading: "Spending", lines: ["Total ₱1,500 → up 50%"], bars: [{ label: "Food", value: 1200, text: "₱1,200" }] },
    { heading: "Table", table: { columns: [{ label: "Item", width: 3 }, { label: "Amount", align: "right" }], rows } }] });
  assert.ok(pdf.startsWith("%PDF-1.4"));
  assert.ok(pdf.trimEnd().endsWith("%%EOF"));
  assert.ok(!/[^\x00-\xFF]/.test(pdf), "single-byte only");
  assert.ok(pdf.includes("(Total PHP 1,500 -> up 50%)"));
  const count = Number(/\/Count (\d+)/.exec(pdf)[1]);
  assert.ok(count >= 3);
  const xrefAt = Number(/startxref\n(\d+)/.exec(pdf)[1]);
  assert.ok(pdf.slice(xrefAt).startsWith("xref"));
  const offsets = pdf.slice(xrefAt).split("\n").filter(l => / 00000 n $/.test(l)).map(l => Number(l.slice(0, 10)));
  offsets.forEach((o, i) => assert.ok(pdf.slice(o).startsWith((i + 1) + " 0 obj"), "object " + (i + 1)));
  assert.equal(P.clean("🛒 Eggs ₱5 × 2"), "Eggs PHP 5 x 2");
  assert.equal(P.toBytes("A\xE2").length, 2);
});
