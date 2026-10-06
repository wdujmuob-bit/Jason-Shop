/* =====================================================================
   JASON SHOP — STAGE 2 OPERATIONS
   Home inventory (statuses, days of supply, alerts, smart reorder,
   household-scaled forecasts, perishables & expiry), shopping cycles
   (planned vs actual), smart shopping lists (need vs want, priority,
   optional-item protection, duplicate-purchase prevention), Shopping
   Trip Mode, and receipt-line matching with a review screen.
   All math lives in js/calc.js; data shapes in js/model.js.
   Uses helpers from js/features.js ($id, esc, C, Mdl, money, audit…)
   and js/app.js (data, save, peso, parseAmount, historyEntries…).
   ===================================================================== */

/* ---------- shared helpers ---------- */

function invSettings(){ return Object.assign({},C.DEFAULT_INVENTORY,data.settings && data.settings.inventory); }
function cycleSettings(){ return (data.settings && data.settings.cycle) || Object.assign({},C.DEFAULT_CYCLE,{anchorDate:Mdl.firstOfMonth(todayDay())}); }
function currentCycle(){ return C.cycleRange(cycleSettings(),todayDay()); }
function householdCtx(){ let h=C.householdSize(data.memberGroups); return { weightedPeople:h.weightedPeople, pets:h.pets }; }
function shortDay(day){
 if(!day) return "";
 let [y,m,d]=String(day).split("-").map(Number);
 return new Date(y,m-1,d).toLocaleDateString("en-PH",{month:"short",day:"numeric"});
}
function cycleLabel(r){ return shortDay(r.start)+" – "+shortDay(r.end); }
function qtyText(q){ let n=C.round2(Number(q)||0); return String(n); }
function plural(n,word,many){ return n+" "+(n===1 ? word : (many || word+"s")); }

/* Price Book price per item (never guessed; AI estimates are not used).
   Prefers the latest price at `storeId`, else the latest anywhere. */
function knownItemPrice(productId,storeId){
 if(!productId) return null;
 let recs=priceRecordsFor(productId).filter(r=>r.source!=="ai_estimate" && C.num(r.price)!==null && C.num(r.price)>0);
 if(!recs.length) return null;
 let key=r=>String(r.date||"")+"|"+String(r.createdAt||"");
 recs.sort((a,b)=>key(a).localeCompare(key(b)));
 let atStore=storeId ? recs.filter(r=>{ let s=resolveStore(r.storeId,r.storeName); return s && s.id===storeId; }) : [];
 let r=(atStore.length ? atStore : recs)[(atStore.length ? atStore : recs).length-1];
 let q=C.num(r.qty)>0 ? C.num(r.qty) : 1;
 let s=resolveStore(r.storeId,r.storeName);
 return { price:C.round2(r.price/q), date:r.date||"", storeId:s ? s.id : null, storeName:s ? storeLabel(s) : (r.storeName||""), sameStore:atStore.length>0 };
}

function lastBoughtDay(productId,name){
 let days=[];
 if(productId) priceRecordsFor(productId).forEach(r=>{ if(r.source==="receipt" || r.source==="purchase") days.push(r.date||""); });
 let n=Mdl.normalizeName(name);
 (data.shoppingLists||[]).forEach(l=>(l.items||[]).forEach(it=>{
  if(it.status==="bought" && it.boughtAt && ((productId && it.productId===productId) || (n && Mdl.normalizeName(it.name)===n))) days.push(localDay(it.boughtAt));
 }));
 days=days.filter(Boolean).sort();
 return days.length ? days[days.length-1] : null;
}

/* =====================================================================
   INVENTORY
   ===================================================================== */

function invItems(){ return (data.inventoryItems||[]).filter(i=>!i.archived); }
function invById(id){ return (data.inventoryItems||[]).find(i=>i.id===id) || null; }
function invForProduct(productId){ return productId ? invItems().find(i=>i.productId===productId) || null : null; }
function invForName(name){ let n=Mdl.normalizeName(name); return n ? invItems().find(i=>Mdl.normalizeName(i.name)===n) || null : null; }
function txFor(itemId){ return (data.inventoryTransactions||[]).filter(t=>t.itemId===itemId); }

function itemUse(it){
 let today=todayDay();
 let tx=txFor(it.id);
 let learned=C.learnedDailyUse(tx,today);
 let ppl=tx.filter(t=>t.type==="use" && C.num(t.people)>0 && t.day>=C.addDays(today,-60)).map(t=>C.num(t.people));
 let at=ppl.length ? ppl.reduce((a,b)=>a+b,0)/ppl.length : null;
 return C.dailyUse(it,{ household:householdCtx(), learned:learned, learnedAtPeople:at });
}

function itemInfo(it){
 let s=invSettings(), cyc=currentCycle();
 let use=itemUse(it);
 let st=C.inventoryStatus({ quantity:it.quantity, perDay:use.value, minQty:it.minQty },s);
 let exp=it.perishable && Number(it.quantity)>0 ? C.expiryStatus(it.expiryDate,todayDay(),s.expirySoonDays) : { state:"NONE", daysLeft:null };
 let fc=C.forecast({ quantity:it.quantity, perDay:use.value },todayDay(),{ cycleDays:cyc.lengthDays, daysLeftInCycle:cyc.daysLeft });
 let re=C.reorderQty({ quantity:it.quantity, perDay:use.value, minQty:it.minQty, packSize:it.packSize },{ targetDays:cyc.lengthDays+s.bufferDays });
 return { use, st, exp, fc, re };
}

const INV_ORDER={OUT:0,URGENT:1,LOW:2,OK:3,UNTRACKED:4};
const EXPIRY_INFO={ EXPIRED:{icon:"🗑️",label:"EXPIRED"}, TODAY:{icon:"⏰",label:"EXPIRES TODAY"}, SOON:{icon:"⏰",label:"EXPIRES SOON"} };

function invBadge(state,extra){
 let i=C.INVENTORY_STATES[state] || C.INVENTORY_STATES.UNTRACKED;
 return `<span class="state inv-${state.toLowerCase()}">${i.icon} ${esc(i.label)}${extra ? " · "+esc(extra) : ""}</span>`;
}
function expiryBadge(exp){
 let i=EXPIRY_INFO[exp.state];
 if(!i) return "";
 let extra=exp.state==="SOON" ? "in "+plural(exp.daysLeft,"day") : (exp.state==="EXPIRED" ? plural(-exp.daysLeft,"day")+" ago" : "");
 return `<span class="state exp-${exp.state.toLowerCase()}">${i.icon} ${esc(i.label)}${extra ? " · "+esc(extra) : ""}</span>`;
}
function daysText(info){
 if(info.st.state==="OUT") return "None left";
 if(info.st.days===null) return info.use.value ? "" : "No daily use set";
 return "~"+(info.st.days<1 ? "less than 1 day" : plural(Math.floor(info.st.days),"day"))+" left";
}

function inventoryAlerts(){
 let low=[], expiring=[];
 invItems().forEach(it=>{
  let info=itemInfo(it);
  if(["OUT","URGENT","LOW"].includes(info.st.state)) low.push({it,info});
  if(["EXPIRED","TODAY","SOON"].includes(info.exp.state)) expiring.push({it,info});
 });
 low.sort((a,b)=>INV_ORDER[a.info.st.state]-INV_ORDER[b.info.st.state] || (a.info.st.days??999)-(b.info.st.days??999));
 expiring.sort((a,b)=>a.info.exp.daysLeft-b.info.exp.daysLeft);
 return { low, expiring,
  out:low.filter(x=>x.info.st.state==="OUT").length, urgent:low.filter(x=>x.info.st.state==="URGENT").length,
  lowOnly:low.filter(x=>x.info.st.state==="LOW").length };
}

/* Every stock change is a transaction: type add|use|adjust|trip|receipt|discard */
function changeStock(it,delta,type,opts){
 let o=opts||{};
 let before=C.round2(Number(it.quantity)||0);
 let after=C.round2(Math.max(0,before+Number(delta)));
 let real=C.round2(after-before);
 if(real===0 && type!=="adjust") return null;
 let today=todayDay();
 if(real>0 && it.perishable){
  it.expiryDate=o.expiryDate || C.expiryAfterRestock(it.expiryDate,today,it.shelfLifeDays,before>0);
 }
 if(after===0 && it.perishable && type!=="adjust") it.expiryDate=null;
 it.quantity=after;
 it.updatedAt=new Date().toISOString();
 if(!Array.isArray(data.inventoryTransactions)) data.inventoryTransactions=[];
 let t={ id:Mdl.newId("itx"), itemId:it.id, type, qty:real, before, after, day:today, at:it.updatedAt,
  people:householdCtx().weightedPeople||null, sourceRef:o.sourceRef||null, note:o.note||"" };
 data.inventoryTransactions.push(t);
 return t;
}

let invFilter={ state:"all", location:"all", q:"" };
function setInvFilter(k,v){ invFilter[k]=v; renderInventory(); }

function renderInventory(){
 let box=$id("inventoryBody");
 if(!box) return;
 let items=invItems();
 if(!items.length){
  let n=(data.products||[]).filter(p=>!p.archived).length;
  box.innerHTML=emptyState("📦","Start your home inventory","Add what's in your pantry, fridge and storeroom. Jason Shop then warns you before things run out, works out how many days each item lasts for your household, and suggests how much to buy."+(n ? " Your "+plural(n,"Price Book product")+" can be linked so prices come along." : ""),
   `<button class="action" id="invAddFirst" onclick="openInvItem(null)">➕ Add first item</button>`);
  return;
 }
 let A=inventoryAlerts();
 let rows=items.map(it=>({it,info:itemInfo(it)}));
 let expCount=A.expiring.length;
 let q=Mdl.normalizeName(invFilter.q);
 let shown=rows.filter(x=>{
  if(invFilter.location!=="all" && x.it.location!==invFilter.location) return false;
  if(q && !Mdl.normalizeName(x.it.name).includes(q)) return false;
  if(invFilter.state==="alerts") return ["OUT","URGENT","LOW"].includes(x.info.st.state);
  if(invFilter.state==="expiring") return ["EXPIRED","TODAY","SOON"].includes(x.info.exp.state);
  if(invFilter.state!=="all") return x.info.st.state===invFilter.state;
  return true;
 }).sort((a,b)=>INV_ORDER[a.info.st.state]-INV_ORDER[b.info.st.state] || (a.info.st.days??999)-(b.info.st.days??999) || a.it.name.localeCompare(b.it.name));
 let chip=(k,label)=>`<button class="chip${invFilter.state===k ? " on" : ""}" data-invfilter="${k}" onclick="setInvFilter('state','${k}')">${label}</button>`;
 let locs=[...new Set(items.map(i=>i.location))];
 let toReorder=A.low.filter(x=>!onActiveList(x.it.productId,x.it.name,x.it.id)).length;
 box.innerHTML=`<div class="card summary-card" id="invSummary">
   <div class="inv-tiles">
    <div class="inv-tile t-out"><b id="invOutCount">${A.out}</b><small>⛔ Out</small></div>
    <div class="inv-tile t-urgent"><b id="invUrgentCount">${A.urgent}</b><small>🔴 Urgent</small></div>
    <div class="inv-tile t-low"><b id="invLowCount">${A.lowOnly}</b><small>🟠 Low</small></div>
    <div class="inv-tile t-exp"><b id="invExpCount">${expCount}</b><small>⏰ Expiring</small></div>
   </div>
   <div class="field-note">Low = under ${invSettings().lowDays} days left · Urgent = under ${invSettings().urgentDays} days, for your household of ${esc(String(householdCtx().weightedPeople||0))} people.</div>
   <div class="btn-row"><button class="action" id="invAddBtn" onclick="openInvItem(null)">➕ Add item</button>
   <button class="action" id="invReorderBtn" onclick="addLowToList()" ${toReorder ? "" : "disabled"}>${toReorder ? "📝 Add "+toReorder+" low to list" : (A.low.length ? "✅ Low items are on your list" : "✅ Nothing low")}</button></div>
  </div>
  <div class="chips">${chip("all","All "+items.length)}${chip("alerts","Needs buying "+A.low.length)}${chip("expiring","Expiring "+expCount)}</div>
  <div class="filters two"><select id="invLoc" aria-label="Where" onchange="setInvFilter('location',this.value)"><option value="all">All places</option>${locs.map(l=>`<option value="${esc(l)}"${invFilter.location===l ? " selected" : ""}>${esc(Mdl.INVENTORY_LOCATIONS[l]||l)}</option>`).join("")}</select>
  <input id="invSearch" type="search" placeholder="Search items" autocomplete="off" value="${esc(invFilter.q)}" oninput="invSearch(this.value)"></div>
  <div class="card" id="invList">${shown.length ? shown.map(x=>invRow(x.it,x.info)).join("") : '<p class="muted">Nothing matches this filter.</p>'}</div>`;
}

function invSearch(v){
 invFilter.q=v;
 let q=Mdl.normalizeName(v);
 document.querySelectorAll("#invList .inv-row").forEach(r=>{ r.style.display=!q || r.dataset.name.includes(q) ? "" : "none"; });
}

function invRow(it,info){
 let p=it.productId ? productById(it.productId) : null;
 let onList=onActiveList(it.productId,it.name,it.id);
 return `<div class="inv-row" data-inv="${esc(it.id)}" data-name="${esc(Mdl.normalizeName(it.name))}">
  <div class="inv-main" onclick="openInvItem('${esc(it.id)}')">
   <b>${esc(it.name)}</b>
   <small class="muted">${esc(Mdl.INVENTORY_LOCATIONS[it.location]||it.location)} · <span class="inv-qty">${qtyText(it.quantity)}</span> ${esc(it.unit)}${p ? " · 🏷️ linked" : ""}</small>
   <div>${invBadge(info.st.state)} <small class="inv-days">${esc(daysText(info))}</small> ${expiryBadge(info.exp)}${onList ? ' <span class="tag">on list</span>' : ""}</div>
  </div>
  <div class="stepper inv-step">
   <button class="mini" aria-label="Used one ${esc(it.name)}" data-act="use" onclick="quickStock('${esc(it.id)}',-1)">−</button>
   <button class="mini" aria-label="Added one ${esc(it.name)}" data-act="add" onclick="quickStock('${esc(it.id)}',1)">+</button>
  </div>
 </div>`;
}

function quickStock(id,delta){
 let it=invById(id);
 if(!it) return;
 if(delta<0 && !(Number(it.quantity)>0)){ toast("Already at 0"); return; }
 let t=changeStock(it,delta,delta<0 ? "use" : "add");
 if(!t) return;
 audit(delta<0 ? "inventory.use" : "inventory.add",(delta<0 ? "Used " : "Added ")+Math.abs(t.qty)+" "+it.unit+" "+it.name+" ("+t.before+" → "+t.after+")",{entity:"inventoryItems",id:it.id,before:{quantity:t.before},after:{quantity:t.after}});
 save();
 let info=itemInfo(it);
 if(delta<0 && ["URGENT","OUT"].includes(info.st.state) && !onActiveList(it.productId,it.name,it.id)) toast(C.INVENTORY_STATES[info.st.state].icon+" "+it.name+" is "+info.st.state.toLowerCase()+" — tap 📝 Add to list in Inventory");
}

function productSelectOptions(sel){
 let ps=(data.products||[]).filter(p=>!p.archived).slice().sort((a,b)=>productTitle(a).localeCompare(productTitle(b)));
 return `<option value="">— not linked —</option>`+ps.map(p=>`<option value="${esc(p.id)}"${p.id===sel ? " selected" : ""}>${esc(productTitle(p))}${sizeText(p) ? " ("+esc(sizeText(p))+")" : ""}</option>`).join("");
}

const USAGE_MODES={ auto:"Automatic (learn from what I use)", manual:"I'll say how much per day", per_person:"Per person per day (scales with household)", none:"Don't forecast this item" };

function openInvItem(id,prefill){
 let it=id ? invById(id) : null;
 let f=it || Object.assign({ name:"", productId:"", location:"pantry", unit:"pcs", quantity:"", minQty:"", packSize:1, usage:{mode:"auto"}, perishable:false, expiryDate:"", shelfLifeDays:"", notes:"" },prefill||{});
 let u=f.usage||{mode:"auto"};
 sheetState={ invId:id };
 let info=it ? itemInfo(it) : null;
 let fcHTML="";
 if(info){
  let p=it.productId ? productById(it.productId) : null;
  let kp=p ? knownItemPrice(p.id,null) : null;
  let cyc=currentCycle();
  fcHTML=`<div class="card inv-forecast" id="invForecast"><b>📈 Forecast</b>
   <div class="row-line"><span>Status</span>${invBadge(info.st.state)}</div>
   <div class="row-line"><span>Daily use</span><b>${info.use.value ? qtyText(info.use.value)+" "+esc(it.unit)+"/day" : "not set"}</b></div>
   ${info.use.value ? `<div class="field-note">${info.use.source==="learned" ? "Learned from what you've used"+(householdCtx().weightedPeople ? ", scaled to your household" : "") : info.use.source==="per_person" ? "Per person × "+esc(String(householdCtx().weightedPeople))+" people"+(householdCtx().pets && C.num(u.perPetPerDay) ? " + pets" : "") : "Your own number"}</div>` : '<div class="field-note">Tap − on the Inventory screen when you use some, or set daily use below, to get a forecast.</div>'}
   <div class="row-line"><span>Days of supply</span><b id="invDos">${info.fc.daysOfSupply===null ? "—" : qtyText(info.fc.daysOfSupply)}</b></div>
   <div class="row-line"><span>Runs out around</span><b>${info.fc.runOutDate ? esc(shortDay(info.fc.runOutDate)) : "—"}</b></div>
   <div class="row-line"><span>Needed per ${cyc.lengthDays}-day cycle</span><b>${info.fc.neededPerCycle===null ? "—" : qtyText(info.fc.neededPerCycle)+" "+esc(it.unit)}</b></div>
   ${info.fc.lastsThisCycle===null ? "" : `<div class="row-line"><span>Lasts this cycle (${plural(cyc.daysLeft,"day")} left)?</span><b class="${info.fc.lastsThisCycle ? "green" : "red"}">${info.fc.lastsThisCycle ? "Yes" : "No"}</b></div>`}
   <div class="row-line"><span>Suggested to buy</span><b id="invReorder">${info.re.qty>0 ? qtyText(info.re.qty)+" "+esc(it.unit)+(it.packSize>1 ? " ("+plural(info.re.packs,"pack")+")" : "") : "nothing now"}</b></div>
   ${info.re.qty>0 ? `<div class="field-note">${kp ? "≈ "+money(C.lineEstimate(kp.price,info.re.packs))+" at the last price you paid ("+money(kp.price)+(kp.storeName ? " at "+esc(kp.storeName) : "")+")" : "No price yet — link a Price Book product or save a receipt to see the cost."}</div>
    <button class="action wide" id="invToList" onclick="reorderToList('${esc(it.id)}')">📝 Add ${qtyText(info.re.packs)} to shopping list</button>` : ""}
  </div>`;
 }
 openSheet(`<h2>${it ? "📦 "+esc(it.name) : "Add inventory item"}</h2>
  ${fcHTML}
  <label for="ivProduct">Price Book product (optional)</label><select id="ivProduct" onchange="invProductPicked()">${productSelectOptions(f.productId)}</select>
  <div class="field-note">Linking brings in prices and lets receipts and trips restock this item automatically.</div>
  <label for="ivName">Item name</label><input id="ivName" autocomplete="off" placeholder="e.g. Rice, Eggs, Dog food" value="${esc(f.name)}">
  <div class="two"><div><label for="ivQty">How many now</label><input id="ivQty" inputmode="decimal" autocomplete="off" placeholder="0" value="${esc(f.quantity===""||f.quantity==null ? "" : qtyText(f.quantity))}"></div>
  <div><label for="ivUnit">Counted in</label><input id="ivUnit" autocomplete="off" placeholder="pcs, kg, packs" value="${esc(f.unit)}"></div></div>
  <div class="two"><div><label for="ivLoc">Kept in</label><select id="ivLoc">${Object.entries(Mdl.INVENTORY_LOCATIONS).map(([k,v])=>`<option value="${k}"${f.location===k ? " selected" : ""}>${esc(v)}</option>`).join("")}</select></div>
  <div><label for="ivPack">One purchase adds</label><input id="ivPack" inputmode="decimal" autocomplete="off" value="${esc(qtyText(f.packSize||1))}"></div></div>
  <label for="ivMin">Warn me at or below (optional)</label><input id="ivMin" inputmode="decimal" autocomplete="off" placeholder="e.g. 2" value="${esc(f.minQty==null ? "" : qtyText(f.minQty))}">
  <label for="ivMode">Daily use</label><select id="ivMode" onchange="invModeChanged()">${Object.entries(USAGE_MODES).map(([k,v])=>`<option value="${k}"${(u.mode||"auto")===k ? " selected" : ""}>${esc(v)}</option>`).join("")}</select>
  <div id="ivManualBox"><label for="ivPerDay">Used per day (whole household)</label><input id="ivPerDay" inputmode="decimal" autocomplete="off" placeholder="e.g. 0.5" value="${esc(u.perDay==null ? "" : qtyText(u.perDay))}"></div>
  <div id="ivPersonBox" class="two"><div><label for="ivPerPerson">Per person per day</label><input id="ivPerPerson" inputmode="decimal" autocomplete="off" placeholder="e.g. 0.1" value="${esc(u.perPersonPerDay==null ? "" : qtyText(u.perPersonPerDay))}"></div>
  <div><label for="ivPerPet">Per pet per day</label><input id="ivPerPet" inputmode="decimal" autocomplete="off" placeholder="0" value="${esc(u.perPetPerDay==null ? "" : qtyText(u.perPetPerDay))}"></div></div>
  <label class="check"><input type="checkbox" id="ivPerish" ${f.perishable ? "checked" : ""} onchange="invModeChanged()"> Perishable (track expiry)</label>
  <div id="ivPerishBox" class="two"><div><label for="ivExpiry">Expires on</label><input id="ivExpiry" type="date" value="${esc(f.expiryDate||"")}"></div>
  <div><label for="ivLife">Keeps for (days)</label><input id="ivLife" inputmode="numeric" autocomplete="off" placeholder="e.g. 7" value="${esc(f.shelfLifeDays==null ? "" : String(f.shelfLifeDays))}"></div></div>
  <label for="ivNotes">Notes (optional)</label><input id="ivNotes" autocomplete="off" value="${esc(f.notes||"")}">
  <div id="sheetMsg" class="form-msg" aria-live="polite"></div>
  <button class="primary" id="ivSave" onclick="saveInvItem()">✅ SAVE</button>
  ${it ? `<div class="btn-row"><button class="action" onclick="invUsedUp('${esc(it.id)}')">${it.perishable ? "🗑️ Used up / thrown out" : "⛔ Used up"}</button><button class="action" onclick="archiveInvItem('${esc(it.id)}')">🗄️ Stop tracking</button></div>
   ${invHistoryHTML(it)}` : ""}
  <button class="action wide" onclick="closeSheet()">Cancel</button>`);
 invModeChanged();
}

function invHistoryHTML(it){
 let tx=txFor(it.id).slice(-8).reverse();
 if(!tx.length) return "";
 let L={add:"Added",use:"Used",adjust:"Counted",trip:"Bought (trip)",receipt:"Bought (receipt)",discard:"Thrown out"};
 return `<details><summary>Recent changes (${txFor(it.id).length})</summary>${tx.map(t=>`<div class="row-line"><span>${esc(L[t.type]||t.type)} <small class="muted">${esc(shortDay(t.day))}</small></span><span>${t.qty>0 ? "+" : ""}${qtyText(t.qty)} → ${qtyText(t.after)}</span></div>`).join("")}</details>`;
}

function invModeChanged(){
 let m=val("ivMode");
 $id("ivManualBox").classList.toggle("hidden",!(m==="manual" || m==="auto"));
 $id("ivPersonBox").classList.toggle("hidden",!(m==="per_person" || m==="auto"));
 $id("ivPerishBox").classList.toggle("hidden",!$id("ivPerish").checked);
}

function invProductPicked(){
 let p=productById(val("ivProduct"));
 if(!p) return;
 if(!val("ivName")) $id("ivName").value=p.name;
 if(p.unit && val("ivUnit")==="pcs" && C.normalizeUnit(p.unit) && ["pc","pack","bottle","can","box","roll","sachet","tray","bag"].includes(C.normalizeUnit(p.unit))) $id("ivUnit").value=C.unitLabel(p.unit);
}

function numField(id,label,opts){
 let raw=val(id);
 if(raw==="") return { ok:true, v:null };
 let n=C.num(raw);
 if(n===null || n<0 || (opts && opts.positive && n===0)) return { ok:false, msg:label+" must be a number"+(opts && opts.positive ? " above 0" : " (0 or more)")+"." };
 return { ok:true, v:n };
}

function saveInvItem(){
 let name=val("ivName");
 if(!name){ sheetMsg("Please enter the item name."); return; }
 let fields={ qty:numField("ivQty","How many now"), pack:numField("ivPack","One purchase adds",{positive:true}), min:numField("ivMin","Warn me at"),
  perDay:numField("ivPerDay","Used per day"), pp:numField("ivPerPerson","Per person per day"), pet:numField("ivPerPet","Per pet per day"), life:numField("ivLife","Keeps for",{positive:true}) };
 let bad=Object.values(fields).find(x=>!x.ok);
 if(bad){ sheetMsg(bad.msg); return; }
 let exp=val("ivExpiry");
 let perish=$id("ivPerish").checked;
 let mode=val("ivMode")||"auto";
 if(mode==="manual" && !(fields.perDay.v>0)){ sheetMsg("Enter how much is used per day, or pick Automatic."); return; }
 if(mode==="per_person" && !(fields.pp.v>0) && !(fields.pet.v>0)){ sheetMsg("Enter the amount per person (or per pet) per day."); return; }
 let productId=val("ivProduct")||null;
 if(!productId){ let p=Mdl.findProductByName(data.products,name); if(p && !p.archived) productId=p.id; }
 let dupe=invItems().find(i=>i.id!==sheetState.invId && ((productId && i.productId===productId) || Mdl.normalizeName(i.name)===Mdl.normalizeName(name)));
 if(dupe && !sheetState.dupOk){ sheetMsg("⚠️ You already track "+dupe.name+". Tap SAVE again to add a second entry anyway."); sheetState.dupOk=true; return; }
 let now=new Date().toISOString();
 let usage={ mode, perDay:fields.perDay.v, perPersonPerDay:fields.pp.v, perPetPerDay:fields.pet.v };
 let common={ name, productId, location:val("ivLoc"), unit:val("ivUnit")||"pcs", minQty:fields.min.v>0 ? fields.min.v : null, packSize:fields.pack.v||1,
  usage, perishable:perish, shelfLifeDays:perish ? fields.life.v : null, notes:val("ivNotes") };
 let it=sheetState.invId ? invById(sheetState.invId) : null;
 if(it){
  let before=Mdl.clone(it);
  Object.assign(it,common,{ expiryDate:perish ? (exp||null) : null, updatedAt:now });
  let q=fields.qty.v===null ? before.quantity : fields.qty.v;
  if(C.round2(q)!==C.round2(before.quantity)) changeStock(it,q-before.quantity,"adjust",{note:"counted"});
  audit("inventory.edit","Inventory item updated: "+name,{entity:"inventoryItems",id:it.id,before:{quantity:before.quantity,minQty:before.minQty,usage:before.usage},after:{quantity:it.quantity,minQty:it.minQty,usage:it.usage}});
 }else{
  it=Mdl.makeInventoryItem(Object.assign({},common,{ quantity:0, expiryDate:perish ? (exp||null) : null }),now);
  data.inventoryItems.push(it);
  if(fields.qty.v>0){
   changeStock(it,fields.qty.v,"add",{note:"starting stock",expiryDate:perish ? (exp||null) : null});
   if(perish && exp) it.expiryDate=exp;
  }
  audit("inventory.add","Inventory item added: "+name+" ("+qtyText(it.quantity)+" "+it.unit+")",{entity:"inventoryItems",id:it.id,after:{quantity:it.quantity}});
 }
 closeSheet();
 save();
 toast("✅ Saved "+name);
}

function invUsedUp(id){
 let it=invById(id);
 if(!it || !(Number(it.quantity)>0)){ closeSheet(); return; }
 let t=changeStock(it,-Number(it.quantity),it.perishable ? "discard" : "use");
 audit("inventory.usedUp",it.name+" marked "+(it.perishable ? "used up / thrown out" : "used up")+" ("+t.before+" → 0)",{entity:"inventoryItems",id:it.id,before:{quantity:t.before},after:{quantity:0}});
 closeSheet(); save();
}

function archiveInvItem(id){
 let it=invById(id);
 if(!it) return;
 if(!confirm("Stop tracking "+it.name+"? Its history is kept.")) return;
 it.archived=true; it.archivedAt=new Date().toISOString();
 audit("inventory.archive","Stopped tracking "+it.name,{entity:"inventoryItems",id:it.id});
 closeSheet(); save();
}

/* =====================================================================
   SMART SHOPPING LIST
   ===================================================================== */

function activeList(){
 if(!Array.isArray(data.shoppingLists)) data.shoppingLists=[];
 let l=data.shoppingLists.find(x=>x && x.status==="active");
 if(!l){ l=Mdl.makeList("Shopping list",new Date().toISOString()); data.shoppingLists.push(l); }
 if(!Array.isArray(l.items)) l.items=[];
 return l;
}
function listItemById(id){ return activeList().items.find(i=>i.id===id) || null; }
function openListItems(){ return activeList().items.filter(i=>i.status==="open" || i.status==="in_cart"); }

function sameThing(li,productId,name,invId){
 return (productId && li.productId===productId) || (invId && li.inventoryItemId===invId) || (name && Mdl.normalizeName(li.name)===Mdl.normalizeName(name));
}
function onActiveList(productId,name,invId){
 return openListItems().some(li=>sameThing(li,productId,name,invId));
}

function itemEstimate(li){
 let kp=knownItemPrice(li.productId,li.storeId);
 return { amount:kp ? C.lineEstimate(kp.price,li.qty) : null, kp };
}

function dupWarningsFor(productId,name,invId,exceptId){
 let inv=(invId && invById(invId)) || invForProduct(productId) || invForName(name);
 let trip=activeTrip();
 let open=openListItems().filter(li=>li.id!==exceptId && sameThing(li,productId,name,invId));
 return C.duplicateWarnings({
  onList:open.length>0,
  inCart:open.some(li=>li.status==="in_cart") || !!(trip && trip.cart.some(c=>c.listItemId!==exceptId && sameThing(c,productId,name,null))),
  daysOfSupply:inv ? itemInfo(inv).st.days : null,
  cycleDays:currentCycle().lengthDays,
  lastBoughtDay:lastBoughtDay(productId,name), today:todayDay(), windowDays:invSettings().duplicateWindowDays
 });
}

/* New cycle → freeze last cycle's planned vs actual, carry open & deferred items forward. */
function rollCycle(){
 let cyc=currentCycle();
 let list=activeList();
 let old=list.items.filter(li=>li.cycleStart && li.cycleStart<cyc.start && ["open","in_cart","deferred"].includes(li.status));
 let starts=[...new Set(list.items.filter(li=>li.cycleStart && li.cycleStart<cyc.start).map(li=>li.cycleStart))];
 let changed=false;
 starts.forEach(st=>{
  if((data.shoppingCycles||[]).some(c=>c.start===st)) return;
  let r=C.cycleRange(cycleSettings(),st);
  data.shoppingCycles.push(Object.assign({ id:Mdl.newId("cyc"), start:r.start, end:r.end, closedAt:new Date().toISOString() },cyclePlanVsActual(r)));
  changed=true;
 });
 old.forEach(li=>{ li.carriedFrom=li.cycleStart; li.cycleStart=cyc.start; if(li.status==="deferred") li.status="open"; changed=true; });
 if(changed){
  audit("cycle.roll","New shopping cycle "+cycleLabel(cyc)+(old.length ? " · "+plural(old.length,"item")+" carried over" : ""),{entity:"shoppingCycles"});
  storeData();
 }
}

function cyclePlanVsActual(r){
 let planned=[];
 (data.shoppingLists||[]).forEach(l=>(l.items||[]).forEach(li=>{
  if(li.cycleStart!==r.start) return;     // carried-over items count in the cycle they moved to
  if(li.unplanned) return;                 // grabbed during a trip → counts as "not on the plan"
  // the estimate when it was planned (no price then → stays unpriced; never back-filled)
  let est="plannedAmount" in li ? li.plannedAmount : itemEstimate(li).amount;
  planned.push({ amount:est, status:li.status, boughtAmount:li.boughtAmount });
 }));
 let x=C.plannedVsActual({ planned, actualEntries:historyEntries(), range:r });
 return x;
}

let listView={ showBought:false };

function renderLists(){
 let box=$id("listsBody");
 if(!box) return;
 rollCycle();
 let list=activeList();
 let cyc=currentCycle();
 let b=budgetNow();
 let open=list.items.filter(i=>i.status==="open" || i.status==="in_cart");
 let withAmt=open.map(li=>Object.assign({},li,{ amount:itemEstimate(li).amount }));
 let t=C.listTotals(withAmt.map(x=>Object.assign({},x,{status:"open"})));
 let deferred=list.items.filter(i=>i.status==="deferred");
 let bought=list.items.filter(i=>i.status==="bought" && i.cycleStart===cyc.start);
 let A=inventoryAlerts();
 let lowNotListed=A.low.filter(x=>!onActiveList(x.it.productId,x.it.name,x.it.id)).length;
 let trip=activeTrip();
 let safe=b.state==="SETUP" ? null : b.safeToSpend;
 let over=safe!==null && t.total>safe ? C.round2(t.total-safe) : 0;
 let needs=withAmt.filter(x=>x.kind==="need").sort((a,b)=>a.priority-b.priority || a.name.localeCompare(b.name));
 let wants=withAmt.filter(x=>x.kind==="want").sort((a,b)=>a.priority-b.priority || a.name.localeCompare(b.name));
 box.innerHTML=`${trip ? `<div class="banner trip-banner"><b>🛒 Shopping trip in progress</b> · ${money(tripTotals(trip).cartTotal)} in cart <button class="action" onclick="showSub('shop','trip')">Resume trip</button></div>` : ""}
  <div class="card summary-card" id="listSummary">
   <div class="card-head"><b>📝 ${esc(list.name)}</b><small class="muted">Cycle ${esc(cycleLabel(cyc))} · ${plural(cyc.daysLeft,"day")} left</small></div>
   <div class="calc-line"><span>Needs (${t.needCount})</span><b id="listNeeds">${money(t.needs)}</b></div>
   <div class="calc-line"><span>Wants (${t.wantCount})</span><b id="listWants">${money(t.wants)}</b></div>
   <div class="calc-line total"><span>Estimated total</span><b id="listTotal">${money(t.total)}</b></div>
   ${t.unpriced ? `<div class="field-note" id="listUnpriced">🏷️ ${plural(t.unpriced,"item")} ha${t.unpriced===1 ? "s" : "ve"} no price yet and ${t.unpriced===1 ? "isn't" : "aren't"} in the total.</div>` : ""}
   ${safe!==null ? `<div class="calc-line"><span>Safe to spend now</span><b>${C.limitText(b.rawSafe)}</b></div>
    ${over>0 ? `<div class="form-msg err" id="listOver">⚠️ The list is ${money(over)} over Safe to Spend.${t.wants ? " Fit to budget moves optional wants to the next cycle." : ""}</div>` : (open.length ? `<div class="form-msg ok" id="listFits">✅ Fits within Safe to Spend.</div>` : "")}` : '<div class="field-note">Set your Shopping Fund (Budget tab) to compare the list with Safe to Spend.</div>'}
   <div class="btn-row"><button class="action" id="listAddBtn" onclick="openListItem(null)">➕ Add item</button>
   <button class="action" id="listLowBtn" onclick="addLowToList()" ${lowNotListed ? "" : "disabled"}>${lowNotListed ? "📦 Add "+lowNotListed+" low-stock" : "📦 No new low stock"}</button>
   <button class="action" id="listFitBtn" onclick="fitListToBudget()" ${safe!==null && t.wantCount ? "" : "disabled"}>⚖️ Fit to budget</button>
   <button class="action" id="tripStartBtn" onclick="${trip ? "showSub('shop','trip')" : "startTrip()"}" ${open.length || trip ? "" : "disabled"}>🛒 ${trip ? "Resume" : "Start"} trip</button></div>
  </div>
  ${open.length ? "" : emptyState("📝","Your list is empty","Add what you need for this cycle. Prices come from your Price Book, so the total is real — nothing is guessed.","")}
  ${needs.length ? `<div class="card" id="listNeedsCard"><h3 class="card-title">✅ Needs</h3>${needs.map(listRow).join("")}</div>` : ""}
  ${wants.length ? `<div class="card" id="listWantsCard"><h3 class="card-title">💭 Wants <small class="muted">optional — 📌 pin to protect</small></h3>${wants.map(listRow).join("")}</div>` : ""}
  ${deferred.length ? `<div class="card" id="listDeferred"><h3 class="card-title">⏭️ Moved to next cycle (${deferred.length})</h3>${deferred.map(li=>`<div class="list-row" data-li="${esc(li.id)}"><div><b>${esc(li.name)}</b><small class="muted"> ${li.qty>1 ? "×"+qtyText(li.qty) : ""}</small></div><div class="list-actions"><button class="mini" onclick="restoreListItem('${esc(li.id)}')">↩️ Bring back</button></div></div>`).join("")}</div>` : ""}
  ${bought.length ? `<details class="card" id="listBought"><summary>✔️ Bought this cycle (${bought.length})</summary>${bought.map(li=>`<div class="row-line"><span>${esc(li.name)} <small class="muted">${esc(li.boughtVia||"")}</small></span><b>${li.boughtAmount!=null ? money(li.boughtAmount) : "—"}</b></div>`).join("")}</details>` : ""}`;
}

function listRow(li){
 let e=itemEstimate(li);
 let st=li.storeId ? storeById(li.storeId) : null;
 let pr=li.priority===1 ? '<span class="tag pri-high">High</span>' : (li.priority===3 ? '<span class="tag off">Low</span>' : "");
 return `<div class="list-row li-row" data-li="${esc(li.id)}">
  <div onclick="openListItem('${esc(li.id)}')"><b>${esc(li.name)}</b>${li.qty!==1 ? ` <small>×${qtyText(li.qty)}</small>` : ""} ${pr}${li.pinned ? ' <span class="tag pin">📌 kept</span>' : ""}${li.status==="in_cart" ? ' <span class="tag">🛒 in cart</span>' : ""}
   <small class="muted li-price">${e.amount!==null ? "≈ "+money(e.amount)+(e.kp && !e.kp.sameStore && e.kp.storeName ? " (price at "+esc(e.kp.storeName)+")" : "") : "no price yet"}${st ? " · "+esc(storeLabel(st)) : ""}${li.carriedFrom ? " · carried over" : ""}</small></div>
  <div class="list-actions">
   ${li.kind==="want" ? `<button class="mini${li.pinned ? " on" : ""}" aria-label="${li.pinned ? "Unpin" : "Pin"} ${esc(li.name)}" data-act="pin" onclick="togglePin('${esc(li.id)}')">📌</button>` : ""}
   <button class="mini" aria-label="Remove ${esc(li.name)}" data-act="remove" onclick="removeListItem('${esc(li.id)}')">✕</button>
  </div></div>`;
}

function openListItem(id,prefill){
 let li=id ? listItemById(id) : null;
 let f=li || Object.assign({ name:"", productId:"", qty:1, kind:"need", priority:2, pinned:false, storeId:"", note:"" },prefill||{});
 sheetState={ liId:id, dupOk:false, inventoryItemId:f.inventoryItemId||null, stockPerQty:f.stockPerQty||null, addedFrom:f.addedFrom||"manual" };
 openSheet(`<h2>${li ? "Edit list item" : "Add to shopping list"}</h2>
  <label for="liName">What do you need?</label><input id="liName" autocomplete="off" placeholder="e.g. Eggs, Rice 5kg" value="${esc(f.name)}" onchange="listNamePicked()">
  <label for="liProduct">Price Book product (for the price)</label><select id="liProduct" onchange="listNamePicked(true)">${productSelectOptions(f.productId)}</select>
  <div class="two"><div><label for="liQty">How many</label><input id="liQty" inputmode="decimal" autocomplete="off" value="${esc(qtyText(f.qty))}"></div>
  <div><label for="liStore">Store (optional)</label><select id="liStore">${storeOptions(f.storeId,true)}</select></div></div>
  <label>Need or want?</label>
  <div class="seg" id="liKind"><button type="button" data-kind="need" class="${f.kind!=="want" ? "on" : ""}" onclick="setSeg('liKind',this)">✅ Need</button><button type="button" data-kind="want" class="${f.kind==="want" ? "on" : ""}" onclick="setSeg('liKind',this)">💭 Want (optional)</button></div>
  <label>Priority</label>
  <div class="seg" id="liPri">${[1,2,3].map(p=>`<button type="button" data-pri="${p}" class="${Number(f.priority)===p ? "on" : ""}" onclick="setSeg('liPri',this)">${Mdl.LIST_PRIORITIES[p]}</button>`).join("")}</div>
  <label class="check"><input type="checkbox" id="liPin" ${f.pinned ? "checked" : ""}> 📌 Keep this even when the budget is tight</label>
  <div id="liEstimate" class="field-note"></div>
  <div id="sheetMsg" class="form-msg" aria-live="polite"></div>
  <button class="primary" id="liSave" onclick="saveListItem()">✅ ${li ? "SAVE" : "ADD TO LIST"}</button>
  <button class="action wide" onclick="closeSheet()">Cancel</button>`);
 showListEstimate();
}

function setSeg(id,btn){ document.querySelectorAll("#"+id+" button").forEach(b=>b.classList.toggle("on",b===btn)); }
function segVal(id,attr){ let b=document.querySelector("#"+id+" button.on"); return b ? b.dataset[attr] : null; }

function listNamePicked(fromSelect){
 if(fromSelect){ let p=productById(val("liProduct")); if(p && !val("liName")) $id("liName").value=productTitle(p); }
 else if(!val("liProduct")){ let m=Mdl.matchProduct(data.products,val("liName")); if(m.confidence==="high") $id("liProduct").value=m.product.id; }
 sheetState.dupOk=false;
 showListEstimate();
}

function showListEstimate(){
 let el=$id("liEstimate"); if(!el) return;
 let kp=knownItemPrice(val("liProduct"),val("liStore"));
 let q=C.num(val("liQty"))||1;
 el.innerHTML=kp ? "≈ <b>"+money(C.lineEstimate(kp.price,q))+"</b> ("+money(kp.price)+" each"+(kp.storeName ? " at "+esc(kp.storeName) : "")+(kp.date ? ", "+esc(shortDay(kp.date)) : "")+")" : "No price yet for this item — it won't be added to the total until you have a real price.";
}

function saveListItem(){
 let name=val("liName");
 if(!name){ sheetMsg("Please say what you need."); return; }
 let qty=C.num(val("liQty"));
 if(!(qty>0)){ sheetMsg("How many must be a number above 0."); return; }
 let productId=val("liProduct")||null;
 if(!productId){ let m=Mdl.matchProduct(data.products,name); if(m.confidence==="high") productId=m.product.id; }
 let invId=sheetState.inventoryItemId || ((invForProduct(productId)||invForName(name)||{}).id) || null;
 if(!sheetState.dupOk){
  let w=dupWarningsFor(productId,name,invId,sheetState.liId);
  if(w.length){ sheetMsg("⚠️ "+w.map(x=>x.message).join(" ")+" Tap "+(sheetState.liId ? "SAVE" : "ADD")+" again to add it anyway."); sheetState.dupOk=true; $id("sheetMsg").dataset.dup=w.map(x=>x.code).join(","); return; }
 }
 let fields={ name, productId, qty, storeId:val("liStore")||null, kind:segVal("liKind","kind")==="want" ? "want" : "need", priority:Number(segVal("liPri","pri"))||2, pinned:$id("liPin").checked, inventoryItemId:invId };
 let now=new Date().toISOString();
 let li=sheetState.liId ? listItemById(sheetState.liId) : null;
 if(li){
  Object.assign(li,fields,{updatedAt:now});
  audit("list.edit","List item updated: "+name,{entity:"shoppingLists",id:li.id});
 }else{
  li=Mdl.makeListItem(Object.assign({},fields,{ addedFrom:sheetState.addedFrom, cycleStart:currentCycle().start }),now);
  if(sheetState.stockPerQty) li.stockPerQty=sheetState.stockPerQty;
  li.plannedAmount=itemEstimate(li).amount;
  activeList().items.push(li);
  audit("list.add","Added to list: "+name+(qty!==1 ? " ×"+qtyText(qty) : "")+" ("+li.kind+")",{entity:"shoppingLists",id:li.id});
 }
 activeList().updatedAt=now;
 let editing=!!sheetState.liId;
 closeSheet(); save();
 toast("📝 "+name+" "+(editing ? "updated" : "added"));
}

function removeListItem(id){
 let li=listItemById(id); if(!li) return;
 li.status="removed"; li.removedAt=new Date().toISOString();
 let trip=activeTrip(); if(trip) trip.cart=trip.cart.filter(c=>c.listItemId!==id);
 audit("list.remove","Removed from list: "+li.name,{entity:"shoppingLists",id:li.id});
 save();
}
function restoreListItem(id){
 let li=listItemById(id); if(!li) return;
 li.status="open"; li.cycleStart=currentCycle().start;
 audit("list.restore","Brought back to list: "+li.name,{entity:"shoppingLists",id:li.id});
 save();
}
function togglePin(id){
 let li=listItemById(id); if(!li) return;
 li.pinned=!li.pinned;
 audit("list.pin",(li.pinned ? "Pinned (kept): " : "Unpinned: ")+li.name,{entity:"shoppingLists",id:li.id});
 save();
}

/* Optional-item protection: needs and pinned wants stay; other wants move to next cycle until the list fits. */
function fitListToBudget(){
 let b=budgetNow();
 if(b.state==="SETUP"){ toast("Set your Shopping Fund first"); return; }
 let open=activeList().items.filter(i=>i.status==="open");
 let r=C.fitToBudget(open.map(li=>({ id:li.id, kind:li.kind, priority:li.priority, pinned:li.pinned, amount:itemEstimate(li).amount })),b.safeToSpend);
 let moved=r.deferred.map(id=>listItemById(id));
 let movedTotal=C.sum(moved,li=>itemEstimate(li).amount||0);
 moved.forEach(li=>{ li.status="deferred"; li.deferredAt=new Date().toISOString(); li.deferredReason="fit_budget"; });
 audit("list.fit","Fit to budget: "+plural(moved.length,"want")+" moved to next cycle ("+money(movedTotal)+"); kept "+money(r.keptTotal)+" of "+money(b.safeToSpend)+" safe to spend",{entity:"shoppingLists"});
 save();
 if(!r.fits) toast("⚠️ Needs and pinned items alone are "+money(r.shortfall)+" over Safe to Spend");
 else toast(moved.length ? "⚖️ Moved "+plural(moved.length,"optional item")+" ("+money(movedTotal)+") to next cycle" : "✅ Everything already fits");
}

function addLowToList(){
 let A=inventoryAlerts();
 let added=0;
 let now=new Date().toISOString(), cyc=currentCycle();
 A.low.forEach(({it,info})=>{
  if(onActiveList(it.productId,it.name,it.id)) return;
  let packs=Math.max(1,info.re.packs||1);
  let li=Mdl.makeListItem({ name:it.name, productId:it.productId, inventoryItemId:it.id, qty:packs, kind:"need", priority:["OUT","URGENT"].includes(info.st.state) ? 1 : 2, addedFrom:"inventory", cycleStart:cyc.start },now);
  li.stockPerQty=it.packSize||1;
  li.plannedAmount=itemEstimate(li).amount;
  activeList().items.push(li);
  added++;
 });
 if(!added){ toast("Nothing new to add"); return; }
 audit("list.addLow","Added "+plural(added,"low-stock item")+" to the shopping list",{entity:"shoppingLists"});
 save();
 toast("📝 Added "+plural(added,"low-stock item")+" to your list");
}

function reorderToList(invId){
 let it=invById(invId); if(!it) return;
 let info=itemInfo(it);
 closeSheet();
 openListItem(null,{ name:it.name, productId:it.productId||"", qty:Math.max(1,info.re.packs||1), kind:"need", priority:["OUT","URGENT"].includes(info.st.state) ? 1 : 2, inventoryItemId:it.id, stockPerQty:it.packSize||1, addedFrom:"inventory" });
}

/* =====================================================================
   SHOPPING TRIP MODE
   ===================================================================== */

function activeTrip(){ return (data.trips||[]).find(t=>t && t.status==="active") || null; }
function tripBudget(){ return { fund:data.fund, spent:data.spent, stop:data.stop, committed:committedTotal(), reserve:reserveTotal(), thresholds:data.settings && data.settings.thresholds }; }
function tripTotals(trip){ return C.tripSummary(tripBudget(),trip ? trip.cart : []); }
let tripState={ confirmStop:false, confirmUnpriced:false };

function tripStoreFor(li){
 if(li.storeId && storeById(li.storeId)) return li.storeId;
 let p=li.productId ? productById(li.productId) : null;
 if(p){ let st=productStats(p); if(st.cheapestStore && st.cheapestStore.storeKey && storeById(st.cheapestStore.storeKey)) return st.cheapestStore.storeKey; }
 return "";
}

function startTrip(){
 if(activeTrip()){ showSub("shop","trip"); return; }
 let open=activeList().items.filter(i=>i.status==="open");
 if(!open.length){ toast("Add items to your list first"); return; }
 let t={ id:Mdl.newId("trip"), status:"active", listId:activeList().id, cart:[], startedAt:new Date().toISOString(), cycleStart:currentCycle().start };
 data.trips.push(t);
 tripState={ confirmStop:false, confirmUnpriced:false };
 audit("trip.start","Shopping trip started ("+plural(open.length,"item")+" on the list)",{entity:"trips",id:t.id});
 save();
 showSub("shop","trip");
}

function renderTrip(){
 let box=$id("tripBody");
 if(!box) return;
 let trip=activeTrip();
 if(!trip){
  let n=activeList().items.filter(i=>i.status==="open").length;
  box.innerHTML=emptyState("🛒","No shopping trip open","Start a trip from your list when you're at the store: tick items as they go in the cart and watch the total against Safe to Spend.",
   n ? `<button class="action" id="tripStartEmpty" onclick="startTrip()">🛒 Start trip (${plural(n,"item")})</button>` : `<button class="action" onclick="showSub('shop','list')">📝 Open list</button>`);
  renderTripBar();
  return;
 }
 let items=activeList().items.filter(i=>i.status==="open" || i.status==="in_cart");
 let groups={};
 items.forEach(li=>{ let c=trip.cart.find(x=>x.listItemId===li.id); let sid=c ? (c.storeId||"") : tripStoreFor(li); (groups[sid]=groups[sid]||[]).push(li); });
 let keys=Object.keys(groups).sort((a,b)=>(a==="")-(b==="") || storeLabel(storeById(a)).localeCompare(storeLabel(storeById(b))));
 box.innerHTML=`<div class="card"><div class="card-head"><b>🛒 Shopping trip</b><small class="muted">started ${esc(fmtDateTime(trip.startedAt))}</small></div>
   <div class="field-note">Tick items as they go in your cart. Prices are filled from your Price Book when known — change them to what the shelf says.</div></div>
  ${keys.map(k=>{
   let s=storeById(k);
   let list=groups[k].sort((a,b)=>(a.status==="in_cart")-(b.status==="in_cart") || (a.kind==="want")-(b.kind==="want") || a.priority-b.priority);
   return `<div class="card trip-group" data-store="${esc(k||"any")}"><h3 class="card-title">${s ? "🏬 "+esc(storeLabel(s)) : "🛍️ Any store"} <small class="muted">${list.filter(x=>x.status==="in_cart").length}/${list.length}</small></h3>${list.map(li=>tripRow(li,trip,k)).join("")}</div>`;
  }).join("")}
  <div class="card"><h3 class="card-title">➕ Something not on the list?</h3>
   <div class="two"><input id="tripExtraName" autocomplete="off" placeholder="Item" aria-label="Extra item name"><input id="tripExtraPrice" inputmode="decimal" autocomplete="off" placeholder="Price ₱" aria-label="Extra item price"></div>
   <select id="tripExtraStore" aria-label="Store">${storeOptions(keys.find(k=>k)||"",true)}</select>
   <div id="tripExtraMsg" class="form-msg" aria-live="polite"></div>
   <button class="action wide" id="tripExtraAdd" onclick="tripAddExtra()">➕ Add to cart</button></div>
  <button class="action wide" id="tripCancel" onclick="cancelTrip()">✕ Cancel trip (keep my list)</button>
  <div class="end-space"></div>`;
 renderTripBar();
}

function tripRow(li,trip,storeId){
 let c=trip.cart.find(x=>x.listItemId===li.id);
 let kp=knownItemPrice(li.productId,storeId||null);
 let pre=c ? c.amount : (kp ? C.lineEstimate(kp.price,li.qty) : null);
 return `<div class="trip-row${c ? " in" : ""}" data-li="${esc(li.id)}">
  <button class="trip-check" aria-label="${c ? "Take out of cart" : "Put in cart"}: ${esc(li.name)}" aria-pressed="${c ? "true" : "false"}" onclick="${c ? "tripUncheck" : "tripCheck"}('${esc(li.id)}','${esc(storeId)}')">${c ? "✔" : ""}</button>
  <div class="trip-name"><b>${esc(li.name)}</b>${li.qty!==1 ? ` <small>×${qtyText(li.qty)}</small>` : ""}${li.kind==="want" ? ' <span class="tag off">want</span>' : ""}
   <small class="muted">${c ? "🛒 in cart" : (kp ? "last "+money(kp.price)+" each"+(kp.sameStore ? "" : (kp.storeName ? " at "+esc(kp.storeName) : "")) : "no price yet — type the shelf price")}</small></div>
  <input class="trip-price" id="tp_${esc(li.id)}" inputmode="decimal" autocomplete="off" placeholder="₱" aria-label="Price for ${esc(li.name)}" value="${pre!=null ? esc(amountForInput(pre)) : ""}" onchange="tripPrice('${esc(li.id)}',this.value)">
 </div>`;
}

function readPrice(v){ let a=parseAmount(String(v||"")); return a===null || isNaN(a) ? null : (a<0 ? NaN : C.round2(a)); }

function tripCheck(liId,storeId){
 let trip=activeTrip(), li=listItemById(liId);
 if(!trip || !li) return;
 let amt=readPrice(($id("tp_"+liId)||{}).value);
 if(Number.isNaN(amt)){ toast("Please check the price"); return; }
 trip.cart=trip.cart.filter(c=>c.listItemId!==liId);
 trip.cart.push({ listItemId:li.id, name:li.name, productId:li.productId||null, storeId:storeId||null, qty:li.qty, amount:amt, checked:true });
 li.status="in_cart";
 tripState.confirmStop=false; tripState.confirmUnpriced=false;
 save();
 let s=tripTotals(trip);
 if(s.crossesHardStop) toast("⛔ This cart goes past your hard stop");
}
function tripUncheck(liId){
 let trip=activeTrip(), li=listItemById(liId);
 if(!trip) return;
 trip.cart=trip.cart.filter(c=>c.listItemId!==liId);
 if(li && li.status==="in_cart") li.status="open";
 tripState.confirmStop=false;
 save();
}
function tripPrice(liId,v){
 let trip=activeTrip(); if(!trip) return;
 let c=trip.cart.find(x=>x.listItemId===liId);
 if(!c) return;
 let amt=readPrice(v);
 if(Number.isNaN(amt)){ toast("Please check the price"); return; }
 c.amount=amt;
 tripState.confirmStop=false;
 storeData();
 renderTripBar();
}

function tripAddExtra(){
 let trip=activeTrip(); if(!trip) return;
 let name=val("tripExtraName"), amt=readPrice(val("tripExtraPrice"));
 let msg=$id("tripExtraMsg");
 if(!name){ msg.innerText="Please type the item."; msg.className="form-msg err"; return; }
 if(amt===null || Number.isNaN(amt) || amt<=0){ msg.innerText="Please enter the price, for example 89."; msg.className="form-msg err"; return; }
 let m=Mdl.matchProduct(data.products,name);
 let li=Mdl.makeListItem({ name, productId:m.confidence==="high" ? m.product.id : null, qty:1, kind:"want", priority:2, storeId:val("tripExtraStore")||null, addedFrom:"trip", cycleStart:currentCycle().start },new Date().toISOString());
 li.plannedAmount=null;      // unplanned
 li.unplanned=true;
 li.status="in_cart";
 activeList().items.push(li);
 trip.cart.push({ listItemId:li.id, name, productId:li.productId, storeId:li.storeId, qty:1, amount:amt, checked:true });
 tripState.confirmStop=false;
 audit("trip.extra","Added during trip: "+name+" "+money(amt),{entity:"trips",id:trip.id});
 save();
}

function renderTripBar(){
 let bar=$id("tripBar");
 if(!bar) return;
 let trip=activeTrip();
 let show=!!trip && ui.view==="shop" && ui.sub.shop==="trip";
 bar.classList.toggle("hidden",!show);
 document.documentElement.classList.toggle("trip-on",show);
 if(!show){ bar.innerHTML=""; return; }
 let s=tripTotals(trip);
 let b=budgetNow();
 let cls=s.crossesHardStop || s.overBy>0 ? "red" : (s.stateAfter==="WARNING" ? "orange" : (s.stateAfter==="WATCH" ? "watch" : "green"));
 bar.className="trip-bar "+cls;
 bar.innerHTML=`<div class="tb-nums"><div><small>Cart · ${plural(s.items,"item")}</small><b id="tripCartTotal">${money(s.cartTotal)}</b></div>
  <div><small>Safe to spend after</small><b id="tripSafeAfter">${b.state==="SETUP" ? "—" : C.limitText(s.safeAfterRaw)}</b></div></div>
  ${s.crossesHardStop ? `<div class="tb-warn" id="tripStopWarn">⛔ Past your hard stop of ${money(data.stop)}</div>` : (s.unpriced ? `<div class="tb-warn" id="tripUnpricedWarn">🏷️ ${plural(s.unpriced,"item")} in the cart ha${s.unpriced===1 ? "s" : "ve"} no price</div>` : "")}
  <div id="tripMsg" class="form-msg" aria-live="polite"></div>
  <button class="primary" id="tripFinish" onclick="finishTrip()" ${s.items ? "" : "disabled"}>✅ FINISH · ${money(s.cartTotal)}</button>`;
}

function finishTrip(){
 let trip=activeTrip(); if(!trip) return;
 let lines=trip.cart.filter(c=>c.checked!==false);
 let msg=$id("tripMsg");
 let say=(t)=>{ if(msg){ msg.innerText=t; msg.className="form-msg err"; } };
 if(!lines.length){ say("Nothing in the cart yet."); return; }
 let unpriced=lines.filter(c=>c.amount===null || c.amount===undefined);
 if(unpriced.length){ say("Enter the price for: "+unpriced.map(c=>c.name).join(", ")+" (or take "+(unpriced.length===1 ? "it" : "them")+" out of the cart)."); return; }
 let s=tripTotals(trip);
 if(s.crossesHardStop && !tripState.confirmStop){
  say("⚠️ This trip takes spent + committed past your hard stop of "+money(data.stop)+". Tap FINISH again to record it anyway.");
  tripState.confirmStop=true; return;
 }
 let now=new Date().toISOString(), today=todayDay();
 let byStore={};
 lines.forEach(c=>{ (byStore[c.storeId||""]=byStore[c.storeId||""]||[]).push(c); });
 let entryIds=[], priceIds=[], stocked=0, spentBefore=data.spent, created=0;
 Object.keys(byStore).forEach((sid,gi)=>{
  let group=byStore[sid], st=storeById(sid);
  let amount=C.sum(group,c=>c.amount);
  let id="M"+Date.now()+"_"+gi;
  let names=group.map(c=>c.name);
  data.manual.unshift({ id, date:today, store:st ? st.name : "", item:"Shopping trip · "+plural(group.length,"item"),
   items:group.map(c=>({ name:c.name, qty:c.qty, price:c.amount })), amount, category:guessCategory(names.join(" ")+" "+(st ? st.name : "")),
   payment:"", counted:true, tripId:trip.id });
  entryIds.push(id);
  data.spent=C.round2(data.spent+amount);
  group.forEach((c,line)=>{
   let li=listItemById(c.listItemId);
   let product=c.productId ? productById(c.productId) : null;
   if(!product){ let m=Mdl.matchProduct(data.products,c.name); if(m.confidence==="high") product=m.product; }
   if(!product){
    let parsed=C.parseSize(c.name);
    product=Mdl.makeProduct({ name:c.name, size:parsed ? parsed.size : null, unit:parsed ? parsed.unit : null, packCount:parsed ? parsed.packCount : null, createdFrom:"trip", sizeSource:parsed ? "read_from_name" : null },now);
    data.products.push(product); created++;
   }
   if(c.amount>0){
    let rec={ id:Mdl.newId("price"), productId:product.id, itemName:c.name, storeId:st ? st.id : null, storeName:st ? st.name : "",
     price:C.round2(c.amount), qty:c.qty>0 ? c.qty : 1, date:today, source:"purchase", status:Mdl.PRICE_SOURCES.purchase.status,
     sourceRef:{ type:"trip", id:trip.id, entryId:id, line }, matchConfidence:"high", matchReason:"entered", needsReview:false, note:"", archived:false, createdAt:now };
    data.priceRecords.push(rec); priceIds.push(rec.id);
   }
   let inv=(li && li.inventoryItemId && invById(li.inventoryItemId)) || invForProduct(product.id) || invForName(c.name);
   if(inv && !inv.archived){
    let per=(li && li.stockPerQty) || inv.packSize || 1;
    if(changeStock(inv,(c.qty||1)*per,"trip",{ sourceRef:{ type:"trip", id:trip.id, line } })) stocked++;
    if(!inv.productId) inv.productId=product.id;
   }
   if(li){ li.status="bought"; li.boughtAt=now; li.boughtAmount=c.amount; li.boughtVia="trip"; li.productId=li.productId||product.id; }
  });
 });
 Object.assign(trip,{ status:"finished", finishedAt:now, total:s.cartTotal, entryIds, priceRecordIds:priceIds, overStopConfirmed:!!tripState.confirmStop });
 audit("trip.finish","Shopping trip finished: "+plural(lines.length,"item")+" "+money(s.cartTotal)+" · "+plural(priceIds.length,"price")+" saved to Price Book"+(stocked ? " · "+plural(stocked,"item")+" restocked" : ""),
  {entity:"trips",id:trip.id,delta:C.round2(data.spent-spentBefore),before:{spent:spentBefore},after:{spent:data.spent,entries:entryIds}});
 tripState={ confirmStop:false, confirmUnpriced:false };
 save();
 showSub("shop","list");
 toast("✅ Trip saved: "+money(s.cartTotal)+" added to Spent");
}

function cancelTrip(){
 let trip=activeTrip(); if(!trip) return;
 if(!confirm("Cancel this trip? Nothing is added to Spent; items go back on your list.")) return;
 trip.cart.forEach(c=>{ let li=listItemById(c.listItemId); if(li && li.status==="in_cart") li.status=li.addedFrom==="trip" ? "removed" : "open"; });
 trip.status="cancelled"; trip.cancelledAt=new Date().toISOString();
 audit("trip.cancel","Shopping trip cancelled (nothing recorded)",{entity:"trips",id:trip.id});
 save();
 showSub("shop","list");
}

/* =====================================================================
   SHOPPING CYCLE — planned vs actual (Budget → Cycle)
   ===================================================================== */

function pvaHTML(x,idp){
 let dir=x.direction==="under" ? `<b class="green">${money(x.saving)} under plan</b>` : (x.direction==="over" ? `<b class="red">${money(x.overspend)} over plan</b>` : "<b>on plan</b>");
 return `<div class="calc-line"><span>Planned (${plural(x.plannedCount,"item")})</span><b id="${idp}Planned">${money(x.planned)}</b></div>
  ${x.unpriced ? `<div class="field-note">${plural(x.unpriced,"planned item")} had no price, so ${x.unpriced===1 ? "it isn't" : "they aren't"} in Planned.</div>` : ""}
  <div class="calc-line"><span>Actually spent</span><b id="${idp}Actual">${money(x.actual)}</b></div>
  <div class="calc-line"><span>· on planned items</span><span id="${idp}FromPlan">${money(x.fromPlan)}</span></div>
  <div class="calc-line"><span>· not on the plan</span><span id="${idp}Unplanned">${money(x.unplanned)}</span></div>
  <div class="calc-line total"><span>Result</span><span id="${idp}Dir">${x.plannedCount || x.actual ? dir : "—"}</span></div>
  ${x.completionPct!==null ? `<div class="field-note">${x.boughtCount} of ${x.plannedCount} planned items bought (${x.completionPct}%)${x.deferredCount ? " · "+x.deferredCount+" moved to next cycle" : ""}.</div>` : ""}`;
}

function renderCycle(){
 let box=$id("cycleBody");
 if(!box) return;
 rollCycle();
 let c=cycleSettings(), r=currentCycle();
 let x=cyclePlanVsActual(r);
 let past=[];
 let pr=r;
 for(let i=0;i<3;i++){
  pr=C.shiftCycle(c,pr,-1);
  let snap=(data.shoppingCycles||[]).find(s=>s.start===pr.start);
  past.push({ r:pr, x:snap || cyclePlanVsActual(pr), frozen:!!snap });
 }
 let s=invSettings();
 box.innerHTML=`<div class="card" id="cycleCard"><div class="card-head"><h3 class="card-title">🔁 This shopping cycle</h3><b id="cycleRange">${esc(cycleLabel(r))}</b></div>
   <div class="field-note">Day ${r.dayNumber} of ${r.lengthDays} · ${plural(r.daysLeft,"day")} left${r.daysLeft===0 ? " (last day)" : ""}</div>
   <div class="bar"><span class="u-safe" style="width:${Math.round(r.dayNumber/r.lengthDays*100)}%"></span></div>
   ${pvaHTML(x,"cy")}
   <button class="action wide" onclick="showSub('shop','list')">📝 Open shopping list</button></div>
  <div class="card" id="pastCycles"><h3 class="card-title">🗓️ Previous cycles</h3>
   ${past.map(p=>`<details><summary>${esc(cycleLabel(p.r))} · planned ${money(p.x.planned)} · spent ${money(p.x.actual)}</summary>${pvaHTML(p.x,"pc")}${p.frozen ? '<div class="field-note">Saved when the cycle ended.</div>' : ""}</details>`).join("")}</div>
  <div class="card" id="cycleSettingsCard"><h3 class="card-title">⚙️ Cycle settings</h3>
   <div class="seg" id="cyMode"><button type="button" data-mode="days" class="${c.mode!=="semimonthly" ? "on" : ""}" onclick="setSeg('cyMode',this);cyModeChanged()">Every N days</button><button type="button" data-mode="semimonthly" class="${c.mode==="semimonthly" ? "on" : ""}" onclick="setSeg('cyMode',this);cyModeChanged()">Twice a month (1–15, 16–end)</button></div>
   <div id="cyDaysBox" class="two"><div><label for="cyLength">Days per cycle</label><input id="cyLength" inputmode="numeric" autocomplete="off" value="${esc(String(c.lengthDays||15))}"></div>
   <div><label for="cyAnchor">A cycle starts on</label><input id="cyAnchor" type="date" value="${esc(c.anchorDate||"")}"></div></div>
   <h3 class="card-title">🔔 Stock alerts</h3>
   <div class="two"><div><label for="cyLow">Low when under (days)</label><input id="cyLow" inputmode="numeric" value="${s.lowDays}"></div><div><label for="cyUrgent">Urgent when under (days)</label><input id="cyUrgent" inputmode="numeric" value="${s.urgentDays}"></div></div>
   <div class="two"><div><label for="cySoon">Expiry warning (days before)</label><input id="cySoon" inputmode="numeric" value="${s.expirySoonDays}"></div><div><label for="cyBuffer">Extra days when reordering</label><input id="cyBuffer" inputmode="numeric" value="${s.bufferDays}"></div></div>
   <div id="cycleMsg" class="form-msg" aria-live="polite"></div>
   <button class="action wide" id="cySave" onclick="saveCycleSettings()">💾 Save settings</button></div>`;
 cyModeChanged();
}

function cyModeChanged(){ let b=$id("cyDaysBox"); if(b) b.classList.toggle("hidden",segVal("cyMode","mode")==="semimonthly"); }

function saveCycleSettings(){
 let msg=$id("cycleMsg");
 let mode=segVal("cyMode","mode")==="semimonthly" ? "semimonthly" : "days";
 let next={ mode, lengthDays:mode==="days" ? C.num(val("cyLength")) : (cycleSettings().lengthDays||15), anchorDate:mode==="days" ? val("cyAnchor") : (cycleSettings().anchorDate||Mdl.firstOfMonth(todayDay())) };
 let v=C.validateCycle(next);
 let nums=["cyLow","cyUrgent","cySoon","cyBuffer"].map(id=>C.num(val(id)));
 let errs=v.errors.slice();
 if(nums.some(n=>n===null || n<0 || Math.floor(n)!==n || n>90)) errs.push("Alert days must be whole numbers from 0 to 90.");
 else if(!(nums[1]<nums[0])) errs.push("Urgent days must be fewer than Low days.");
 if(errs.length){ msg.innerText=errs.join(" "); msg.className="form-msg err"; return; }
 let before={ cycle:Mdl.clone(cycleSettings()), inventory:invSettings() };
 data.settings.cycle=next;
 data.settings.inventory=Object.assign({},invSettings(),{ lowDays:nums[0], urgentDays:nums[1], expirySoonDays:nums[2], bufferDays:nums[3] });
 audit("settings.cycle","Cycle settings: "+(mode==="days" ? "every "+next.lengthDays+" days from "+next.anchorDate : "twice a month")+" · low < "+nums[0]+" days, urgent < "+nums[1],{entity:"settings",before,after:{cycle:next,inventory:data.settings.inventory}});
 save();
 toast("✅ Cycle settings saved");
}

/* =====================================================================
   RECEIPTS → products, inventory, lists (matching with confidence)
   ===================================================================== */

function feedReceiptLine(rec,receipt){
 let out={ stocked:0, listBought:0 };
 if(!rec || rec.archived || (rec.needsReview && rec.matchConfidence==="review")) return out;   // uncertain lines wait for a check
 let ref={ type:"receipt", id:rec.sourceRef && rec.sourceRef.id, line:rec.sourceRef && rec.sourceRef.line };
 let p=productById(rec.productId);
 let inv=invForProduct(rec.productId) || (p && invForName(p.name));
 let already=(data.inventoryTransactions||[]).some(t=>t.sourceRef && t.sourceRef.type==="receipt" && t.sourceRef.id===ref.id && t.sourceRef.line===ref.line);
 if(inv && !already){
  if(changeStock(inv,(C.num(rec.qty)>0 ? C.num(rec.qty) : 1)*(inv.packSize||1),"receipt",{ sourceRef:ref })) out.stocked++;
  if(!inv.productId) inv.productId=rec.productId;
 }
 let li=openListItems().find(x=>sameThing(x,rec.productId,p ? p.name : rec.itemName,inv ? inv.id : null) || Mdl.normalizeName(x.name)===Mdl.normalizeName(rec.itemName));
 if(li){
  li.status="bought"; li.boughtAt=new Date().toISOString(); li.boughtAmount=C.round2(rec.price); li.boughtVia="receipt"; li.productId=li.productId||rec.productId;
  let trip=activeTrip(); if(trip) trip.cart=trip.cart.filter(c=>c.listItemId!==li.id);
  out.listBought++;
 }
 return out;
}

// Called by confirmReceipt() after prices were learned.
function feedReceipt(receipt){
 let out={ stocked:0, listBought:0 };
 (data.priceRecords||[]).filter(r=>r.sourceRef && r.sourceRef.type==="receipt" && r.sourceRef.id===receipt.id && !r.archived)
  .forEach(r=>{ let x=feedReceiptLine(r,receipt); out.stocked+=x.stocked; out.listBought+=x.listBought; });
 return out;
}

function reviewRecords(){
 return (data.priceRecords||[]).filter(r=>!r.archived && r.needsReview && r.sourceRef && r.sourceRef.type==="receipt");
}

function receiptMatchSummary(rc){
 let recs=(data.priceRecords||[]).filter(r=>r.sourceRef && r.sourceRef.type==="receipt" && r.sourceRef.id===rc.id && !r.archived);
 if(!recs.length) return "";
 let n=k=>recs.filter(r=>(r.needsReview ? r.matchConfidence : "high")===k).length;
 return `<small class="match-sum">Matched: ✅ ${n("high")} · 🔎 ${n("review")} · ❔ ${n("unknown")}${rc.duplicateOf ? ' · <span class="red">possible duplicate</span>' : ""}</small>`;
}

function reviewRowHTML(r){
 let p=productById(r.productId);
 let conf=Mdl.MATCH_CONFIDENCE[r.matchConfidence]||Mdl.MATCH_CONFIDENCE.unknown;
 let isReview=r.matchConfidence==="review";
 return `<div class="review-row" data-rec="${esc(r.id)}">
  <div><span class="state conf-${esc(r.matchConfidence)}">${conf.icon} ${esc(conf.label)}</span> <b>${esc(r.itemName)}</b>
  <small class="muted">${esc(r.storeName||"")}${r.date ? " · "+esc(shortDay(r.date)) : ""} · ${money(r.price)}${C.num(r.qty)>1 ? " for "+qtyText(r.qty) : ""}</small>
  <small>${isReview ? "Looks like: <b>"+esc(p ? productTitle(p) : "?")+"</b>"+(r.matchReason==="different_size" ? " <span class='orange'>(different size?)</span>" : "") : "Added as a new product"}</small></div>
  <div class="btn-row review-actions">
   <button class="mini ok" data-act="confirm" onclick="reviewConfirm('${esc(r.id)}')">✅ ${isReview ? "Same product" : "Looks right"}</button>
   <button class="mini" data-act="choose" onclick="reviewChoose('${esc(r.id)}')">🔁 ${isReview ? "Other product" : "Same as…"}</button>
   ${isReview ? `<button class="mini" data-act="new" onclick="reviewNew('${esc(r.id)}')">➕ New product</button>` : ""}
   <button class="mini" data-act="notproduct" onclick="reviewNotProduct('${esc(r.id)}')">🚫 Not a product</button>
  </div></div>`;
}

function renderReceiptReview(){
 let box=$id("receiptReview");
 if(!box) return;
 let recs=reviewRecords();
 if(!recs.length){ box.innerHTML=""; return; }
 let rv=recs.filter(r=>r.matchConfidence==="review"), un=recs.filter(r=>r.matchConfidence!=="review");
 box.innerHTML=`<div class="card review-card" id="reviewCard"><div class="card-head"><b>🔎 Receipt matches</b><small class="muted">${rv.length} to check${un.length ? " · "+un.length+" new" : ""}</small></div>
  ${rv.length ? `<div class="field-note">These names look like products you already have but don't match exactly. Confirm once and Jason Shop remembers the name. Their prices stay out of comparisons until checked.</div>${rv.map(reviewRowHTML).join("")}` : '<div class="field-note">✅ No uncertain matches.</div>'}
  ${un.length ? `<details id="reviewNew"${rv.length ? "" : " open"}><summary>🆕 ${plural(un.length,"new product")} from receipts — check the names (optional)</summary>
   <div class="field-note">These were added as new products. Their prices already count; link one to an existing product if it's the same thing.</div>${un.map(reviewRowHTML).join("")}</details>` : ""}</div>`;
}

function recById(id){ return (data.priceRecords||[]).find(r=>r.id===id) || null; }
function receiptOf(rec){ return rec && rec.sourceRef ? data.receipts.find(x=>x.id===rec.sourceRef.id) || null : null; }

function addAlias(p,name){
 if(!p || !name) return;
 if(!Array.isArray(p.aliases)) p.aliases=[];
 let n=Mdl.normalizeName(name);
 if(Mdl.normalizeName(p.name)!==n && !p.aliases.some(a=>Mdl.normalizeName(a)===n)) p.aliases.push(name);
}

// An auto-created product that nothing else uses is archived (never deleted).
function retireOrphan(productId,reason){
 let p=productById(productId);
 if(!p || p.createdFrom!=="receipt") return;
 if(priceRecordsForAll(productId).some(r=>!r.archived) || invForProduct(productId) || openListItems().some(li=>li.productId===productId)) return;
 p.archived=true; p.archivedReason=reason; p.archivedAt=new Date().toISOString();
}
function priceRecordsForAll(pid){ return (data.priceRecords||[]).filter(r=>r.productId===pid); }

function markReviewed(rec,how){
 rec.needsReview=false; rec.matchConfidence="high"; rec.matchReason=how; rec.reviewedAt=new Date().toISOString();
 let x=feedReceiptLine(rec,receiptOf(rec));
 return x;
}

function reviewConfirm(id){
 let rec=recById(id); if(!rec) return;
 let p=productById(rec.productId);
 let wasReview=rec.matchConfidence==="review";
 if(wasReview) addAlias(p,rec.itemName);
 let x=markReviewed(rec,wasReview ? "confirmed" : "kept_new");
 if(p) p.needsReview=false;
 audit("receipt.match",(wasReview ? "Confirmed \""+rec.itemName+"\" is "+productTitle(p)+" (name remembered)" : "Kept \""+rec.itemName+"\" as a new product")+(x.stocked ? " · restocked" : ""),{entity:"priceRecords",id:rec.id});
 save();
 toast("✅ "+(wasReview ? "Matched — I'll remember this name" : "Kept as a new product"));
}

function reviewChoose(id){
 let rec=recById(id); if(!rec) return;
 sheetState={ recId:id };
 openSheet(`<h2>Which product is it?</h2><p class="muted">Receipt line: <b>${esc(rec.itemName)}</b> · ${money(rec.price)}</p>
  <label for="rvProduct">Product</label><select id="rvProduct">${productSelectOptions(rec.matchConfidence==="review" ? rec.productId : "").replace('<option value="">— not linked —</option>','<option value="">— pick one —</option>')}</select>
  <div id="sheetMsg" class="form-msg" aria-live="polite"></div>
  <button class="primary" id="rvSave" onclick="reviewChooseSave()">✅ USE THIS PRODUCT</button>
  <button class="action wide" onclick="closeSheet()">Cancel</button>`);
}

function reviewChooseSave(){
 let rec=recById(sheetState.recId); if(!rec){ closeSheet(); return; }
 let p=productById(val("rvProduct"));
 if(!p){ sheetMsg("Pick a product."); return; }
 let old=rec.productId;
 rec.productId=p.id;
 addAlias(p,rec.itemName);
 markReviewed(rec,"chosen");
 if(old!==p.id) retireOrphan(old,"merged into "+productTitle(p));
 audit("receipt.match","Linked \""+rec.itemName+"\" to "+productTitle(p)+" (name remembered)",{entity:"priceRecords",id:rec.id,before:{productId:old},after:{productId:p.id}});
 closeSheet(); save();
 toast("✅ Linked to "+productTitle(p));
}

function reviewNew(id){
 let rec=recById(id); if(!rec) return;
 let now=new Date().toISOString();
 let parsed=C.parseSize(rec.itemName);
 let p=Mdl.makeProduct({ name:rec.itemName, size:parsed ? parsed.size : null, unit:parsed ? parsed.unit : null, packCount:parsed ? parsed.packCount : null, createdFrom:"receipt", sizeSource:parsed ? "read_from_name" : null },now);
 data.products.push(p);
 let old=rec.productId;
 rec.productId=p.id;
 markReviewed(rec,"new_product");
 audit("receipt.match","\""+rec.itemName+"\" saved as a new product (not "+productTitle(productById(old)||{name:"?"})+")",{entity:"products",id:p.id});
 save();
 toast("➕ New product: "+rec.itemName);
}

function reviewNotProduct(id){
 let rec=recById(id); if(!rec) return;
 rec.archived=true; rec.archivedReason="not_a_product"; rec.archivedAt=new Date().toISOString(); rec.needsReview=false;
 retireOrphan(rec.productId,"not a product");
 audit("receipt.match","\""+rec.itemName+"\" marked as not a product (price ignored)",{entity:"priceRecords",id:rec.id});
 save();
}

/* =====================================================================
   HOME cards & command-bar answers
   ===================================================================== */

function homeCards2(){
 let out=[];
 let trip=activeTrip();
 if(trip){
  let s=tripTotals(trip);
  out.push(`<div class="card trip-home" id="homeTrip"><div class="card-head"><b>🛒 Shopping trip in progress</b><button class="link" onclick="showSub('shop','trip')">Resume</button></div>
   <div class="muted">${plural(s.items,"item")} in cart · ${money(s.cartTotal)} · Safe to spend after: ${C.limitText(s.safeAfterRaw)}</div></div>`);
 }
 let items=invItems();
 if(items.length){
  let A=inventoryAlerts();
  let top=A.low.slice(0,4);
  let exp=A.expiring.slice(0,3);
  out.push(`<div class="card" id="homeAlerts"><div class="card-head"><b>📦 Home stock</b><button class="link" onclick="goTo('inventory')">Open</button></div>
   ${A.low.length || exp.length ? `${top.map(x=>`<div class="row-line"><span>${esc(x.it.name)} <small class="muted">${esc(daysText(x.info))}</small></span>${invBadge(x.info.st.state)}</div>`).join("")}
    ${exp.map(x=>`<div class="row-line"><span>${esc(x.it.name)}</span>${expiryBadge(x.info.exp)}</div>`).join("")}
    ${A.low.length>top.length ? `<div class="field-note">+${A.low.length-top.length} more running low</div>` : ""}
    ${A.low.some(x=>!onActiveList(x.it.productId,x.it.name,x.it.id)) ? `<button class="action wide" id="homeAddLow" onclick="addLowToList()">📝 Add low items to list</button>` : ""}` : `<div class="muted">✅ All ${plural(items.length,"item")} well stocked.</div>`}</div>`);
 }else{
  out.push(emptyState("📦","Track your home stock","Add pantry, fridge and storeroom items to get low-stock and expiry alerts before you run out.",`<button class="action" onclick="goTo('inventory')">Open inventory</button>`));
 }
 let r=currentCycle(), x=cyclePlanVsActual(r);
 let open=openListItems();
 let t=C.listTotals(open.map(li=>({ kind:li.kind, amount:itemEstimate(li).amount, status:"open" })));
 out.push(`<div class="card" id="homeCycle"><div class="card-head"><b>🔁 Cycle ${esc(cycleLabel(r))}</b><button class="link" onclick="goTo('cycle')">Details</button></div>
  <div class="muted">Day ${r.dayNumber} of ${r.lengthDays} · ${plural(r.daysLeft,"day")} left</div>
  <div class="row-line"><span>Planned / spent this cycle</span><b>${money(x.planned)} / ${money(x.actual)}</b></div>
  <div class="row-line"><span>📝 List: ${t.needCount} need${t.needCount===1?"":"s"}, ${t.wantCount} want${t.wantCount===1?"":"s"}</span><b>${money(t.total)}${t.unpriced ? "*" : ""}</b></div>
  ${t.unpriced ? `<div class="field-note">* ${plural(t.unpriced,"item")} without a price yet</div>` : ""}
  <button class="action wide" onclick="goTo('lists')">📝 Open shopping list</button></div>`);
 let rv=reviewRecords().filter(r=>r.matchConfidence==="review").length;
 if(rv) out.push(`<div class="card tap-lite" id="homeReview" onclick="goTo('review')"><div class="card-head"><b>🔎 ${plural(rv,"receipt line")} to check</b><span class="link">Review</span></div><div class="muted">Confirm names once so prices and stock stay accurate.</div></div>`);
 return out;
}

function localAnswer2(text){
 let t=text.toLowerCase();
 if(/what('?s| is| are)? (running )?(low|out)|running low|low (stock|items)|anong (kulang|ubos)|what should i (buy|restock)/.test(t)){
  let items=invItems();
  if(!items.length) return "📦 You're not tracking home stock yet. Open the Inventory tab and add items to get low-stock alerts.";
  let A=inventoryAlerts();
  if(!A.low.length) return "✅ Nothing is running low. All "+plural(items.length,"tracked item")+" have enough for now.";
  return "📦 Running low: "+A.low.slice(0,8).map(x=>`<b>${esc(x.it.name)}</b> (${esc(C.INVENTORY_STATES[x.info.st.state].label.toLowerCase())}${x.info.st.days!==null && x.info.st.state!=="OUT" ? ", ~"+Math.floor(x.info.st.days)+" days" : ""})`).join(", ")+".";
 }
 let m=/do (?:i|we) (?:still )?need(?: to buy)? (?:more |any |some )?(.+?)\??$/.exec(t) || /kailangan (?:ko|namin|ba) (?:ng|pa ng) (.+?)\??$/.exec(t);
 if(m){
  let q=Mdl.normalizeName(m[1]);
  let it=invItems().find(i=>Mdl.normalizeName(i.name)===q) || invItems().find(i=>Mdl.normalizeName(i.name).includes(q) || q.includes(Mdl.normalizeName(i.name)));
  let listed=openListItems().find(li=>Mdl.normalizeName(li.name).includes(q));
  if(!it) return listed ? `📝 <b>${esc(listed.name)}</b> is already on your shopping list.` : `❔ I don't track "${esc(m[1])}" in your inventory yet, so I can't tell. Add it in the Inventory tab.`;
  let info=itemInfo(it);
  let state=info.st.state;
  let yes=["OUT","URGENT","LOW"].includes(state);
  return `${C.INVENTORY_STATES[state].icon} <b>${yes ? "Yes" : (state==="OK" ? "Not yet" : "Not sure")}.</b> ${esc(it.name)}: ${qtyText(it.quantity)} ${esc(it.unit)} at home${info.st.days!==null ? ", about "+Math.floor(info.st.days)+" days' supply" : ""}.${onActiveList(it.productId,it.name,it.id) ? " It's already on your list." : (yes && info.re.qty>0 ? " Suggested: buy "+qtyText(info.re.packs)+"." : "")}`;
 }
 return null;
}

/* ---------- render hook (called from renderActiveView) ---------- */

function renderStage2Active(){
 if(ui.view==="shop"){
  if(ui.sub.shop==="trip") renderTrip();
  if(ui.sub.shop==="receipts") renderReceiptReview();
 }
 if(ui.view==="budget" && ui.sub.budget==="cycle") renderCycle();
 renderTripBar();
}
