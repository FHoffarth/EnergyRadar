# Desktop Builds

EnergyRadar is built automatically as a zero-dependency desktop application for both Windows and macOS using GitHub Actions.

## Where to find the builds
Whenever a new release tag (e.g. `v1.0.0`) is pushed, or the `Build Desktop Apps` workflow is manually triggered, the resulting artifacts are uploaded directly to the GitHub Actions workflow run page.

1. Go to the **Actions** tab in this repository.
2. Select the **Build Desktop Apps** workflow.
3. Click on the latest successful run.
4. Scroll down to the **Artifacts** section and download:
   - `EnergyRadar-Windows`
   - `EnergyRadar-macOS`

## Running on Windows
1. Extract the downloaded `EnergyRadar-Windows.zip`.
2. Open the extracted folder.
3. Double-click the `EnergyRadar.exe` file.
   - The app will start natively as a window without any background terminal showing.

## Running on macOS
1. Extract the downloaded `EnergyRadar-macOS.zip`.
2. Locate the `EnergyRadar.app` bundle.
3. **Important:** Because this app is currently unsigned, macOS Gatekeeper will block you from opening it simply by double-clicking.
4. **To open it:** Right-click (or Control-click) the `EnergyRadar.app` file and select **Open**. You will see a warning prompt, but you will now have an "Open" button allowing you to launch the app.
5. The application will start natively.

## How to trigger a new build manually (for Maintainers)
1. Go to the **Actions** tab in GitHub.
2. Select **Build Desktop Apps** from the left sidebar.
3. Click the **Run workflow** dropdown on the right.
4. Select the branch and click **Run workflow**. 
