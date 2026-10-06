// Unit tests for the Stage 4 model: v4 → v5 upgrade, people & roles (no login), household requests, preferences, search.
const test = require("node:test");
const assert = require("node:assert/strict");
const M = require("../../js/model.js");
const stage1 = require("../fixtures/stage1-snapshot.json").data;

function v4() {
  const r = M.migrate(JSON.parse(JSON.stringify(stage1))).data;
  r.schemaVersion = 4;
  ["people", "householdRequests", "planHistory", "forecastSnapshots"].forEach(k => delete r[k]);
  delete r.settings.preferences; delete r.settings.activePersonId;
  r.budgetPlan = { mode: "peso", items: [{ categoryId: r.budgetCategories[0].id, value: 1500 }], updatedAt: "2026-10-01T03:00:00.000Z" };
  return r;
}

test("schema v5: Stage 4 collections and constants", () => {
  assert.equal(M.SCHEMA_VERSION, 5);
  assert.match(M.APP_VERSION, /^5\./);
  ["people", "householdRequests", "planHistory", "forecastSnapshots"].forEach(k => assert.ok(M.COLLECTIONS.includes(k), k));
  assert.deepEqual(Object.keys(M.ROLES), ["owner", "adult", "staff", "child", "viewer"]);
  assert.ok(M.INSIGHT_RANGES["90d"] && M.START_VIEWS.home);
});

test("v4 → v5 upgrade is additive: owner person, plan history, preferences", () => {
  const src = v4();
  const before = JSON.parse(JSON.stringify(src));
  const r = M.migrate(src);
  assert.equal(r.steps.length, 1);
  assert.equal(r.data.schemaVersion, 5);
  // every existing record kept
  ["products", "priceRecords", "stores", "receipts", "manual", "budgetCategories", "recurring", "alerts"].forEach(k =>
    assert.equal(r.data[k].length, before[k].length, k));
  assert.equal(r.data.people.length, 1);
  const owner = r.data.people[0];
  assert.equal(owner.role, "owner"); assert.equal(owner.name, "Jason");
  assert.equal(owner.houseId, r.data.houses[0].id);
  assert.equal(r.data.settings.activePersonId, owner.id);
  assert.equal(r.data.planHistory.length, 1);
  assert.equal(r.data.planHistory[0].at, "2026-10-01T03:00:00.000Z");
  assert.equal(r.data.planHistory[0].items[0].value, 1500);
  assert.equal(r.data.planHistory[0].source, "upgrade");
  assert.deepEqual(r.data.settings.preferences.avoidStores, []);
  assert.equal(r.data.settings.preferences.startView, "home");
  assert.equal(r.data.settings.preferences.insightsRange, "90d");
  assert.equal(M.integrityCheck(r.data).errors, 0);
  assert.equal(M.migrate(r.data).steps.length, 0, "second run is a no-op");
});

test("no plan → no plan history; existing people are kept", () => {
  const src = v4(); src.budgetPlan.items = [];
  src.people = [M.makePerson({ name: "Ana", role: "owner" }, "2026-10-01T00:00:00Z")];
  const r = M.migrate(src);
  assert.equal(r.data.planHistory.length, 0);
  assert.equal(r.data.people.length, 1); assert.equal(r.data.people[0].name, "Ana");
  assert.equal(r.data.settings.activePersonId, r.data.people[0].id);
});

test("preferences are cleaned on load", () => {
  const d = M.migrate(v4()).data;
  d.settings.preferences = { avoidStores: ["s1", 5, null, "s2"], preferredBrands: "nope", startView: "hacker", insightsRange: "999d", notes: "x".repeat(900) };
  const r = M.migrate(d).data;
  const p = r.settings.preferences;
  assert.deepEqual(p.avoidStores, ["s1", "s2"]);
  assert.deepEqual(p.preferredBrands, []);
  assert.equal(p.startView, "home"); assert.equal(p.insightsRange, "90d");
  assert.equal(p.notes.length, 500);
});

test("roles guide the screens (no login): can()", () => {
  const at = "2026-10-01T00:00:00Z";
  const owner = M.makePerson({ name: "J", role: "owner" }, at), staff = M.makePerson({ name: "Maria", role: "staff" }, at);
  const child = M.makePerson({ name: "Kid", role: "child" }, at), weird = M.makePerson({ name: "", role: "admin" }, at);
  assert.ok(M.can(owner, "approve") && M.can(owner, "people"));
  assert.ok(M.can(staff, "request") && M.can(staff, "inventory") && !M.can(staff, "approve"));
  assert.ok(M.can(child, "request") && !M.can(child, "add_list"));
  assert.equal(weird.role, "viewer"); assert.equal(weird.name, "Person");
  assert.ok(!M.can(weird, "request"));
  assert.ok(!M.can({ ...owner, archived: true }, "view"));
  assert.ok(!M.can(null, "view"));
});

test("household requests keep their history and are integrity-checked", () => {
  const at = "2026-10-01T00:00:00Z";
  const r = M.makeHouseholdRequest({ title: "  Diapers  ", qty: "2", note: "size L", urgency: "urgent", requestedBy: "p1", requestedByName: "Maria" }, at);
  assert.equal(r.title, "Diapers"); assert.equal(r.qty, 2); assert.equal(r.urgency, "urgent"); assert.equal(r.status, "pending");
  assert.deepEqual(r.history, [{ status: "pending", at, by: "p1" }]);
  assert.match(r.id, /^hreq/);
  assert.equal(M.makeHouseholdRequest({ title: "x", qty: -3, urgency: "now!" }, at).qty, 1);
  const d = M.migrate(v4()).data;
  d.householdRequests.push(Object.assign(r, { requestedBy: d.people[0].id }));
  assert.equal(M.integrityCheck(d).errors, 0);
  d.householdRequests.push(Object.assign(M.makeHouseholdRequest({ title: "" }, at), { status: "weird" }));
  d.people.push(Object.assign(M.makePerson({ name: "X" }, at), { role: "boss" }));
  const codes = M.integrityCheck(d).issues.map(i => i.code);
  ["bad_status", "missing_title", "bad_role"].forEach(c => assert.ok(codes.includes(c), c));
  d.people.forEach(p => { if (p.role === "owner") p.archived = true; });
  assert.ok(M.integrityCheck(d).issues.some(i => i.code === "no_owner" && i.level === "warning"));
});

test("searchScore ranks exact > starts > word-starts > inside, and rejects non-matches", () => {
  assert.equal(M.searchScore("eggs", "Eggs"), 100);
  assert.equal(M.searchScore("egg", "Eggs tray"), 90);
  assert.equal(M.searchScore("eg tr", "Eggs tray"), 75);
  assert.equal(M.searchScore("ice", "Jasmine rice"), 55);
  assert.equal(M.searchScore("ic", "Jasmine rice"), 0);
  assert.equal(M.searchScore("milk", "Eggs"), 0);
  assert.equal(M.searchScore("", "Eggs"), 0);
});

test("searchScore tolerates one typo in words of 4+ letters, ranked below real matches", () => {
  assert.equal(M.searchScore("vitamns", "Vitamins"), 35);        // missing letter
  assert.equal(M.searchScore("vitamiins", "Vitamins"), 35);      // extra letter
  assert.equal(M.searchScore("jasmien", "Rice Jasmine 5kg"), 35); // swapped letters
  assert.equal(M.searchScore("puregild", "Puregold"), 35);       // wrong letter
  assert.equal(M.searchScore("jasm", "Rice Jasmine"), 75);       // real prefix still wins
  assert.equal(M.searchScore("rcie", "Rice"), 35);
  assert.equal(M.searchScore("ric", "Rice"), 90);
  assert.equal(M.searchScore("rixx", "Rice"), 0);                // two edits → no match
  assert.equal(M.searchScore("egs", "Eggs"), 0);                 // short words need a prefix ("egs" isn't one)
  assert.equal(M.searchScore("eggz tray", "Eggs tray"), 35);
  assert.equal(M.searchScore("eggz milk", "Eggs tray"), 0);      // every word must match
  assert.equal(M.searchScore("ricd", "Rice"), 35);
  assert.equal(M.searchScore("bice", "Rice"), 0);                // first letter must match
});
