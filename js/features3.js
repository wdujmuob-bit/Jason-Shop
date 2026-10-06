/* =====================================================================
   JASON SHOP — STAGE 3 INTELLIGENCE
   Where to buy · best-store split & route planner · bulk / pack-size value
   · substitutions · price targets & buy-now/wait · fund protection
   · 30-day forecast · AI action preview (Approve / Edit / Optimize + WHY)
   · natural voice & text commands (English / Filipino / Taglish)
   · research price labels & source quality · recurring purchases
   · alert center (price drops, targets, stock, expiry, budget).
   Math lives in js/calc.js, command parsing in js/nlu.js. Nothing here
   invents a price or a saving: missing data says "not enough data".
   ===================================================================== */

/* ---------- small helpers ---------- */

function nowIso(){ return new Date().toISOString(); }
function learning(){
 if(!data.learning || typeof data.learning!=="object") data.learning={ terms:{}, storePrefs:{}, routeModeCounts:{}, corrections:[], alertScanAt:nowIso() };
 let L=data.learning;
 ["terms","storePrefs","routeModeCounts"].forEach(k=>{ if(!L[k] || typeof L[k]!=="object") L[k]={}; });
 if(!Array.isArray(L.corrections)) L.corrections=[];
 return L;
}
function setting3(k){ return Object.assign({},Mdl.DEFAULT_SETTINGS[k],data.settings && data.settings[k]); }
function routeSettings(){ return Object.assign({},C.DEFAULT_ROUTE,data.settings && data.settings.route); }
function whyHTML(lines,id){
 if(!lines || !lines.length) return "";
 return `<div class="why"${id ? ` id="${id}"` : ""}><b>WHY</b><ul>${lines.map(l=>`<li>${esc(l)}</li>`).join("")}</ul></div>`;
}
function plainText(html){ let d=document.createElement("div"); d.innerHTML=String(html||""); return (d.innerText||d.textContent||"").replace(/\s+/g," ").trim(); }
function cap(s){ s=String(s||"").trim(); return s ? s.charAt(0).toUpperCase()+s.slice(1) : s; }
function unitWord(u,q){
 let w={kg:"kilo",g:"gram",L:"liter",ml:"ml",pcs:"piece",pack:"pack",sachet:"sachet",can:"can",bottle:"bottle",tray:"tray",box:"box",roll:"roll",sack:"sack",bundle:"bundle"}[u]||u||"";
 return w && q!==1 && !/ml$/.test(w) ? w+"s" : w;
}

/* ---------- price status labels (LIVE / ONLINE VERIFIED / RECEIPT VERIFIED / USER ENTERED / HISTORICAL / ESTIMATED / UNKNOWN) ---------- */

function recStatus(r){
 return C.priceStatus({ price:r.price, source:r.source, date:r.date, verified:!!r.verified, hasSource:!!r.url, at:r.createdAt },todayDay(),{ now:nowIso() });
}
function psBadge(key,extra){
 let i=C.PRICE_STATUS[key] || C.PRICE_STATUS.UNKNOWN;
 return `<span class="ps ps-${key.toLowerCase()}" title="${esc(i.text)}">${i.icon} ${esc(i.label)}${extra ? " · "+esc(extra) : ""}</span>`;
}
function priceStatusBadge(r){ return psBadge(recStatus(r)); }

/* ---------- Price Book lookups ---------- */

function realRecords(p){ return priceRecordsFor(p.id).filter(r=>r.source!=="ai_estimate" && C.num(r.price)>0); }
function rankingFor(p){ return C.storeRanking(realRecords(p).map(r=>Object.assign(statsInput(r,p),{ source:r.source })),todayDay()); }
function itemPriceOf(r){ return C.round2(r.price/(C.num(r.qty)>0 ? C.num(r.qty) : 1)); }
function sortByWhen(list){ let k=r=>String(r.date||"")+"|"+String(r.createdAt||""); return list.slice().sort((a,b)=>k(a).localeCompare(k(b))); }
function adviceFor(p){
 return C.buyAdvice({ history:realRecords(p).map(r=>({ value:itemPriceOf(r), date:r.date })), target:p.targetPrice });
}

function wordIn(term,name){
 if(!term || !name) return false;
 return (" "+name+" ").includes(" "+term+" ") || (term.length>3 && name.split(" ").some(w=>w.startsWith(term)));
}

// "bigas" / "rice" → Price Book product + inventory item (learned corrections first).
function resolveTerm(term){
 let t=Mdl.normalizeName(term);
 if(!t) return { product:null, inv:null, how:null, term:"" };
 let L=learning();
 let product=null, how=null, inv=null;
 let learned=L.terms[t];
 if(learned && learned.productId && productById(learned.productId) && !productById(learned.productId).archived){ product=productById(learned.productId); how="learned"; }
 if(!product && learned && learned.name){ inv=invForName(learned.name); if(inv) how="learned"; }
 if(!product && !inv){ let m=Mdl.matchProduct(data.products,term); if(m.confidence==="high"){ product=m.product; how="name"; } }
 if(product && !inv) inv=invForProduct(product.id);
 if(!inv) inv=invForName(term) || invItems().find(i=>wordIn(t,Mdl.normalizeName(i.name))) || null;
 if(!product && inv && inv.productId && productById(inv.productId)){ product=productById(inv.productId); how=how||"inventory"; }
 if(!product){
  let c=(data.products||[]).filter(p=>!p.archived && (wordIn(t,Mdl.normalizeName(p.name)) || (p.aliases||[]).some(a=>wordIn(t,Mdl.normalizeName(a)))));
  c.sort((a,b)=>(Mdl.normalizeName(b.name).startsWith(t)-Mdl.normalizeName(a.name).startsWith(t)) || (realRecords(b).length-realRecords(a).length));
  if(c[0]){ product=c[0]; how=how||"contains"; }
 }
 if(!inv && product) inv=invForProduct(product.id);
 if(inv && !how) how="inventory";
 return { product, inv, how, term:t };
}
function resolveParsed(p){
 if(p.rawItem){ let a=resolveTerm(p.rawItem); if(a.product || a.inv) return Object.assign(a,{ said:p.rawItem }); }
 return Object.assign(resolveTerm(p.item),{ said:p.rawItem || p.item });
}
function howText(R){
 let what=R.inv ? "inventory item \""+R.inv.name+"\"" : (R.product ? "Price Book product \""+productTitle(R.product)+"\"" : "");
 if(!what) return "";
 return ({ learned:"Using "+what+" — you corrected this word before, so I remembered.", name:"Matched "+what+" by name.", inventory:"Matched "+what+".", contains:"Matched "+what+" (closest name)." }[R.how]) || "Matched "+what+".";
}
function learnTerm(term,productId,name){
 let t=Mdl.normalizeName(term);
 if(!t) return;
 let L=learning();
 let prev=L.terms[t];
 L.terms[t]={ productId:productId||null, name:name||"", count:prev && prev.productId===productId ? (prev.count||1)+1 : 1, at:nowIso() };
 L.corrections.push({ type:"term", term:t, productId:productId||null, name:name||"", at:nowIso() });
 audit("learning.term","Learned: \""+term+"\" means "+(name||productId),{entity:"learning"});
}

/* =====================================================================
   PRODUCT SHEET: where to buy · buy now / wait · target price · pack size
   & bulk · substitutes
   ===================================================================== */

function renderProductIntel(id){
 let box=$id("productIntel"), p=productById(id);
 if(!box || !p) return;
 box.innerHTML=productIntelHTML(p);
}

function productIntelHTML(p){
 let rk=rankingFor(p);
 let adv=adviceFor(p);
 let out=[];
 out.push(`<div class="intel" id="piWhere"><h3>🏬 Where should I buy this?</h3>
  ${rk.rows.length ? `<table class="tbl"><tr><th>Store</th><th class="num">Price</th><th>When</th><th>Label</th></tr>
   ${rk.rows.map((r,i)=>`<tr class="${i===0 && rk.rows.length>1 ? "best" : ""}"><td>${i===0 && rk.rows.length>1 ? "🏆 " : ""}${esc(r.storeName||"—")}</td><td class="num">${money(r.value)}${r.per ? "/"+esc(r.per) : ""}</td><td><small class="fresh-${r.freshness.level}">${esc(r.freshness.text)}</small></td><td>${psBadge(r.status)}</td></tr>`).join("")}</table>` : '<p class="muted">No store prices recorded yet — not enough data.</p>'}
  ${whyHTML(rk.why)}</div>`);
 let info=C.BUY_ADVICE[adv.verdict]||C.BUY_ADVICE.NOT_ENOUGH_DATA;
 out.push(`<div class="intel" id="piAdvice"><h3>⏳ Buy now or wait?</h3>
  <div><span class="advice adv-${adv.verdict.toLowerCase()}">${info.icon} ${esc(info.label)}</span>${adv.low!==undefined ? ` <small class="muted">low ${money(adv.low)} · avg ${money(adv.avg)} · high ${money(adv.high)} (${adv.count} prices)</small>` : ""}</div>
  ${whyHTML(adv.why)}
  <div class="two"><div><label for="piTarget">🎯 Target price (each) ₱</label><input id="piTarget" inputmode="decimal" autocomplete="off" value="${p.targetPrice ? esc(String(p.targetPrice)) : ""}" placeholder="${adv.suggestedTarget ? esc(String(adv.suggestedTarget)) : "e.g. 250"}"></div>
  <div><label>&nbsp;</label><button class="action" id="piTargetSave" onclick="saveTargetPrice('${p.id}')">Save target</button></div></div>
  <div class="field-note">You get an alert when a recorded price reaches your target.${adv.suggestedTarget && !p.targetPrice ? " Suggested from your history: "+money(adv.suggestedTarget)+"." : ""}</div></div>`);
 out.push(`<div class="intel" id="piPack"><h3>📦 Pack size &amp; bulk</h3>${packHTML(p)}</div>`);
 out.push(`<div class="intel" id="piSubs"><h3>🔁 Substitutes</h3>${subsHTML(p)}</div>`);
 return out.join("");
}

function saveTargetPrice(pid){
 let p=productById(pid); if(!p) return;
 let raw=val("piTarget");
 let v=raw ? parseAmount(raw) : null;
 if(raw && !(v>0)){ toast("Enter a price above 0, or leave it empty"); return; }
 let before=p.targetPrice||null;
 p.targetPrice=v ? C.round2(v) : null; p.updatedAt=nowIso();
 audit("product.target","Target price for "+productTitle(p)+": "+(before ? money(before) : "none")+" → "+(p.targetPrice ? money(p.targetPrice) : "none"),{entity:"products",id:p.id,before:{targetPrice:before},after:{targetPrice:p.targetPrice}});
 save(); openProduct(pid); toast(p.targetPrice ? "🎯 Target saved" : "Target removed");
}

function latestOption(p){
 let kp=knownItemPrice(p.id);
 if(!kp || !p.size || !p.unit) return null;
 return { id:p.id, label:productTitle(p)+" "+sizeText(p), price:kp.price, qty:1, size:p.size, unit:p.unit, packCount:p.packCount, kp };
}
function packHTML(p){
 let me=latestOption(p);
 let subs=Mdl.substitutesFor(data.products,p).map(x=>x.product).filter(x=>x.unit && p.unit && C.sameDimension(x.unit,p.unit));
 let opts=[me].concat(subs.map(latestOption)).filter(Boolean);
 if(!me) return `<p class="muted">${p.size && p.unit ? "No recorded price for this size yet" : "Set this product's size (Edit product) and record prices"} — not enough data to compare pack sizes.</p>`;
 let pv=C.packSizeValue(opts);
 if(!pv.comparable) return `<p class="muted">Only one size with a recorded price — add a price for another size (e.g. a bigger pack) to compare. Not enough data yet.</p>`;
 let html=`<table class="tbl"><tr><th>Size</th><th class="num">Per unit</th><th class="num">vs best</th></tr>${pv.rows.map((r,i)=>`<tr class="${i===0 ? "best" : ""}"><td>${i===0 ? "🏆 " : ""}${esc(r.label)}</td><td class="num">${money(r.unitValue)}/${esc(r.per)}</td><td class="num">${r.morePct ? "+"+r.morePct+"%" : "best"}</td></tr>`).join("")}</table>${whyHTML(pv.why)}`;
 let total=o=>C.convert(o.size*(o.packCount||1),o.unit,me.unit);
 let bigger=opts.filter(o=>o.id!==me.id && total(o)>total(me)).map(o=>({o,unit:C.unitPrice(o)})).filter(x=>x.unit.ok).sort((a,b)=>a.unit.exact-b.unit.exact)[0];
 if(bigger){
  let inv=invForProduct(p.id);
  let perDay=null, life=null;
  if(inv){
   let use=itemUse(inv).value;
   let f=C.convert(1,inv.unit,me.unit);
   if(use>0 && f!==null) perDay=use*f;
   if(inv.perishable && C.num(inv.shelfLifeDays)>0) life=C.num(inv.shelfLifeDays);
  }
  let be=C.bulkBreakEven({ small:{ price:me.price, size:total(me) }, bulk:{ price:bigger.o.price, size:total(bigger.o) }, perDay, shelfLifeDays:life });
  let lab={ BUY_BULK:"✅ BUY THE BIG PACK", BUY_SMALL:"🛍️ STICK TO THE SMALL PACK", BULK_IF_USED:"⚖️ BULK ONLY IF YOU'LL USE IT", NOT_ENOUGH_DATA:"❔ NOT ENOUGH DATA" }[be.verdict];
  let risks=[];
  if(be.expiryRisk && be.expiryRisk!=="NONE") risks.push(`<span class="tag risk-${be.expiryRisk.toLowerCase()}">⏰ Expiry risk: ${esc(be.expiryRisk)}</span>`);
  if(be.storageRisk) risks.push(`<span class="tag risk-${be.storageRisk.toLowerCase()}">📦 Storage: ${esc(be.storageRisk)}</span>`);
  html+=`<div class="bulk" id="piBulk"><b>${esc(lab)}</b> <small class="muted">${esc(sizeText(p))} vs ${esc(bigger.o.label)}</small>
   ${risks.length ? "<div>"+risks.join(" ")+"</div>" : ""}
   ${whyHTML(be.why)}${perDay===null ? '<div class="field-note">Track this item in Inventory to learn how fast you use it.</div>' : ""}</div>`;
 }
 return html;
}

function subsHTML(p){
 let subs=Mdl.substitutesFor(data.products,p).slice(0,6);
 if(!subs.length) return '<p class="muted">No similar products in your Price Book yet.</p>';
 let mine=C.unitPrice(latestOption(p)||{});
 return subs.map(s=>{
  let o=latestOption(s.product), u=o ? C.unitPrice(o) : null;
  let kp=knownItemPrice(s.product.id);
  let cmp=u && u.ok && mine.ok && u.dim===mine.dim ? (u.exact<mine.exact ? `<span class="trend down">${Math.round((mine.exact-u.exact)/mine.exact*100)}% cheaper per ${esc(u.perLabel)}</span>` : (u.exact>mine.exact ? `<span class="muted">${Math.round((u.exact-mine.exact)/mine.exact*100)}% dearer per ${esc(u.perLabel)}</span>` : '<span class="muted">same per unit</span>')) : '<span class="muted">can\'t compare per unit (not enough data)</span>';
  return `<div class="list-row sub-row" data-subst="${esc(s.product.id)}"><div><b>${esc(productTitle(s.product))}</b> <small class="muted">${esc(sizeText(s.product))}${kp ? " · "+money(kp.price)+(kp.storeName ? " at "+esc(kp.storeName) : "") : " · no price yet"}</small>
   <div>${s.chosen ? '<span class="tag">✅ you use this</span> ' : ""}${cmp}</div></div>
   <div class="list-actions">${s.chosen ? "" : `<button class="mini ok" data-act="sub-use" onclick="subChoice('${p.id}','${s.product.id}',true)">✅ OK</button>`}<button class="mini" data-act="sub-no" onclick="subChoice('${p.id}','${s.product.id}',false)">🚫 Not for me</button></div></div>`;
 }).join("")+'<div class="field-note">Same kind of product from your Price Book. Your choices are remembered.</div>';
}

function subChoice(pid,sid,ok){
 let p=productById(pid), s=productById(sid); if(!p || !s) return;
 p.substitutes=(p.substitutes||[]).filter(x=>x!==sid);
 p.rejectedSubstitutes=(p.rejectedSubstitutes||[]).filter(x=>x!==sid);
 (ok ? p.substitutes : p.rejectedSubstitutes).push(sid);
 learning().corrections.push({ type:ok ? "substitute_ok" : "substitute_no", productId:pid, otherId:sid, at:nowIso() });
 audit("product.substitute",(ok ? "Substitute OK: " : "Not a substitute: ")+productTitle(s)+" for "+productTitle(p),{entity:"products",id:pid});
 save(); openProduct(pid); toast(ok ? "✅ Remembered as a substitute" : "🚫 Won't suggest that again");
}

/* =====================================================================
   FUND PROTECTION (Affordable / Caution / Wait / Exceeds)
   ===================================================================== */

function activeRecurring(){ return (data.recurring||[]).filter(r=>r && !r.archived && r.active!==false); }
function fundBudget(){ return { fund:data.fund, spent:data.spent, stop:data.stop, committed:committedTotal(), reserve:reserveTotal(), thresholds:data.settings && data.settings.thresholds }; }
function upcomingNeeds(){
 let today=todayDay(), to=C.addDays(today,14);
 let list=C.sum(openListItems().filter(li=>li.kind==="need"),li=>itemEstimate(li).amount||0);
 let rec=0;
 activeRecurring().forEach(r=>{ rec+=C.occurrencesBetween(r.nextDue,r.every,today,to,30).length*r.amount; });
 return { total:C.round2(list+rec), list:C.round2(list), recurring:C.round2(rec) };
}
function fundCheckFor(amount){
 let up=upcomingNeeds();
 let r=C.fundCheck(amount,fundBudget(),{ upcoming:up.total });
 r.up=up;
 if(r.verdict!=="SETUP" && up.total>0) r.why.push("Coming up in 14 days: "+money(up.list)+" of needs on your list"+(up.recurring ? " + "+money(up.recurring)+" recurring" : "")+".");
 return r;
}
function fundBadge(v){ let i=C.FUND_VERDICTS[v]||C.FUND_VERDICTS.SETUP; return `<span class="fv fv-${v.toLowerCase()}">${i.icon} ${esc(i.label)}</span>`; }
function fundCheckLine(amount){
 let r=fundCheckFor(amount);
 if(r.verdict==="SETUP") return "";
 return `<div class="fund-check" data-verdict="${r.verdict}">🛡️ Fund check: ${fundBadge(r.verdict)}${whyHTML(r.why)}</div>`;
}
function liveFundCheck(inputId,outId){
 let out=$id(outId); if(!out) return;
 let v=parseAmount(val(inputId));
 out.innerHTML=v>0 ? fundCheckLine(v) : "";
}

/* =====================================================================
   ROUTE PLANNER — best-store split with modes (BEST BALANCE default)
   ===================================================================== */

let planState={ mode:"balance", locks:{}, optimized:false, editing:false };

function preferredMode(){
 let counts=learning().routeModeCounts||{};
 let best=Object.keys(counts).filter(k=>C.ROUTE_MODES[k]).sort((a,b)=>counts[b]-counts[a])[0];
 if(best && counts[best]>=3) return best;
 return C.ROUTE_MODES[routeSettings().mode] ? routeSettings().mode : "balance";
}

function planInputs(){
 let L=learning();
 let storesUsed={};
 let rows=openListItems().map(li=>{
  let prices={};
  let p=li.productId ? productById(li.productId) : null;
  if(p) rankingFor(p).rows.forEach(r=>{ let s=storeById(r.storeKey); if(s && !s.archived) prices[r.storeKey]=C.lineEstimate(r.itemPrice,li.qty); });
  Object.keys(prices).forEach(k=>{ storesUsed[k]=true; });
  let lock=planState.locks[li.id]||null, learned=false;
  if(!lock && !planState.optimized && li.productId){
   let pref=L.storePrefs[li.productId];
   if(pref && pref.count>=2 && prices[pref.storeId]!==undefined){ lock=pref.storeId; learned=true; }
  }
  if(lock) storesUsed[lock]=true;
  return { li, prices, lock, learned };
 });
 let stores={};
 Object.keys(storesUsed).forEach(k=>{ let s=storeById(k); let tr=(s && s.travel) || {}; stores[k]={ name:s ? storeLabel(s) : k, minutes:C.num(tr.minutes), km:C.num(tr.km) }; });
 return { rows, stores };
}

function openPlanner(mode){
 planState={ mode:C.ROUTE_MODES[mode] ? mode : preferredMode(), locks:{}, optimized:false, editing:false };
 openSheet(`<div id="plannerBody"></div>`);
 renderPlanner();
}

function computePlan(){
 let { rows, stores }=planInputs();
 let res=C.planRoute(rows.map(r=>({ id:r.li.id, prices:r.prices, lock:r.lock })),stores,routeSettings(),planState.mode);
 return { rows, stores, res };
}

function planStopsHTML(best,rows,stores,name){
 return best.stores.map((k,i)=>{
  let its=rows.filter(r=>best.assign[r.li.id].storeKey===k);
  let sub=C.sum(its,r=>best.assign[r.li.id].amount||0);
  let tr=stores[k]||{};
  return `<div class="stop" data-stop="${esc(k)}"><div class="card-head"><b>${i+1}. ${esc(name(k))}</b><small class="muted">${tr.minutes!==null && tr.minutes!==undefined ? tr.minutes+" min from home" : "travel not set"}</small></div>
   ${its.map(r=>`<div class="row-line"><span>${esc(r.li.name)}${r.li.qty!==1 ? " ×"+qtyText(r.li.qty) : ""}${r.lock ? ' <small class="tag">'+(r.learned ? "📌 usual" : "✋ your pick")+'</small>' : ""}</span><b>${best.assign[r.li.id].amount!==null ? money(best.assign[r.li.id].amount) : "no price"}</b></div>`).join("")}
   <div class="row-line total"><span>Subtotal</span><b>${money(sub)}</b></div></div>`;
 }).join("");
}

function planEditHTML(rows,name,s,modes){
 return `<div class="card" id="rtItems"><h3 class="card-title">✏️ Choose stores yourself</h3>
   ${rows.map(r=>`<div class="stepper-row"><label for="rtl_${esc(r.li.id)}">${esc(r.li.name)}</label><select id="rtl_${esc(r.li.id)}" onchange="setPlanLock('${esc(r.li.id)}',this.value)"><option value="">Best (auto)</option>${Object.keys(r.prices).map(k=>`<option value="${esc(k)}" ${planState.locks[r.li.id]===k ? "selected" : ""}>${esc(name(k))} · ${money(r.prices[k])}</option>`).join("")}</select></div>`).join("")}
   <div class="field-note">Pick the same store for an item on two approved trips and Jason Shop will suggest it automatically.</div></div>
  <div class="card" id="rtSettings"><h3 class="card-title">⚙️ Route settings</h3>
   <div class="two"><div><label for="rsBetween">Minutes between stores</label><input id="rsBetween" inputmode="decimal" value="${esc(String(s.betweenStoresMinutes))}"></div>
   <div><label for="rsBetweenKm">Km between stores</label><input id="rsBetweenKm" inputmode="decimal" value="${esc(String(s.betweenStoresKm))}"></div></div>
   <div class="two"><div><label for="rsShop">Shopping minutes per stop</label><input id="rsShop" inputmode="decimal" value="${esc(String(s.shoppingMinutes))}"></div>
   <div><label for="rsTime">Your time ₱/hour</label><input id="rsTime" inputmode="decimal" value="${esc(String(s.timeValuePerHour))}"></div></div>
   <div class="two"><div><label for="rsFuel">Fuel ₱/km (optional)</label><input id="rsFuel" inputmode="decimal" value="${s.fuelPerKm ? esc(String(s.fuelPerKm)) : ""}"></div>
   <div><label for="rsMode">Default mode</label><select id="rsMode">${modes.map(m=>`<option value="${m}" ${s.mode===m ? "selected" : ""}>${esc(C.ROUTE_MODES[m].label)}</option>`).join("")}</select></div></div>
   <div id="sheetMsg" class="form-msg"></div>
   <button class="action wide" id="rsSave" onclick="saveRouteSettings()">Save route settings</button></div>`;
}

function renderPlanner(){
 let box=$id("plannerBody"); if(!box) return;
 let { rows, stores, res }=computePlan();
 planState.last=res; planState.rows=rows;
 let s=routeSettings();
 let best=res.best;
 let name=k=>(stores[k] && stores[k].name) || (storeById(k) ? storeLabel(storeById(k)) : k);
 let why=res.why.slice();
 rows.filter(r=>r.learned).forEach(r=>why.push("📌 "+r.li.name+": your usual store "+name(r.lock)+" (you picked it "+learning().storePrefs[r.li.productId].count+" times)."));
 let unpricedNames=rows.filter(r=>res.unpriced.includes(r.li.id)).map(r=>r.li.name);
 let modes=Object.keys(C.ROUTE_MODES);
 box.innerHTML=`<h2>🧭 Plan my trip</h2>
  <div class="seg seg4" id="rtMode">${modes.map(m=>`<button type="button" data-mode="${m}" class="${planState.mode===m ? "on" : ""}" onclick="setRouteMode('${m}')">${esc(C.ROUTE_MODES[m].label)}</button>`).join("")}</div>
  <div class="field-note" id="rtLive">📍 Live distance: <b>NEEDS CONFIGURATION</b> — no maps service is connected. Travel time uses the minutes and km from home you set for each store (My stores → ✏️ Edit store) and the route settings (✏️ Edit).</div>
  ${best ? `<div class="card plan-best" id="rtBest">
    <div class="card-head"><b>${esc(C.ROUTE_MODES[res.mode].label)} · ${best.stops} stop${best.stops===1 ? "" : "s"}</b><b id="rtTotal">${money(best.itemsTotal)}</b></div>
    <div class="muted small" id="rtTime">${best.minutes!==null ? "≈ "+Math.round(best.minutes)+" min (incl. "+s.shoppingMinutes+" min shopping per stop)" : "Travel time not set — "+(best.stops*s.shoppingMinutes)+" min shopping only"}${best.km!==null ? " · "+best.km+" km" : ""}${best.fuel!==null ? " · fuel ≈ "+money(best.fuel) : ""}</div>
    ${planStopsHTML(best,rows,stores,name)}
    ${unpricedNames.length ? `<div class="field-note" id="rtUnpriced">🏷️ No recorded price: ${unpricedNames.map(esc).join(", ")} — not counted; buy wherever is convenient.</div>` : ""}
   </div>` : `<div class="card"><p class="muted" id="rtEmpty">${rows.length ? "None of the items on your list has a recorded store price yet — not enough data to plan a route." : "Your shopping list is empty."}</p></div>`}
  ${whyHTML(why,"rtWhy")}
  ${best ? `<table class="tbl" id="rtCompare"><tr><th>Mode</th><th>Stores</th><th class="num">Items</th><th class="num">Time</th></tr>
   ${modes.map(m=>{ let x=res.bestBy[m]; return x ? `<tr class="${m===res.mode ? "best" : ""}"><td>${esc(C.ROUTE_MODES[m].label)}</td><td>${x.stores.map(k=>esc(name(k))).join(" → ")}</td><td class="num">${money(x.itemsTotal)}</td><td class="num">${x.minutes!==null ? Math.round(x.minutes)+" min" : "—"}</td></tr>` : ""; }).join("")}</table>` : ""}
  ${planState.editing ? planEditHTML(rows,name,s,modes) : ""}
  <div class="btn-row three-btn">
   <button class="primary" id="rtApprove" onclick="approvePlan()" ${best ? "" : "disabled"}>✅ Approve</button>
   <button class="action" id="rtEdit" onclick="togglePlanEdit()">✏️ Edit</button>
   <button class="action" id="rtOptimize" onclick="optimizePlan()" ${best ? "" : "disabled"}>⚡ Optimize</button>
  </div>
  <button class="action wide" onclick="closeSheet()">Close</button>`;
}

function setRouteMode(m){ if(C.ROUTE_MODES[m]){ planState.mode=m; renderPlanner(); } }
function setPlanLock(liId,storeId){ if(storeId) planState.locks[liId]=storeId; else delete planState.locks[liId]; planState.optimized=false; renderPlanner(); }
function togglePlanEdit(){ planState.editing=!planState.editing; renderPlanner(); }

function optimizePlan(){
 let before=planState.last && planState.last.best;
 planState.locks={}; planState.optimized=true;
 renderPlanner();
 let a=planState.last && planState.last.best;
 if(before && a){
  let d=C.round2(before.itemsTotal-a.itemsTotal);
  toast(d>0.004 ? "⚡ Optimized — "+money(d)+" less without fixed store picks" : "⚡ Already the best plan for "+C.ROUTE_MODES[planState.last.mode].label);
 }
}

function saveRouteSettings(){
 let n=(id,allowEmpty)=>{ let v=val(id); if(v==="" && allowEmpty) return null; let x=C.num(v); return x!==null && x>=0 ? x : NaN; };
 let f={ betweenStoresMinutes:n("rsBetween"), betweenStoresKm:n("rsBetweenKm"), shoppingMinutes:n("rsShop"), timeValuePerHour:n("rsTime"), fuelPerKm:n("rsFuel",true), mode:val("rsMode")||"balance" };
 if(Object.keys(f).some(k=>typeof f[k]==="number" && isNaN(f[k]))){ sheetMsg("Use numbers of 0 or more."); return; }
 let before=Mdl.clone(data.settings.route);
 data.settings.route=Object.assign({},routeSettings(),f);
 audit("settings.route","Route settings updated",{entity:"settings",before,after:data.settings.route});
 storeData(); renderPlanner(); toast("✅ Route settings saved");
}

function approvePlan(){
 let res=planState.last, rows=planState.rows||[];
 if(!res || !res.best) return;
 let L=learning();
 let set=0;
 rows.forEach(r=>{
  let a=res.best.assign[r.li.id];
  if(a && a.storeKey && storeById(a.storeKey)){ r.li.storeId=a.storeKey; r.li.updatedAt=nowIso(); set++; }
  let mine=planState.locks[r.li.id];
  if(mine && r.li.productId){
   let pref=L.storePrefs[r.li.productId];
   L.storePrefs[r.li.productId]={ storeId:mine, count:pref && pref.storeId===mine ? (pref.count||1)+1 : 1, at:nowIso() };
   L.corrections.push({ type:"store", productId:r.li.productId, storeId:mine, at:nowIso() });
  }
 });
 L.routeModeCounts[res.mode]=(L.routeModeCounts[res.mode]||0)+1;
 audit("route.approve","Trip plan approved ("+C.ROUTE_MODES[res.mode].label+"): "+res.best.stores.map(k=>storeLabel(storeById(k))||k).join(" → ")+" · items "+money(res.best.itemsTotal),{entity:"shoppingLists"});
 closeSheet();
 if(activeTrip()){ save(); toast("✅ Stores set for "+plural(set,"item")); showSub("shop","trip"); }
 else startTrip();
}

/* =====================================================================
   30-DAY FORECAST
   ===================================================================== */

function forecastNow(){
 let today=todayDay(), b=budgetNow();
 let start=C.addDays(today,1), end=C.addDays(today,30);
 let scheduled=[];
 activeRecurring().forEach(r=>C.occurrencesBetween(r.nextDue,r.every,start,end,60).forEach(d=>scheduled.push({ date:d, amount:r.amount, label:"🔁 "+r.title, kind:"recurring" })));
 let restock=[];
 openListItems().forEach(li=>restock.push({ date:start, amount:itemEstimate(li).amount, label:"📝 "+li.name+" (on your list)" }));
 invItems().forEach(it=>{
  if(onActiveList(it.productId,it.name,it.id)) return;
  let info=itemInfo(it);
  if(info.st.days===null || info.st.days>30) return;
  let kp=knownItemPrice(it.productId);
  let packs=Math.max(1,info.re.packs||1);
  restock.push({ date:C.addDays(today,Math.max(1,Math.floor(info.st.days))), amount:kp ? C.round2(kp.price*packs) : null, label:"📦 "+it.name+" runs out" });
 });
 return C.forecast30({ today, entries:historyEntries().filter(e=>e.counted).map(e=>({ date:e.date, amount:e.amount })), scheduled, restock,
  safeNow:b.state==="SETUP" ? null : b.safeToSpend, fund:b.fund });
}

const FC_STATUS={ OK:{icon:"✅",label:"ON TRACK"}, TIGHT:{icon:"🟠",label:"TIGHT"}, SHORT:{icon:"⛔",label:"SHORT"}, SETUP:{icon:"⚙️",label:"SET UP BUDGET"} };

function renderForecast(){
 let box=$id("forecastBody"); if(!box) return;
 let f=forecastNow();
 let st=FC_STATUS[f.status];
 let maxW=Math.max(1,...f.weeks.map(w=>w.total));
 box.innerHTML=`<div class="card summary-card" id="fcSummary">
   <div class="card-head"><b>📈 Next 30 days · ${esc(shortDay(f.start))} – ${esc(shortDay(f.end))}</b><span class="fv fc-${f.status.toLowerCase()}">${st.icon} ${esc(st.label)}</span></div>
   <div class="calc-line total big"><span>Projected spending</span><b id="fcProjected">${f.projected>0 ? money(f.projected) : "Not enough data"}</b></div>
   <div class="calc-line"><span>From your usual pace</span><b>${f.baseline===null ? "not enough data" : money(f.baseline)}</b></div>
   <div class="calc-line"><span>Known coming up</span><b>${money(f.knownTotal)}</b></div>
   ${f.safeNow!==null ? `<div class="calc-line"><span>Safe to spend now</span><b>${money(f.safeNow)}</b></div><div class="calc-line total"><span>Left after 30 days</span><b id="fcEnd">${C.limitText(f.endSafe)}</b></div>` : ""}
   ${whyHTML(f.why,"fcWhy")}</div>
  <div class="card"><h3 class="card-title">Week by week</h3>
   ${f.weeks.map(w=>`<div class="bar-row"><div class="lbl"><span>${esc(shortDay(w.start))} – ${esc(shortDay(w.end))}</span><span>${money(w.total)}</span></div><div class="bar"><span class="u-safe" style="width:${Math.round(w.total/maxW*100)}%"></span></div><small class="muted">${w.baseline!==null ? "usual pace "+money(w.baseline)+" · " : ""}known ${money(w.known)}</small></div>`).join("")}</div>
  <div class="card" id="fcKnown"><h3 class="card-title">Known items</h3>
   ${f.known.length ? f.known.map(k=>`<div class="row-line"><span>${esc(k.label)} <small class="muted">${esc(shortDay(k.date))}</small></span><b>${money(k.amount)}</b></div>`).join("") : '<p class="muted">Nothing scheduled. Add recurring purchases (More → Recurring) and track stock to improve the forecast.</p>'}
   ${f.unpricedRestock.length ? `<div class="field-note">No price yet (not counted): ${f.unpricedRestock.map(x=>esc(x.label)).join(", ")}</div>` : ""}</div>`;
}

/* =====================================================================
   RECURRING PURCHASES → commitments
   ===================================================================== */

function everyText(e){ let n=e && e.n || 1, u=e && e.unit || "months"; return "every "+(n===1 ? u.replace(/s$/,"") : n+" "+u); }

function processRecurring(){
 let today=todayDay(), days=C.num(setting3("recurring").autoCommitDaysBefore);
 if(!(days>=0)) days=7;
 let made=0;
 activeRecurring().forEach(r=>{
  if(!r.autoCommit || !/^\d{4}-\d{2}-\d{2}$/.test(String(r.nextDue||""))) return;
  let guard=0;
  while(C.addDays(r.nextDue,-days)<=today && guard++<24){
   let due=r.nextDue;
   if(!(r.history||[]).some(h=>h.due===due)){
    let st=storeById(r.storeId);
    let c={ id:Mdl.newId("cmt"), status:"committed", title:r.title, amount:r.amount, dueDate:due, categoryName:r.categoryName||"Other", storeId:st ? st.id : null, storeName:st ? storeLabel(st) : "", note:"Recurring purchase ("+everyText(r.every)+")", recurringId:r.id, createdAt:nowIso(), updatedAt:nowIso() };
    data.commitments.push(c);
    r.history=(r.history||[]).concat([{ due, commitmentId:c.id, at:c.createdAt }]);
    audit("recurring.commit","Recurring purchase committed: "+r.title+" "+money(r.amount)+" due "+due,{entity:"commitments",id:c.id,after:{amount:r.amount,dueDate:due}});
    addAlert("recurring","rec:"+r.id+":"+due,"🔁 "+r.title+" committed",money(r.amount)+" set aside for "+due+". Safe to Spend already counts it.",{ recurringId:r.id });
    made++;
   }
   r.nextDue=C.advanceDate(due,r.every); r.updatedAt=nowIso();
  }
 });
 if(made) storeData();
 return made;
}

function renderRecurring(){
 let box=$id("recurringBody"); if(!box) return;
 let all=(data.recurring||[]).filter(r=>!r.archived);
 let days=setting3("recurring").autoCommitDaysBefore;
 box.innerHTML=`<p class="field-note">Regular buys (rice sack, diapers, water delivery…). ${days} days before each one is due it becomes a committed purchase, so Safe to Spend already accounts for it.</p>
  ${all.length ? all.map(r=>`<div class="card rec-card" data-rec="${esc(r.id)}"><div class="card-head"><b>${esc(r.title)}</b><b>${money(r.amount)}</b></div>
   <div class="muted small">${esc(everyText(r.every))} · next ${esc(r.nextDue)}${r.storeId && storeById(r.storeId) ? " · "+esc(storeLabel(storeById(r.storeId))) : ""}${r.active===false ? " · ⏸️ paused" : (r.autoCommit ? " · auto-commit" : " · reminder only")}</div>
   ${(r.history||[]).length ? `<div class="field-note">Committed ${plural(r.history.length,"time")} · last for ${esc(r.history[r.history.length-1].due)}</div>` : ""}
   <div class="btn-row"><button class="action" onclick="openRecurring('${esc(r.id)}')">✏️ Edit</button><button class="action" data-act="pause" onclick="toggleRecurring('${esc(r.id)}')">${r.active===false ? "▶️ Resume" : "⏸️ Pause"}</button></div></div>`).join("")
  : emptyState("🔁","No recurring purchases yet","Add things you buy on a schedule. They're set aside automatically before they're due.","")}
  <button class="action wide" id="recAddBtn" onclick="openRecurring(null)">➕ Add recurring purchase</button>`;
}

function openRecurring(id){
 let r=id ? (data.recurring||[]).find(x=>x.id===id) : null;
 sheetState={ recurringId:id };
 let e=r ? r.every : { unit:"months", n:1 };
 openSheet(`<h2>${r ? "Edit" : "Add"} recurring purchase</h2>
  <label for="rcTitle">What is it?</label><input id="rcTitle" autocomplete="off" placeholder="e.g. Rice sack 25kg, Diapers" value="${esc(r ? r.title : "")}">
  <div class="two"><div><label for="rcAmount">Amount ₱</label><input id="rcAmount" inputmode="decimal" autocomplete="off" value="${r ? esc(String(r.amount)) : ""}" oninput="liveFundCheck('rcAmount','rcFund')"></div>
  <div><label for="rcNext">Next due</label><input id="rcNext" type="date" value="${esc(r ? r.nextDue : C.addDays(todayDay(),7))}"></div></div>
  <div class="two"><div><label for="rcN">Every</label><input id="rcN" inputmode="numeric" value="${esc(String(e.n||1))}"></div>
  <div><label for="rcUnit">&nbsp;</label><select id="rcUnit">${Object.keys(Mdl.RECURRING_UNITS).map(u=>`<option value="${u}" ${e.unit===u ? "selected" : ""}>${esc(Mdl.RECURRING_UNITS[u])}</option>`).join("")}</select></div></div>
  <div class="two"><div><label for="rcCat">Category</label><select id="rcCat">${categoryOptions(r ? r.categoryName : "Groceries")}</select></div>
  <div><label for="rcStore">Store</label><select id="rcStore">${storeOptions(r ? r.storeId : "",true)}</select></div></div>
  <label class="check"><input type="checkbox" id="rcAuto" ${!r || r.autoCommit ? "checked" : ""}> Set the money aside automatically (becomes a committed purchase ${setting3("recurring").autoCommitDaysBefore} days before)</label>
  <div id="rcFund">${r ? fundCheckLine(r.amount) : ""}</div>
  <div id="sheetMsg" class="form-msg" aria-live="polite"></div>
  <button class="primary" id="rcSave" onclick="saveRecurring()">✅ SAVE</button>
  <button class="action wide" onclick="closeSheet()">Cancel</button>`);
}

function saveRecurring(){
 let title=val("rcTitle"), amount=parseAmount(val("rcAmount")), n=C.num(val("rcN")), next=val("rcNext");
 if(!title){ sheetMsg("Please say what it is."); return; }
 if(amount===null || isNaN(amount) || amount<=0){ sheetMsg("Please enter the amount, for example 1,450."); return; }
 if(!(n>=1) || Math.floor(n)!==n){ sheetMsg("\"Every\" must be a whole number, 1 or more."); return; }
 if(!/^\d{4}-\d{2}-\d{2}$/.test(next)){ sheetMsg("Please pick the next due date."); return; }
 let fields={ title, amount:C.round2(amount), every:{ unit:val("rcUnit")||"months", n }, nextDue:next, categoryName:val("rcCat")||"Other", storeId:val("rcStore")||null, autoCommit:$id("rcAuto").checked };
 if(!Array.isArray(data.recurring)) data.recurring=[];
 let r=sheetState.recurringId ? data.recurring.find(x=>x.id===sheetState.recurringId) : null;
 if(r){ let before=Mdl.clone(r); Object.assign(r,fields,{ updatedAt:nowIso() }); audit("recurring.edit","Recurring purchase updated: "+title,{entity:"recurring",id:r.id,before,after:fields}); }
 else { r=Mdl.makeRecurring(fields,nowIso()); data.recurring.push(r); audit("recurring.add","Recurring purchase added: "+title+" "+money(amount)+" "+everyText(r.every),{entity:"recurring",id:r.id}); }
 closeSheet();
 let made=processRecurring();
 save();
 toast(made ? "🔁 Saved — "+plural(made,"commitment")+" set aside" : "🔁 Recurring purchase saved");
}

function toggleRecurring(id){
 let r=(data.recurring||[]).find(x=>x.id===id); if(!r) return;
 r.active=r.active===false; r.updatedAt=nowIso();
 audit("recurring."+(r.active ? "resume" : "pause"),(r.active ? "Resumed: " : "Paused: ")+r.title,{entity:"recurring",id});
 if(r.active) processRecurring();
 save();
}

/* =====================================================================
   ALERT CENTER
   ===================================================================== */

function activeAlerts(){ return (data.alerts||[]).filter(a=>a && !a.dismissed); }
function addAlert(kind,key,title,text,extra){
 if(!Array.isArray(data.alerts)) data.alerts=[];
 if(data.alerts.some(a=>a.key===key)) return false;
 data.alerts.push(Object.assign({ id:Mdl.newId("al"), kind, key, title, text, at:nowIso(), seen:false, dismissed:false },extra||{}));
 return true;
}

// An alert whose problem went away is closed and its key freed, so it can alert again later.
function resolveAlerts(match){
 let n=0;
 (data.alerts||[]).forEach(a=>{ if(!a.dismissed && !a.resolved && match(a)){ a.resolved=true; a.dismissed=true; a.resolvedAt=nowIso(); a.key=a.key+"#resolved:"+a.resolvedAt; n++; } });
 return n;
}

function scanAlerts(){
 if(!data || !data.settings) return 0;
 let L=learning();
 let since=L.alertScanAt||"", nowStr=nowIso();
 let pa=setting3("priceAlerts");
 let added=0;
 if(pa.enabled!==false){
  (data.products||[]).filter(p=>!p.archived).forEach(p=>{
   let recs=sortByWhen(realRecords(p));
   recs.forEach((r,i)=>{
    // only prices recorded since alerts were switched on; a future-dated record (phone clock was off) counts as already seen
    let made=String(r.createdAt||"");
    if(i===0 || !since || made<=since || made>nowStr) return;
    let prior=recs.slice(0,i);
    let rs=resolveStore(r.storeId,r.storeName);
    let same=prior.filter(x=>resolveStore(x.storeId,x.storeName)===rs);
    let base=same.length ? same : prior;
    let prev=base[base.length-1];
    let pu=itemPriceOf(prev), cu=itemPriceOf(r);
    if(pu>0 && cu<pu*(1-(C.num(pa.dropPct)||5)/100)){
     let pct=Math.round((pu-cu)/pu*100);
     if(addAlert("price_drop","drop:"+r.id,"📉 "+productTitle(p)+" is "+pct+"% cheaper",money(cu)+" at "+(storeLabel(rs)||r.storeName||"a store")+" ("+r.date+") vs "+money(pu)+" before ("+(prev.date||"")+"). From your recorded prices.",{ productId:p.id })) added++;
    }
   });
   if(p.targetPrice>0 && recs.length){
    let last=recs[recs.length-1], cu=itemPriceOf(last);
    if(cu<=p.targetPrice && addAlert("target_hit","target:"+p.id+":"+last.id,"🎯 "+productTitle(p)+" reached your target",money(cu)+" ≤ your target "+money(p.targetPrice)+" ("+(storeLabel(resolveStore(last.storeId,last.storeName))||last.storeName||"")+", "+last.date+").",{ productId:p.id })) added++;
   }
  });
 }
 invItems().forEach(it=>{
  let info=itemInfo(it);
  let lowKey=["OUT","URGENT"].includes(info.st.state) ? "low:"+it.id+":"+info.st.state : null;
  if(resolveAlerts(a=>a.kind==="low_stock" && a.inventoryItemId===it.id && a.key!==lowKey)) added++;   // restocked or changed state
  if(lowKey && addAlert("low_stock",lowKey,"🥫 "+it.name+" — "+C.INVENTORY_STATES[info.st.state].label.toLowerCase(),daysText(info)||"Restock soon.",{ inventoryItemId:it.id })) added++;
  if(["EXPIRED","TODAY"].includes(info.exp.state) && addAlert("expiry","exp:"+it.id+":"+it.expiryDate+":"+info.exp.state,"⏰ "+it.name+" "+(info.exp.state==="EXPIRED" ? "has expired" : "expires today"),"Expiry date "+it.expiryDate+".",{ inventoryItemId:it.id })) added++;
 });
 let b=budgetNow();
 let fundKey=["WARNING","HARD_STOP"].includes(b.state) ? "fund:"+b.state+":"+currentPeriod().start : null;
 if(resolveAlerts(a=>a.kind==="fund" && a.key!==fundKey)) added++;
 if(fundKey){
  if(addAlert("fund",fundKey,b.state==="HARD_STOP" ? "⛔ Hard stop reached" : "⚠️ Budget warning",statusText(b)+". Safe to spend "+money(b.safeToSpend)+".")) added++;
 }
 if(added) storeData();
 return added;
}

function renderBell(){
 let n=activeAlerts().filter(a=>!a.seen).length;
 let c=$id("bellCount"); if(!c) return;
 c.innerText=n>99 ? "99+" : String(n);
 c.classList.toggle("hidden",n===0);
}

function alertRowHTML(a){
 let k=Mdl.ALERT_KINDS[a.kind]||{icon:"🔔",label:"Alert"};
 let open=a.productId ? `openProduct('${esc(a.productId)}')` : (a.inventoryItemId ? "closeSheet();goTo('inventory')" : (a.recurringId ? "closeSheet();goTo('commitments')" : (a.kind==="fund" ? "closeSheet();goTo('budget')" : "")));
 return `<div class="list-row alert-row al-${esc(a.kind)}" data-alert="${esc(a.id)}"><div${open ? ` class="tap-lite" onclick="${open}"` : ""}><small class="muted">${k.icon} ${esc(k.label)} · ${esc(fmtDateTime(a.at))}</small><br><b>${esc(a.title)}</b><br><small>${esc(a.text)}</small></div>
  <div class="list-actions">${a.dismissed ? "" : `<button class="mini" data-act="dismiss" aria-label="Dismiss" onclick="dismissAlert('${esc(a.id)}')">✕</button>`}</div></div>`;
}

function openAlerts(){
 scanAlerts();
 let act=activeAlerts().slice().reverse();
 let old=(data.alerts||[]).filter(a=>a.dismissed).slice(-20).reverse();
 openSheet(`<h2>🔔 Alerts</h2><div id="alertList">
  ${act.length ? act.map(alertRowHTML).join("") : '<p class="muted" id="alertsEmpty">No new alerts. Price drops, target prices, recurring purchases, low stock, expiry and budget warnings appear here.</p>'}</div>
  ${act.length ? `<button class="action wide" id="alertsDismissAll" onclick="dismissAllAlerts()">✕ Dismiss all</button>` : ""}
  ${old.length ? `<details><summary>Dismissed (${old.length})</summary>${old.map(alertRowHTML).join("")}</details>` : ""}
  <p class="field-note">Price-drop alerts compare each new price you record with the one before it (${setting3("priceAlerts").dropPct}% or more). Change it in More → Settings.</p>
  <button class="action wide" onclick="closeSheet()">Close</button>`);
 let changed=false;
 act.forEach(a=>{ if(!a.seen){ a.seen=true; changed=true; } });
 if(changed){ storeData(); renderBell(); }
}
function dismissAlert(id){ let a=(data.alerts||[]).find(x=>x.id===id); if(!a) return; a.dismissed=true; a.dismissedAt=nowIso(); storeData(); openAlerts(); renderActiveView(); }
function dismissAllAlerts(){ activeAlerts().forEach(a=>{ a.dismissed=true; a.dismissedAt=nowIso(); }); storeData(); openAlerts(); renderActiveView(); }

/* =====================================================================
   RESEARCH: price labels & source quality
   ===================================================================== */

function offerStatus(o,r){
 if(o.price===null || o.price===undefined) return "UNKNOWN";
 let at=r.researchedAt || r.date;
 return C.priceStatus({ price:o.price, source:"research", verified:!!o.verified, hasSource:!!o.url, at, date:localDay(at) },todayDay(),{ now:nowIso() });
}
function sqBadge(url){ let q=Mdl.sourceQuality(url); return `<span class="sq sq-${q.kind}" title="${esc(q.host)}">${q.icon} ${esc(q.label)}</span>`; }

function researchIntelHTML(r){
 let offers=Array.isArray(r.offers) ? r.offers : [];
 let sources=Array.isArray(r.sources) ? r.sources : [];
 if(!offers.length && !sources.length) return "";
 let priced=offers.map((o,i)=>({ o, i, st:offerStatus(o,r) })).filter(x=>x.o.price>0);
 let trusted=priced.filter(x=>x.st==="LIVE" || x.st==="ONLINE_VERIFIED");
 let pick=(trusted.length ? trusted : priced).slice().sort((a,b)=>a.o.price-b.o.price)[0];
 let exp=C.num(setting3("fund").expensiveAt)||5000;
 let offerRows=offers.map((o,i)=>{ let st=offerStatus(o,r); return `<div class="offer-row" data-offer="${i}"><div><b>${esc(o.product)}</b>${o.seller ? ` <small class="muted">· ${esc(o.seller)}</small>` : ""}<br>${psBadge(st)} ${sqBadge(o.url)}${o.url ? ` <a href="${esc(o.url)}" target="_blank" rel="noopener">open ↗</a>` : ""}</div><div class="num">${o.price>0 ? `<b>${money(o.price)}</b>` : `<small class="muted">price unknown</small>`}${o.price>0 ? `<br><button class="mini" data-act="save-offer" onclick="saveOffer('${esc(r.id)}',${i})">🏷️ Save</button>` : ""}</div></div>`; }).join("");
 let srcRows=sources.slice().sort((a,b)=>Mdl.sourceQuality(a.url).rank-Mdl.sourceQuality(b.url).rank).map(s=>`<div class="src-row">${sqBadge(s.url)} <a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.title || Mdl.sourceQuality(s.url).host)}</a></div>`).join("");
 return `<div class="research-intel" data-req="${esc(r.id)}">
  ${offers.length ? `<h4>🏷️ Prices found</h4>${offerRows}
   <div class="field-note">🟢 LIVE = found by today's search with a link · 🌐 ONLINE VERIFIED = listing with a link, not from today · 🤖 ESTIMATED = AI's estimate, not verified · ❔ UNKNOWN = no price found.</div>` : ""}
  ${pick && pick.o.price>=exp ? `<div class="fund-offer">For ${esc(pick.o.product)} at ${money(pick.o.price)}:${fundCheckLine(pick.o.price)}</div>` : ""}
  ${sources.length ? `<details class="sources"><summary>🔗 Sources (${sources.length})</summary>${srcRows}</details>` : ""}
 </div>`;
}

function saveOffer(reqId,i){
 let r=findRequest(reqId); if(!r || !r.offers || !r.offers[i]) return;
 let o=r.offers[i];
 if(!(o.price>0)) return;
 if((data.priceRecords||[]).some(x=>x.sourceRef && x.sourceRef.type==="research" && x.sourceRef.id===r.id && x.sourceRef.line===i && !x.archived)){ toast("Already in your Price Book"); return; }
 let now=nowIso();
 let m=Mdl.matchProduct(data.products,o.product);
 let product=m.confidence==="high" ? m.product : null;
 if(!product){
  let parsed=C.parseSize(o.product);
  product=Mdl.makeProduct({ name:o.product, size:parsed ? parsed.size : null, unit:parsed ? parsed.unit : null, packCount:parsed ? parsed.packCount : null, categoryName:r.category||"", createdFrom:"research", sizeSource:parsed ? "read_from_name" : null },now);
  data.products.push(product);
  audit("product.add","Product added from research: "+productTitle(product),{entity:"products",id:product.id});
 }
 let st=offerStatus(o,r);
 let source=(st==="LIVE" || st==="ONLINE_VERIFIED") ? "online" : "ai_estimate";
 let store=Mdl.findStoreByName(data.stores,o.seller);
 let rec={ id:Mdl.newId("price"), productId:product.id, itemName:o.product, storeId:store ? store.id : null, storeName:o.seller||"", price:C.round2(o.price), qty:1,
  date:localDay(r.researchedAt||r.date), source, status:Mdl.PRICE_SOURCES[source].status, sourceRef:{ type:"research", id:r.id, line:i }, url:o.url||null, verified:!!o.verified,
  matchConfidence:"high", matchReason:"research", needsReview:false, note:"From AI research ("+C.PRICE_STATUS[st].label+")", archived:false, createdAt:now };
 data.priceRecords.push(rec);
 audit("price.add","Price saved from research: "+o.product+" "+money(o.price)+" ("+C.PRICE_STATUS[st].label+")",{entity:"priceRecords",id:rec.id,after:{price:rec.price,source}});
 save();
 toast(source==="online" ? "🏷️ Saved to Price Book (online listing)" : "🏷️ Saved as 🤖 ESTIMATED — never used for store picks or Buy now / Wait");
}

/* =====================================================================
   NATURAL COMMANDS (voice + text, English / Filipino / Taglish)
   One shared context so follow-ups work across voice and typing.
   ===================================================================== */

let cmdCtx={ lastIntent:null, lastItem:null, lastUnit:null, pending:null };
let cmdActions={};

function addListItemQuick(f){
 let li=Mdl.makeListItem(Object.assign({ kind:"need", priority:2, addedFrom:"command", cycleStart:currentCycle().start },f),nowIso());
 if(f.stockPerQty) li.stockPerQty=f.stockPerQty;
 li.plannedAmount=itemEstimate(li).amount;
 activeList().items.push(li);
 activeList().updatedAt=nowIso();
 return li;
}

// "2 kilo" for a 5 kg product → 1 pack (the note keeps what was asked)
function qtyFor(parsed,product){
 let q=parsed.qty, u=parsed.unit;
 if(q===null || q===undefined) return { qty:1, note:"" };
 if(!u || u==="pcs" || u==="pack") return { qty:q, note:"" };
 let asked=q+" "+unitWord(u,q);
 if(product && product.size && product.unit){
  let per=C.convert(product.size*(product.packCount||1),product.unit,u==="L" ? "l" : u);
  if(per>0){ let packs=Math.max(1,Math.ceil(q/per-1e-9)); return { qty:packs, note:asked+" asked", packs:true, asked }; }
 }
 return { qty:q, note:asked, unit:u, asked };
}

function previewCard(o){
 let id="ap"+Date.now().toString(36)+Math.random().toString(36).slice(2,6);
 cmdActions[id]=o.actions||{};
 let state=o.state||"info";
 let tag={ done:"✅ DONE", pending:"✋ NEEDS YOUR OK", info:"💬 ANSWER" }[state];
 let btn=(act,label,cls)=>o.actions && o.actions[act] ? `<button class="${cls||"action"}" data-act="${act}" onclick="cmdAct('${id}','${act}')">${label}</button>` : "";
 return `<div class="ai-preview" id="${id}" data-intent="${esc(o.intent||"")}" data-state="${state}">
  <div class="ap-head">🤖 <b>${esc(o.title)}</b> <span class="tag ap-tag">${tag}</span></div>
  ${o.body ? `<div class="ap-body">${o.body}</div>` : ""}
  ${whyHTML(o.why)}
  <div class="ap-actions">${btn("approve","✅ Approve","primary")}${btn("undo","↩️ Undo")}${btn("edit","✏️ Edit")}${btn("optimize","⚡ Optimize")}${btn("research","🔎 Research online")}${btn("open","Open")}${btn("cancel","✕ Cancel")}</div>
 </div>`;
}

function cmdAct(id,act){
 let a=cmdActions[id] && cmdActions[id][act];
 if(!a) return;
 let finishing=act==="approve" || act==="cancel" || act==="undo";
 if(finishing){ delete cmdActions[id]; if(cmdCtx.pending && cmdCtx.pending.id===id) cmdCtx.pending=null; }
 let res=a();
 let card=$id(id);
 if(card && typeof res==="string") card.outerHTML=res;
 else if(card && finishing) card.querySelectorAll(".ap-actions button").forEach(b=>b.disabled=true);
}

function pendingCard(o,run){
 let html=previewCard(Object.assign({ state:"pending" },o,{ actions:Object.assign({},o.actions||{},{ approve:run, cancel:()=>previewCard({ intent:o.intent, title:"Cancelled — nothing changed", state:"info" }) }) }));
 let id=/id="(ap[^"]+)"/.exec(html)[1];
 cmdCtx.pending={ id, run, title:o.title };
 return html;
}

function listMatch(R,term){
 let t=Mdl.normalizeName(term);
 return openListItems().find(li=>(R.product && li.productId===R.product.id) || (R.inv && li.inventoryItemId===R.inv.id) || Mdl.normalizeName(li.name)===t || wordIn(t,Mdl.normalizeName(li.name))) || null;
}

function estimateWhy(li){
 let e=itemEstimate(li);
 return e.amount!==null ? "≈ "+money(e.amount)+" from your Price Book ("+(e.kp.storeName ? e.kp.storeName+", " : "")+e.kp.date+")." : "No price recorded yet, so it isn't counted in the list total (not enough data).";
}

function translatedWhy(parsed){
 return parsed.rawItem && parsed.item && Mdl.normalizeName(parsed.rawItem)!==Mdl.normalizeName(parsed.item) ? "\""+parsed.rawItem+"\" means "+parsed.item+"." : "";
}

function optimizeListItem(li){
 let p=li.productId ? productById(li.productId) : null;
 let lines=[];
 if(p){
  let rk=rankingFor(p);
  if(rk.best && storeById(rk.best.storeKey) && rk.rows.length>1){ li.storeId=rk.best.storeKey; lines.push("Store set to "+rk.best.storeName+". "+rk.why[0]); }
  else lines.push(rk.rows.length===1 ? "Only one store has a price — nothing to compare yet." : "No store prices yet — not enough data to pick a store.");
  let mine=C.unitPrice(latestOption(p)||{});
  let better=Mdl.substitutesFor(data.products,p).map(s=>({ s, u:C.unitPrice(latestOption(s.product)||{}) })).filter(x=>x.u.ok && mine.ok && x.u.dim===mine.dim && x.u.exact<mine.exact*0.97).sort((a,b)=>a.u.exact-b.u.exact)[0];
  if(better) lines.push("Better value: "+productTitle(better.s.product)+" "+sizeText(better.s.product)+" is "+Math.round((mine.exact-better.u.exact)/mine.exact*100)+"% cheaper per "+better.u.perLabel+" (open the product to switch).");
 }else lines.push("Link it to a Price Book product (✏️ Edit) so I can compare stores and sizes.");
 li.updatedAt=nowIso();
 save();
 return previewCard({ intent:"optimize", title:"Optimized: "+li.name, state:"done", body:li.storeId && storeById(li.storeId) ? "🏬 "+esc(storeLabel(storeById(li.storeId))) : "", why:lines });
}

function editFor(li,parsed){ return ()=>{ openListItem(li.id); sheetState.learnTerm=parsed.rawItem||parsed.item; sheetState.learnFrom=li.productId; }; }
function undoCard(intent){ return previewCard({ intent, title:"Undone", state:"info" }); }

function intentGeneral(parsed,source){
 let i=parsed.intent;
 if(i==="confirm"){
  if(!cmdCtx.pending) return { html:previewCard({ intent:i, title:"Nothing is waiting for your OK.", state:"info" }), say:"There's nothing to confirm." };
  let p=cmdCtx.pending; cmdCtx.pending=null; delete cmdActions[p.id];
  let card=$id(p.id); if(card) card.querySelectorAll(".ap-actions button").forEach(b=>b.disabled=true);
  return { html:p.run(), say:"Done." };
 }
 if(i==="cancel"){
  let p=cmdCtx.pending; cmdCtx.pending=null;
  if(p){ delete cmdActions[p.id]; let card=$id(p.id); if(card) card.querySelectorAll(".ap-actions button").forEach(b=>b.disabled=true); }
  return { html:previewCard({ intent:i, title:p ? "Cancelled — nothing changed" : "OK", state:"info" }), say:p ? "Cancelled." : "Okay." };
 }
 if(i==="budget_left"){ let a=localAnswer("how much is left"); return { html:a, say:budgetNow().state==="SETUP" ? "Set your shopping fund first." : "You can safely spend "+money(budgetNow().safeToSpend)+"." }; }
 if(i==="afford"){ let a=localAnswer("can I afford "+parsed.amount); return a ? { html:a, say:plainText(a).split(". ")[0]+"." } : null; }
 if(i==="what_low"){ let a=localAnswer2("what's low"); return a ? { html:a, say:plainText(a) } : null; }
 if(i==="forecast"){
  let f=forecastNow();
  return { html:previewCard({ intent:i, title:"Next 30 days: "+(f.projected>0 ? "≈ "+money(f.projected) : "not enough data"), state:"info", body:FC_STATUS[f.status].icon+" "+esc(FC_STATUS[f.status].label), why:f.why, actions:{ open:()=>{ goTo("forecast"); } } }),
   say:f.projected>0 ? "About "+money(f.projected)+" in the next 30 days." : "Not enough data for a forecast yet." };
 }
 if(i==="alerts"){ let n=activeAlerts().length; openAlerts(); return { html:previewCard({ intent:i, title:n ? plural(n,"alert")+" — opened the alert center" : "No new alerts", state:"info" }), say:n ? "You have "+plural(n,"alert")+"." : "No new alerts." }; }
 if(i==="plan_trip"){
  if(!openListItems().length) return { html:previewCard({ intent:i, title:"Your shopping list is empty", state:"info", why:["Add items first, then I can plan the stores."] }), say:"Your list is empty." };
  openPlanner(parsed.mode);
  return { html:previewCard({ intent:i, title:"Opened the trip planner ("+C.ROUTE_MODES[planState.mode].label+")", state:"info", actions:{ open:()=>openPlanner(planState.mode) } }), say:"Here's your trip plan." };
 }
 if(i==="spent") return intentSpent(parsed);
 return undefined;   // not a general intent
}

function intentSpent(parsed){
 let i=parsed.intent;
 let st=Mdl.findStoreByName(data.stores,parsed.store);
 let store=st ? storeLabel(st) : cap(parsed.store);
 let item=parsed.item ? cap(parsed.item) : "";
 let amount=C.round2(parsed.amount);
 let cat=guessCategory(item+" "+store);
 let warn=C.crossesHardStop(data,amount) ? ["⚠️ This takes Spent to "+money(data.spent+amount)+", past your hard stop of "+money(data.stop)+"."] : [];
 let html=pendingCard({ intent:i, title:"Record "+money(amount)+" spent"+(store ? " at "+store : "")+"?", body:item ? esc(item) : "",
  why:["Money actions always wait for your OK.","It will be added to Spent and your purchase history (category "+cat+")."].concat(warn) },()=>{
  let entry={ id:"M"+Date.now(), date:todayDay(), store, item:item||"Spending", amount, category:cat, payment:"", counted:true, via:"command" };
  data.manual.unshift(entry);
  let before=data.spent; data.spent=C.round2(data.spent+amount);
  audit("spending.add","Added spending (command): "+(item||store||"entry")+" "+money(amount),{entity:"manual",id:entry.id,delta:C.round2(data.spent-before),after:{amount,store}});
  save();
  return previewCard({ intent:i, title:"Recorded "+money(amount)+(store ? " at "+store : ""), state:"done", why:["Spent is now "+money(data.spent)+"."], actions:{ open:()=>goTo("history") } });
 });
 return { html, say:"Record "+money(amount)+(store ? " at "+store : "")+"? Say yes to confirm." };
}

function intentOutOf(parsed,R,word,why0){
 let i=parsed.intent, lines=why0.slice(), undo=[];
 if(R.inv){
  let was=C.round2(Number(R.inv.quantity)||0);
  if(was>0){ let t=changeStock(R.inv,-was,"use",{ note:"Said: "+parsed.text }); if(t) undo.push(()=>changeStock(R.inv,was,"adjust",{ note:"Undo: "+parsed.text })); lines.push("Stock set to 0 (was "+qtyText(was)+" "+(R.inv.unit||"")+")."); }
  else lines.push("It was already at 0 in your inventory.");
 }else lines.push("You don't track "+word+" in Inventory, so only the list changed.");
 let li=listMatch(R,parsed.item), added=false;
 if(!li){
  let info=R.inv ? itemInfo(R.inv) : null;
  li=addListItemQuick({ name:word, productId:R.product ? R.product.id : null, inventoryItemId:R.inv ? R.inv.id : null, qty:info ? Math.max(1,info.re.packs||1) : 1, priority:1, stockPerQty:R.inv ? R.inv.packSize||1 : null });
  added=true; lines.push("Added to your list as a high-priority need because it's out."); lines.push(estimateWhy(li));
  undo.push(()=>{ li.status="removed"; li.removedAt=nowIso(); });
 }else lines.push("It's already on your shopping list.");
 audit("command.out_of","Ran out: "+word+(added ? " (added to list)" : ""),{entity:"inventoryItems",id:R.inv ? R.inv.id : null});
 save();
 return { html:previewCard({ intent:i, title:word+" is out"+(added ? " — added to your list" : ""), state:"done", why:lines,
  actions:{ undo:()=>{ undo.reverse().forEach(f=>f()); audit("command.undo","Undid: "+parsed.text,{entity:"shoppingLists"}); save(); return undoCard(i); }, edit:editFor(li,parsed), optimize:()=>optimizeListItem(li) } }),
  say:"Okay, "+word+" is out."+(added ? " I added it to your list." : " It's already on your list.") };
}

function intentAdd(parsed,R,word,why0){
 let i=parsed.intent;
 let q=qtyFor(parsed,R.product);
 let li=listMatch(R,parsed.item);
 let lines=why0.slice(), undo;
 if(li){
  let before=li.qty;
  li.qty=C.round2(li.qty+(parsed.qty!==null && parsed.qty!==undefined ? q.qty : 1));
  li.updatedAt=nowIso();
  lines.push("It was already on your list, so I raised the quantity ("+qtyText(before)+" → "+qtyText(li.qty)+") instead of adding a duplicate.");
  if(q.packs) lines.push(q.asked+" → "+plural(q.qty,"pack")+" of "+sizeText(R.product)+" (whole packs, rounded up).");
  undo=()=>{ li.qty=before; };
 }else{
  li=addListItemQuick({ name:word, productId:R.product ? R.product.id : null, inventoryItemId:R.inv ? R.inv.id : null, qty:q.qty, note:q.note, unit:q.unit||"" });
  if(q.packs) lines.push(q.asked+" → "+plural(q.qty,"pack")+" of "+sizeText(R.product)+".");
  undo=()=>{ li.status="removed"; li.removedAt=nowIso(); };
 }
 lines.push(estimateWhy(li));
 audit("list.add","Added to list (command): "+li.name+" ×"+qtyText(li.qty),{entity:"shoppingLists",id:li.id});
 save();
 let qtyTxt=q.asked && !q.packs ? q.asked : (li.qty!==1 ? "×"+qtyText(li.qty) : "");
 return { html:previewCard({ intent:i, title:"Added "+li.name+(qtyTxt ? " ("+qtyTxt+")" : "")+" to your list", state:"done", why:lines,
  actions:{ undo:()=>{ undo(); save(); return undoCard(i); }, edit:editFor(li,parsed), optimize:()=>optimizeListItem(li) } }),
  say:"Added "+(parsed.qty ? (q.asked||qtyText(parsed.qty))+" " : "")+(R.product || R.inv ? word : parsed.item)+" to your list." };
}

function intentStock(parsed,R,word,why0){
 let i=parsed.intent;
 if(!R.inv) return { html:previewCard({ intent:i, title:"I don't track "+word+" in Inventory yet", state:"info", why:why0.concat(["Add it once and I'll keep count."]), actions:{ open:()=>openInvItem(null,{ name:cap(parsed.item) }) } }), say:"I don't track "+word+" yet." };
 let qn=parsed.qty!==null && parsed.qty!==undefined ? parsed.qty : 1;
 if(parsed.unit && R.inv.unit){ let f=C.convert(qn,parsed.unit==="L" ? "l" : parsed.unit,R.inv.unit); if(f!==null) qn=C.round2(f); }
 let t=changeStock(R.inv,i==="used" ? -qn : qn,i==="used" ? "use" : "add",{ note:"Said: "+parsed.text });
 save();
 return { html:previewCard({ intent:i, title:word+": "+(i==="used" ? "used " : "added ")+qtyText(Math.abs(t ? t.qty : 0))+" "+(R.inv.unit||""), state:"done", why:why0.concat(["Now "+qtyText(R.inv.quantity)+" "+(R.inv.unit||"")+" at home."]),
  actions:{ undo:()=>{ if(t) changeStock(R.inv,-t.qty,"adjust",{ note:"Undo: "+parsed.text }); save(); return undoCard(i); } } }),
  say:word+": "+qtyText(R.inv.quantity)+" "+(R.inv.unit||"")+" left." };
}

function intentRemove(parsed,R,word,why0){
 let i=parsed.intent;
 let li=listMatch(R,parsed.item);
 if(!li) return { html:previewCard({ intent:i, title:word+" isn't on your list", state:"info" }), say:word+" isn't on your list." };
 let html=pendingCard({ intent:i, title:"Remove "+li.name+" from your list?", why:why0.concat(["Removing is a destructive change, so it waits for your OK. You can bring it back later."]) },()=>{
  removeListItem(li.id);
  return previewCard({ intent:i, title:"Removed "+li.name, state:"done", actions:{ undo:()=>{ restoreListItem(li.id); return previewCard({ intent:i, title:"Brought back "+li.name, state:"info" }); } } });
 });
 return { html, say:"Remove "+li.name+"? Say yes to confirm." };
}

function intentPrice(parsed,R,why0,source){
 let i=parsed.intent;
 let research=q=>()=>{ submitRequest(q,source==="voice" ? "voice" : "text"); goTo("shopping"); };
 if(!R.product){
  let q=i==="where_buy" ? "Where to buy "+parsed.item+" cheapest in the Philippines" : (i==="buy_advice" ? "Should I buy "+parsed.item+" now or wait for a better price in the Philippines?" : "Current price of "+parsed.item+" in the Philippines");
  return { html:previewCard({ intent:i, title:"No prices recorded for "+parsed.item+" yet", state:"info", why:why0.concat(["Not enough data in your Price Book. I can search online (uses one AI research request)."]), actions:{ research:research(q) } }),
   say:"I have no prices for "+parsed.item+" yet." };
 }
 let p=R.product;
 if(i==="where_buy"){
  let rk=rankingFor(p);
  if(!rk.best) return { html:previewCard({ intent:i, title:"No store prices for "+productTitle(p)+" yet", state:"info", why:rk.why, actions:{ open:()=>openProduct(p.id) } }), say:"No store prices yet." };
  let title=rk.rows.length>1 ? "Cheapest: "+rk.best.storeName+" · "+money(rk.best.value)+(rk.best.per ? "/"+rk.best.per : "") : "Only price: "+rk.best.storeName+" · "+money(rk.best.value)+(rk.best.per ? "/"+rk.best.per : "");
  return { html:previewCard({ intent:i, title, state:"info", body:rk.rows.slice(0,3).map(r=>`${esc(r.storeName)} ${money(r.value)}${r.per ? "/"+esc(r.per) : ""} <small class="muted">${esc(r.freshness.text)}</small> ${psBadge(r.status)}`).join("<br>"), why:why0.concat(rk.why), actions:{ open:()=>openProduct(p.id) } }),
   say:(rk.rows.length>1 ? "Cheapest at "+rk.best.storeName+", " : "Only "+rk.best.storeName+" so far, ")+money(rk.best.value)+(rk.best.per ? " per "+rk.best.per : "")+", "+rk.best.freshness.text+"." };
 }
 let adv=adviceFor(p), ai=C.BUY_ADVICE[adv.verdict];
 if(i==="price_of"){
  let recs=sortByWhen(realRecords(p)), last=recs[recs.length-1];
  if(!last) return { html:previewCard({ intent:i, title:"No price recorded for "+productTitle(p)+" yet", state:"info", why:["Not enough data."], actions:{ research:research("Current price of "+productTitle(p)+" in the Philippines") } }), say:"No price recorded yet." };
  let f=C.freshness(last.date,todayDay());
  return { html:previewCard({ intent:i, title:productTitle(p)+": "+money(itemPriceOf(last))+" at "+(storeLabel(resolveStore(last.storeId,last.storeName))||last.storeName||"—"), state:"info",
   body:priceStatusBadge(last)+" · "+esc(f.text)+` · <span class="advice adv-${adv.verdict.toLowerCase()}">${ai.icon} ${esc(ai.label)}</span>`, why:why0.concat(adv.why), actions:{ open:()=>openProduct(p.id) } }),
   say:productTitle(p)+" was "+money(itemPriceOf(last))+", "+f.text+"." };
 }
 return { html:previewCard({ intent:i, title:ai.icon+" "+ai.label+": "+productTitle(p), state:"info", why:why0.concat(adv.why), actions:{ open:()=>openProduct(p.id) } }),
  say:ai.label.toLowerCase()+". "+(adv.why[0]||"") };
}

function runIntent(parsed,source){
 let g=intentGeneral(parsed,source);
 if(g!==undefined) return g;
 let R=resolveParsed(parsed);
 let word=R.inv ? R.inv.name : (R.product ? productTitle(R.product) : cap(parsed.item));
 let why0=[translatedWhy(parsed),howText(R)].filter(Boolean);
 let i=parsed.intent;
 if(i==="out_of") return intentOutOf(parsed,R,word,why0);
 if(i==="add_to_list") return intentAdd(parsed,R,word,why0);
 if(i==="used" || i==="restock") return intentStock(parsed,R,word,why0);
 if(i==="remove_from_list") return intentRemove(parsed,R,word,why0);
 if(i==="do_i_need"){ let a=localAnswer2("do i need "+(R.inv ? R.inv.name : parsed.item)); return a ? { html:a, say:plainText(a) } : null; }
 if(["where_buy","price_of","buy_advice"].includes(i)) return intentPrice(parsed,R,why0,source);
 return null;
}

// Command bar + voice: returns { html, say } or null (→ AI research, as before).
function handleCommand(text,source){
 if(!window.JasonNLU) return null;
 let parsed=JasonNLU.parse(text,cmdCtx);
 if(!parsed) return null;
 let out=null;
 try{ out=runIntent(parsed,source); }catch(e){ console.warn("command",e); out=null; }
 if(!out) return null;
 if(parsed.item) cmdCtx.lastItem=parsed.item;
 if(parsed.unit) cmdCtx.lastUnit=parsed.unit;
 if(!["confirm","cancel"].includes(parsed.intent)) cmdCtx.lastIntent=parsed.intent;
 return out;
}

// Voice: answer on the phone when possible (free) with a short spoken reply.
function voiceLocal(text){
 let a=localAnswer(text), say=null;
 if(a) say=plainText(a).split(". ").slice(0,2).join(". ");
 else { let r=handleCommand(text,"voice"); if(r){ a=r.html; say=r.say; } }
 if(!a) return null;
 let box=$id("cmdAnswer");
 if(box){ box.innerHTML=a; box.classList.remove("hidden"); }
 if(say) speak(say);
 return { say };
}

/* =====================================================================
   SETTINGS · HOME CARDS · RENDER HOOK
   ===================================================================== */

function settings3HTML(){
 let f=setting3("fund"), pa=setting3("priceAlerts"), rc=setting3("recurring"), L=learning();
 return `<div class="card" id="s3Card"><h3 class="card-title">🧠 Smart features</h3>
  <div class="two"><div><label for="s3Expensive">Fund check from ₱</label><input id="s3Expensive" inputmode="decimal" value="${esc(String(f.expensiveAt))}"></div>
  <div><label for="s3Drop">Price-drop alert at %</label><input id="s3Drop" inputmode="decimal" value="${esc(String(pa.dropPct))}"></div></div>
  <div class="two"><div><label for="s3Days">Commit recurring (days before)</label><input id="s3Days" inputmode="numeric" value="${esc(String(rc.autoCommitDaysBefore))}"></div>
  <div><label>&nbsp;</label><label class="check"><input type="checkbox" id="s3Alerts" ${pa.enabled!==false ? "checked" : ""}> Price alerts on</label></div></div>
  <div id="s3Msg" class="form-msg"></div>
  <button class="action wide" id="s3Save" onclick="saveSettings3()">Save</button>
  <div class="field-note">Route settings (time between stores, your time value, fuel) are in the trip planner: Shop → List → 🧭 Plan trip → ✏️ Edit.</div>
  <div class="field-note">Learned from your corrections: ${Object.keys(L.terms).length} word${Object.keys(L.terms).length===1 ? "" : "s"}, ${Object.keys(L.storePrefs).length} usual store${Object.keys(L.storePrefs).length===1 ? "" : "s"}. <button class="link" onclick="resetLearning()">Forget</button></div></div>`;
}
function saveSettings3(){
 let e=C.num(val("s3Expensive")), d=C.num(val("s3Drop")), n=C.num(val("s3Days"));
 let m=$id("s3Msg");
 if(!(e>=0) || !(d>0 && d<100) || !(n>=0 && n<=60 && Math.floor(n)===n)){ m.innerText="Use: amount 0 or more · drop 1–99% · days 0–60."; m.className="form-msg err"; return; }
 data.settings.fund=Object.assign({},setting3("fund"),{ expensiveAt:e });
 data.settings.priceAlerts=Object.assign({},setting3("priceAlerts"),{ dropPct:d, enabled:$id("s3Alerts").checked });
 data.settings.recurring=Object.assign({},setting3("recurring"),{ autoCommitDaysBefore:n });
 audit("settings.smart","Smart feature settings updated",{entity:"settings",after:{fund:data.settings.fund,priceAlerts:data.settings.priceAlerts,recurring:data.settings.recurring}});
 processRecurring();
 save(); toast("✅ Saved");
}
function resetLearning(){
 if(!confirm("Forget the words and usual stores Jason Shop learned from your corrections? (Your data and history stay.)")) return;
 let L=learning();
 L.corrections.push({ type:"reset", before:{ terms:L.terms, storePrefs:L.storePrefs, routeModeCounts:L.routeModeCounts }, at:nowIso() });
 L.terms={}; L.storePrefs={}; L.routeModeCounts={};
 audit("learning.reset","Learned corrections cleared",{entity:"learning"});
 save();
}

function homeCards3(){
 let out=[];
 let act=activeAlerts().slice().reverse();
 if(act.length){
  out.push(`<div class="card" id="homeAlertCenter"><div class="card-head"><b>🔔 Alerts (${act.length})</b><button class="link" onclick="openAlerts()">Open</button></div>
   ${act.slice(0,3).map(a=>`<div class="row-line"><span>${esc(a.title)}</span></div>`).join("")}</div>`);
 }
 let f=forecastNow();
 if(f.projected>0){
  let st=FC_STATUS[f.status];
  out.push(`<div class="card tap-lite" id="homeForecast" onclick="goTo('forecast')"><div class="card-head"><b>📈 Next 30 days</b><span class="link">Details</span></div>
   <div class="row-line"><span>Projected spending</span><b>${money(f.projected)}</b></div>
   <div class="muted small">${st.icon} ${esc(st.label)}${f.endSafe!==null ? " · "+C.limitText(f.endSafe)+" left after" : ""}</div></div>`);
 }
 return out;
}

let stage3State={ recDay:null };
function renderStage3Active(){
 if(stage3State.recDay!==todayDay()){
  stage3State.recDay=todayDay();
  if(processRecurring()) setTimeout(()=>render(),0);
 }
 scanAlerts();
 renderBell();
 if(ui.view==="budget" && ui.sub.budget==="forecast") renderForecast();
 if(ui.view==="more" && ui.sub.more==="recurring") renderRecurring();
 if(ui.view==="more" && ui.sub.more==="settings"){ let s=$id("settings3"); if(s) s.innerHTML=settings3HTML(); }
}

/* Learn from Edit corrections made after a command (e.g. "bigas" linked to the wrong product). */
if(typeof saveListItem==="function"){
 const saveListItemStage2=saveListItem;
 saveListItem=function(){
  let term=sheetState.learnTerm, from=sheetState.learnFrom, liId=sheetState.liId;
  saveListItemStage2();
  if(term && liId){
   let li=listItemById(liId);
   if(li && li.productId && li.productId!==from){ learnTerm(term,li.productId,li.name); storeData(); }
  }
 };
}
