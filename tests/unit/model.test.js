// Unit tests for js/model.js — schema, migrations, matching, integrity, backup envelope.
const test = require("node:test");
const assert = require("node:assert/strict");
const M = require("../../js/model.js");

// Shape of real production data before Stage 1 (v1: no schemaVersion).
function v1Data() {
  return {
    fund: 50000, stop: 40000, spent: 12345.5,
    requests: [
      { id: "R1", text: "rice cooker", status: "done", category: "Home & Furniture", report: "…",
        purchased: { date: "2026-09-28T02:00:00.000Z", amount: 2499, store: "Lazada", itemName: "Rice cooker", category: "Home & Furniture" } },
      { id: "R2", text: "air fryer", status: "researching" },                      // interrupted research
      { text: "dog food", status: "done", category: "Pet" }                         // missing id
    ],
    receipts: [
      { id: "RC2", store: "S&R", date: "2026-10-02T03:00:00.000Z", receiptDate: "2026-10-02", total: 3346.5, addedToSpent: true, category: "Groceries",
        items: [{ name: "Jasmine Rice 5kg", qty: 1, price: 330 }, { name: "Kirkland Paper Towels 12 rolls", qty: 1, price: 1299 }, { name: "VAT", price: 120 }, { name: "Discount", price: -50 }] },
      { id: "RC1", store: "Landers Superstore", date: "2026-09-10T03:00:00.000Z", total: 1500, addedToSpent: true, category: "Groceries",
        items: [{ name: "Jasmine Rice 5kg", qty: 1, price: 345 }, { name: "Fresh Milk 1L", qty: 2, price: 190 }, { name: "", price: 10 }, { name: "Bananas", price: null }] },
      { id: "RC0", store: "Old shop", amount: 500 }                                  // very old receipt shape
    ],
    manual: [
      { id: "M1", date: "2026-10-01", store: "Pampang Palengke", item: "Pork", amount: 700, category: "Meat Stall" },
      { date: "2026-09-02", store: "7-Eleven", item: "Snacks", amount: 99.5, category: "Food & Dining", counted: false }
    ],
    reportSummaries: { "2026-09": { text: "Sept summary", at: "2026-10-01T00:00:00Z" } },
    lastBackup: "2026-09-30T10:00:00.000Z"
  };
}

test("normalizeName / slug", () => {
  assert.equal(M.normalizeName("  Johnny's  Supermarket "), "johnnys supermarket");
  assert.equal(M.normalizeName("S & R"), "s&r");
  assert.equal(M.slug("Baby & Kids"), "baby_and_kids");
  assert.notEqual(M.newId("x"), M.newId("x"));
});

test("createEmpty gives a valid v2 dataset with seeds", () => {
  const d = M.createEmpty();
  assert.equal(d.schemaVersion, M.SCHEMA_VERSION);
  assert.equal(d.stores.length, 7);
  assert.deepEqual(d.stores.map(s => s.id), ["store_newstar", "store_johnnys", "store_pampang", "store_landers", "store_snr", "store_puregold", "store_dutyfree"]);
  assert.equal(d.budgetCategories.length, M.DEFAULT_CATEGORIES.length);
  assert.equal(d.houses.length, 1);
  assert.equal(d.memberGroups.length, M.MEMBER_TYPES.length);
  assert.ok(d.memberGroups.every(g => g.count === 0));
  M.COLLECTIONS.forEach(k => assert.ok(Array.isArray(d[k]), k));
  assert.deepEqual(d.settings.thresholds, { watch: 70, warning: 85, hardStop: 100 });
  assert.equal(M.integrityCheck(d).ok, true);
});

test("migrate v1 → v2 keeps every legacy record and peso total", () => {
  const raw = v1Data();
  const frozen = JSON.stringify(raw);
  const r = M.migrate(raw);
  assert.equal(JSON.stringify(raw), frozen, "input not mutated");
  assert.equal(r.migrated, true); assert.equal(r.valid, true, r.problems.join("; "));
  assert.equal(r.fromVersion, 1); assert.equal(r.toVersion, M.SCHEMA_VERSION);
  const d = r.data;
  assert.equal(d.schemaVersion, M.SCHEMA_VERSION);
  assert.equal(d.requests.length, 3); assert.equal(d.receipts.length, 3); assert.equal(d.manual.length, 2);
  assert.equal(d.fund, 50000); assert.equal(d.stop, 40000); assert.equal(d.spent, 12345.5);
  assert.equal(r.before.receiptTotal, r.after.receiptTotal);
  assert.equal(r.after.receiptTotal, 5346.5);
  assert.equal(r.after.manualTotal, 799.5);
  assert.equal(r.after.purchaseTotal, 2499);
  // legacy behaviours preserved
  assert.equal(d.requests[1].status, "error");
  assert.ok(d.requests[2].id);
  assert.equal(d.receipts[2].total, 500); assert.equal(d.receipts[2].amount, undefined);
  assert.equal(d.reportSummaries["2026-09"].text, "Sept summary");
  assert.equal(d.lastBackup, "2026-09-30T10:00:00.000Z");
  // migration recorded
  assert.equal(d.meta.migrations.length, 1); assert.equal(d.meta.migrations[0].ok, true);
});

test("migration seeds stores/categories/household and keeps custom categories", () => {
  const d = M.migrate(v1Data()).data;
  assert.equal(d.stores.length, 7);
  const names = d.budgetCategories.map(c => c.name);
  assert.ok(names.includes("Meat Stall"), "custom category from history added");
  assert.equal(d.budgetCategories.find(c => c.name === "Meat Stall").createdFrom, "history");
  assert.equal(names.filter(n => n === "Groceries").length, 1);
});

test("migration learns price records from receipts — exact, sourced, never invented", () => {
  const d = M.migrate(v1Data()).data;
  // RC1: rice + milk (blank name and null price skipped); RC2: rice + towels (VAT/discount skipped)
  assert.equal(d.priceRecords.length, 4);
  assert.equal(d.products.length, 3);
  const rice = d.products.find(p => p.name === "Jasmine Rice 5kg");
  assert.equal(rice.size, 5); assert.equal(rice.unit, "kg"); assert.equal(rice.sizeSource, "read_from_name"); assert.equal(rice.createdFrom, "receipt");
  const riceRecs = d.priceRecords.filter(p => p.productId === rice.id);
  assert.equal(riceRecs.length, 2);
  assert.ok(d.priceRecords.every(p => p.source === "receipt" && p.status === "confirmed" && p.sourceRef.type === "receipt"));
  const landers = riceRecs.find(p => p.sourceRef.id === "RC1");
  assert.equal(landers.storeId, "store_landers");   // alias "landers superstore"
  assert.equal(landers.date, "2026-09-10");
  const snr = riceRecs.find(p => p.sourceRef.id === "RC2");
  assert.equal(snr.storeId, "store_snr");
  const milk = d.priceRecords.find(p => p.itemName === "Fresh Milk 1L");
  assert.equal(milk.qty, 2); assert.equal(milk.price, 190);
});

test("priceRecordsFromReceipt is idempotent", () => {
  const d = M.migrate(v1Data()).data;
  const n = d.priceRecords.length;
  const again = M.priceRecordsFromReceipt(d, d.receipts[0]);
  assert.deepEqual([again.products, again.priceRecords], [0, 0]);
  assert.equal(d.priceRecords.length, n);
});

test("migrate is a no-op on current data and safe on future data", () => {
  const d = M.migrate(v1Data()).data;
  const r = M.migrate(d);
  assert.equal(r.migrated, false); assert.equal(r.valid, true);
  assert.equal(r.data.meta.migrations.length, 1);
  const fut = M.migrate({ schemaVersion: 99, requests: [], receipts: [], futureThing: 1 });
  assert.equal(fut.futureVersion, true); assert.equal(fut.data.futureThing, 1); assert.equal(fut.migrated, false);
});

test("migrate tolerates empty / garbage input", () => {
  for (const x of [null, undefined, 5, "x", {}, { requests: "nope", receipts: null }]) {
    const r = M.migrate(x);
    assert.equal(r.valid, true);
    assert.equal(r.data.schemaVersion, M.SCHEMA_VERSION);
    assert.equal(r.data.stores.length, 7);
  }
});

test("matching: exact store aliases, never fuzzy-merges products", () => {
  const d = M.createEmpty();
  assert.equal(M.findStoreByName(d.stores, "S and R").id, "store_snr");
  assert.equal(M.findStoreByName(d.stores, "PUREGOLD").id, "store_puregold");
  assert.equal(M.findStoreByName(d.stores, "Puregold Duty Free Clark").id, "store_dutyfree");
  assert.equal(M.findStoreByName(d.stores, "Pure"), null);
  assert.equal(M.findStoreByName(d.stores, ""), null);
  const a = M.makeProduct({ name: "Coke", size: 1.5, unit: "l" }, "t");
  const b = M.makeProduct({ name: "Coke", size: 330, unit: "ml" }, "t");
  const c = M.makeProduct({ name: "Coke Zero", size: 1.5, unit: "liters" }, "t");
  assert.notEqual(M.productKey(a), M.productKey(b));
  assert.notEqual(M.productKey(a), M.productKey(c));
  assert.equal(M.productKey(a), M.productKey(M.makeProduct({ name: " coke ", size: "1.5", unit: "L" }, "t")));
  d.products.push(c);
  assert.equal(M.findProductByName(d.products, "Coke"), null, "Coke ≠ Coke Zero");
  assert.equal(M.makeProduct({ name: "x", size: 0, packCount: 1 }, "t").size, null);
});

test("integrityCheck finds real problems and reports reconciliation as info", () => {
  const d = M.migrate(v1Data()).data;
  let r = M.integrityCheck(d, { recordedSpent: 12345.5 });
  assert.equal(r.ok, true, JSON.stringify(r.issues));
  r = M.integrityCheck(d, { recordedSpent: 5000 });
  assert.equal(r.ok, true);
  assert.ok(r.issues.some(i => i.level === "info" && i.code === "spent_unreconciled"));
  const bad = M.clone(d);
  bad.manual.push(Object.assign({}, bad.manual[0]));                 // duplicate id
  bad.priceRecords[0].productId = "prod_missing";
  bad.priceRecords[1].source = "";
  bad.commitments.push({ id: "c1", status: "weird", amount: -5 });
  bad.memberGroups[0].count = 1.5;
  bad.spent = -1;
  r = M.integrityCheck(bad);
  assert.equal(r.ok, false);
  const codes = r.issues.map(i => i.code);
  for (const c of ["duplicate_id", "broken_link", "no_source", "bad_status", "bad_amount", "bad_count", "negative"]) assert.ok(codes.includes(c), c);
  assert.equal(M.integrityCheck(null).ok, false);
});

test("backup envelope: v1-compatible, counts, checksum, data last", () => {
  const d = M.migrate(v1Data()).data;
  const text = M.makeBackup(d, { voiceSettings: { lang: "fil", speak: false } });
  const p = JSON.parse(text);
  assert.equal(p.app, "Jason Shop"); assert.equal(p.type, "backup"); assert.equal(p.version, 1);
  assert.equal(p.format, 2); assert.equal(p.schemaVersion, M.SCHEMA_VERSION); assert.equal(p.appVersion, M.APP_VERSION);
  assert.ok(p.backupId); assert.equal(p.counts.receipts, 3); assert.equal(p.checksum.algo, "fnv1a32");
  assert.equal(Object.keys(p).pop(), "data");
  assert.equal(p.voiceSettings.lang, "fil");
  const r = M.readBackup(text);
  assert.equal(r.ok, true); assert.equal(r.checksumOk, true); assert.equal(r.migratedFrom, null);
  assert.equal(r.data.priceRecords.length, d.priceRecords.length);
});

test("readBackup: old v1 backups, damaged, edited, wrong and newer files", () => {
  // backup made by the pre-Stage-1 app
  const old = JSON.stringify({ app: "Jason Shop", type: "backup", version: 1, exportedAt: "2026-09-30T00:00:00Z", data: v1Data() });
  let r = M.readBackup(old);
  assert.equal(r.ok, true); assert.equal(r.checksumOk, null); assert.equal(r.migratedFrom, 1);
  assert.equal(r.data.schemaVersion, M.SCHEMA_VERSION); assert.equal(r.data.priceRecords.length, 4);
  assert.equal(M.readBackup("not json").error, "not_backup");
  assert.equal(M.readBackup(JSON.stringify({ app: "Other", data: { requests: [], receipts: [] } })).error, "not_backup");
  assert.equal(M.readBackup(JSON.stringify({ app: "Jason Shop", data: { requests: [] } })).error, "not_backup");
  const d = M.createEmpty(); d.schemaVersion = 9;
  assert.equal(M.readBackup(JSON.stringify({ app: "Jason Shop", data: d })).error, "newer_version");
  // edited after export: checksum mismatch is reported (app asks before restoring)
  const good = JSON.parse(M.makeBackup(M.migrate(v1Data()).data));
  good.data.fund = 1;
  r = M.readBackup(JSON.stringify(good));
  assert.equal(r.ok, true); assert.equal(r.checksumOk, false);
  // records removed but counts header kept → refused
  const cut = JSON.parse(M.makeBackup(M.migrate(v1Data()).data));
  cut.data.receipts.pop();
  r = M.readBackup(JSON.stringify(cut));
  assert.equal(r.ok, false); assert.equal(r.error, "counts_mismatch");
});

test("checksum is stable and sensitive", () => {
  assert.equal(M.checksum("abc"), M.checksum("abc"));
  assert.notEqual(M.checksum("abc"), M.checksum("abd"));
  assert.match(M.checksum(""), /^[0-9a-f]{8}$/);
});
