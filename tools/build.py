import shutil
import json
import os
import platform
import subprocess
import sys
import tempfile
from pathlib import Path


def _source_commit(base_dir: Path) -> str:
    github_sha = os.environ.get("GITHUB_SHA")
    if github_sha:
        return github_sha
    result = subprocess.run(
        ["git", "rev-parse", "HEAD"],
        cwd=base_dir,
        check=True,
        capture_output=True,
        text=True,
    )
    return result.stdout.strip()


def _write_build_info(
    destination: Path,
    base_dir: Path,
    app_version: str,
    app_build: str = "1",
) -> Path:
    build_info = {
        "app_version": app_version,
        "bundle_version": app_version.partition("-")[0],
        "build_version": app_build,
        "source_commit": _source_commit(base_dir),
        "architecture": platform.machine(),
        "signing": "verified after bundle creation",
        "notarized": False,
        "stapled": False,
    }
    destination.write_text(
        json.dumps(build_info, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    return destination


def main():
    print("Starting EnergyRadar Build Process...")
    base_dir = Path(__file__).resolve().parent.parent
    sys.path.insert(0, str(base_dir))
    from energyradar import config
    spec_file = base_dir / "packaging" / "EnergyRadar.spec"
    frontend_index = base_dir / "frontend" / "react-ui" / "dist" / "index.html"
    dist_dir = base_dir / "dist"
    build_dir = base_dir / "build"

    if not frontend_index.exists():
        print("React production build is missing:", frontend_index)
        print("Run npm.cmd ci, npm.cmd run lint and npm.cmd run build in frontend/react-ui first.")
        sys.exit(1)
    if not spec_file.exists():
        print("Canonical PyInstaller spec is missing:", spec_file)
        sys.exit(1)

    # Cleanup old builds
    if dist_dir.exists():
        shutil.rmtree(dist_dir, ignore_errors=True)
    if build_dir.exists():
        shutil.rmtree(build_dir, ignore_errors=True)

    print(f"Running PyInstaller with spec: {spec_file}")

    try:
        import PyInstaller
    except ImportError:
        print("PyInstaller is missing. Install the pinned requirements from requirements-build.txt.")
        sys.exit(1)

    # Generate build metadata before packaging so it is covered by the final
    # macOS bundle signature instead of modifying the signed app afterwards.
    os.environ["PYTHONPATH"] = str(base_dir)
    with tempfile.TemporaryDirectory(prefix="energyradar-buildinfo-") as directory:
        build_info = _write_build_info(
            Path(directory) / "BUILDINFO.json",
            base_dir,
            config.APP_VERSION,
            config.APP_BUILD,
        )
        build_environment = os.environ.copy()
        build_environment["ENERGYRADAR_BUILDINFO_PATH"] = str(build_info)
        result = subprocess.run(
            [sys.executable, "-m", "PyInstaller", "--clean", "--noconfirm", str(spec_file)],
            cwd=base_dir,
            check=False,
            env=build_environment,
        )

    if result.returncode == 0:
        expected_output = (
            dist_dir / "EnergyRadar.app"
            if sys.platform == "darwin"
            else dist_dir / "EnergyRadar" / ("EnergyRadar.exe" if os.name == "nt" else "EnergyRadar")
        )
        if not expected_output.exists():
            print("Build completed but expected output is missing:", expected_output)
            sys.exit(1)
        print("Build successful:", expected_output)
    else:
        print("Build failed.")
        sys.exit(1)


if __name__ == "__main__":
    main()
