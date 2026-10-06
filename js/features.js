/* =====================================================================
   JASON SHOP — STAGE 1 SCREENS
   Navigation shell (Home · Shop · Inventory · Budget · AI · More),
   home dashboard, AI command bar, household profile, my stores,
   products & price book, budget plan, committed purchases, protected
   reserve, warning levels, audit trail and Data & Backup.
   All numbers come from js/calc.js. Uses `data`, save(), peso(),
   escapeHTML(), parseAmount(), historyEntries()… from js/app.js.
   ===================================================================== */

/* ---------- small helpers ---------- */

const $id=id=>document.getElementById(id);
// Safe in text AND attribute values (escapeHTML() in app.js doesn't escape quotes).
const esc=t=>String(t==null ? "" : t).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const C=window.JasonCalc, Mdl=window.JasonModel;

function todayDay(){ return localDay(new Date()); }

function fmtDateTime(iso){
 if(!iso) return "";
 let d=new Date(iso);
 return isNaN(d) ? String(iso) : d.toLocaleString("en-PH",{month:"short",day:"numeric",year:"numeric",hour:"numeric",minute:"2-digit"});
}

function toast(text){
 let t=$id("toast");
 t.innerText=text;
 t.classList.remove("hidden");
 clearTimeout(toast.timer);
 toast.timer=setTimeout(()=>t.classList.add("hidden"),2600);
}

function stateBadge(state,extra){
 let info=C.STATE_INFO[state] || (state==="UNPLANNED" ? {icon:"❔",label:"NOT IN PLAN"} : C.STATE_INFO.SAFE);
 return `<span class="state s-${String(state).toLowerCase()}">${info.icon} ${esc(info.label)}${extra ? " · "+esc(extra) : ""}</span>`;
}

function emptyState(icon,title,text,buttons){
 return `<div class="card empty"><div class="empty-icon">${icon}</div><b>${esc(title)}</b><p class="muted">${esc(text)}</p>${buttons||""}</div>`;
}

function money(n){ return peso(C.round2(Number(n)||0)); }

/* ---------- audit trail (§97) & backup log (§119) ---------- */

function audit(action,summary,details){
 if(!Array.isArray(data.auditLog)) data.auditLog=[];
 let d=details||{};
 data.auditLog.push({
  id:Mdl.newId("aud"), at:new Date().toISOString(), action:action, summary:summary,
  entity:d.entity||null, entityId:d.id||null,
  amountDelta:(typeof d.delta==="number" && isFinite(d.delta) && d.delta!==0) ? C.round2(d.delta) : null,
  before:d.before===undefined ? null : d.before, after:d.after===undefined ? null : d.after
 });
}

function logBackup(action,status,ref,detail){
 if(!Array.isArray(data.backupLog)) data.backupLog=[];
 data.backupLog.push({ id:Mdl.newId("blog"), at:new Date().toISOString(), action:action, status:status, ref:ref||"", detail:detail||"" });
}

/* Pre-migration safety copy, written BEFORE the upgraded data is saved. */
function finishBootSafety(){

 if(window.JasonStore) JasonStore.requestPersistence();

 if(bootInfo.damaged){
  showBootBanner("⚠️ Some saved data couldn't be read, so Jason Shop started fresh. The damaged copy was kept safely ("+bootInfo.damaged+"). Restore a backup in More → Data & Backup.",true);
 }

 if(!bootInfo.migrated) return;

 let raw=bootRawText;
 let localKey=STORAGE_KEY+".preMigration.v"+bootInfo.fromVersion;
 let label="before upgrade v"+bootInfo.fromVersion+" → v"+bootInfo.toVersion;

 let done=res=>{
  logBackup("Migration backup created",res.ok ? "success" : "failed",res.ref||"",res.ok ? label+" · saved in "+res.where : "Couldn't save a safety copy; your original fields are unchanged in the data.");
  if(bootInfo.valid){
   let L=(bootInfo.steps[0] && bootInfo.steps[0].learned) || {};
   audit("data.upgraded","Jason Shop data upgraded to version "+bootInfo.toVersion+" (all "+bootInfo.after.receipts+" receipts, "+bootInfo.after.manual+" manual entries and "+bootInfo.after.requests+" requests kept; "+(L.priceRecords||0)+" prices learned from receipts)",
    {entity:"data",before:{counts:bootInfo.before},after:{counts:bootInfo.after}});
   showBootBanner("✅ Jason Shop was upgraded. All your data was checked and kept: "+bootInfo.after.receipts+" receipts, "+bootInfo.after.manual+" manual entries, "+bootInfo.after.requests+" shopping requests, Spent "+peso(bootInfo.after.spent)+". "+(L.priceRecords ? L.priceRecords+" prices were added to your new Price Book from your receipts. " : "")+(bootInfo.fromVersion<5 ? "New in this version: Insights (spending trends, your basket price index, real savings, waste and stock-outs, plan accuracy, unusual spending, CSV/PDF export), search, household requests, a receipt archive and product pages. " : "")+(bootInfo.fromVersion===3 ? "Also: smart store picks, a trip planner, price alerts, recurring purchases, a 30-day forecast and Taglish commands. " : (bootInfo.fromVersion===2 ? "Also: home inventory, a smart shopping list, shopping trips and 15-day cycles. " : ""))+"A safety copy of the old data was saved first.");
  }else{
   logBackup("Migration","failed","",(bootInfo.problems||[]).join("; "));
   showBootBanner("⚠️ The upgrade was paused because a safety check didn't match. Your data is unchanged and safe. ("+(bootInfo.problems||[]).join("; ")+")",true);
  }
  persistReady=true;
  storeData();
  persistQueued=false;
  renderActiveView();   // only the logs changed — don't rebuild lists Jason may be tapping
 };

 let fallback=()=>{
  try{ if(!localStorage.getItem(localKey)) localStorage.setItem(localKey,raw); return {ok:true,ref:localKey,where:"phone storage"}; }
  catch(e){ return {ok:false}; }
 };

 if(window.JasonStore){
  let finished=false;
  let once=res=>{ if(!finished){ finished=true; done(res); } };
  // IndexedDB can hang on some phones: fall back to phone storage after 5 s.
  setTimeout(()=>once(fallback()),5000);
  JasonStore.putSnapshot({ reason:label, json:raw, schemaVersion:bootInfo.fromVersion, counts:bootInfo.before })
   .then(id=>once({ok:true,ref:id,where:"safety vault (IndexedDB)"}))
   .catch(()=>once(fallback()));
 }else{
  done(fallback());
 }

}

function showBootBanner(text,warn){
 let b=$id("bootBanner");
 b.innerHTML=`<div>${esc(text)}</div><div class="btn-row" style="grid-template-columns:1fr"><button class="action" onclick="document.getElementById('bootBanner').classList.add('hidden')">OK</button></div>`;
 b.classList.toggle("ok",!warn);
 b.classList.remove("hidden");
}

/* ---------- navigation (§63) ---------- */

const VIEWS=["home","shop","inventory","budget","ai","more"];
const NAV_ID={home:"navHome",shop:"navShop",inventory:"navInventory",budget:"navBudget",ai:"navAI",more:"navMore"};
const DEFAULT_SUB={shop:"stores",budget:"overview",more:"menu"};
let ui={ view:"home", sub:{ shop:"stores", budget:"overview", more:"menu" } };

// Old section names still work (goTo("history") etc.).
const SECTION_MAP={
 home:["home"], shop:["shop"], inventory:["inventory"], ai:["ai"], more:["more","menu"],
 shopping:["ai",null,"shoppingTitle"],
 receipts:["shop","receipts","receiptsTitle"],
 stores:["shop","stores"], prices:["shop","prices"], lists:["shop","list"], list:["shop","list"],
 trip:["shop","trip"], review:["shop","receipts","receiptReview"], cycle:["budget","cycle"],
 budget:["budget","overview","budgetCard"],
 plan:["budget","plan"],
 history:["budget","history","historyTitle"],
 report:["budget","report","reportTitle"],
 commitments:["budget","overview","commitmentsCard"],
 reserve:["budget","overview","reserveCard"],
 thresholds:["budget","overview","thresholdCard"],
 backup:["more","data","backupCard"], data:["more","data"],
 household:["more","household"], audit:["more","audit"], settings:["more","settings"],
 forecast:["budget","forecast"], recurring:["more","recurring"]
};

function showView(view,sub){
 if(!VIEWS.includes(view)) view="home";
 let changed=ui.view!==view;
 ui.view=view;
 document.querySelectorAll("main > section.view").forEach(s=>s.classList.toggle("active",s.dataset.view===view));
 Object.entries(NAV_ID).forEach(([v,id])=>{ let b=$id(id); if(b){ b.classList.toggle("active",v===view); b.setAttribute("aria-current",v===view ? "page" : "false"); } });
 if(sub!==undefined && sub!==null) ui.sub[view]=sub;
 let sec=document.querySelector(`section.view[data-view="${view}"]`);
 if(sec && sec.querySelector("[data-sub]")){
  let current=ui.sub[view]||DEFAULT_SUB[view];
  sec.querySelectorAll(":scope > [data-sub]").forEach(p=>p.classList.toggle("active",p.dataset.sub===current));
  sec.querySelectorAll("[data-subtab]").forEach(b=>b.classList.toggle("on",b.dataset.subtab===current));
 }
 renderActiveView();
 return changed;
}

// Scroll so the tab's own content starts at the top (banners above are skipped).
function scrollToViewTop(view){
 let sec=document.querySelector(`section.view[data-view="${view}"]`);
 if(!sec || view==="home"){ window.scrollTo(0,0); return; }
 let anchor=sec.querySelector(":scope > .subtabs") || sec;
 window.scrollTo(0,Math.max(0,Math.round(anchor.getBoundingClientRect().top+window.scrollY-8)));
}

function showSub(view,sub){
 showView(view,sub);
 scrollToViewTop(view);
}

function goTo(section){
 let m=SECTION_MAP[section] || ["home"];
 let [view,sub,target]=m;
 showView(view,sub===undefined ? undefined : sub);
 if(!target){ if(sub) scrollToViewTop(view); else window.scrollTo(0,0); return; }
 let el=$id(target);
 if(!el){ window.scrollTo(0,0); return; }
 el.scrollIntoView({block:"start"});
 let flashEl=section==="shopping" ? $id("shoppingList") : (section==="history" ? $id("historyCard") : (section==="report" ? $id("reportCard") : el));
 if(flashEl){ flashEl.classList.remove("flash"); void flashEl.offsetWidth; flashEl.classList.add("flash"); }
}

// Show whichever tab holds this element (used when code or tests focus a control).
function revealElement(el){
 if(typeof el==="string") el=document.querySelector(el);
 if(!el || !el.closest) return;
 let sec=el.closest("section.view");
 if(!sec) return;
 let sub=el.closest("[data-sub]");
 if(ui.view!==sec.dataset.view || (sub && ui.sub[sec.dataset.view]!==sub.dataset.sub)){
  showView(sec.dataset.view,sub ? sub.dataset.sub : undefined);
 }
}

function talkFromAI(){
 goTo("home");
 setTimeout(()=>{ $id("micBtn").scrollIntoView({block:"center"}); toggleVoice(); },50);
}

/* ---------- AI command bar (§65) ---------- */

// Budget questions are answered on the phone (free, instant).
// Everything else goes to AI research, exactly like the + Add flow.
function commandSubmit(event){
 if(event) event.preventDefault();
 let input=$id("cmdInput");
 let text=input.value.trim();
 if(!text) return false;
 let answer=localAnswer(text);
 let box=$id("cmdAnswer");
 if(!answer && typeof handleCommand==="function"){ let r=handleCommand(text,"text"); if(r) answer=r.html; }
 if(answer){
  box.innerHTML=answer;
  box.classList.remove("hidden");
  input.value="";
  return false;
 }
 box.classList.add("hidden");
 input.value="";
 input.blur();
 submitRequest(text,"text");
 goTo("shopping");
 return false;
}

function findAmountIn(text){
 let m=String(text).match(/(?:₱|php|p)\s*([\d][\d,]*(?:\.\d+)?\s*[km]?)|([\d][\d,]*(?:\.\d+)?)\s*(k|m|pesos?|php)\b/i);
 if(!m){
  // bare number ("can I afford 5000", "afford 4.5k")
  let b=String(text).match(/(\d[\d,]*(?:\.\d+)?)\s*([km])?\b/i);
  if(!b) return null;
  let v=parseAmount(b[1]+(b[2]||""));
  return v>0 ? v : null;
 }
 let raw=m[1] ? m[1] : m[2]+(/^[km]$/i.test(m[3]) ? m[3] : "");
 let v=parseAmount(raw.replace(/\s+/g,""));
 return v>0 ? v : null;
}

function localAnswer(text){
 let t=text.toLowerCase();
 let b=budgetNow();
 if(/can (i|we) afford|kaya ko ba|afford/.test(t)){
  let amount=findAmountIn(text);
  if(!amount) return null;     // no amount → let research handle it (it knows the budget)
  if(b.state==="SETUP") return "⚙️ Set your Shopping Fund first (Budget tab), then I can answer that.";
  let after=C.budgetSummary({fund:data.fund,spent:data.spent,stop:data.stop,committed:b.committed+amount,reserve:b.reserve,thresholds:data.settings.thresholds});
  if(after.overBy>0) return `⛔ <b>No.</b> ${money(amount)} would put you <b>over the limit by ${money(after.overBy)}</b>. Safe to spend right now: ${money(b.safeToSpend)}.`+(typeof fundCheckLine==="function" ? fundCheckLine(amount) : "");
  return `${after.stateInfo.icon} <b>Yes.</b> ${money(amount)} fits. You'd have <b>${money(after.safeToSpend)}</b> safe to spend left (${esc(after.stateInfo.label)}, ${Math.round(after.usedPct)}% used).`+(typeof fundCheckLine==="function" ? fundCheckLine(amount) : "");
 }
 if(/safe to spend|how much (can i|can we|do i have|is left|left)|budget left|magkano pa/.test(t)){
  if(b.state==="SETUP") return "⚙️ Set your Shopping Fund first (Budget tab).";
  return `${b.stateInfo.icon} Safe to spend: <b>${money(b.safeToSpend)}</b>${b.overBy>0 ? " · <b>OVER LIMIT BY "+money(b.overBy)+"</b>" : ""}. Fund ${money(b.fund)} − spent ${money(b.spent)} − committed ${money(b.committed)} − reserve ${money(b.reserve)}${b.stop>0 ? "; hard stop "+money(b.stop) : ""}.`;
 }
 return typeof localAnswer2==="function" ? localAnswer2(text) : null;
}

/* ---------- derived numbers ---------- */

function activeCommitments(){ return (data.commitments||[]).filter(c=>c.status==="committed"); }
function committedTotal(){ return C.sum(activeCommitments(),c=>c.amount); }
function activeReserves(){ return (data.reserves||[]).filter(r=>!r.archived); }
function reserveTotal(){ return C.sum(activeReserves(),r=>r.amount); }
function currentPeriod(){ return C.periodRange(data.settings && data.settings.budgetPeriod,todayDay()); }
function periodLabel(p){
 let f=d=>{ let [y,m,dd]=d.split("-").map(Number); return new Date(y,m-1,dd).toLocaleDateString("en-PH",{month:"short",day:"numeric"}); };
 return f(p.start)+" – "+f(p.end);
}
function recordedSpentTotal(){ return C.sum(historyEntries().filter(e=>e.counted),e=>e.amount); }

function storeLabel(s){ return s ? (s.shortName || s.name) : ""; }
function storeById(id){ return (data.stores||[]).find(s=>s.id===id) || null; }
function productById(id){ return (data.products||[]).find(p=>p.id===id) || null; }

// Which store an entry/record belongs to: explicit id, else exact name/alias match.
function resolveStore(storeId,storeName){
 return (storeId && storeById(storeId)) || Mdl.findStoreByName(data.stores,storeName);
}

// Receipt lines waiting for a "is this the same product?" check stay out of price stats.
function priceRecordsFor(productId){
 return (data.priceRecords||[]).filter(r=>r.productId===productId && !r.archived && !(r.needsReview && r.matchConfidence==="review"));
}

function statsInput(rec,product){
 let s=resolveStore(rec.storeId,rec.storeName);
 return { price:rec.price, qty:rec.qty, size:product && product.size, unit:product && product.unit, packCount:product && product.packCount,
  date:rec.date, createdAt:rec.createdAt, storeKey:s ? s.id : (rec.storeName ? "name:"+Mdl.normalizeName(rec.storeName) : ""), storeName:s ? storeLabel(s) : rec.storeName, status:rec.status, archived:rec.archived };
}

function productStats(p){
 return C.priceStats(priceRecordsFor(p.id).map(r=>statsInput(r,p)));
}

function archivePriceRecordsFor(receiptId,reason){
 (data.priceRecords||[]).forEach(pr=>{
  if(pr.sourceRef && pr.sourceRef.type==="receipt" && pr.sourceRef.id===receiptId && !pr.archived){
   pr.archived=true; pr.archivedReason=reason; pr.archivedAt=new Date().toISOString();
  }
 });
}

function productTitle(p){
 return [p.brand,p.name,p.variant].filter(Boolean).join(" · ");
}

function sizeText(p){
 if(!p.size && !p.unit) return "";
 return (p.packCount>1 ? p.packCount+" × " : "")+(p.size ? C.round2(p.size)+" " : "")+C.unitLabel(p.unit);
}

function trendHTML(st){
 if(!st || st.trendPct===null) return '<span class="muted">— not enough data for a trend</span>';
 if(st.trend==="up") return `<span class="trend up">▲ up ${Math.abs(st.trendPct)}%</span> <span class="muted">vs previous</span>`;
 if(st.trend==="down") return `<span class="trend down">▼ down ${Math.abs(st.trendPct)}%</span> <span class="muted">vs previous</span>`;
 return `<span class="trend flat">● no change</span>`;
}

function priceValueText(st,v){
 return v===null || v===undefined ? "—" : money(v)+(st.basis==="unit" ? "/"+st.per : "");
}

/* ---------- sheet (generic bottom sheet for new forms) ---------- */

function openSheet(html){
 $id("sheetBody").innerHTML=html;
 $id("sheetModal").classList.remove("hidden");
 $id("sheetBody").scrollTop=0;
}
function closeSheet(){ $id("sheetModal").classList.add("hidden"); $id("sheetBody").innerHTML=""; sheetState={}; }
let sheetState={};
function sheetMsg(text,ok){ let m=$id("sheetMsg"); if(m){ m.innerText=text; m.className="form-msg "+(ok ? "ok" : "err"); } }
function val(id){ let e=$id(id); return e ? e.value.trim() : ""; }

/* =====================================================================
   RENDER
   ===================================================================== */

function renderStage1(){
 renderHomeCards();
 renderActiveView();
}

function renderActiveView(){
 try{
  if(ui.view==="home") renderHomeCards();
  if(ui.view==="budget"){ renderBudgetOverview(); if(ui.sub.budget==="plan") renderPlan(); }
  if(ui.view==="shop"){
   if(ui.sub.shop==="stores") renderStores();
   if(ui.sub.shop==="prices") renderPrices();
   if(ui.sub.shop==="list") renderLists();
  }
  if(ui.view==="inventory") renderInventory();
  if(ui.view==="more"){
   if(ui.sub.more==="menu") renderMoreMenu();
   if(ui.sub.more==="household") renderHousehold();
   if(ui.sub.more==="data") renderDataBackup();
   if(ui.sub.more==="audit") renderAudit();
   if(ui.sub.more==="settings") renderSettings();
  }
  if(typeof renderStage2Active==="function") renderStage2Active();
  if(typeof renderStage3Active==="function") renderStage3Active();
  if(typeof renderStage4Active==="function") renderStage4Active();
 }catch(error){
  console.warn("render",error);
 }
}

/* ---------- HOME dashboard (§29, §56, §64) — real numbers only ---------- */

function renderHomeCards(){
 let box=$id("homeCards");
 if(!box) return;
 let period=currentPeriod();
 let entries=historyEntries();
 let monthSpent=C.sum(entries.filter(e=>e.counted && C.inRange(e.date,period)),e=>e.amount);
 $id("monthDisplay").innerText=peso(monthSpent);
 $id("monthLabelSmall").innerText="THIS PERIOD ("+periodLabel(period).toUpperCase()+")";

 let out=(typeof homeCards3==="function" ? homeCards3() : []).concat(typeof homeCards2==="function" ? homeCards2() : []);

 let plan=planRows();
 if(plan.rows.length){
  let top=plan.rows.slice().sort((a,b)=>(b.r.usedPct===null ? 999 : b.r.usedPct)-(a.r.usedPct===null ? 999 : a.r.usedPct)).slice(0,4);
  out.push(`<div class="card"><div class="card-head"><b>📊 Budget plan · ${esc(periodLabel(period))}</b><button class="link" onclick="goTo('plan')">Open</button></div>
   ${top.map(x=>catBar(x)).join("")}
   <div class="row-line"><span>Cycle remaining</span><b>${C.limitText(plan.cycle.rawRemaining)}</b></div></div>`);
 }else{
  out.push(emptyState("📊","No budget plan yet","Split your fund into categories (groceries, household, baby, pets…) to see what's left in each.",`<button class="action" onclick="goTo('plan')">Set up budget plan</button>`));
 }

 let act=activeCommitments();
 if(act.length){
  let next=act.slice().sort((a,b)=>String(a.dueDate||"9999").localeCompare(String(b.dueDate||"9999"))).slice(0,3);
  out.push(`<div class="card"><div class="card-head"><b>📌 Committed purchases · ${money(committedTotal())}</b><button class="link" onclick="goTo('commitments')">Manage</button></div>
   ${next.map(c=>`<div class="row-line"><span>${esc(c.title)}${c.dueDate ? ' <small class="muted">due '+esc(c.dueDate)+'</small>' : ""}</span><b>${money(c.amount)}</b></div>`).join("")}</div>`);
 }

 let hh=C.householdSize(data.memberGroups);
 let houses=(data.houses||[]).filter(h=>!h.archived);
 if(hh.people+hh.pets>0){
  out.push(`<div class="card tap-lite" onclick="goTo('household')"><div class="card-head"><b>🏠 Household</b><span class="link">Edit</span></div>
   <div class="muted">${hh.people} ${hh.people===1?"person":"people"} (${hh.adults} adults, ${hh.children} children, ${hh.staff} staff)${hh.pets ? " · "+hh.pets+" pet"+(hh.pets===1?"":"s") : ""} · ${houses.length} house${houses.length===1?"":"s"}</div></div>`);
 }else{
  out.push(emptyState("🏠","Set up your household","Add how many adults, children, staff and pets you shop for. Future forecasts use these numbers.",`<button class="action" onclick="goTo('household')">Set up household</button>`));
 }

 let products=(data.products||[]).filter(p=>!p.archived);
 let withStats=products.map(p=>({p,st:productStats(p)})).filter(x=>x.st.count>0);
 if(withStats.length){
  let moved=withStats.filter(x=>x.st.trendPct!==null && x.st.trend!=="flat").sort((a,b)=>Math.abs(b.st.trendPct)-Math.abs(a.st.trendPct)).slice(0,3);
  out.push(`<div class="card"><div class="card-head"><b>🏷️ Price Book</b><button class="link" onclick="goTo('prices')">Open</button></div>
   <div class="muted">${withStats.length} product${withStats.length===1?"":"s"} · ${C.sum(withStats,x=>x.st.count)} recorded prices</div>
   ${moved.length ? moved.map(x=>`<div class="row-line"><span>${esc(productTitle(x.p))}</span>${trendHTML(x.st)}</div>`).join("") : '<div class="field-note">Price changes appear here once a product has been bought more than once.</div>'}</div>`);
 }else{
  out.push(emptyState("🏷️","Your Price Book is empty","Prices are learned from receipts you save, or ones you enter. Nothing is guessed.",`<button class="action" onclick="receiptCamera()">🧾 Scan a receipt</button>`));
 }

 let recent=entries.slice(0,5);
 if(recent.length){
  out.push(`<div class="card"><div class="card-head"><b>🕘 Recent spending</b><button class="link" onclick="goTo('history')">All</button></div>
   ${recent.map(e=>`<div class="row-line"><span>${SOURCE_ICON[e.source]||""} ${esc(e.title)} <small class="muted">${esc(e.date||"")}</small></span><b>${money(e.amount)}</b></div>`).join("")}</div>`);
 }

 box.innerHTML=out.join("");
}

function catBar(x){
 let r=x.r, pctUsed=r.usedPct===null ? 100 : Math.min(100,r.usedPct);
 return `<div class="bar-row"><div class="lbl"><span>${x.cat.icon} ${esc(x.cat.name)}</span><span>${r.overBy>0 ? '<b class="red">OVER BY '+money(r.overBy)+'</b>' : money(r.remaining)+" left"}</span></div>
  <div class="bar"><span class="u-${String(r.state).toLowerCase()}" style="width:${pctUsed}%"></span></div>
  <small class="muted">${stateBadge(r.state)} ${money(r.spent)} spent${r.committed ? " + "+money(r.committed)+" committed" : ""} of ${money(r.allocated)}</small></div>`;
}

/* ---------- BUDGET overview: breakdown, commitments, reserve, thresholds ---------- */

function renderBudgetOverview(){
 let b=budgetNow();
 let recorded=recordedSpentTotal();
 let diff=C.round2(b.spent-recorded);
 $id("stopNote").innerText="Warnings at "+data.settings.thresholds.watch+"% (WATCH) and "+data.settings.thresholds.warning+"% (WARNING); HARD STOP at "+data.settings.thresholds.hardStop+"%.";

 $id("safeBreakdown").innerHTML=`<div class="card">
  <h3 class="card-title">🧮 How Safe to Spend is worked out</h3>
  ${b.fund>0 ? `
   <div class="calc-line"><span>Shopping fund</span><b>${money(b.fund)}</b></div>
   <div class="calc-line"><span>− Spent</span><b>${money(b.spent)}</b></div>
   <div class="calc-line"><span>− Committed purchases</span><b>${money(b.committed)}</b></div>
   <div class="calc-line"><span>− Protected reserve</span><b>${money(b.reserve)}</b></div>
   <div class="calc-line total"><span>= Left in the fund</span><b>${C.limitText(b.safeFromFund)}</b></div>` : '<p class="muted">Set a Shopping Fund above to start.</p>'}
  ${b.stop>0 ? `
   <div class="calc-line"><span>Hard stop ${money(b.stop)} − spent − committed</span><b>${C.limitText(b.safeFromStop)}</b></div>` : ""}
  ${b.rawSafe!==null ? `<div class="calc-line total big"><span>Safe to spend${b.fund>0 && b.stop>0 ? " (the lower one)" : ""}</span><b>${C.limitText(b.rawSafe)}</b></div>
   <div>${stateBadge(b.state,b.usedPct===null ? "" : Math.round(b.usedPct)+"% used")}</div>` : ""}
  ${b.availableCash!==null ? `<div class="calc-line"><span>Available cash (fund − spent)</span><b>${C.limitText(b.availableCash,"OVER BY")}</b></div>` : ""}
  ${Math.abs(diff)>=0.01 ? `<div class="field-note">ℹ️ Spent is ${money(b.spent)}; your recorded purchases add up to ${money(recorded)}. ${diff>0 ? "The difference was typed directly into Spent." : "Some recorded purchases aren't counted in Spent."}</div>` : ""}
 </div>`;

 let act=activeCommitments();
 let done=(data.commitments||[]).filter(c=>c.status!=="committed").slice(-5).reverse();
 $id("commitmentsCard").innerHTML=`<div class="card">
  <div class="card-head"><h3 class="card-title">📌 Committed purchases</h3><b>${money(committedTotal())}</b></div>
  <p class="field-note">Money you've promised but not paid yet (orders, deposits, planned buys). It's taken out of Safe to Spend now so you don't spend it twice.</p>
  ${act.length ? act.map(c=>`<div class="list-row">
    <div><b>${esc(c.title)}</b><small class="muted"> ${esc(c.categoryName||"")}${c.storeName ? " · "+esc(c.storeName) : ""}${c.dueDate ? " · due "+esc(c.dueDate) : ""}</small></div>
    <div class="list-actions"><b>${money(c.amount)}</b>
     <button class="mini buy" onclick="payCommitment('${c.id}')">✅ Paid</button>
     <button class="mini" onclick="openCommitment('${c.id}')" aria-label="Edit">✏️</button>
     <button class="mini" onclick="cancelCommitment('${c.id}')">✕ Cancel</button></div></div>`).join("") : '<p class="muted">No committed purchases.</p>'}
  <button class="action wide" onclick="openCommitment(null)">➕ Add committed purchase</button>
  ${done.length ? `<details><summary>Recent paid / cancelled (${done.length})</summary>${done.map(c=>`<div class="row-line"><span>${c.status==="paid" ? "✅" : "✕"} ${esc(c.title)} <small class="muted">${esc(c.status)}</small></span><span>${money(c.amount)}</span></div>`).join("")}</details>` : ""}
 </div>`;

 let res=activeReserves();
 $id("reserveCard").innerHTML=`<div class="card">
  <div class="card-head"><h3 class="card-title">🛡️ Protected reserve</h3><b>${money(reserveTotal())}</b></div>
  <p class="field-note">Money in the fund that Jason Shop never counts as spendable (emergencies, school fees…).</p>
  ${res.length ? res.map(r=>`<div class="list-row"><div><b>${esc(r.name)}</b>${r.note ? '<small class="muted"> '+esc(r.note)+'</small>' : ""}</div>
    <div class="list-actions"><b>${money(r.amount)}</b><button class="mini" onclick="openReserve('${r.id}')" aria-label="Edit">✏️</button></div></div>`).join("") : '<p class="muted">No reserve set.</p>'}
  <button class="action wide" onclick="openReserve(null)">➕ Add reserve</button>
 </div>`;

 let t=data.settings.thresholds;
 $id("thresholdCard").innerHTML=`<div class="card">
  <h3 class="card-title">🚦 Warning levels</h3>
  <p class="field-note">Percent of your limit used (spent + committed). Defaults: 0–69 ✅ SAFE · 70–84 👀 WATCH · 85–99 ⚠️ WARNING · 100 ⛔ HARD STOP.</p>
  <div class="three">
   <div><label for="thWatch">👀 WATCH %</label><input id="thWatch" inputmode="numeric" value="${t.watch}"></div>
   <div><label for="thWarning">⚠️ WARNING %</label><input id="thWarning" inputmode="numeric" value="${t.warning}"></div>
   <div><label for="thHard">⛔ STOP %</label><input id="thHard" inputmode="numeric" value="${t.hardStop}"></div>
  </div>
  <div id="thMsg" class="form-msg" aria-live="polite"></div>
  <div class="btn-row"><button class="action" onclick="saveThresholds()">Save levels</button><button class="action" onclick="resetThresholds()">Reset to defaults</button></div>
 </div>`;
}

function saveThresholds(){
 let t={ watch:C.num(val("thWatch")), warning:C.num(val("thWarning")), hardStop:C.num(val("thHard")) };
 let v=C.validateThresholds(t);
 let m=$id("thMsg");
 if(!v.ok){ m.innerText="⚠️ "+v.errors.join(" "); m.className="form-msg err"; return; }
 let before=Object.assign({},data.settings.thresholds);
 data.settings.thresholds=t;
 audit("thresholds.save","Warning levels: WATCH "+t.watch+"%, WARNING "+t.warning+"%, HARD STOP "+t.hardStop+"%",{entity:"settings",before,after:t});
 save();
 toast("✅ Warning levels saved");
}

function resetThresholds(){
 let before=Object.assign({},data.settings.thresholds);
 data.settings.thresholds=Object.assign({},C.DEFAULT_THRESHOLDS);
 audit("thresholds.save","Warning levels reset to defaults",{entity:"settings",before,after:data.settings.thresholds});
 save();
 toast("Warning levels reset");
}

/* Committed purchases (§13–14, §74) */

function categoryOptions(selected){
 let list=activeCategories().slice();
 if(selected && !list.some(c=>c.name===selected)) list.push(categoryInfo(selected));
 return list.map(c=>`<option value="${esc(c.name)}" ${c.name===selected ? "selected" : ""}>${c.icon} ${esc(c.name)}</option>`).join("");
}

function storeOptions(selectedId,withNone){
 let list=(data.stores||[]).filter(s=>!s.archived);
 return (withNone ? `<option value="">— none / other —</option>` : "")+list.map(s=>`<option value="${s.id}" ${s.id===selectedId ? "selected" : ""}>${esc(storeLabel(s))}</option>`).join("");
}

function openCommitment(id){
 let c=id ? data.commitments.find(x=>x.id===id) : null;
 sheetState={ commitmentId:id, confirmedOverStop:false };
 openSheet(`<h2>${c ? "Edit" : "Add"} committed purchase</h2>
  <label for="cmTitle">What is it?</label><input id="cmTitle" autocomplete="off" placeholder="e.g. Rice cooker order, Landers monthly haul" value="${esc(c ? c.title : "")}">
  <div class="two"><div><label for="cmAmount">Amount ₱</label><input id="cmAmount" inputmode="decimal" autocomplete="off" placeholder="0" value="${c ? amountForInput(c.amount) : ""}" oninput="if(typeof liveFundCheck==='function')liveFundCheck('cmAmount','cmFund')"></div>
  <div><label for="cmDue">Due date (optional)</label><input id="cmDue" type="date" value="${esc(c ? c.dueDate||"" : "")}"></div></div>
  <div class="two"><div><label for="cmCat">Category</label><select id="cmCat">${categoryOptions(c ? c.categoryName : "Groceries")}</select></div>
  <div><label for="cmStore">Store</label><select id="cmStore">${storeOptions(c ? c.storeId : "",true)}</select></div></div>
  <label for="cmNote">Note (optional)</label><input id="cmNote" autocomplete="off" value="${esc(c ? c.note||"" : "")}">
  <div id="cmFund">${c && typeof fundCheckLine==="function" ? fundCheckLine(c.amount) : ""}</div>
  <div id="sheetMsg" class="form-msg" aria-live="polite"></div>
  <button class="primary" onclick="saveCommitment()">✅ SAVE</button>
  <button class="action wide" onclick="closeSheet()">Cancel</button>`);
}

function saveCommitment(){
 let title=val("cmTitle"), amount=parseAmount(val("cmAmount"));
 if(!title){ sheetMsg("Please say what the purchase is."); return; }
 if(amount===null || isNaN(amount) || amount<=0){ sheetMsg("Please enter the amount, for example 4,500 or 4.5k."); return; }
 let c=sheetState.commitmentId ? data.commitments.find(x=>x.id===sheetState.commitmentId) : null;
 let extra=c ? amount-c.amount : amount;
 let b=budgetNow();
 if(extra>0 && C.crossesHardStop(b,extra,{includeCommitted:true}) && !sheetState.confirmedOverStop){
  sheetMsg("⚠️ This takes spent + committed to "+money(b.spent+b.committed+extra)+", past your hard stop of "+money(b.stop)+". Tap SAVE again to commit anyway.");
  sheetState.confirmedOverStop=true;
  return;
 }
 let store=storeById(val("cmStore"));
 let fields={ title, amount:C.round2(amount), dueDate:val("cmDue")||null, categoryName:val("cmCat")||"Other", storeId:store ? store.id : null, storeName:store ? storeLabel(store) : "", note:val("cmNote") };
 if(c){
  let before=Mdl.clone(c);
  Object.assign(c,fields,{updatedAt:new Date().toISOString()});
  audit("commitment.edit","Edited commitment: "+title+" "+money(before.amount)+" → "+money(amount),{entity:"commitments",id:c.id,before,after:fields});
 }else{
  let nc=Object.assign({ id:Mdl.newId("cmt"), status:"committed", createdAt:new Date().toISOString(), updatedAt:new Date().toISOString() },fields);
  data.commitments.push(nc);
  audit("commitment.add","Committed "+money(amount)+": "+title,{entity:"commitments",id:nc.id,after:fields});
 }
 closeSheet();
 save();
 toast("✅ Commitment saved — Safe to Spend updated");
}

function payCommitment(id){
 let c=data.commitments.find(x=>x.id===id);
 if(!c || c.status!=="committed") return;
 if(!confirm("Mark \""+c.title+"\" as paid?\n\n"+peso(c.amount)+" moves from Committed to Spent and is added to your Purchase History.")) return;
 let entry={ id:"M"+Date.now(), date:todayDay(), store:c.storeName||"", item:c.title, amount:c.amount, category:c.categoryName||"Other", payment:"", counted:true, fromCommitment:c.id };
 data.manual.unshift(entry);
 let before=data.spent;
 data.spent=C.round2(data.spent+c.amount);
 c.status="paid"; c.paidAt=new Date().toISOString(); c.paidEntryId=entry.id; c.updatedAt=c.paidAt;
 audit("commitment.paid","Paid commitment: "+c.title+" "+money(c.amount)+" (now in Spent)",{entity:"commitments",id:c.id,delta:c.amount,before:{spent:before},after:{spent:data.spent,entryId:entry.id}});
 save();
 toast("✅ Paid — added to Spent and History");
}

function cancelCommitment(id){
 let c=data.commitments.find(x=>x.id===id);
 if(!c || c.status!=="committed") return;
 if(!confirm("Cancel \""+c.title+"\" ("+peso(c.amount)+")? It stays in the list as cancelled.")) return;
 c.status="cancelled"; c.cancelledAt=new Date().toISOString(); c.updatedAt=c.cancelledAt;
 audit("commitment.cancel","Cancelled commitment: "+c.title+" "+money(c.amount),{entity:"commitments",id:c.id,before:{status:"committed"},after:{status:"cancelled"}});
 save();
}

/* Protected reserve */

function openReserve(id){
 let r=id ? data.reserves.find(x=>x.id===id) : null;
 sheetState={ reserveId:id };
 openSheet(`<h2>${r ? "Edit" : "Add"} protected reserve</h2>
  <label for="rsName">Name</label><input id="rsName" autocomplete="off" placeholder="e.g. Emergency, School fees" value="${esc(r ? r.name : "")}">
  <label for="rsAmount">Amount ₱</label><input id="rsAmount" inputmode="decimal" autocomplete="off" value="${r ? amountForInput(r.amount) : ""}">
  <label for="rsNote">Note (optional)</label><input id="rsNote" autocomplete="off" value="${esc(r ? r.note||"" : "")}">
  <div id="sheetMsg" class="form-msg" aria-live="polite"></div>
  <button class="primary" onclick="saveReserve()">✅ SAVE</button>
  ${r ? `<button class="action wide" onclick="removeReserve('${r.id}')">Remove this reserve</button>` : ""}
  <button class="action wide" onclick="closeSheet()">Cancel</button>`);
}

function saveReserve(){
 let name=val("rsName")||"Reserve", amount=parseAmount(val("rsAmount"));
 if(amount===null || isNaN(amount) || amount<0){ sheetMsg("Please enter the amount, for example 50,000 or 50k."); return; }
 let r=sheetState.reserveId ? data.reserves.find(x=>x.id===sheetState.reserveId) : null;
 if(r){
  let before={name:r.name,amount:r.amount};
  Object.assign(r,{name,amount:C.round2(amount),note:val("rsNote"),updatedAt:new Date().toISOString()});
  audit("reserve.edit","Reserve "+name+": "+money(before.amount)+" → "+money(amount),{entity:"reserves",id:r.id,delta:null,before,after:{name,amount}});
 }else{
  let nr={ id:Mdl.newId("rsv"), name, amount:C.round2(amount), note:val("rsNote"), archived:false, createdAt:new Date().toISOString() };
  data.reserves.push(nr);
  audit("reserve.add","Protected reserve added: "+name+" "+money(amount),{entity:"reserves",id:nr.id,after:{name,amount}});
 }
 closeSheet(); save(); toast("✅ Reserve saved — Safe to Spend updated");
}

function removeReserve(id){
 let r=data.reserves.find(x=>x.id===id);
 if(!r || !confirm("Remove the reserve \""+r.name+"\" ("+peso(r.amount)+")? That money becomes spendable again.")) return;
 r.archived=true; r.archivedAt=new Date().toISOString();
 audit("reserve.remove","Protected reserve removed: "+r.name+" "+money(r.amount),{entity:"reserves",id:r.id,before:{amount:r.amount},after:{archived:true}});
 closeSheet(); save();
}

/* ---------- BUDGET PLAN: allocation (§12, §75) ---------- */

let planDraft=null;   // { mode, values:{catId:value}, preview:bool }

function planBase(){ return C.round2(Math.max(0,(Number(data.fund)||0)-reserveTotal())); }

function planRows(){
 let period=currentPeriod();
 let spentBy=C.spendingByCategory(historyEntries(),period);
 let committedBy={};
 activeCommitments().forEach(c=>{ let k=c.categoryName||"Other"; committedBy[k]=C.round2((committedBy[k]||0)+c.amount); });
 let alloc=C.computeAllocation({ base:planBase(), mode:data.budgetPlan.mode, items:data.budgetPlan.items.map(it=>({id:it.categoryId,value:it.value})) });
 let amountBy={}; alloc.rows.forEach(r=>{ amountBy[r.id]=r.amount; });
 let rows=[];
 if(data.budgetPlan.items.length){
  allCategories().forEach(cat=>{
   let a=amountBy[cat.id]||0, s=spentBy[cat.name]||0, c=committedBy[cat.name]||0;
   if(a<=0 && s<=0 && c<=0) return;
   rows.push({ cat, r:C.categoryRemaining(a,s,c,data.settings.thresholds), v:C.variance(a,s+c) });
  });
  Object.keys(spentBy).forEach(name=>{ if(!allCategories().some(c=>c.name===name)) rows.push({cat:categoryInfo(name),r:C.categoryRemaining(0,spentBy[name],0),v:C.variance(0,spentBy[name])}); });
 }
 let cycle=C.cycleRemaining(rows.map(x=>x.r),data.settings.thresholds);
 return { rows, cycle, alloc, period };
}

function renderPlan(){
 let box=$id("planBody");
 let base=planBase();
 if(!planDraft){
  let values={};
  data.budgetPlan.items.forEach(it=>{ values[it.categoryId]=it.value; });
  planDraft={ mode:data.budgetPlan.mode, values, preview:false };
 }
 let cats=activeCategories();
 let alloc=draftAllocation();
 let plan=planRows();
 let period=currentPeriod();

 let current=data.budgetPlan.items.length ? `<div class="card">
   <div class="card-head"><h3 class="card-title">📅 This period · ${esc(periodLabel(period))}</h3>${stateBadge(plan.cycle.state)}</div>
   ${plan.rows.length ? plan.rows.map(x=>catBar(x)+`<div class="variance">${x.v.direction==="over" ? "🔺 Over plan by "+money(x.v.overspend) : (x.v.direction==="under" ? "🟢 Under plan by "+money(x.v.saving) : "● On plan")}</div>`).join("") : '<p class="muted">Nothing spent yet this period.</p>'}
   <div class="calc-line total"><span>Cycle remaining</span><b>${C.limitText(plan.cycle.rawRemaining)}</b></div>
   <div class="calc-line"><span>Planned</span><b>${money(plan.cycle.allocated)}</b></div>
   <div class="calc-line"><span>Spent + committed</span><b>${money(plan.cycle.spent+plan.cycle.committed)}</b></div>
   <div class="calc-line"><span>${plan.cycle.rawRemaining>=0 ? "Saving vs plan so far" : "Over plan"}</span><b>${money(Math.abs(plan.cycle.rawRemaining))}</b></div>
  </div>` : "";

 box.innerHTML=current+`<div class="card" id="planEditor">
  <h3 class="card-title">✏️ Budget plan</h3>
  <p class="field-note">Plan base = Shopping fund ${money(data.fund)} − protected reserve ${money(reserveTotal())} = <b>${money(base)}</b>. The plan repeats every period (starts on day ${data.settings.budgetPeriod.startDay}).</p>
  <div class="seg" role="group" aria-label="Allocation mode">
   <button id="modePeso" class="${planDraft.mode==="peso" ? "on" : ""}" onclick="setPlanMode('peso')">₱ Pesos</button>
   <button id="modePct" class="${planDraft.mode==="percent" ? "on" : ""}" onclick="setPlanMode('percent')">% Percent</button>
  </div>
  <div class="alloc-list">
   ${cats.map(c=>{ let row=alloc.rows.find(r=>r.id===c.id)||{}; let v=planDraft.values[c.id]; return `<div class="alloc-row">
     <label for="al_${c.id}">${c.icon} ${esc(c.name)}</label>
     <input id="al_${c.id}" inputmode="decimal" autocomplete="off" placeholder="0" value="${v!=null && v!==0 && v!=="" ? esc(planDraft.mode==="peso" && typeof v==="number" ? amountForInput(v) : v) : ""}" oninput="planInput('${c.id}',this.value)">
     <small class="muted" id="alx_${c.id}">${allocHint(row)}</small>
    </div>`; }).join("")}
  </div>
  <div id="planTotals">${planTotalsHTML(alloc)}</div>
  <div id="planPreview"></div>
  <button class="primary" id="previewPlanBtn" onclick="previewPlan()">👀 PREVIEW PLAN</button>
  ${data.budgetPlan.items.length ? `<button class="action wide" onclick="planDraft=null;renderPlan()">↺ Undo my changes</button>` : ""}
 </div>
 ${categoryManagerHTML()}
 <div class="card"><h3 class="card-title">📆 Budget period</h3>
  <label for="periodDay">Each period starts on day</label>
  <input id="periodDay" inputmode="numeric" value="${data.settings.budgetPeriod.startDay}">
  <div class="field-note">Monthly. Use 1 for calendar months, or your payday (1–28).</div>
  <button class="action wide" onclick="savePeriod()">Save period</button></div>`;
}

function allocHint(row){
 if(!row || !row.amount) return "";
 return planDraft.mode==="peso" ? (row.percent!=null ? row.percent+"%" : "") : money(row.amount);
}

function draftAllocation(){
 return C.computeAllocation({ base:planBase(), mode:planDraft.mode,
  items:activeCategories().map(c=>({ id:c.id, name:c.name, value:planDraft.values[c.id]==null ? "" : planDraft.values[c.id] })) });
}

function planTotalsHTML(alloc){
 let parts=[`<div class="calc-line"><span>Allocated</span><b>${money(alloc.totalAllocated)}${alloc.totalPercent!=null ? " · "+alloc.totalPercent+"%" : ""}</b></div>`];
 if(alloc.overAllocated>0) parts.push(`<div class="alloc-msg err">⛔ OVER-ALLOCATED by ${money(alloc.overAllocated)} — lower some categories before saving.</div>`);
 else if(alloc.unallocated>0) parts.push(`<div class="alloc-msg warn">ℹ️ UNALLOCATED: ${money(alloc.unallocated)} isn't assigned to a category yet.</div>`);
 else if(alloc.base>0 && alloc.totalAllocated>0) parts.push(`<div class="alloc-msg ok">✅ Fully allocated.</div>`);
 alloc.errors.filter(e=>e.code!=="over_allocated").forEach(e=>parts.push(`<div class="alloc-msg err">⚠️ ${esc(e.message)}</div>`));
 return parts.join("");
}

function planInput(catId,text){
 let t=String(text).trim();
 let v=planDraft.mode==="peso" ? parseAmount(t) : C.num(t.replace(/%/g,""));
 planDraft.values[catId]=t==="" ? null : (v===null || isNaN(v) ? t : v);
 planDraft.preview=false;
 let alloc=draftAllocation();
 let x=$id("alx_"+catId);
 if(x) x.innerText=allocHint(alloc.rows.find(r=>r.id===catId));
 $id("planTotals").innerHTML=planTotalsHTML(alloc);
 $id("planPreview").innerHTML="";
}

function setPlanMode(mode){
 if(mode===planDraft.mode) return;
 let alloc=draftAllocation();
 let base=planBase();
 let values={};
 alloc.rows.forEach(r=>{ if(r.amount>0) values[r.id]=mode==="percent" ? (base>0 ? C.round2(r.amount/base*100) : null) : r.amount; });
 planDraft={ mode, values, preview:false };
 renderPlan();
}

function previewPlan(){
 let alloc=draftAllocation();
 let box=$id("planPreview");
 if(!alloc.ok){
  box.innerHTML=`<div class="alloc-msg err">⛔ Fix this first: ${alloc.errors.map(e=>esc(e.message)).join(" ")}</div>`;
  return;
 }
 let rows=alloc.rows.filter(r=>r.amount>0);
 let before={}; planRows().alloc.rows.forEach(r=>{ before[r.id]=r.amount; });
 box.innerHTML=`<div class="preview">
  <b>Preview — nothing is saved yet</b>
  <table class="tbl"><tr><th>Category</th><th class="num">Plan</th><th class="num">%</th><th class="num">Change</th></tr>
  ${rows.map(r=>{ let c=allCategories().find(x=>x.id===r.id)||{}; let d=C.round2(r.amount-(before[r.id]||0)); return `<tr><td>${c.icon||""} ${esc(c.name||"")}</td><td class="num">${money(r.amount)}</td><td class="num">${r.percent!=null ? r.percent+"%" : "—"}</td><td class="num">${d===0 ? "—" : (d>0 ? "+" : "−")+money(Math.abs(d))}</td></tr>`; }).join("")}
  <tr class="tot"><td>Total</td><td class="num">${money(alloc.totalAllocated)}</td><td class="num">${alloc.totalPercent!=null ? alloc.totalPercent+"%" : ""}</td><td></td></tr></table>
  ${alloc.unallocated>0 ? `<div class="field-note">${money(alloc.unallocated)} stays unallocated.</div>` : ""}
  <div class="btn-row"><button class="primary" style="margin:0" id="confirmPlanBtn" onclick="savePlan()">✅ CONFIRM &amp; SAVE</button><button class="action" onclick="document.getElementById('planPreview').innerHTML=''">Back to edit</button></div>
 </div>`;
 planDraft.preview=true;
 box.scrollIntoView({block:"nearest"});
}

function savePlan(){
 let alloc=draftAllocation();
 if(!alloc.ok || !planDraft.preview) return;
 let before=Mdl.clone(data.budgetPlan);
 data.budgetPlan={ mode:planDraft.mode, items:alloc.rows.filter(r=>r.value>0).map(r=>({categoryId:r.id,value:r.value})), updatedAt:new Date().toISOString() };
 audit("plan.save","Budget plan saved: "+money(alloc.totalAllocated)+" in "+data.budgetPlan.items.length+" categories ("+(planDraft.mode==="percent" ? "percent" : "pesos")+")",{entity:"budgetPlan",before,after:Mdl.clone(data.budgetPlan)});
 planDraft=null;
 save();
 toast("✅ Budget plan saved");
}

function savePeriod(){
 let d=Math.floor(C.num(val("periodDay")));
 if(!(d>=1 && d<=28)){ toast("Pick a day from 1 to 28"); return; }
 let before=data.settings.budgetPeriod.startDay;
 data.settings.budgetPeriod={type:"monthly",startDay:d};
 audit("settings.period","Budget period start day "+before+" → "+d,{entity:"settings",before:{startDay:before},after:{startDay:d}});
 save(); toast("✅ Budget period saved");
}

/* Categories (editable) */

function categoryManagerHTML(){
 let cats=allCategories();
 return `<div class="card"><details><summary><b>🏷️ Categories (${cats.filter(c=>!c.archived).length})</b></summary>
  <p class="field-note">Rename, add or hide categories. Hidden categories keep their history.</p>
  ${cats.map(c=>`<div class="list-row"><div>${c.icon} ${esc(c.name)} ${c.archived ? '<span class="tag off">hidden</span>' : ""}</div>
   <div class="list-actions"><button class="mini" onclick="openCategory('${c.id}')" aria-label="Edit ${esc(c.name)}">✏️</button></div></div>`).join("")}
  <button class="action wide" onclick="openCategory(null)">➕ Add category</button></details></div>`;
}

function openCategory(id){
 let c=id ? allCategories().find(x=>x.id===id) : null;
 sheetState={ categoryId:id };
 openSheet(`<h2>${c ? "Edit" : "Add"} category</h2>
  <div class="two"><div><label for="ctIcon">Icon</label><input id="ctIcon" maxlength="4" value="${esc(c ? c.icon : "🏷️")}"></div>
  <div><label for="ctName">Name</label><input id="ctName" autocomplete="off" value="${esc(c ? c.name : "")}" placeholder="e.g. Meat & Seafood"></div></div>
  ${c ? '<div class="field-note">Renaming also renames it in your history, commitments and products.</div>' : ""}
  <div id="sheetMsg" class="form-msg"></div>
  <button class="primary" onclick="saveCategory()">✅ SAVE</button>
  ${c ? `<button class="action wide" onclick="toggleCategoryHidden('${c.id}')">${c.archived ? "Show again" : "Hide this category"}</button>` : ""}
  <button class="action wide" onclick="closeSheet()">Cancel</button>`);
}

function saveCategory(){
 let name=val("ctName"), icon=val("ctIcon")||"🏷️";
 if(!name){ sheetMsg("Please enter a name."); return; }
 let c=sheetState.categoryId ? data.budgetCategories.find(x=>x.id===sheetState.categoryId) : null;
 let clash=data.budgetCategories.find(x=>x!==c && Mdl.normalizeName(x.name)===Mdl.normalizeName(name));
 if(clash){ sheetMsg("A category called \""+clash.name+"\" already exists."); return; }
 if(c){
  let old=c.name;
  if(old!==name){
   data.requests.forEach(r=>{ if(r.category===old) r.category=name; if(r.purchased && r.purchased.category===old) r.purchased.category=name; });
   data.receipts.forEach(r=>{ if(r.category===old) r.category=name; });
   data.manual.forEach(m=>{ if(m.category===old) m.category=name; });
   data.commitments.forEach(x=>{ if(x.categoryName===old) x.categoryName=name; });
   data.products.forEach(p=>{ if(p.categoryName===old) p.categoryName=name; });
   if(historyFilter.category===old) historyFilter.category=name;
  }
  c.name=name; c.icon=icon;
  audit("category.edit","Category "+(old!==name ? "renamed "+old+" → "+name : "updated: "+name),{entity:"budgetCategories",id:c.id,before:{name:old},after:{name,icon}});
 }else{
  let nc={ id:"cat_"+Mdl.slug(name)+"_"+Math.random().toString(36).slice(2,5), name, icon, color:"#8e99ad", builtIn:false, archived:false, createdAt:new Date().toISOString() };
  data.budgetCategories.push(nc);
  audit("category.add","Category added: "+name,{entity:"budgetCategories",id:nc.id});
 }
 planDraft=null; closeSheet(); save();
}

function toggleCategoryHidden(id){
 let c=data.budgetCategories.find(x=>x.id===id);
 if(!c) return;
 c.archived=!c.archived;
 audit("category."+(c.archived ? "hide" : "show"),"Category "+(c.archived ? "hidden" : "shown")+": "+c.name,{entity:"budgetCategories",id});
 planDraft=null; closeSheet(); save();
}

/* ---------- MY STORES (§4–5, §67) — stats from real purchases only ---------- */

function entriesForStore(store){
 return historyEntries().filter(e=>{ let s=Mdl.findStoreByName(data.stores,e.store); return s && s.id===store.id; });
}

function renderStores(){
 let box=$id("storesBody");
 let stores=(data.stores||[]).filter(s=>!s.archived);
 let hidden=(data.stores||[]).filter(s=>s.archived);
 let entries=historyEntries();
 let unknown={};
 entries.forEach(e=>{
  let name=String(e.store||"").trim();
  if(!name || Mdl.findStoreByName(data.stores,name)) return;
  let k=Mdl.normalizeName(name);
  if(!unknown[k]) unknown[k]={name,count:0,total:0};
  if(e.counted){ unknown[k].count++; unknown[k].total=C.round2(unknown[k].total+e.amount); }
 });
 let unknownList=Object.values(unknown).sort((a,b)=>b.total-a.total);

 box.innerHTML=`<p class="field-note">Your stores. Numbers come only from purchases you've recorded. "Usually good for" is a tendency you can edit — not a fact.</p>
  ${stores.map(s=>{
   let st=C.storeStats(entriesForStore(s));
   return `<div class="card store-card tap-lite" onclick="openStore('${s.id}')" role="button" tabindex="0">
    <div class="card-head"><b>${esc(s.name)}</b>${s.membership ? '<span class="tag">🎫 Membership</span>' : ""}</div>
    <div class="muted small">${esc(Mdl.STORE_TYPES[s.type]||"Store")}${s.location ? " · "+esc(s.location) : ""}</div>
    ${s.tendencies && s.tendencies.length ? `<div class="chips"><span class="muted small">Usually good for (tendency):</span> ${s.tendencies.map(t=>`<span class="chip-s">${esc(t)}</span>`).join("")}</div>` : ""}
    <div class="store-stats">${st.purchaseCount ? `<span>🧾 ${st.purchaseCount} purchase${st.purchaseCount===1?"":"s"}</span><span>💸 ${money(st.totalSpent)}</span><span>🧺 avg ${money(st.averageBasket)}</span><span>🕘 ${esc(st.lastDate)}</span>` : '<span class="muted">No purchases recorded here yet</span>'}</div>
   </div>`; }).join("")}
  ${unknownList.length ? `<div class="card"><h3 class="card-title">Other stores in your history</h3>
   <p class="field-note">These names appear in your purchases but aren't in My Stores. Add one to track it (nothing is added automatically).</p>
   ${unknownList.map(u=>`<div class="list-row"><div>${esc(u.name)} <small class="muted">${u.count} · ${money(u.total)}</small></div>
    <div class="list-actions"><button class="mini" onclick="openStoreEdit(null,${esc(JSON.stringify(u.name))})">➕ Add</button></div></div>`).join("")}</div>` : ""}
  <button class="action wide" onclick="openStoreEdit(null)">➕ Add a store</button>
  ${hidden.length ? `<details class="card"><summary>Hidden stores (${hidden.length})</summary>${hidden.map(s=>`<div class="list-row"><div>${esc(s.name)}</div><div class="list-actions"><button class="mini" onclick="unhideStore('${s.id}')">Show</button></div></div>`).join("")}</details>` : ""}`;
}

function openStore(id){
 let s=storeById(id);
 if(!s) return;
 let entries=entriesForStore(s);
 let st=C.storeStats(entries);
 let recs=(data.priceRecords||[]).filter(r=>!r.archived && resolveStore(r.storeId,r.storeName)===s);
 let productIds=[...new Set(recs.map(r=>r.productId))];
 let cheapestHere=(data.products||[]).filter(p=>!p.archived).map(p=>({p,st:productStats(p)})).filter(x=>x.st.cheapestStore && x.st.cheapestStore.storeKey===s.id && x.st.storeCount>1 && x.st.cheapestTies===1);
 openSheet(`<h2>${esc(s.name)}</h2>
  <div class="muted">${esc(Mdl.STORE_TYPES[s.type]||"Store")}${s.location ? " · "+esc(s.location) : ""}${s.membership ? " · 🎫 membership" : ""}</div>
  <div class="stats-grid">
   <div><small>Purchases</small><b>${st.purchaseCount}</b></div>
   <div><small>Total spent</small><b>${money(st.totalSpent)}</b></div>
   <div><small>Average basket</small><b>${st.averageBasket===null ? "—" : money(st.averageBasket)}</b></div>
   <div><small>Last visit</small><b>${esc(st.lastDate||"—")}</b></div>
  </div>
  ${s.tendencies && s.tendencies.length ? `<p class="field-note">Usually good for (tendency, not a fact): ${s.tendencies.map(esc).join(", ")}</p>` : ""}
  ${s.notes ? `<p>${esc(s.notes)}</p>` : ""}
  <h3>Products bought here (${productIds.length})</h3>
  ${productIds.length ? productIds.slice(0,30).map(pid=>{ let p=productById(pid); if(!p) return ""; let mine=recs.filter(r=>r.productId===pid).sort((a,b)=>String(b.date).localeCompare(String(a.date)))[0]; return `<div class="row-line tap-lite" onclick="openProduct('${p.id}')"><span>${esc(productTitle(p))}</span><b>${money(mine.price/(mine.qty||1))}</b></div>`; }).join("") : '<p class="muted">No item prices from this store yet. Save a receipt to learn them.</p>'}
  ${cheapestHere.length ? `<h3>Cheapest here (of the stores you've bought from)</h3>${cheapestHere.map(x=>`<div class="row-line"><span>${esc(productTitle(x.p))}</span><b>${priceValueText(x.st,x.st.cheapestStore.value)}</b></div>`).join("")}` : ""}
  <h3>Recent purchases</h3>
  ${entries.slice(0,8).map(e=>`<div class="row-line"><span>${SOURCE_ICON[e.source]||""} ${esc(e.title)} <small class="muted">${esc(e.date)}</small></span><b>${money(e.amount)}</b></div>`).join("") || '<p class="muted">None yet.</p>'}
  <div class="btn-row"><button class="action" onclick="openStoreEdit('${s.id}')">✏️ Edit store</button><button class="action" onclick="closeSheet()">Close</button></div>`);
}

function openStoreEdit(id,prefillName){
 let s=id ? storeById(id) : null;
 sheetState={ storeId:id };
 let tend=s ? s.tendencies||[] : [];
 openSheet(`<h2>${s ? "Edit store" : "Add a store"}</h2>
  <label for="stName">Store name</label><input id="stName" autocomplete="off" value="${esc(s ? s.name : prefillName||"")}">
  <div class="two"><div><label for="stType">Type</label><select id="stType">${Object.keys(Mdl.STORE_TYPES).map(k=>`<option value="${k}" ${(s ? s.type : "supermarket")===k ? "selected" : ""}>${esc(Mdl.STORE_TYPES[k])}</option>`).join("")}</select></div>
  <div><label for="stLoc">Location</label><input id="stLoc" autocomplete="off" value="${esc(s ? s.location : "")}"></div></div>
  <label for="stAliases">Other names on receipts (comma separated)</label><input id="stAliases" autocomplete="off" value="${esc(s ? (s.aliases||[]).join(", ") : (prefillName||""))}">
  <label>Usually good for (tendency)</label>
  <div class="check-grid">${Mdl.SHOPPING_TYPES.map((t,i)=>`<label class="check"><input type="checkbox" id="stT${i}" value="${esc(t)}" ${tend.includes(t) ? "checked" : ""}> ${esc(t)}</label>`).join("")}</div>
  <label class="check"><input type="checkbox" id="stMember" ${s && s.membership ? "checked" : ""}> 🎫 Membership store</label>
  <label for="stNotes">Notes</label><input id="stNotes" autocomplete="off" value="${esc(s ? s.notes : "")}">
  <div class="two"><div><label for="stMinutes">Minutes from home</label><input id="stMinutes" inputmode="decimal" autocomplete="off" placeholder="blank = unknown" value="${s && s.travel && s.travel.minutes!==null && s.travel.minutes!==undefined ? esc(String(s.travel.minutes)) : ""}"></div>
  <div><label for="stKm">Km from home</label><input id="stKm" inputmode="decimal" autocomplete="off" placeholder="blank = unknown" value="${s && s.travel && s.travel.km!==null && s.travel.km!==undefined ? esc(String(s.travel.km)) : ""}"></div></div>
  <div class="field-note">Used by the trip planner. Type your own estimate — live map distance needs configuration and is not connected.</div>
  <div id="sheetMsg" class="form-msg"></div>
  <button class="primary" onclick="saveStore()">✅ SAVE</button>
  ${s ? `<button class="action wide" onclick="hideStore('${s.id}')">Hide this store</button>` : ""}
  <button class="action wide" onclick="closeSheet()">Cancel</button>`);
}

function saveStore(){
 let name=val("stName");
 if(!name){ sheetMsg("Please enter the store name."); return; }
 let s=sheetState.storeId ? storeById(sheetState.storeId) : null;
 let clash=(data.stores||[]).find(x=>x!==s && !x.archived && (Mdl.normalizeName(x.name)===Mdl.normalizeName(name) || Mdl.normalizeName(x.shortName)===Mdl.normalizeName(name)));
 if(clash){ sheetMsg("\""+clash.name+"\" is already in My Stores."); return; }
 let tendencies=Mdl.SHOPPING_TYPES.filter((t,i)=>$id("stT"+i) && $id("stT"+i).checked);
 let travelNum=id=>{ let v=val(id); if(v==="") return null; let n=Number(v.replace(/,/g,"")); return isFinite(n) && n>=0 && n<10000 ? C.round2(n) : NaN; };
 let travel={ minutes:travelNum("stMinutes"), km:travelNum("stKm") };
 if(Number.isNaN(travel.minutes) || Number.isNaN(travel.km)){ sheetMsg("Minutes and km must be numbers (0 or more), or blank if you don't know."); return; }
 let fields={ name, travel, type:val("stType")||"other", location:val("stLoc"),
  aliases:val("stAliases").split(",").map(a=>a.trim()).filter(Boolean),
  tendencies, membership:$id("stMember").checked ? true : null, notes:val("stNotes"), updatedAt:new Date().toISOString() };
 if(s){
  let before={name:s.name,type:s.type,tendencies:s.tendencies};
  Object.assign(s,fields);
  audit("store.edit","Store updated: "+name,{entity:"stores",id:s.id,before,after:{name,type:fields.type,tendencies}});
 }else{
  let ns=Object.assign({ id:"store_"+Mdl.slug(name)+"_"+Math.random().toString(36).slice(2,6), shortName:"", preferred:true, custom:true, seeded:false, archived:false, createdAt:new Date().toISOString() },fields);
  data.stores.push(ns);
  audit("store.add","Store added: "+name,{entity:"stores",id:ns.id});
 }
 closeSheet(); save(); toast("✅ Store saved");
}

function hideStore(id){
 let s=storeById(id);
 if(!s || !confirm("Hide "+s.name+"? Its purchases and prices stay in your history.")) return;
 s.archived=true; s.updatedAt=new Date().toISOString();
 audit("store.hide","Store hidden: "+s.name,{entity:"stores",id});
 closeSheet(); save();
}

function unhideStore(id){
 let s=storeById(id);
 if(!s) return;
 s.archived=false; s.updatedAt=new Date().toISOString();
 audit("store.show","Store shown again: "+s.name,{entity:"stores",id});
 save();
}

/* ---------- PRODUCTS & PRICE BOOK (§6–7, §35, §38, §46, §73) ---------- */

let priceFilter="";

function renderPrices(){
 let box=$id("pricesBody");
 let products=(data.products||[]).filter(p=>!p.archived);
 if(!products.length){
  box.innerHTML=emptyState("🏷️","No prices yet","Prices are learned from receipts you save (each line becomes a price record) or ones you type in. Jason Shop never makes up prices.",
   `<div class="btn-row"><button class="action" onclick="receiptCamera()">🧾 Scan a receipt</button><button class="action" onclick="openPrice(null)">✍️ Add a price</button></div>`);
  return;
 }
 box.innerHTML=`<input id="pbSearch" type="search" placeholder="🔎 Search products" autocomplete="off" value="${esc(priceFilter)}" oninput="priceFilter=this.value;renderPricesList()">
  <div class="btn-row"><button class="action" onclick="openPrice(null)">✍️ Add a price</button><button class="action" onclick="openProductEdit(null)">➕ New product</button></div>
  <div id="pbList"></div>`;
 renderPricesList();
}

function renderPricesList(){
 let q=Mdl.normalizeName(priceFilter);
 let list=(data.products||[]).filter(p=>!p.archived).filter(p=>!q || Mdl.normalizeName([p.name,p.brand,p.variant].concat(p.aliases||[]).join(" ")).includes(q));
 list.sort((a,b)=>productTitle(a).localeCompare(productTitle(b)));
 $id("pbList").innerHTML=list.length ? list.map(productCardHTML).join("") : '<p class="muted">No products match.</p>';
}

function productCardHTML(p){
 let st=productStats(p);
 return `<div class="card tap-lite product-card" onclick="openProduct('${p.id}')" role="button" tabindex="0">
  <div class="card-head"><b>${esc(productTitle(p))}</b><span class="muted small">${esc(sizeText(p))}</span></div>
  ${st.count ? `<div class="mini-stats"><span>Latest <b>${priceValueText(st,st.latest.value)}</b></span><span>Low <b>${priceValueText(st,st.lowest.value)}</b></span>${st.cheapestStore && st.storeCount>1 ? (st.cheapestTies>1 ? `<span>Same price at ${st.cheapestTies} stores</span>` : `<span>Cheapest at <b>${esc(st.cheapestStore.storeName)}</b></span>`) : ""}</div>
   <div>${trendHTML(st)}</div>` : '<div class="muted">No prices recorded yet</div>'}
 </div>`;
}

function openProduct(id){
 let p=productById(id);
 if(!p) return;
 let st=productStats(p);
 let recs=priceRecordsFor(p.id).slice().sort((a,b)=>String(b.date).localeCompare(String(a.date)) || String(b.createdAt).localeCompare(String(a.createdAt)));
 let basisNote=!st.count ? "" : (st.basis==="unit" ? "Compared per "+st.per+" using the product size." : (p.size || p.unit ? "Sizes/units differ between records, so prices are compared per item." : "No size set, so prices are compared per item. Add a size to compare per kg / litre / piece."));
 openSheet(`<h2>${esc(productTitle(p))}</h2>
  <div class="muted">${esc(sizeText(p)||"No size set")}${p.categoryName ? " · "+esc(p.categoryName) : ""} · for ${esc(Mdl.SCOPE_TYPES[p.scope && p.scope.type]||"Whole household")}</div>
  ${st.count ? `<div class="stats-grid">
   <div><small>Latest</small><b>${priceValueText(st,st.latest.value)}</b><small>${esc(st.latest.storeName||"")} ${esc(st.latest.date||"")}</small></div>
   <div><small>Lowest</small><b>${priceValueText(st,st.lowest.value)}</b><small>${esc(st.lowest.storeName||"")} ${esc(st.lowest.date||"")}</small></div>
   <div><small>Highest</small><b>${priceValueText(st,st.highest.value)}</b><small>${esc(st.highest.storeName||"")} ${esc(st.highest.date||"")}</small></div>
   <div><small>Average</small><b>${priceValueText(st,st.average)}</b><small>${st.count} record${st.count===1?"":"s"}</small></div>
  </div>
  <div class="row-line"><span>Trend</span>${trendHTML(st)}</div>
  <div class="row-line"><span>Cheapest store</span><b>${!st.cheapestStore ? "—" : (st.cheapestTies>1 ? "Same price at "+st.cheapestTies+" stores" : esc(st.cheapestStore.storeName)+(st.storeCount<2 ? " (only store so far)" : ""))}</b></div>
  <p class="field-note">${esc(basisNote)}${st.missingPrice ? " "+st.missingPrice+" record(s) have no price and are ignored." : ""}</p>` : '<p class="muted">No prices recorded yet.</p>'}
  <div id="productIntel"></div>
  <h3>Price records</h3>
  ${recs.length ? `<table class="tbl"><tr><th>Date</th><th>Store</th><th class="num">Price</th><th>Source</th><th></th></tr>
   ${recs.map(r=>{ let src=Mdl.PRICE_SOURCES[r.source]||{icon:"",label:r.source}; return `<tr><td>${esc(r.date)}</td><td>${esc(storeLabel(resolveStore(r.storeId,r.storeName))||r.storeName||"—")}</td><td class="num">${money(r.price)}${r.qty>1 ? "<br><small>for "+r.qty+"</small>" : ""}</td><td><small>${src.icon} ${esc(src.label)}${r.status && r.status!=="confirmed" ? " ("+esc(r.status)+")" : ""}</small>${typeof priceStatusBadge==="function" ? "<br>"+priceStatusBadge(r) : ""}</td><td><button class="mini" onclick="archivePrice('${r.id}','${p.id}')" aria-label="Remove price">✕</button></td></tr>`; }).join("")}</table>` : ""}
  <div class="btn-row"><button class="action" onclick="openPrice('${p.id}')">➕ Add price</button><button class="action" onclick="openProductEdit('${p.id}')">✏️ Edit product</button></div>
  <button class="action wide" onclick="closeSheet()">Close</button>`);
 if(typeof renderProductIntel==="function") renderProductIntel(p.id);
}

function scopeOptions(sel){ return Object.keys(Mdl.SCOPE_TYPES).map(k=>`<option value="${k}" ${k===sel ? "selected" : ""}>${esc(Mdl.SCOPE_TYPES[k])}</option>`).join(""); }

function unitOptions(sel){
 let units=["","g","kg","ml","l","piece","dozen","pack","roll","sachet","bottle","can","box","tray","bundle","bag","sack","lb","oz","gal"];
 return units.map(u=>`<option value="${u}" ${u===(sel||"") ? "selected" : ""}>${u ? esc(C.unitLabel(u)) : "— no size —"}</option>`).join("");
}

function openProductEdit(id){
 let p=id ? productById(id) : null;
 sheetState={ productId:id, confirmSameName:false };
 openSheet(`<h2>${p ? "Edit product" : "New product"}</h2>
  <label for="pdName">Product name</label><input id="pdName" autocomplete="off" value="${esc(p ? p.name : "")}" placeholder="e.g. Jasmine rice" oninput="suggestSize()">
  <div class="two"><div><label for="pdBrand">Brand</label><input id="pdBrand" autocomplete="off" value="${esc(p ? p.brand : "")}"></div>
  <div><label for="pdVariant">Variant</label><input id="pdVariant" autocomplete="off" value="${esc(p ? p.variant : "")}" placeholder="e.g. Unscented"></div></div>
  <div class="three"><div><label for="pdSize">Size</label><input id="pdSize" inputmode="decimal" value="${p && p.size ? p.size : ""}"></div>
  <div><label for="pdUnit">Unit</label><select id="pdUnit">${unitOptions(p ? p.unit : "")}</select></div>
  <div><label for="pdPack">Pack of</label><input id="pdPack" inputmode="numeric" value="${p && p.packCount ? p.packCount : ""}" placeholder="1"></div></div>
  <div id="pdHint" class="field-note">${p && p.sizeSource==="read_from_name" ? "Size was read from the receipt name — please check it." : ""}</div>
  <div class="two"><div><label for="pdCat">Category</label><select id="pdCat"><option value="">—</option>${categoryOptions(p ? p.categoryName : "")}</select></div>
  <div><label for="pdScope">For</label><select id="pdScope">${scopeOptions(p && p.scope ? p.scope.type : "household")}</select></div></div>
  <label for="pdAliases">Other names (comma separated, e.g. how receipts spell it)</label><input id="pdAliases" autocomplete="off" value="${esc(p ? (p.aliases||[]).join(", ") : "")}">
  <div id="sheetMsg" class="form-msg"></div>
  <button class="primary" onclick="saveProduct()">✅ SAVE</button>
  ${p ? `<button class="action wide" onclick="archiveProduct('${p.id}')">Hide this product</button>` : ""}
  <button class="action wide" onclick="${p ? `openProduct('${p.id}')` : "closeSheet()"}">Cancel</button>`);
}

function suggestSize(){
 if(val("pdSize")) return;
 let parsed=C.parseSize(val("pdName"));
 $id("pdHint").innerText=parsed ? "Looks like "+(parsed.packCount>1 ? parsed.packCount+" × " : "")+parsed.size+" "+C.unitLabel(parsed.unit)+" — enter it in Size if that's right." : "";
}

function readProductForm(){
 let sizeRaw=val("pdSize"), packRaw=val("pdPack");
 let size=sizeRaw ? C.num(sizeRaw) : null, pack=packRaw ? C.num(packRaw) : null;
 let errors=[];
 if(!val("pdName")) errors.push("Please enter the product name.");
 if(sizeRaw && !(size>0)) errors.push("Size must be a number above 0.");
 if(size>0 && !val("pdUnit")) errors.push("Pick a unit for the size.");
 if(packRaw && !(pack>=1)) errors.push("Pack of must be 1 or more.");
 return { errors, fields:{ name:val("pdName"), brand:val("pdBrand"), variant:val("pdVariant"), size, unit:val("pdUnit")||null, packCount:pack,
  categoryName:val("pdCat"), scope:{type:val("pdScope")||"household",refId:null}, aliases:val("pdAliases").split(",").map(a=>a.trim()).filter(Boolean) } };
}

function saveProduct(){
 let f=readProductForm();
 if(f.errors.length){ sheetMsg(f.errors.join(" ")); return; }
 let p=sheetState.productId ? productById(sheetState.productId) : null;
 let cand=Mdl.makeProduct(f.fields,new Date().toISOString());
 let key=Mdl.productKey(cand);
 let dup=(data.products||[]).find(x=>x!==p && !x.archived && Mdl.productKey(x)===key);
 if(dup){ sheetMsg("\""+productTitle(dup)+"\" with the same brand, variant and size already exists. Edit that one instead."); return; }
 let sameName=(data.products||[]).find(x=>x!==p && !x.archived && Mdl.normalizeName(x.name)===Mdl.normalizeName(cand.name));
 if(sameName && !sheetState.confirmSameName && (!p || Mdl.normalizeName(p.name)!==Mdl.normalizeName(cand.name))){
  sheetMsg("There's already a product called \""+productTitle(sameName)+"\" ("+(sizeText(sameName)||"no size")+"). They'll be kept as separate products. Tap SAVE again to confirm.");
  sheetState.confirmSameName=true;
  return;
 }
 let now=new Date().toISOString();
 if(p){
  let before={name:p.name,brand:p.brand,variant:p.variant,size:p.size,unit:p.unit,packCount:p.packCount};
  Object.assign(p,{ name:cand.name, brand:cand.brand, variant:cand.variant, size:cand.size, unit:cand.unit, packCount:cand.packCount,
   categoryName:cand.categoryName, scope:cand.scope, aliases:cand.aliases, sizeSource:cand.size ? "entered" : null, updatedAt:now });
  audit("product.edit","Product updated: "+productTitle(p),{entity:"products",id:p.id,before,after:{name:p.name,brand:p.brand,variant:p.variant,size:p.size,unit:p.unit,packCount:p.packCount}});
  save(); openProduct(p.id);
 }else{
  data.products.push(cand);
  audit("product.add","Product added: "+productTitle(cand),{entity:"products",id:cand.id});
  save(); openProduct(cand.id);
 }
 toast("✅ Product saved");
}

function archiveProduct(id){
 let p=productById(id);
 if(!p || !confirm("Hide "+productTitle(p)+"? Its price records are kept.")) return;
 p.archived=true; p.updatedAt=new Date().toISOString();
 audit("product.hide","Product hidden: "+productTitle(p),{entity:"products",id});
 closeSheet(); save();
}

function archivePrice(recId,productId){
 let r=(data.priceRecords||[]).find(x=>x.id===recId);
 if(!r || !confirm("Remove this price ("+peso(r.price)+" on "+r.date+")? It's kept in the backup history as archived.")) return;
 r.archived=true; r.archivedReason="removed_by_user"; r.archivedAt=new Date().toISOString();
 audit("price.remove","Price removed: "+peso(r.price)+" "+(r.itemName||""),{entity:"priceRecords",id:recId,before:{price:r.price,date:r.date}});
 save(); openProduct(productId);
}

function openPrice(productId){
 let products=(data.products||[]).filter(p=>!p.archived).sort((a,b)=>productTitle(a).localeCompare(productTitle(b)));
 sheetState={ priceProductId:productId };
 openSheet(`<h2>Add a price</h2>
  <p class="field-note">Only prices you actually paid or saw. Each one is saved with its source.</p>
  <label for="prProduct">Product</label>
  <select id="prProduct" onchange="document.getElementById('prNewWrap').classList.toggle('hidden',this.value!=='__new')">
   ${products.map(p=>`<option value="${p.id}" ${p.id===productId ? "selected" : ""}>${esc(productTitle(p))}${sizeText(p) ? " ("+esc(sizeText(p))+")" : ""}</option>`).join("")}
   <option value="__new" ${!productId && !products.length ? "selected" : ""}>➕ New product…</option>
  </select>
  <div id="prNewWrap" class="${!productId && !products.length ? "" : "hidden"}"><label for="prNewName">New product name (include size, e.g. "Jasmine rice 5kg")</label><input id="prNewName" autocomplete="off"></div>
  <div class="two"><div><label for="prPrice">Price ₱</label><input id="prPrice" inputmode="decimal" autocomplete="off"></div>
  <div><label for="prQty">For how many</label><input id="prQty" inputmode="decimal" value="1"></div></div>
  <div class="two"><div><label for="prStore">Store</label><select id="prStore">${storeOptions("",true)}</select></div>
  <div><label for="prDate">Date</label><input id="prDate" type="date" value="${todayDay()}"></div></div>
  <label for="prSource">Where is this price from?</label>
  <select id="prSource">${["manual","shelf","online"].map(k=>`<option value="${k}">${Mdl.PRICE_SOURCES[k].icon} ${esc(Mdl.PRICE_SOURCES[k].label)}</option>`).join("")}</select>
  <label for="prNote">Note (optional)</label><input id="prNote" autocomplete="off">
  <div id="sheetMsg" class="form-msg"></div>
  <button class="primary" onclick="savePrice()">✅ SAVE PRICE</button>
  <button class="action wide" onclick="closeSheet()">Cancel</button>`);
 if(!products.length) $id("prNewWrap").classList.remove("hidden");
}

function savePrice(){
 let pid=val("prProduct"), price=parseAmount(val("prPrice")), qty=C.num(val("prQty")||"1");
 if(price===null || isNaN(price) || price<=0){ sheetMsg("Please enter the price, for example 345."); return; }
 if(!(qty>0)){ sheetMsg("\"For how many\" must be above 0."); return; }
 let now=new Date().toISOString();
 let product=null;
 if(pid==="__new" || !pid){
  let name=val("prNewName");
  if(!name){ sheetMsg("Please enter the new product's name."); return; }
  product=Mdl.findProductByName(data.products,name);
  if(!product){
   let parsed=C.parseSize(name);
   product=Mdl.makeProduct({ name, size:parsed ? parsed.size : null, unit:parsed ? parsed.unit : null, packCount:parsed ? parsed.packCount : null, createdFrom:"manual", sizeSource:parsed ? "read_from_name" : null },now);
   data.products.push(product);
   audit("product.add","Product added: "+productTitle(product),{entity:"products",id:product.id});
  }
 }else product=productById(pid);
 if(!product){ sheetMsg("Pick a product."); return; }
 let store=storeById(val("prStore"));
 let source=val("prSource")||"manual";
 let rec={ id:Mdl.newId("price"), productId:product.id, itemName:productTitle(product), storeId:store ? store.id : null, storeName:store ? store.name : "",
  price:C.round2(price), qty, date:val("prDate")||todayDay(), source, status:Mdl.PRICE_SOURCES[source].status,
  sourceRef:{type:"manual",id:null}, note:val("prNote"), archived:false, createdAt:now };
 data.priceRecords.push(rec);
 audit("price.add","Price added: "+productTitle(product)+" "+money(price)+(store ? " at "+storeLabel(store) : ""),{entity:"priceRecords",id:rec.id,after:{price:rec.price,qty,source}});
 save(); openProduct(product.id); toast("✅ Price saved");
}

/* ---------- HOUSEHOLD PROFILE (§3, §82) ---------- */

function renderHousehold(){
 let box=$id("householdBody");
 let houses=(data.houses||[]).filter(h=>!h.archived);
 let hidden=(data.houses||[]).filter(h=>h.archived);
 let all=C.householdSize(data.memberGroups);
 box.innerHTML=`<div class="card summary-card"><b>👪 Everyone you shop for</b>
   <div class="muted">${all.people} ${all.people===1?"person":"people"} · ${all.adults} adults · ${all.children} children · ${all.staff} staff${all.pets ? " · "+all.pets+" pets" : ""}</div>
   <div class="field-note">Weighted size ${all.weightedPeople} (weights let a child count as e.g. 0.5 of an adult for future forecasts).</div></div>
  ${houses.map(houseCardHTML).join("")}
  <button class="action wide" onclick="addHouse()">➕ Add another house</button>
  ${hidden.length ? `<details class="card"><summary>Hidden houses (${hidden.length})</summary>${hidden.map(h=>`<div class="list-row"><div>${esc(h.name)}</div><div class="list-actions"><button class="mini" onclick="unhideHouse('${h.id}')">Show</button></div></div>`).join("")}</details>` : ""}`;
}

function houseCardHTML(h){
 let groups=(data.memberGroups||[]).filter(g=>g.houseId===h.id && !g.archived);
 let size=C.householdSize(data.memberGroups,{houseId:h.id});
 let iconOf=t=>(Mdl.MEMBER_TYPES.find(m=>m.type===t)||{icon:"👤"}).icon;
 return `<div class="card"><div class="card-head"><h3 class="card-title">🏠 ${esc(h.name)}</h3><span class="muted small">${size.people} people${size.pets ? " · "+size.pets+" pets" : ""}</span></div>
  ${groups.map(g=>`<div class="stepper-row">
   <label for="gc_${g.id}">${iconOf(g.type)} ${esc(g.label)}</label>
   <div class="stepper"><button class="mini" onclick="stepGroup('${g.id}',-1)" aria-label="Fewer ${esc(g.label)}">−</button>
    <input id="gc_${g.id}" inputmode="numeric" value="${g.count}" onchange="setGroupCount('${g.id}',this.value)" aria-label="${esc(g.label)} count">
    <button class="mini" onclick="stepGroup('${g.id}',1)" aria-label="More ${esc(g.label)}">+</button></div>
  </div>`).join("")}
  <details><summary class="small">Forecast weights</summary>
   ${groups.filter(g=>g.type!=="pets").map(g=>`<div class="stepper-row"><label for="gw_${g.id}">${esc(g.label)} weight</label><input id="gw_${g.id}" class="w-in" inputmode="decimal" value="${g.weight}" onchange="setGroupWeight('${g.id}',this.value)"></div>`).join("")}
  </details>
  <div class="btn-row"><button class="action" onclick="addGroup('${h.id}')">➕ Custom group</button><button class="action" onclick="renameHouse('${h.id}')">✏️ Rename</button>${h.primary ? "" : `<button class="action" onclick="hideHouse('${h.id}')">Hide</button>`}</div>
 </div>`;
}

function groupById(id){ return (data.memberGroups||[]).find(g=>g.id===id); }

function setGroupCount(id,value){
 let g=groupById(id);
 if(!g) return;
 let n=C.num(value);
 if(n===null || n<0 || Math.floor(n)!==n){ toast("Use a whole number (0 or more)"); render(); return; }
 if(n===g.count) return;
 let before=g.count;
 g.count=n; g.updatedAt=new Date().toISOString();
 audit("household.count",g.label+": "+before+" → "+n,{entity:"memberGroups",id,before:{count:before},after:{count:n}});
 save();
}

function stepGroup(id,d){ let g=groupById(id); if(g) setGroupCount(id,Math.max(0,(Number(g.count)||0)+d)); }

function setGroupWeight(id,value){
 let g=groupById(id);
 let w=C.num(value);
 if(!g) return;
 if(w===null || w<0 || w>5){ toast("Weight must be between 0 and 5"); render(); return; }
 let before=g.weight;
 g.weight=w; g.updatedAt=new Date().toISOString();
 audit("household.weight",g.label+" weight "+before+" → "+w,{entity:"memberGroups",id});
 save();
}

function addHouse(){
 let name=(prompt("Name of the house (e.g. Clark house, Manila condo)")||"").trim();
 if(!name) return;
 let now=new Date().toISOString();
 let h={ id:Mdl.newId("house"), name, primary:false, notes:"", archived:false, createdAt:now, updatedAt:now };
 data.houses.push(h);
 Mdl.MEMBER_TYPES.forEach(m=>data.memberGroups.push({ id:Mdl.newId("grp"), houseId:h.id, type:m.type, label:m.label, count:0, weight:1, archived:false, createdAt:now, updatedAt:now }));
 audit("household.addHouse","House added: "+name,{entity:"houses",id:h.id});
 save();
}

function renameHouse(id){
 let h=(data.houses||[]).find(x=>x.id===id);
 if(!h) return;
 let name=(prompt("New name for "+h.name,h.name)||"").trim();
 if(!name || name===h.name) return;
 let before=h.name;
 h.name=name; h.updatedAt=new Date().toISOString();
 audit("household.renameHouse","House renamed: "+before+" → "+name,{entity:"houses",id});
 save();
}

function hideHouse(id){
 let h=(data.houses||[]).find(x=>x.id===id);
 if(!h || !confirm("Hide "+h.name+"? Its groups are kept and can be shown again.")) return;
 h.archived=true; h.updatedAt=new Date().toISOString();
 (data.memberGroups||[]).forEach(g=>{ if(g.houseId===id) g.houseHidden=true; });
 audit("household.hideHouse","House hidden: "+h.name,{entity:"houses",id});
 save();
}

function unhideHouse(id){
 let h=(data.houses||[]).find(x=>x.id===id);
 if(!h) return;
 h.archived=false; h.updatedAt=new Date().toISOString();
 (data.memberGroups||[]).forEach(g=>{ if(g.houseId===id) delete g.houseHidden; });
 audit("household.showHouse","House shown again: "+h.name,{entity:"houses",id});
 save();
}

function addGroup(houseId){
 let label=(prompt("Name of the group (e.g. Guests, Grandparents, Gardeners)")||"").trim();
 if(!label) return;
 let now=new Date().toISOString();
 let g={ id:Mdl.newId("grp"), houseId, type:"custom", label, count:0, weight:1, archived:false, createdAt:now, updatedAt:now };
 data.memberGroups.push(g);
 audit("household.addGroup","Group added: "+label,{entity:"memberGroups",id:g.id});
 save();
}

/* ---------- MORE menu ---------- */

function renderMoreMenu(){
 let items=[
  ["household","🏠","Household profile","Houses, people, staff and pets"],
  ["stores","🏪","My stores","Stores, tendencies and stats"],
  ["prices","🏷️","Price Book","Every price you've paid or seen"],
  ["plan","📊","Budget plan & categories","Split your fund by category"],
  ["cycle","🔁","Shopping cycle","Every 15 days (or your choice) · planned vs actual"],
  ["recurring","📅","Recurring purchases","Monthly rice, gas, water — set aside automatically"],
  ["alerts","🔔","Alert center","Price drops, targets, low stock, expiry, budget"],
  ["forecast","📈","30-day forecast","What's coming up and whether the fund lasts"],
  ["insights","📊","Insights & analytics","Trends, basket price index, savings, waste, accuracy, export"],
  ["requests","📨","Household requests","Family and staff ask · you approve"+(typeof pendingHouseholdRequests==="function" && pendingHouseholdRequests().length ? " · "+pendingHouseholdRequests().length+" waiting" : "")],
  ["receiptArchive","🗂️","Receipt archive","Every receipt, searchable by store, item and month"],
  ["search","🔎","Search everything","Products, stock, list, stores, receipts, trips"],
  ["data","💾","Data & Backup","Backups, restore, safety copies, integrity check"],
  ["audit","🧾","Change history","Every money and data change"],
  ["settings","⚙️","Settings","Warning levels, budget period, app info"]
 ];
 $id("moreMenu").innerHTML=items.map(([k,icon,title,sub])=>`<button class="menu-item" id="more_${k}" onclick="${k==="alerts" ? "openAlerts()" : (k==="search" ? "openSearch()" : "goTo('"+k+"')")}"><span class="mi-icon">${icon}</span><span><b>${title}</b><small>${sub}</small></span><span class="chev">›</span></button>`).join("");
}

/* ---------- DATA & BACKUP (§98–120, §113) ---------- */

let lastIntegrity=null;

function renderDataBackup(){
 let box=$id("dataBody");
 let logs=(data.backupLog||[]).slice().reverse();
 let counts=Mdl.countsOf(data);
 box.innerHTML=`
  <div class="card"><div class="card-head"><h3 class="card-title">🩺 Data check</h3><button class="action" style="margin:0" onclick="runIntegrity()">Run check</button></div>
   <div class="muted small">${counts.requests} requests · ${counts.receipts} receipts · ${counts.manual} manual entries · ${counts.products} products · ${counts.priceRecords} prices</div>
   <div id="integrityOut">${lastIntegrity ? integrityHTML(lastIntegrity) : '<p class="field-note">Checks every record for missing ids, duplicates, bad amounts and broken links. Nothing is changed.</p>'}</div></div>

  <div class="card"><h3 class="card-title">🛟 Safety copies on this phone</h3>
   <p class="field-note">Made automatically before every upgrade and restore. Kept in a separate on-phone vault and never deleted automatically. They're lost if the browser's site data is cleared, so keep making backups too.</p>
   <div id="snapList"><p class="muted">Loading…</p></div>
   <button class="action wide" onclick="makeSnapshot()">➕ Make a safety copy now</button></div>

  <div class="card"><h3 class="card-title">☁️ Automatic cloud backup</h3>
   <div class="state s-setup">⚙️ NEEDS SETUP</div>
   <p class="field-note">Automatic off-phone backup needs a cloud storage connection that isn't set up yet, so it is OFF. Until then, use 📤 Share Backup → Google Drive above at least weekly.</p></div>

  <div class="card"><h3 class="card-title">📦 Storage</h3><div id="storageOut" class="muted">Checking…</div></div>

  <div class="card"><h3 class="card-title">📜 Backup history</h3>
   ${logs.length ? logs.slice(0,30).map(l=>`<div class="log-row"><span>${l.status==="success" ? "✅" : (l.status==="failed" || l.status==="rolled back" ? "⚠️" : "•")} <b>${esc(l.action)}</b> <small class="muted">${esc(fmtDateTime(l.at))}</small>${l.detail ? `<br><small class="muted">${esc(l.detail)}</small>` : ""}</span></div>`).join("") : '<p class="muted">No backup activity yet.</p>'}</div>

  <p class="small-print">Jason Shop ${esc(Mdl.APP_VERSION)} · data version ${esc(String(data.schemaVersion||1))}</p>`;
 refreshSnapshots();
 refreshStorage();
}

function integrityHTML(r){
 let lvl={error:"⛔",warning:"⚠️",info:"ℹ️"};
 return `<div class="${r.ok ? "banner ok" : "banner"}">${r.ok ? "✅ No problems found" : "⚠️ "+r.errors+" problem"+(r.errors===1?"":"s")+" found"}${r.warnings ? " · "+r.warnings+" warning"+(r.warnings===1?"":"s") : ""}</div>
  ${r.issues.length ? `<div class="issues">${r.issues.slice(0,20).map(i=>`<div class="lvl-${i.level}">${lvl[i.level]||""} ${esc(i.message)}</div>`).join("")}</div>` : ""}`;
}

function runIntegrity(){
 lastIntegrity=Mdl.integrityCheck(data,{recordedSpent:recordedSpentTotal()});
 logBackup("Integrity check performed",lastIntegrity.ok ? "success" : "failed","",lastIntegrity.errors+" errors, "+lastIntegrity.warnings+" warnings");
 save();
}

function refreshSnapshots(){
 let box=$id("snapList");
 if(!box) return;
 let legacy=[];
 try{
  for(let i=0;i<localStorage.length;i++){
   let k=localStorage.key(i);
   if(/^JasonShopData\.(preMigration|beforeRestore|damaged)/.test(k)) legacy.push(k);
  }
 }catch(e){}
 let legacyHTML=legacy.map(k=>`<div class="list-row"><div><b>${esc(k.replace("JasonShopData.",""))}</b><small class="muted"> phone storage</small></div>
  <div class="list-actions"><button class="mini" onclick="downloadSnapshot('ls:${esc(k)}')">⬇️</button><button class="mini" onclick="restoreSnapshot('ls:${esc(k)}')">Restore</button></div></div>`).join("");
 if(!window.JasonStore){ box.innerHTML=legacyHTML || '<p class="muted">No safety copies yet.</p>'; return; }
 JasonStore.listSnapshots().then(list=>{
  box.innerHTML=(list.length ? list.slice(0,20).map(s=>`<div class="list-row"><div><b>${esc(s.reason)}</b><br><small class="muted">${esc(fmtDateTime(s.at))}${s.counts ? " · "+s.counts.receipts+" receipts, "+s.counts.manual+" manual" : ""} · ${Math.ceil((s.bytes||0)/1024)} KB</small></div>
   <div class="list-actions"><button class="mini" onclick="downloadSnapshot('${s.id}')" aria-label="Download">⬇️</button><button class="mini" onclick="restoreSnapshot('${s.id}')">Restore</button></div></div>`).join("") : "")+legacyHTML || '<p class="muted">No safety copies yet.</p>';
 }).catch(()=>{ box.innerHTML=legacyHTML || '<p class="muted">The safety vault isn\'t available in this browser.</p>'; });
}

// Snapshot → a normal backup file (so it goes through the full restore checks).
function snapshotAsBackupText(id){
 let wrap=json=>{
  let d=JSON.parse(json);
  return Mdl.makeBackup(normalizeData(d.data && d.requests===undefined ? d.data : d),{ fromSnapshot:id });
 };
 if(id.startsWith("ls:")) return Promise.resolve(wrap(localStorage.getItem(id.slice(3))));
 return JasonStore.getSnapshot(id).then(s=>{ if(!s) throw new Error("not found"); return wrap(s.json); });
}

function downloadSnapshot(id){
 snapshotAsBackupText(id).then(text=>{
  downloadFile("jason-shop-safety-copy-"+localDay(new Date())+".json",text,"application/json");
  logBackup("Export created","success",id,"Safety copy downloaded");
  save();
 }).catch(e=>toast("⚠️ Couldn't read that safety copy"));
}

function restoreSnapshot(id){
 snapshotAsBackupText(id).then(text=>{
  restoreFromText(text,{ label:"safety copy", msgEl:$id("backupMsg") });
  $id("backupCard").scrollIntoView({block:"start"});
 }).catch(e=>toast("⚠️ Couldn't read that safety copy"));
}

function makeSnapshot(){
 if(!window.JasonStore){ toast("Safety vault isn't available"); return; }
 let json=JSON.stringify(data);
 JasonStore.putSnapshot({ reason:"made by you", json, schemaVersion:data.schemaVersion, counts:Mdl.countsOf(data) }).then(id=>{
  logBackup("Safety copy created","success",id,"made by you");
  save(); toast("✅ Safety copy saved on this phone");
 }).catch(()=>toast("⚠️ Couldn't save a safety copy"));
}

function refreshStorage(){
 if(!window.JasonStore) return;
 JasonStore.estimate().then(e=>{
  let box=$id("storageOut");
  if(!box) return;
  let kb=n=>n==null ? "?" : (n>1048576 ? (n/1048576).toFixed(1)+" MB" : Math.ceil(n/1024)+" KB");
  let pctLS=Math.round(e.localStorageBytes/e.localStorageQuota*100);
  box.innerHTML=`Main data: ${kb(e.localStorageBytes)} (${pctLS}% of the ~10 MB phone-storage limit)${pctLS>=70 ? " ⚠️ getting full — older receipt photos are trimmed automatically" : ""}<br>
   Site total: ${kb(e.usage)}${e.quota ? " of "+kb(e.quota)+" available" : ""}<br>
   ${e.persisted===true ? "🔒 Protected: the browser won't clear this data when the phone is low on space." : "ℹ️ Not protected from automatic clean-up by the browser yet — installing Jason Shop to the home screen usually fixes this."}`;
 });
}

/* ---------- CHANGE HISTORY / AUDIT (§97) ---------- */

let auditFilter="all";

function renderAudit(){
 let box=$id("auditBody");
 let all=(data.auditLog||[]).slice().reverse();
 let groups={all:"All",money:"Money",budget:"Budget & plan",data:"Data"};
 let pick=a=>auditFilter==="all" ||
  (auditFilter==="money" && (a.amountDelta!==null || /^(purchase|receipt|entry|commitment)/.test(a.action))) ||
  (auditFilter==="budget" && /^(budget|plan|thresholds|reserve|category|settings)/.test(a.action)) ||
  (auditFilter==="data" && /^(data|restore|store|product|price|household)/.test(a.action));
 let list=all.filter(pick);
 box.innerHTML=`<p class="field-note">Every change to money, budget and data, newest first. Records are added, never edited.</p>
  <div class="seg">${Object.keys(groups).map(k=>`<button class="${auditFilter===k ? "on" : ""}" onclick="auditFilter='${k}';renderAudit()">${groups[k]}</button>`).join("")}</div>
  ${list.length ? list.slice(0,150).map(a=>`<div class="audit-row"><div><b>${esc(a.summary)}</b><br><small class="muted">${esc(fmtDateTime(a.at))} · ${esc(a.action)}</small></div>${a.amountDelta!==null ? `<b class="${a.amountDelta>0 ? "red" : "green"}">${a.amountDelta>0 ? "+" : "−"}${money(Math.abs(a.amountDelta))}</b>` : ""}</div>`).join("") : '<p class="muted">No changes recorded yet.</p>'}`;
}

/* ---------- SETTINGS ---------- */

function renderSettings(){
 let t=data.settings.thresholds;
 $id("settingsBody").innerHTML=`<div class="card"><h3 class="card-title">🚦 Warning levels</h3>
   <div class="muted">✅ SAFE below ${t.watch}% · 👀 WATCH ${t.watch}–${t.warning-1}% · ⚠️ WARNING ${t.warning}–${t.hardStop-1}% · ⛔ HARD STOP ${t.hardStop}%</div>
   <button class="action wide" onclick="goTo('thresholds')">Change warning levels</button></div>
  <div class="card"><h3 class="card-title">📆 Budget period</h3><div class="muted">Monthly, starting day ${data.settings.budgetPeriod.startDay} · now ${esc(periodLabel(currentPeriod()))}</div>
   <button class="action wide" onclick="goTo('plan')">Change in Budget plan</button></div>
  <div id="settings3">${typeof settings3HTML==="function" ? settings3HTML() : ""}</div>
  <div class="card"><h3 class="card-title">🔒 Privacy</h3><p class="muted">Everything stays on this phone. Only the text or photo you send to the AI (research, receipt reading, voice) goes to the Jason Shop server for that request.</p></div>
  <div class="card"><h3 class="card-title">ℹ️ About</h3><div class="muted">Jason Shop ${esc(Mdl.APP_VERSION)} · data version ${esc(String(data.schemaVersion||1))}</div></div>`;
}
