import importlib.util
import os
import tempfile
import unittest
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]
VALIDATOR_PATH = PROJECT_ROOT / "tools" / "validate_macos_bundle.py"
SPEC = importlib.util.spec_from_file_location("validate_macos_bundle", VALIDATOR_PATH)
assert SPEC and SPEC.loader
validator = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(validator)


class MacOSArm64BundleContractTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.root = Path(self.directory.name)
        self.app = self.root / "EnergyRadar.app"
        self.executable = self.app / "Contents" / "MacOS" / "EnergyRadar"
        self.react_dist = (
            self.app / "Contents" / "Resources" / "react-ui" / "dist"
        )
        self.executable.parent.mkdir(parents=True)
        self.executable.write_bytes(b"fake Mach-O")
        self.executable.chmod(self.executable.stat().st_mode | 0o111)
        (self.app / "Contents" / "Info.plist").write_text(
            "<plist></plist>", encoding="utf-8"
        )
        (self.react_dist / "assets").mkdir(parents=True)
        (self.react_dist / "index.html").write_text(
            "<html></html>", encoding="utf-8"
        )
        (self.react_dist / "assets" / "app.js").write_text(
            'const placeholder="fronius.local";', encoding="utf-8"
        )
        qt_process = (
            self.app
            / "Contents"
            / "Frameworks"
            / "QtWebEngineCore.framework"
            / "Helpers"
            / "QtWebEngineProcess"
        )
        qt_process.parent.mkdir(parents=True)
        qt_process.write_bytes(b"fake Mach-O")
        qt_process.chmod(qt_process.stat().st_mode | 0o111)

        setup_wizard = (
            self.root
            / "frontend"
            / "react-ui"
            / "src"
            / "components"
            / "SetupWizardModal.tsx"
        )
        setup_wizard.parent.mkdir(parents=True)
        setup_wizard.write_text(
            """
            const [host, setHost] = useState('');
            <input value={host} placeholder="fronius.local" />
            """,
            encoding="utf-8",
        )

    def tearDown(self):
        self.directory.cleanup()

    def test_expected_artifact_names(self):
        self.assertEqual(
            validator.ARM64_ARCHIVE_NAME, "EnergyRadar-macOS-arm64.zip"
        )
        self.assertEqual(
            validator.ARM64_CHECKSUM_NAME,
            "EnergyRadar-macOS-arm64.zip.sha256",
        )

    def test_valid_arm64_bundle_contract(self):
        validator.validate_structure(self.app, self.root)
        audited = validator.validate_architectures(
            self.app, arch_reader=lambda _path: {"arm64"}
        )
        self.assertGreaterEqual(len(audited), 2)

    def test_x86_64_only_dependency_is_rejected(self):
        def architectures(path):
            if path == self.executable:
                return {"arm64"}
            return {"x86_64"}

        with self.assertRaisesRegex(
            validator.BundleValidationError, "without arm64 support"
        ):
            validator.validate_architectures(self.app, arch_reader=architectures)

    def test_universal_main_executable_is_rejected(self):
        with self.assertRaisesRegex(
            validator.BundleValidationError, "native arm64 only"
        ):
            validator.validate_architectures(
                self.app, arch_reader=lambda _path: {"arm64", "x86_64"}
            )

    def test_private_configuration_and_database_are_rejected(self):
        private_config = self.app / "Contents" / "Resources" / "data-source.json"
        private_config.write_text("{}", encoding="utf-8")
        with self.assertRaisesRegex(
            validator.BundleValidationError, "Private configuration"
        ):
            validator.validate_structure(self.app, self.root)

        private_config.unlink()
        database = self.app / "Contents" / "Resources" / "energy.db"
        database.write_bytes(b"SQLite")
        with self.assertRaisesRegex(
            validator.BundleValidationError, "local database"
        ):
            validator.validate_structure(self.app, self.root)

    def test_setup_host_must_remain_empty(self):
        setup_wizard = (
            self.root
            / "frontend"
            / "react-ui"
            / "src"
            / "components"
            / "SetupWizardModal.tsx"
        )
        setup_wizard.write_text(
            """
            const [host, setHost] = useState('fronius.local');
            <input value={host} placeholder="fronius.local" />
            """,
            encoding="utf-8",
        )
        with self.assertRaisesRegex(
            validator.BundleValidationError, "host default is not empty"
        ):
            validator.validate_structure(self.app, self.root)


class MacOSArm64WorkflowContractTests(unittest.TestCase):
    def test_workflow_uses_native_runner_and_exact_artifacts(self):
        workflow = (PROJECT_ROOT / ".github" / "workflows" / "build.yml").read_text(
            encoding="utf-8"
        )
        self.assertIn("name: Build macOS (Apple Silicon arm64)", workflow)
        self.assertIn("runs-on: macos-15", workflow)
        self.assertIn("EnergyRadar-macOS-arm64.zip", workflow)
        self.assertIn("EnergyRadar-macOS-arm64.zip.sha256", workflow)
        self.assertIn("python3 tools/validate_macos_bundle.py", workflow)


if __name__ == "__main__":
    unittest.main()
