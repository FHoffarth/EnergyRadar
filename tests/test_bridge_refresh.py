from pathlib import Path


def test_startup_refresh_does_not_wait_for_recurring_timer() -> None:
    source = Path("energyradar/ui/bridge.py").read_text(encoding="utf-8")

    assert "QTimer.singleShot(0, self._on_timer)" in source


def test_qml_does_not_offer_a_hidden_minute_live_cadence() -> None:
    source = Path("energyradar/ui/qml/SettingsScreen.qml").read_text(encoding="utf-8")

    refresh_slider = source[source.index("// Refresh"):source.index("// Theme")]
    assert "from: 3" in refresh_slider
    assert "to: 10" in refresh_slider
    assert "to: 60" not in refresh_slider
