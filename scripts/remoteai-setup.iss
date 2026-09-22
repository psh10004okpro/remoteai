#define MyAppName "RemoteAI"
#define MyAppVersion "0.1.4"
#define MyAppPublisher "RemoteAI"
#define MyAppURL "https://remote.unwoldamstudio.com"
#define MyAppExeName "RemoteAI.vbs"

[Setup]
AppId={{B8F3A21E-7C54-4D91-9E2A-1F6B8C0D3E47}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
AppPublisherURL={#MyAppURL}
AppSupportURL={#MyAppURL}
DefaultDirName={autopf}\RemoteAI
DefaultGroupName={#MyAppName}
DisableProgramGroupPage=yes
PrivilegesRequired=admin
UsePreviousTasks=yes
CloseApplications=yes
AppMutex=RemoteAIHostSetup
DisableReadyPage=no
OutputDir=..\dist
OutputBaseFilename=RemoteAI-Setup
Compression=lzma2/fast
SolidCompression=no
WizardStyle=modern
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
UninstallDisplayName=RemoteAI 호스트
SetupLogging=yes

[Languages]
Name: "korean"; MessagesFile: "compiler:Languages\Korean.isl"

[Tasks]
Name: "desktopicon"; Description: "바탕화면 바로가기"; GroupDescription: "바로가기:"
Name: "service"; Description: "로그인·잠금 화면에서도 대기 (Windows 서비스, 권장)"; GroupDescription: "추가 기능:"; Flags: checkedonce

[Files]
Source: "..\dist\RemoteAI-Host\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\RemoteAI"; Filename: "{app}\{#MyAppExeName}"; WorkingDir: "{app}"; IconFilename: "{app}\node.exe"
Name: "{group}\{cm:UninstallProgram,{#MyAppName}}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\RemoteAI"; Filename: "{app}\{#MyAppExeName}"; WorkingDir: "{app}"; Tasks: desktopicon

[Run]
Filename: "{sys}\wscript.exe"; Parameters: """{app}\{#MyAppExeName}"""; Description: "지금 호스트 시작"; Flags: nowait postinstall; Check: not WantService
Filename: "{app}\RemoteAI-service.exe"; Parameters: "install"; StatusMsg: "Windows 서비스 등록 중…"; Flags: runhidden; Check: WantService
Filename: "{sys}\sc.exe"; Parameters: "start RemoteAIHost"; StatusMsg: "서비스 시작…"; Flags: runhidden; Check: WantService

[UninstallRun]
Filename: "{app}\RemoteAI-service.exe"; Parameters: "stop"; Flags: runhidden; RunOnceId: "StopSvc"
Filename: "{app}\RemoteAI-service.exe"; Parameters: "uninstall"; Flags: runhidden; RunOnceId: "DelSvc"

[Code]
function WantService: Boolean;
begin
  Result := WizardIsTaskSelected('service');
end;

procedure CurStepChanged(CurStep: TSetupStep);
var
  S: AnsiString;
  Xml: String;
begin
  if (CurStep = ssPostInstall) and WantService then
  begin
    Xml :=
      '<service>' +
      '<id>RemoteAIHost</id><name>RemoteAI Host</name>' +
      '<description>RemoteAI host</description>' +
      '<executable>' + ExpandConstant('{app}\node.exe') + '</executable>' +
      '<arguments>"' + ExpandConstant('{app}\app\index.js') + '" --service</arguments>' +
      '<workingdirectory>' + ExpandConstant('{app}') + '</workingdirectory>' +
      '<stoptimeout>8sec</stoptimeout>' +
      '<onfailure action="restart" delay="4 sec"/>' +
      '<logpath>' + ExpandConstant('{app}') + '</logpath>' +
      '<env name="REMOTEAI_PACKAGED" value="1"/>' +
      '<env name="REMOTEAI_HOME" value="' + ExpandConstant('{app}') + '"/>' +
      '<startmode>Automatic</startmode><delayedAutoStart>true</delayedAutoStart>' +
      '</service>';
    S := Xml;
    SaveStringToFile(ExpandConstant('{app}\RemoteAI-service.xml'), S, False);
    CreateDir(ExpandConstant('{win}\System32\config\systemprofile\AppData\Roaming\RemoteAI'));
    FileCopy(ExpandConstant('{userappdata}\RemoteAI\config.json'), ExpandConstant('{win}\System32\config\systemprofile\AppData\Roaming\RemoteAI\config.json'), True);
  end;
end;
