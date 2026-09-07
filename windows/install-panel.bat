@echo off
rem Medium Latens - instala o painel CEP (rodar com o Premiere FECHADO)
set SRC=%~dp0..\panel
set DST=%APPDATA%\Adobe\CEP\extensions\MediumLatens
echo Instalando painel em %DST% ...
if exist "%DST%" rmdir /s /q "%DST%"
mkdir "%DST%"
xcopy /e /i /q "%SRC%" "%DST%" >nul
for %%v in (9 10 11 12) do reg add "HKCU\Software\Adobe\CSXS.%%v" /v PlayerDebugMode /t REG_SZ /d 1 /f >nul
echo OK. Abra o Premiere: Window ^> Extensions ^> Medium Latens
pause
