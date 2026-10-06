// Unit tests for the Stage 2 model: v2 → v3 upgrade, receipt matching, duplicate receipts.
const test = require("node:test");
const assert = require("node:assert/strict");
const M = require("../../js/model.js");
const stage1 = require("../fixtures/stage1-snapshot.json").data;
const legacy = require("../fixtures/pre-upgrade-snapshot.json").data;

test("schema is v3", () => {
  assert.equal(M.SCHEMA_VERSION, 3);
});

test("v2 → v3 upgrade keeps every Stage 1 record and adds Stage 2 structures", () => {
  const before = JSON.stringify(stage1);
  const r = M.migrate(stage1, { at: "2026-10-06T13:00:00.000Z" });
  assert.equal(JSON.stringify(stage1), before, "input not mutated");
  assert.ok(r.valid, JSON.stringify(r.problems));
  assert.equal(r.fromVersion, 2);
  assert.equal(r.toVersion, 3);
  const a = M.countsOf(stage1), b = M.countsOf(r.data);
  for (const k of M.LEGACY_COUNT_KEYS.concat(M.STAGE1_COUNT_KEYS)) assert.equal(b[k], a[k], k);
  assert.equal(r.data.shoppingLists.filter(l => l.status === "active").length, 1);
  assert.deepEqual(r.data.settings.cycle, { mode: "days", lengthDays: 15, anchorDate: r.data.settings.cycle.anchorDate });
  assert.match(r.data.settings.cycle.anchorDate, /^\d{4}-\d{2}-01$/);
  assert.equal(r.data.settings.inventory.lowDays, 7);
  assert.ok(r.data.priceRecords.every(p => p.matchConfidence === "high" && p.needsReview === false));
  assert.equal(M.integrityCheck(r.data).errors, 0);
  // running it again is a no-op
  const again = M.migrate(r.data);
  assert.equal(again.steps.length, 0);
  assert.equal(again.data.shoppingLists.length, 1);
});

test("v1 → v3 upgrade still learns legacy receipts as High confidence", () => {
  const r = M.migrate(legacy);
  assert.ok(r.valid);
  assert.equal(r.steps.length, 2);
  assert.ok(r.data.priceRecords.length > 0);
  assert.ok(r.data.priceRecords.every(p => p.matchConfidence === "high"));
});

test("matchProduct: High for exact/alias, Review for similar, Unknown otherwise", () => {
  const products = [
    M.makeProduct({ name: "Rice Jasmine 5kg", size: 5, unit: "kg" }, "x"),
    M.makeProduct({ name: "Mineral Water 6x1L" }, "x"),
    M.makeProduct({ name: "Dish soap 500ml", aliases: ["JOY LEMON 500ML"] }, "x")
  ];
  assert.equal(M.matchProduct(products, "rice  jasmine 5KG").confidence, "high");
  const alias = M.matchProduct(products, "Joy Lemon 500ml");
  assert.equal(alias.confidence, "high");
  assert.equal(alias.reason, "alias");
  const sim = M.matchProduct(products, "Jasmine Rice 5kg");
  assert.equal(sim.confidence, "review");
  assert.equal(sim.product.name, "Rice Jasmine 5kg");
  assert.equal(M.matchProduct(products, "Jasmine Rice 10kg").reason, "different_size");
  assert.equal(M.matchProduct(products, "Hanabishi Stand Fan 16in").confidence, "unknown");
  assert.equal(M.matchProduct(products, "").confidence, "unknown");
  products[0].archived = true;
  assert.equal(M.matchProduct(products, "Rice Jasmine 5kg").confidence, "unknown", "archived products are not matched");
});

test("priceRecordsFromReceipt records confidence and flags review/unknown lines", () => {
  const d = M.migrate(stage1).data;
  const nProducts = d.products.length;
  const receipt = { id: "RCtest", store: "Puregold", receiptDate: "2026-10-06", total: 999,
    items: [{ name: "Rice Jasmine 5kg", qty: 1, price: 355 }, { name: "Jasmine Rice 5 kg", qty: 1, price: 350 }, { name: "Brand New Thing", qty: 2, price: 100 }, { name: "VAT 12%", price: 50 }] };
  const x = M.priceRecordsFromReceipt(d, receipt, { at: "2026-10-06T05:00:00.000Z" });
  assert.equal(x.priceRecords, 3);
  assert.deepEqual([x.high, x.review, x.unknown], [1, 1, 1]);
  assert.equal(x.products, 1, "only the unknown line creates a product");
  assert.equal(d.products.length, nProducts + 1);
  const recs = d.priceRecords.filter(r => r.sourceRef && r.sourceRef.id === "RCtest");
  assert.deepEqual(recs.map(r => r.matchConfidence), ["high", "review", "unknown"]);
  assert.deepEqual(recs.map(r => r.needsReview), [false, true, true]);
  assert.deepEqual([recs[2].price, recs[2].qty], [100, 2], "receipt line price kept as printed — never invented");
  // idempotent
  assert.equal(M.priceRecordsFromReceipt(d, receipt, {}).priceRecords, 0);
});

test("findDuplicateReceipt: same number, or same store + date + total", () => {
  const list = [
    { id: "a", store: "SM Supermarket", receiptDate: "2026-10-05", total: 2424 },
    { id: "b", store: "Puregold", receiptDate: "2026-10-01", total: 500, receiptNumber: "OR-0001" }
  ];
  assert.equal(M.findDuplicateReceipt(list, { store: "sm supermarket", receiptDate: "2026-10-05", total: 2424.004 }).reason, "same_store_date_total");
  assert.equal(M.findDuplicateReceipt(list, { store: "SM Supermarket", receiptDate: "2026-10-06", total: 2424 }), null);
  assert.equal(M.findDuplicateReceipt(list, { store: "SM Supermarket", receiptDate: "2026-10-05", total: 2425 }), null);
  assert.equal(M.findDuplicateReceipt(list, { store: "Puregold", receiptDate: "2026-10-09", total: 1, receiptNumber: "or-0001" }).receipt.id, "b");
  assert.equal(M.findDuplicateReceipt(list, { id: "a", store: "SM Supermarket", receiptDate: "2026-10-05", total: 2424 }), null, "a receipt is not its own duplicate");
});

test("integrityCheck catches broken Stage 2 records", () => {
  const d = M.migrate(stage1).data;
  d.inventoryItems.push(M.makeInventoryItem({ name: "Rice", quantity: 3, productId: "nope" }, "x"));
  d.inventoryItems.push(Object.assign(M.makeInventoryItem({ name: "Bad" }, "x"), { quantity: -1 }));
  const li = M.makeListItem({ name: "Eggs" }, "x");
  d.shoppingLists[0].items.push(li, Object.assign({}, li));
  d.trips.push({ id: "t1", status: "weird" });
  const r = M.integrityCheck(d);
  const codes = r.issues.map(i => i.code);
  assert.ok(codes.includes("broken_link"));
  assert.ok(codes.includes("bad_quantity"));
  assert.ok(codes.includes("duplicate_id"));
  assert.ok(codes.includes("bad_status"));
});

test("factories give safe defaults", () => {
  const it = M.makeInventoryItem({ name: " Eggs ", quantity: "12", location: "garage", packSize: 0 }, "t");
  assert.deepEqual([it.name, it.quantity, it.location, it.packSize, it.usage.mode], ["Eggs", 12, "pantry", 1, "auto"]);
  const li = M.makeListItem({ name: "Chips", kind: "want", priority: 9, qty: -1 }, "t");
  assert.deepEqual([li.kind, li.priority, li.qty, li.status, li.pinned], ["want", 2, 1, "open", false]);
});
