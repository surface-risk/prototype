"""Small statistics helpers that match the spreadsheet functions used in the workbook."""
from __future__ import annotations

import math
from typing import Iterable, Optional


def clean(values: Iterable[Optional[float]]) -> list[float]:
    """Drop missing values (Don't know / not answered)."""
    return [float(v) for v in values if v is not None]


def mean(values: Iterable[Optional[float]]) -> Optional[float]:
    """Excel AVERAGE: mean of numeric values, None if there are none."""
    v = clean(values)
    return sum(v) / len(v) if v else None


def stdev(values: Iterable[Optional[float]]) -> Optional[float]:
    """Excel STDEV (sample standard deviation); None for fewer than 2 values."""
    v = clean(values)
    if len(v) < 2:
        return None
    m = sum(v) / len(v)
    return math.sqrt(sum((x - m) ** 2 for x in v) / (len(v) - 1))


def stdevp(values: Iterable[Optional[float]]) -> Optional[float]:
    """Excel STDEVP (population standard deviation); None if empty."""
    v = clean(values)
    if not v:
        return None
    m = sum(v) / len(v)
    return math.sqrt(sum((x - m) ** 2 for x in v) / len(v))


def median(values: Iterable[Optional[float]]) -> Optional[float]:
    v = sorted(clean(values))
    if not v:
        return None
    mid = len(v) // 2
    return v[mid] if len(v) % 2 else (v[mid - 1] + v[mid]) / 2
