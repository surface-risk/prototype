"""Build web/data/ui_content.json (survey questions, area descriptions, set-up lists)
from the engine's methodology config and, for area descriptions, the v0.5 workbook.

Usage: python web/tools/build_ui_content.py path/to/Surface-Risk_Prototype_Framework_v0.5.xlsx
"""
import json, sys, pathlib
import openpyxl

ROOT = pathlib.Path(__file__).resolve().parents[2]
cfg = json.loads((ROOT / "engine/config/methodology_v0.5.json").read_text())
wb = openpyxl.load_workbook(sys.argv[1], data_only=True)

# Area descriptions: first ORX cause row for each area
desc = {}
ws = wb["ORX_Causes"]
for row in ws.iter_rows(min_row=4, values_only=True):
    code, l1, l2, area, good, loss, cases, perf = row[:8]
    if area and area not in desc and good:
        desc[area] = {"good": good, "loss": loss, "perf": perf}

# Process list for activity questions (Sample_Inputs section D)
procs = []
ws = wb["Sample_Inputs"]
on = False
for row in ws.iter_rows(values_only=True):
    if row[0] and str(row[0]).startswith("D. Activity"):
        on = True; continue
    if on and isinstance(row[0], (int, float)) and row[1]:
        procs.append({"n": int(row[0]), "name": row[1], "group": row[2]})

oq = cfg["other_questions"]
def section(prefix):
    return next(v for k, v in oq.items() if k.startswith(prefix))

mgmt_opts = {
    "MC2": ["No documented appetite", "Documented but rarely used", "Used for some decisions", "Used routinely, limits monitored"],
    "MC3": ["0", "1", "2-3", "4 or more", "Don't know"],
    "MC5": ["Within 12 months", "12-24 months", "Over 24 months", "Never", "Don't know"],
    "MC6": ["Within 3 months", "3-12 months", "Over 12 months", "Never", "Don't know"],
    "MC7": ["Monthly or more", "Quarterly", "Ad hoc", "Never"],
}
areas = []
for a in cfg["areas"]:
    d = desc.get(a["code"], {})
    areas.append({"code": a["code"], "name": a["name"], "group": a["orx_l1"],
                  "loss_tier": a["loss_tier"], "perf_tier": a["perf_tier"],
                  "loss_overrides": a.get("loss_overrides", {}), "perf_overrides": a.get("perf_overrides", {}),
                  "rationale": a.get("rationale"), **d})

out = {
    "methodology_version": cfg["methodology_version"],
    "areas": areas,
    "statements": cfg["statements"],
    "open": section("C."),
    "profile": section("D."),
    "activity": section("E."),
    "processes": procs,
    "mgmt_capability": [dict(q, options_list=mgmt_opts.get(q["id"])) for q in section("F.")],
    "alignment": section("G."),
    "outcome": section("H."),
    "business_lines": cfg["business_lines"],
    "checks": cfg["checks"],
    "exposures": cfg["exposures"],
    "country_risk": cfg["country_risk"],
    "department_hierarchy": cfg["department_hierarchy"],
    "default_reporting_level": cfg["default_reporting_level"],
    "parameters": cfg["parameters"],
    "bands": cfg["bands"],
    "archetypes": cfg["archetypes"],
}
(ROOT / "web/data/ui_content.json").write_text(json.dumps(out, indent=1, ensure_ascii=False))
print("areas", len(areas), "with desc", sum(1 for a in areas if a.get("good")), "processes", len(procs))
