"""Assemble the single-file prototype.

Outputs
  web/dist/artifact.html  page content only (the claude.ai Artifact host adds the document skeleton)
  web/dist/index.html     full standalone HTML document for local use or any static host

Usage: python web/tools/build.py
"""
import json
import pathlib

ROOT = pathlib.Path(__file__).resolve().parents[2]
WEB = ROOT / "web"
ENG = ROOT / "engine"

report = json.loads((WEB / "data/sample_report.json").read_text())
ui = json.loads((WEB / "data/ui_content.json").read_text())
tests = json.loads((WEB / "data/engine_tests.json").read_text())
profile = json.loads((ENG / "sample_data/firm_profile.json").read_text())
cfg = json.loads((ENG / "config/methodology_v0.5.json").read_text())
staff = json.loads((ENG / "sample_data/staff_responses.json").read_text())

# Fictional invitation list: department mix of the sample respondents scaled to the firm's headcount.
counts = {}
for r in staff:
    counts[r["department_c"]] = counts.get(r["department_c"], 0) + 1
total = sum(counts.values())
roster = {k: round(v * profile["headcount"] / total) for k, v in counts.items()}
diff = profile["headcount"] - sum(roster.values())
roster[max(roster, key=roster.get)] += diff

data = {"report": report, "ui": ui, "tests": tests, "profile": profile, "roster": roster,
        "mgmtScoring": cfg["management_scoring"]}
mark = (WEB / "brand/mark_paths.txt").read_text().strip()

css = (WEB / "src/page.css").read_text()
js = "\n".join((WEB / f"src/{n}").read_text() for n in ("app-core.js", "app-report.js", "app-demo.js"))

def safe_json(o):
    return json.dumps(o, ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/")

head = """<title>Surface Risk</title>
<meta name="claude:viewport-fit-sides" content="cover">
<meta name="description" content="Surface Risk prototype: a benchmarked diagnostic of operational risk and performance for financial services firms.">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@100..125,400..700&family=IBM+Plex+Mono:wght@400;500;600&family=IBM+Plex+Sans:wght@400;500;600&display=swap">
"""
favicon = '<link rel="icon" href="data:image/svg+xml,' + (
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#0E1A2E"/>' + mark + "</svg>"
).replace("#", "%23").replace('"', "'") + '">\n'

body = f"""<style>
{css}
</style>
<div id="app"></div>
<script>window.SR_DATA = {safe_json(data)};
window.SR_MARK = {json.dumps(mark)};</script>
<script>
{js}
</script>
"""

dist = WEB / "dist"
dist.mkdir(exist_ok=True)
(dist / "artifact.html").write_text(head + body)
(dist / "index.html").write_text(
    "<!doctype html>\n<html lang=\"en\">\n<head>\n<meta charset=\"utf-8\">\n"
    "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1, viewport-fit=cover\">\n"
    + head + favicon + "</head>\n<body>\n" + body + "</body>\n</html>\n")
print("built", {p.name: p.stat().st_size for p in dist.iterdir()}, "roster", roster)
