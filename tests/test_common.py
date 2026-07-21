"""pytest for the deterministic extraction helpers (extraction/scripts/common.py)."""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "extraction", "scripts"))
from common import (  # noqa: E402
    approved_positions, ALLOWED_OPERATING_POINT_POSITIONS,
    parse_number, parse_price, split_stage, is_na, m_to_ft, m3h_to_lpm,
)


def test_approved_positions_spec_map():
    assert approved_positions(6) == ([3, 4], True)
    assert approved_positions(8) == ([4, 5, 6], True)
    assert approved_positions(13) == ([6, 7, 8, 9], True)   # four points
    assert approved_positions(15) == ([7, 8, 9, 10], True)  # four points
    # >15 unsupported
    assert approved_positions(19) == ([], False)
    assert approved_positions(20) == ([], False)


def test_allowed_map_is_1_indexed_within_bounds():
    for count, positions in ALLOWED_OPERATING_POINT_POSITIONS.items():
        assert all(1 <= p <= count for p in positions)
        assert positions == sorted(positions)


def test_parse_number_rejects_non_numeric_and_dashes():
    assert parse_number("117") == 117.0
    assert parse_number("7.5") == 7.5
    assert parse_number("1,250") == 1250.0
    # NA tokens: parse to None AND report as NA
    for na in ("-", "--", "—", "", "#N/A", "N/A"):
        assert parse_number(na) is None
        assert is_na(na)
    # non-numeric but NOT NA (e.g. a starting method): None, but not "NA"
    assert parse_number("DOL") is None
    assert not is_na("DOL")


def test_parse_price_is_int_or_none():
    assert parse_price("34,516") == 34516
    assert parse_price("#N/A") is None      # never 0


def test_split_stage_preserves_suffix():
    assert split_stage("04A") == (4, "A", "4A")
    assert split_stage("4") == (4, None, "4")
    assert split_stage("12M1") == (12, "M1", "12M1")
    assert split_stage("4")[2] != split_stage("4A")[2]


def test_conversions():
    assert round(m_to_ft(30.48), 1) == 100.0
    assert round(m3h_to_lpm(1), 4) == 16.6667
