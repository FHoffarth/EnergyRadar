; Inno Setup script for the EnergyRadar Windows installer.
;
; Build with:  ISCC.exe installer\EnergyRadar.iss
; Override the version without editing this file:
;   ISCC.exe /DMyAppVersion=0.5.0-rc2 installer\EnergyRadar.iss
;
; Keep MyAppVersion in step with energyradar/config.py APP_VERSION and with
; packaging/version_info.txt, which carries the executable's own resource.

#ifndef MyAppVersion
  #define MyAppVersion "0.5.0-rc1"
#endif
; Four-field numeric form for the setup binary's own version resource.
#ifndef MyAppVersionNumeric
  #define MyAppVersionNumeric "0.5.0.0"
#endif

[Setup]
; AppId is the upgrade identity and must never change, or Windows treats a new
; build as a separate product and installs it alongside the old one.
; Earlier builds shipped without an explicit AppId, so Inno derived it from
; AppName and registered "EnergyRadar_is1". Setting that same value keeps the
; upgrade path from those installs intact -- switching to a fresh GUID here
; would strand them as a second entry in Add/Remove Programs.
AppId=EnergyRadar
AppName=EnergyRadar
AppVersion={#MyAppVersion}
AppVerName=EnergyRadar {#MyAppVersion}
AppPublisher=Florian Hoffarth
AppCopyright=© 2026 Florian Hoffarth. All rights reserved.
VersionInfoVersion={#MyAppVersionNumeric}
VersionInfoProductVersion={#MyAppVersionNumeric}
VersionInfoCompany=Florian Hoffarth
VersionInfoCopyright=© 2026 Florian Hoffarth. All rights reserved.
DefaultDirName={autopf}\EnergyRadar
DefaultGroupName=EnergyRadar
UninstallDisplayName=EnergyRadar
OutputDir=..\release
OutputBaseFilename=EnergyRadar-{#MyAppVersion}-Setup
Compression=lzma
SolidCompression=yes
SetupIconFile=..\energyradar\ui\assets\logo.ico
UninstallDisplayIcon={app}\EnergyRadar.exe
WizardStyle=modern
; The payload is a 64-bit PyInstaller bundle, so refuse systems that cannot run
; it. This does not change the install location.
ArchitecturesAllowed=x64compatible
;
; DELIBERATELY NOT SET: ArchitecturesInstallIn64BitMode=x64compatible
;
; Setting it is the "correct" end state -- the installer would then run 64-bit
; and {autopf} would resolve to "Program Files" instead of "Program Files (x86)",
; where a 64-bit application belongs. It is not enabled yet because it silently
; breaks upgrades from already-installed builds: those registered under
; HKLM\SOFTWARE\WOW6432Node\...\EnergyRadar_is1 (32-bit registry view), and a
; 64-bit-mode installer reads the 64-bit view, does not find them, and registers
; a second entry in Add/Remove Programs beside the old one.
;
; Moving to 64-bit mode therefore needs [Code] that detects and removes the
; legacy 32-bit registration first, and that migration must be validated with an
; elevated fresh-install/upgrade/uninstall pass before it ships.
; PySide6 / Qt WebEngine require Windows 10 or newer.
MinVersion=10.0
PrivilegesRequired=admin
; Offer to close a running instance during an upgrade instead of failing on
; locked files, and restart it afterwards.
CloseApplications=yes
RestartApplications=yes

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked

[InstallDelete]
; Clear the packaged runtime before copying the new one. [Files] overwrites but
; never removes, so upgrading left files behind from older builds -- an upgrade
; from 0.9 Beta stranded 192 of them, including the retired QML UI and the
; pythonnet, webview, clr_loader and Flask trees. Those are on the import path
; and are no longer tracked by the uninstaller once unins000.dat is rewritten,
; so they would also survive an uninstall.
;
; Scoped deliberately to {app}\_internal, the PyInstaller runtime directory:
;   - user data lives in %LOCALAPPDATA%\EnergyRadar (config.py maps DATA_DIR,
;     DB_PATH and DATA_SOURCE_CONFIG_PATH there when frozen), so settings, the
;     measurement database and logs are untouched;
;   - unins000.exe and unins000.dat sit in {app} root, not in _internal, so the
;     uninstaller survives;
;   - the whole application directory is NOT deleted.
Type: filesandordirs; Name: "{app}\_internal"

[Files]
Source: "..\dist\EnergyRadar\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\EnergyRadar"; Filename: "{app}\EnergyRadar.exe"
Name: "{group}\{cm:UninstallProgram,EnergyRadar}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\EnergyRadar"; Filename: "{app}\EnergyRadar.exe"; Tasks: desktopicon

[Run]
Filename: "{app}\EnergyRadar.exe"; Description: "{cm:LaunchProgram,EnergyRadar}"; Flags: nowait postinstall skipifsilent

; No [Dirs] entry for the user data directory: the application creates
; %LOCALAPPDATA%\EnergyRadar itself at runtime (services/migration.py and
; ui/settings.py both mkdir(parents=True, exist_ok=True)). Creating it here
; would place it in the elevating administrator's profile, not the user's.
;
; User settings and the measurement database live in %LOCALAPPDATA%\EnergyRadar
; and are deliberately left in place by the uninstaller, so an upgrade or a
; reinstall keeps the user's configuration and history.
