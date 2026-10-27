"""Synthetic firms for engine tests (Engine_Tests tab).

Each generator keeps the fictional sample firm's structure (departments, business lines, minutes,
footprint, managers' structured answers) and replaces the survey answers with a known pattern.
Automated checks are switched off so the survey drives the result, as in the workbook tests.
Exposures stay on (the footprint is unchanged), so EX1 keeps its AML penalty.
"""
from __future__ import annotations

import copy
import random
from dataclasses import replace
from typing import Optional

from .config import Methodology, load_methodology
from .engine import Assessment, assess, firm_weights
from .inputs import AssessmentInputs, CheckResult, load_sample

ANCHORS = [0, 25, 50, 75, 100]


def _snap(x: float) -> float:
    return float(min(ANCHORS, key=lambda a: abs(a - max(0.0, min(100.0, x)))))


def _checks_off(inputs: AssessmentInputs) -> AssessmentInputs:
    out = copy.deepcopy(inputs)
    out.checks = {k: CheckResult(run=False, result=None) for k in out.checks}
    return out


def null_firm(seed: int, m: Optional[Methodology] = None) -> AssessmentInputs:
    """Random answers (uniform over the five anchors) for every staff member and manager."""
    m = m or load_methodology()
    rng = random.Random(seed)
    inputs = _checks_off(load_sample())
    for r in inputs.staff:
        r.answers = {s["id"]: float(rng.choice(ANCHORS)) for s in m.statements}
    for mr in inputs.managers:
        mr.answers = {s["id"]: float(rng.choice(ANCHORS)) for s in m.statements}
    return inputs


def _tilt(m: Methodology, inputs: AssessmentInputs) -> dict[str, str]:
    """Classify areas as performance-tilted ('P'), loss-tilted ('L') or balanced ('B') for this firm."""
    w = firm_weights(inputs.profile.business_line_mix, m)
    return {c: ("P" if pp > lp else "L" if lp > pp else "B") for c, (lp, pp, _lw, _pw) in w.items()}


def patterned_firm(pattern: str, seed: int = 1, noise: float = 15.0, mgmt_uplift: float = 12.0,
                   m: Optional[Methodology] = None) -> AssessmentInputs:
    """High-wire (strong on performance-tilted areas, weak on loss-tilted) or Fortress (the mirror image).

    Targets: favoured areas 85, disfavoured 15, balanced 55; answers = target + noise, snapped to anchors;
    reversed (warning-sign) items are stored as 100 - target so their *score* follows the pattern.
    Managers answer ``mgmt_uplift`` points higher (built-in optimism, as in the workbook test).
    """
    m = m or load_methodology()
    rng = random.Random(seed)
    inputs = _checks_off(load_sample())
    tilt = _tilt(m, inputs)
    hi, lo = ("P", "L") if pattern == "high-wire" else ("L", "P")
    target = {c: 85.0 if t == hi else 15.0 if t == lo else 55.0 for c, t in tilt.items()}

    def answers(uplift: float) -> dict[str, float]:
        out = {}
        for s in m.statements:
            score = _snap(target[s["area"]] + uplift + rng.gauss(0, noise))
            out[s["id"]] = 100 - score if s["reverse"] else score
        return out

    for r in inputs.staff:
        r.answers = answers(0.0)
    for mr in inputs.managers:
        mr.answers = answers(mgmt_uplift)
    return inputs


def summarise(name: str, a: Assessment) -> dict:
    return {
        "name": name,
        "loss": round(a.firm.loss, 1),
        "perf": round(a.firm.perf, 1),
        "loss_tilt": round(a.firm.loss - a.firm.perf, 1),
        "archetype": a.firm.archetype,
        "dept_flags": a.notable_department_flags,
        "mgmt_flags": a.blind_spots + a.hidden_strengths,
        "robustness": a.robustness,
    }


def run_engine_tests(m: Optional[Methodology] = None) -> list[dict]:
    """Run the null (3 seeds), High-wire and Fortress tests and return summary rows with verdicts."""
    m = m or load_methodology()
    rows = []
    for seed in (1, 2, 3):
        r = summarise(f"Null firm (seed {seed})", assess(null_firm(seed, m), m, activity_checks_on=False))
        ok = 40 <= r["loss"] < 60 and 40 <= r["perf"] < 60 and r["dept_flags"] == 0
        r["verdict"] = "PASS: no structure invented" if ok else "CHECK"
        rows.append(r)
    for pattern, label in (("high-wire", "High-wire firm"), ("fortress", "Fortress firm")):
        r = summarise(label, assess(patterned_firm(pattern, m=m), m, activity_checks_on=False))
        r["verdict"] = ("PARTIAL: performance axis separates; loss axis stays Mid" if 40 <= r["loss"] < 60
                        else "PASS: both axes separate")
        rows.append(r)
    return rows
