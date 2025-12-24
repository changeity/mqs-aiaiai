/* Marquis AI & Automation Opportunity Explorer
   - Static SPA, no external dependencies
   - Dataset-driven: data.json is the source of truth
*/

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

const state = {
  data: null,
  route: "overview",
  execMode: false,
  search: "",
  filters: {
    domainIds: new Set(),
    metricTypes: new Set(),
    complexities: new Set(),
    patterns: new Set(),
    deploymentHints: new Set(),
    onlyTop: false,
    onlyOpportunities: false,
  },
  selectedDomainId: null,
  selectedUseCaseId: null,
  selectedWorkflowId: null,
};

function escapeHTML(str){
  if (str === null || str === undefined) return "";
  return String(str)
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}

function normalize(str){ return (str||"").toLowerCase(); }

function uniq(arr){ return Array.from(new Set(arr)); }

function parseRoute(){
  const h = (location.hash || "#/overview").replace("#/","");
  const parts = h.split("?"); // route?params
  const route = parts[0] || "overview";
  const params = new URLSearchParams(parts[1] || "");
  return { route, params };
}

function setActiveNav(route){
  $$(".nav-item").forEach(a=>{
    a.classList.toggle("active", a.dataset.route === route);
  });
}

function showModal(title, bodyHtml){
  $("#modalTitle").textContent = title || "";
  $("#modalBody").innerHTML = bodyHtml || "";
  $("#modal").classList.remove("hidden");
  document.body.style.overflow = "hidden";
}
function hideModal(){
  $("#modal").classList.add("hidden");
  document.body.style.overflow = "";
}

function badge(label, kind){
  const cls = kind ? `badge ${kind}` : "badge";
  return `<span class="${cls}">${escapeHTML(label)}</span>`;
}

function keyValueRows(rows){
  return rows.map(([k,v]) => `
    <div class="kv">
      <div class="k">${escapeHTML(k)}</div>
      <div class="v">${v || '<span class="smalltext">Not stated in source</span>'}</div>
    </div>
  `).join("");
}

function downloadText(filename, text, mime="text/plain"){
  const blob = new Blob([text], {type: mime});
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function downloadSVGAsFile(svgEl, filename){
  const serializer = new XMLSerializer();
  let source = serializer.serializeToString(svgEl);
  if(!source.match(/^<svg[^>]+xmlns="http\:\/\/www\.w3\.org\/2000\/svg"/)){
    source = source.replace(/^<svg/, '<svg xmlns="http://www.w3.org/2000/svg"');
  }
  const blob = new Blob([source], {type:"image/svg+xml;charset=utf-8"});
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function copyToClipboard(text){
  return navigator.clipboard.writeText(text);
}

function buildOptions(){
  const d = state.data;
  const domainCounts = {};
  d.usecases.forEach(uc=>{
    if(uc.domain_id){
      domainCounts[uc.domain_id] = (domainCounts[uc.domain_id]||0) + 1;
    }
  });
  const metricTypes = uniq(d.usecases.map(u=>u.metric_type).filter(Boolean)).sort();
  const complexities = uniq(d.usecases.map(u=>u.complexity).filter(Boolean)).sort();
  const deploymentHints = uniq(d.usecases.map(u=>u.derived?.deployment_hint).filter(Boolean)).sort();
  const patterns = uniq(d.usecases.flatMap(u=>u.derived?.patterns || [])).sort();

  return { domainCounts, metricTypes, complexities, deploymentHints, patterns };
}

function renderSidebar(options){
  // Domains list
  const list = $("#domainList");
  list.innerHTML = "";
  state.data.domains.forEach(dom=>{
    const count = options.domainCounts[dom.id] || 0;
    const active = (state.selectedDomainId === dom.id) ? "active" : "";
    const chip = document.createElement("div");
    chip.className = `domain-chip ${active}`;
    chip.innerHTML = `
      <div>
        <div class="name">${escapeHTML(dom.name)}</div>
        <div class="smalltext">${count} items</div>
      </div>
      <div class="count">›</div>
    `;
    chip.onclick = ()=>{
      state.selectedDomainId = dom.id;
      // also add as filter in Explore
      state.filters.domainIds = new Set([dom.id]);
      navigate(state.route); // rerender
    };
    list.appendChild(chip);
  });

  // Quick filters
  const q = $("#quickFilters");
  q.innerHTML = "";

  const makeToggle = (id, label, get, set) => {
    const wrap = document.createElement("label");
    wrap.className = "toggle";
    const inp = document.createElement("input");
    inp.type = "checkbox";
    inp.checked = !!get();
    inp.onchange = ()=>{ set(inp.checked); navigate(state.route); };
    const span = document.createElement("span");
    span.textContent = label;
    wrap.appendChild(inp); wrap.appendChild(span);
    return wrap;
  };

  q.appendChild(makeToggle("onlyTop","Top opportunities", ()=>state.filters.onlyTop, v=>state.filters.onlyTop=v));
  q.appendChild(makeToggle("onlyOpps","Opportunities only", ()=>state.filters.onlyOpportunities, v=>state.filters.onlyOpportunities=v));

  const resetBtn = document.createElement("button");
  resetBtn.className = "btn subtle";
  resetBtn.textContent = "Reset filters";
  resetBtn.onclick = ()=>{
    state.filters = {domainIds:new Set(), metricTypes:new Set(), complexities:new Set(), patterns:new Set(), deploymentHints:new Set(), onlyTop:false, onlyOpportunities:false};
    state.selectedDomainId = null;
    state.selectedUseCaseId = null;
    state.selectedWorkflowId = null;
    $("#globalSearch").value = "";
    state.search = "";
    navigate(state.route);
  };
  q.appendChild(resetBtn);
}

function filterUseCases(){
  const d = state.data;
  const s = normalize(state.search);
  const f = state.filters;

  let items = d.usecases.slice();

  // Executive mode: default to opportunities
  if(state.execMode && !f.onlyOpportunities){
    // doesn't force, but suggests: keep all, UI will group.
  }

  if(f.onlyTop){
    const top = new Set(d.indexes.top_opportunity_ids || []);
    items = items.filter(u=>top.has(u.id) || u.item_level === "Opportunity");
  }
  if(f.onlyOpportunities){
    items = items.filter(u=>u.item_level === "Opportunity");
  }

  if(f.domainIds.size){
    items = items.filter(u=>u.domain_id && f.domainIds.has(u.domain_id));
  }
  if(f.metricTypes.size){
    items = items.filter(u=>u.metric_type && f.metricTypes.has(u.metric_type));
  }
  if(f.complexities.size){
    items = items.filter(u=>u.complexity && f.complexities.has(u.complexity));
  }
  if(f.deploymentHints.size){
    items = items.filter(u=>u.derived?.deployment_hint && f.deploymentHints.has(u.derived.deployment_hint));
  }
  if(f.patterns.size){
    items = items.filter(u=>{
      const ps = new Set(u.derived?.patterns || []);
      for(const p of f.patterns) if(ps.has(p)) return true;
      return false;
    });
  }

  if(s){
    items = items.filter(u=>{
      const blob = [
        u.name, u.domain, u.summary, u.primary_outcome, u.metric_type, u.dependencies,
        u.vendors_tools, u.risks_compliance, (u.derived?.patterns||[]).join(" ")
      ].map(x=>String(x||"")).join(" ").toLowerCase();
      return blob.includes(s);
    });
  }

  return items;
}

function renderOverview(){
  const d = state.data;
  const options = buildOptions();
  const selectedDomain = state.selectedDomainId ? d.domains.find(x=>x.id===state.selectedDomainId) : null;

  const explainer = `
    <div class="hero">
      <h1>Start here: what this is</h1>
      <p>
        This page is a clickable, leadership-friendly map of where Marquis can simplify, standardize, and automate work across departments.
        It separates <b>Automation</b> (moving work automatically) from <b>AI</b> (handling unstructured information or judgment-heavy tasks),
        and shows what’s needed to scale: data/integration, governance, security/privacy, monitoring, and change management.
      </p>
    </div>

    <div class="grid">
      <div class="card">
        <h3>Automation</h3>
        <p>Workflow + rules + integrations that eliminate retyping, chasing, and manual routing.</p>
        <div class="example">Example: OCR + routing for inbound docs → auto-create tasks → human approves exceptions.</div>
      </div>
      <div class="card">
        <h3>AI</h3>
        <p>Models that read, summarize, classify, extract, transcribe, or predict — used where data is messy or unstructured.</p>
        <div class="example">Example: Speech-to-text for notes with verification; RAG for policy lookup (search + summary only).</div>
      </div>
      <div class="card">
        <h3>Local vs Vendor</h3>
        <p>Some capabilities can run self-hosted; others can be purchased. This app shows what is explicitly mentioned in the source.</p>
        <div class="example">If the source does not state it, the UI will say “Not stated in source.”</div>
      </div>
    </div>
  `;

  // One-page map (interactive)
  const foundations = d.foundations.filter(f=>String(f.area).includes("data hub") || String(f.area).includes("governance") || String(f.area).includes("security") || String(f.area).includes("monitoring") || String(f.area).includes("change"));
  const opportunityNodes = d.usecases.filter(u=>u.item_level==="Opportunity");

  const domainCards = d.domains.map(dom=>{
    const isActive = selectedDomain && selectedDomain.id===dom.id;
    const count = options.domainCounts[dom.id] || 0;
    const cls = isActive ? "domain-chip active" : "domain-chip";
    return `<div class="${cls}" data-dom="${dom.id}">
      <div>
        <div class="name">${escapeHTML(dom.name)}</div>
        <div class="smalltext">${count} items</div>
      </div>
      <div class="count">›</div>
    </div>`;
  }).join("");

  const rightContent = selectedDomain ? renderDomainFocus(selectedDomain) : `
    <div class="smalltext">
      Click a domain to expand its opportunities. This prevents the “hairball chart” problem while keeping everything one-click away.
    </div>
    <div class="pillrow">
      ${badge(`${opportunityNodes.length} major opportunity areas`, "good")}
      ${badge(`${d.usecases.length} total items`, "")}
      ${badge(`${d.workflows.length} workflows`, "")}
    </div>
  `;

  const map = `
    <div class="section">
      <h2>One-page opportunity map</h2>
      <div class="sub">Foundations → Domains → Opportunities → Outcomes/Metrics (click to drill down)</div>
      <div class="grid">
        <div class="section" style="grid-column: span 3">
          <h2 style="font-size:14px;margin-bottom:8px">Foundations</h2>
          ${foundations.map(f=>`
            <div class="domain-chip" data-found="${escapeHTML(f.id)}">
              <div>
                <div class="name">${escapeHTML(f.area)}</div>
                <div class="smalltext">${escapeHTML((f.summary||"").slice(0,110))}${(f.summary||"").length>110?"…":""}</div>
              </div>
              <div class="count">›</div>
            </div>
          `).join("")}
        </div>
        <div class="section" style="grid-column: span 4">
          <h2 style="font-size:14px;margin-bottom:8px">Domains</h2>
          <div class="domain-list">${domainCards}</div>
        </div>
        <div class="section" style="grid-column: span 5">
          <h2 style="font-size:14px;margin-bottom:8px">${selectedDomain ? escapeHTML(selectedDomain.name) : "Select a domain"}</h2>
          ${rightContent}
        </div>
      </div>
    </div>
  `;

  return `<div class="page">${explainer}${map}</div>`;
}

function renderDomainFocus(domain){
  const d = state.data;
  const items = d.usecases.filter(u=>u.domain_id===domain.id);
  const opp = items.filter(u=>u.item_level==="Opportunity");
  const others = items.filter(u=>u.item_level!=="Opportunity");

  const top = opp.length ? opp : items.filter(u=>u.rank).slice().sort((a,b)=> (Number(a.rank)||999)-(Number(b.rank)||999)).slice(0,8);
  const cards = top.map(u=>useCaseCard(u)).join("");

  const desc = domain.description ? `<div class="pre">${escapeHTML(domain.description)}</div>` : `<div class="smalltext">No domain description stated in source.</div>`;

  return `
    <div class="pillrow">
      ${badge(`${items.length} items in this domain`, "good")}
      ${badge(`${opp.length} major opportunity area(s)`, "")}
    </div>
    ${desc}
    <div style="height:10px"></div>
    <div class="grid">
      ${cards || `<div class="smalltext">No items found for this domain.</div>`}
    </div>
    <div style="margin-top:12px">
      <button class="btn primary" data-action="exploreDomain" data-dom="${domain.id}">Explore this domain →</button>
    </div>
  `;
}

function useCaseCard(u){
  const patterns = (u.derived?.patterns || []);
  const quant = u.derived?.quant_claim_count || 0;
  const complexity = u.complexity || "Not stated";
  const mtype = u.metric_type || "Not stated";
  const tt = u.time_to_value || "Not stated";
  const dep = u.derived?.deployment_hint || "Not specified";

  return `
    <div class="card" style="grid-column: span 6" data-uc="${u.id}">
      <h3>${escapeHTML(u.name || "(Untitled)")}</h3>
      <p>${escapeHTML(u.summary || "Not stated in source")}</p>
      <div class="pillrow" style="margin-top:10px">
        ${badge(`Outcome: ${u.primary_outcome || "Not stated"}`, "")}
        ${badge(`Metric type: ${mtype}`, "")}
        ${badge(`Complexity: ${complexity}`, complexity==="High"?"bad":(complexity==="Low"?"good":"warn"))}
        ${badge(`Time-to-value: ${tt}`, "")}
      </div>
      <div class="pillrow" style="margin-top:10px">
        ${patterns.slice(0,4).map(p=>badge(p,"")).join("")}
        ${patterns.length>4 ? badge(`+${patterns.length-4} more`,"") : ""}
        ${badge(`Quantified claims: ${quant}`, quant? "good" : "")}
        ${badge(dep, dep.includes("Self") ? "good": "")}
      </div>
      <div class="smalltext" style="margin-top:10px">Evidence: ${escapeHTML(u.source?.doc||"")} • ${escapeHTML(u.source?.ref||"")}</div>
      <div style="margin-top:10px"><button class="btn" data-action="openUC" data-uc="${u.id}">Open details</button></div>
    </div>
  `;
}

function renderExplore(){
  const d = state.data;
  const options = buildOptions();
  const items = filterUseCases();

  const filterBlock = renderFilterBlock(options);

  const rows = items.map(u=>{
    const patterns = (u.derived?.patterns || []).slice(0,3).join(", ") || "—";
    const quant = u.derived?.quant_claim_count || 0;
    const complexity = u.complexity || "—";
    const tt = u.time_to_value || "—";
    const dep = u.derived?.deployment_hint || "—";
    return `
      <tr data-uc="${u.id}">
        <td><div class="cell-title">${escapeHTML(u.name||"")}</div><div class="smalltext">${escapeHTML(u.domain||"")}</div></td>
        <td>${escapeHTML(u.primary_outcome||"—")}</td>
        <td>${escapeHTML(u.metric_type||"—")}</td>
        <td>${escapeHTML(complexity)}</td>
        <td>${escapeHTML(tt)}</td>
        <td>${escapeHTML(patterns)}</td>
        <td>${quant ? badge(String(quant),"good") : badge("0","")}</td>
        <td>${escapeHTML(dep)}</td>
      </tr>
    `;
  }).join("");

  const table = `
    <div class="section">
      <h2>Portfolio explorer</h2>
      <div class="sub">Filter, search, and click any row to open the full detail view (with source references).</div>
      ${filterBlock}
      <div class="pillrow" style="margin:10px 0 0 0">
        ${badge(`${items.length} matching items`, "good")}
        ${state.filters.onlyTop ? badge("Top opportunities filter ON","") : ""}
        ${state.filters.onlyOpportunities ? badge("Opportunities only filter ON","") : ""}
      </div>
      <div class="tablewrap" style="margin-top:10px">
        <table>
          <thead>
            <tr>
              <th>Item</th>
              <th>Primary outcome</th>
              <th>Metric type</th>
              <th>Complexity</th>
              <th>Time-to-value</th>
              <th>Patterns</th>
              <th>Quantified claims</th>
              <th>Local/Vendor hint</th>
            </tr>
          </thead>
          <tbody>${rows || `<tr><td colspan="8" class="smalltext">No matches. Try clearing filters.</td></tr>`}</tbody>
        </table>
      </div>
    </div>
  `;

  return `<div class="page">${table}</div>`;
}

function renderFilterBlock(options){
  // Multi-select checklists
  const mkChecklist = (title, values, setRef, formatter=(x)=>x) => {
    if(!values.length) return "";
    const items = values.map(v=>{
      const id = `${title}-${v}`.replaceAll(/\s+/g,"_");
      const checked = setRef.has(v) ? "checked" : "";
      return `<label class="toggle" style="gap:10px">
        <input type="checkbox" data-filter="${escapeHTML(title)}" data-value="${escapeHTML(v)}" ${checked}/>
        <span>${escapeHTML(formatter(v))}</span>
      </label>`;
    }).join("");
    return `
      <div class="section" style="padding:12px">
        <div class="panel-title">${escapeHTML(title)}</div>
        <div class="panel-body" style="max-height:220px; overflow:auto">${items}</div>
      </div>
    `;
  };

  const domValues = state.data.domains.map(d=>({id:d.id, name:d.name})).sort((a,b)=>a.name.localeCompare(b.name));
  const domItems = domValues.map(dv=>{
    const checked = state.filters.domainIds.has(dv.id) ? "checked" : "";
    return `<label class="toggle" style="gap:10px">
      <input type="checkbox" data-filter="Domain" data-value="${escapeHTML(dv.id)}" ${checked}/>
      <span>${escapeHTML(dv.name)}</span>
    </label>`;
  }).join("");
  const domainBlock = `
    <div class="section" style="padding:12px">
      <div class="panel-title">Domain</div>
      <div class="panel-body" style="max-height:220px; overflow:auto">${domItems}</div>
    </div>
  `;

  const mt = mkChecklist("Metric type", options.metricTypes, state.filters.metricTypes);
  const cx = mkChecklist("Complexity", options.complexities, state.filters.complexities);
  const ph = mkChecklist("Patterns", options.patterns, state.filters.patterns);
  const dh = mkChecklist("Local/Vendor hint", options.deploymentHints, state.filters.deploymentHints);

  return `
    <div class="grid" style="margin-top:10px">
      <div style="grid-column: span 6">${domainBlock}</div>
      <div style="grid-column: span 3">${mt}${cx}</div>
      <div style="grid-column: span 3">${ph}${dh}</div>
    </div>
  `;
}

function renderMindmaps(){
  const d = state.data;
  const selectedDomain = state.selectedDomainId ? d.domains.find(x=>x.id===state.selectedDomainId) : null;
  const title = selectedDomain ? `Mindmap: ${selectedDomain.name}` : "Mindmap: Full landscape (Domains → Opportunities)";

  // Build tree
  const tree = buildMindmapTree(selectedDomain?.id || null);

  const diagram = renderMindmapSVG(tree, {width: 1400, nodeGapY: 22, levelGapX: 230});
  const html = `
    <div class="section">
      <h2>${escapeHTML(title)}</h2>
      <div class="sub">Click nodes to open details. Export as SVG for sharing.</div>
      <div class="diagram">
        <div class="diagram-toolbar">
          <div class="left">
            <button class="btn" data-action="exportMindmap">Export SVG</button>
            <button class="btn subtle" data-action="expandAll">Expand all</button>
            <button class="btn subtle" data-action="collapseAll">Collapse all</button>
          </div>
          <div class="right">
            ${badge("Tip: use Executive Mode for a simpler mindmap.", "")}
          </div>
        </div>
        <div id="mindmapHost">${diagram}</div>
      </div>
    </div>
  `;
  return `<div class="page">${html}</div>`;
}

function buildMindmapTree(domainId){
  const d = state.data;
  const root = { id:"ROOT", label:"Marquis Opportunities", type:"root", children:[], collapsed:false };
  const domainNodes = d.domains
    .filter(dom => !domainId || dom.id===domainId)
    .map(dom=>{
      const ucs = d.usecases.filter(u=>u.domain_id===dom.id);
      // Executive mode: focus on Opportunity-level items first
      let children = [];
      const opp = ucs.filter(u=>u.item_level==="Opportunity");
      if(opp.length){
        children = opp;
      }else{
        children = ucs.filter(u=>u.rank).sort((a,b)=>(Number(a.rank)||999)-(Number(b.rank)||999)).slice(0,10);
      }
      // Optionally include more in non-exec mode
      if(!state.execMode){
        const addl = ucs.filter(u=>u.item_level==="UseCase").slice(0,12);
        children = uniq(children.concat(addl));
      }

      return {
        id: dom.id,
        label: dom.name,
        type:"domain",
        collapsed: false,
        children: children.map(u=>({
          id: u.id,
          label: u.name || "(Untitled)",
          type:"usecase",
          collapsed: true,
          children: [] // we keep 2-level for readability
        }))
      };
    });

  root.children = domainNodes;
  return root;
}

// Simple tree layout: assigns x by depth, y by DFS leaf order
function layoutTree(root, levelGapX=220, nodeGapY=22){
  let yCursor = 0;
  const nodes = [];
  const links = [];

  function dfs(node, depth){
    const x = depth * levelGapX;
    let y;
    const kids = (node.collapsed ? [] : (node.children || []));
    if(!kids.length){
      y = yCursor;
      yCursor += nodeGapY;
    }else{
      const childYs = kids.map(k=>dfs(k, depth+1));
      y = (Math.min(...childYs) + Math.max(...childYs))/2;
    }
    node._x = x;
    node._y = y;
    nodes.push(node);
    kids.forEach(k=>{
      links.push({source: node, target: k});
    });
    return y;
  }
  dfs(root, 0);
  return {nodes, links, height: Math.max(240, yCursor + 60)};
}

function renderMindmapSVG(tree, opts={}){
  const levelGapX = opts.levelGapX || 220;
  const nodeGapY = opts.nodeGapY || 22;
  const width = opts.width || 1200;
  const {nodes, links, height} = layoutTree(tree, levelGapX, nodeGapY);

  const margin = {left: 30, top: 20, right: 30, bottom: 20};
  const w = width;
  const h = height;

  const linkPaths = links.map(l=>{
    const x1 = margin.left + l.source._x;
    const y1 = margin.top + l.source._y;
    const x2 = margin.left + l.target._x;
    const y2 = margin.top + l.target._y;
    const mid = (x1 + x2) / 2;
    return `<path d="M ${x1} ${y1} C ${mid} ${y1}, ${mid} ${y2}, ${x2} ${y2}" fill="none" stroke="rgba(255,255,255,.18)" stroke-width="1.4"/>`;
  }).join("");

  const nodeEls = nodes.map(n=>{
    const x = margin.left + n._x;
    const y = margin.top + n._y;
    const isRoot = n.type==="root";
    const r = isRoot ? 7 : (n.type==="domain" ? 6 : 5);
    const label = escapeHTML(n.label);
    const color = isRoot ? "rgba(105,168,255,.95)" : (n.type==="domain" ? "rgba(94,224,143,.92)" : "rgba(255,255,255,.82)");
    const textColor = "rgba(232,238,252,.92)";
    const clickable = (n.type==="usecase" || n.type==="domain") ? "pointer" : "default";
    const dataAttr = n.type==="usecase" ? `data-uc="${n.id}"` : (n.type==="domain" ? `data-dom="${n.id}"` : "");
    const icon = n.type==="domain" ? "◆" : (n.type==="usecase" ? "•" : "●");
    const expandHint = (n.children && n.children.length) ? (n.collapsed ? " [+]" : " [−]") : "";
    return `
      <g class="mm-node" ${dataAttr} transform="translate(${x},${y})" style="cursor:${clickable}">
        <circle r="${r}" fill="${color}"></circle>
        <text x="${r+10}" y="4" fill="${textColor}" font-size="${isRoot?14:12}" font-weight="${isRoot?700:600}">
          ${icon} ${label}${escapeHTML(expandHint)}
        </text>
      </g>
    `;
  }).join("");

  return `
    <svg id="mindmapSvg" viewBox="0 0 ${w} ${h}" width="100%" height="${h}" role="img" aria-label="Mindmap">
      <rect x="0" y="0" width="${w}" height="${h}" fill="transparent"></rect>
      ${linkPaths}
      ${nodeEls}
    </svg>
  `;
}

function renderWorkflows(){
  const d = state.data;
  const selected = state.selectedWorkflowId ? d.workflows.find(w=>w.id===state.selectedWorkflowId) : null;

  const list = d.workflows.map(w=>{
    const active = selected && selected.id===w.id ? "active" : "";
    const domain = w.domain || "—";
    return `<div class="domain-chip ${active}" data-wf="${w.id}">
      <div>
        <div class="name">${escapeHTML(w.name)}</div>
        <div class="smalltext">${escapeHTML(domain)}</div>
      </div>
      <div class="count">›</div>
    </div>`;
  }).join("");

  let detail = `<div class="smalltext">Click a workflow to view its intervention map. Full before/after steps are only shown when explicitly stated in the source dataset.</div>`;
  if(selected){
    detail = workflowDetail(selected);
  }

  return `
    <div class="page">
      <div class="section">
        <h2>Workflows</h2>
        <div class="sub">This is where the “work actually happens.” The dataset contains workflow names and where automation intervenes; step-by-step swimlanes require explicit step lists.</div>
        <div class="grid">
          <div class="section" style="grid-column: span 5">
            <h2 style="font-size:14px;margin-bottom:8px">Workflow list</h2>
            <div class="domain-list">${list}</div>
          </div>
          <div class="section" style="grid-column: span 7">
            <h2 style="font-size:14px;margin-bottom:8px">${selected ? escapeHTML(selected.name) : "Select a workflow"}</h2>
            ${detail}
          </div>
        </div>
      </div>
    </div>
  `;
}

function workflowDetail(w){
  const before = w.before_steps ? `<div class="pre">${escapeHTML(w.before_steps)}</div>` : `<div class="smalltext">Before-steps: Not stated in source.</div>`;
  const after = w.after_steps ? `<div class="pre">${escapeHTML(w.after_steps)}</div>` : `<div class="smalltext">After-steps: Not stated in source.</div>`;
  const lanes = `
    <div class="diagram">
      <div class="diagram-toolbar">
        <div class="left">${badge("Intervention map (safe)", "good")}</div>
        <div class="right"><button class="btn" data-action="openWF" data-wf="${w.id}">Open workflow details</button></div>
      </div>
      ${renderInterventionSVG(w)}
    </div>
  `;
  return `
    ${lanes}
    <div class="grid" style="margin-top:12px">
      <div class="section" style="grid-column: span 6">
        <h2 style="font-size:14px;margin-bottom:8px">Before</h2>
        ${before}
      </div>
      <div class="section" style="grid-column: span 6">
        <h2 style="font-size:14px;margin-bottom:8px">After</h2>
        ${after}
      </div>
    </div>
    <div class="smalltext" style="margin-top:10px">Evidence: ${escapeHTML(w.source?.doc||"")} • ${escapeHTML(w.source?.ref||"")}</div>
  `;
}

function renderInterventionSVG(w){
  // Simple 4-lane intervention diagram: Humans, Systems, AI/Automation, External
  const lanes = ["Facility staff", "Core systems", "AI/Automation", "External systems"];
  const interv = w.intervention || "Not stated in source";
  const title = w.name || "Workflow";

  const width = 980, height = 260, pad=18;
  const laneH = 44;
  const y0 = 56;
  const boxW = width - pad*2;
  const stepX = pad + 18;

  const laneRects = lanes.map((ln,i)=>{
    const y = y0 + i*(laneH+10);
    return `
      <rect x="${pad}" y="${y}" width="${boxW}" height="${laneH}" rx="14" fill="rgba(255,255,255,.03)" stroke="rgba(255,255,255,.10)"/>
      <text x="${pad+14}" y="${y+27}" fill="rgba(232,238,252,.9)" font-size="13" font-weight="650">${escapeHTML(ln)}</text>
    `;
  }).join("");

  const arrow = `
    <path d="M ${stepX} ${y0+ (laneH/2)} L ${width-pad-26} ${y0+ (laneH/2)}" stroke="rgba(105,168,255,.38)" stroke-width="3" fill="none"/>
    <path d="M ${width-pad-30} ${y0+ (laneH/2)-6} L ${width-pad-16} ${y0+ (laneH/2)} L ${width-pad-30} ${y0+ (laneH/2)+6}" fill="rgba(105,168,255,.55)"/>
  `;

  const bubble = `
    <rect x="${pad+260}" y="${y0 + 2*(laneH+10) + 8}" width="${boxW-290}" height="${laneH-16}" rx="12" fill="rgba(94,224,143,.10)" stroke="rgba(94,224,143,.28)"/>
    <text x="${pad+274}" y="${y0 + 2*(laneH+10) + 30}" fill="rgba(232,238,252,.92)" font-size="12">
      ${escapeHTML(interv).slice(0,120)}${escapeHTML(interv).length>120?"…":""}
    </text>
  `;

  return `
    <svg id="wfSvg" viewBox="0 0 ${width} ${height}" width="100%" height="${height}">
      <text x="${pad}" y="28" fill="rgba(232,238,252,.92)" font-size="14" font-weight="750">${escapeHTML(title)}</text>
      <text x="${pad}" y="46" fill="rgba(184,195,218,.85)" font-size="12">Intervention shown exactly as stated in the source dataset.</text>
      ${laneRects}
      ${arrow}
      ${bubble}
    </svg>
  `;
}

function renderFoundations(){
  const d = state.data;
  const coreAreas = ["data hub/integration","governance","security/privacy","monitoring","change management"];
  const core = d.foundations.filter(f=> coreAreas.some(a => String(f.area).startsWith(a)));
  const rest = d.foundations.filter(f=> !core.includes(f));

  const cards = (arr)=> arr.map(f=>`
    <div class="section">
      <h2 style="font-size:14px;margin-bottom:6px">${escapeHTML(f.area)}</h2>
      <div class="sub">${escapeHTML(f.summary||"")}</div>
      ${f.full_excerpt ? `<div class="pre">${escapeHTML(String(f.full_excerpt).slice(0,900))}${String(f.full_excerpt).length>900?"…":""}</div>` : ""}
      <div class="smalltext">Evidence: ${escapeHTML(f.source?.doc||"")} • ${escapeHTML(f.source?.ref||"")}</div>
    </div>
  `).join("");

  // Local vs Vendor section from "open-source-first reference stack" and "self-hostable building blocks"
  const oss = d.foundations.find(f=>String(f.area).includes("open-source-first reference stack"));
  const selfhost = d.foundations.find(f=>String(f.area).includes("self-hostable building blocks"));

  const tableFromPipe = (txt)=>{
    if(!txt) return `<div class="smalltext">Not stated in source.</div>`;
    const lines = String(txt).split("\n").map(l=>l.trim()).filter(Boolean);
    const rows = [];
    for(const ln of lines){
      if(ln.includes("|")){
        const parts = ln.split("|").map(p=>p.trim());
        if(parts.length>=2) rows.push(parts);
      }
    }
    if(!rows.length) return `<div class="pre">${escapeHTML(txt)}</div>`;
    const header = rows[0];
    const body = rows.slice(1);
    return `
      <div class="tablewrap">
        <table>
          <thead><tr>${header.map(h=>`<th>${escapeHTML(h)}</th>`).join("")}</tr></thead>
          <tbody>
            ${body.map(r=>`<tr>${r.map(c=>`<td>${escapeHTML(c)}</td>`).join("")}</tr>`).join("")}
          </tbody>
        </table>
      </div>
    `;
  };

  const localVendor = `
    <div class="section">
      <h2>Local vs Vendor: what “local” means</h2>
      <div class="sub">
        “Local” = self-hosted/on-prem/private-cloud components you operate. “Vendor” = managed services you buy.
        This section only shows what’s explicitly listed in the source dataset (no guessing).
      </div>
      <div class="grid">
        <div class="section" style="grid-column: span 6">
          <h2 style="font-size:14px;margin-bottom:8px">Open-source-first reference stack (from source)</h2>
          ${tableFromPipe(oss?.full_excerpt)}
        </div>
        <div class="section" style="grid-column: span 6">
          <h2 style="font-size:14px;margin-bottom:8px">Self-hostable building blocks (from source)</h2>
          ${tableFromPipe(selfhost?.full_excerpt)}
        </div>
      </div>
    </div>
  `;

  return `<div class="page">
    <div class="hero">
      <h1>Foundations</h1>
      <p>
        These are the platform capabilities that make automation scale. Without them, you get isolated pilots and inconsistent results.
        Use this page to explain “why we need governance/security/integration” in plain English.
      </p>
    </div>
    ${localVendor}
    <div class="section">
      <h2>Core foundations</h2>
      <div class="sub">Data hub/integration, governance, security/privacy, monitoring, change management.</div>
      <div class="grid">${cards(core)}</div>
    </div>
    <div class="section">
      <h2>Additional reference sections</h2>
      <div class="grid">${cards(rest)}</div>
    </div>
  </div>`;
}

function renderRoadmap(){
  const d = state.data;
  const opps = d.usecases.filter(u=>u.item_level==="Opportunity");
  // Safe derived buckets:
  const bucket = (u)=>{
    const tt = normalize(u.time_to_value || "");
    const cx = normalize(u.complexity || "");
    if(tt.includes("days") || tt.includes("week") || cx==="low") return "30 days (quick wins)";
    if(tt.includes("month") || cx==="med" || cx==="medium") return "60–90 days (build + deploy)";
    if(cx==="high") return "6–12 months (strategic)";
    return "Needs review (not stated)";
  };
  const groups = {};
  opps.forEach(u=>{
    const b = bucket(u);
    groups[b] = groups[b] || [];
    groups[b].push(u);
  });

  const groupHtml = Object.keys(groups).sort().map(k=>{
    const items = groups[k].sort((a,b)=>(b.derived?.quant_claim_count||0)-(a.derived?.quant_claim_count||0)).map(u=>`
      <div class="domain-chip" data-uc="${u.id}">
        <div>
          <div class="name">${escapeHTML(u.name)}</div>
          <div class="smalltext">${escapeHTML(u.summary||"Not stated in source")}</div>
        </div>
        <div class="count">›</div>
      </div>
    `).join("");
    return `
      <div class="section">
        <h2 style="font-size:14px;margin-bottom:8px">${escapeHTML(k)}</h2>
        <div class="smalltext">This bucketing is computed only from Time-to-value / Complexity fields. Missing fields → “Needs review.”</div>
        <div class="domain-list" style="margin-top:10px">${items}</div>
      </div>
    `;
  }).join("");

  return `<div class="page">
    <div class="hero">
      <h1>Roadmap (CEO-friendly)</h1>
      <p>
        This is a safe, dataset-driven sequencing view. It does not invent timelines.
        If a timeline or complexity isn’t stated in the dataset, it’s explicitly marked as “Needs review.”
      </p>
    </div>
    ${groupHtml}
  </div>`;
}

function renderMain(){
  const route = state.route;
  setActiveNav(route);

  if(route==="overview") return renderOverview();
  if(route==="explore") return renderExplore();
  if(route==="mindmaps") return renderMindmaps();
  if(route==="workflows") return renderWorkflows();
  if(route==="foundations") return renderFoundations();
  if(route==="roadmap") return renderRoadmap();

  return `<div class="page"><div class="section"><h2>Not found</h2></div></div>`;
}

function openUseCase(id){
  const u = state.data.usecases.find(x=>x.id===id);
  if(!u) return;
  const patterns = (u.derived?.patterns || []);
  const claims = (u.claimed_impact || []);
  const claimsHtml = claims.length ? `
    <div class="section">
      <h2 style="font-size:14px;margin-bottom:8px">Quantified claims (as stated)</h2>
      <div class="tablewrap">
        <table>
          <thead><tr><th>Value</th><th>Context</th></tr></thead>
          <tbody>${claims.map(c=>`<tr><td>${escapeHTML(c.value||"")}</td><td>${escapeHTML(c.context||"")}</td></tr>`).join("")}</tbody>
        </table>
      </div>
    </div>
  ` : `<div class="section"><h2 style="font-size:14px;margin-bottom:8px">Quantified claims</h2><div class="smalltext">None stated in source.</div></div>`;

  const kvs = [
    ["Domain", escapeHTML(u.domain||"")],
    ["Item level", escapeHTML(u.item_level||"Not stated")],
    ["Summary", u.summary ? escapeHTML(u.summary) : ""],
    ["Primary outcome", escapeHTML(u.primary_outcome||"")],
    ["Metric type", escapeHTML(u.metric_type||"")],
    ["Time-to-value", escapeHTML(u.time_to_value||"")],
    ["Complexity", escapeHTML(u.complexity||"")],
    ["Dependencies", u.dependencies ? `<div class="pre">${escapeHTML(u.dependencies)}</div>` : ""],
    ["Vendors/tools (as written)", u.vendors_tools ? `<div class="pre">${escapeHTML(u.vendors_tools)}</div>` : ""],
    ["Risks & compliance notes", u.risks_compliance ? `<div class="pre">${escapeHTML(u.risks_compliance)}</div>` : ""],
    ["Approach / patterns (derived from report language)", patterns.length ? patterns.map(p=>badge(p,"")).join(" ") : badge("Not specified","")],
    ["Local/Vendor hint (derived from text)", escapeHTML(u.derived?.deployment_hint||"")],
    ["Evidence", `<div class="smalltext">${escapeHTML(u.source?.doc||"")} • ${escapeHTML(u.source?.ref||"")}</div>`],
  ];

  const raw = `
    <div class="section">
      <h2 style="font-size:14px;margin-bottom:8px">Raw excerpts (verbatim fields)</h2>
      <div class="kv">
        <div class="k">Current-state pain</div>
        <div class="v">${u.raw_current_state_pain ? `<div class="pre">${escapeHTML(u.raw_current_state_pain)}</div>` : `<span class="smalltext">Not stated in source</span>`}</div>
      </div>
      <div class="kv">
        <div class="k">Automatable units</div>
        <div class="v">${u.raw_automatable_units ? `<div class="pre">${escapeHTML(u.raw_automatable_units)}</div>` : `<span class="smalltext">Not stated in source</span>`}</div>
      </div>
      <div class="kv">
        <div class="k">Approach</div>
        <div class="v">${u.raw_approach ? `<div class="pre">${escapeHTML(u.raw_approach)}</div>` : `<span class="smalltext">Not stated in source</span>`}</div>
      </div>
    </div>
  `;

  showModal(u.name, `<div class="page">${claimsHtml}<div class="section">${keyValueRows(kvs)}</div>${raw}</div>`);
}

function openWorkflow(id){
  const w = state.data.workflows.find(x=>x.id===id);
  if(!w) return;
  const kvs = [
    ["Domain", escapeHTML(w.domain||"")],
    ["Intervention (as stated)", w.intervention ? `<div class="pre">${escapeHTML(w.intervention)}</div>` : ""],
    ["Stakeholders/roles", w.stakeholders_roles ? `<div class="pre">${escapeHTML(w.stakeholders_roles)}</div>` : ""],
    ["Before steps", w.before_steps ? `<div class="pre">${escapeHTML(w.before_steps)}</div>` : ""],
    ["After steps", w.after_steps ? `<div class="pre">${escapeHTML(w.after_steps)}</div>` : ""],
    ["Evidence", `<div class="smalltext">${escapeHTML(w.source?.doc||"")} • ${escapeHTML(w.source?.ref||"")}</div>`],
  ];
  showModal(w.name, `<div class="section">${keyValueRows(kvs)}</div>`);
}

function attachEventHandlers(){
  $("#modalClose").onclick = hideModal;
  $("#modalBackdrop").onclick = hideModal;

  $("#execToggle").onchange = (e)=>{
    state.execMode = e.target.checked;
    navigate(state.route);
  };

  $("#globalSearch").oninput = (e)=>{
    state.search = e.target.value || "";
    // Only rerender table-heavy pages on search
    if(["explore"].includes(state.route)) navigate(state.route);
  };

  $("#shareBtn").onclick = async ()=>{
    const url = buildShareURL();
    try{
      await copyToClipboard(url);
      showModal("Share link copied", `<div class="smalltext">Copied to clipboard:</div><div class="pre">${escapeHTML(url)}</div>`);
    }catch{
      showModal("Share link", `<div class="smalltext">Copy this link:</div><div class="pre">${escapeHTML(url)}</div>`);
    }
  };

  window.addEventListener("hashchange", ()=>navigateFromHash());
}

function buildShareURL(){
  const url = new URL(location.href);
  // encode route + selected domain + filters
  const params = new URLSearchParams();
  params.set("exec", state.execMode ? "1":"0");
  if(state.search) params.set("q", state.search);

  const setToParam = (key, set)=>{ if(set.size) params.set(key, Array.from(set).join(",")); };
  setToParam("dom", state.filters.domainIds);
  setToParam("mt", state.filters.metricTypes);
  setToParam("cx", state.filters.complexities);
  setToParam("pt", state.filters.patterns);
  setToParam("dh", state.filters.deploymentHints);

  if(state.filters.onlyTop) params.set("top","1");
  if(state.filters.onlyOpportunities) params.set("opp","1");

  if(state.selectedDomainId) params.set("sd", state.selectedDomainId);
  if(state.route) url.hash = `#/${state.route}?${params.toString()}`;
  return url.toString();
}

function applyParams(params){
  const toSet = (val)=> new Set((val||"").split(",").map(x=>x.trim()).filter(Boolean));
  state.execMode = params.get("exec")==="1";
  $("#execToggle").checked = state.execMode;

  state.search = params.get("q") || "";
  $("#globalSearch").value = state.search;

  state.filters.domainIds = toSet(params.get("dom"));
  state.filters.metricTypes = toSet(params.get("mt"));
  state.filters.complexities = toSet(params.get("cx"));
  state.filters.patterns = toSet(params.get("pt"));
  state.filters.deploymentHints = toSet(params.get("dh"));
  state.filters.onlyTop = params.get("top")==="1";
  state.filters.onlyOpportunities = params.get("opp")==="1";
  state.selectedDomainId = params.get("sd") || null;
}

function wireMainInteractions(){
  const main = $("#main");

  // delegate clicks
  main.onclick = (e)=>{
    const t = e.target.closest("[data-action], [data-uc], [data-dom], [data-wf], tr[data-uc], .domain-chip[data-dom], .domain-chip[data-wf]");
    if(!t) return;

    const action = t.dataset.action;
    if(action==="openUC"){
      openUseCase(t.dataset.uc);
      return;
    }
    if(action==="openWF"){
      openWorkflow(t.dataset.wf);
      return;
    }
    if(action==="exploreDomain"){
      state.route = "explore";
      state.filters.domainIds = new Set([t.dataset.dom]);
      location.hash = "#/explore";
      navigate("explore");
      return;
    }
    if(action==="exportMindmap"){
      const svg = $("#mindmapSvg");
      if(svg) downloadSVGAsFile(svg, "Mindmap.svg");
      return;
    }
    if(action==="expandAll" || action==="collapseAll"){
      // for now: simply re-render with collapsed=false/true at domain children level
      // We'll toggle by execMode style: collapseAll collapses usecase nodes; expandAll expands domain nodes (already).
      // Not storing full state per node; minimal controls.
      showModal("Note", `<div class="smalltext">This mindmap is 2-level by design for readability. Use domain selection to focus further.</div>`);
      return;
    }

    // domain selection from overview
    if(t.dataset.dom && !action){
      state.selectedDomainId = t.dataset.dom;
      navigate(state.route);
      return;
    }

    // workflow selection
    if(t.dataset.wf && !action){
      state.selectedWorkflowId = t.dataset.wf;
      navigate(state.route);
      return;
    }

    // row click open usecase
    const tr = t.closest("tr[data-uc]");
    if(tr){
      openUseCase(tr.dataset.uc);
      return;
    }
    const ucCard = t.closest("[data-uc]");
    if(ucCard){
      openUseCase(ucCard.dataset.uc);
      return;
    }
  };

  // filter checkboxes (Explore)
  main.addEventListener("change", (e)=>{
    const inp = e.target;
    if(!(inp instanceof HTMLInputElement)) return;
    if(!inp.dataset.filter) return;
    const filter = inp.dataset.filter;
    const value = inp.dataset.value;

    if(filter==="Domain"){
      if(inp.checked) state.filters.domainIds.add(value); else state.filters.domainIds.delete(value);
    }else if(filter==="Metric type"){
      if(inp.checked) state.filters.metricTypes.add(value); else state.filters.metricTypes.delete(value);
    }else if(filter==="Complexity"){
      if(inp.checked) state.filters.complexities.add(value); else state.filters.complexities.delete(value);
    }else if(filter==="Patterns"){
      if(inp.checked) state.filters.patterns.add(value); else state.filters.patterns.delete(value);
    }else if(filter==="Local/Vendor hint"){
      if(inp.checked) state.filters.deploymentHints.add(value); else state.filters.deploymentHints.delete(value);
    }
    navigate(state.route);
  });
}

function navigate(route){
  state.route = route;
  const options = buildOptions();
  renderSidebar(options);
  $("#main").innerHTML = renderMain();
  wireMainInteractions();

  // footer
  $("#footerMeta").textContent = `${state.data.meta.counts.domains} domains • ${state.data.meta.counts.usecases} items • ${state.data.meta.counts.workflows} workflows • ${state.data.meta.counts.metrics} metrics • generated ${state.data.meta.generated_at}`;
}

function navigateFromHash(){
  const {route, params} = parseRoute();
  state.route = route || "overview";
  applyParams(params);
  navigate(state.route);
}

async function init(){
  attachEventHandlers();

  // Load dataset (embedded first so the app works even when opened as a local file)
  const embedded = document.getElementById("embeddedData");
  if(embedded && embedded.textContent && embedded.textContent.trim()){
    state.data = JSON.parse(embedded.textContent);
  }else{
    const res = await fetch("data.json");
    state.data = await res.json();
  }

  // initial route
  navigateFromHash();
}

init().catch(err=>{
  console.error(err);
  $("#main").innerHTML = `<div class="section"><h2>Error loading dataset</h2><div class="pre">${escapeHTML(String(err))}</div></div>`;
});