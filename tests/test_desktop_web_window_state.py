from desktop_web import _geometry_intersects_available_screens, _runtime_icon_path


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


def test_windows_runtime_icon_prefers_ico(tmp_path, monkeypatch) -> None:
    from energyradar import config

    assets = tmp_path / "ui" / "assets"
    assets.mkdir(parents=True)
    ico = assets / "logo.ico"
    png = assets / "icon-512.png"
    ico.write_bytes(b"ico")
    png.write_bytes(b"png")
    monkeypatch.setattr(config, "BASE_DIR", tmp_path)

    assert _runtime_icon_path("win32") == ico


def test_macos_and_linux_runtime_icon_use_neutral_png(tmp_path, monkeypatch) -> None:
    from energyradar import config

    assets = tmp_path / "ui" / "assets"
    assets.mkdir(parents=True)
    (assets / "logo.ico").write_bytes(b"ico")
    png = assets / "icon-512.png"
    png.write_bytes(b"png")
    monkeypatch.setattr(config, "BASE_DIR", tmp_path)

    assert _runtime_icon_path("darwin") == png
    assert _runtime_icon_path("linux") == png


def test_missing_runtime_icon_falls_back_without_error(tmp_path, monkeypatch) -> None:
    from energyradar import config

    monkeypatch.setattr(config, "BASE_DIR", tmp_path)

    assert _runtime_icon_path("darwin") is None
