from energyradar import config


def test_macos_user_data_path_is_outside_application_bundle(monkeypatch, tmp_path):
    class PathWithTestHome:
        @staticmethod
        def home():
            return tmp_path / "Benutzer Änne"

    monkeypatch.setattr(config.sys, "platform", "darwin")
    monkeypatch.setattr(config, "Path", PathWithTestHome)

    data_dir = config._user_data_dir()

    assert data_dir == tmp_path / "Benutzer Änne" / "Library" / "Application Support" / "EnergyRadar"
    assert not data_dir.is_relative_to(config.BASE_DIR)
