"""Input data structures for one assessment, and the fictional sample firm loader."""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Optional

from .config import PACKAGE_ROOT

SAMPLE_DIR = PACKAGE_ROOT / "sample_data"


@dataclass
class FirmProfile:
    """Set-up data entered by the client admin (EX1-EX8)."""

    name: str
    headcount: int
    business_line_mix: dict[str, float]          # ORX code -> share of revenue
    footprint: dict[str, dict[str, float]]       # OFF/AFF/CLI/PRV/CPT -> country -> share
    providers: list[dict[str, Any]] = field(default_factory=list)
    first_contact: str = ""
    loaded_cost_usd: float = 0.0
    centre: str = ""
    date: str = ""
    fictional: bool = False


@dataclass
class StaffResponse:
    """One staff respondent. Answers are 0-100 as given (None = Don't know / skipped)."""

    id: str
    department_c: str
    business_line: str
    minutes: float
    answers: dict[str, Optional[float]]
    seniority: str = ""
    rework_share: Optional[float] = None          # A2
    sole_performer_activities: int = 0            # A3 count
    unclear_activities: int = 0                   # A4 count


@dataclass
class ManagerResponse:
    """One senior manager: mirror statements plus capability and alignment questions."""

    role: str
    answers: dict[str, Optional[float]]
    mc1_top5: list[str]
    mc2: str
    mc3: str
    mc4_correct_owners: float
    mc5: str
    mc6: str
    mc7: str
    mc8_contact: str
    mc8_offline: bool
    alignment: dict[str, float]


@dataclass
class CheckResult:
    """Raw result of an automated / partner check (not yet converted to points)."""

    run: bool
    result: Optional[float]


@dataclass
class AssessmentInputs:
    profile: FirmProfile
    staff: list[StaffResponse]
    managers: list[ManagerResponse]
    checks: dict[str, CheckResult]
    peers: dict[str, float]                       # area code -> peer score (illustrative)
    reporting_level: Optional[str] = None         # override A/B/C; default by headcount


def _read(name: str) -> Any:
    return json.loads((SAMPLE_DIR / name).read_text(encoding="utf-8"))


def load_sample() -> AssessmentInputs:
    """Load the fictional sample firm (Example Wealth Partners Ltd)."""
    p = _read("firm_profile.json")
    profile = FirmProfile(
        name=p["name"], headcount=p["headcount"], business_line_mix=p["business_line_mix"], footprint=p["footprint"],
        providers=p["providers"], first_contact=p["first_contact"], loaded_cost_usd=p["loaded_cost_usd"],
        centre=p["centre"], date=p["date"], fictional=True,
    )
    staff = [StaffResponse(**s) for s in _read("staff_responses.json")]
    managers = [ManagerResponse(**m) for m in _read("mgmt_responses.json")]
    checks = {k: CheckResult(**v) for k, v in _read("check_results.json").items()}
    peers = _read("peers.json")["area_scores"]
    return AssessmentInputs(profile, staff, managers, checks, peers)
