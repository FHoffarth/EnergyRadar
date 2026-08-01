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


def test_frozen_runtime_uses_user_data_instead_of_bundle(monkeypatch, tmp_path):
    bundle_resources = tmp_path / "EnergyRadar.app" / "Contents" / "Resources" / "energyradar"
    user_data = tmp_path / "Library" / "Application Support" / "EnergyRadar"
    monkeypatch.setattr(config, "BASE_DIR", bundle_resources)
    monkeypatch.setattr(config, "USER_DATA_DIR", user_data)
    monkeypatch.setattr(config.sys, "frozen", True, raising=False)

    runtime_data = config._runtime_data_dir()

    assert runtime_data == user_data
    assert not runtime_data.is_relative_to(tmp_path / "EnergyRadar.app")
