"""Synthetic-firm behaviour (Engine_Tests tab): the engine must not invent structure, and must react to real patterns."""
import pytest

from surface_risk_engine import assess, load_methodology
from surface_risk_engine.synthetic import null_firm, patterned_firm

M = load_methodology()


@pytest.mark.parametrize("seed", [1, 2, 3])
def test_null_firm_invents_nothing(seed):
    a = assess(null_firm(seed, M), M, activity_checks_on=False)
    assert 40 <= a.firm.loss < 60 and 40 <= a.firm.perf < 60
    assert a.firm.archetype == "Steady"
    assert a.notable_department_flags == 0
    assert a.robustness == "Sensitive"           # priorities unstable on random data


def test_high_wire_and_fortress_separate_on_performance():
    hw = assess(patterned_firm("high-wire", m=M), M, activity_checks_on=False)
    fo = assess(patterned_firm("fortress", m=M), M, activity_checks_on=False)
    # Performance axis responds strongly
    assert hw.firm.perf - fo.firm.perf > 15
    # Loss axis barely moves (structural: most High-loss areas are also High-performance) - documented limitation
    assert 40 <= hw.firm.loss < 60 and 40 <= fo.firm.loss < 60
    # The loss tilt (Loss - Performance) does separate them, in the right direction
    assert hw.firm.loss - hw.firm.perf < -8 and fo.firm.loss - fo.firm.perf > 8
    # No department flags: the pattern is firm-wide
    assert hw.notable_department_flags == 0 and fo.notable_department_flags == 0


def test_reporting_level_defaults_and_rollup():
    from surface_risk_engine import load_sample
    inputs = load_sample()
    assert M.default_level(25) == "A" and M.default_level(80) == "B" and M.default_level(200) == "C"
    inputs.reporting_level = "C"
    a = assess(inputs, M)
    for e in a.entities:
        if e.kind == "dept":
            assert e.n >= M.params["min_reporting_group"] or e.archetype == "n<5"
    assert "A" in a.department_tables and set(a.department_tables["A"]["names"]) == {"Revenue-generating", "Support & control"}
