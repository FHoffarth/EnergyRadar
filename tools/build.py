import os
import sys
import subprocess
from pathlib import Path
import shutil

def main():
    print("Starting EnergyRadar Build Process...")
    base_dir = Path(__file__).resolve().parent.parent
    spec_file = base_dir / "packaging" / "EnergyRadar.spec"
    frontend_index = base_dir / "frontend" / "react-ui" / "dist" / "index.html"
    dist_dir = base_dir / "dist"
    build_dir = base_dir / "build"

    if not frontend_index.exists():
        print("React production build is missing:", frontend_index)
        print("Run npm.cmd ci, npm.cmd run lint and npm.cmd run build in frontend/react-ui first.")
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

    # Run PyInstaller
    os.environ["PYTHONPATH"] = str(base_dir)
    result = subprocess.run([sys.executable, "-m", "PyInstaller", "--clean", "--noconfirm", str(spec_file)], cwd=base_dir)

    if result.returncode == 0:
        print("Build successful. Dist folder created at:", dist_dir)
    else:
        print("Build failed.")
        sys.exit(1)

if __name__ == "__main__":
    main()
