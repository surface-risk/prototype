# Engine notes (v0.5 port)

## Reconciliation with the workbook

All sample-firm values reproduce the workbook to within 0.01: area scores, 95% ranges, check weights,
preparedness, penalties, management scores and gaps, blind-spot flags, priorities, group (department and
business-line) shrunk scores, scores and L/H flags, group indices and archetypes, management capability
(46.18), MC1 overlap, alignment, average perception gap, hidden capacity, equal-weight check (Robust).
No mismatches were accepted.

Behaviours copied from the workbook that are worth knowing:

- **Group n** is the smallest per-area count of respondents in the group (Calc C114 = MIN(n)).
- **Data points** = statements with at least one included answer + checks that ran + exposures assigned
  to the area (exposures always count).
- **Tie-breaks** in priority and lowest-score rankings follow the workbook's ROW()-based nudges, so equal
  values rank in area order.
- **"Blind spots" column in the report** lists the five largest management-minus-staff gaps whether or not
  they pass the statistical test; the JSON adds `passes` so the UI can distinguish them.
- **Hidden capacity** = average rework share x headcount (12.8 FTE). The workbook does not apply the
  "recoverable share" (0.3) to this figure; the engine reports it separately as `recoverable_fte` (3.8).
- **Management capability MC3** answers are stored as text ("0", "1", "2-3", ...), matching the lookup table.

## Change from the workbook: roll-up of small groups

The workbook suppresses any group with fewer than 5 respondents ("n<5"). The engine instead merges a
small group with its smallest sibling under the same parent (e.g. at level C the sample firm's
Technology (4) is merged with HR, admin & facilities (5) into one group of 9, and Compliance & legal
with Risk & internal audit into 6). Only if no merge is possible is a group suppressed. At level B the
sample firm's groups are all 5 or more, so results are unchanged.

## Synthetic engine tests (this port)

Checks off; exposures on; 62 respondents and 4 managers with the sample firm's structure.
Random numbers differ from the workbook's, so values differ slightly; the conclusions are the same.

| Test | Loss | Perf. | Loss tilt | Archetype | Dept flags | Mgmt gap flags | Robustness |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Null firm, seed 1 | 50.8 | 51.2 | -0.3 | Steady | 0 | 3 | Sensitive |
| Null firm, seed 2 | 49.0 | 49.6 | -0.6 | Steady | 0 | 1 | Sensitive |
| Null firm, seed 3 | 49.5 | 50.0 | -0.6 | Steady | 0 | 1 | Sensitive |
| High-wire firm | 49.0 | 62.4 | -13.4 | Accelerating | 0 | 2 | Sensitive |
| Fortress firm | 53.7 | 41.1 | +12.5 | Steady | 0 | 3 | Robust |

Workbook equivalents: null 48-51 / 49-51, Steady, 0 dept flags, mgmt flags 0/0/2; High-wire 53 / 66
Accelerating; Fortress 49 / 37 Stalled.

Findings:

1. The engine does not invent department structure (0 false flags in every null run).
2. Management gap flags appear by chance with only 4 managers (1-3 per null run here). Treat blind
   spots as debrief prompts, not findings.
3. The Performance Index separates patterned firms; the Loss Index barely moves (structural - most
   High-loss areas are also High-performance). The Fortress firm lands in "Steady" here rather than
   "Stalled" because its Performance Index (41.1) sits just above the 40 boundary - the archetype is
   sensitive to noise near boundaries.
4. **The loss tilt (Loss - Performance) separates the two patterned firms clearly (-13.4 vs +12.5)
   while staying near 0 for random data (-0.3 to -0.6) and the sample firm (+0.9).** This supports the
   option of replacing the Loss axis with a loss tilt. The report JSON carries `loss_tilt` so the
   prototype can show both views.
