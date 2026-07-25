from energyradar.ui import settings


def test_fresh_profile_resolves_runtime_defaults() -> None:
    effective = settings.resolve_effective({})

    assert effective["refresh_seconds"] == 5
    assert effective["fronius_address"] == ""
    assert effective["mt175_address"] == ""
