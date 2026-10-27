# Surface-Risk scoring engine (methodology v0.5)

A dependency-free Python port of the scoring engine in `Surface-Risk_Prototype_Framework_v0.5.xlsx`
(Calc and Scored sheets). It reproduces every value the workbook calculates for the fictional sample firm
(tests check 54 groups of values to within 0.01).

**All bundled data is fictional.** The sample firm (Example Wealth Partners Ltd), its staff and manager
answers, check results and peer scores are simulated. Country-risk values are **illustrative** and are not
real index scores. Importance tiers are expert first-pass estimates pending practitioner-panel review.

## Run it

```bash
cd engine
python -m surface_risk_engine sample     # print the sample firm's results
python -m surface_risk_engine tests      # run the synthetic engine tests (null, High-wire, Fortress)
python -m surface_risk_engine export     # write ../web/data/sample_report.json and engine_tests.json
python -m pytest -q tests                # needs pytest
```

Python 3.10+. The engine uses the standard library only. `tools/extract_workbook.py` (needs `openpyxl`)
regenerates the config, sample data and expected values from the workbook.

## Layout

| Path | What it is |
| --- | --- |
| `config/methodology_v0.5.json` | The methodology: parameters, bands, archetypes, 20 reporting areas with tiers and business-line overrides, 60 statements (area, format, reverse flag), checks, exposures, country risk (illustrative), department hierarchy and default reporting level by headcount |
| `surface_risk_engine/engine.py` | The scoring steps (see the module docstring for the 12 steps) |
| `surface_risk_engine/inputs.py` | Input data classes and the sample-firm loader |
| `surface_risk_engine/synthetic.py` | Synthetic firms for engine tests |
| `surface_risk_engine/report.py` | Builds the report JSON used by the web prototype |
| `sample_data/` | Fictional sample firm inputs |
| `tests/` | Workbook reconciliation tests and behaviour tests |
| `tools/extract_workbook.py` | Rebuilds config, sample data and expected values from the workbook |

## How the config works

The engine holds no methodology numbers. Everything it uses comes from the methodology file:
change a tier, threshold, weight or statement by issuing a new versioned file (for example
`methodology_v0.6.json`) with a change-log entry, and load it with `load_methodology(path)`.
Every assessment records `methodology_version`, so benchmarks only compare like with like.
Labels are data too, so the ORX display can be swapped for Basel labels without code changes.

## Departments and roll-up

The default reporting level follows firm size: fewer than 30 staff report at level A (2 groups),
30-150 at level B (4 groups), more than 150 at level C (8 groups). A firm can override it
(`AssessmentInputs.reporting_level`). Any group below the minimum reporting size (5) is merged with
its smallest sibling under the same parent (for example "Compliance & legal + Risk & internal audit").
A level-A table (Revenue-generating vs Support & control) is always produced for comparison.

See `NOTES.md` for reconciliation notes and the synthetic test results.
