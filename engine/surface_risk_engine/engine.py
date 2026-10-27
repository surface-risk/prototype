"""Surface-Risk scoring engine (methodology v0.5).

Mirrors the workbook's Scored and Calc sheets step by step (Scoring_Model section G):

 1. Quality filter          - exclude straight-lined or speeded responses.
 2. Respondent area score   - mean of the respondent's item scores in the area (reversed where flagged).
 3. Survey area score       - mean of included respondents; 95% range = z * SD / sqrt(n).
 4. Checks                  - raw result -> 0/25/50/75/100 bands; unrun checks return weight to the survey;
                              total check weight capped at MAXW.
 5. Preparedness            - (1 - check weight) * survey + weighted check points.
 6. Exposure penalty        - footprint-weighted country risk; penalty = k * max(0, exposure - baseline).
 7. Area score              - max(0, preparedness - penalty); low-evidence flag below MIN_DP data points.
 8. Groups                  - department / business-line scores shrunk towards the firm, flagged only
                              outside the firm's 95% range for that group size.
 9. Indices                 - weighted average of area scores using tier points for the firm's BL mix.
10. Robustness              - equal-weight index/archetype and top-3 priorities vs three lowest scores.
11. Priorities              - loss weight * (100 - score) + performance weight * (100 - score).
12. Management              - gap, blind spots, capability (MC2-MC8), MC1 overlap, alignment.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Any, Optional

from .config import Methodology, load_methodology
from .inputs import AssessmentInputs, ManagerResponse, StaffResponse
from .stats import mean, median, stdev, stdevp

# ---------------------------------------------------------------------------
# Result structures
# ---------------------------------------------------------------------------


@dataclass
class GroupAreaResult:
    raw: Optional[float]
    n: int
    shrunk: Optional[float]           # survey score shrunk towards the firm
    score: Optional[float]            # shrunk survey + checks - penalty
    flag: str = ""                    # "Lower" / "Higher" / ""


@dataclass
class AreaResult:
    code: str
    name: str
    l1: str
    items: int
    data_points: int
    low_evidence: bool
    survey: Optional[float]
    sd: float
    n: int
    ci: Optional[float]
    check_weight: float
    check_points: float
    preparedness: float
    exposure: Optional[float]
    penalty: float
    score: float
    band: str
    mgmt_survey: Optional[float]
    mgmt: Optional[float]
    gap: Optional[float]
    gap_flag: str                     # "Blind spot" / "Hidden strength" / ""
    peer: Optional[float]
    loss_wt: float
    perf_wt: float
    loss_priority: float
    perf_priority: float
    priority: float
    groups: dict[str, GroupAreaResult] = field(default_factory=dict)


@dataclass
class EntityIndex:
    entity: str
    kind: str                          # firm / mgmt / dept / bl / peer
    n: Any
    loss: Optional[float]
    perf: Optional[float]
    archetype: str
    loss_band: str = ""
    perf_band: str = ""
    flags: Any = "-"


@dataclass
class Assessment:
    methodology_version: str
    reporting_level: str
    invited: int
    received: int
    excluded: int
    included: int
    areas: list[AreaResult]
    entities: list[EntityIndex]
    department_groups: dict[str, list[str]]   # level -> group names reported
    department_tables: dict[str, dict[str, Any]]
    checks: list[dict[str, Any]]
    exposures: list[dict[str, Any]]
    priorities: list[dict[str, Any]]           # rank rows (top 5)
    top3_overlap: int
    robustness: str
    equal_weight_index: float
    equal_weight_archetype: str
    managers: list[dict[str, Any]]
    capability: Optional[float]
    mc1_overlap_mean: Optional[float]
    alignment: Optional[float]
    avg_perception_gap: Optional[float]
    blind_spots: int
    hidden_strengths: int
    low_evidence_areas: int
    notable_department_flags: int
    rework_share: Optional[float]
    hidden_capacity_fte: Optional[float]
    hidden_capacity_usd: Optional[float]
    recoverable_fte: Optional[float]
    l1: dict[str, dict[str, Optional[float]]]
    statement_stats: list[dict[str, Any]]

    # convenience
    @property
    def firm(self) -> EntityIndex:
        return next(e for e in self.entities if e.kind == "firm")

    @property
    def mgmt(self) -> EntityIndex:
        return next(e for e in self.entities if e.kind == "mgmt")

    def area(self, code: str) -> AreaResult:
        return next(a for a in self.areas if a.code == code)


# ---------------------------------------------------------------------------
# Generic helpers
# ---------------------------------------------------------------------------


def band_of(value: float, m: Methodology) -> str:
    """Band label: the highest band whose lower bound the value reaches."""
    label = m.bands[0]["label"]
    for b in m.bands:
        if value >= b["from"]:
            label = b["label"]
    return label


def level_of(value: float, m: Methodology) -> str:
    p = m.params
    return "Low" if value < p["archetype_low"] else ("Mid" if value < p["archetype_high"] else "High")


def archetype_of(loss: Optional[float], perf: Optional[float], m: Methodology) -> str:
    if loss is None or perf is None:
        return "n<5"
    return m.archetypes[f"{level_of(loss, m)}|{level_of(perf, m)}"]


def check_points(direction: str, result: float, thresholds: list[Optional[float]]) -> float:
    """Convert a raw check result to 0/25/50/75/100 (or pass a 0-100 rubric score through)."""
    if direction == "Score":
        return result
    t100, t75, t50, t25 = thresholds
    if direction == "Higher":
        for t, pts in ((t100, 100), (t75, 75), (t50, 50), (t25, 25)):
            if result >= t:
                return pts
        return 0
    for t, pts in ((t100, 100), (t75, 75), (t50, 50), (t25, 25)):
        if result <= t:
            return pts
    return 0


# ---------------------------------------------------------------------------
# Step 1-2: respondent scoring
# ---------------------------------------------------------------------------


def item_score(statement: dict[str, Any], answer: Optional[float]) -> Optional[float]:
    if answer is None:
        return None
    return 100 - answer if statement["reverse"] else answer


def is_included(resp: StaffResponse, median_minutes: Optional[float], m: Methodology) -> bool:
    """Quality filter: drop straight-liners (zero spread) and speeders (< x times median minutes)."""
    spread = stdevp(resp.answers.values())
    if spread is None or spread == 0:
        return False
    if median_minutes is not None and resp.minutes < m.params["speeder_threshold_x_median"] * median_minutes:
        return False
    return True


def respondent_area_scores(answers: dict[str, Optional[float]], m: Methodology) -> dict[str, Optional[float]]:
    by_area: dict[str, list[Optional[float]]] = {c: [] for c in m.area_codes}
    for s in m.statements:
        by_area[s["area"]].append(item_score(s, answers.get(s["id"])))
    return {code: mean(vals) for code, vals in by_area.items()}


# ---------------------------------------------------------------------------
# Department hierarchy and reporting groups
# ---------------------------------------------------------------------------


def dept_at_level(level_c: str, level: str, m: Methodology) -> str:
    row = next((h for h in m.hierarchy if h["level_c"] == level_c), None)
    if row is None:
        return level_c
    return {"A": row["level_a"], "B": row["level_b"], "C": row["level_c"]}[level]


def reporting_groups(staff: list[StaffResponse], level: str, m: Methodology) -> dict[str, str]:
    """Map each included respondent id to a reporting group at ``level``.

    Any group below the minimum reporting size is merged with its smallest sibling (a group with the
    same parent one level up, e.g. "Compliance & legal + Risk & internal audit"); if it has no sibling
    at that level, the next level up is tried. A group that still cannot reach the minimum is kept but
    suppressed in the report ("n<5"), as in the workbook. Repeats until no merge is possible.
    """
    min_n = m.params["min_reporting_group"]
    order = ["C", "B", "A"]
    members: dict[str, list[StaffResponse]] = {}
    for r in staff:
        members.setdefault(dept_at_level(r.department_c, level, m), []).append(r)

    def parent(group: str, lvl: str) -> Optional[str]:
        parents = {dept_at_level(r.department_c, lvl, m) for r in members[group]}
        return parents.pop() if len(parents) == 1 else None

    stuck: set[str] = set()
    while True:
        small = sorted((g for g in members if len(members[g]) < min_n and g not in stuck), key=lambda g: len(members[g]))
        if not small:
            break
        g = small[0]
        merged = False
        for lvl in order[order.index(level) + 1:]:
            pg = parent(g, lvl)
            sibs = [s for s in members if s != g and pg is not None and parent(s, lvl) == pg]
            if sibs:
                s = min(sibs, key=lambda x: len(members[x]))
                members[f"{s} + {g}"] = members.pop(s) + members.pop(g)
                merged = True
                break
        if not merged:
            stuck.add(g)
    return {r.id: g for g, rs in members.items() for r in rs}


def ordered_groups(names: list[str], level: str, m: Methodology) -> list[str]:
    """Order groups as in the hierarchy table (merged groups by their first component)."""
    key = {"A": "level_a", "B": "level_b", "C": "level_c"}[level]
    canonical: list[str] = []
    for h in m.hierarchy:
        if h[key] not in canonical:
            canonical.append(h[key])

    def pos(name: str) -> tuple[int, str]:
        idx = [canonical.index(part) for part in name.split(" + ") if part in canonical]
        return (min(idx) if idx else len(canonical), name)

    return sorted(names, key=pos)


# ---------------------------------------------------------------------------
# Firm weights, checks, exposures
# ---------------------------------------------------------------------------


def firm_weights(mix: dict[str, float], m: Methodology) -> dict[str, tuple[float, float, float, float]]:
    """Tier points averaged over the business-line mix -> (loss_pts, perf_pts, loss_wt, perf_wt) per area."""
    tp = m.params["tier_points"]
    total_share = sum(mix.values())
    pts = {}
    for a in m.areas:
        lp = sum(tp[a["loss_overrides"].get(bl) or a["loss_tier"]] * share for bl, share in mix.items()) / total_share
        pp = sum(tp[a["perf_overrides"].get(bl) or a["perf_tier"]] * share for bl, share in mix.items()) / total_share
        pts[a["code"]] = (lp, pp)
    lsum = sum(v[0] for v in pts.values())
    psum = sum(v[1] for v in pts.values())
    return {c: (lp, pp, lp / lsum, pp / psum) for c, (lp, pp) in pts.items()}


def activity_check_results(included: list[StaffResponse]) -> dict[str, float]:
    """A01 / A02: share of included staff naming at least one sole-performer / unclear activity."""
    n = len(included)
    if not n:
        return {}
    return {
        "A01": sum(1 for r in included if (r.sole_performer_activities or 0) > 0) / n,
        "A02": sum(1 for r in included if (r.unclear_activities or 0) > 0) / n,
    }


def score_checks(inputs: AssessmentInputs, included: list[StaffResponse], m: Methodology,
                 activity_checks_on: bool = True) -> list[dict[str, Any]]:
    results = {cid: (c.run, c.result) for cid, c in inputs.checks.items()}
    if activity_checks_on:
        for cid, val in activity_check_results(included).items():
            results[cid] = (True, val)
    out = []
    for c in m.checks:
        run, result = results.get(c["id"], (False, None))
        pts = check_points(c["direction"], result, c["thresholds"]) if run and result is not None else None
        out.append({"id": c["id"], "name": c["name"], "area": c["area"], "run": bool(run), "result": result,
                    "score": pts, "weight": c["weight"], "eff_weight": c["weight"] if pts is not None else 0.0})
    return out


def score_exposures(inputs: AssessmentInputs, m: Methodology) -> list[dict[str, Any]]:
    risk = m.country_risk
    out = []
    for x in m.exposures:
        idx = x["index"]
        parts = {}
        for fp, shares in inputs.profile.footprint.items():
            parts[fp] = sum(share * risk[country][idx] for country, share in shares.items())
        w = x["footprint_weights"]
        value = sum(parts.get(fp, 0.0) * wt for fp, wt in w.items()) / sum(w.values())
        out.append({"id": x["id"], "name": x["name"], "area": x["area"], "value": value,
                    "penalty_applies": value > m.params["exposure_baseline"]})
    return out


# ---------------------------------------------------------------------------
# Management
# ---------------------------------------------------------------------------


def _lookup(table: list[dict[str, Any]], answer: Any) -> float:
    for row in table:
        if str(row["answer"]) == str(answer):
            return float(row["points"])
    return 0.0


def score_manager(mr: ManagerResponse, top5: list[str], profile_providers: int, first_contact: str,
                  m: Methodology) -> dict[str, Any]:
    ms = m.management_scoring
    mc = {
        "mc1": sum(1 for code in mr.mc1_top5 if code in top5),
        "mc2": _lookup(ms["MC2"], mr.mc2),
        "mc3": _lookup(ms["MC3"], mr.mc3),
        "mc4": min(100.0, (mr.mc4_correct_owners or 0) / profile_providers * 100) if profile_providers else 0.0,
        "mc5": _lookup(ms["MC5"], mr.mc5),
        "mc6": _lookup(ms["MC6"], mr.mc6),
        "mc7": _lookup(ms["MC7"], mr.mc7),
        "mc8": (50.0 if mr.mc8_contact == first_contact else 0.0) + (50.0 if mr.mc8_offline else 0.0),
    }
    mc["capability"] = sum(mc[k] for k in ("mc2", "mc3", "mc4", "mc5", "mc6", "mc7", "mc8")) / 7
    return {"role": mr.role, **mc}


# ---------------------------------------------------------------------------
# Main entry point
# ---------------------------------------------------------------------------


def assess(inputs: AssessmentInputs, m: Optional[Methodology] = None, activity_checks_on: bool = True) -> Assessment:
    """Run the full v0.5 scoring for one firm."""
    m = m or load_methodology()
    p = m.params
    z, k_shrink, min_n = p["z95"], p["shrinkage_k"], p["min_reporting_group"]

    # 1. quality filter
    med = median(r.minutes for r in inputs.staff)
    included = [r for r in inputs.staff if is_included(r, med, m)]
    inc_ids = {r.id for r in included}

    # 2. respondent-level area scores
    resp_scores = {r.id: respondent_area_scores(r.answers, m) for r in included}
    mgr_scores = {mr.role: respondent_area_scores(mr.answers, m) for mr in inputs.managers}

    # reporting level and groups
    level = inputs.reporting_level or m.default_level(inputs.profile.headcount)
    dept_assign = {lvl: reporting_groups(included, lvl, m) for lvl in sorted({level, "A"})}
    bl_names: list[str] = []
    for r in included:
        if r.business_line not in bl_names:
            bl_names.append(r.business_line)
    group_defs: list[tuple[str, str, dict[str, str]]] = []   # (name, kind, assignment map)
    dept_names = ordered_groups(sorted(set(dept_assign[level].values())), level, m)
    for g in dept_names:
        group_defs.append((g, "dept", dept_assign[level]))
    bl_assign = {r.id: r.business_line for r in included}
    for g in bl_names:
        group_defs.append((g, "bl", bl_assign))

    weights = firm_weights(inputs.profile.business_line_mix, m)
    checks = score_checks(inputs, included, m, activity_checks_on)
    exposures = score_exposures(inputs, m)

    areas: list[AreaResult] = []
    for idx, a in enumerate(m.areas):
        code = a["code"]
        stmts = [s for s in m.statements if s["area"] == code]
        answered_items = sum(1 for s in stmts if any(r.answers.get(s["id"]) is not None for r in included))
        a_checks = [c for c in checks if c["area"] == code]
        a_exps = [x for x in exposures if x["area"] == code]
        data_points = answered_items + sum(1 for c in a_checks if c["eff_weight"] > 0) + len(a_exps)

        vals = [resp_scores[r.id][code] for r in included]
        survey = mean(vals)
        sd = stdev(vals) or 0.0
        n = sum(1 for v in vals if v is not None)
        ci = z * sd / math.sqrt(n) if n else None

        w_total = sum(c["eff_weight"] for c in a_checks)
        kw = min(p["max_non_survey_weight"], w_total)
        cpts = (sum(c["eff_weight"] * c["score"] for c in a_checks if c["score"] is not None) * kw / w_total) if w_total else 0.0
        prep = (1 - kw) * survey + cpts
        exposure = mean(x["value"] for x in a_exps) if a_exps else None
        penalty = p["penalty_per_point"] * max(0.0, exposure - p["exposure_baseline"]) if exposure is not None else 0.0
        score = max(0.0, prep - penalty)

        m_vals = [mgr_scores[mr.role][code] for mr in inputs.managers]
        mgmt_survey = mean(m_vals)
        mgmt = max(0.0, (1 - kw) * mgmt_survey + cpts - penalty) if mgmt_survey is not None else None
        gap = mgmt_survey - survey if mgmt_survey is not None else None
        gap_flag = ""
        m_sd = stdev(m_vals)
        m_n = sum(1 for v in m_vals if v is not None)
        if gap is not None and m_sd is not None and n:
            combined = z * math.sqrt(sd ** 2 / n + m_sd ** 2 / m_n)
            if gap >= p["blind_spot_threshold"] and gap > combined:
                gap_flag = "Blind spot"
            elif gap <= -p["blind_spot_threshold"] and -gap > combined:
                gap_flag = "Hidden strength"

        lp, pp, lw, pw = weights[code]
        res = AreaResult(
            code=code, name=a["name"], l1=a["orx_l1"], items=len(stmts), data_points=data_points,
            low_evidence=data_points < p["min_data_points"], survey=survey, sd=sd, n=n, ci=ci,
            check_weight=kw, check_points=cpts, preparedness=prep, exposure=exposure, penalty=penalty, score=score,
            band=band_of(score, m), mgmt_survey=mgmt_survey, mgmt=mgmt, gap=gap, gap_flag=gap_flag,
            peer=inputs.peers.get(code), loss_wt=lw, perf_wt=pw, loss_priority=lw * (100 - score),
            perf_priority=pw * (100 - score), priority=(lw + pw) * (100 - score),
        )
        # 8. groups (shrinkage towards firm; flag outside the firm's 95% range for that group size)
        for gname, _kind, assign in group_defs:
            g_vals = [resp_scores[r.id][code] for r in included if assign[r.id] == gname]
            g_n = sum(1 for v in g_vals if v is not None)
            raw = mean(g_vals)
            if g_n < min_n or raw is None:
                res.groups[gname] = GroupAreaResult(raw, g_n, None, None, "")
                continue
            shrunk = (g_n * raw + k_shrink * survey) / (g_n + k_shrink)
            g_score = max(0.0, (1 - kw) * shrunk + cpts - penalty)
            flag = ""
            if abs(shrunk - survey) > z * sd / math.sqrt(g_n):
                flag = "Lower" if shrunk < survey else "Higher"
            res.groups[gname] = GroupAreaResult(raw, g_n, shrunk, g_score, flag)
        areas.append(res)
        _ = idx

    # 9. indices
    def index_pair(scores: list[Optional[float]]) -> tuple[Optional[float], Optional[float]]:
        if any(s is None for s in scores):
            return None, None
        return (sum(s * a.loss_wt for s, a in zip(scores, areas)), sum(s * a.perf_wt for s, a in zip(scores, areas)))

    def entity(name: str, kind: str, n: Any, scores: list[Optional[float]], flags: Any) -> EntityIndex:
        loss, perf = index_pair(scores)
        return EntityIndex(name, kind, n, loss, perf, archetype_of(loss, perf, m),
                           band_of(loss, m) if loss is not None else "", band_of(perf, m) if perf is not None else "", flags)

    entities = [
        entity("Firm (staff)", "firm", len(included), [a.score for a in areas], "-"),
        entity("Management view", "mgmt", len(inputs.managers), [a.mgmt for a in areas], "-"),
    ]
    for gname, kind, _assign in group_defs:
        n_min = min(a.groups[gname].n for a in areas)
        flags = sum(1 for a in areas if a.groups[gname].flag)
        entities.append(entity(gname, kind, n_min, [a.groups[gname].score for a in areas], flags))
    peer_scores = [a.peer for a in areas]
    entities.append(entity("Peer median (illustrative)", "peer", "-", peer_scores, "-"))

    # 10-11. priorities and robustness (tie-breaks mirror the workbook's ROW()-based nudges)
    rows = list(range(82, 82 + len(areas)))
    by_priority = sorted(zip(areas, rows), key=lambda t: -(t[0].priority + t[1] / 1_000_000))
    by_lowest = sorted(zip(areas, rows), key=lambda t: t[0].score + t[1] / 100_000)
    by_gap = sorted([a for a in areas if a.gap is not None], key=lambda a: -a.gap)
    by_peer = sorted([a for a in areas if a.peer is not None], key=lambda a: a.score - a.peer)
    priorities = []
    for i in range(5):
        priorities.append({
            "rank": i + 1,
            "priority_code": by_priority[i][0].code, "priority_area": by_priority[i][0].name, "priority": by_priority[i][0].priority,
            "lowest_code": by_lowest[i][0].code, "lowest_area": by_lowest[i][0].name, "lowest_score": by_lowest[i][0].score,
            "gap_code": by_gap[i].code if i < len(by_gap) else None, "gap_area": by_gap[i].name if i < len(by_gap) else None,
            "gap": by_gap[i].gap if i < len(by_gap) else None,
            "gap_passes": by_gap[i].gap_flag == "Blind spot" if i < len(by_gap) else False,
            "below_peer_area": by_peer[i].name if i < len(by_peer) else None,
            "vs_peer": (by_peer[i].score - by_peer[i].peer) if i < len(by_peer) else None,
        })
    top3 = [r["priority_code"] for r in priorities[:3]]
    low3 = [r["lowest_code"] for r in priorities[:3]]
    overlap = sum(1 for c in top3 if c in low3)
    eq_index = sum(a.score for a in areas) / len(areas)
    eq_arch = archetype_of(eq_index, eq_index, m)
    firm = entities[0]
    robustness = "Sensitive" if (firm.archetype != eq_arch or overlap < 2) else "Robust"

    # 12. management
    top5 = [r["priority_code"] for r in priorities]
    managers = [score_manager(mr, top5, len(inputs.profile.providers), inputs.profile.first_contact, m)
                for mr in inputs.managers]
    capability = mean(mg["capability"] for mg in managers)
    mc1_mean = mean(mg["mc1"] for mg in managers)
    ma_keys = sorted({k for mr in inputs.managers for k in mr.alignment})
    alignment = mean(max(0.0, 100 - 2 * (stdevp(mr.alignment.get(k) for mr in inputs.managers) or 0.0)) for k in ma_keys) \
        if inputs.managers else None

    statement_stats = []
    for s in m.statements:
        st = mean(item_score(s, r.answers.get(s["id"])) for r in included)
        mg = mean(item_score(s, mr.answers.get(s["id"])) for mr in inputs.managers)
        statement_stats.append({"id": s["id"], "area": s["area"], "staff": st, "mgmt": mg,
                                "gap": (mg - st) if (st is not None and mg is not None) else None,
                                "dk_rate": 1 - sum(1 for r in included if r.answers.get(s["id"]) is not None) / len(included)
                                if included else None})
    avg_gap = mean(x["gap"] for x in statement_stats)

    rework = mean(r.rework_share for r in included)
    fte = rework * inputs.profile.headcount if rework is not None else None
    usd = fte * inputs.profile.loaded_cost_usd if (fte is not None and inputs.profile.loaded_cost_usd) else None

    l1: dict[str, dict[str, Optional[float]]] = {}
    for a in areas:
        l1.setdefault(a.l1, {"_s": [], "_m": [], "_p": []})
        l1[a.l1]["_s"].append(a.score)
        l1[a.l1]["_m"].append(a.mgmt)
        l1[a.l1]["_p"].append(a.peer)
    l1 = {k: {"score": mean(v["_s"]), "mgmt": mean(v["_m"]), "peer": mean(v["_p"])} for k, v in l1.items()}

    # department tables (chosen level + level A roll-up for comparison)
    dept_tables: dict[str, dict[str, Any]] = {}
    for lvl in sorted({level, "A"}, key=lambda x: "CBA".index(x)):
        assign = dept_assign[lvl]
        names = ordered_groups(sorted(set(assign.values())), lvl, m)
        table_rows = []
        for a in areas:
            cells = []
            for g in names:
                if lvl == level:
                    gr = a.groups[g]
                else:
                    gr = _group_cell(a, [resp_scores[r.id][a.code] for r in included if assign[r.id] == g], m)
                cells.append({"score": gr.shrunk, "n": gr.n, "flag": gr.flag})
            table_rows.append({"code": a.code, "name": a.name, "firm": a.survey, "values": cells})
        dept_tables[lvl] = {"names": names, "rows": table_rows}

    level_flags = sum(e.flags for e in entities if e.kind == "dept" and isinstance(e.flags, int))
    return Assessment(
        methodology_version=m.version, reporting_level=level, invited=inputs.profile.headcount,
        received=len(inputs.staff), excluded=len(inputs.staff) - len(included), included=len(included),
        areas=areas, entities=entities,
        department_groups={lvl: dept_tables[lvl]["names"] for lvl in dept_tables}, department_tables=dept_tables,
        checks=checks, exposures=exposures, priorities=priorities, top3_overlap=overlap, robustness=robustness,
        equal_weight_index=eq_index, equal_weight_archetype=eq_arch, managers=managers, capability=capability,
        mc1_overlap_mean=mc1_mean, alignment=alignment, avg_perception_gap=avg_gap,
        blind_spots=sum(1 for a in areas if a.gap_flag == "Blind spot"),
        hidden_strengths=sum(1 for a in areas if a.gap_flag == "Hidden strength"),
        low_evidence_areas=sum(1 for a in areas if a.low_evidence), notable_department_flags=level_flags,
        rework_share=rework, hidden_capacity_fte=fte, hidden_capacity_usd=usd,
        recoverable_fte=fte * p["recoverable_share"] if fte is not None else None, l1=l1,
        statement_stats=statement_stats,
    )


def _group_cell(a: AreaResult, vals: list[Optional[float]], m: Methodology) -> GroupAreaResult:
    """Shrunk score and flag for an ad-hoc group (used for the level-A comparison table)."""
    p = m.params
    n = sum(1 for v in vals if v is not None)
    raw = mean(vals)
    if n < p["min_reporting_group"] or raw is None or a.survey is None:
        return GroupAreaResult(raw, n, None, None, "")
    shrunk = (n * raw + p["shrinkage_k"] * a.survey) / (n + p["shrinkage_k"])
    score = max(0.0, (1 - a.check_weight) * shrunk + a.check_points - a.penalty)
    flag = ""
    if abs(shrunk - a.survey) > p["z95"] * a.sd / math.sqrt(n):
        flag = "Lower" if shrunk < a.survey else "Higher"
    return GroupAreaResult(raw, n, shrunk, score, flag)
