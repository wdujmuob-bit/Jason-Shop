/*
  Stage 1 moved the screens into tabs (Home · Shop · Inventory · Budget · AI · More).
  The pre-Stage-1 suites were written for one long scrolling page, where every
  control was always on screen. This shim keeps those suites UNCHANGED in what
  they check: before a test touches an element by selector, it asks the app to
  show the tab that contains it (window.revealElement), exactly like Jason
  tapping that tab first. Nothing is clicked or filled in for the test.
*/
const CHROME = process.env.CHROME_PATH || "/usr/bin/google-chrome";

function patchPage(page) {
  if (page.__revealPatched) return page;
  page.__revealPatched = true;
  const reveal = sel => typeof sel !== "string" ? Promise.resolve() :
    page.evaluate(s => { try { window.revealElement && window.revealElement(s); } catch (e) { } }, sel).catch(() => {});
  for (const m of ["click", "type", "focus", "tap", "hover", "select", "$", "waitForSelector"]) {
    const orig = page[m].bind(page);
    page[m] = async (sel, ...rest) => { await reveal(sel); return orig(sel, ...rest); };
  }
  return page;
}

module.exports = function revealShim(browser) {
  const orig = browser.newPage.bind(browser);
  browser.newPage = async (...a) => patchPage(await orig(...a));
  return browser;
};
module.exports.CHROME = CHROME;
