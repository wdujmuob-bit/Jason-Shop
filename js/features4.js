/* =====================================================================
   JASON SHOP — STAGE 4: ANALYTICS & FINISHING TOUCHES
   Insights (spending trends, basket price index, savings, store
   performance, usage & waste, accuracy, unusual spending), CSV/PDF export,
   one-tap monthly AI summary, universal search, trip history, product
   pages, preferences, people & roles (no login), household requests,
   receipt archive, "throw out" tracking and recalculation after restore.
   All math lives in js/calc.js. Nothing here invents a number: when data
   is thin the screens say "not enough data".
   ===================================================================== */

let s4State={ day:null, insKey:null, productId:null, archive:{ q:"", month:"all", store:"all", show:"all" }, reqTab:"pending", custom:null };
let lastExport=null;

/* ---------- small helpers ---------- */

function prefs(){ return Object.assign({},Mdl.DEFAULT_SETTINGS.preferences,data.settings && data.settings.preferences); }
function peopleList(){ return (data.people||[]).filter(p=>p && !p.archived); }
function personById(id){ return (data.people||[]).find(p=>p && p.id===id) || null; }
function actingPerson(){ return personById(data.settings && data.settings.activePersonId) || peopleList().find(p=>p.role==="owner") || null; }
function allowed(perm){ let p=actingPerson(); return p ? Mdl.can(p,perm) : true; }
function roleBadge(p){ let r=Mdl.ROLES[p.role]||Mdl.ROLES.viewer; return `<span class="tag role-${esc(p.role)}">${r.icon} ${esc(r.label.split(" (")[0])}</span>`; }
function entryStore(e){ let s=resolveStore(null,e.store); return s ? storeLabel(s) : String(e.store||"").trim(); }
function analyticsEntries(){ return historyEntries().map(e=>Object.assign({},e,{ store:entryStore(e) })); }
function skeletonHTML(n,id){ return `<div class="skeleton-wrap"${id ? ' id="'+id+'"' : ""} aria-busy="true" aria-label="Loading">${Array.from({length:n||3},()=>'<div class="card skeleton"><i></i><i></i><i class="short"></i></div>').join("")}</div>`; }
function pctText(v,signed){ if(v===null || v===undefined) return "—"; let r=Math.round(v*10)/10; return (signed && r>0 ? "+" : "")+r+"%"; }
function realPriceRecords(){ return (data.priceRecords||[]).filter(r=>r && !r.archived && r.productId && r.source!=="ai_estimate" && C.num(r.price)>0 && !(r.needsReview && r.matchConfidence==="review") && productById(r.productId)); }
function itemUnitValue(it){
 let kp=it && it.productId ? knownItemPrice(it.productId) : null;
 return kp ? C.round2(kp.price/(C.num(it.packSize)>0 ? C.num(it.packSize) : 1)) : null;
}

/* ---------- inline SVG charts (no libraries) ---------- */

function svgBars(items,opts){
 let o=opts||{}, n=items.length;
 if(!n) return "";
 let W=Math.max(300,n*48), H=o.height||150, top=18, bottom=22, ch=H-top-bottom;
 let max=Math.max.apply(null,items.map(i=>Number(i.value)||0).concat([0.0001]));
 let bw=Math.min(36,(W/n)*0.62);
 let bars=items.map((it,i)=>{
  let v=Math.max(0,Number(it.value)||0), h=Math.max(v>0 ? 2 : 0,ch*v/max);
  let cx=(i+0.5)*W/n, y=top+ch-h;
  return `<g><rect x="${(cx-bw/2).toFixed(1)}" y="${y.toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}" rx="5" class="${it.cls||"bar-fill"}"><title>${esc(it.label)}: ${esc(it.text||String(v))}</title></rect>
   ${v>0 ? `<text x="${cx.toFixed(1)}" y="${(y-5).toFixed(1)}" class="svg-val" text-anchor="middle">${esc(it.short||it.text||"")}</text>` : ""}
   <text x="${cx.toFixed(1)}" y="${H-6}" class="svg-lbl" text-anchor="middle">${esc(it.label)}</text></g>`;
 }).join("");
 return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(o.label||"Bar chart")}" preserveAspectRatio="xMidYMid meet"><line x1="0" y1="${top+ch}" x2="${W}" y2="${top+ch}" class="svg-axis"/>${bars}</svg>`;
}

// points: [{y, t (0..1, optional), label, tip, cls}]
function svgLine(points,opts){
 let o=opts||{};
 let pts=points.filter(p=>p.y!==null && p.y!==undefined && isFinite(p.y));
 if(pts.length<1) return "";
 let W=320, H=o.height||150, padL=8, padR=8, top=16, bottom=22;
 let ys=pts.map(p=>p.y).concat(o.baseline!==undefined ? [o.baseline] : []);
 let min=Math.min.apply(null,ys), max=Math.max.apply(null,ys);
 if(max-min<1e-9){ max+=1; min-=1; }
 let pad=(max-min)*0.12; min-=pad; max+=pad;
 let xs=pts.map((p,i)=>p.t!==undefined ? p.t : (pts.length===1 ? 0.5 : i/(pts.length-1)));
 let X=t=>padL+t*(W-padL-padR), Y=v=>top+(1-(v-min)/(max-min))*(H-top-bottom);
 let path=pts.map((p,i)=>(i ? "L" : "M")+X(xs[i]).toFixed(1)+" "+Y(p.y).toFixed(1)).join(" ");
 let base=o.baseline!==undefined ? `<line x1="${padL}" x2="${W-padR}" y1="${Y(o.baseline).toFixed(1)}" y2="${Y(o.baseline).toFixed(1)}" class="svg-base"/><text x="${W-padR}" y="${(Y(o.baseline)-4).toFixed(1)}" text-anchor="end" class="svg-lbl">${esc(o.baseLabel||String(o.baseline))}</text>` : "";
 let dots=pts.map((p,i)=>`<circle cx="${X(xs[i]).toFixed(1)}" cy="${Y(p.y).toFixed(1)}" r="4" class="svg-dot ${p.cls||""}"><title>${esc(p.tip||p.label||String(p.y))}</title></circle>`).join("");
 // Axis labels: first and last always; others only when they don't crowd the previous one.
 let keep=[];
 if(o.labels) pts.forEach((p,i)=>{
  if(!p.label) return;
  let x=X(xs[i]), last=i===pts.length-1;
  while(last && keep.length && x-keep[keep.length-1].x<38 && keep[keep.length-1].i!==0) keep.pop();
  if(!keep.length || x-keep[keep.length-1].x>=38 || (last && keep.length===1 && x-keep[0].x>=24)) keep.push({ i, x });
 });
 let labels=keep.map(({i,x})=>`<text x="${x.toFixed(1)}" y="${H-6}" class="svg-lbl" text-anchor="${i===0 && pts.length>1 ? "start" : (i===pts.length-1 && pts.length>1 ? "end" : "middle")}">${esc(pts[i].label)}</text>`).join("");
 return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(o.label||"Line chart")}">${base}<path d="${path}" class="svg-line"/>${dots}${labels}</svg>`;
}

function hbarRows(rows,fmt){
 let max=Math.max.apply(null,rows.map(r=>r.total).concat([0.0001]));
 return rows.map(r=>`<div class="bar-row"><div class="lbl"><span>${esc(r.name)}</span><span><b>${money(r.total)}</b> <small class="muted">${pctText(r.share)}</small></span></div>
  <div class="bar"><span class="u-safe" style="width:${Math.max(1,r.total/max*100).toFixed(1)}%"></span></div>${fmt ? `<small class="muted">${fmt(r)}</small>` : ""}</div>`).join("");
}
function info4(id){ return (data.inventoryItems||[]).find(i=>i.id===id) || null; }
function shortMoney(v){ v=Number(v)||0; return v>=1000000 ? "₱"+(Math.round(v/100000)/10)+"M" : (v>=1000 ? "₱"+(Math.round(v/100)/10)+"k" : "₱"+Math.round(v)); }

/* =====================================================================
   INSIGHTS (Budget → Insights)
   ===================================================================== */

function insightsRange(){
 if(s4State.custom) return C.insightRange(s4State.custom,todayDay());
 let es=historyEntries().filter(e=>e.counted && e.date).map(e=>e.date).sort();
 return C.insightRange(prefs().insightsRange,todayDay(),es[0]||todayDay());
}

function budgetPeriodsIn(range){
 let out=[], cur=currentPeriod(), today=todayDay();
 let p=C.periodRange(data.settings.budgetPeriod,C.addDays(cur.start,-1));
 for(let i=0;i<36 && p.end>=range.start;i++){
  if(p.end<today) out.push({ start:p.start, end:p.end });
  p=C.periodRange(data.settings.budgetPeriod,C.addDays(p.start,-1));
 }
 return out.reverse();
}

function insightsData(range){
 let entries=analyticsEntries();
 let today=todayDay();
 let recs=realPriceRecords();
 let basket=C.basketIndex(recs.map(r=>({ productId:r.productId, name:productTitle(productById(r.productId)), date:r.date, value:itemPriceOf(r) })),{ range });
 let hist=recs.map(r=>({ id:r.id, productId:r.productId, date:r.date, at:r.createdAt, value:itemPriceOf(r), store:storeLabel(resolveStore(r.storeId,r.storeName))||r.storeName||"" }));
 let bought=recs.filter(r=>(r.source==="purchase" || r.source==="receipt") && C.inRange(r.date,range)).map(r=>({ id:r.id, productId:r.productId, name:productTitle(productById(r.productId)), date:r.date, at:r.createdAt,
  value:itemPriceOf(r), paid:C.num(r.price), store:storeLabel(resolveStore(r.storeId,r.storeName))||r.storeName||"" }));
 let savings=C.savingsFromPrices(bought,hist);
 let comps=(data.products||[]).filter(p=>!p.archived).map(p=>({ productId:p.id, rows:rankingFor(p).rows.map(r=>({ store:r.storeName, value:r.value })) })).filter(c=>c.rows.length>=2);
 let stores=C.storePerformance(entries,comps,range);
 let info={};
 (data.inventoryItems||[]).forEach(it=>{ info[it.id]={ name:it.name, unitValue:itemUnitValue(it), unit:it.unit }; });
 let usage=C.usageAnalytics(data.inventoryTransactions||[],info,range,today);
 let cycles=C.cycleAccuracy((data.shoppingCycles||[]).filter(c=>c.end>=range.start && c.start<=range.end));
 let cats=(data.budgetCategories||[]).map(c=>({ id:c.id, name:c.name }));
 let plan=C.planAccuracy(budgetPeriodsIn(range),data.planHistory||[],cats,entries);
 let fc=C.forecastAccuracy((data.forecastSnapshots||[]).filter(s=>s.end>=range.start),entries,today);
 let unusual=C.unusualSpending(entries,range);
 return { range, trends:C.spendingTrends(entries,range), basket, savings, stores, usage, cycles, plan, fc, unusual, entries };
}

function setInsightsRange(k){
 if(!Mdl.INSIGHT_RANGES[k]) return;
 s4State.custom=null;
 data.settings.preferences=Object.assign(prefs(),{ insightsRange:k });
 storeData();
 s4State.insKey=null;
 renderInsights();
}

function insightsKey(range){
 return [range.start,range.end,(data.auditLog||[]).length,(data.priceRecords||[]).length,(data.inventoryTransactions||[]).length,(data.manual||[]).length,(data.receipts||[]).length,(data.requests||[]).length,data.spent,(data.forecastSnapshots||[]).length].join("|");
}

function renderInsights(){
 let box=$id("insightsBody");
 if(!box) return;
 let range=insightsRange();
 let key=insightsKey(range);
 if(s4State.insKey===key && box.querySelector("#insTotals,#insEmpty")) return;
 s4State.insKey=key;
 let chips=Object.entries(Mdl.INSIGHT_RANGES).map(([k,l])=>`<button class="chip${!s4State.custom && prefs().insightsRange===k ? " on" : ""}" data-range="${k}" onclick="setInsightsRange('${k}')">${esc(l)}</button>`).join("");
 box.innerHTML=`<div class="chips ins-range" id="insRange">${chips}${s4State.custom ? `<button class="chip on" onclick="setInsightsRange(prefs().insightsRange)">${esc(shortDay(range.start))} – ${esc(shortDay(range.end))} ✕</button>` : ""}</div>${skeletonHTML(3,"insLoading")}`;
 setTimeout(()=>{
  if(s4State.insKey!==key || !$id("insLoading")) return;
  let html;
  try{ html=insightsHTML(insightsData(range)); }
  catch(err){ console.warn("insights",err); html=emptyState("⚠️","Couldn't build insights","Something in the data couldn't be read. Run More → Data & Backup → Data check.",""); }
  let l=$id("insLoading"); if(l) l.outerHTML=html;
 },0);
}

function insightsHTML(d){
 let t=d.trends, r=d.range;
 if(!t.count && !realPriceRecords().length && !(data.inventoryTransactions||[]).length){
  return `<div id="insEmpty">${emptyState("📊","No data to analyse yet","Insights are built only from what you record: receipts, purchases, trips, prices and stock changes. Scan a receipt or finish a shopping trip to get started.",`<button class="action" onclick="receiptCamera()">🧾 Scan a receipt</button>`)}</div>`+exportCardHTML();
 }
 let out=[];
 let ch=t.changePct;
 out.push(`<div class="card ins-hero" id="insTotals">
  <div class="ins-tiles">
   <div><small>Spent</small><b id="insTotal">${money(t.total)}</b><small>${plural(t.count,"entry","entries")}</small></div>
   <div><small>Per day</small><b>${t.dailyAvg===null ? "—" : money(t.dailyAvg)}</b><small>${plural(r.days,"day")}</small></div>
   <div><small>vs previous</small><b class="${ch===null ? "" : (ch>0 ? "red" : "green")}" id="insChange">${ch===null ? "—" : pctText(ch,true)}</b><small>${ch!==null ? money(t.prevTotal)+" before" : "not enough data"}</small></div>
  </div>
  <div class="field-note">${esc(shortDay(r.start))} – ${esc(shortDay(r.end))} · counted spending only (receipts not added to Spent are left out).</div></div>`);

 out.push(`<div class="card" id="insMonths"><h3 class="card-title">📅 Spending by month</h3>
  ${t.count ? svgBars(t.months.map(m=>({ label:m.label, value:m.total, text:money(m.total), short:shortMoney(m.total) })),{ label:"Spending by month" }) : '<p class="muted">No counted spending in this range.</p>'}</div>`);
 out.push(`<div class="card" id="insCategories"><h3 class="card-title">🗂️ By category</h3>${t.byCategory.length ? hbarRows(t.byCategory.slice(0,8),x=>plural(x.count,"entry","entries")) : '<p class="muted">Nothing yet.</p>'}</div>`);
 out.push(`<div class="card" id="insStoresSpend"><h3 class="card-title">🏬 By store</h3>${t.byStore.length ? hbarRows(t.byStore.slice(0,8),x=>plural(x.visits,"visit")) : '<p class="muted">Nothing yet.</p>'}</div>`);

 let b=d.basket;
 out.push(`<div class="card" id="insBasket"><h3 class="card-title">🧺 My basket price index</h3>
  ${b.latest ? `<div class="big-num ${b.latest.changePct>0 ? "red" : (b.latest.changePct<0 ? "green" : "")}" id="insBasketChange">${pctText(b.latest.changePct,true)}</div>
   <div class="muted small">Prices of ${plural(b.latest.products,"item")} you buy regularly, ${esc(b.latest.label)} vs ${esc(b.baseLabel)} (${esc(b.baseLabel)} = 100 → now ${b.latest.index}).</div>
   ${svgLine(b.months.filter(m=>m.index!==null).map(m=>({ y:m.index, label:m.label, tip:m.label+": "+m.index+" ("+m.products+" items)" })),{ baseline:100, baseLabel:"100 = "+b.baseLabel, labels:true, label:"Basket price index" })}
   <table class="tbl"><tr><th>Item</th><th class="num">${esc(b.baseLabel)}</th><th class="num">Now</th><th class="num">Change</th></tr>
   ${b.items.slice(0,6).map(i=>`<tr><td>${esc(i.name)}</td><td class="num">${money(i.baseValue)}</td><td class="num">${money(i.latestValue)}</td><td class="num ${i.changePct>0 ? "red" : (i.changePct<0 ? "green" : "")}">${pctText(i.changePct,true)}</td></tr>`).join("")}</table>`
   : `<div class="not-enough" id="insBasketNE">📉 Not enough data</div>`}
  ${whyHTML(b.why)}</div>`);

 let s=d.savings;
 out.push(`<div class="card" id="insSavings"><h3 class="card-title">💚 Savings achieved</h3>
  ${s.notEnough ? `<div class="not-enough" id="insSavingsNE">Not enough data</div>` : `<div class="ins-tiles">
   <div><small>Saved</small><b class="green" id="insSaved">${money(s.saved)}</b></div>
   <div><small>Paid more</small><b class="red" id="insPaidMore">${money(s.paidMore)}</b></div>
   <div><small>Net</small><b class="${s.net>=0 ? "green" : "red"}" id="insNet">${s.net<0 ? "−"+money(-s.net) : money(s.net)}</b></div></div>
   ${s.lines.slice(0,6).map(l=>`<div class="row-line"><span>${esc(l.name)} <small class="muted">${money(l.before)} → ${money(l.after)} each · ${esc(shortDay(l.date))}</small></span><b class="${l.diff>=0 ? "green" : "red"}">${l.diff>=0 ? "+"+money(l.diff) : "−"+money(-l.diff)}</b></div>`).join("")}`}
  ${whyHTML(s.why)}</div>`);

 let sp=d.stores.stores.filter(x=>x.spend>0 || x.compared>0);
 let prefNames=prefs().preferredStores.map(id=>storeLabel(storeById(id))).filter(Boolean);
 out.push(`<div class="card" id="insStorePerf"><h3 class="card-title">🏆 Store performance</h3>
  ${sp.length ? `<div class="tbl-wrap"><table class="tbl"><tr><th>Store</th><th class="num">Spent</th><th class="num">Visits</th><th class="num">Avg basket</th><th class="num">Cheapest</th></tr>
   ${sp.slice(0,10).map(x=>`<tr data-store="${esc(x.name)}"><td>${prefNames.includes(x.name) ? "⭐ " : ""}${esc(x.name)}</td><td class="num">${money(x.spend)}</td><td class="num">${x.visits}</td><td class="num">${x.avgBasket===null ? "—" : money(x.avgBasket)}</td><td class="num">${x.compared ? x.wins+"/"+x.compared+(x.avgPremiumPct ? "<br><small>+"+Math.round(x.avgPremiumPct)+"% avg</small>" : "") : "—"}</td></tr>`).join("")}</table></div>
   <div class="field-note">Cheapest = how often this store had the lowest latest price for products priced at 2+ stores; "+x% avg" is how much dearer it was on average.</div>` : '<p class="muted">No store spending recorded in this range.</p>'}
  ${whyHTML(d.stores.why)}</div>`);

 let u=d.usage;
 out.push(`<div class="card" id="insUsage"><h3 class="card-title">📦 Usage, waste & stock-outs</h3>
  ${(data.inventoryTransactions||[]).length ? `<div class="ins-tiles">
   <div><small>Thrown out</small><b class="${u.wasteValue>0 ? "red" : ""}" id="insWaste">${money(u.wasteValue)}${u.wasteUnpriced ? "+" : ""}</b><small>${plural(u.waste.length,"item")}</small></div>
   <div><small>Expired</small><b id="insExpired">${money(u.expiredValue)}</b><small>lost to expiry</small></div>
   <div><small>Stock-outs</small><b id="insStockouts">${u.stockouts}</b><small>${plural(u.daysOut,"day")} without</small></div></div>
   ${u.waste.slice(0,5).map(w=>`<div class="row-line"><span>🗑️ ${esc(w.name)} <small class="muted">${qtyText(w.wasted)} thrown out${w.expired ? " ("+qtyText(w.expired)+" expired)" : ""}</small></span><b>${w.wastePriced ? money(w.wasteValue) : "no price"}</b></div>`).join("")}
   ${u.stockoutItems.slice(0,5).map(w=>`<div class="row-line"><span>⛔ ${esc(w.name)} <small class="muted">ran out ${plural(w.stockouts,"time")}${w.stillOut ? " · still out" : ""}</small></span><b>${plural(w.daysOut,"day")}</b></div>`).join("")}
   ${u.usedItems.length ? `<details><summary>Most used (${u.usedItems.length})</summary>${u.usedItems.slice(0,8).map(w=>`<div class="row-line"><span>${esc(w.name)}</span><b>${qtyText(w.used)} ${esc((info4(w.itemId)||{}).unit||"")}</b></div>`).join("")}</details>` : ""}
   <div class="field-note">Use 🗑️ Throw out on an inventory item to record waste with a reason. Peso loss uses the last price you paid.</div>`
   : '<div class="not-enough">Not enough data</div><p class="muted">Track items in Inventory to see usage, waste and stock-outs.</p>'}
  ${whyHTML(u.why)}</div>`);

 out.push(`<div class="card" id="insAccuracy"><h3 class="card-title">🎯 Plan & forecast accuracy</h3>
  <div class="acc-row"><span>🔁 Shopping cycles</span><b id="insCycleAcc">${d.cycles.average===null ? "Not enough data" : d.cycles.average+"%"}</b></div>
  ${d.cycles.rows.filter(x=>x.acc).slice(-4).map(x=>`<div class="row-line"><span><small>${esc(shortDay(x.start))} – ${esc(shortDay(x.end))}</small></span><small>${money(x.planned)} planned → ${money(x.actual)} · ${x.acc.accuracyPct}%</small></div>`).join("")}
  <div class="acc-row"><span>📊 Budget plan by category</span><b id="insPlanAcc">${d.plan.average===null ? "Not enough data" : d.plan.average+"%"}</b></div>
  ${d.plan.categories.slice(0,8).map(c=>`<div class="row-line"><span><small>${esc(c.category)}</small></span><small>${money(c.planned)} planned → ${money(c.actual)} · ${c.average===null ? "—" : c.average+"%"}</small></div>`).join("")}
  <div class="acc-row"><span>📈 30-day forecast</span><b id="insFcAcc">${d.fc.average===null ? "Not enough data" : d.fc.average+"%"}</b></div>
  ${d.fc.rows.slice(-3).map(x=>`<div class="row-line"><span><small>${esc(shortDay(x.start))} – ${esc(shortDay(x.end))}</small></span><small>${money(x.projected)} forecast → ${money(x.actual)} · ${x.acc ? x.acc.accuracyPct+"%" : "—"}</small></div>`).join("")}
  ${whyHTML(d.cycles.why.concat(d.plan.why,d.fc.why))}</div>`);

 let un=d.unusual;
 out.push(`<div class="card" id="insUnusual"><h3 class="card-title">🚩 Unusual spending</h3>
  ${un.flags.length ? un.flags.slice(0,8).map(f=>`<div class="flag-row sev-${f.severity}" data-kind="${f.kind}"><b>${f.kind==="big_purchase" ? "💸" : (f.kind==="category_spike" ? "📈" : "👯")} ${esc(f.title)} · ${money(f.amount)}</b><small>${esc(f.why)}</small></div>`).join("")
   : `<p class="muted" id="insNoFlags">${un.checked ? "Nothing unusual found in "+plural(un.checked,"entry","entries")+"." : "No spending to check in this range."}</p>`}
  ${whyHTML(un.why)}</div>`);

 out.push(aiCardHTML());
 out.push(exportCardHTML());
 return out.join("");
}

/* ---------- monthly AI summary: one call, only when tapped ---------- */

function aiCardHTML(){
 let m=s4State.aiMonth||thisMonth();
 let saved=(data.reportSummaries||{})["insights:"+m];
 return `<div class="card" id="insAI"><h3 class="card-title">✨ AI summary of a month</h3>
  <div class="month-bar"><button onclick="shiftInsightsMonth(-1)" aria-label="Previous month">◀</button><input id="insAIMonth" type="month" value="${esc(m)}" onchange="setInsightsMonth(this.value)" aria-label="Summary month"><button onclick="shiftInsightsMonth(1)" aria-label="Next month">▶</button></div>
  <div id="insAIBox" class="summary-box${saved ? "" : " hidden"}" aria-live="polite">${saved ? esc(saved.text)+`<small class="muted">Written ${esc(fmtDateTime(saved.at))}</small>` : ""}</div>
  <button class="action wide" id="insAIBtn" onclick="insightsAISummary()">${saved ? "🔄 Write again" : "✨ Write AI summary"}</button>
  <div class="field-note">Optional. Uses one AI request only when you tap, and sends just this month's totals and the facts above — no receipts or photos.</div></div>`;
}
function setInsightsMonth(m){ if(/^\d{4}-\d{2}$/.test(m)){ s4State.aiMonth=m; let c=$id("insAI"); if(c) c.outerHTML=aiCardHTML(); } }
function shiftInsightsMonth(n){ setInsightsMonth(shiftMonth(s4State.aiMonth||thisMonth(),n)); }

function insightFacts(month){
 let start=month+"-01", end=C.addDays(shiftMonth(month,1)+"-01",-1);
 if(end>todayDay()) end=todayDay();
 let d=insightsData({ start, end, days:C.daysBetween(start,end)+1 });
 let f=[];
 if(d.basket.latest) f.push("Basket price index "+pctText(d.basket.latest.changePct,true)+" vs "+d.basket.baseLabel+" ("+d.basket.latest.products+" regular items)");
 if(!d.savings.notEnough) f.push("Real price changes on repeat purchases: saved "+C.formatPeso(d.savings.saved)+", paid more "+C.formatPeso(d.savings.paidMore)+" ("+d.savings.compared+" compared)");
 if(d.usage.wasteValue>0) f.push("Thrown out: "+C.formatPeso(d.usage.wasteValue)+" ("+d.usage.waste.length+" items)");
 if(d.usage.stockouts) f.push("Ran out of something "+d.usage.stockouts+" time(s)");
 let top=d.stores.stores[0]; if(top && top.spend>0) f.push("Top store "+top.name+" "+C.formatPeso(top.spend)+" over "+top.visits+" visit(s)");
 if(d.plan.average!==null) f.push("Budget plan accuracy "+d.plan.average+"%");
 d.unusual.flags.slice(0,2).forEach(x=>f.push("Unusual: "+x.why));
 return f.slice(0,8);
}

async function insightsAISummary(){
 let month=s4State.aiMonth||thisMonth();
 let st=monthStats(month);
 let btn=$id("insAIBtn"), box=$id("insAIBox");
 if(!btn || !box || btn.disabled) return;
 box.classList.remove("hidden");
 if(!st.count){ box.innerHTML="No spending recorded for "+esc(st.monthLabel)+" — nothing to summarise."; return; }
 btn.disabled=true;
 box.innerHTML='<span class="spinner"></span>Writing your summary…';
 try{
  let stats=Object.assign({},st,{ insights:insightFacts(month) });
  let started=await fetchJSON("/api/report/summary",{ method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({ stats }) },75000);
  if(started.httpStatus===404) throw new ServerError("The AI summary needs the latest server update. Please redeploy jason-shop-api.");
  if(!started.success || !started.jobId) throw new ServerError(started.error || "Couldn't start the summary.");
  let result=await pollJob(started.jobId,"/api/jobs/",2*60*1000);
  if(!result || result.status!=="complete" || !result.text) throw new ServerError((result && result.error) || "The AI didn't return a summary.");
  if(!data.reportSummaries || typeof data.reportSummaries!=="object") data.reportSummaries={};
  data.reportSummaries["insights:"+month]={ text:result.text, at:new Date().toISOString(), total:st.total };
  storeData();
  let c=$id("insAI"); if(c) c.outerHTML=aiCardHTML();
 }catch(error){
  box.innerHTML="⚠️ "+esc(friendlyError(error));
  btn.disabled=false;
 }
}

/* ---------- CSV / PDF export with a date range ---------- */

function exportCardHTML(){
 return `<div class="card" id="insExport"><h3 class="card-title">⬇️ Export</h3>
  <div class="muted small">Spending, prices and analytics for any dates, as a spreadsheet (CSV) or a PDF report.</div>
  <button class="action wide" id="insExportBtn" onclick="openInsightsExport()">⬇️ Export CSV / PDF…</button></div>`;
}

function openInsightsExport(){
 let r=insightsRange();
 openSheet(`<h2>⬇️ Export analytics</h2>
  <div class="two"><div><label for="exFrom">From</label><input id="exFrom" type="date" value="${esc(r.start)}"></div><div><label for="exTo">To</label><input id="exTo" type="date" value="${esc(r.end)}"></div></div>
  <div class="chips">${[["30d","30 days"],["90d","90 days"],["365d","12 months"]].map(([k,l])=>`<button class="chip" onclick="exportPreset('${k}')">${l}</button>`).join("")}<button class="chip" onclick="exportPreset('month')">This month</button></div>
  <div id="sheetMsg" class="form-msg" aria-live="polite"></div>
  <button class="primary" id="exPdf" onclick="runExport('pdf')">📄 PDF report</button>
  <div class="btn-row"><button class="action" id="exCsvEntries" onclick="runExport('entries')">📋 CSV: spending</button><button class="action" id="exCsvAnalytics" onclick="runExport('analytics')">📊 CSV: analytics</button></div>
  <div class="btn-row"><button class="action" id="exCsvPrices" onclick="runExport('prices')">🏷️ CSV: prices</button><button class="action" id="exPrint" onclick="runExport('print')">🖨️ Print / save as PDF</button></div>
  <div class="field-note">Files are made on this phone — nothing is uploaded. In the PDF the peso sign is written "PHP" (built-in PDF fonts don't include ₱).</div>
  <button class="action wide" onclick="closeSheet()">Close</button>`);
}
function exportPreset(k){
 let t=todayDay(), r=k==="month" ? { start:thisMonth()+"-01", end:t } : C.insightRange(k,t);
 $id("exFrom").value=r.start; $id("exTo").value=r.end;
}

function saveExportFile(name,mime,content){
 let blob=new Blob([content],{ type:mime });
 lastExport={ name, mime, size:blob.size, at:new Date().toISOString(), text:typeof content==="string" ? content : null };
 try{
  let url=URL.createObjectURL(blob), a=document.createElement("a");
  a.href=url; a.download=name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),30000);
 }catch(e){ console.warn("download",e); }
}

function exportRows(range){
 let d=insightsData(range);
 let rows=[], add=(section,label,value,detail)=>rows.push({ section, label, value, detail:detail||"" });
 add("Range","From – to",range.start+" – "+range.end,plural(range.days,"day"));
 add("Spending","Total spent",d.trends.total,plural(d.trends.count,"entry","entries"));
 add("Spending","Per day",d.trends.dailyAvg,"");
 add("Spending","Change vs previous period (%)",d.trends.changePct,d.trends.changePct===null ? "not enough data" : "");
 d.trends.months.forEach(m=>add("By month",C.monthLabel(m.month),m.total,plural(m.count,"entry","entries")));
 d.trends.byCategory.forEach(c=>add("By category",c.name,c.total,c.share+"%"));
 d.trends.byStore.forEach(c=>add("By store",c.name,c.total,plural(c.visits,"visit")));
 if(d.basket.latest){ add("Basket index",d.basket.latest.label+" vs "+d.basket.baseLabel,d.basket.latest.index,pctText(d.basket.latest.changePct,true)); d.basket.items.forEach(i=>add("Basket item",i.name,i.latestValue,"was "+i.baseValue+" ("+pctText(i.changePct,true)+")")); }
 else add("Basket index","Not enough data","",d.basket.why.join(" "));
 if(d.savings.notEnough) add("Savings","Not enough data","",d.savings.why.join(" "));
 else { add("Savings","Saved",d.savings.saved,""); add("Savings","Paid more",d.savings.paidMore,""); add("Savings","Net",d.savings.net,d.savings.compared+" compared"); }
 d.stores.stores.forEach(s=>add("Store performance",s.name,s.spend,s.visits+" visits; avg basket "+(s.avgBasket===null ? "-" : s.avgBasket)+"; cheapest "+s.wins+"/"+s.compared));
 add("Waste","Thrown out (PHP)",d.usage.wasteValue,d.usage.wasteUnpriced ? d.usage.wasteUnpriced+" item(s) without a price" : "");
 add("Waste","Expired (PHP)",d.usage.expiredValue,"");
 add("Stock-outs","Times ran out",d.usage.stockouts,d.usage.daysOut+" days without");
 add("Accuracy","Shopping cycles (%)",d.cycles.average,d.cycles.average===null ? "not enough data" : "");
 add("Accuracy","Budget plan (%)",d.plan.average,d.plan.average===null ? "not enough data" : "");
 add("Accuracy","30-day forecast (%)",d.fc.average,d.fc.average===null ? "not enough data" : "");
 d.unusual.flags.forEach(f=>add("Unusual",f.title,f.amount,f.why));
 return { d, rows };
}

function runExport(kind){
 let from=val("exFrom"), to=val("exTo");
 if(!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)){ sheetMsg("Pick both dates."); return; }
 if(from>to){ let x=from; from=to; to=x; }
 let range=C.insightRange({ start:from, end:to },todayDay());
 let stamp=from+"_to_"+to;
 if(kind==="print"){ closeSheet(); s4State.custom={ start:from, end:to }; s4State.insKey=null; goTo("insights"); setTimeout(()=>window.print(),400); return; }
 if(kind==="entries"){
  let es=analyticsEntries().filter(e=>C.inRange(e.date,range));
  let csv=C.toCSV([{key:"date",label:"Date"},{key:"source",label:"Source"},{key:"store",label:"Store"},{key:"title",label:"What"},{key:"category",label:"Category"},{key:"amount",label:"Amount (PHP)"},{key:"payment",label:"Payment"},{key:"countedText",label:"Counted in Spent"},{key:"itemsText",label:"Items"}],
   es.map(e=>Object.assign({},e,{ countedText:e.counted ? "yes" : "no", itemsText:(e.items||[]).map(i=>i.name+(i.qty ? " x"+i.qty : "")+(i.price!=null ? " "+i.price : "")).join("; ") })));
  saveExportFile("jason-shop-spending-"+stamp+".csv","text/csv;charset=utf-8","\uFEFF"+csv);
  sheetMsg("✅ Saved "+lastExport.name+" ("+plural(es.length,"entry","entries")+")",true); return;
 }
 if(kind==="prices"){
  let rs=(data.priceRecords||[]).filter(r=>!r.archived && C.inRange(r.date,range)).map(r=>{ let p=productById(r.productId); return { date:r.date, product:p ? productTitle(p) : r.itemName, size:p ? sizeText(p) : "", store:storeLabel(resolveStore(r.storeId,r.storeName))||r.storeName||"", price:C.num(r.price), qty:C.num(r.qty)||1, each:itemPriceOf(r), source:(Mdl.PRICE_SOURCES[r.source]||{label:r.source}).label }; });
  let csv=C.toCSV([{key:"date",label:"Date"},{key:"product",label:"Product"},{key:"size",label:"Size"},{key:"store",label:"Store"},{key:"price",label:"Price (PHP)"},{key:"qty",label:"Qty"},{key:"each",label:"Each (PHP)"},{key:"source",label:"Source"}],rs);
  saveExportFile("jason-shop-prices-"+stamp+".csv","text/csv;charset=utf-8","\uFEFF"+csv);
  sheetMsg("✅ Saved "+lastExport.name+" ("+plural(rs.length,"price")+")",true); return;
 }
 let { d, rows }=exportRows(range);
 if(kind==="analytics"){
  let csv=C.toCSV([{key:"section",label:"Section"},{key:"label",label:"Item"},{key:"value",label:"Value"},{key:"detail",label:"Detail"}],rows);
  saveExportFile("jason-shop-analytics-"+stamp+".csv","text/csv;charset=utf-8","\uFEFF"+csv);
  sheetMsg("✅ Saved "+lastExport.name,true); return;
 }
 if(kind==="pdf"){
  let pdf=JasonPDF.build(pdfDoc(d,range));
  saveExportFile("jason-shop-insights-"+stamp+".pdf","application/pdf",JasonPDF.toBytes(pdf));
  lastExport.text=pdf;
  sheetMsg("✅ Saved "+lastExport.name,true);
 }
}

function neText(why){ let w=(why||[]).join(" "); return /^not enough data/i.test(w) ? w : "Not enough data. "+w; }
function pdfDoc(d,range){
 let t=d.trends, m=v=>C.formatPeso(v), secs=[];
 secs.push({ heading:"Spending", lines:["Total "+m(t.total)+" in "+plural(t.count,"entry","entries")+(t.dailyAvg!==null ? " - "+m(t.dailyAvg)+" per day" : "")+".", t.changePct===null ? "Change vs previous period: not enough data." : "Change vs previous "+range.days+" days: "+pctText(t.changePct,true)+" (was "+m(t.prevTotal)+")."],
  bars:t.months.map(x=>({ label:C.monthLabel(x.month), value:x.total, text:m(x.total) })) });
 secs.push({ heading:"By category", bars:t.byCategory.slice(0,12).map(c=>({ label:c.name, value:c.total, text:m(c.total)+" ("+Math.round(c.share)+"%)" })), lines:t.byCategory.length ? [] : ["No counted spending."] });
 let b=d.basket;
 secs.push({ heading:"Basket price index", lines:b.latest ? ["Prices of "+b.latest.products+" regular items: "+pctText(b.latest.changePct,true)+" ("+b.latest.label+" vs "+b.baseLabel+")."] : [neText(b.why)],
  table:b.latest ? { columns:[{label:"Item",width:3},{label:b.baseLabel,align:"right"},{label:"Now",align:"right"},{label:"Change",align:"right"}], rows:b.items.map(i=>[i.name,m(i.baseValue),m(i.latestValue),pctText(i.changePct,true)]) } : null });
 let s=d.savings;
 secs.push({ heading:"Savings achieved", lines:s.notEnough ? [neText(s.why)] : ["Saved "+m(s.saved)+", paid more "+m(s.paidMore)+", net "+m(s.net)+" ("+plural(s.compared,"purchase")+" compared with your previous price)."].concat(s.why.slice(1)) });
 secs.push({ heading:"Store performance", table:{ columns:[{label:"Store",width:3},{label:"Spent",align:"right"},{label:"Visits",align:"right"},{label:"Avg basket",align:"right"},{label:"Cheapest",align:"right"}],
  rows:d.stores.stores.filter(x=>x.spend>0 || x.compared).map(x=>[x.name,m(x.spend),String(x.visits),x.avgBasket===null ? "-" : m(x.avgBasket),x.compared ? x.wins+"/"+x.compared : "-"]), empty:"No store spending in this range." } });
 let u=d.usage;
 secs.push({ heading:"Usage, waste & stock-outs", lines:["Thrown out "+m(u.wasteValue)+(u.wasteUnpriced ? " (+"+u.wasteUnpriced+" item(s) without a price)" : "")+"; expired "+m(u.expiredValue)+"; ran out "+u.stockouts+" time(s), "+u.daysOut+" day(s) without."].concat(u.why) });
 secs.push({ heading:"Accuracy", lines:["Shopping cycles: "+(d.cycles.average===null ? "not enough data" : d.cycles.average+"%"),"Budget plan by category: "+(d.plan.average===null ? "not enough data" : d.plan.average+"%"),"30-day forecast: "+(d.fc.average===null ? "not enough data" : d.fc.average+"%")] });
 secs.push({ heading:"Unusual spending", lines:d.unusual.flags.length ? d.unusual.flags.map(f=>"- "+f.why) : ["Nothing unusual found."] });
 let es=d.entries.filter(e=>e.counted && C.inRange(e.date,range));
 secs.push({ heading:"Spending entries", table:{ columns:[{label:"Date",width:1.3},{label:"What",width:3},{label:"Store",width:2},{label:"Category",width:1.6},{label:"Amount",align:"right",width:1.4}], rows:es.map(e=>[e.date,e.title,e.store,e.category,m(e.amount)]), empty:"No counted spending in this range." } });
 return { title:"Jason Shop - Insights", subtitle:range.start+" to "+range.end+" - made "+new Date().toLocaleString("en-PH")+" from your own records. Missing data is shown as 'not enough data', never guessed.", sections:secs, footer:"Jason Shop "+Mdl.APP_VERSION };
}

/* =====================================================================
   UNIVERSAL SEARCH (🔎 in the header)
   ===================================================================== */

function openSearch(q){
 openSheet(`<h2>🔎 Search everything</h2>
  <input id="searchInput" type="search" autocomplete="off" placeholder="Products, stores, receipts, list, trips…" value="${esc(q||"")}" oninput="runSearch(this.value)" aria-label="Search">
  <div id="searchResults" aria-live="polite"></div>
  <button class="action wide" onclick="closeSheet()">Close</button>`);
 runSearch(q||"");
 setTimeout(()=>{ let i=$id("searchInput"); if(i) i.focus(); },30);
}

function searchIndex(){
 let out=[], push=(group,icon,title,sub,go,texts)=>out.push({ group, icon, title, sub, go, texts:texts.filter(Boolean) });
 let pref=prefs();
 (data.products||[]).filter(p=>!p.archived).forEach(p=>{ let kp=knownItemPrice(p.id); let liked=p.brand && pref.preferredBrands.some(b=>Mdl.normalizeName(b)===Mdl.normalizeName(p.brand));
  push("Products",liked ? "⭐" : "🏷️",productTitle(p),[sizeText(p),kp ? money(kp.price)+(kp.storeName ? " at "+kp.storeName : "") : "no price yet"].filter(Boolean).join(" · "),()=>openProductPage(p.id),[productTitle(p),p.name,p.brand,p.categoryName].concat(p.aliases||[])); });
 invItems().forEach(it=>push("Inventory","📦",it.name,qtyText(it.quantity)+" "+it.unit+" · "+(Mdl.INVENTORY_LOCATIONS[it.location]||it.location),()=>openInvItem(it.id),[it.name,it.notes]));
 openListItems().forEach(li=>push("Shopping list","📝",li.name,(li.qty!==1 ? "×"+qtyText(li.qty)+" · " : "")+(li.status==="in_cart" ? "in cart" : "on your list"),()=>openListItem(li.id),[li.name,li.note]));
 (data.stores||[]).filter(s=>!s.archived).forEach(s=>push("Stores",pref.preferredStores.includes(s.id) ? "⭐" : (pref.avoidStores.includes(s.id) ? "🚫" : "🏬"),s.name,[s.branch,s.city].filter(Boolean).join(" · ")||"store",()=>openStore(s.id),[s.name,s.shortName,s.branch].concat(s.aliases||[])));
 (data.receipts||[]).forEach(r=>push("Receipts","🧾",(r.store||r.name||"Receipt")+(r.archived ? " (archived)" : ""),[r.receiptDate||localDay(r.date),money(r.total||r.amount||0),plural((r.items||[]).length,"item")].join(" · "),()=>openReceiptDetail(r.id),[r.store,r.name,r.receiptNumber].concat((r.items||[]).map(i=>i.name))));
 historyEntries().filter(e=>e.source!=="receipt").forEach(e=>push("Spending history",SOURCE_ICON[e.source]||"✍️",e.title,[e.date,money(e.amount),e.store].filter(Boolean).join(" · "),()=>searchHistory(e.title),[e.title,e.store,e.category].concat((e.items||[]).map(i=>i.name))));
 (data.requests||[]).forEach(r=>push("AI requests","🤖",r.text,r.purchased ? "bought" : "shopping request",()=>{ closeSheet(); goTo("shopping"); },[r.text]));
 (data.householdRequests||[]).forEach(r=>push("Household requests","📨",r.title,((Mdl.REQUEST_STATUS[r.status]||{}).label||r.status)+(r.requestedByName ? " · from "+r.requestedByName : ""),()=>{ closeSheet(); s4State.reqTab=r.status==="pending" ? "pending" : "done"; goTo("requests"); },[r.title,r.note,r.requestedByName]));
 (data.recurring||[]).filter(r=>!r.archived).forEach(r=>push("Recurring","🔁",r.title,money(r.amount)+" · next "+(r.nextDue||"—"),()=>openRecurring(r.id),[r.title,r.categoryName]));
 (data.trips||[]).filter(t=>t.status!=="active").forEach(t=>push("Trips","🛒","Trip "+shortDay(localDay(t.finishedAt||t.cancelledAt||t.startedAt)),(t.status==="finished" ? money(t.total) : "cancelled")+" · "+plural((t.cart||[]).length,"item"),()=>openTripDetail(t.id),["trip"].concat((t.cart||[]).map(c=>c.name))));
 return out;
}

function searchHistory(q){
 closeSheet();
 historyFilter={ month:"all", category:"all", q };
 goTo("history");
 renderHistory();
}

function runSearch(q){
 let box=$id("searchResults"); if(!box) return;
 let query=String(q||"").trim();
 if(!query){ box.innerHTML='<p class="muted">Type a word — e.g. <i>rice</i>, <i>Puregold</i>, <i>diapers</i>. Searches products, stock, your list, stores, receipts, spending, requests, recurring purchases and trips.</p>'; sheetState.results=[]; return; }
 let res=searchIndex().map(x=>Object.assign(x,{ score:Math.max.apply(null,x.texts.map(t=>Mdl.searchScore(query,t)).concat([0])) })).filter(x=>x.score>0)
  .sort((a,b)=>b.score-a.score || a.title.localeCompare(b.title));
 sheetState.results=res;
 if(!res.length){ box.innerHTML=emptyState("🔎","Nothing found","No matches for “"+query+"”. Try fewer letters or another word.",""); return; }
 let groups={}, order=[];
 res.forEach((x,i)=>{ if(!groups[x.group]){ groups[x.group]=[]; order.push(x.group); } groups[x.group].push(i); });
 box.innerHTML=order.map(g=>`<div class="search-group"><h3>${esc(g)} <small class="muted">${groups[g].length}</small></h3>${groups[g].slice(0,8).map(i=>{ let x=res[i]; return `<button class="search-hit" data-group="${esc(g)}" onclick="searchGo(${i})"><span class="mi-icon">${x.icon}</span><span><b>${esc(x.title)}</b><small>${esc(x.sub||"")}</small></span><span class="chev">›</span></button>`; }).join("")}</div>`).join("");
}
function searchGo(i){ let x=(sheetState.results||[])[i]; if(x) x.go(); }

/* =====================================================================
   TRIP HISTORY (Shop → Trip)
   ===================================================================== */

if(typeof renderTrip==="function"){
 const renderTripStage3=renderTrip;
 renderTrip=function(){
  renderTripStage3();
  let box=$id("tripBody"); if(!box) return;
  let old=$id("tripHistory"); if(old) old.remove();
  box.insertAdjacentHTML("beforeend",tripHistoryHTML());
 };
}

function tripWhen(t){ return t.finishedAt||t.cancelledAt||t.startedAt||""; }
function tripStores(t){ return [...new Set((t.cart||[]).map(c=>c.storeId ? storeLabel(storeById(c.storeId)) : "").filter(Boolean))]; }

function tripHistoryHTML(){
 let trips=(data.trips||[]).filter(t=>t && t.status!=="active").sort((a,b)=>String(tripWhen(b)).localeCompare(String(tripWhen(a))));
 if(!trips.length) return `<div class="card" id="tripHistory"><h3 class="card-title">🕘 Trip history</h3><p class="muted">Finished trips appear here with what you bought and what it cost.</p></div>`;
 let fin=trips.filter(t=>t.status==="finished");
 return `<div class="card" id="tripHistory"><div class="card-head"><h3 class="card-title">🕘 Trip history</h3><small class="muted">${plural(fin.length,"trip")} · ${money(C.sum(fin,t=>t.total))}</small></div>
  ${trips.slice(0,s4State.allTrips ? 500 : 6).map(t=>`<button class="search-hit trip-hist" data-trip="${esc(t.id)}" onclick="openTripDetail('${esc(t.id)}')"><span class="mi-icon">${t.status==="finished" ? "🛒" : "✕"}</span><span><b>${esc(shortDay(localDay(tripWhen(t))))} · ${t.status==="finished" ? money(t.total) : "cancelled"}</b><small>${plural((t.cart||[]).length,"item")}${tripStores(t).length ? " · "+esc(tripStores(t).join(", ")) : ""}</small></span><span class="chev">›</span></button>`).join("")}
  ${trips.length>6 && !s4State.allTrips ? `<button class="action wide" onclick="s4State.allTrips=true;renderTrip()">Show all ${trips.length}</button>` : ""}</div>`;
}

function openTripDetail(id){
 let t=(data.trips||[]).find(x=>x.id===id); if(!t) return;
 let lines=(t.cart||[]).filter(c=>c.checked!==false);
 let groups={};
 lines.forEach(c=>{ (groups[c.storeId||""]=groups[c.storeId||""]||[]).push(c); });
 openSheet(`<h2>🛒 Trip · ${esc(shortDay(localDay(t.startedAt)))}</h2>
  <div class="muted">${t.status==="finished" ? "Finished "+esc(fmtDateTime(t.finishedAt)) : "Cancelled "+esc(fmtDateTime(t.cancelledAt))+" — nothing was recorded"}</div>
  ${Object.keys(groups).map(k=>`<div class="card" data-trip-store="${esc(k)}"><b>${k ? "🏬 "+esc(storeLabel(storeById(k))||"Store") : "🛍️ Any store"}</b>${groups[k].map(c=>`<div class="row-line"><span>${esc(c.name)}${c.qty && c.qty!==1 ? " ×"+qtyText(c.qty) : ""}</span><b>${c.amount!=null ? money(c.amount) : "—"}</b></div>`).join("")}<div class="row-line total"><span>Subtotal</span><b>${money(C.sum(groups[k],c=>c.amount))}</b></div></div>`).join("") || '<p class="muted">No items.</p>'}
  ${t.status==="finished" ? `<div class="calc-line total big"><span>Total</span><b id="tripDetailTotal">${money(t.total)}</b></div>
   <div class="field-note">${plural((t.entryIds||[]).length,"spending entry","spending entries")} and ${plural((t.priceRecordIds||[]).length,"price")} were saved from this trip.</div>` : ""}
  <button class="action wide" onclick="closeSheet()">Close</button>`);
}

/* =====================================================================
   PRODUCT DETAIL PAGE (Shop → product)
   ===================================================================== */

function openProductPage(id){
 if(!productById(id)) return;
 closeSheet();
 s4State.productId=id;
 showSub("shop","product");
}

if(typeof openProduct==="function"){
 const openProductStage3=openProduct;
 openProduct=function(id){
  openProductStage3(id);
  let h=document.querySelector("#sheetBody > h2");
  if(h && productById(id)) h.insertAdjacentHTML("afterend",`<button class="action wide" id="productFullBtn" onclick="openProductPage('${esc(id)}')">📄 Full details & price chart</button>`);
 };
}

function renderProductPage(){
 let box=$id("productPageBody"); if(!box) return;
 let p=productById(s4State.productId);
 if(!p){ box.innerHTML=emptyState("🏷️","Pick a product","Open a product from the Price Book or search to see its full history.",`<button class="action" onclick="showSub('shop','prices')">🏷️ Price Book</button>`); return; }
 let st=productStats(p);
 let recs=sortByWhen(realRecords(p));
 let first=recs.length ? recs[0].date : null, last=recs.length ? recs[recs.length-1].date : null;
 let span=first && last ? Math.max(1,C.daysBetween(first,last)) : 1;
 let pts=recs.map(r=>({ y:itemPriceOf(r), t:recs.length>1 ? C.daysBetween(first,r.date)/span : 0.5, label:shortDay(r.date), tip:shortDay(r.date)+" · "+money(itemPriceOf(r))+" at "+(storeLabel(resolveStore(r.storeId,r.storeName))||r.storeName||"?"), cls:r.source==="purchase" || r.source==="receipt" ? "bought" : "" }));
 let inv=invForProduct(p.id);
 let li=openListItems().find(x=>x.productId===p.id);
 let bought=recs.filter(r=>r.source==="purchase" || r.source==="receipt").reverse();
 let rcIds=[...new Set(priceRecordsFor(p.id).filter(r=>r.sourceRef && r.sourceRef.type==="receipt").map(r=>r.sourceRef.id))];
 let rcs=rcIds.map(id=>(data.receipts||[]).find(r=>r.id===id)).filter(Boolean);
 let invHTML="";
 if(inv){ let info=itemInfo(inv); invHTML=`<div class="row-line"><span>${esc(inv.name)} · ${qtyText(inv.quantity)} ${esc(inv.unit)}</span>${invBadge(info.st.state)}</div><div class="muted small">${esc(daysText(info))}</div><button class="action wide" onclick="openInvItem('${esc(inv.id)}')">Open inventory item</button>`; }
 box.innerHTML=`<div class="card product-hero" id="productPage" data-product="${esc(p.id)}">
   <h2 class="ph-title">${esc(productTitle(p))}</h2>
   <div class="muted">${esc(sizeText(p)||"No size set")}${p.categoryName ? " · "+esc(p.categoryName) : ""}</div>
   ${st.count ? `<div class="stats-grid">
    <div><small>Latest</small><b>${priceValueText(st,st.latest.value)}</b><small>${esc(st.latest.storeName||"")}</small></div>
    <div><small>Lowest</small><b>${priceValueText(st,st.lowest.value)}</b><small>${esc(st.lowest.storeName||"")}</small></div>
    <div><small>Highest</small><b>${priceValueText(st,st.highest.value)}</b><small>${esc(st.highest.storeName||"")}</small></div>
    <div><small>Average</small><b>${priceValueText(st,st.average)}</b><small>${plural(st.count,"record")}</small></div></div>` : '<p class="muted">No prices recorded yet.</p>'}
  </div>
  <div class="card" id="productChart"><h3 class="card-title">📈 Price history <small class="muted">per item</small></h3>
   ${recs.length>=2 ? svgLine(pts,{ labels:true, label:"Price history for "+productTitle(p) })+'<div class="field-note">Filled dots = bought (receipt / purchase) · hollow = shelf or online prices you saw. AI estimates are left out.</div>' : `<div class="not-enough" id="productChartNE">${recs.length ? "Only one price so far — not enough data for a chart" : "Not enough data"}</div>`}</div>
  <div class="card" id="productIntelPage">${productIntelHTML(p)}</div>
  <div class="card" id="productInv"><h3 class="card-title">📦 At home & on the list</h3>
   ${invHTML || '<p class="muted">Not tracked in Inventory.</p>'}
   ${li ? `<div class="row-line"><span>📝 On your list${li.qty!==1 ? " ×"+qtyText(li.qty) : ""}</span><button class="link" onclick="showSub('shop','list')">Open list</button></div>` : `<button class="action wide" id="productAddList" onclick="productToList('${esc(p.id)}')">📝 Add to shopping list</button>`}</div>
  <div class="card" id="productBought"><h3 class="card-title">🧾 Purchase history</h3>
   ${bought.length ? bought.slice(0,12).map(r=>`<div class="row-line"><span>${esc(shortDay(r.date))} <small class="muted">${esc(storeLabel(resolveStore(r.storeId,r.storeName))||r.storeName||"")}${C.num(r.qty)>1 ? " · ×"+esc(String(r.qty)) : ""}</small></span><b>${money(r.price)}</b></div>`).join("") : '<p class="muted">Not bought yet (no receipt or purchase recorded).</p>'}
   ${rcs.length ? `<h3>Receipts</h3>${rcs.map(r=>`<button class="search-hit" onclick="openReceiptDetail('${esc(r.id)}')"><span class="mi-icon">🧾</span><span><b>${esc(r.store||"Receipt")}</b><small>${esc(r.receiptDate||localDay(r.date))} · ${money(r.total||0)}</small></span><span class="chev">›</span></button>`).join("")}` : ""}</div>
  <div class="btn-row"><button class="action" onclick="openPrice('${esc(p.id)}')">➕ Add price</button><button class="action" onclick="openProductEdit('${esc(p.id)}')">✏️ Edit product</button></div>`;
}

function productToList(pid){
 let p=productById(pid); if(!p) return;
 if(openListItems().some(x=>x.productId===pid)){ toast("Already on your list"); return; }
 let li=addListItemQuick({ name:p.name, productId:p.id, addedFrom:"product" });
 audit("list.add","Added "+li.name+" to the shopping list (product page)",{entity:"shoppingLists",id:li.id});
 save(); toast("📝 Added "+li.name+" to your list");
}

/* =====================================================================
   PREFERENCES (More → Settings)
   ===================================================================== */

if(typeof renderSettings==="function"){
 const renderSettingsStage3=renderSettings;
 renderSettings=function(){
  renderSettingsStage3();
  let s3=$id("settings3");
  if(s3 && !$id("settings4")) s3.insertAdjacentHTML("afterend",`<div id="settings4">${preferencesHTML()}</div>`);
 };
}

function preferencesHTML(){
 let pf=prefs();
 let stores=(data.stores||[]).filter(s=>!s.archived);
 let choice=id=>pf.preferredStores.includes(id) ? "prefer" : (pf.avoidStores.includes(id) ? "avoid" : "");
 return `<div class="card" id="prefsCard"><h3 class="card-title">⭐ My preferences</h3>
  <label for="pfStart">Open the app on</label><select id="pfStart">${Object.entries(Mdl.START_VIEWS).map(([k,v])=>`<option value="${k}"${pf.startView===k ? " selected" : ""}>${esc(v)}</option>`).join("")}</select>
  <label for="pfRange">Insights show</label><select id="pfRange">${Object.entries(Mdl.INSIGHT_RANGES).map(([k,v])=>`<option value="${k}"${pf.insightsRange===k ? " selected" : ""}>${esc(v)}</option>`).join("")}</select>
  ${stores.length ? `<label>Stores</label><div class="pref-stores">${stores.map(s=>`<div class="stepper-row"><span>${esc(storeLabel(s))}</span><select data-pfstore="${esc(s.id)}" aria-label="Preference for ${esc(storeLabel(s))}"><option value="">—</option><option value="prefer"${choice(s.id)==="prefer" ? " selected" : ""}>⭐ Prefer</option><option value="avoid"${choice(s.id)==="avoid" ? " selected" : ""}>🚫 Avoid</option></select></div>`).join("")}</div>` : ""}
  <label for="pfBrands">Brands I like (comma separated)</label><input id="pfBrands" autocomplete="off" value="${esc(pf.preferredBrands.join(", "))}" placeholder="e.g. Magnolia, Nestlé">
  <label for="pfAvoidBrands">Brands to avoid</label><input id="pfAvoidBrands" autocomplete="off" value="${esc(pf.avoidBrands.join(", "))}">
  <label for="pfNotes">Notes (allergies, likes…)</label><input id="pfNotes" autocomplete="off" maxlength="500" value="${esc(pf.notes)}">
  <div class="field-note">🚫 Avoided stores are left out of trip plans (unless you pick them yourself) and avoided brands aren't suggested as substitutes. ⭐ Preferred stores and brands are marked in Insights and search.</div>
  <div id="prefsMsg" class="form-msg" aria-live="polite"></div>
  <button class="action wide" id="pfSave" onclick="savePreferences()">Save preferences</button></div>`;
}

function savePreferences(){
 let pf=prefs(), before=Mdl.clone(pf);
 let list=v=>[...new Set(String(v||"").split(",").map(x=>x.trim()).filter(Boolean))].slice(0,40);
 pf.startView=Mdl.START_VIEWS[val("pfStart")] ? val("pfStart") : "home";
 pf.insightsRange=Mdl.INSIGHT_RANGES[val("pfRange")] ? val("pfRange") : "90d";
 pf.preferredStores=[]; pf.avoidStores=[];
 document.querySelectorAll("[data-pfstore]").forEach(sel=>{ if(sel.value==="prefer") pf.preferredStores.push(sel.dataset.pfstore); if(sel.value==="avoid") pf.avoidStores.push(sel.dataset.pfstore); });
 pf.preferredBrands=list(val("pfBrands")); pf.avoidBrands=list(val("pfAvoidBrands"));
 pf.notes=val("pfNotes").slice(0,500);
 data.settings.preferences=pf;
 audit("settings.preferences","Preferences saved"+(pf.avoidStores.length ? " · avoid "+plural(pf.avoidStores.length,"store") : "")+(pf.preferredStores.length ? " · prefer "+plural(pf.preferredStores.length,"store") : ""),{entity:"settings",before,after:Mdl.clone(pf)});
 s4State.insKey=null;
 storeData();
 let m=$id("prefsMsg"); if(m){ m.innerText="✅ Saved"; m.className="form-msg ok"; }
 toast("✅ Preferences saved");
}

// Avoided stores drop out of the trip planner unless picked by hand.
if(typeof planInputs==="function"){
 const planInputsStage3=planInputs;
 planInputs=function(){
  let r=planInputsStage3();
  let avoid=prefs().avoidStores;
  if(!avoid.length) return r;
  let used={};
  r.rows.forEach(row=>{
   if(row.lock && row.learned && avoid.includes(row.lock)){ row.lock=null; row.learned=false; }
   Object.keys(row.prices).forEach(k=>{ if(avoid.includes(k) && row.lock!==k) delete row.prices[k]; });
   Object.keys(row.prices).forEach(k=>{ used[k]=true; }); if(row.lock) used[row.lock]=true;
  });
  Object.keys(r.stores).forEach(k=>{ if(!used[k]) delete r.stores[k]; });
  return r;
 };
}
// Avoided brands are never suggested as substitutes.
if(Mdl && typeof Mdl.substitutesFor==="function" && !Mdl.substitutesFor.stage4){
 const subsStage3=Mdl.substitutesFor;
 Mdl.substitutesFor=function(products,p){
  let out=subsStage3(products,p);
  let pf=typeof data!=="undefined" && data && data.settings && data.settings.preferences;
  let avoid=((pf && pf.avoidBrands)||[]).map(b=>Mdl.normalizeName(b));
  return avoid.length ? out.filter(s=>!(s.product.brand && avoid.includes(Mdl.normalizeName(s.product.brand)))) : out;
 };
 Mdl.substitutesFor.stage4=true;
}

function applyStartView(){
 let v=prefs().startView;
 if(!v || v==="home" || !Mdl.START_VIEWS[v] || ui.view!=="home" || location.hash) return;
 if(v==="insights") goTo("insights"); else showView(v);
}
window.addEventListener("load",()=>setTimeout(applyStartView,0));

/* =====================================================================
   PEOPLE & ROLES (More → Household) — prepared for a future login
   ===================================================================== */

if(typeof renderHousehold==="function"){
 const renderHouseholdStage3=renderHousehold;
 renderHousehold=function(){
  renderHouseholdStage3();
  let box=$id("householdBody"); if(box) box.insertAdjacentHTML("beforeend",peopleCardHTML());
 };
}

function peopleCardHTML(){
 let ppl=peopleList(), me=actingPerson(), canManage=allowed("people");
 let archived=(data.people||[]).filter(p=>p && p.archived);
 return `<div class="card" id="peopleCard"><h3 class="card-title">👥 People & roles</h3>
  ${ppl.length ? `<label for="actingAs">Acting as (on this phone)</label>
  <select id="actingAs" onchange="setActingPerson(this.value)">${ppl.map(p=>`<option value="${esc(p.id)}"${me && me.id===p.id ? " selected" : ""}>${esc(p.name)} — ${esc((Mdl.ROLES[p.role]||{}).label||p.role)}</option>`).join("")}</select>` : ""}
  <div class="field-note">🔓 There is no login yet: anyone holding this phone can switch. Roles only decide which buttons are shown (for example, who can approve requests). They are not security.</div>
  ${ppl.map(p=>`<div class="list-row person-row" data-person="${esc(p.id)}"><div><b>${esc(p.name)}</b> ${roleBadge(p)}<small class="muted">${esc((Mdl.ROLES[p.role]||Mdl.ROLES.viewer).perms.map(k=>Mdl.PERMISSIONS[k]).join(" · "))}</small></div>
   ${canManage ? `<div class="list-actions"><button class="mini" aria-label="Edit ${esc(p.name)}" onclick="openPerson('${esc(p.id)}')">✏️</button></div>` : ""}</div>`).join("")}
  ${canManage ? `<button class="action wide" id="addPersonBtn" onclick="openPerson(null)">➕ Add person</button>` : '<div class="field-note">Only an Owner can add people or change roles.</div>'}
  ${archived.length ? `<details><summary>Removed (${archived.length})</summary>${archived.map(p=>`<div class="list-row"><div>${esc(p.name)}</div>${canManage ? `<div class="list-actions"><button class="mini" onclick="restorePerson('${esc(p.id)}')">Restore</button></div>` : ""}</div>`).join("")}</details>` : ""}</div>`;
}

function setActingPerson(id){
 let p=personById(id); if(!p || p.archived) return;
 let before=data.settings.activePersonId;
 data.settings.activePersonId=id;
 audit("people.acting","Now acting as "+p.name+" ("+Mdl.ROLES[p.role].label+")",{entity:"settings",before:{activePersonId:before},after:{activePersonId:id}});
 save(); toast("👤 Acting as "+p.name);
}

function openPerson(id){
 if(!allowed("people")){ toast("Only an Owner can manage people"); return; }
 let p=id ? personById(id) : null;
 sheetState={ personId:id };
 let houses=(data.houses||[]).filter(h=>!h.archived);
 openSheet(`<h2>${p ? "✏️ "+esc(p.name) : "➕ Add person"}</h2>
  <label for="psName">Name</label><input id="psName" autocomplete="off" maxlength="60" value="${esc(p ? p.name : "")}" placeholder="e.g. Ate Maria">
  <label for="psRole">Role</label><select id="psRole">${Object.entries(Mdl.ROLES).map(([k,r])=>`<option value="${k}"${(p ? p.role : "staff")===k ? " selected" : ""}>${r.icon} ${esc(r.label)}</option>`).join("")}</select>
  ${houses.length>1 ? `<label for="psHouse">House</label><select id="psHouse">${houses.map(h=>`<option value="${esc(h.id)}"${p && p.houseId===h.id ? " selected" : ""}>${esc(h.name)}</option>`).join("")}</select>` : ""}
  <div class="field-note">${Object.values(Mdl.ROLES).map(r=>esc(r.icon+" "+r.label.split(" (")[0]+": "+r.perms.map(k=>Mdl.PERMISSIONS[k].toLowerCase()).join(", "))).join("<br>")}</div>
  <div id="sheetMsg" class="form-msg" aria-live="polite"></div>
  <button class="primary" id="psSave" onclick="savePerson()">✅ SAVE</button>
  ${p ? `<button class="action wide" id="psArchive" onclick="archivePerson('${esc(p.id)}')">🗄️ Remove (history kept)</button>` : ""}
  <button class="action wide" onclick="closeSheet()">Cancel</button>`);
}

function savePerson(){
 let name=val("psName"), role=val("psRole");
 if(!name){ sheetMsg("Please enter a name."); return; }
 if(!Mdl.ROLES[role]){ sheetMsg("Pick a role."); return; }
 let now=new Date().toISOString();
 let p=sheetState.personId ? personById(sheetState.personId) : null;
 if(p && p.role==="owner" && role!=="owner" && !peopleList().some(x=>x.id!==p.id && x.role==="owner")){ sheetMsg("Keep at least one Owner."); return; }
 let houseId=val("psHouse") || (p && p.houseId) || (((data.houses||[]).find(h=>!h.archived))||{}).id || null;
 if(p){
  let before={ name:p.name, role:p.role };
  Object.assign(p,{ name:name.slice(0,60), role, houseId, updatedAt:now });
  audit("people.edit","Person updated: "+p.name+" ("+Mdl.ROLES[role].label+")",{entity:"people",id:p.id,before,after:{ name:p.name, role }});
 }else{
  p=Mdl.makePerson({ name, role, houseId },now);
  data.people.push(p);
  audit("people.add","Person added: "+p.name+" ("+Mdl.ROLES[role].label+")",{entity:"people",id:p.id});
 }
 closeSheet(); save(); toast("✅ Saved "+p.name);
}

function archivePerson(id){
 let p=personById(id); if(!p) return;
 if(p.role==="owner" && !peopleList().some(x=>x.id!==id && x.role==="owner")){ sheetMsg("Keep at least one Owner."); return; }
 if(!confirm("Remove "+p.name+"? Their requests and history are kept.")) return;
 p.archived=true; p.archivedAt=new Date().toISOString();
 if(data.settings.activePersonId===id){ let o=peopleList().find(x=>x.role==="owner"); data.settings.activePersonId=o ? o.id : null; }
 audit("people.archive","Person removed: "+p.name+" (history kept)",{entity:"people",id});
 closeSheet(); save();
}
function restorePerson(id){ let p=personById(id); if(!p || !allowed("people")) return; p.archived=false; p.updatedAt=new Date().toISOString(); audit("people.restore","Person restored: "+p.name,{entity:"people",id}); save(); }

/* =====================================================================
   HOUSEHOLD REQUESTS (More → Requests) — ask, approve, decline
   ===================================================================== */

function pendingHouseholdRequests(){ return (data.householdRequests||[]).filter(r=>r.status==="pending"); }

function openHouseholdRequest(){
 let me=actingPerson();
 if(me && !Mdl.can(me,"request")){ toast("A Viewer can't make requests — switch who's acting in Household"); return; }
 openSheet(`<h2>📨 Ask for something</h2>
  <label for="hrWho">Who's asking?</label><select id="hrWho">${peopleList().map(p=>`<option value="${esc(p.id)}"${me && me.id===p.id ? " selected" : ""}>${esc(p.name)}</option>`).join("")}</select>
  <label for="hrTitle">What's needed</label><input id="hrTitle" autocomplete="off" maxlength="120" placeholder="e.g. Diapers size L, dish soap">
  <div class="two"><div><label for="hrQty">How many</label><input id="hrQty" inputmode="decimal" autocomplete="off" value="1"></div>
  <div><label for="hrUrgency">How soon</label><select id="hrUrgency"><option value="normal">Next shopping trip</option><option value="urgent">⚡ Urgent</option></select></div></div>
  <label for="hrNote">Note (optional)</label><input id="hrNote" autocomplete="off" maxlength="300" placeholder="brand, size, why…">
  <div id="sheetMsg" class="form-msg" aria-live="polite"></div>
  <button class="primary" id="hrSave" onclick="saveHouseholdRequest()">📨 SEND REQUEST</button>
  <div class="field-note">The request waits for an Owner or Adult to approve it. Approved items go on the shopping list.</div>
  <button class="action wide" onclick="closeSheet()">Cancel</button>`);
}

function saveHouseholdRequest(){
 let title=val("hrTitle");
 if(!title){ sheetMsg("What's needed?"); return; }
 let qty=C.num(val("hrQty"));
 if(val("hrQty") && !(qty>0)){ sheetMsg("How many must be a number above 0."); return; }
 let who=personById(val("hrWho")) || actingPerson();
 let m=Mdl.matchProduct(data.products,title);
 let r=Mdl.makeHouseholdRequest({ title, qty:qty||1, note:val("hrNote"), urgency:val("hrUrgency"), requestedBy:who ? who.id : null, requestedByName:who ? who.name : "", houseId:who ? who.houseId : null, productId:m && m.confidence==="high" ? m.product.id : null },new Date().toISOString());
 data.householdRequests.push(r);
 audit("hreq.add","Household request: "+r.title+(r.qty!==1 ? " ×"+r.qty : "")+" from "+(r.requestedByName||"someone"),{entity:"householdRequests",id:r.id});
 closeSheet(); save(); toast("📨 Request sent"+(who ? " for "+who.name : ""));
}

function decideHouseholdRequest(id,approve,note){
 let r=(data.householdRequests||[]).find(x=>x.id===id); if(!r || r.status!=="pending") return;
 if(!allowed("approve")){ toast("Only an Owner or Adult can approve — switch “Acting as” in Household"); return; }
 let me=actingPerson(), now=new Date().toISOString();
 r.status=approve ? "approved" : "rejected";
 r.decidedBy=me ? me.id : null; r.decidedByName=me ? me.name : ""; r.decidedAt=now; r.decisionNote=note||""; r.updatedAt=now;
 r.history.push({ status:r.status, at:now, by:r.decidedBy, note:note||"" });
 if(approve){
  let li=addListItemQuick({ name:r.title, qty:r.qty, productId:r.productId, note:[r.note,r.requestedByName ? "for "+r.requestedByName : ""].filter(Boolean).join(" · "), priority:r.urgency==="urgent" ? 1 : 2, addedFrom:"household_request" });
  li.requestedBy=r.requestedBy; li.requestedByName=r.requestedByName; li.householdRequestId=r.id;
  r.listItemId=li.id;
 }
 audit(approve ? "hreq.approve" : "hreq.reject",(approve ? "Approved: " : "Not approved: ")+r.title+" (from "+(r.requestedByName||"someone")+")"+(note ? " — "+note : ""),{entity:"householdRequests",id:r.id});
 save(); toast(approve ? "✅ Added to the shopping list" : "🚫 Request declined");
}
function rejectHouseholdRequest(id){
 if(!allowed("approve")){ toast("Only an Owner or Adult can decide — switch “Acting as” in Household"); return; }
 sheetState={ rejectId:id };
 openSheet(`<h2>🚫 Not approving</h2><label for="hrReason">Reason (optional, the requester sees it)</label><input id="hrReason" autocomplete="off" maxlength="200" placeholder="e.g. we still have some">
  <button class="primary" id="hrRejectGo" onclick="confirmRejectRequest()">Decline request</button><button class="action wide" onclick="closeSheet()">Back</button>`);
}
function confirmRejectRequest(){ let id=sheetState.rejectId, n=val("hrReason"); closeSheet(); decideHouseholdRequest(id,false,n); }
function cancelHouseholdRequest(id){
 let r=(data.householdRequests||[]).find(x=>x.id===id); if(!r || r.status!=="pending") return;
 let me=actingPerson();
 if(me && me.id!==r.requestedBy && !Mdl.can(me,"approve")){ toast("Only the person who asked (or an Owner/Adult) can cancel"); return; }
 let now=new Date().toISOString();
 r.status="cancelled"; r.updatedAt=now; r.history.push({ status:"cancelled", at:now, by:me ? me.id : null });
 audit("hreq.cancel","Request cancelled: "+r.title,{entity:"householdRequests",id:r.id});
 save();
}
function setReqTab(t){ s4State.reqTab=t; renderRequests(); }

function renderRequests(){
 let box=$id("requestsBody"); if(!box) return;
 let all=(data.householdRequests||[]).slice().sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt)));
 let pend=all.filter(r=>r.status==="pending").sort((a,b)=>(a.urgency==="urgent" ? 0 : 1)-(b.urgency==="urgent" ? 0 : 1));
 let done=all.filter(r=>r.status!=="pending");
 let me=actingPerson(), canApprove=allowed("approve");
 let row=r=>{ let s=Mdl.REQUEST_STATUS[r.status]||{icon:"",label:r.status};
  return `<div class="card hreq-row" data-hreq="${esc(r.id)}" data-status="${esc(r.status)}"><div class="card-head"><b>${r.urgency==="urgent" ? "⚡ " : ""}${esc(r.title)}${r.qty!==1 ? " ×"+qtyText(r.qty) : ""}</b><span class="tag">${s.icon} ${esc(s.label)}</span></div>
   <small class="muted">From ${esc(r.requestedByName||"someone")} · ${esc(fmtDateTime(r.createdAt))}${r.note ? " · “"+esc(r.note)+"”" : ""}</small>
   ${r.status!=="pending" ? `<small class="muted">${r.decidedByName ? esc(r.decidedByName)+" · " : ""}${esc(fmtDateTime(r.decidedAt||r.updatedAt))}${r.decisionNote ? " — "+esc(r.decisionNote) : ""}</small>` : ""}
   ${r.status==="pending" ? `<div class="btn-row">${canApprove ? `<button class="action" data-act="approve" onclick="decideHouseholdRequest('${esc(r.id)}',true)">✅ Approve</button><button class="action" data-act="reject" onclick="rejectHouseholdRequest('${esc(r.id)}')">🚫 Decline</button>` : `<button class="action" data-act="cancel" onclick="cancelHouseholdRequest('${esc(r.id)}')">↩️ Cancel</button>`}</div>` : ""}
   ${r.history.length>1 ? `<details><summary>History (${r.history.length})</summary>${r.history.map(h=>`<div class="row-line"><span>${esc((Mdl.REQUEST_STATUS[h.status]||{}).label||h.status)}</span><small>${esc(fmtDateTime(h.at))}${h.by && personById(h.by) ? " · "+esc(personById(h.by).name) : ""}</small></div>`).join("")}</details>` : ""}</div>`; };
 box.innerHTML=`<div class="card summary-card"><div class="card-head"><b>👤 Acting as ${me ? esc(me.name)+" "+roleBadge(me) : "—"}</b><button class="link" onclick="goTo('people')">Switch</button></div>
   <div class="muted small">${canApprove ? "You can approve requests. Approved items go straight onto the shopping list." : "Your requests wait for an Owner or Adult to approve them."}</div></div>
  <button class="primary" id="hrNew" onclick="openHouseholdRequest()">📨 Ask for something</button>
  <div class="seg" id="reqTabs"><button class="${s4State.reqTab==="pending" ? "on" : ""}" onclick="setReqTab('pending')">Waiting (${pend.length})</button><button class="${s4State.reqTab==="done" ? "on" : ""}" onclick="setReqTab('done')">Decided (${done.length})</button></div>
  ${s4State.reqTab==="pending" ? (pend.length ? pend.map(row).join("") : emptyState("📭","No requests waiting","Anyone in the household can ask for things here — staff, kids, family. You approve what goes on the list.",""))
   : (done.length ? done.map(row).join("") : emptyState("🗂️","Nothing decided yet","Approved, declined and cancelled requests are kept here with their history.",""))}`;
}

if(typeof renderLists==="function"){
 const renderListsStage3=renderLists;
 renderLists=function(){
  renderListsStage3();
  let n=pendingHouseholdRequests().length, box=$id("listsBody");
  if(n && box && !$id("listReqBanner")) box.insertAdjacentHTML("afterbegin",`<button class="banner-btn" id="listReqBanner" onclick="goTo('requests')">📨 ${plural(n,"household request")} waiting for approval <span class="chev">›</span></button>`);
 };
}

/* =====================================================================
   RECEIPT ARCHIVE (Shop → Receipts → Archive)
   ===================================================================== */

function setArchiveFilter(k,v){ s4State.archive[k]=v; renderReceiptArchive(); }
function archiveSearch(v){ s4State.archive.q=v; clearTimeout(s4State.rcT); s4State.rcT=setTimeout(()=>{ renderReceiptArchive(); let s=$id("rcSearch"); if(s){ s.focus(); s.setSelectionRange(s.value.length,s.value.length); } },250); }

function renderReceiptArchive(){
 let box=$id("receiptArchiveBody"); if(!box) return;
 let all=(data.receipts||[]).map(r=>({ r, day:r.receiptDate || localDay(r.date) }));
 if(!all.length){ box.innerHTML=emptyState("🗂️","No receipts yet","Every receipt you scan is kept here — searchable by store, item and month.",`<button class="action" onclick="receiptCamera()">📷 Scan a receipt</button>`); return; }
 let f=s4State.archive;
 let months=[...new Set(all.map(x=>(x.day||"").slice(0,7)).filter(Boolean))].sort().reverse();
 let storeOf=x=>entryStore({ store:x.r.store||x.r.name||"" });
 let stores=[...new Set(all.map(storeOf).filter(Boolean))].sort();
 let q=String(f.q||"").trim();
 let shown=all.filter(x=>{
  if(f.show==="active" && x.r.archived) return false;
  if(f.show==="archived" && !x.r.archived) return false;
  if(f.month!=="all" && (x.day||"").slice(0,7)!==f.month) return false;
  if(f.store!=="all" && storeOf(x)!==f.store) return false;
  if(q && !Math.max(0,...[x.r.store,x.r.name,x.r.receiptNumber,x.r.payment].concat((x.r.items||[]).map(i=>i.name)).filter(Boolean).map(t=>Mdl.searchScore(q,t)))) return false;
  return true;
 }).sort((a,b)=>String(b.day).localeCompare(String(a.day)));
 let arch=all.filter(x=>x.r.archived).length;
 box.innerHTML=`<div class="card summary-card" id="rcSummary"><b>${plural(all.length,"receipt")} · ${money(C.sum(all,x=>x.r.total||0))}</b><div class="muted small">${arch ? plural(arch,"archived receipt")+" (hidden from the Receipt Manager, still counted in your history)" : "Archive old receipts to tidy the Receipt Manager — nothing is deleted and Spent doesn't change."}</div></div>
  <input id="rcSearch" type="search" placeholder="Search store, item, receipt #" autocomplete="off" value="${esc(f.q)}" oninput="archiveSearch(this.value)" aria-label="Search receipts">
  <div class="filters three"><select id="rcMonth" aria-label="Month" onchange="setArchiveFilter('month',this.value)"><option value="all">All months</option>${months.map(m=>`<option value="${m}"${f.month===m ? " selected" : ""}>${esc(C.monthLabel(m))}</option>`).join("")}</select>
  <select id="rcStore" aria-label="Store" onchange="setArchiveFilter('store',this.value)"><option value="all">All stores</option>${stores.map(s=>`<option value="${esc(s)}"${f.store===s ? " selected" : ""}>${esc(s)}</option>`).join("")}</select>
  <select id="rcShow" aria-label="Show" onchange="setArchiveFilter('show',this.value)"><option value="all"${f.show==="all" ? " selected" : ""}>All</option><option value="active"${f.show==="active" ? " selected" : ""}>Not archived</option><option value="archived"${f.show==="archived" ? " selected" : ""}>Archived</option></select></div>
  <div id="rcList">${shown.length ? shown.map(x=>receiptTileHTML(x.r)).join("") : emptyState("🔎","No receipts match","Try another month, store or word.","")}</div>`;
}

function receiptTileHTML(r){
 let thumb=safeThumb(r.thumb);
 return `<button class="item rc-tile${r.archived ? " archived" : ""}" data-receipt="${esc(r.id)}" onclick="openReceiptDetail('${esc(r.id)}')">
  ${thumb ? `<img class="thumb" src="${thumb}" alt="">` : '<span class="thumb ph">🧾</span>'}
  <b>${esc(r.store||r.name||"Receipt")}</b>${r.archived ? ' <span class="tag off">archived</span>' : ""}
  <small>${esc(r.receiptDate||localDay(r.date))} · <b>${r.total ? money(r.total) : "No total"}</b> · ${plural((r.items||[]).length,"item")}${r.addedToSpent ? " · in Spent" : ""}</small></button>`;
}

function openReceiptDetail(id){
 let r=(data.receipts||[]).find(x=>x.id===id); if(!r) return;
 let items=Array.isArray(r.items) ? r.items : [];
 let prices=(data.priceRecords||[]).filter(p=>p.sourceRef && p.sourceRef.type==="receipt" && p.sourceRef.id===id && !p.archived).length;
 let thumb=safeThumb(r.thumb);
 openSheet(`<h2>🧾 ${esc(r.store||r.name||"Receipt")}</h2>
  ${thumb ? `<img class="thumb-lg" src="${thumb}" alt="Receipt photo">` : ""}
  <div class="row-line"><span>Date</span><b>${esc(r.receiptDate||localDay(r.date))}</b></div>
  ${r.receiptNumber ? `<div class="row-line"><span>Receipt #</span><b>${esc(r.receiptNumber)}</b></div>` : ""}
  ${r.payment ? `<div class="row-line"><span>Paid with</span><b>${esc(r.payment)}</b></div>` : ""}
  <div class="row-line"><span>Total</span><b>${r.total ? money(r.total) : "—"}</b></div>
  <div class="row-line"><span>Counted in Spent</span><b>${r.addedToSpent || r.amount ? "Yes" : "No"}</b></div>
  <div class="row-line"><span>Prices saved to Price Book</span><b>${prices}</b></div>
  ${items.length ? `<table class="receipt-items">${items.map(it=>`<tr><td>${esc(it.name||"")}</td><td class="num">${it.qty ? "×"+esc(String(it.qty)) : ""}</td><td class="num">${it.price!=null ? money(it.price) : ""}</td></tr>`).join("")}</table>` : '<p class="muted">No items were read from this receipt.</p>'}
  <button class="action wide" id="rcArchiveBtn" onclick="toggleReceiptArchive('${esc(r.id)}')">${r.archived ? "📤 Unarchive (show in Receipt Manager)" : "🗂️ Archive (hide from Receipt Manager)"}</button>
  <div class="field-note">Archiving never deletes the receipt or changes Spent.</div>
  <button class="action wide" onclick="closeSheet()">Close</button>`);
}

function toggleReceiptArchive(id){
 let r=(data.receipts||[]).find(x=>x.id===id); if(!r) return;
 r.archived=!r.archived;
 if(r.archived) r.archivedAt=new Date().toISOString(); else delete r.archivedAt;
 audit(r.archived ? "receipt.archive" : "receipt.unarchive",(r.archived ? "Archived receipt " : "Unarchived receipt ")+(r.store||r.name||"")+" ("+money(r.total||0)+") — Spent unchanged",{entity:"receipts",id:r.id});
 closeSheet(); save(); toast(r.archived ? "🗂️ Archived" : "📤 Back in the Receipt Manager");
}

/* =====================================================================
   INVENTORY: explicit "throw out" with a reason (waste tracking)
   ===================================================================== */

if(typeof openInvItem==="function"){
 const openInvItemStage3=openInvItem;
 openInvItem=function(id,prefill){
  openInvItemStage3(id,prefill);
  let it=id ? invById(id) : null;
  if(!it || !(Number(it.quantity)>0)) return;
  let row=[...document.querySelectorAll("#sheetBody .btn-row")].find(r=>r.innerHTML.includes("invUsedUp"));
  if(row) row.insertAdjacentHTML("beforebegin",`<button class="action wide" id="ivThrow" onclick="openThrowOut('${esc(it.id)}')">🗑️ Throw out (expired / spoiled)…</button>`);
 };
}

function openThrowOut(id){
 let it=invById(id); if(!it) return;
 let uv=itemUnitValue(it);
 sheetState={ throwId:id };
 let def=it.perishable && it.expiryDate && it.expiryDate<=todayDay() ? "expired" : "spoiled";
 openSheet(`<h2>🗑️ Throw out ${esc(it.name)}</h2>
  <div class="muted">You have ${qtyText(it.quantity)} ${esc(it.unit)}.</div>
  <label for="toQty">How many</label><input id="toQty" inputmode="decimal" autocomplete="off" value="${esc(qtyText(it.quantity))}">
  <label for="toReason">Why</label><select id="toReason">${Object.entries(C.WASTE_REASONS).map(([k,v])=>`<option value="${k}"${def===k ? " selected" : ""}>${esc(v)}</option>`).join("")}</select>
  <label for="toNote">Note (optional)</label><input id="toNote" autocomplete="off" maxlength="200">
  <div class="field-note">${uv ? "Counted as about "+money(uv)+" per "+esc(it.unit)+" lost (last price you paid)." : "No price for this item yet, so the peso loss can't be counted."} Shows up in Insights → waste.</div>
  <div id="sheetMsg" class="form-msg" aria-live="polite"></div>
  <button class="primary" id="toSave" onclick="saveThrowOut()">🗑️ THROW OUT</button>
  <button class="action wide" onclick="openInvItem('${esc(id)}')">Back</button>`);
}

function saveThrowOut(){
 let it=invById(sheetState.throwId); if(!it) return;
 let q=C.num(val("toQty")), reason=val("toReason");
 if(!(q>0)){ sheetMsg("How many must be above 0."); return; }
 if(q>Number(it.quantity)+1e-9){ sheetMsg("You only have "+qtyText(it.quantity)+" "+it.unit+"."); return; }
 if(!C.WASTE_REASONS[reason]){ sheetMsg("Pick a reason."); return; }
 let uv=itemUnitValue(it);
 let t=changeStock(it,-q,"discard",{ note:val("toNote") });
 if(!t){ closeSheet(); return; }
 t.reason=reason;
 audit("inventory.discard","Threw out "+qtyText(q)+" "+it.unit+" "+it.name+" ("+C.WASTE_REASONS[reason].toLowerCase()+(uv ? ", about "+money(uv*q)+" lost" : "")+")",{entity:"inventoryItems",id:it.id,before:{quantity:t.before},after:{quantity:t.after}});
 closeSheet(); save(); toast("🗑️ Recorded"+(uv ? " · about "+money(uv*q)+" lost" : ""));
}

/* =====================================================================
   PLAN HISTORY & FORECAST SNAPSHOTS (for accuracy tracking)
   ===================================================================== */

if(typeof savePlan==="function"){
 const savePlanStage3=savePlan;
 savePlan=function(){
  let before=data.budgetPlan && data.budgetPlan.updatedAt;
  savePlanStage3();
  let bp=data.budgetPlan;
  if(bp && bp.updatedAt && bp.updatedAt!==before){
   if(!Array.isArray(data.planHistory)) data.planHistory=[];
   data.planHistory.push({ id:Mdl.newId("plan"), at:bp.updatedAt, mode:bp.mode, items:Mdl.clone(bp.items), fund:Number(data.fund)||0, source:"saved" });
   storeData();
  }
 };
}

// One saved 30-day forecast a week, checked against real spending when its window ends.
function recordForecastSnapshot(){
 let today=todayDay();
 if(!Array.isArray(data.forecastSnapshots)) data.forecastSnapshots=[];
 let snaps=data.forecastSnapshots;
 if(snaps.some(s=>s.start && C.daysBetween(C.addDays(s.start,-1),today)<7)) return false;
 let f; try{ f=forecastNow(); }catch(e){ return false; }
 if(!f || !(f.projected>0)) return false;
 snaps.push({ id:Mdl.newId("fcs"), at:new Date().toISOString(), start:f.start, end:f.end, projected:f.projected, basis:f.basis||null });
 return true;
}

/* =====================================================================
   RESTORE: recalculate derived data (never changes money)
   ===================================================================== */

function recalcDerived(){
 let notes=[];
 try{ if(typeof rollCycle==="function") rollCycle(); }catch(e){ console.warn("recalc cycle",e); }
 let rec=false; try{ rec=!!processRecurring(); }catch(e){ console.warn("recalc recurring",e); }
 try{ scanAlerts(); }catch(e){ console.warn("recalc alerts",e); }
 let alerts=typeof activeAlerts==="function" ? activeAlerts().length : 0;
 let open=openListItems();
 let unpriced=open.filter(li=>itemEstimate(li).amount===null).length;
 try{ recordForecastSnapshot(); }catch(e){}
 let ic=Mdl.integrityCheck(data);
 lastIntegrity=ic;
 let hist=recordedSpentTotal(), diff=C.round2((Number(data.spent)||0)-hist);
 notes.push(open.length ? plural(open.length,"list item")+" re-priced from the restored Price Book"+(unpriced ? " ("+unpriced+" without a price)" : "") : "shopping list is empty");
 notes.push(plural(alerts,"alert")+" rechecked");
 if(rec) notes.push("recurring purchases brought up to date");
 notes.push("data check: "+(ic.errors ? plural(ic.errors,"problem") : "no problems"));
 if(Math.abs(diff)>=0.01) notes.push("Spent "+money(data.spent)+" differs from your recorded history ("+money(hist)+") by "+money(Math.abs(diff))+" — not changed automatically; see Budget → History");
 s4State.insKey=null;
 let summary="Recalculated: "+notes.join(" · ")+".";
 logBackup("Derived data recalculated","success","",summary);
 storeData();
 return { summary, integrity:ic, spentDiff:diff, alerts, open:open.length };
}

/* =====================================================================
   HOME cards, render hook, sections
   ===================================================================== */

function homeCards4(){
 let out=[];
 let pend=pendingHouseholdRequests();
 if(pend.length){
  out.push(`<div class="card tap-lite" id="homeRequests" onclick="goTo('requests')"><div class="card-head"><b>📨 Household requests (${pend.length})</b><span class="link">Review</span></div>
   ${pend.slice(0,3).map(r=>`<div class="row-line"><span>${r.urgency==="urgent" ? "⚡ " : ""}${esc(r.title)}${r.qty!==1 ? " ×"+qtyText(r.qty) : ""}</span><small class="muted">${esc(r.requestedByName||"")}</small></div>`).join("")}</div>`);
 }
 if(historyEntries().some(e=>e.counted)){
  let t=C.spendingTrends(analyticsEntries(),C.insightRange("30d",todayDay()));
  out.push(`<div class="card tap-lite" id="homeInsights" onclick="goTo('insights')"><div class="card-head"><b>📊 Insights · last 30 days</b><span class="link">Open</span></div>
   <div class="row-line"><span>Spent</span><b>${money(t.total)}</b></div>
   <div class="muted small">${t.changePct===null ? "Trends, basket price index, savings and waste — from your own records." : (t.changePct>0 ? "▲ " : "▼ ")+pctText(Math.abs(t.changePct))+" vs the 30 days before"}${t.byCategory[0] ? " · most on "+esc(t.byCategory[0].name) : ""}</div></div>`);
 }
 return out;
}
if(typeof homeCards3==="function"){
 const homeCards3Stage3=homeCards3;
 homeCards3=function(){ return homeCards4().concat(homeCards3Stage3()); };
}

function renderStage4Active(){
 if(s4State.day!==todayDay()){
  s4State.day=todayDay();
  if(recordForecastSnapshot()) storeData();
 }
 if(ui.view==="budget" && ui.sub.budget==="insights") renderInsights();
 if(ui.view==="shop" && ui.sub.shop==="product") renderProductPage();
 if(ui.view==="shop" && ui.sub.shop==="receiptArchive") renderReceiptArchive();
 if(ui.view==="more" && ui.sub.more==="requests") renderRequests();
}

Object.assign(SECTION_MAP,{
 insights:["budget","insights","insightsTitle"], requests:["more","requests"], receiptArchive:["shop","receiptArchive"],
 product:["shop","product"], people:["more","household","peopleCard"], preferences:["more","settings","settings4"]
});
