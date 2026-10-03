@echo off
rem Pholama launcher. First run also puts a Pholama (llama) icon on your Desktop.
cd /d "%~dp0"
if not exist "%USERPROFILE%\Desktop\Pholama.lnk" (
  powershell -NoProfile -ExecutionPolicy Bypass -Command "try{$w=New-Object -ComObject WScript.Shell;$d=(Get-Location).Path;$s=$w.CreateShortcut([IO.Path]::Combine([Environment]::GetFolderPath('Desktop'),'Pholama.lnk'));$s.TargetPath=[IO.Path]::Combine($env:SystemRoot,'System32','wscript.exe');$s.Arguments='\"'+[IO.Path]::Combine($d,'install','Pholama.vbs')+'\"';$s.WorkingDirectory=$d;$s.IconLocation=[IO.Path]::Combine($d,'install','pholama.ico')+',0';$s.Description='Pholama: private AI on your PC';$s.Save()}catch{}" >nul 2>&1
)
node server\server.js
pause
