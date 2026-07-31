from energyradar.ui import settings


def test_fresh_profile_resolves_runtime_defaults() -> None:
    effective = settings.resolve_effective({})

    assert effective["refresh_seconds"] == 5
    assert effective["fronius_address"] == ""
    assert effective["mt175_address"] == ""


def test_legacy_minute_poll_is_bounded_for_live_freshness() -> None:
    raw = {"refresh_seconds": 60}

    effective = settings.resolve_effective(raw)

    assert effective["refresh_seconds"] == settings.MAX_LIVE_REFRESH_SECONDS
    assert raw["refresh_seconds"] == 60


def test_invalid_persisted_poll_falls_back_to_default() -> None:
    assert settings.resolve_effective({"refresh_seconds": "60"})["refresh_seconds"] == 5
    assert settings.resolve_effective({"refresh_seconds": float("nan")})["refresh_seconds"] == 5
