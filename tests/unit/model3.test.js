// Unit tests for the Stage 3 model: v3 → v4 upgrade, recurring, substitutes, research offers & source quality.
const test = require("node:test");
const assert = require("node:assert/strict");
const M = require("../../js/model.js");
const stage1 = require("../fixtures/stage1-snapshot.json").data;

function v3() {
  // a realistic v3 file: the Stage 1 snapshot upgraded the way Stage 2 did, plus Stage 2 records
  const d = JSON.parse(JSON.stringify(stage1));
  const r = M.migrate(d).data;
  r.schemaVersion = 3;
  delete r.learning; ["route", "fund", "priceAlerts", "recurring"].forEach(k => delete r.settings[k]);
  delete r.recurring; delete r.alerts;
  r.stores.forEach(s => delete s.travel);
  r.products.forEach(p => { delete p.targetPrice; delete p.substitutes; delete p.rejectedSubstitutes; });
  r.inventoryItems.push(M.makeInventoryItem({ name: "Rice", quantity: 3, unit: "kg" }, "2026-10-01T00:00:00Z"));
  r.shoppingLists[0].items.push(M.makeListItem({ name: "Eggs", qty: 12 }, "2026-10-01T00:00:00Z"));
  return r;
}

test("schema is v4", () => {
  assert.equal(M.SCHEMA_VERSION, 4);
  assert.match(M.APP_VERSION, /^4\./);
  assert.ok(M.COLLECTIONS.includes("recurring") && M.COLLECTIONS.includes("alerts"));
});

test("v3 → v4 upgrade is additive and keeps every record", () => {
  const src = v3();
  const before = JSON.stringify(src);
  const r = M.migrate(src);
  assert.equal(JSON.stringify(src), before, "input not mutated");
  assert.ok(r.valid, JSON.stringify(r.problems));
  assert.equal(r.fromVersion, 3);
  assert.equal(r.toVersion, 4);
  const a = M.countsOf(src), b = M.countsOf(r.data);
  for (const k of M.LEGACY_COUNT_KEYS.concat(M.STAGE1_COUNT_KEYS, M.STAGE2_COUNT_KEYS)) assert.equal(b[k], a[k], k);
  assert.deepEqual(r.data.recurring, []);
  assert.deepEqual(r.data.alerts, []);
  assert.equal(r.data.settings.route.mode, "balance");
  assert.equal(r.data.settings.fund.expensiveAt, 5000);
  assert.equal(r.data.settings.priceAlerts.dropPct, 5);
  assert.ok(r.data.learning.alertScanAt);
  assert.ok(r.data.stores.every(s => s.travel && s.travel.minutes === null && s.travel.km === null));
  assert.ok(r.data.products.every(p => p.targetPrice === null && Array.isArray(p.substitutes)));
  assert.equal(M.integrityCheck(r.data).errors, 0);
  assert.equal(r.steps.length, 1);
  assert.equal(M.migrate(r.data).steps.length, 0, "second run is a no-op");
});

test("existing settings and learning are kept on load", () => {
  const d = M.migrate(v3()).data;
  d.settings.route.mode = "fastest"; d.settings.route.timeValuePerHour = 250;
  d.learning.terms.bigas = { productId: "p1", name: "Rice" };
  const again = M.migrate(d).data;
  assert.equal(again.settings.route.mode, "fastest");
  assert.equal(again.settings.route.timeValuePerHour, 250);
  assert.equal(again.learning.terms.bigas.name, "Rice");
  d.settings.route.mode = "teleport";
  assert.equal(M.ensureShape(d).settings.route.mode, "balance");
});

test("makeRecurring + integrity", () => {
  const r = M.makeRecurring({ title: "Rice sack", amount: "1450", every: { unit: "weeks", n: 2 }, nextDue: "2026-10-10" }, "2026-10-06T00:00:00Z");
  assert.equal(r.amount, 1450);
  assert.deepEqual(r.every, { unit: "weeks", n: 2 });
  assert.equal(r.autoCommit, true);
  const d = M.migrate(v3()).data;
  d.recurring.push(r, Object.assign({}, r, { id: "bad", every: { unit: "years", n: 1 }, nextDue: "" }));
  const ic = M.integrityCheck(d);
  assert.ok(ic.issues.some(i => i.code === "bad_repeat"));
  assert.ok(ic.issues.some(i => i.code === "bad_date"));
});

test("substitutesFor: same kind, comparable unit, respects choices", () => {
  const ps = [
    M.makeProduct({ id: "a", name: "Jasmine Rice 5kg", size: 5, unit: "kg" }, "x"),
    M.makeProduct({ id: "b", name: "Dinorado Rice 5kg", size: 5, unit: "kg" }, "x"),
    M.makeProduct({ id: "c", name: "Rice Vinegar 1L", size: 1, unit: "L" }, "x"),
    M.makeProduct({ id: "d", name: "Brown Rice 2kg", size: 2, unit: "kg" }, "x"),
    M.makeProduct({ id: "e", name: "Eggs tray", size: 30, unit: "pcs" }, "x")
  ];
  let s = M.substitutesFor(ps, ps[0]).map(x => x.product.id);
  assert.deepEqual(s.sort(), ["b", "d"]);
  ps[0].rejectedSubstitutes = ["d"];
  ps[0].substitutes = ["e"];
  s = M.substitutesFor(ps, ps[0]).map(x => x.product.id);
  assert.equal(s[0], "e");
  assert.ok(!s.includes("d"));
});

test("sourceQuality classifies research links", () => {
  assert.equal(M.sourceQuality("https://www.lazada.com.ph/products/x").kind, "marketplace");
  assert.equal(M.sourceQuality("https://shopee.ph/abc").kind, "marketplace");
  assert.equal(M.sourceQuality("https://www.rtings.com/air-fryer").kind, "review");
  assert.equal(M.sourceQuality("https://www.reddit.com/r/Philippines").kind, "community");
  assert.equal(M.sourceQuality("https://abenson.com/item").kind, "official");
  assert.equal(M.sourceQuality("https://example.org").kind, "other");
  assert.equal(M.sourceQuality("").kind, "none");
  assert.equal(M.sourceQuality("notaurl").kind, "none");
});

test("parseOffers reads OFFER lines and never invents a price", () => {
  const rep = [
    "Summary text",
    "OFFER: Philips Air Fryer HD9200 | 4,995 | Abenson | https://abenson.com/hd9200 | verified",
    "- OFFER: Xiaomi Smart Air Fryer | unknown | Lazada | https://www.lazada.com.ph/x | estimate",
    "OFFER: Generic fryer | 2500 | none | none | estimate",
    "CATEGORY: Appliances"
  ].join("\n");
  const o = M.parseOffers(rep);
  assert.equal(o.length, 3);
  assert.deepEqual(o[0], { product: "Philips Air Fryer HD9200", price: 4995, seller: "Abenson", url: "https://abenson.com/hd9200", verified: true });
  assert.equal(o[1].price, null);
  assert.equal(o[1].verified, false);
  assert.equal(o[2].url, null);
  assert.equal(o[2].seller, "");
  assert.ok(!M.stripOfferLines(rep).includes("OFFER"));
  assert.ok(M.stripOfferLines(rep).includes("CATEGORY"));
  assert.deepEqual(M.parseOffers("no offers here"), []);
});
