const http = require("http");
const realFetch = globalThis.fetch;
let scenario = { product: "photo", receipt: "clear", research: "ok" };
const seen = [];
http.createServer((req, res) => {           // control port for tests
  if (req.url.startsWith("/set?")) { const q = new URLSearchParams(req.url.slice(5)); for (const [k, v] of q) scenario[k] = v; }
  if (req.url.startsWith("/seen")) { res.end(JSON.stringify(seen)); return; }
  if (req.url.startsWith("/clear")) seen.length = 0;
  res.end(JSON.stringify(scenario));
}).listen(3999);
function jpegSize(buf) { // read SOF marker for width/height
  let i = 2; while (i < buf.length) { if (buf[i] !== 0xFF) { i++; continue; } const m = buf[i+1]; const len = buf.readUInt16BE(i+2);
    if (m >= 0xC0 && m <= 0xC3) return { h: buf.readUInt16BE(i+5), w: buf.readUInt16BE(i+7) }; i += 2 + len; } return null; }
const J = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "Content-Type": "application/json" } });
const shape = (text, model) => ({ id: "resp_x", object: "response", status: "completed", model, output: [{ type: "reasoning", id: "rs_1", summary: [] }, { type: "message", role: "assistant", content: [{ type: "output_text", annotations: [], text }] }], usage: { output_tokens: 900 } });
const L0 = { found: false, platform: null, title: null, price_php: null, original_price_php: null, seller: null, rating: null, sold: null, shipping: null };
const PRODUCTS = {
  photo: { is_product: true, image_kind: "product_photo", product_name: "Hanabishi HSF-16 16-inch Stand Fan", brand: "Hanabishi", model: "HSF-16", product_type: "Stand fan", key_specs: ["16-inch blades", "3 speeds", "Oscillating"], search_query: "Hanabishi HSF-16 stand fan", listing: L0, confidence: "high", notes: "", category: "Electronics & Appliances" },
  screenshot: { is_product: true, image_kind: "shop_screenshot", product_name: "Hanabishi 16\" Stand Fan HSF-16", brand: "Hanabishi", model: "HSF-16", product_type: "Stand fan", key_specs: ["16-inch", "3-speed"], search_query: "Hanabishi HSF-16", listing: { found: true, platform: "Shopee", title: "Hanabishi 16\" Stand Fan HSF-16 3-Speed", price_php: 1899, original_price_php: 2499, seller: "Hanabishi Official Store", rating: "4.8", sold: "10k+", shipping: "Free shipping" }, confidence: "high", notes: "" },
  none: { is_product: false, image_kind: "other", product_name: "", brand: null, model: null, product_type: null, key_specs: [], search_query: "", listing: L0, confidence: "low", notes: "Landscape photo, no product visible." },
  lowconf: { is_product: true, image_kind: "product_photo", product_name: "Electric fan", brand: null, model: null, product_type: "Fan", key_specs: [], search_query: "electric fan", listing: L0, confidence: "low", notes: "" }
};
const RC = (o) => Object.assign({ category: "Groceries", is_receipt: true, readability: "clear", store: "SM Supermarket", branch: "SM City Clark, Angeles City", date: "2026-10-05", time: "14:32", items: [{ name: "Hanabishi Stand Fan 16in", qty: 1, unit_price: 1899, line_total: 1899 }, { name: "Mineral Water 6x1L", qty: 2, unit_price: 90, line_total: 180 }, { name: "Rice Jasmine 5kg", qty: 1, unit_price: 345, line_total: 345 }], subtotal: 2424, vat: 259.71, discount: null, service_charge: null, total: 2424, currency: "PHP", payment_method: "Cash", receipt_number: "004512", problems: "" }, o);
const RECEIPTS = {
  clear: RC({}),
  blurry: RC({ readability: "unreadable", store: null, items: [], subtotal: null, vat: null, total: null, payment_method: null, problems: "Image is very blurry" }),
  notreceipt: RC({ is_receipt: false, readability: "clear", store: null, items: [], subtotal: null, vat: null, total: null, payment_method: null, problems: "This is a landscape photo" }),
  partly: RC({ readability: "partly_readable", total: 2600, subtotal: null, problems: "Bottom edge is cut off" })
};
globalThis.fetch = async (url, opts) => {
  if (String(url).startsWith("https://api.openai.com/v1/responses")) {
    const b = JSON.parse(opts.body);
    if (Array.isArray(b.input)) {
      const parts = b.input[0].content; const img = parts.find(p => p.type === "input_image"); const txt = parts.find(p => p.type === "input_text").text;
      const kind = /receipt/i.test(txt.slice(0, 40)) ? "receipt" : "product";
      const m = img.image_url.match(/^data:([^;]+);base64,(.*)$/); const buf = Buffer.from(m[2], "base64");
      const rec = { kind, model: b.model, format: b.text && b.text.format && b.text.format.type, strict: b.text && b.text.format && b.text.format.strict, detail: img.detail, mime: m[1], bytes: buf.length, dims: m[1] === "image/jpeg" ? jpegSize(buf) : null, reasoning: b.reasoning, tools: b.tools, max: b.max_output_tokens };
      seen.push(rec); console.log("MOCK vision", JSON.stringify(rec));
      await new Promise(r => setTimeout(r, 600));
      const sc = scenario[kind];
      if (sc === "modelbad" && b.model === "gpt-5.6") return J({ error: { message: "The model `gpt-5.6` does not exist", code: "model_not_found", param: null } }, 404);
      if (sc === "schemabad" && b.text.format.type === "json_schema") return J({ error: { message: "Invalid schema for response_format 'product': ...", param: "text.format.schema", code: "invalid_json_schema" } }, 400);
      if (sc === "imagebad") return J({ error: { message: "Invalid image.", param: null, code: "invalid_image" } }, 400);
      if (sc === "garbage") return J(shape("Sorry, I can't help with that.", b.model));
      const data = kind === "receipt" ? RECEIPTS[sc === "schemabad" || sc === "modelbad" ? "clear" : sc] : PRODUCTS[sc === "schemabad" || sc === "modelbad" ? "photo" : sc];
      const text = sc === "schemabad" ? "Here is the JSON:\n```json\n" + JSON.stringify(data, null, 1) + "\n```" : JSON.stringify(data);
      return J(shape(text, b.model));
    }
    if (b.input.startsWith("You are Jason Shop, Jason's personal shopping manager")) {
      seen.push({ kind: "summary", input: b.input, model: b.model, tools: b.tools, max: b.max_output_tokens });
      await new Promise(r => setTimeout(r, 300));
      return J(shape("You spent **₱5,523** in October 2026, about 28% of your ₱20,000 fund and ₱1,523 more than September. Groceries was your biggest category at ₱3,424. Consider bulk-buying staples at Landers to bring that down.", b.model));
    }
    seen.push({ kind: "research", query: b.input, model: b.model, tools: b.tools });
    await new Promise(r => setTimeout(r, 400));
    if (scenario.research === "offers") {   // Stage 3: OFFER lines + web citations
      const text = "## Best Overall\n**Hanabishi HSF-16** – ₱1,799 at Lazada.\n" +
        "OFFER: Hanabishi HSF-16 Stand Fan | 1799 | Hanabishi Official Store (Lazada) | https://www.lazada.com.ph/products/hanabishi-hsf-16-i123.html | verified\n" +
        "OFFER: Hanabishi HSF-16 Stand Fan | 1,899 | Shopee seller fanhub | https://shopee.ph/hanabishi-hsf16-i.55.66 | verified\n" +
        "OFFER: Asahi EF-16 Stand Fan | 1650 | Unknown | none | estimate\n" +
        "OFFER: Imarflex 16in fan | unknown | Reddit thread | https://www.reddit.com/r/Philippines/comments/x1 | estimate\n" +
        "Recommendation: BUY\nCATEGORY: Electronics & Appliances\n\nVOICE SUMMARY: The Hanabishi HSF-16 is 1,799 pesos at Lazada. My call is BUY.";
      const out = shape(text, b.model);
      out.output[1].content[0].annotations = [
        { type: "url_citation", url: "https://www.lazada.com.ph/products/hanabishi-hsf-16-i123.html?utm_source=openai", title: "Hanabishi HSF-16 | Lazada PH", start_index: 0, end_index: 10 },
        { type: "url_citation", url: "https://shopee.ph/hanabishi-hsf16-i.55.66", title: "Hanabishi 16in fan – Shopee", start_index: 0, end_index: 10 },
        { type: "url_citation", url: "https://www.lazada.com.ph/products/hanabishi-hsf-16-i123.html", title: "dup", start_index: 0, end_index: 10 },
        { type: "url_citation", url: "https://www.reddit.com/r/Philippines/comments/x1", title: "Best stand fan? : r/Philippines", start_index: 0, end_index: 10 }
      ];
      return J(out);
    }
    return J(shape("## Best Overall\n**Hanabishi HSF-16** – ₱1,799 at Lazada (cheaper than the ₱1,899 Shopee listing).\nRecommendation: BUY\nCATEGORY: Electronics & Appliances\n\nVOICE SUMMARY: The Hanabishi HSF-16 is 1,799 pesos at Lazada, a bit cheaper than your Shopee listing. My call is BUY.", b.model));
  }
  return realFetch(url, opts);
};
require(require("path").join(__dirname, "..", "..", "server.js"));
