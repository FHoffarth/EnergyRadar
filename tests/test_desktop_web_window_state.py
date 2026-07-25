from desktop_web import _geometry_intersects_available_screens


SCREENS = [(0, 0, 1920, 1040)]


def test_visible_window_geometry_is_accepted() -> None:
    assert _geometry_intersects_available_screens(160, 80, 1280, 800, SCREENS)


def test_minimized_off_screen_geometry_is_rejected() -> None:
    assert not _geometry_intersects_available_screens(
        -32000,
        -32000,
        1280,
        800,
        SCREENS,
    )


def test_too_small_window_geometry_is_rejected() -> None:
    assert not _geometry_intersects_available_screens(160, 80, 320, 200, SCREENS)
