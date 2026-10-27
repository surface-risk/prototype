/* Surface Risk prototype — sample report view (fictional firm, data from the Python engine). */
"use strict";

const reportState = { view: "matrix", level: R.firm.reporting_level };

function bandColor(idx) { return `var(--band-${idx})`; }

function keyMessages() {
  const I = R.indices, M = R.mgmt;
  const peerGap = ((I.peer_loss + I.peer_perf) - (I.loss + I.perf)) / 2;
  const top = R.priorities.top.slice(0, 4).map((p) => `${p.name.toLowerCase()} (${f0(R.areas.find((a) => a.code === p.code).score)})`);
  const spots = R.areas.filter((a) => a.blind_spot);
  const phish = R.checks.find((c) => c.id === "C07"), breach = R.checks.find((c) => c.id === "C06");
  const depts = R.groups.filter((g) => g.kind === "dept").sort((a, b) => (b.flags || 0) - (a.flags || 0));
  const worst = depts[0];
  const recentTest = M.managers.filter((m) => m.mc5 >= 100).length;
  const msgs = [
    `Overall <strong>${esc(I.archetype)}</strong> (Loss ${f0(I.loss)}, Performance ${f0(I.perf)}), about ${f0(peerGap)} points behind illustrative peers. The equal-weight check ${I.robust ? "agrees, so the result is robust" : "changes the result, so treat it as sensitive"}. Top priorities: ${top.join(", ")}.`,
    `Management see the firm as <strong>${esc(M.archetype)}</strong> (${f0(M.loss)} / ${f0(M.perf)}). ${spots.length ? `${spots.length === 1 ? "Only one gap passes" : spots.length + " gaps pass"} the statistical test: ${spots.map((a) => `${a.name.toLowerCase()} (management ${f0(a.mgmt_survey)} vs staff ${f0(a.survey)})`).join(", ")}.` : "No gap passes the statistical test."}${phish && breach ? ` Cyber checks back the staff view: ${f0(phish.result * 100)}% phishing click rate and ${f0(breach.result * 100)}% of staff email addresses in public breaches.` : ""}`,
    `${esc(worst.entity)} is <strong>${esc(worst.archetype)}</strong> (${f0(worst.loss)} / ${f0(worst.perf)}), notably below the firm in ${worst.flags} of 20 areas after adjusting for small numbers. Leadership capability is ${f0(M.capability)}/100: ${recentTest === 0 ? "no manager has taken part in a continuity test in the last 12 months" : recentTest + " manager(s) tested the continuity plan in the last 12 months"}, and managers’ top-5 risks overlap with the assessment’s by ${f1(M.mc1_overlap_mean)} of 5 on average.`,
  ];
  return `<ol class="messages">${msgs.map((m) => `<li><p>${m}</p></li>`).join("")}</ol>`;
}

function matrixChart() {
  const pts = R.groups.filter((g) => ["firm", "mgmt", "dept", "peer"].includes(g.kind));
  const W = 560, H = 440, pad = { l: 56, r: 20, t: 20, b: 50 };
  const lo = 20, hi = 80;
  const x = (v) => pad.l + ((clamp(v, lo, hi) - lo) / (hi - lo)) * (W - pad.l - pad.r);
  const y = (v) => H - pad.b - ((clamp(v, lo, hi) - lo) / (hi - lo)) * (H - pad.t - pad.b);
  let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Loss Index against Performance Index">`;
  const zs = [[lo, P.archetype_low], [P.archetype_low, P.archetype_high], [P.archetype_high, hi]];
  const zn = ["Low", "Mid", "High"];
  zs.forEach(([l0, l1], i) => zs.forEach(([p0, p1], j) => {
    const a = U.archetypes.find((q) => q.key === zn[i] + "|" + zn[j]);
        if ((i + j) % 2 === 0) s += `<rect class="zone" x="${x(p0)}" y="${y(l1)}" width="${x(p1) - x(p0)}" height="${y(l0) - y(l1)}"/>`;
    s += `<text class="zone-label" x="${x(p0) + 6}" y="${y(l1) + 14}">${esc(a.name)}</text>`;
  }));
  [20, 30, 40, 50, 60, 70, 80].forEach((t) => {
    s += `<line class="${t === 40 || t === 60 ? "grid-2" : "grid"}" x1="${x(t)}" x2="${x(t)}" y1="${pad.t}" y2="${H - pad.b}"/><line class="${t === 40 || t === 60 ? "grid-2" : "grid"}" x1="${pad.l}" x2="${W - pad.r}" y1="${y(t)}" y2="${y(t)}"/>`;
    s += `<text x="${x(t)}" y="${H - pad.b + 16}" text-anchor="middle">${t}</text><text x="${pad.l - 8}" y="${y(t) + 4}" text-anchor="end">${t}</text>`;
  });
  s += `<text x="${(W + pad.l) / 2}" y="${H - 10}" text-anchor="middle" class="t-strong">Performance Index →</text>`;
  s += `<text transform="translate(16 ${(H - pad.b + pad.t) / 2}) rotate(-90)" text-anchor="middle" class="t-strong">Loss Index →</text>`;
  const placed = [];
  const order = [...pts].sort((a, b) => ({ firm: 0, mgmt: 1, peer: 2, dept: 3 }[a.kind] - { firm: 0, mgmt: 1, peer: 2, dept: 3 }[b.kind]));
  let marks = "", labels = "";
  order.forEach((g) => {
    const cx = x(g.perf), cy = y(g.loss);
    const style = { firm: ["var(--fg)", 7], mgmt: ["var(--accent)", 6], dept: ["var(--steel)", 4.5], peer: ["var(--fg-3)", 5] }[g.kind];
    marks += g.kind === "mgmt" ? `<path d="M${cx} ${cy - 7} l7 7 l-7 7 l-7 -7z" fill="${style[0]}"/>` : g.kind === "peer" ? `<rect x="${cx - 5}" y="${cy - 5}" width="10" height="10" fill="none" stroke="${style[0]}" stroke-width="1.5"/>` : `<circle cx="${cx}" cy="${cy}" r="${style[1]}" fill="${style[0]}"/>`;
    const lbl = g.kind === "firm" ? "Firm (staff)" : g.kind === "mgmt" ? "Management" : g.kind === "peer" ? "Peers" : g.entity;
    const w = lbl.length * 6.8 + 4;
    let lx = cx + 11, ly = cy + 4;
    if (lx + w > W - pad.r) lx = cx - 11 - w;
    let guard = 0;
    while (placed.some((p) => Math.abs(p.y - ly) < 12 && lx < p.x + p.w && lx + w > p.x) && guard++ < 12) ly += 12;
    placed.push({ x: lx, y: ly, w });
    if (Math.abs(ly - (cy + 4)) > 2) labels += `<line x1="${cx}" y1="${cy}" x2="${lx - 2}" y2="${ly - 4}" stroke="var(--line-2)"/>`;
    labels += `<text x="${lx}" y="${ly}" ${g.kind === "firm" || g.kind === "mgmt" ? 'class="t-strong"' : ""}>${esc(lbl)}</text>`;
  });
  s += marks + labels;
  return s + "</svg>";
}

function tiltChart() {
  const rows = R.groups.filter((g) => g.kind !== "bl");
  const W = 680, rowH = 34, top = 40, left = 150, lvlR = 400, t0 = 460, tw = 160, H = top + rows.length * rowH + 30;
  const xl = (v) => left + (v / 100) * (lvlR - left);
  const xt = (v) => t0 + tw / 2 + (clamp(v, -10, 10) / 10) * (tw / 2);
  let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Overall level and loss tilt by group">`;
  s += `<text x="${left}" y="16" class="t-strong">Overall level</text><text x="${left}" y="30">average of the two indices</text>`;
  s += `<text x="${t0}" y="16" class="t-strong">Loss tilt</text><text x="${t0}" y="30">Loss − Performance</text>`;
  [0, 25, 50, 75, 100].forEach((t) => { s += `<line class="grid" x1="${xl(t)}" x2="${xl(t)}" y1="${top - 4}" y2="${H - 24}"/><text x="${xl(t)}" y="${H - 8}" text-anchor="middle">${t}</text>`; });
  [-10, -5, 0, 5, 10].forEach((t) => { s += `<line class="${t === 0 ? "grid-2" : "grid"}" x1="${xt(t)}" x2="${xt(t)}" y1="${top - 4}" y2="${H - 24}"/><text x="${xt(t)}" y="${H - 8}" text-anchor="middle">${t > 0 ? "+" : ""}${t}</text>`; });
  rows.forEach((g, i) => {
    const y = top + i * rowH + rowH / 2, lvl = (g.loss + g.perf) / 2, tilt = g.loss - g.perf;
    const lbl = g.kind === "firm" ? "Firm (staff)" : g.kind === "mgmt" ? "Management" : g.kind === "peer" ? "Peers (illustr.)" : g.entity;
    s += `<text x="${left - 10}" y="${y + 4}" text-anchor="end" ${g.kind === "firm" ? 'class="t-strong"' : ""}>${esc(lbl)}</text>`;
    s += `<line x1="${xl(0)}" x2="${xl(lvl)}" y1="${y}" y2="${y}" stroke="var(--line-2)" stroke-width="2"/><circle cx="${xl(lvl)}" cy="${y}" r="5" fill="${g.kind === "mgmt" ? "var(--accent)" : "var(--fg)"}"/><text x="${xl(lvl) + 10}" y="${y + 4}">${f0(lvl)}</text>`;
    const x0 = xt(0), x1 = xt(tilt);
    s += `<rect x="${Math.min(x0, x1)}" y="${y - 6}" width="${Math.max(2, Math.abs(x1 - x0))}" height="12" fill="${tilt >= 0 ? "var(--accent)" : "var(--warn)"}"/><text x="${t0 + tw + 12}" y="${y + 4}">${sign(tilt)}</text>`;
  });
  return s + "</svg>";
}

function areaRowSVG(a) {
  // viewBox 0..100 horizontally (score scale), stretched to fit; markers drawn with rects so they survive stretching.
  const b = bandOf(a.score);
  const lo = clamp(a.score - a.ci, 0, 100), hi = clamp(a.score + a.ci, 0, 100);
  return `<svg viewBox="0 0 100 26" preserveAspectRatio="none" aria-hidden="true">
    ${[20, 40, 60, 80].map((t) => `<rect x="${t - 0.1}" y="3" width="0.2" height="20" fill="var(--line)"/>`).join("")}
    <rect x="0" y="9" width="100" height="8" fill="var(--bg-2)"/>
    <rect x="0" y="9" width="${a.score}" height="8" fill="${bandColor(b.idx)}"/>
    <rect x="${lo}" y="12.4" width="${hi - lo}" height="1.2" fill="var(--fg)"/>
    <rect x="${a.peer - 0.35}" y="4" width="0.7" height="18" fill="var(--fg-3)"/>
    <rect x="${a.mgmt - 0.6}" y="1" width="1.2" height="7" fill="var(--accent)"/>
  </svg>`;
}

function areasHTML() {
  const top5 = new Set(R.priorities.top.map((p) => p.code));
  return `<div class="areas-table">${GROUPS.map((g) => {
    const list = R.areas.filter((a) => a.group === g);
    const l1 = R.l1[g];
    return `<div class="group-label"><span>${GROUP_LABEL[g]}</span><span>group ${f0(l1.score)} · peers ${f0(l1.peer)}</span></div>` +
      list.map((a) => {
        const b = bandOf(a.score);
        return `<button class="area-row" data-area="${a.code}" aria-label="${esc(a.name)}: ${f1(a.score)}, ${b.label}. Open details.">
          <span class="nm"><span class="code">${a.code}${top5.has(a.code) ? " · priority" : ""}${a.blind_spot ? " · blind spot" : ""}${a.penalty > 0 ? " · exposure penalty" : ""}</span>${esc(a.name)}</span>
          ${areaRowSVG(a)}
          <span class="sc">${f0(a.score)}<span class="faint small">±${f0(a.ci)}</span></span>
          <span class="bandcell"><span class="band-chip" style="background:${bandColor(b.idx)}">${b.label}</span></span>
        </button>`;
      }).join("");
  }).join("")}</div>`;
}

function deptHTML() {
  const lv = reportState.level;
  const d = R.departments[lv];
  const levels = Object.keys(R.departments);
  const names = { A: "2 groups", B: "4 groups", C: "8 groups" };
  return `<div class="row" style="justify-content:space-between">
      <div class="seg" role="group" aria-label="Department level">${levels.map((l) => `<button data-level="${l}" aria-pressed="${l === lv}">Level ${l} · ${names[l]}</button>`).join("")}</div>
      <span class="small faint">${R.firm.headcount} staff → default level ${R.firm.reporting_level}. Firms over 150 staff see 8 groups; every firm can roll up to 2.</span>
    </div>
    <div class="table-wrap" style="border:0"><table class="heat">
      <thead><tr><th>Area</th><th class="n">Firm</th>${d.names.map((n, i) => `<th class="n">${esc(n)}<br><span class="faint">n=${d.rows[0].values[i].n}</span></th>`).join("")}</tr></thead>
      <tbody>${d.rows.map((r) => `<tr><td class="rowname">${esc(r.name)}</td><td class="n">${f0(r.firm)}</td>${r.values.map((v) => {
        const b = bandOf(v.score);
        const mark = v.flag === "Lower" ? `<span class="f" style="color:var(--crit)" title="Notably lower">▼</span>` : v.flag === "Higher" ? `<span class="f" style="color:var(--good)" title="Notably higher">▲</span>` : "";
        return `<td class="cell" style="background:color-mix(in srgb, ${bandColor(b.idx)} 30%, transparent)">${f0(v.score)}${mark}</td>`;
      }).join("")}</tr>`).join("")}</tbody>
    </table></div>
    <p class="small faint">Scores are adjusted towards the firm average for group size. ▼ / ▲ mark scores outside the firm’s 95% range for a group that size.</p>`;
}

function drawerHTML(code) {
  const a = R.areas.find((x) => x.code === code), m = areaMeta[code], b = bandOf(a.score);
  const checks = R.checks.filter((c) => c.area === code);
  const exps = R.exposures.filter((e) => e.area === code);
  const dept = R.departments[reportState.level];
  const drow = dept.rows.find((r) => r.code === code);
  return `<div class="row" style="justify-content:space-between;align-items:flex-start">
      <div class="stack" style="gap:6px"><span class="eyebrow">${a.code} · ${GROUP_LABEL[a.group]}</span><h2 style="font-size:var(--step-2)">${esc(a.name)}</h2></div>
      <button class="btn small" id="drawerClose">Close</button></div>
    <div class="kpis">
      <div class="kpi"><span class="k">Score</span><span class="v">${f1(a.score)}</span><span class="s">${b.label} · ±${f1(a.ci)}</span></div>
      <div class="kpi"><span class="k">Peers</span><span class="v">${f0(a.peer)}</span><span class="s">${sign(a.score - a.peer)} vs peers</span></div>
      <div class="kpi"><span class="k">Management</span><span class="v">${f0(a.mgmt_survey)}</span><span class="s">staff ${f0(a.survey)} · ${a.blind_spot ? "blind spot" : "within range"}</span></div>
    </div>
    <dl class="kv">
      <dt>Staff survey score</dt><dd>${f1(a.survey)}</dd>
      <dt>Weight from checks</dt><dd>${f0(a.check_weight * 100)}%</dd>
      <dt>Preparedness</dt><dd>${f1(a.preparedness)}</dd>
      <dt>Exposure penalty</dt><dd>${a.penalty > 0 ? "−" + f1(a.penalty) : "none"}</dd>
      <dt>Data points</dt><dd>${a.data_points}</dd>
      <dt>Importance (loss / performance)</dt><dd>${m.loss_tier} / ${m.perf_tier}</dd>
    </dl>
    ${checks.length ? `<div class="stack" style="gap:8px"><span class="eyebrow">Checks</span>${checks.map((c) => `<div class="row small" style="justify-content:space-between"><span class="muted">${esc(c.name)}</span><span class="mono">${c.run ? f0(c.score) + "/100" : "not run"}</span></div>`).join("")}</div>` : ""}
    ${exps.length ? `<div class="stack" style="gap:8px"><span class="eyebrow">Country exposure (penalty only)</span>${exps.map((e) => `<div class="row small" style="justify-content:space-between"><span class="muted">${esc(e.name)}</span><span class="mono">${f1(e.value)}${e.penalty_applies ? " · above baseline" : ""}</span></div>`).join("")}</div>` : ""}
    ${drow ? `<div class="stack" style="gap:8px"><span class="eyebrow">By department</span>${dept.names.map((n, i) => `<div class="row small" style="justify-content:space-between"><span class="muted">${esc(n)}</span><span class="mono">${f0(drow.values[i].score)}${drow.values[i].flag ? " · " + drow.values[i].flag.toLowerCase() : ""}</span></div>`).join("")}</div>` : ""}
    <div class="stack" style="gap:10px"><span class="eyebrow">What good looks like</span><p class="muted small">${esc(m.good)}</p>
    <span class="eyebrow">How it leads to loss</span><p class="muted small">${esc(m.loss)}</p>
    <span class="eyebrow">How it holds back performance</span><p class="muted small">${esc(m.perf)}</p></div>`;
}

function openDrawer(code) {
  closeDrawer();
  const back = document.createElement("div"); back.className = "drawer-back"; back.id = "drawerBack";
  const dr = document.createElement("aside"); dr.className = "drawer"; dr.id = "drawer"; dr.setAttribute("role", "dialog"); dr.setAttribute("aria-modal", "true");
  dr.innerHTML = drawerHTML(code);
  document.body.append(back, dr);
  back.addEventListener("click", closeDrawer);
  $("#drawerClose").addEventListener("click", closeDrawer);
  $("#drawerClose").focus();
}
function closeDrawer() { $("#drawer")?.remove(); $("#drawerBack")?.remove(); }
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeDrawer(); });

route("report", () => {
  const I = R.indices, M = R.mgmt, F = R.firm, H = R.hidden_capacity;
  const spots = R.areas.filter((a) => a.blind_spot).length;
  return `
  ${appBar("report")}
  <section class="section" style="padding-top:32px"><div class="wrap stack-lg">
    <div class="report-head">
      <div class="row" style="justify-content:space-between;align-items:flex-end">
        <div class="stack" style="gap:8px"><span class="eyebrow">Operational risk &amp; performance assessment · ${esc(F.date)}</span>
          <h1 style="font-size:var(--step-3)">${esc(F.name)}</h1>
          <span class="muted small">${esc(F.centre)} · ${F.headcount} staff · ${F.valid_responses} valid responses from ${F.received} received (${f0(F.response_rate * 100)}% response rate)</span></div>
        <span class="chip warn"><span class="dot"></span>Fictional sample</span>
      </div>
      <div class="kpis">
        <div class="kpi"><span class="k">Loss Index</span><span class="v">${f0(I.loss)}<small> /100</small></span><span class="s">${I.band_loss} · peers ${f0(I.peer_loss)}</span></div>
        <div class="kpi"><span class="k">Performance Index</span><span class="v">${f0(I.perf)}<small> /100</small></span><span class="s">${I.band_perf} · peers ${f0(I.peer_perf)}</span></div>
        <div class="kpi"><span class="k">Archetype</span><span class="v" style="font-family:var(--font-display);font-stretch:112%">${esc(I.archetype)}</span><span class="s">${I.robust ? "Robust to equal weights" : "Sensitive to weights"}</span></div>
        <div class="kpi"><span class="k">Management vs staff</span><span class="v">${sign(M.avg_perception_gap)}</span><span class="s">${spots} blind spot${spots === 1 ? "" : "s"} · management see ${esc(M.archetype)}</span></div>
        <div class="kpi"><span class="k">Leadership</span><span class="v">${f0(M.capability)}</span><span class="s">capability · alignment ${f0(M.alignment)}</span></div>
        <div class="kpi"><span class="k">Hidden capacity</span><span class="v">${f1(H.fte)}<small> FTE</small></span><span class="s">c. USD ${f1(H.usd / 1e6)}m a year · ${f1(H.recoverable_fte)} FTE recoverable</span></div>
      </div>
    </div>
    <div class="grid-2">
      <div class="stack"><span class="eyebrow">Key messages</span>${keyMessages()}</div>
      <div class="panel stack">
        <div class="row" style="justify-content:space-between">
          <span class="eyebrow">Where the firm sits</span>
          <div class="seg" role="group" aria-label="Chart view"><button data-view="matrix" aria-pressed="${reportState.view === "matrix"}">Matrix</button><button data-view="tilt" aria-pressed="${reportState.view === "tilt"}">Loss tilt</button></div>
        </div>
        <div class="chart" id="posChart">${reportState.view === "matrix" ? matrixChart() : tiltChart()}</div>
        <p class="small faint" id="posNote">${reportState.view === "matrix" ? "Nine zones from the two indices. Real firms tend to sit close to the diagonal, because most areas matter for both." : "Loss tilt = Loss Index minus Performance Index. Positive means better protected than performing; negative means performing ahead of its controls."}</p>
        <p class="small muted"><strong>Discovery question:</strong> which of these two views is more useful to your board?</p>
      </div>
    </div>
  </div></section>

  <section class="section"><div class="wrap stack-lg">
    <div class="row" style="justify-content:space-between;align-items:flex-end">
      <div class="stack" style="gap:8px"><span class="eyebrow">20 areas</span><h2>Area scores</h2></div>
      <div class="legend"><span><i style="width:18px;height:8px;background:var(--band-2)"></i>score</span><span><i style="width:18px;height:2px;background:var(--fg)"></i>95% range</span><span><i style="width:2px;height:14px;background:var(--fg-3)"></i>peers</span><span><i style="width:3px;height:9px;background:var(--accent)"></i>management</span></div>
    </div>
    <p class="muted small">Select an area for what it covers, its checks and its department view. Bands: ${BANDS.map((b) => `${b.label} ${b.from}+`).join(" · ")}.</p>
    ${areasHTML()}
  </div></section>

  <section class="section"><div class="wrap grid-2">
    <div class="stack"><span class="eyebrow">Priorities</span><h2>Where to act first</h2>
      <p class="muted small">Priority combines how weak an area is with how much it matters for loss and for performance in your business lines.</p>
      <div class="table-wrap"><table><thead><tr><th>#</th><th>Area</th><th class="n">Score</th><th class="n">Priority</th></tr></thead>
      <tbody>${R.priorities.top.map((p, i) => `<tr><td class="mono">${i + 1}</td><td>${esc(p.name)}</td><td class="n">${f0(R.areas.find((a) => a.code === p.code).score)}</td><td class="n">${f1(p.priority)}</td></tr>`).join("")}</tbody></table></div>
      <p class="small faint">Equal-weight check: index ${f1(I.equal_weight_index)}, ${I.top3_overlap} of the top 3 priorities unchanged → ${esc(I.robustness)}.</p>
    </div>
    <div class="stack"><span class="eyebrow">Perception gap</span><h2>Management and staff, side by side</h2>
      <div class="chart">${gapChart()}</div>
    </div>
  </div></section>

  <section class="section"><div class="wrap stack-lg">
    <div class="stack" style="gap:8px"><span class="eyebrow">Departments</span><h2>Where the differences are</h2></div>
    <div id="deptBox" class="stack">${deptHTML()}</div>
  </div></section>

  <section class="section"><div class="wrap grid-2">
    <div class="stack"><span class="eyebrow">Outside evidence</span><h2>Checks</h2>
      <div class="table-wrap"><table><thead><tr><th>Check</th><th>Area</th><th class="n">Result</th><th class="n">Score</th></tr></thead>
      <tbody>${R.checks.map((c) => `<tr><td>${esc(c.name)}</td><td class="mono">${c.area}</td><td class="n">${c.run ? (c.result < 1 && c.result > 0 ? f0(c.result * 100) + "%" : f0(c.result)) : "–"}</td><td class="n">${c.run ? f0(c.score) : "not run"}</td></tr>`).join("")}</tbody></table></div>
    </div>
    <div class="stack"><span class="eyebrow">Footprint</span><h2>Country exposure</h2>
      <p class="muted small">Footprint-weighted country risk (0–100). Above ${P.exposure_baseline}, each point costs ${P.penalty_per_point} of a point on the related area. Country values are illustrative.</p>
      <div class="table-wrap"><table><thead><tr><th>Exposure</th><th>Area</th><th class="n">Level</th><th>Penalty</th></tr></thead>
      <tbody>${R.exposures.map((e) => `<tr><td>${esc(e.name)}</td><td class="mono">${e.area}</td><td class="n">${f1(e.value)}</td><td>${e.penalty_applies ? `<span class="chip crit">applies</span>` : `<span class="faint">none</span>`}</td></tr>`).join("")}</tbody></table></div>
    </div>
  </div></section>

  <section class="section"><div class="wrap stack-lg">
    <div class="stack" style="gap:8px"><span class="eyebrow">Leadership</span><h2>Capability and alignment</h2>
      <p class="muted small">Capability is scored from factual answers (risk appetite use, cover for key roles, provider ownership, continuity testing, regulatory review, incident reporting, cyber first contact). MC1 counts how many of each manager’s top-5 risks match the assessment’s top 5; it is not scored.</p></div>
    <div class="table-wrap"><table><thead><tr><th>Manager</th><th class="n">Top-5 overlap</th>${["Appetite", "Cover", "Providers", "Continuity", "Reg. change", "Incidents", "Cyber"].map((h) => `<th class="n">${h}</th>`).join("")}<th class="n">Capability</th></tr></thead>
    <tbody>${M.managers.map((m) => `<tr><td>${esc(m.role)}</td><td class="n">${m.mc1} / 5</td>${["mc2", "mc3", "mc4", "mc5", "mc6", "mc7", "mc8"].map((k) => `<td class="n">${f0(m[k])}</td>`).join("")}<td class="n"><strong>${f0(m.capability)}</strong></td></tr>`).join("")}</tbody></table></div>
    <p class="small faint">All data fictional. Peer figures and country values illustrative. Methodology v${esc(U.methodology_version)}.</p>
  </div></section>`;
}, {
  after(main) {
    main.addEventListener("click", (e) => {
      const v = e.target.closest("[data-view]");
      if (v) {
        reportState.view = v.dataset.view;
        $$("[data-view]", main).forEach((b) => b.setAttribute("aria-pressed", String(b === v)));
        $("#posChart").innerHTML = reportState.view === "matrix" ? matrixChart() : tiltChart();
        $("#posNote").textContent = reportState.view === "matrix" ? "Nine zones from the two indices. Real firms tend to sit close to the diagonal, because most areas matter for both." : "Loss tilt = Loss Index minus Performance Index. Positive means better protected than performing; negative means performing ahead of its controls.";
        return;
      }
      const l = e.target.closest("[data-level]");
      if (l) { reportState.level = l.dataset.level; $("#deptBox").innerHTML = deptHTML(); return; }
      const a = e.target.closest("[data-area]");
      if (a) openDrawer(a.dataset.area);
    });
  },
});

function appBar(current) {
  const tabs = [["setup", "1 · Set-up"], ["survey", "2 · Survey"], ["report", "3 · Report"]];
  return `<div class="app-bar"><div class="wrap"><nav class="tabs" aria-label="Demo">${tabs.map(([h, l]) => `<a href="#${h}" ${h === current ? 'aria-current="page"' : ""}>${l}</a>`).join("")}</nav><span class="chip warn"><span class="dot"></span>Demo · fictional data</span></div></div>`;
}
