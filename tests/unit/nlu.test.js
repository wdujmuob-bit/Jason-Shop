// Unit tests for js/nlu.js — English, Filipino and Taglish commands.
const test = require("node:test");
const assert = require("node:assert/strict");
const N = require("../../js/nlu.js");
const pick = (r) => r && { intent: r.intent, item: r.item, qty: r.qty, unit: r.unit };

test("stock and list commands in Taglish", () => {
  assert.deepEqual(pick(N.parse("ubos na yung bigas")), { intent: "out_of", item: "rice", qty: null, unit: null });
  assert.deepEqual(pick(N.parse("Wala na kaming itlog")), { intent: "out_of", item: "eggs", qty: null, unit: null });
  assert.deepEqual(pick(N.parse("we're out of dish soap")), { intent: "out_of", item: "dish soap", qty: null, unit: null });
  assert.deepEqual(pick(N.parse("add 2 kilo rice")), { intent: "add_to_list", item: "rice", qty: 2, unit: "kg" });
  assert.deepEqual(pick(N.parse("pakidagdag ng dalawang kilo bigas sa lista")), { intent: "add_to_list", item: "rice", qty: 2, unit: "kg" });
  assert.deepEqual(pick(N.parse("add isang dosena itlog")), { intent: "add_to_list", item: "eggs", qty: 12, unit: "pcs" });
  assert.deepEqual(pick(N.parse("bili tayo ng sardinas")), { intent: "add_to_list", item: "sardines", qty: null, unit: null });
  assert.deepEqual(pick(N.parse("nagamit ko 3 itlog")), { intent: "used", item: "eggs", qty: 3, unit: null });
  assert.deepEqual(pick(N.parse("bumili ako ng 5 kilo bigas")), { intent: "restock", item: "rice", qty: 5, unit: "kg" });
  const rm = N.parse("tanggalin ang itlog sa lista");
  assert.equal(rm.intent, "remove_from_list");
  assert.equal(rm.destructive, true);
});

test("money questions and actions", () => {
  assert.equal(N.parse("magkano natitira").intent, "budget_left");
  assert.equal(N.parse("how much is left?").intent, "budget_left");
  assert.equal(N.parse("can I afford ₱40k?").amount, 40000);
  assert.equal(N.parse("kaya ko ba 5000").intent, "afford");
  const sp = N.parse("gumastos ako ng 500 sa jollibee");
  assert.deepEqual([sp.intent, sp.amount, sp.store, sp.money], ["spent", 500, "jollibee", true]);
  assert.equal(N.parse("magkano ang bigas").intent, "price_of");
  assert.equal(N.parse("magkano ang bigas").item, "rice");
  assert.equal(N.parse("saan mura ang bigas").intent, "where_buy");
  assert.equal(N.parse("should i buy rice").intent, "buy_advice");
  assert.equal(N.parse("plan my trip cheapest").mode, "cheapest");
  assert.equal(N.parse("forecast").intent, "forecast");
  assert.equal(N.parse("what is low").intent, "what_low");
  assert.equal(N.parse("kailangan ko ba ng gatas").item, "milk");
});

test("follow-ups use shared context; confirmations", () => {
  const ctx = { lastIntent: "where_buy", lastItem: "rice", lastUnit: "kg" };
  assert.deepEqual(pick(N.parse("add 2 more", ctx)), { intent: "add_to_list", item: "rice", qty: 2, unit: "kg" });
  assert.equal(N.parse("isa pa", ctx).qty, 1);
  assert.deepEqual(pick(N.parse("eh yung gatas", ctx)), { intent: "where_buy", item: "milk", qty: null, unit: null });
  assert.equal(N.parse("where?", ctx).item, "rice");
  assert.equal(N.parse("add it", ctx).item, "rice");
  assert.equal(N.parse("add it"), null);                 // no context → not understood locally
  assert.equal(N.parse("oo").intent, "confirm");
  assert.equal(N.parse("sige").intent, "confirm");
  assert.equal(N.parse("huwag").intent, "cancel");
});

test("open-ended requests are left for AI research", () => {
  for (const q of ["Find me the best air fryer under 5,000 pesos", "best air fryer", "best air fryer under 5000 pesos", "buy a laptop", "which phone is better", "", "   "]) assert.equal(N.parse(q), null, q);
});

test("translate and amounts", () => {
  assert.equal(N.translate("bigas"), "rice");
  assert.equal(N.translate("sabong panlaba"), "laundry detergent");
  assert.equal(N.translate("brown bigas"), "brown rice");
  assert.equal(N.parseAmount(N.norm("₱1,500")), 1500);
  assert.equal(N.parseAmount("5k"), 5000);
});

test("where/price questions keep the whole item word (no prefix eating)", () => {
  assert.equal(N.parse("where should I buy rice").item, "rice");
  assert.equal(N.parse("saan ako bibili ng itlog").item, "eggs");
  assert.equal(N.parse("where can I get cooking oil cheapest").item, "cooking oil");
  assert.equal(N.parse("how much apples").item.indexOf("apple"), 0);
  assert.equal(N.parse("should I buy the tissue now").item, "tissue");
});
