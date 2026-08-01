import importlib.util
import json
import os
import plistlib
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from energyradar import config


PROJECT_ROOT = Path(__file__).resolve().parents[1]
VALIDATOR_PATH = PROJECT_ROOT / "tools" / "validate_macos_bundle.py"
SPEC = importlib.util.spec_from_file_location("validate_macos_bundle", VALIDATOR_PATH)
assert SPEC and SPEC.loader
validator = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(validator)
BUILD_PATH = PROJECT_ROOT / "tools" / "build.py"
BUILD_SPEC = importlib.util.spec_from_file_location("build_tool", BUILD_PATH)
assert BUILD_SPEC and BUILD_SPEC.loader
build_tool = importlib.util.module_from_spec(BUILD_SPEC)
BUILD_SPEC.loader.exec_module(build_tool)


class MacOSBundleContractTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.root = Path(self.directory.name)
        self.app = self.root / "EnergyRadar.app"
        self.executable = self.app / "Contents" / "MacOS" / "EnergyRadar"
        resources = self.app / "Contents" / "Resources"
        frameworks = self.app / "Contents" / "Frameworks"
        self.react_dist = resources / "react-ui" / "dist"
        self.executable.parent.mkdir(parents=True)
        self.executable.write_bytes(b"fake Mach-O")
        self.executable.chmod(self.executable.stat().st_mode | 0o111)
        resources.mkdir(parents=True)
        with (self.app / "Contents" / "Info.plist").open("wb") as handle:
            plistlib.dump(
                {
                    "CFBundleExecutable": "EnergyRadar",
                    "CFBundleIdentifier": "com.energyradar.app",
                    "CFBundleShortVersionString": validator.macos_marketing_version(config.APP_VERSION),
                    "CFBundleVersion": config.APP_BUILD,
                    "CFBundleIconFile": "EnergyRadar.icns",
                },
                handle,
            )
        (resources / "EnergyRadar.icns").write_bytes(b"icon")
        (resources / "BUILDINFO.json").write_text(
            json.dumps(
                {
                    "app_version": config.APP_VERSION,
                    "bundle_version": validator.macos_marketing_version(config.APP_VERSION),
                    "build_version": config.APP_BUILD,
                    "source_commit": "1" * 40,
                    "architecture": "arm64",
                    "signing": "verified after bundle creation",
                    "notarized": False,
                    "stapled": False,
                }
            ),
            encoding="utf-8",
        )
        (self.react_dist / "assets").mkdir(parents=True)
        (self.react_dist / "index.html").write_text("<html></html>", encoding="utf-8")
        (self.react_dist / "assets" / "app.js").write_text('const placeholder="fronius.local";', encoding="utf-8")
        for relative in (
            "QtWebEngineCore.framework/Helpers/QtWebEngineProcess",
            "Python.framework/Versions/Current/Python",
            "PySide6/Qt/plugins/platforms/libqcocoa.dylib",
        ):
            path = frameworks / relative
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(b"fake Mach-O")
            path.chmod(path.stat().st_mode | 0o111)
        (resources / "qtwebengine_resources.pak").write_bytes(b"resources")

        setup_wizard = self.root / "frontend" / "react-ui" / "src" / "components" / "SetupWizardModal.tsx"
        setup_wizard.parent.mkdir(parents=True)
        setup_wizard.write_text(
            "const [host, setHost] = useState('');\n<input value={host} placeholder=\"fronius.local\" />",
            encoding="utf-8",
        )

    def tearDown(self):
        self.directory.cleanup()

    def test_commit_specific_artifact_names(self):
        self.assertEqual(validator.artifact_basename("arm64", "abcdef1"), "EnergyRadar-macOS-arm64-abcdef1.zip")
        self.assertEqual(validator.artifact_basename("x86_64", "abcdef1"), "EnergyRadar-macOS-x86_64-abcdef1.zip")

    def test_valid_arm64_bundle_contract(self):
        validator.validate_structure(self.app, self.root, "arm64")
        audited = validator.validate_architectures(
            self.app,
            "arm64",
            arch_reader=lambda _path: {"arm64"},
            audit_linkage=False,
        )
        self.assertGreaterEqual(len(audited), 4)

    def test_valid_intel_bundle_contract(self):
        payload = json.loads((self.app / "Contents" / "Resources" / "BUILDINFO.json").read_text())
        payload["architecture"] = "x86_64"
        (self.app / "Contents" / "Resources" / "BUILDINFO.json").write_text(json.dumps(payload))
        validator.validate_structure(self.app, self.root, "x86_64")
        validator.validate_architectures(
            self.app,
            "x86_64",
            arch_reader=lambda _path: {"x86_64"},
            audit_linkage=False,
        )

    def test_architecture_mismatch_is_rejected(self):
        with self.assertRaisesRegex(validator.BundleValidationError, "without arm64 support"):
            validator.validate_architectures(
                self.app,
                "arm64",
                arch_reader=lambda path: {"arm64"} if path == self.executable else {"x86_64"},
                audit_linkage=False,
            )

    def test_universal_main_executable_is_rejected(self):
        with self.assertRaisesRegex(validator.BundleValidationError, "native arm64 only"):
            validator.validate_architectures(
                self.app,
                "arm64",
                arch_reader=lambda _path: {"arm64", "x86_64"},
                audit_linkage=False,
            )

    @mock.patch.object(validator.subprocess, "run")
    def test_linkage_audit_ignores_otool_input_header_but_rejects_runtime_path(self, run):
        run.side_effect = [
            mock.Mock(stdout="/Users/runner/work/repo/EnergyRadar.app/Contents/MacOS/EnergyRadar:\n\t@rpath/QtCore\n"),
            mock.Mock(stdout="/Users/runner/work/repo/EnergyRadar.app/Contents/MacOS/EnergyRadar:\n          cmd LC_RPATH\n         path @loader_path (offset 12)\n"),
        ]
        self.assertEqual(validator._audit_linkage(self.executable), [])

        run.side_effect = [
            mock.Mock(stdout=f"{self.executable}:\n\t/Users/alice/Desktop/private/lib.dylib\n"),
            mock.Mock(stdout=f"{self.executable}:\n"),
        ]
        self.assertTrue(validator._audit_linkage(self.executable))

    def test_private_configuration_and_database_are_rejected(self):
        private_config = self.app / "Contents" / "Resources" / "data-source.json"
        private_config.write_text("{}", encoding="utf-8")
        with self.assertRaisesRegex(validator.BundleValidationError, "Private configuration"):
            validator.validate_structure(self.app, self.root, "arm64")

    def test_developer_path_is_rejected_in_text_but_binary_debug_strings_are_not_runtime_paths(self):
        binary = self.app / "Contents" / "Frameworks" / "third-party.dylib"
        binary.write_bytes(b"\xcf\xfa\xed\xfe\0/Users/vendor/work/library/source.cpp")
        validator.validate_structure(self.app, self.root, "arm64")

        text_resource = self.app / "Contents" / "Resources" / "runtime.conf"
        text_resource.write_text("resource=/Users/alice/Desktop/private/config.json", encoding="utf-8")
        with self.assertRaisesRegex(validator.BundleValidationError, "Developer-local paths"):
            validator.validate_structure(self.app, self.root, "arm64")

    def test_setup_host_must_remain_empty(self):
        setup_wizard = self.root / "frontend" / "react-ui" / "src" / "components" / "SetupWizardModal.tsx"
        setup_wizard.write_text(
            "const [host, setHost] = useState('fronius.local');\n<input value={host} placeholder=\"fronius.local\" />",
            encoding="utf-8",
        )
        with self.assertRaisesRegex(validator.BundleValidationError, "host default is not empty"):
            validator.validate_structure(self.app, self.root, "arm64")

    def test_buildinfo_must_match_workflow_commit_and_architecture(self):
        with self.assertRaisesRegex(validator.BundleValidationError, "workflow commit"):
            validator.validate_structure(self.app, self.root, "arm64", expected_source_commit="2" * 40)
        with self.assertRaisesRegex(validator.BundleValidationError, "architecture"):
            validator.validate_structure(self.app, self.root, "x86_64")


class MacOSWorkflowContractTests(unittest.TestCase):
    def test_buildinfo_records_authoritative_version_commit_and_architecture(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            build_info = root / "BUILDINFO.json"
            commit = "a" * 40
            with mock.patch.dict(os.environ, {"GITHUB_SHA": commit}), mock.patch.object(
                build_tool.platform, "machine", return_value="arm64"
            ):
                result = build_tool._write_build_info(build_info, root, config.APP_VERSION, config.APP_BUILD)

            payload = json.loads(result.read_text(encoding="utf-8"))
            self.assertEqual(payload["app_version"], config.APP_VERSION)
            self.assertEqual(payload["bundle_version"], validator.macos_marketing_version(config.APP_VERSION))
            self.assertEqual(payload["build_version"], config.APP_BUILD)
            self.assertEqual(payload["source_commit"], commit)
            self.assertEqual(payload["architecture"], "arm64")
            self.assertFalse(payload["notarized"])
            self.assertFalse(payload["stapled"])

    def test_workflow_uses_two_native_runners_and_commit_specific_artifacts(self):
        workflow = (PROJECT_ROOT / ".github" / "workflows" / "build.yml").read_text(encoding="utf-8")
        self.assertIn("runner: macos-15", workflow)
        self.assertIn("runner: macos-15-intel", workflow)
        self.assertIn("architecture: arm64", workflow)
        self.assertIn("architecture: x86_64", workflow)
        self.assertIn("EnergyRadar-macOS-${{ matrix.architecture }}-${short_sha}.zip", workflow)
        self.assertIn("--arch \"${{ matrix.architecture }}\"", workflow)
        self.assertIn("ARCHITECTURE-AUDIT.txt", workflow)
        self.assertIn("MACOS-SMOKE-CHECKLIST.txt", workflow)
        self.assertIn("KNOWN-LIMITATIONS.txt", workflow)
        self.assertNotIn("universal2", workflow.lower())

    def test_release_workflow_accepts_only_commit_specific_dual_architecture_assets(self):
        workflow = (PROJECT_ROOT / ".github" / "workflows" / "release.yml").read_text(encoding="utf-8")
        self.assertIn('arm_zip="EnergyRadar-macOS-arm64-${SHORT_SHA}.zip"', workflow)
        self.assertIn('intel_zip="EnergyRadar-macOS-x86_64-${SHORT_SHA}.zip"', workflow)
        self.assertIn('sha256sum --check --strict "$arm_zip.sha256"', workflow)
        self.assertIn('sha256sum --check --strict "$intel_zip.sha256"', workflow)


if __name__ == "__main__":
    unittest.main()
