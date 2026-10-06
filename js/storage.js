/* =====================================================================
   JASON SHOP — ON-DEVICE STORAGE
   Main data: localStorage "JasonShopData" (unchanged key, synchronous,
   so every existing feature keeps working).
   Safety snapshots (before migrations / restores, or on request):
   IndexedDB "JasonShopVault" — a separate, larger store, so snapshots
   don't eat the ~5 MB localStorage quota. Snapshots are never deleted
   automatically.
   ===================================================================== */
(function (root) {
  "use strict";

  var DB_NAME = "JasonShopVault";
  var DB_VERSION = 1;
  var dbPromise = null;

  function openDB() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise(function (resolve, reject) {
      if (!root.indexedDB) { reject(new Error("IndexedDB not available")); return; }
      var req = root.indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains("snapshots")) {
          var s = db.createObjectStore("snapshots", { keyPath: "id" });
          s.createIndex("at", "at");
        }
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error || new Error("IndexedDB open failed")); };
      req.onblocked = function () { reject(new Error("IndexedDB blocked")); };
    });
    dbPromise.catch(function () { dbPromise = null; });
    return dbPromise;
  }

  function tx(mode, fn) {
    return openDB().then(function (db) {
      return new Promise(function (resolve, reject) {
        var t = db.transaction("snapshots", mode);
        var store = t.objectStore("snapshots");
        var result;
        Promise.resolve(fn(store, function (r) { result = r; })).catch(reject);
        t.oncomplete = function () { resolve(result); };
        t.onerror = function () { reject(t.error || new Error("IndexedDB write failed")); };
        t.onabort = function () { reject(t.error || new Error("IndexedDB aborted")); };
      });
    });
  }

  // snapshot: { reason, json, schemaVersion, counts } → resolves with the saved id
  function putSnapshot(snap) {
    var rec = {
      id: "snap_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      at: new Date().toISOString(),
      reason: snap.reason || "manual",
      schemaVersion: snap.schemaVersion || null,
      counts: snap.counts || null,
      bytes: (snap.json || "").length,
      json: snap.json || ""
    };
    return tx("readwrite", function (store) { store.put(rec); }).then(function () { return rec.id; });
  }

  // newest first, without the (large) json
  function listSnapshots() {
    return tx("readonly", function (store, done) {
      var out = [];
      var req = store.openCursor();
      req.onsuccess = function () {
        var c = req.result;
        if (c) { var v = c.value; out.push({ id: v.id, at: v.at, reason: v.reason, schemaVersion: v.schemaVersion, counts: v.counts, bytes: v.bytes }); c.continue(); }
        else done(out.sort(function (a, b) { return String(b.at).localeCompare(String(a.at)); }));
      };
    });
  }

  function getSnapshot(id) {
    return tx("readonly", function (store, done) {
      var req = store.get(id);
      req.onsuccess = function () { done(req.result || null); };
    });
  }

  function localStorageBytes() {
    var total = 0;
    try {
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        total += (k.length + (localStorage.getItem(k) || "").length) * 2; // UTF-16
      }
    } catch (e) { /* ignore */ }
    return total;
  }

  function estimate() {
    var out = { localStorageBytes: localStorageBytes(), localStorageQuota: 5 * 1024 * 1024 * 2, usage: null, quota: null, persisted: null };
    var tasks = [];
    if (root.navigator && navigator.storage && navigator.storage.estimate) {
      tasks.push(navigator.storage.estimate().then(function (e) { out.usage = e.usage; out.quota = e.quota; }).catch(function () {}));
    }
    if (root.navigator && navigator.storage && navigator.storage.persisted) {
      tasks.push(navigator.storage.persisted().then(function (p) { out.persisted = p; }).catch(function () {}));
    }
    return Promise.all(tasks).then(function () { return out; });
  }

  // Ask the browser not to clear Jason Shop's storage when the phone is low on space.
  function requestPersistence() {
    if (root.navigator && navigator.storage && navigator.storage.persist) {
      return navigator.storage.persist().catch(function () { return false; });
    }
    return Promise.resolve(false);
  }

  root.JasonStore = {
    putSnapshot: putSnapshot, listSnapshots: listSnapshots, getSnapshot: getSnapshot,
    estimate: estimate, requestPersistence: requestPersistence, localStorageBytes: localStorageBytes
  };
}(typeof self !== "undefined" ? self : this));
