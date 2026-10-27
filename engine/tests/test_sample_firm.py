"""The fictional sample firm must reproduce the workbook's calculated values (Calc / Sample_Report)."""
import json
from pathlib import Path

import pytest

from surface_risk_engine import assess, load_methodology, load_sample

EXPECTED = json.loads((Path(__file__).parent / "expected_sample.json").read_text())
TOL = 0.01


@pytest.fixture(scope="module")
def result():
    return assess(load_sample(), load_methodology())


def close(a, b):
    return abs(float(a) - float(b)) <= TOL


def test_headline_indices(result):
    h = EXPECTED["headline"]
    assert close(result.firm.loss, h["Loss Index"])          # 48.80
    assert close(result.firm.perf, h["Performance Index"])   # 47.92
    assert result.firm.archetype == h["Archetype"] == "Steady"
    assert close(result.mgmt.loss, h["Mgmt Loss Index"])     # 60.18
    assert close(result.mgmt.perf, h["Mgmt Performance Index"])  # 59.87
    assert result.mgmt.archetype == h["Mgmt archetype"] == "Guarded"
    assert result.firm.loss_band == h["Loss band"] and result.firm.perf_band == h["Performance band"]


def test_response_counts(result):
    h = EXPECTED["headline"]
    assert result.received == h["Responses received"]
    assert result.excluded == h["Excluded by quality filter"]
    assert result.included == h["Included responses"]


def test_robustness(result):
    assert close(result.equal_weight_index, EXPECTED["equal_weight_index"])
    assert result.top3_overlap == EXPECTED["top3_overlap"]
    assert result.robustness == EXPECTED["robustness"] == "Robust"


@pytest.mark.parametrize("code", list(EXPECTED["areas"]))
def test_area(result, code):
    ex, ar = EXPECTED["areas"][code], result.area(code)
    for key, attr in [("score", "score"), ("ci", "ci"), ("penalty", "penalty"), ("gap", "gap"), ("mgmt", "mgmt"),
                      ("survey", "survey"), ("prep", "preparedness"), ("check_w", "check_weight"),
                      ("priority", "priority"), ("loss_wt", "loss_wt"), ("perf_wt", "perf_wt")]:
        assert close(getattr(ar, attr), ex[key]), (code, key, getattr(ar, attr), ex[key])
    assert ar.data_points == ex["data_points"]
    assert ar.band == ex["band"]
    assert ar.gap_flag == (ex["flag"] or "")


def test_ex1_penalty(result):
    assert close(result.area("EX1").penalty, 9.155)


@pytest.mark.parametrize("code", list(EXPECTED["areas"]))
def test_group_cells(result, code):
    for g, gx in EXPECTED["areas"][code]["groups"].items():
        gr = result.area(code).groups[g]
        for key in ("shrunk", "score"):
            if gx[key] in (None, ""):
                assert getattr(gr, key) is None
            else:
                assert close(getattr(gr, key), gx[key]), (code, g, key)
        assert gr.flag == (gx["flag"] or ""), (code, g)


def test_group_indices(result):
    for e in result.entities:
        gx = EXPECTED["groups"][e.entity]
        assert close(e.loss, gx["loss"]) and close(e.perf, gx["perf"]), e.entity
        assert e.archetype == gx["archetype"], e.entity
        assert str(e.n) == str(gx["n"]) and str(e.flags) == str(gx["flags"]), e.entity
    assert result.notable_department_flags == EXPECTED["headline"]["Notable department flags"] == 20


def test_priorities(result):
    for row, ex in zip(result.priorities, EXPECTED["priorities"]):
        assert row["priority_code"] == ex[0] and close(row["priority"], ex[2])
        assert row["lowest_code"] == ex[3] and close(row["lowest_score"], ex[5])
        assert row["gap_area"] == ex[6] and close(row["gap"], ex[7])
        assert row["below_peer_area"] == ex[8] and close(row["vs_peer"], ex[9])


def test_management(result):
    h = EXPECTED["headline"]
    for mg in result.managers:
        ex = EXPECTED["managers"][mg["role"]]
        got = [mg[k] for k in ("mc1", "mc2", "mc3", "mc4", "mc5", "mc6", "mc7", "mc8", "capability")]
        assert all(close(a, b) for a, b in zip(got, ex)), (mg["role"], got, ex)
    assert close(result.capability, h["Leadership capability"])   # 46.18
    assert close(result.mc1_overlap_mean, h["MC1 overlap (avg of 5)"])
    assert close(result.alignment, h["Leadership alignment"])
    assert close(result.avg_perception_gap, h["Average perception gap (points)"])
    assert result.blind_spots == h["Blind spots"] == 1


def test_exposures_and_checks(result):
    for x in result.exposures:
        assert close(x["value"], EXPECTED["exposures"][x["id"]])
    for c in result.checks:
        ex = EXPECTED["check_scores"][c["id"]]
        assert (c["score"] is None and ex is None) or close(c["score"], ex), c["id"]


def test_hidden_capacity(result):
    h = EXPECTED["headline"]
    assert close(result.hidden_capacity_fte, h["Hidden capacity (FTE)"])
    assert abs(result.hidden_capacity_usd - h["Hidden capacity cost (USD)"]) < 1
