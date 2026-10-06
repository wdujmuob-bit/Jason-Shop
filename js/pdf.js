/* Jason Shop — tiny PDF writer (no libraries, no CDN).
   Builds a real, multi-page A4 PDF with Helvetica text, simple tables and
   bar rows. Fonts are the PDF built-ins (WinAnsi), so the peso sign is
   written as "PHP" and emoji are dropped. Works in browsers and Node. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.JasonPDF = factory();
}(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var W = 595, H = 842, M = 42;

  // Make text safe for a WinAnsi built-in font.
  function clean(text) {
    return String(text === null || text === undefined ? "" : text)
      .replace(/₱\s?/g, "PHP ")
      .replace(/[−–—]/g, "-")
      .replace(/[‘’]/g, "'").replace(/[“”]/g, '"')
      .replace(/…/g, "...").replace(/[→]/g, "->").replace(/[×]/g, "x")
      .replace(/[•·]/g, "-")
      .replace(/[^\x20-\x7E\xA0-\xFF]/g, "")
      .replace(/\s+/g, " ").trim();
  }
  function esc(text) { return clean(text).replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)"); }
  // Rough Helvetica width (points) — good enough for wrapping/truncation.
  function width(text, size) {
    var w = 0, s = clean(text);
    for (var i = 0; i < s.length; i++) {
      var c = s[i];
      w += /[il.,:;'|!]/.test(c) ? 0.28 : /[mwMW@]/.test(c) ? 0.85 : /[A-Z0-9]/.test(c) ? 0.66 : c === " " ? 0.28 : 0.52;
    }
    return w * size;
  }
  function wrap(text, size, maxW) {
    var words = clean(text).split(" "), lines = [], cur = "";
    words.forEach(function (w) {
      var t = cur ? cur + " " + w : w;
      if (width(t, size) > maxW && cur) { lines.push(cur); cur = w; } else cur = t;
    });
    if (cur) lines.push(cur);
    return lines.length ? lines : [""];
  }
  function fit(text, size, maxW) {
    var s = clean(text);
    if (width(s, size) <= maxW) return s;
    while (s.length > 1 && width(s + "...", size) > maxW) s = s.slice(0, -1);
    return s + "...";
  }
  function n2(v) { return (Math.round(v * 100) / 100).toString(); }

  // doc: {title, subtitle, sections:[{heading, lines:[], table:{columns:[{label, width, align}], rows:[[...]]}, bars:[{label, value, text}]}], footer}
  function build(doc) {
    var pages = [], ops = null, y = 0;
    function newPage() { ops = []; pages.push(ops); y = H - M; }
    function ensure(h) { if (y - h < M + 20) newPage(); }
    function text(x, yy, s, size, bold, gray) {
      ops.push((gray ? "0.4 0.4 0.4 rg " : "0 0 0 rg ") + "BT /" + (bold ? "F2" : "F1") + " " + size + " Tf " + n2(x) + " " + n2(yy) + " Td (" + esc(s) + ") Tj ET");
    }
    function rect(x, yy, w, h, g) { ops.push(g + " g " + n2(x) + " " + n2(yy) + " " + n2(w) + " " + n2(h) + " re f 0 g"); }
    newPage();
    text(M, y - 18, doc.title || "Report", 18, true); y -= 26;
    if (doc.subtitle) { wrap(doc.subtitle, 10, W - 2 * M).forEach(function (l) { text(M, y - 12, l, 10, false, true); y -= 14; }); }
    y -= 6;
    (doc.sections || []).forEach(function (sec) {
      ensure(40);
      if (sec.heading) { y -= 8; text(M, y - 13, sec.heading, 13, true); y -= 18; rect(M, y, W - 2 * M, 0.8, 0.75); y -= 6; }
      (sec.lines || []).forEach(function (line) {
        wrap(line, 10, W - 2 * M).forEach(function (l) { ensure(14); text(M, y - 11, l, 10); y -= 14; });
      });
      if (sec.bars && sec.bars.length) {
        var max = Math.max.apply(null, sec.bars.map(function (b) { return Number(b.value) || 0; }).concat([0.0001]));
        var labelW = 150, valW = 90, barW = W - 2 * M - labelW - valW - 10;
        sec.bars.forEach(function (b) {
          ensure(16);
          text(M, y - 11, fit(b.label, 9, labelW - 6), 9);
          rect(M + labelW, y - 11, Math.max(1, barW * Math.max(0, Number(b.value) || 0) / max), 9, 0.55);
          text(W - M - valW + 6, y - 11, fit(b.text !== undefined ? b.text : b.value, 9, valW - 6), 9);
          y -= 15;
        });
      }
      if (sec.table && sec.table.columns) {
        var cols = sec.table.columns, total = cols.reduce(function (s, c) { return s + (c.width || 1); }, 0), avail = W - 2 * M;
        var xs = [], x = M;
        cols.forEach(function (c) { xs.push(x); x += avail * (c.width || 1) / total; });
        var cellW = function (i) { return avail * (cols[i].width || 1) / total - 6; };
        var header = function () {
          ensure(18); rect(M, y - 14, avail, 16, 0.92);
          cols.forEach(function (c, i) { text(xs[i] + 3, y - 10, fit(c.label, 8.5, cellW(i)), 8.5, true); });
          y -= 18;
        };
        header();
        (sec.table.rows || []).forEach(function (row) {
          if (y - 14 < M + 20) { newPage(); header(); }
          row.forEach(function (cell, i) {
            if (i >= cols.length) return;
            var s = fit(cell, 8.5, cellW(i));
            var cx = cols[i].align === "right" ? xs[i] + 3 + cellW(i) - width(s, 8.5) : xs[i] + 3;
            text(cx, y - 10, s, 8.5);
          });
          y -= 13;
        });
        if (!(sec.table.rows || []).length) { text(M + 3, y - 10, sec.table.empty || "No data in this range.", 8.5, false, true); y -= 13; }
      }
      y -= 4;
    });
    // footers with page numbers
    pages.forEach(function (p, i) {
      ops = p;
      text(M, 24, (doc.footer || "Jason Shop") + " - page " + (i + 1) + " of " + pages.length, 8, false, true);
    });

    // assemble objects: 1 catalog, 2 pages, 3 F1, 4 F2, then page+content pairs
    var objs = [];
    objs[1] = "<< /Type /Catalog /Pages 2 0 R >>";
    var kids = pages.map(function (_, i) { return (5 + i * 2) + " 0 R"; }).join(" ");
    objs[2] = "<< /Type /Pages /Kids [" + kids + "] /Count " + pages.length + " >>";
    objs[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>";
    objs[4] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>";
    pages.forEach(function (p, i) {
      var content = p.join("\n");
      objs[5 + i * 2] = "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 " + W + " " + H + "] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents " + (6 + i * 2) + " 0 R >>";
      objs[6 + i * 2] = "<< /Length " + content.length + " >>\nstream\n" + content + "\nendstream";
    });
    var out = "%PDF-1.4\n%\xE2\xE3\xCF\xD3\n", offsets = [];
    for (var k = 1; k < objs.length; k++) { offsets[k] = out.length; out += k + " 0 obj\n" + objs[k] + "\nendobj\n"; }
    var xref = out.length;
    out += "xref\n0 " + objs.length + "\n0000000000 65535 f \n";
    for (k = 1; k < objs.length; k++) out += String(offsets[k]).padStart(10, "0") + " 00000 n \n";
    out += "trailer\n<< /Size " + objs.length + " /Root 1 0 R >>\nstartxref\n" + xref + "\n%%EOF\n";
    return out; // every char is 0–255: one byte each
  }
  function toBytes(str) {
    var b = new Uint8Array(str.length);
    for (var i = 0; i < str.length; i++) b[i] = str.charCodeAt(i) & 255;
    return b;
  }
  return { build: build, toBytes: toBytes, clean: clean, wrap: wrap };
}));
