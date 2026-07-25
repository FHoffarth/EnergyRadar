[Setup]
AppName=EnergyRadar
AppVersion=0.9 Beta
AppPublisher=EnergyRadar
DefaultDirName={autopf}\EnergyRadar
DefaultGroupName=EnergyRadar
OutputDir=..\release
OutputBaseFilename=EnergyRadar-0.9-Beta-Setup-QML
Compression=lzma
SolidCompression=yes
SetupIconFile=..\energyradar\ui\assets\logo.ico
UninstallDisplayIcon={app}\EnergyRadar.exe

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked

[Files]
Source: "..\dist\EnergyRadar\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\EnergyRadar"; Filename: "{app}\EnergyRadar.exe"
Name: "{group}\{cm:UninstallProgram,EnergyRadar}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\EnergyRadar"; Filename: "{app}\EnergyRadar.exe"; Tasks: desktopicon

[Run]
Filename: "{app}\EnergyRadar.exe"; Description: "{cm:LaunchProgram,EnergyRadar}"; Flags: nowait postinstall skipifsilent

[Dirs]
Name: "{localappdata}\EnergyRadar"; Permissions: users-modify
