import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_ROOT / "energyradar"))

import desktop  # noqa: E402


class WindowStateTests(unittest.TestCase):
    def test_windows_minimized_sentinel_is_rejected(self):
        with patch.object(desktop.sys, "platform", "win32"), patch.object(
            desktop, "_windows_rect_intersects_monitor"
        ) as monitor_check:
            self.assertFalse(
                desktop._is_window_position_visible(-32000, -32000, 980, 900)
            )
            monitor_check.assert_not_called()

    def test_windows_offscreen_position_is_rejected(self):
        with patch.object(desktop.sys, "platform", "win32"), patch.object(
            desktop, "_windows_rect_intersects_monitor", return_value=False
        ):
            self.assertFalse(desktop._is_window_position_visible(5000, 100, 980, 900))

    def test_load_state_discards_invalid_position_but_keeps_size(self):
        with tempfile.TemporaryDirectory() as directory:
            state_file = Path(directory) / "window.json"
            state_file.write_text(
                json.dumps({"width": 980, "height": 900, "x": -32000, "y": -32000}),
                encoding="utf-8",
            )
            with patch.object(desktop, "_state_file", return_value=state_file):
                state = desktop._load_window_state()

        self.assertEqual((state["width"], state["height"]), (980, 900))
        self.assertIsNone(state["x"])
        self.assertIsNone(state["y"])

    def test_capture_geometry_does_not_persist_minimized_coordinates(self):
        window = type(
            "Window", (), {"width": 980, "height": 900, "x": -32000, "y": -32000}
        )()
        state = {"width": 980, "height": 900, "x": 100, "y": 120}

        desktop._capture_geometry(window, state)

        self.assertEqual((state["x"], state["y"]), (100, 120))


if __name__ == "__main__":
    unittest.main()
