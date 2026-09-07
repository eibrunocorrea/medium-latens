; Criado por Bruno Correa
#ifndef Origem
#define Origem "..\.."
#endif
#define Versao FileRead(FileOpen(Origem + "\VERSION"))

[Setup]
AppId={{4B1F0B2E-7C51-4C1B-9B8E-5D2A6E3F8C11}
AppName=Medium Latens
AppVersion={#Versao}
AppPublisher=Bruno Correa
AppCopyright=Criado por Bruno Correa
DefaultDirName={localappdata}\Programs\Medium Latens
DefaultGroupName=Medium Latens
DisableDirPage=yes
PrivilegesRequired=lowest
OutputDir=..\..\dist
OutputBaseFilename=Medium-Latens-Setup-{#Versao}
SetupIconFile={#Origem}\assets\icon\icon.ico
UninstallDisplayIcon={app}\assets\icon\icon.ico
WizardStyle=modern
LicenseFile={#Origem}\TERMOS.md

[Files]
Source: "{#Origem}\*"; DestDir: "{app}"; Flags: recursesubdirs ignoreversion; Excludes: ".git\*,node_modules\*,test\*,dist\*,remotion\*,installer\macos\*,install-panel.sh,test.sh,.gitignore,.env,config.json,profiles.json,credentials.json,mcp-config.json,data\*,workspaces\*,*.log,__pycache__\*,*.pyc,installer\bootstrap.sh,installer\desinstalar.sh,installer\windows\*"

[Icons]
Name: "{group}\Medium Latens"; Filename: "wscript.exe"; Parameters: """{app}\status\abrir-hidden.vbs"""; IconFilename: "{app}\assets\icon\icon.ico"
Name: "{group}\Desinstalar Medium Latens"; Filename: "{uninstallexe}"

[UninstallRun]
Filename: "powershell.exe"; Parameters: "-ExecutionPolicy Bypass -File ""{app}\windows\uninstall-service.ps1"""; Flags: runhidden waituntilterminated; RunOnceId: "RemoverServico"

[UninstallDelete]
Type: filesandordirs; Name: "{userappdata}\Adobe\CEP\extensions\MediumLatens"

[Code]
procedure CurStepChanged(CurStep: TSetupStep);
var
  Codigo: Integer;
  Comando, Parametros, Log: String;
begin
  if CurStep = ssPostInstall then
  begin
    Comando := ExpandConstant('{sysnative}\WindowsPowerShell\v1.0\powershell.exe');
    Parametros := '-NoProfile -ExecutionPolicy Bypass -File "' + ExpandConstant('{app}\installer\bootstrap.ps1') + '" -AppDir "' + ExpandConstant('{app}') + '"';
    Log := ExpandConstant('{userappdata}\Medium Latens\logs\install.log');
    WizardForm.StatusLabel.Caption := 'Instalando os componentes. Isso pode levar alguns minutos.';
    if not Exec(Comando, Parametros, '', SW_HIDE, ewWaitUntilTerminated, Codigo) then
      Codigo := -1;
    if Codigo <> 0 then
      MsgBox('A instalacao dos componentes nao terminou. Veja o log em ' + Log + ' e execute o instalador de novo.', mbError, MB_OK);
  end;
end;
