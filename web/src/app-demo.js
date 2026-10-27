/* Surface Risk prototype — administrator set-up wizard and staff / management survey.
   Everything is held in memory; nothing leaves the browser. */
"use strict";

const PROFILE = D.profile;
const COUNTRIES = Object.keys(U.country_risk.countries);
const IDX = U.country_risk.index_types;
const TIER_PTS = P.tier_points; // {H:3, M:2, L:1}
const HIER = U.department_hierarchy;

/* ---------------- Set-up wizard ---------------- */
const setup = {
  step: 0,
  name: PROFILE.name, centre: "DIFC (DFSA)", headcount: PROFILE.headcount, levelOverride: "",
  bl: { ...PROFILE.business_line_mix },
  office: Object.keys(PROFILE.footprint.OFF)[0],
  parent: Object.keys(PROFILE.footprint.AFF)[0],
  clients: Object.entries(PROFILE.footprint.CLI).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([c, s]) => ({ c, s: Math.round(s * 100) })),
  providers: PROFILE.providers.map((p) => ({ ...p })),
  providerShares: { ...PROFILE.footprint.PRV },
  counterparties: { ...PROFILE.footprint.CPT },
  domain: PROFILE.domains, firstContact: PROFILE.first_contact, lei: "lapsed",
  checks: Object.fromEntries(U.checks.map((c) => [c.id, c.id !== "C09"])),
  rosterLoaded: true,
};
const STEPS = ["Firm", "Business lines", "Footprint", "Checks", "Staff list", "Launch"];

function defaultLevel(n) {
  for (const r of U.default_reporting_level) if (r.max_headcount_exclusive == null || n < r.max_headcount_exclusive) return r.level;
  return "C";
}
function level() { return setup.levelOverride || defaultLevel(setup.headcount); }

function firmWeights() {
  const mix = Object.entries(setup.bl).filter(([, s]) => s > 0);
  const tot = mix.reduce((t, [, s]) => t + s, 0) || 1;
  const rows = U.areas.map((a) => {
    let lp = 0, pp = 0;
    if (!mix.length) { lp = TIER_PTS[a.loss_tier]; pp = TIER_PTS[a.perf_tier]; }
    mix.forEach(([bl, s]) => {
      lp += (s / tot) * TIER_PTS[a.loss_overrides[bl] || a.loss_tier];
      pp += (s / tot) * TIER_PTS[a.perf_overrides[bl] || a.perf_tier];
    });
    return { code: a.code, name: a.name, lp, pp, baseL: TIER_PTS[a.loss_tier], baseP: TIER_PTS[a.perf_tier] };
  });
  const sl = rows.reduce((t, r) => t + r.lp, 0), sp = rows.reduce((t, r) => t + r.pp, 0);
  rows.forEach((r) => { r.lw = r.lp / sl; r.pw = r.pp / sp; });
  return rows;
}

function footprintShares() {
  const cli = {}; let used = 0;
  setup.clients.forEach(({ c, s }) => { if (c && s > 0) { cli[c] = (cli[c] || 0) + s / 100; used += s / 100; } });
  if (used < 1) cli["Rest of world (average)"] = (cli["Rest of world (average)"] || 0) + (1 - used);
  const norm = (o) => { const t = Object.values(o).reduce((a, b) => a + b, 0) || 1; return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, v / t])); };
  return { OFF: { [setup.office]: 1 }, AFF: { [setup.parent]: 1 }, CLI: norm(cli), PRV: norm(setup.providerShares), CPT: norm(setup.counterparties) };
}
function exposures() {
  const fp = footprintShares();
  const risk = (country, idx) => (U.country_risk.countries[country] || U.country_risk.countries["Rest of world (average)"])[idx];
  return U.exposures.map((e) => {
    let v = 0;
    Object.entries(e.footprint_weights).forEach(([f, w]) => {
      if (!w) return;
      Object.entries(fp[f] || {}).forEach(([c, s]) => { v += w * s * risk(c, e.index); });
    });
    return { ...e, value: v };
  });
}
function areaPenalties() {
  const ex = exposures(), by = {};
  ex.forEach((e) => { (by[e.area] = by[e.area] || []).push(e.value); });
  return Object.entries(by).map(([area, vals]) => {
    const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
    return { area, exposure: avg, penalty: P.penalty_per_point * Math.max(0, avg - P.exposure_baseline) };
  });
}

function rosterGroups(lv) {
  // Start from level C counts, aggregate to the chosen level, then merge any group below the minimum
  // into its smallest sibling under the same parent (the engine applies the same rule to actual responses).
  const key = { A: "level_a", B: "level_b", C: "level_c" }[lv];
  const parentKey = { A: null, B: "level_a", C: "level_b" }[lv];
  const groups = {};
  HIER.forEach((h) => {
    const n = D.roster[h.level_c] || 0;
    const g = (groups[h[key]] = groups[h[key]] || { name: h[key], n: 0, parent: parentKey ? h[parentKey] : "Firm" });
    g.n += n;
  });
  let list = Object.values(groups).filter((g) => g.n > 0);
  const min = P.min_reporting_group;
  let changed = true;
  while (changed) {
    changed = false;
    list.sort((a, b) => a.n - b.n);
    const small = list.find((g) => g.n < min);
    if (!small) break;
    const sib = list.filter((g) => g !== small && g.parent === small.parent).sort((a, b) => a.n - b.n)[0];
    if (sib) { sib.name = sib.name + " + " + small.name; sib.n += small.n; list = list.filter((g) => g !== small); changed = true; }
  }
  return list.sort((a, b) => b.n - a.n);
}

function stepBody() {
  const s = setup;
  switch (s.step) {
    case 0: return `<div class="stack"><h2 style="font-size:var(--step-2)">Your firm</h2>
      <div class="form-grid">
        <div class="field"><label for="su-name">Firm name</label><input id="su-name" type="text" value="${esc(s.name)}"></div>
        <div class="field"><label for="su-centre">Regulated in</label><select id="su-centre">${["DIFC (DFSA)", "ADGM (FSRA)", "UK (FCA)", "Other"].map((o) => `<option ${o === s.centre ? "selected" : ""}>${o}</option>`).join("")}</select></div>
        <div class="field"><label for="su-head">Headcount</label><input id="su-head" type="number" min="5" max="2000" value="${s.headcount}"></div>
        <div class="field"><label for="su-level">Department reporting level</label><select id="su-level">
          <option value="" ${!s.levelOverride ? "selected" : ""}>Automatic for your size (Level ${defaultLevel(s.headcount)})</option>
          <option value="A" ${s.levelOverride === "A" ? "selected" : ""}>Level A · 2 groups</option>
          <option value="B" ${s.levelOverride === "B" ? "selected" : ""}>Level B · 4 groups</option>
          <option value="C" ${s.levelOverride === "C" ? "selected" : ""}>Level C · 8 groups</option></select></div>
      </div>
      <p class="small muted">Under 30 staff reports 2 groups, 30–150 reports 4, over 150 reports all 8 departments. Any group with fewer than ${P.min_reporting_group} respondents is merged with a neighbouring team, and every report can also roll up to 2 groups for comparison with smaller firms.</p></div>`;
    case 1: {
      const tot = Object.values(s.bl).reduce((a, b) => a + b, 0);
      return `<div class="stack"><h2 style="font-size:var(--step-2)">Business lines</h2>
      <p class="small muted">Approximate share of revenue. This sets which areas matter most for loss and for performance.</p>
      <div class="table-wrap"><table><thead><tr><th>Business line</th><th class="n">Share %</th></tr></thead><tbody>
      ${U.business_lines.filter((b) => b.code !== "BL10").map((b) => `<tr><td><span class="mono faint small">${b.code}</span> ${esc(b.label)}<div class="small faint">${esc(b.guidance)}</div></td>
        <td class="n"><input type="number" min="0" max="100" step="5" style="width:80px" data-bl="${b.code}" aria-label="${esc(b.label)} share" value="${Math.round((s.bl[b.code] || 0) * 100)}"></td></tr>`).join("")}
      </tbody></table></div>
      <p class="small ${Math.abs(tot - 1) > 0.001 ? "" : "faint"}" id="blTot">Total ${Math.round(tot * 100)}%${Math.abs(tot - 1) > 0.001 ? " · shares are scaled to 100%" : ""}</p></div>`;
    }
    case 2: return `<div class="stack"><h2 style="font-size:var(--step-2)">Where you operate</h2>
      <div class="form-grid">
        <div class="field"><label for="su-off">Main office country</label><select id="su-off">${COUNTRIES.map((c) => `<option ${c === s.office ? "selected" : ""}>${esc(c)}</option>`).join("")}</select></div>
        <div class="field"><label for="su-aff">Parent or main affiliate</label><select id="su-aff">${COUNTRIES.map((c) => `<option ${c === s.parent ? "selected" : ""}>${esc(c)}</option>`).join("")}</select></div>
      </div>
      <div class="stack" style="gap:8px"><span class="label">Top 5 client countries (share of clients or assets)</span>
      ${s.clients.map((r, i) => `<div class="row"><select data-cli="${i}" aria-label="Client country ${i + 1}" style="flex:1 1 200px">${COUNTRIES.map((c) => `<option ${c === r.c ? "selected" : ""}>${esc(c)}</option>`).join("")}</select>
        <input type="number" min="0" max="100" step="5" data-clis="${i}" aria-label="Share for client country ${i + 1}" value="${r.s}" style="width:90px"><span class="small faint">%</span></div>`).join("")}
      <span class="small faint">The remainder counts as “rest of world”.</span></div>
      <div class="stack" style="gap:6px"><span class="label">Material providers (from your provider list)</span>
      <div class="table-wrap"><table><thead><tr><th>Provider</th><th>Data held in</th><th>Owner</th></tr></thead><tbody>${s.providers.map((p) => `<tr><td>${esc(p.name)}<div class="small faint">${esc(p.service)}</div></td><td>${esc(p.data_country)}</td><td>${esc(p.owner)}</td></tr>`).join("")}</tbody></table></div></div></div>`;
    case 3: return `<div class="stack"><h2 style="font-size:var(--step-2)">Technical set-up and checks</h2>
      <div class="form-grid">
        <div class="field"><label for="su-dom">Email and web domain</label><input id="su-dom" type="text" value="${esc(s.domain)}"></div>
        <div class="field"><label for="su-fc">First contact for a cyber incident</label><input id="su-fc" type="text" value="${esc(s.firstContact)}"></div>
        <div class="field"><label for="su-lei">Legal Entity Identifier</label><select id="su-lei"><option value="active" ${s.lei === "active" ? "selected" : ""}>Active</option><option value="lapsed" ${s.lei === "lapsed" ? "selected" : ""}>Lapsed</option><option value="none" ${s.lei === "none" ? "selected" : ""}>None</option></select></div>
      </div>
      <p class="small muted">We confirm you control the domain with a DNS record before any external check runs.</p>
      <div class="checks-list">${U.checks.filter((c) => c.id.startsWith("C")).map((c) => `<label class="check"><input type="checkbox" data-check="${c.id}" ${s.checks[c.id] ? "checked" : ""}>
        <span><strong style="color:var(--fg)">${esc(c.name)}</strong> <span class="mono faint small">${c.area} · ${Math.round(c.weight * 100)}% of area</span><br><span class="small">${esc(c.metric)}${c.id === "C07" ? ". Run by a partner; your IT team allow-lists the sender." : ""}${c.id === "C09" ? ". Optional; needs CEO authorisation." : ""}</span></span></label>`).join("")}</div>
      <p class="small faint">Two more indicators come from the staff survey itself: key-person dependency and unclear responsibilities.</p></div>`;
    case 4: {
      const lv = level(), groups = rosterGroups(lv), a = rosterGroups("A");
      const total = Object.values(D.roster).reduce((x, y) => x + y, 0);
      return `<div class="stack"><h2 style="font-size:var(--step-2)">Staff list</h2>
      <p class="small muted">Upload a CSV with name, email, department, business line and seniority. Emails are stored separately from answers and used only to send invitations and reminders.</p>
      <div class="row"><button class="btn small" type="button" id="loadRoster">${s.rosterLoaded ? "Sample list loaded" : "Load sample staff list"}</button><span class="small faint">${total} people · fictional</span></div>
      <div class="grid-2" style="gap:16px">
        <div class="stack" style="gap:8px"><span class="eyebrow">Reporting groups · Level ${lv}</span>
          <div class="table-wrap"><table><tbody>${groups.map((g) => `<tr><td>${esc(g.name)}</td><td class="n">${g.n}</td></tr>`).join("")}</tbody></table></div></div>
        <div class="stack" style="gap:8px"><span class="eyebrow">Roll-up for comparison · Level A</span>
          <div class="table-wrap"><table><tbody>${a.map((g) => `<tr><td>${esc(g.name)}</td><td class="n">${g.n}</td></tr>`).join("")}</tbody></table></div></div>
      </div>
      <p class="small faint">Groups are checked again on actual responses; any that fall below ${P.min_reporting_group} are merged before the report is produced.</p></div>`;
    }
    default: {
      const pen = areaPenalties().filter((p) => p.penalty > 0);
      return `<div class="stack"><h2 style="font-size:var(--step-2)">Ready to launch</h2>
      <dl class="kv"><dt>Firm</dt><dd>${esc(s.name)}</dd><dt>Invitations</dt><dd>${Object.values(D.roster).reduce((x, y) => x + y, 0)}</dd><dt>Reporting level</dt><dd>Level ${level()}</dd>
      <dt>Checks scheduled</dt><dd>${Object.values(s.checks).filter(Boolean).length}</dd><dt>Survey window</dt><dd>2 weeks</dd><dt>Staff time</dt><dd>12–15 min each</dd>
      <dt>Areas with an exposure penalty</dt><dd>${pen.length ? pen.map((p) => p.area).join(", ") : "none"}</dd></dl>
      <div class="notice">In the live product this sends invitations and starts the checks. In this demo, continue to the survey or the sample report.</div>
      <div class="row"><a class="btn primary" href="#survey">Open the staff survey</a><a class="btn" href="#report">View the sample report</a></div></div>`;
    }
  }
}

function asideHTML() {
  const w = firmWeights();
  const topL = [...w].sort((a, b) => b.lw - a.lw).slice(0, 5), topP = [...w].sort((a, b) => b.pw - a.pw).slice(0, 5);
  const changed = w.filter((r) => Math.abs(r.lp - r.baseL) > 0.01 || Math.abs(r.pp - r.baseP) > 0.01);
  const ex = exposures(), pen = areaPenalties();
  return `<div class="panel stack" style="gap:14px">
    <span class="eyebrow">Live preview</span>
    <div class="stack" style="gap:6px"><span class="label">Most important for loss</span>${topL.map((r) => `<div class="row small" style="justify-content:space-between"><span class="muted">${esc(r.name)}</span><span class="mono">${f1(r.lw * 100)}%</span></div>`).join("")}</div>
    <div class="stack" style="gap:6px"><span class="label">Most important for performance</span>${topP.map((r) => `<div class="row small" style="justify-content:space-between"><span class="muted">${esc(r.name)}</span><span class="mono">${f1(r.pw * 100)}%</span></div>`).join("")}</div>
    ${changed.length ? `<p class="small faint">Adjusted for your business lines: ${changed.map((r) => esc(r.name)).join(", ")}.</p>` : ""}
    <hr class="rule">
    <div class="stack" style="gap:6px"><span class="label">Country exposure (illustrative values)</span>
      ${ex.map((e) => `<div class="stack" style="gap:3px"><div class="row small" style="justify-content:space-between"><span class="muted">${esc(e.name.replace(" exposure", ""))}</span><span class="mono">${f0(e.value)}</span></div>
        <div class="bar-track"><div class="bar-fill" style="width:${clamp(e.value, 0, 100)}%;background:${e.value > P.exposure_baseline ? "var(--warn)" : "var(--steel)"}"></div></div></div>`).join("")}
      <p class="small faint">Above ${P.exposure_baseline} a penalty applies: ${pen.filter((p) => p.penalty > 0).map((p) => `${p.area} −${f1(p.penalty)}`).join(", ") || "none at present"}.</p>
    </div></div>`;
}

route("setup", () => `${appBar("setup")}
  <section class="section" style="padding-top:28px"><div class="wrap stack-lg">
    <div class="stack" style="gap:8px"><span class="eyebrow">Administrator set-up · about 40 minutes in the live product</span><h1 style="font-size:var(--step-3)">Set up an assessment</h1>
    <p class="muted">Pre-filled with Example Wealth Partners, a fictional DIFC firm. Change anything and watch the preview.</p></div>
    <div class="wizard">
      <ol class="step-list" id="stepList" aria-label="Set-up steps"></ol>
      <div class="panel stack" id="stepBody"></div>
      <div class="aside" id="stepAside"></div>
    </div>
  </div></section>`, {
  after(main) {
    const paint = () => {
      $("#stepList").innerHTML = STEPS.map((n, i) => `<li><button type="button" data-step="${i}" class="${i < setup.step ? "done" : ""}" ${i === setup.step ? 'aria-current="step"' : ""}><span class="i">${i < setup.step ? "✓" : i + 1}</span>${n}</button></li>`).join("");
      $("#stepBody").innerHTML = stepBody() + (setup.step < STEPS.length - 1 ? `<div class="row" style="justify-content:space-between;margin-top:8px"><button class="btn" type="button" data-nav-step="-1" ${setup.step === 0 ? "disabled" : ""}>Back</button><button class="btn primary" type="button" data-nav-step="1">Continue</button></div>` : "");
      $("#stepAside").innerHTML = asideHTML();
    };
    const refreshAside = () => { $("#stepAside").innerHTML = asideHTML(); };
    paint();
    main.addEventListener("click", (e) => {
      const st = e.target.closest("[data-step]");
      if (st) { setup.step = +st.dataset.step; paint(); return; }
      const nv = e.target.closest("[data-nav-step]");
      if (nv && !nv.disabled) { setup.step = clamp(setup.step + +nv.dataset.navStep, 0, STEPS.length - 1); paint(); $("#stepBody").scrollIntoView({ block: "nearest" }); return; }
      if (e.target.id === "loadRoster") { setup.rosterLoaded = true; toast("Sample staff list loaded"); }
    });
    main.addEventListener("input", (e) => {
      const t = e.target;
      if (t.id === "su-name") setup.name = t.value;
      if (t.id === "su-head") { setup.headcount = Math.max(1, +t.value || 1); const opt = $("#su-level option[value='']"); if (opt) opt.textContent = `Automatic for your size (Level ${defaultLevel(setup.headcount)})`; }
      if (t.dataset.bl) { setup.bl[t.dataset.bl] = Math.max(0, +t.value || 0) / 100; const tot = Object.values(setup.bl).reduce((a, b) => a + b, 0); $("#blTot").textContent = `Total ${Math.round(tot * 100)}%${Math.abs(tot - 1) > 0.001 ? " · shares are scaled to 100%" : ""}`; }
      if (t.dataset.clis) setup.clients[+t.dataset.clis].s = Math.max(0, +t.value || 0);
      if (t.id === "su-dom") setup.domain = t.value;
      if (t.id === "su-fc") setup.firstContact = t.value;
      refreshAside();
    });
    main.addEventListener("change", (e) => {
      const t = e.target;
      if (t.id === "su-centre") setup.centre = t.value;
      if (t.id === "su-level") setup.levelOverride = t.value;
      if (t.id === "su-off") setup.office = t.value;
      if (t.id === "su-aff") setup.parent = t.value;
      if (t.dataset.cli) setup.clients[+t.dataset.cli].c = t.value;
      if (t.id === "su-lei") setup.lei = t.value;
      if (t.dataset.check) setup.checks[t.dataset.check] = t.checked;
      refreshAside();
    });
  },
});

/* ---------------- Survey ---------------- */
const ANCHORS = {
  "How true (5 anchors)": ["Not true", "Rarely true", "Partly true", "Mostly true", "Fully true"],
  "How often (5 anchors)": ["Never", "Rarely", "Sometimes", "Often", "Very often"],
};
const SCENARIO_Q44 = [
  ["Process it as asked", 0], ["Reply to the email to confirm", 25], ["Ask a colleague whether it looks genuine", 50],
  ["Call the client on the number already on file, or pass it to payments flagged as suspicious", 100],
];
const survey = { role: "staff", page: 0, answers: {}, profile: {}, activity: { a3: [], a4: [] }, mc: { mc1: [] }, ma: {} };

function surveyPages() {
  const pages = [{ kind: "intro" }, { kind: "profile" }];
  const codes = U.areas.map((a) => a.code);
  for (let i = 0; i < codes.length; i += 3) pages.push({ kind: "statements", areas: codes.slice(i, i + 3) });
  pages.push({ kind: "activity" }, { kind: "open" });
  if (survey.role === "mgmt") pages.push({ kind: "capability" }, { kind: "alignment" });
  pages.push({ kind: "done" });
  return pages;
}

function answerValue(st, raw) {
  if (raw == null || raw === "dk") return null;
  const v = typeof raw === "number" ? raw : raw === "Yes" ? 100 : 0;
  return st.reverse ? 100 - v : v;
}

function statementHTML(st) {
  const cur = survey.answers[st.id];
  let ctrl;
  if (st.format.startsWith("How")) {
    const labels = ANCHORS[st.format];
    ctrl = `<div class="anchors" role="group" aria-label="Answer">${labels.map((l, i) => `<button type="button" data-ans="${st.id}" data-v="${i * 25}" aria-pressed="${cur === i * 25}">${l}</button>`).join("")}<button type="button" class="dk" data-ans="${st.id}" data-v="dk" aria-pressed="${cur === "dk"}">Don’t know</button></div>`;
  } else if (st.format === "Yes / No") {
    ctrl = `<div class="opts inline" role="group" aria-label="Answer">${["Yes", "No"].map((l) => `<button type="button" data-ans="${st.id}" data-v="${l}" aria-pressed="${cur === l}">${l}</button>`).join("")}<button type="button" data-ans="${st.id}" data-v="dk" aria-pressed="${cur === "dk"}">Don’t know</button></div>`;
  } else {
    ctrl = `<div class="opts" role="group" aria-label="Answer">${SCENARIO_Q44.map(([l, v]) => `<button type="button" data-ans="${st.id}" data-v="${v}" aria-pressed="${cur === v}">${esc(l)}</button>`).join("")}</div>`;
  }
  const text = st.text.replace(/^Scenario: /, "");
  return `<div class="q"><span class="qid">${st.id}</span><div class="qtext">${esc(text)}</div>${ctrl}</div>`;
}

function optButtons(key, opts, cur, multi = false) {
  return `<div class="opts inline" role="group">${opts.map((o) => `<button type="button" data-${multi ? "multi" : "pick"}="${key}" data-v="${esc(o)}" aria-pressed="${multi ? (cur || []).includes(o) : cur === o}">${esc(o)}</button>`).join("")}</div>`;
}

function pageHTML(pg, idx, total) {
  const head = (t, sub) => `<div class="stack" style="gap:8px"><span class="eyebrow">${survey.role === "mgmt" ? "Management survey" : "Staff survey"} · page ${idx} of ${total - 1}</span><h2 style="font-size:var(--step-2)">${t}</h2>${sub ? `<p class="muted small">${sub}</p>` : ""}</div>`;
  switch (pg.kind) {
    case "intro": return `<div class="stack-lg"><div class="stack" style="gap:10px"><span class="eyebrow">Example Wealth Partners · fictional</span><h1 style="font-size:var(--step-3)">How work really gets done here</h1>
      <p class="muted">This survey asks about everyday practice in your firm: what helps you do your job well and what gets in the way. It takes 12 to 15 minutes. There are no right answers.</p></div>
      <ul class="ticks"><li><strong>Your answers are confidential.</strong> Your name and email are stored separately from your answers.</li><li><strong>No small groups.</strong> Results are only ever shown for groups of ${P.min_reporting_group} or more.</li><li><strong>“Don’t know” is fine.</strong> It is better than guessing.</li></ul>
      <div class="stack" style="gap:8px"><span class="label">Demo: answer as</span><div class="seg" role="group" aria-label="Respondent type"><button type="button" data-role="staff" aria-pressed="${survey.role === "staff"}">Staff member</button><button type="button" data-role="mgmt" aria-pressed="${survey.role === "mgmt"}">Senior manager</button></div></div></div>`;
    case "profile": return `${head("About you", "Used only to group results. Groups smaller than five are merged.")}
      <div class="stack"><span class="label">Department</span>${optButtons("Z1", HIER.map((h) => h.level_c), survey.profile.Z1)}
      <span class="label">Business line you mainly work in</span>${optButtons("Z2", ["Asset Management", "Private Banking & Wealth", "Firm-wide / shared"], survey.profile.Z2)}
      <span class="label">Seniority</span>${optButtons("Z3", ["Director / C-suite", "Line manager", "Individual contributor"], survey.profile.Z3)}
      <span class="label">Length of service</span>${optButtons("Z4", ["Less than 1 year", "1–3 years", "More than 3 years"], survey.profile.Z4)}</div>`;
    case "statements": {
      const parts = surveyPages().filter((p) => p.kind === "statements");
      const sts = U.statements.filter((s) => pg.areas.includes(s.area));
      return `${head(`Everyday practice · part ${parts.findIndex((p) => p.areas[0] === pg.areas[0]) + 1} of ${parts.length}`, "Think about the last few months. Answer for your own area of work.")}<div>${sts.map(statementHTML).join("")}</div>`;
    }
    case "activity": {
      const procs = U.processes.map((p) => p.name);
      return `${head("Where your time goes")}
      <div class="stack"><span class="label">Which activity takes most of your time?</span><select id="a1" aria-label="Main activity"><option value="">Choose an activity</option>${procs.map((p) => `<option ${survey.activity.a1 === p ? "selected" : ""}>${esc(p)}</option>`).join("")}</select>
      <span class="label">Roughly what share of your time goes on rework, chasing, manual workarounds or fixing errors?</span>${optButtons("A2", ["Under 5%", "5–10%", "10–20%", "20–30%", "Over 30%"], survey.activity.A2)}
      <span class="label">For which activities are you the only person who knows how to do the work?</span>${optButtons("a3", procs, survey.activity.a3, true)}
      <span class="label">For which activities is it unclear who is responsible or who should decide?</span>${optButtons("a4", procs, survey.activity.a4, true)}</div>`;
    }
    case "open": return `${head("In your own words", "Optional. Comments are grouped into themes; individual comments are never attributed. Anything suggesting someone may be at risk is read by a person.")}
      <div class="stack"><div class="field"><label for="o1">${esc(U.open[0].text)}</label><textarea id="o1">${esc(survey.o1 || "")}</textarea></div>
      <div class="field"><label for="o2">${esc(U.open[1].text)}</label><textarea id="o2">${esc(survey.o2 || "")}</textarea></div></div>`;
    case "capability": {
      const owners = ["COO", "Head of Operations", "Head of Technology", "CEO", "Head of Compliance & Risk", "Don't know"];
      return `${head("For senior managers: how the firm is run", "Factual questions. Please answer for the firm as it is today.")}
      <div class="stack"><span class="label">MC1 · Select the five areas you believe pose the greatest risk to the firm today (${survey.mc.mc1.length}/5)</span>${optButtons("mc1", U.areas.map((a) => a.name), survey.mc.mc1, true)}
      ${U.mgmt_capability.filter((q) => q.options_list).map((q) => `<span class="label">${q.id} · ${esc(q.text)}</span>${optButtons(q.id, q.options_list, survey.mc[q.id])}`).join("")}
      <span class="label">MC4 · For each material provider, who is the internal owner accountable for it?</span>
      <div class="table-wrap"><table><tbody>${PROFILE.providers.map((p, i) => `<tr><td>${esc(p.name)}</td><td><select data-mc4="${i}" aria-label="Owner for ${esc(p.name)}"><option value="">Choose</option>${owners.map((o) => `<option ${survey.mc["mc4_" + i] === o ? "selected" : ""}>${esc(o)}</option>`).join("")}</select></td></tr>`).join("")}</tbody></table></div>
      <span class="label">MC8 · In the first hour of a suspected cyber incident, who would you contact first?</span>${optButtons("MC8a", ["IT provider incident line", "Head of Technology", "Insurer's breach line", "Regulator", "Don't know"], survey.mc.MC8a)}
      <span class="label">Is that contact stored somewhere you can reach without your work devices?</span>${optButtons("MC8b", ["Yes", "No"], survey.mc.MC8b)}</div>`;
    }
    case "alignment": return `${head("For senior managers: where you stand", "How strongly do you agree? Leadership alignment is measured by how much managers’ answers differ.")}
      <div class="stack">${U.alignment.map((q) => `<div class="field"><label for="ma-${q.id}">${q.id} · ${esc(q.text)}</label><input type="range" id="ma-${q.id}" data-ma="${q.id}" min="0" max="100" step="5" value="${survey.ma[q.id] ?? 50}"><div class="row small faint" style="justify-content:space-between"><span>Disagree</span><span class="mono" id="mav-${q.id}">${survey.ma[q.id] ?? 50}</span><span>Agree</span></div></div>`).join("")}</div>`;
    default: return doneHTML();
  }
}

function personalAreaScores() {
  return U.areas.map((a) => {
    const vals = U.statements.filter((s) => s.area === a.code).map((s) => answerValue(s, survey.answers[s.id])).filter((v) => v != null);
    return { ...a, n: vals.length, score: vals.length ? vals.reduce((x, y) => x + y, 0) / vals.length : null };
  });
}
function capabilityScore() {
  const ms = U.mgmt_capability, sc = [];
  const pts = (id, ans) => { const t = D.mgmtScoring[id]; const r = t && t.find((x) => x.answer === ans); return r ? r.points : null; };
  ["MC2", "MC3", "MC5", "MC6", "MC7"].forEach((id) => { const p = pts(id, survey.mc[id]); if (p != null) sc.push(p); });
  const owned = PROFILE.providers.filter((p, i) => survey.mc["mc4_" + i]).length;
  if (owned) sc.push((PROFILE.providers.filter((p, i) => survey.mc["mc4_" + i] === p.owner).length / PROFILE.providers.length) * 100);
  if (survey.mc.MC8a) sc.push((survey.mc.MC8a === PROFILE.first_contact ? 50 : 0) + (survey.mc.MC8b === "Yes" ? 50 : 0));
  return sc.length ? sc.reduce((a, b) => a + b, 0) / sc.length : null;
}

function doneHTML() {
  const sc = personalAreaScores().filter((a) => a.score != null);
  const answered = U.statements.filter((s) => survey.answers[s.id] != null).length;
  const top = new Set(R.priorities.top.map((p) => areaMeta[p.code].name));
  const overlap = survey.mc.mc1.filter((n) => top.has(n)).length;
  const cap = capabilityScore();
  return `<div class="stack-lg"><div class="stack" style="gap:10px"><span class="eyebrow">Thank you</span><h1 style="font-size:var(--step-3)">Your answers are in</h1>
    <p class="muted">You answered ${answered} of 60 statements. In the live product your answers join your colleagues’ and appear only in group results.</p></div>
    ${sc.length ? `<div class="panel stack"><div class="row" style="justify-content:space-between"><span class="eyebrow">Demo only: how your answers score</span><span class="small faint">respondents do not see this in the live product</span></div>
      <div class="stack" style="gap:6px">${sc.map((a) => `<div class="stack" style="gap:3px"><div class="row small" style="justify-content:space-between"><span class="muted">${esc(a.name)}</span><span class="mono">${f0(a.score)}</span></div><div class="bar-track"><div class="bar-fill" style="width:${a.score}%;background:var(--band-${bandOf(a.score).idx})"></div></div></div>`).join("")}</div></div>` : ""}
    ${survey.role === "mgmt" ? `<div class="panel stack"><span class="eyebrow">Demo only: your management answers</span><dl class="kv"><dt>Your top-5 risks matching the sample firm’s top 5 priorities</dt><dd>${overlap} / 5</dd><dt>Capability score from your factual answers</dt><dd>${cap == null ? "–" : f0(cap)}</dd></dl></div>` : ""}
    <div class="row"><a class="btn primary" href="#report">See the sample report</a><button class="btn" type="button" id="restart">Start again</button></div></div>`;
}

function fillSample() {
  // Plausible answers around the fictional firm's staff scores for each area.
  let seed = 7;
  const rnd = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);
  U.statements.forEach((s) => {
    const base = R.areas.find((a) => a.code === s.area).survey;
    let v = clamp(base + (rnd() - 0.5) * 50, 0, 100);
    if (s.reverse) v = 100 - v;
    if (s.format === "Yes / No") survey.answers[s.id] = v >= 50 ? "Yes" : "No";
    else if (s.format.startsWith("How")) survey.answers[s.id] = Math.round(v / 25) * 25;
    else survey.answers[s.id] = [0, 25, 50, 100][Math.min(3, Math.floor(v / 26))];
  });
  survey.profile = { Z1: HIER[2].level_c, Z2: "Asset Management", Z3: "Individual contributor", Z4: "1–3 years" };
  survey.activity = { a1: U.processes[5].name, A2: "10–20%", a3: [U.processes[6].name], a4: [U.processes[3].name] };
  if (survey.role === "mgmt") {
    survey.mc = { mc1: ["Cyber security & access", "External fraud", "Process execution", "Governance & oversight", "Culture & speak-up"], MC2: "Documented but rarely used", MC3: "1", MC5: "12-24 months", MC6: "3-12 months", MC7: "Quarterly", MC8a: "IT provider incident line", MC8b: "No" };
    PROFILE.providers.forEach((p, i) => { survey.mc["mc4_" + i] = i % 2 ? "COO" : p.owner; });
    U.alignment.forEach((q, i) => { survey.ma[q.id] = [70, 40, 60, 55, 35, 80, 30, 50][i] ?? 50; });
  }
}

route("survey", () => `${appBar("survey")}
  <section class="section" style="padding-top:28px"><div class="wrap"><div class="survey stack-lg" id="surveyBox"></div></div></section>`, {
  after(main) {
    const box = $("#surveyBox", main);
    const paint = () => {
      const pages = surveyPages();
      survey.page = clamp(survey.page, 0, pages.length - 1);
      const pg = pages[survey.page];
      const answered = U.statements.filter((s) => survey.answers[s.id] != null).length;
      const nav = pg.kind === "done" ? "" : `<div class="row" style="justify-content:space-between">
        <button class="btn" type="button" data-pg="-1" ${survey.page === 0 ? "disabled" : ""}>Back</button>
        <div class="row"><button class="btn small" type="button" id="fill">Fill with sample answers</button><button class="btn primary" type="button" data-pg="1">${survey.page === pages.length - 2 ? "Submit" : survey.page === 0 ? "Start" : "Next"}</button></div></div>`;
      box.innerHTML = `<div class="stack" style="gap:8px"><div class="progress" aria-hidden="true"><div style="width:${(survey.page / (pages.length - 1)) * 100}%"></div></div><span class="small faint">${answered} of 60 statements answered</span></div>
        ${pageHTML(pg, survey.page, pages.length)}${nav}`;
    };
    paint();
    box.addEventListener("click", (e) => {
      const t = e.target.closest("button");
      if (!t) return;
      if (t.dataset.role) { survey.role = t.dataset.role; paint(); return; }
      if (t.dataset.pg) { survey.page += +t.dataset.pg; paint(); box.scrollIntoView({ block: "start" }); window.scrollTo(0, 0); return; }
      if (t.id === "fill") { fillSample(); toast("Sample answers filled in"); survey.page = surveyPages().length - 2; paint(); return; }
      if (t.id === "restart") { Object.assign(survey, { page: 0, answers: {}, profile: {}, activity: { a3: [], a4: [] }, mc: { mc1: [] }, ma: {} }); paint(); return; }
      if (t.dataset.ans) {
        const v = t.dataset.v === "dk" ? "dk" : isNaN(+t.dataset.v) ? t.dataset.v : +t.dataset.v;
        survey.answers[t.dataset.ans] = v;
        $$(`[data-ans="${t.dataset.ans}"]`, box).forEach((b) => b.setAttribute("aria-pressed", String(b === t)));
        const ct = $(".small.faint", box); if (ct) ct.textContent = `${U.statements.filter((s) => survey.answers[s.id] != null).length} of 60 statements answered`;
        return;
      }
      if (t.dataset.pick) {
        const k = t.dataset.pick, v = t.dataset.v;
        if (k.startsWith("Z")) survey.profile[k] = v; else if (k === "A2") survey.activity.A2 = v; else survey.mc[k] = v;
        $$(`[data-pick="${k}"]`, box).forEach((b) => b.setAttribute("aria-pressed", String(b === t)));
        return;
      }
      if (t.dataset.multi) {
        const k = t.dataset.multi, v = t.dataset.v;
        const arr = k === "mc1" ? survey.mc.mc1 : survey.activity[k];
        const i = arr.indexOf(v);
        if (i >= 0) arr.splice(i, 1); else if (k !== "mc1" || arr.length < 5) arr.push(v); else { toast("Pick five areas at most"); return; }
        t.setAttribute("aria-pressed", String(arr.includes(v)));
        if (k === "mc1") { const l = t.closest(".stack").querySelector(".label"); if (l) l.textContent = `MC1 · Select the five areas you believe pose the greatest risk to the firm today (${arr.length}/5)`; }
      }
    });
    box.addEventListener("input", (e) => {
      const t = e.target;
      if (t.dataset.ma) { survey.ma[t.dataset.ma] = +t.value; $("#mav-" + t.dataset.ma).textContent = t.value; }
      if (t.id === "o1") survey.o1 = t.value;
      if (t.id === "o2") survey.o2 = t.value;
    });
    box.addEventListener("change", (e) => {
      const t = e.target;
      if (t.id === "a1") survey.activity.a1 = t.value;
      if (t.dataset.mc4) survey.mc["mc4_" + t.dataset.mc4] = t.value;
    });
  },
});

/* ---------------- Boot ---------------- */
renderShell();
window.addEventListener("hashchange", () => { closeDrawer(); go(); });
go();
