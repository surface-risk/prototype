"""Load the versioned methodology configuration.

All weights, thresholds, tiers, statements, checks and country values live in
``config/methodology_v<version>.json``. The engine reads them from there and
holds no methodology numbers of its own, so a methodology change is a new
config file (with a change log entry), not a code change.
"""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

PACKAGE_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_CONFIG = PACKAGE_ROOT / "config" / "methodology_v0.5.json"


@dataclass
class Methodology:
    """Typed view over the methodology JSON."""

    raw: dict[str, Any]
    version: str = ""
    params: dict[str, Any] = field(default_factory=dict)
    areas: list[dict[str, Any]] = field(default_factory=list)
    statements: list[dict[str, Any]] = field(default_factory=list)
    checks: list[dict[str, Any]] = field(default_factory=list)
    exposures: list[dict[str, Any]] = field(default_factory=list)

    def __post_init__(self) -> None:
        self.version = self.raw["methodology_version"]
        self.params = self.raw["parameters"]
        self.areas = self.raw["areas"]
        self.statements = self.raw["statements"]
        self.checks = self.raw["checks"]
        self.exposures = self.raw["exposures"]

    # ---- convenience lookups -------------------------------------------------
    @property
    def area_codes(self) -> list[str]:
        return [a["code"] for a in self.areas]

    def area(self, code: str) -> dict[str, Any]:
        return next(a for a in self.areas if a["code"] == code)

    @property
    def bands(self) -> list[dict[str, Any]]:
        return self.raw["bands"]

    @property
    def archetypes(self) -> dict[str, str]:
        return {a["key"]: a["name"] for a in self.raw["archetypes"]}

    @property
    def country_risk(self) -> dict[str, dict[str, float]]:
        return self.raw["country_risk"]["countries"]

    @property
    def hierarchy(self) -> list[dict[str, str]]:
        return self.raw["department_hierarchy"]

    @property
    def management_scoring(self) -> dict[str, Any]:
        return self.raw["management_scoring"]

    def default_level(self, headcount: int) -> str:
        """Default department reporting level for a firm of this size (A, B or C)."""
        for rule in self.raw["default_reporting_level"]:
            limit = rule["max_headcount_exclusive"]
            if limit is None or headcount < limit:
                return rule["level"]
        return "C"


def load_methodology(path: str | Path | None = None) -> Methodology:
    """Load a methodology config (defaults to v0.5)."""
    p = Path(path) if path else DEFAULT_CONFIG
    return Methodology(json.loads(p.read_text(encoding="utf-8")))
