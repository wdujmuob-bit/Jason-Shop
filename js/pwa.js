/* Progressive Web App helpers: service worker + one-time Home-screen tip.
   Loaded last. Never touches money or data. Safe on http (skips SW). */
(function () {
  "use strict";

  var TIP_KEY = "JasonShopInstallTipDismissed";

  function isStandalone() {
    try {
      if (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) return true;
      if (window.matchMedia && window.matchMedia("(display-mode: fullscreen)").matches) return true;
      if (typeof navigator !== "undefined" && navigator.standalone === true) return true; // iOS Safari
    } catch (e) {}
    return false;
  }

  function isMobileish() {
    try {
      if (window.matchMedia && window.matchMedia("(pointer: coarse)").matches) return true;
      if (/Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || "")) return true;
    } catch (e) {}
    return false;
  }

  function canRegisterSW() {
    if (!("serviceWorker" in navigator)) return false;
    var h = location.hostname;
    return location.protocol === "https:" || h === "localhost" || h === "127.0.0.1";
  }

  function registerSW() {
    if (!canRegisterSW()) return;
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(function (err) {
      console.warn("Jason Shop: service worker not registered", err && err.message);
    });
  }

  function howText() {
    var ua = navigator.userAgent || "";
    if (/Android/i.test(ua)) {
      return "On Samsung Chrome or Samsung Internet:\n\n1. Tap the ⋮ menu (top right).\n2. Tap “Add to Home screen” or “Install app”.\n3. Confirm. Jason Shop opens full-screen from the new icon — no address bar.";
    }
    if (/iPhone|iPad|iPod/i.test(ua)) {
      return "On iPhone Safari:\n\n1. Tap the Share button.\n2. Tap “Add to Home Screen”.\n3. Tap Add. Open from the new icon for full-screen.";
    }
    return "In Chrome: open the browser menu → “Install app” or “Add to Home screen”. Open from the new icon for a full-screen app with no address bar.";
  }

  function showTip() {
    var banner = document.getElementById("installBanner");
    if (!banner) return;
    if (isStandalone()) return;                         // already an installed app
    if (!isMobileish()) return;                         // desktop: Install is in the address bar
    if (navigator.webdriver) return;                    // headless / automated tests — don't nag the suites
    try { if (localStorage.getItem(TIP_KEY) === "1") return; } catch (e) { return; }
    banner.classList.remove("hidden");
    var how = document.getElementById("installHowBtn");
    var dismiss = document.getElementById("installDismissBtn");
    if (how) how.onclick = function () {
      if (typeof toast === "function") toast("📲 " + howText().replace(/\n+/g, " · "));
      else alert(howText());
    };
    if (dismiss) dismiss.onclick = function () {
      try { localStorage.setItem(TIP_KEY, "1"); } catch (e) {}
      banner.classList.add("hidden");
    };
  }

  // Dark status-bar / no white flash: mark when running as installed app.
  function markStandalone() {
    if (isStandalone()) document.documentElement.classList.add("standalone");
    document.documentElement.classList.add("pwa-ready");
  }

  function boot() {
    markStandalone();
    registerSW();
    // After the rest of the app paints, so we don't fight the upgrade banner.
    setTimeout(showTip, 1200);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
