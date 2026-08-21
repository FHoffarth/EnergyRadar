"""Phase B — decision-model tests (autonomy, self-consumption, daily verdict,
inverter night status, weather status). Pure logic; no UI."""
from __future__ import annotations

from datetime import datetime, timezone

from energyradar.services import decision


# --------------------------- autarkie --------------------------------------- #
def test_autarkie_formula():
    r = decision.autarkie(house_kwh=7.2, import_kwh=3.6)
    assert r.state == "available" and r.value_pct == 50


def test_autarkie_full_when_no_import():
    assert decision.autarkie(10.0, 0.0).value_pct == 100


def test_autarkie_unknown_stays_unknown():
    assert decision.autarkie(None, 3.6).state == "unavailable"
    assert decision.autarkie(7.2, None).state == "unavailable"


def test_autarkie_zero_consumption_unavailable():
    assert decision.autarkie(0.0, 0.0).reason == "house_consumption_not_positive"


def test_autarkie_import_exceeds_house_is_conflict_not_zero():
    r = decision.autarkie(house_kwh=2.0, import_kwh=5.0)
    assert r.value_pct is None and r.state == "conflict" and r.reason == "autarky_out_of_bounds"


# --------------------------- eigenverbrauch --------------------------------- #
def test_eigenverbrauch_formula():
    # gen 12.8, export 9.2 → self 3.6 → 28 %
    assert decision.eigenverbrauch(12.8, 9.2).value_pct == 28


def test_eigenverbrauch_export_exceeds_generation_conflict():
    r = decision.eigenverbrauch(5.0, 9.0)
    assert r.value_pct is None and r.reason == "export_exceeds_generation"


def test_eigenverbrauch_zero_generation_unavailable():
    assert decision.eigenverbrauch(0.0, 0.0).state == "unavailable"


# --------------------------- daily verdict ---------------------------------- #
def test_verdict_class_by_autonomy_thresholds():
    assert decision.daily_verdict(87, 60, coverage_complete=True, economic_value_available=True).assessment_class == "excellent"
    assert decision.daily_verdict(70, 60, coverage_complete=True, economic_value_available=True).assessment_class == "strong"
    assert decision.daily_verdict(50, 60, coverage_complete=True, economic_value_available=True).assessment_class == "balanced"
    assert decision.daily_verdict(30, 60, coverage_complete=True, economic_value_available=True).assessment_class == "grid_dependent"


def test_verdict_partial_coverage_keeps_class_but_marks_trust():
    v = decision.daily_verdict(87, 60, coverage_complete=False, economic_value_available=True)
    assert v.assessment_class == "excellent"      # coverage does NOT change the class
    assert v.trust == "partial"
    assert "vorläufig" in v.sentence


def test_verdict_not_assessable_when_autonomy_unknown():
    v = decision.daily_verdict(None, None, coverage_complete=False, economic_value_available=False)
    assert v.assessable is False and v.trust == "not_assessable"


def test_verdict_conflict_reason_is_explained():
    v = decision.daily_verdict(None, None, coverage_complete=True, economic_value_available=True,
                               autarkie_reason="autarky_out_of_bounds")
    assert "nicht vergleichbar" in v.sentence


def test_verdict_low_self_consumption_nuance():
    v = decision.daily_verdict(85, 20, coverage_complete=True, economic_value_available=True)
    assert "eingespeist" in v.sentence


def test_verdict_missing_tariff_nuance_not_a_false_claim():
    v = decision.daily_verdict(85, 60, coverage_complete=True, economic_value_available=False)
    assert "ohne hinterlegten Stromtarif" in v.sentence


# --------------------------- inverter night status -------------------------- #
def _local(h):
    return datetime(2026, 8, 3, h, 0, tzinfo=timezone.utc)


def test_inverter_night_via_sun_times_is_healthy_not_offline():
    s = decision.inverter_status(configured=True, live_fresh=False, error=False,
                                 now_local=_local(23), sunrise=_local(5), sunset=_local(20),
                                 has_archive=True)
    assert s.state == "night_standby" and s.healthy is True
    assert "Nachtbetrieb" in s.label and "Archiv verfügbar" in s.label


def test_inverter_night_clock_fallback_when_no_sun_times():
    s = decision.inverter_status(configured=True, live_fresh=False, error=False,
                                 now_local=_local(23), sunrise=None, sunset=None, has_archive=False)
    assert s.state == "night_standby" and "Archiv verfügbar" not in s.label


def test_inverter_wake_window_before_sunrise():
    s = decision.inverter_status(configured=True, live_fresh=False, error=False,
                                 now_local=_local(4), sunrise=_local(5), sunset=_local(20), has_archive=True)
    # 04:00, sunrise 05:00 → within 60 min lead
    assert s.state == "wake_window" and s.healthy is True


def test_inverter_daytime_no_signal_is_unexpected_offline():
    s = decision.inverter_status(configured=True, live_fresh=False, error=False,
                                 now_local=_local(12), sunrise=_local(5), sunset=_local(20), has_archive=True)
    assert s.state == "offline_unexpected" and s.healthy is False


def test_inverter_error_only_with_fault_evidence():
    s = decision.inverter_status(configured=True, live_fresh=False, error=True,
                                 now_local=_local(12), sunrise=None, sunset=None, has_archive=False)
    assert s.state == "error"


def test_inverter_live_and_unconfigured():
    assert decision.inverter_status(configured=True, live_fresh=True, error=False,
                                    now_local=_local(12), sunrise=None, sunset=None, has_archive=True).state == "live"
    assert decision.inverter_status(configured=False, live_fresh=False, error=False,
                                    now_local=_local(12), sunrise=None, sunset=None, has_archive=False).state == "unconfigured"


# --------------------------- weather status --------------------------------- #
def test_weather_reachable_but_not_loaded():
    s = decision.weather_status(location_configured=True, provider_reachable=True, loaded=False, fresh=False)
    assert s.state == "reachable_not_loaded"
    assert s.label == "Wetterdienst erreichbar · Wetterdaten noch nicht geladen"


def test_weather_fresh_and_stale_and_unreachable():
    assert decision.weather_status(location_configured=True, provider_reachable=True, loaded=True, fresh=True, last_update_local="16:42").state == "loaded"
    assert "16:42" in decision.weather_status(location_configured=True, provider_reachable=True, loaded=True, fresh=True, last_update_local="16:42").label
    assert decision.weather_status(location_configured=True, provider_reachable=True, loaded=True, fresh=False, last_update_local="12:10").state == "stale"
    assert decision.weather_status(location_configured=True, provider_reachable=False, loaded=False, fresh=False).state == "unreachable"


def test_weather_unconfigured():
    assert decision.weather_status(location_configured=False, provider_reachable=False, loaded=False, fresh=False).state == "unconfigured"


# --------------------------- legacy compat ---------------------------------- #
def test_recommend_still_works():
    assert decision.recommend(2000.0)[0] == "excellent"
    assert decision.recommend(0.0)[0] == "none"
