// Smoke tests for the installable PWA (manifest + icons + index wiring).
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { test } = require("node:test");

const ROOT = path.join(__dirname, "..", "..");

test("manifest.webmanifest is valid JSON with required install fields", () => {
  const raw = fs.readFileSync(path.join(ROOT, "manifest.webmanifest"), "utf8");
  const m = JSON.parse(raw);
  assert.equal(m.name, "Jason Shop");
  assert.equal(m.short_name, "Jason Shop");
  assert.equal(m.start_url, "/");
  assert.equal(m.display, "standalone");
  assert.equal(m.background_color, "#080c17");
  assert.equal(m.theme_color, "#080c17");
  assert.equal(m.orientation, "portrait-primary");
  assert.ok(Array.isArray(m.icons) && m.icons.length >= 2);
  const purposes = m.icons.map((i) => i.purpose).join(" ");
  assert.ok(purposes.includes("any"));
  assert.ok(purposes.includes("maskable"));
  const sizes = m.icons.map((i) => i.sizes);
  assert.ok(sizes.includes("192x192"));
  assert.ok(sizes.includes("512x512"));
  m.icons.forEach((i) => {
    const file = path.join(ROOT, i.src.replace(/^\//, ""));
    assert.ok(fs.existsSync(file), "missing icon " + i.src);
    assert.ok(fs.statSync(file).size > 200, "icon too small: " + i.src);
  });
});

test("index.html links the manifest, apple-touch-icon and theme-color; loads pwa.js", () => {
  const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  assert.ok(html.includes('rel="manifest"') && html.includes("manifest.webmanifest"));
  assert.ok(html.includes('rel="apple-touch-icon"') && html.includes("/icons/apple-touch-icon.png"));
  assert.ok(html.includes('name="theme-color"') && html.includes("#080c17"));
  assert.ok(html.includes('name="apple-mobile-web-app-capable"') && html.includes('content="yes"'));
  assert.ok(html.includes('name="apple-mobile-web-app-title"') && html.includes("Jason Shop"));
  assert.ok(html.includes("viewport-fit=cover"));
  assert.ok(html.includes("js/pwa.js"));
  assert.ok(html.includes('id="installBanner"'));
  assert.ok(fs.existsSync(path.join(ROOT, "icons", "apple-touch-icon.png")));
  assert.ok(fs.existsSync(path.join(ROOT, "sw.js")));
  assert.ok(fs.existsSync(path.join(ROOT, "js", "pwa.js")));
});

test("service worker caches the shell and leaves cross-origin API alone", () => {
  const sw = fs.readFileSync(path.join(ROOT, "sw.js"), "utf8");
  assert.ok(sw.includes("jason-shop-shell"));
  assert.ok(sw.includes("/index.html") && sw.includes("/css/app.css") && sw.includes("/js/app.js"));
  assert.ok(sw.includes("/js/pwa.js") && sw.includes("/manifest.webmanifest"));
  assert.ok(sw.includes("url.origin !== self.location.origin"));
  assert.ok(/req\.method !== "GET"/.test(sw));
});
