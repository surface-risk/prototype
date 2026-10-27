"""Command line: ``python -m surface_risk_engine sample|tests|export [--out DIR]``."""
from __future__ import annotations

import argparse
import json
from pathlib import Path

from .config import PACKAGE_ROOT, load_methodology
from .engine import assess
from .inputs import load_sample
from .report import build_report, write_report
from .synthetic import run_engine_tests

DEFAULT_OUT = PACKAGE_ROOT.parent / "web" / "data"


def print_summary() -> None:
    m = load_methodology()
    a = assess(load_sample(), m)
    f, mg = a.firm, a.mgmt
    print(f"Surface-Risk engine - methodology v{a.methodology_version} - FICTIONAL sample firm")
    print(f"Responses: {a.received} of {a.invited} invited; {a.included} included, {a.excluded} excluded by quality filter")
    print(f"Staff view:      Loss {f.loss:5.1f}  Performance {f.perf:5.1f}  -> {f.archetype}  (loss tilt {f.loss - f.perf:+.1f})")
    print(f"Management view: Loss {mg.loss:5.1f}  Performance {mg.perf:5.1f}  -> {mg.archetype}")
    print(f"Equal-weight check: index {a.equal_weight_index:.1f}, top-3 overlap {a.top3_overlap} of 3 -> {a.robustness}")
    print(f"Leadership capability {a.capability:.1f}; alignment {a.alignment:.1f}; blind spots {a.blind_spots}")
    print(f"Hidden capacity: {a.hidden_capacity_fte:.1f} FTE (c. USD {a.hidden_capacity_usd / 1e6:.1f}m p.a.)")
    print("\nArea                                   Score  +/-   Band         Penalty  Gap")
    for x in a.areas:
        print(f"{x.code:5} {x.name:32} {x.score:5.1f} {x.ci:5.1f}  {x.band:12} {x.penalty:6.2f}  {x.gap:+6.1f} {x.gap_flag}")
    print("\nTop priorities:", ", ".join(p["priority_area"] for p in a.priorities[:5]))
    print(f"Departments (level {a.reporting_level}):")
    for e in a.entities:
        if e.kind in ("dept", "bl"):
            print(f"  {e.entity:34} n={e.n:<3} Loss {e.loss:5.1f} Perf {e.perf:5.1f} {e.archetype:10} notable areas: {e.flags}")


def main() -> None:
    ap = argparse.ArgumentParser(prog="surface_risk_engine")
    ap.add_argument("command", choices=["sample", "tests", "export"])
    ap.add_argument("--out", default=str(DEFAULT_OUT), help="output folder for export")
    args = ap.parse_args()
    if args.command == "sample":
        print_summary()
    elif args.command == "tests":
        for row in run_engine_tests():
            print(json.dumps(row))
    else:
        m = load_methodology()
        tests = run_engine_tests(m)
        inputs = load_sample()
        report = build_report(assess(inputs, m), inputs, tests)
        out = Path(args.out)
        write_report(report, out / "sample_report.json")
        write_report({"methodology_version": m.version, "tests": tests}, out / "engine_tests.json")
        print(f"wrote {out / 'sample_report.json'} and {out / 'engine_tests.json'}")


if __name__ == "__main__":
    main()
