/* =====================================================================
   JASON SHOP — natural commands (English, Filipino, Taglish)
   Pure and unit-tested. Turns "ubos na yung bigas", "add 2 kilo rice",
   "magkano natitira" into an intent; js/features3.js acts on it.
   Anything open-ended returns null → it goes to AI research as before.
   ===================================================================== */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.JasonNLU = factory();
}(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // Filipino → English item words (used to find inventory / Price Book items).
  var LEXICON = {
    "bigas": "rice", "itlog": "eggs", "gatas": "milk", "tinapay": "bread", "pandesal": "bread", "asukal": "sugar", "asin": "salt",
    "mantika": "cooking oil", "kape": "coffee", "sabon": "soap", "sabong panlaba": "laundry detergent", "panlaba": "laundry detergent",
    "toyo": "soy sauce", "suka": "vinegar", "patis": "fish sauce", "manok": "chicken", "baboy": "pork", "baka": "beef", "isda": "fish",
    "gulay": "vegetables", "prutas": "fruit", "tubig": "water", "sardinas": "sardines", "sibuyas": "onion", "bawang": "garlic",
    "kamatis": "tomatoes", "saging": "bananas", "lampin": "diapers", "sipilyo": "toothbrush", "harina": "flour", "keso": "cheese",
    "mantikilya": "butter", "pagkain ng aso": "dog food", "pagkain ng pusa": "cat food", "de lata": "canned goods", "uling": "charcoal",
    "papel": "paper", "kandila": "candles", "posporo": "matches", "pampalasa": "seasoning", "noodles": "noodles"
  };
  var UNITS = {
    kg: ["kg", "kgs", "kilo", "kilos", "kilogram", "kilograms", "k"], g: ["g", "gram", "grams", "gramo"], L: ["l", "liter", "liters", "litre", "litres", "litro"],
    ml: ["ml"], pcs: ["pc", "pcs", "piece", "pieces", "piraso", "pirasong", "pirasong"], pack: ["pack", "packs", "pakete", "pakete"], sachet: ["sachet", "sachets"],
    can: ["can", "cans", "lata"], bottle: ["bottle", "bottles", "bote"], tray: ["tray", "trays"], dozen: ["dozen", "dosena", "dosenang"], box: ["box", "boxes", "kahon"],
    roll: ["roll", "rolls"], sack: ["sack", "sacks", "sako"], bundle: ["bundle", "bundles", "tali"]
  };
  var UNIT_OF = {};
  Object.keys(UNITS).forEach(function (u) { UNITS[u].forEach(function (w) { UNIT_OF[w] = u; }); });
  var NUMBER_WORDS = {
    one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, a: 1, an: 1, another: 1,
    isa: 1, isang: 1, dalawa: 2, dalawang: 2, tatlo: 3, tatlong: 3, apat: 4, lima: 5, limang: 5, anim: 6, pito: 7, pitong: 7,
    walo: 8, walong: 8, siyam: 9, sampu: 10, sampung: 10, kalahati: 0.5, kalahating: 0.5, half: 0.5
  };
  var FILLER = ["po", "naman", "lang", "nga", "please", "pls", "paki", "pakisuyo", "yung", "iyong", "ang", "ng", "mga", "the", "some", "any", "more", "pa", "na",
    "namin", "natin", "ko", "mo", "kami", "tayo", "sa", "to", "my", "our", "list", "lista", "listahan", "shopping", "of", "ba", "eh", "e", "ha", "din", "rin", "kaming", "kami", "ako", "i", "we", "is", "are", "it", "now", "ngayon", "today", "yet", "already"];

  function norm(text) {
    return String(text || "").toLowerCase().replace(/₱/g, " php ").replace(/[“”"!?¿¡]/g, " ").replace(/[,](?=\d{3}\b)/g, "").replace(/[^a-z0-9ñ.\- ']/g, " ")
      .replace(/\s+/g, " ").trim();
  }

  function parseAmount(t) {
    var m = /(?:php|p)\s*(\d+(?:\.\d+)?)\s*(k)?\b|(\d+(?:\.\d+)?)\s*(k|pesos?|php)\b|\b(\d{2,}(?:\.\d+)?)\b/.exec(t);
    if (!m) return null;
    var v = parseFloat(m[1] || m[3] || m[5]);
    if ((m[2] || m[4]) === "k") v *= 1000;
    return v > 0 ? v : null;
  }

  // "2 kilo rice", "dalawang kilo bigas", "isang dosena itlog" → { qty, unit, rest }
  function takeQty(words) {
    var w = words.slice(), qty = null, unit = null;
    for (var i = 0; i < w.length; i++) {
      var x = w[i], n = null;
      if (/^\d+(\.\d+)?$/.test(x)) n = parseFloat(x);
      else if (/^\d+(\.\d+)?[a-z]+$/.test(x)) { var mm = /^(\d+(?:\.\d+)?)([a-z]+)$/.exec(x); if (UNIT_OF[mm[2]]) { n = parseFloat(mm[1]); unit = UNIT_OF[mm[2]]; } }
      else if (NUMBER_WORDS[x] !== undefined && (i + 1 < w.length) && !(x === "a" && w[i + 1] === "lot")) n = NUMBER_WORDS[x];
      if (n === null) continue;
      qty = n; w.splice(i, 1);
      if (w[i] === "na") w.splice(i, 1);                     // "apat na kilo"
      if (!unit && w[i] && UNIT_OF[w[i]] && !(w[i] === "k" && false)) { unit = UNIT_OF[w[i]]; w.splice(i, 1); }
      if (unit === "dozen") { qty = qty * 12; unit = "pcs"; }
      break;
    }
    return { qty: qty, unit: unit, rest: w };
  }

  function cleanItem(words) {
    var w = words.filter(function (x) { return x && FILLER.indexOf(x) < 0; });
    return w.join(" ").replace(/^(of|for)\s+/, "").trim();
  }

  // Filipino words → English (whole phrase first, then word by word).
  function translate(item) {
    var t = String(item || "").trim();
    if (!t) return "";
    if (LEXICON[t]) return LEXICON[t];
    var out = t;
    Object.keys(LEXICON).sort(function (a, b) { return b.length - a.length; }).forEach(function (k) {
      out = out.replace(new RegExp("\\b" + k + "\\b", "g"), LEXICON[k]);
    });
    return out;
  }

  function itemFrom(t, prefixRe) {
    var rest = prefixRe ? t.replace(prefixRe, " ") : t;
    var q = takeQty(rest.split(" ").filter(Boolean));
    var raw = cleanItem(q.rest);
    return { qty: q.qty, unit: q.unit, rawItem: raw, item: translate(raw) };
  }

  function modeFrom(t) {
    if (/pinakamura|cheapest|lowest price|mura lang/.test(t)) return "cheapest";
    if (/fastest|mabilis|quick|bilisan/.test(t)) return "fastest";
    if (/fewest|one stop|isang (tindahan|store|puntahan)|least stops/.test(t)) return "fewest";
    if (/balance/.test(t)) return "balance";
    return null;
  }

  var OPEN_ENDED = /\b(best|recommend|review|reviews|compare|vs|versus|which|top \d|budget phone|laptop|under (php|p)?\s*\d|specs?)\b/;

  /*
    parse(text, ctx) → { intent, item, rawItem, qty, unit, amount, store, mode, followUp, money, destructive } | null
    ctx: { lastIntent, lastItem, lastQty, lastUnit, pending }
  */
  function parse(text, ctx) {
    var c = ctx || {};
    var t = norm(text);
    if (!t) return null;
    var R = function (intent, extra) { return Object.assign({ intent: intent, text: String(text).trim(), followUp: false, money: false, destructive: false }, extra || {}); };

    // confirmations of a pending action
    if (/^(yes|yep|yeah|oo|opo|oo po|sige|sige na|go|go ahead|ok|okay|okey|game|tama|approve|confirm)$/.test(t)) return R("confirm");
    if (/^(no|nope|hindi|huwag|wag|cancel|ayaw|ayoko|stop|teka|wait lang|huwag na|wag na)$/.test(t)) return R("cancel");

    // money left / safe to spend
    if (/(magkano|how much).*(natitira|natira|left|remaining|pa (ang )?(pera|budget)|budget ko|pwede ko pang gastusin)|safe to spend|budget left|magkano pa\s*$|natitirang budget/.test(t)) return R("budget_left");

    // can I afford X
    if (/(can i afford|can we afford|afford|kaya ko ba|kaya ba natin|kaya ba|kakayanin ba)/.test(t)) {
      var amt = parseAmount(t);
      if (amt) return R("afford", { amount: amt, item: cleanItem(t.replace(/(can i afford|can we afford|afford|kaya ko ba|kaya ba natin|kaya ba|kakayanin ba|(?:php|p)?\s*\d+(\.\d+)?\s*(k|pesos?)?)/g, " ").split(" ")) });
      return null;
    }

    // record spending (money → needs confirmation)
    var sp = /^(i spent|spent|gumastos ako( ng)?|gumastos|nagastos ko|nagbayad ako( ng)?|nagbayad|i paid|paid|binayaran ko)\b(.*)$/.exec(t);
    if (sp) {
      var rest = sp[sp.length - 1];
      var amount = parseAmount(rest);
      if (!amount) return null;
      var store = (/(?:\bsa|\bat)\s+([a-z0-9&' ]+?)(?:\s+(?:for|para sa|para|on)\b|$)/.exec(rest) || [])[1] || "";
      var forWhat = (/(?:\bfor|para sa|para)\s+([a-z0-9 ']+)$/.exec(rest) || [])[1] || "";
      return R("spent", { amount: amount, store: store.trim(), item: translate(cleanItem(forWhat.split(" "))), money: true });
    }

    // stock: ran out
    var out = /(?:^|\b)(ubos na|naubos na|naubos|ubos|wala na( kaming| tayong| na)?|walang natira(ng)?|out of|ran out of|we're out of|we are out of|no more)\b(.*)$/.exec(t);
    if (out && !/\?$/.test(String(text).trim()) && !/^ano/.test(t)) {
      var before = t.slice(0, out.index), after = out[out.length - 1];
      var it1 = itemFrom((after.trim() ? after : before));
      if (it1.item) return R("out_of", it1);
    }

    // what's low
    if (/what('?s| is| are)? (running )?(low|out)|running low|low (stock|items)|ano(ng)? (ubos|kulang|paubos|wala na)|what should i (buy|restock)|anong kulang/.test(t)) return R("what_low");

    // do I need X / days left
    var need = /(?:do (?:i|we) (?:still )?need(?: to buy)?|kailangan (?:ko|namin|natin) (?:pa )?ba(?: ng| bumili ng)?|may (.+?) pa ba|meron pa ba(?:ng)?|ilang araw pa (?:ang |yung )?)(.*)$/.exec(t);
    if (need) { var ni = itemFrom(need[1] || need[2] || ""); if (ni.item) return R("do_i_need", ni); }

    // used / bought (stock changes)
    var used = /^(nagamit (ko|namin|natin)?|ginamit (ko|namin)?|used|i used|we used|gumamit (ako|kami) ng)\b(.*)$/.exec(t);
    if (used) { var ui = itemFrom(used[used.length - 1]); if (ui.item) return R("used", ui); }
    var bought = /^(bumili ako( ng)?|nakabili (ako|kami)( ng)?|i bought|we bought|bought|restocked|nag-?restock( ng)?|add to stock)\b(.*)$/.exec(t);
    if (bought) { var bi = itemFrom(bought[bought.length - 1]); if (bi.item) return R("restock", bi); }

    // remove from list (destructive → needs confirmation)
    var rm = /^(remove|tanggalin|tanggal|alisin|delete|burahin|bura|cross off|ekis)( mo)?\b(.*)$/.exec(t);
    if (rm) { var ri = itemFrom(rm[rm.length - 1]); if (ri.item) return R("remove_from_list", Object.assign(ri, { destructive: true })); }

    // where to buy / price / buy-or-wait (fall back to AI research if the item isn't known)
    if (/(saan|where)\b.*(mura|cheap|bili|buy|bibili|mabibili|best price)/.test(t) || /^(saan|where)\??$/.test(t)) {
      var wi = itemFrom(t, /(saan|where)\b( (ang|ba|is|are|to|can i|can we|should i|should we|do i|do we|pwede|dapat|ako|ko|kami|tayo)\b)*( (pinakamura|mura|cheapest|cheap|best price|bumili|bibili|mabibili|buy|bili|get)\b)*( (ng|ang|yung|for|the|this|it)\b)*/g);
      wi.item = wi.item.replace(/\b(cheapest|mura|pinakamura)\b/g, "").trim();
      if (!wi.item && c.lastItem) return R("where_buy", { item: c.lastItem, followUp: true });
      if (wi.item) return R("where_buy", wi);
      return null;
    }
    if (/(should i buy|bilhin ko na ba|bibili na ba|buy now or wait|wait or buy|good price ba|mura na ba)/.test(t)) {
      var ai = itemFrom(t, /(should i buy|bilhin ko na ba|bibili na ba|buy now or wait|wait or buy|good price ba|mura na ba)( (ang|yung|the|now)\b)*/g);
      if (ai.item) return R("buy_advice", ai);
      if (c.lastItem) return R("buy_advice", { item: c.lastItem, followUp: true });
    }
    if (/^(magkano|how much)\b/.test(t) && !OPEN_ENDED.test(t)) {
      var pi = itemFrom(t, /^(magkano|how much)( (ang|ba|ba ang|yung|is|are|does|do|the|a|an)\b)*/);
      pi.item = pi.item.replace(/\b(cost|costs|ngayon|now)\b/g, "").trim();
      if (pi.item) return R("price_of", pi);
      if (c.lastItem) return R("price_of", { item: c.lastItem, followUp: true });
    }

    // plan the trip / route
    if (/(plan|optimi[sz]e|ayusin).*(trip|route|shopping|list|lista)|saan ako (mamimili|pupunta)|best route|plan my shopping/.test(t)) return R("plan_trip", { mode: modeFrom(t) });
    if (/(forecast|next 30 days|30 days|susunod na (buwan|30 araw)|projected spending|magkano gagastusin)/.test(t)) return R("forecast");
    if (/^(alerts?|notifications?|price drops?|may alert ba|ano ang alerts?)$|show (my )?alerts/.test(t)) return R("alerts");

    // add to list
    var add = /^(add|pakidagdag|dagdagan mo( pa)?|dagdag|idagdag( mo)?|ilista( mo)?|ilagay( mo)?|lagay|bili tayo( ng)?|pabili( ng)?|buy)\b(.*)$/.exec(t);
    var toList = /\b(sa (lista|list|listahan)|to (the |my )?(shopping )?list)\b/.test(t);
    if ((add || toList) && !OPEN_ENDED.test(t)) {
      var body = add ? add[add.length - 1] : t;
      body = body.replace(/\b(sa (lista|list|listahan)|to (the |my )?(shopping )?list|on (the |my )?list)\b/g, " ");
      var a1 = itemFrom(body);
      if (add && add[1] === "buy" && a1.qty === null) return null;   // "buy a laptop…" → research
      if (!a1.item || /^(it|that|iyan|yan|ito|iyon|yun)$/.test(a1.rawItem)) {
        if (c.lastItem) return R("add_to_list", { item: c.lastItem, qty: a1.qty, unit: a1.unit || (a1.qty ? c.lastUnit : null), followUp: true });
        return null;
      }
      return R("add_to_list", a1);
    }

    // follow-ups that reuse the last item / intent
    var more = /^(isa pa|one more|another( one)?|(\d+|isa|dalawa|tatlo|two|three) (pa|more))$/.exec(t);
    if (more && c.lastItem) { var mq = takeQty(t.split(" ")); return R("add_to_list", { item: c.lastItem, qty: mq.qty || 1, unit: c.lastUnit || null, followUp: true }); }
    var how = /^(how about|what about|eh? (yung|ang)|paano (yung|ang)|and|tapos (yung|ang)|e yung)\s+(.+)$/.exec(t);
    if (how && c.lastIntent && ["do_i_need", "where_buy", "price_of", "buy_advice", "out_of", "add_to_list"].indexOf(c.lastIntent) >= 0) {
      var hi = itemFrom(how[how.length - 1]);
      if (hi.item) return R(c.lastIntent, Object.assign(hi, { followUp: true, destructive: false }));
    }
    return null;
  }

  return { parse: parse, translate: translate, norm: norm, parseAmount: parseAmount, takeQty: takeQty, LEXICON: LEXICON, UNIT_OF: UNIT_OF, OPEN_ENDED: OPEN_ENDED };
}));
