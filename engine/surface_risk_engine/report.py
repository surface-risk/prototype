"""Turn an Assessment into the report JSON used by the web prototype."""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Optional

from .engine import Assessment
from .inputs import AssessmentInputs


def r1(x: Optional[float]) -> Optional[float]:
    return None if x is None else round(float(x), 1)


def r3(x: Optional[float]) -> Optional[float]:
    return None if x is None else round(float(x), 3)


def build_report(a: Assessment, inputs: AssessmentInputs, engine_tests: Optional[list[dict]] = None) -> dict[str, Any]:
    firm, mg = a.firm, a.mgmt
    peer = next(e for e in a.entities if e.kind == "peer")
    prof = inputs.profile
    return {
        "methodology_version": a.methodology_version,
        "firm": {
            "name": prof.name, "centre": prof.centre, "headcount": prof.headcount, "invited": a.invited,
            "received": a.received, "excluded": a.excluded, "valid_responses": a.included,
            "response_rate": r3(a.received / a.invited) if a.invited else None, "date": prof.date,
            "reporting_level": a.reporting_level, "fictional": prof.fictional,
        },
        "indices": {
            "loss": r1(firm.loss), "perf": r1(firm.perf), "band_loss": firm.loss_band, "band_perf": firm.perf_band,
            "archetype": firm.archetype, "loss_tilt": r1(firm.loss - firm.perf), "peer_loss": r1(peer.loss),
            "peer_perf": r1(peer.perf), "robust": a.robustness == "Robust", "robustness": a.robustness,
            "equal_weight_index": r1(a.equal_weight_index), "equal_weight_archetype": a.equal_weight_archetype,
            "top3_overlap": a.top3_overlap, "low_evidence_areas": a.low_evidence_areas,
        },
        "mgmt": {
            "loss": r1(mg.loss), "perf": r1(mg.perf), "archetype": mg.archetype, "loss_tilt": r1(mg.loss - mg.perf),
            "capability": r1(a.capability), "alignment": r1(a.alignment), "mc1_overlap_mean": r1(a.mc1_overlap_mean),
            "avg_perception_gap": r1(a.avg_perception_gap), "blind_spots": a.blind_spots,
            "hidden_strengths": a.hidden_strengths,
            "managers": [{k: (r1(v) if isinstance(v, float) else v) for k, v in m.items()} for m in a.managers],
        },
        "hidden_capacity": {"rework_share": r3(a.rework_share), "fte": r1(a.hidden_capacity_fte),
                            "usd": round(a.hidden_capacity_usd) if a.hidden_capacity_usd else None,
                            "recoverable_fte": r1(a.recoverable_fte)},
        "l1": {k: {kk: r1(vv) for kk, vv in v.items()} for k, v in a.l1.items()},
        "areas": [{
            "code": x.code, "name": x.name, "group": x.l1, "score": r1(x.score), "ci": r1(x.ci), "band": x.band,
            "data_points": x.data_points, "survey": r1(x.survey), "check_weight": r3(x.check_weight),
            "preparedness": r1(x.preparedness), "exposure": r1(x.exposure), "penalty": r1(x.penalty), "mgmt": r1(x.mgmt),
            "mgmt_survey": r1(x.mgmt_survey), "gap": r1(x.gap), "blind_spot": x.gap_flag == "Blind spot",
            "gap_flag": x.gap_flag, "peer": r1(x.peer), "loss_wt": r3(x.loss_wt), "perf_wt": r3(x.perf_wt),
            "priority": round(x.priority, 2), "low_evidence": x.low_evidence,
        } for x in a.areas],
        "groups": [{"entity": e.entity, "kind": e.kind, "n": e.n, "loss": r1(e.loss), "perf": r1(e.perf),
                    "archetype": e.archetype, "flags": e.flags} for e in a.entities],
        "departments": {lvl: {
            "names": t["names"],
            "rows": [{"code": row["code"], "name": row["name"], "firm": r1(row["firm"]),
                      "values": [{"score": r1(c["score"]), "n": c["n"], "flag": c["flag"]} for c in row["values"]]}
                     for row in t["rows"]],
        } for lvl, t in a.department_tables.items()},
        "priorities": {
            "top": [{"code": p["priority_code"], "name": p["priority_area"], "priority": round(p["priority"], 2)} for p in a.priorities],
            "lowest": [{"code": p["lowest_code"], "name": p["lowest_area"], "score": r1(p["lowest_score"])} for p in a.priorities],
            "blind_spots": [{"code": p["gap_code"], "name": p["gap_area"], "gap": r1(p["gap"]), "passes": p["gap_passes"]}
                            for p in a.priorities],
            "below_peer": [{"name": p["below_peer_area"], "vs_peer": r1(p["vs_peer"])} for p in a.priorities],
        },
        "exposures": [{"id": x["id"], "name": x["name"], "area": x["area"], "value": r1(x["value"]),
                       "penalty_applies": x["penalty_applies"]} for x in a.exposures],
        "checks": [{"id": c["id"], "name": c["name"], "area": c["area"], "run": c["run"],
                    "result": r3(c["result"]) if isinstance(c["result"], float) else c["result"],
                    "score": r1(c["score"]), "weight": c["weight"]} for c in a.checks],
        "engine_tests": engine_tests or [],
    }


def write_report(report: dict[str, Any], path: str | Path) -> None:
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    Path(path).write_text(json.dumps(report, indent=1, ensure_ascii=False), encoding="utf-8")
