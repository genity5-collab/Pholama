# Pholama installer for Windows. In PowerShell run:
#   irm https://raw.githubusercontent.com/genity5-collab/Pholama/main/install/install.ps1 | iex
$ErrorActionPreference = 'Stop'
$dir = Join-Path $env:USERPROFILE 'Pholama'
$zip = 'https://github.com/genity5-collab/Pholama/archive/refs/heads/main.zip'
function Say($m) { Write-Host ""; Write-Host "  $m" }

$node = Get-Command node -ErrorAction SilentlyContinue
$ok = $false
if ($node) { $ok = ([int](node -p "process.versions.node.split('.')[0]")) -ge 18 }
if (-not $ok) {
  Say "Node.js 18 or newer is needed."
  if (Get-Command winget -ErrorAction SilentlyContinue) {
    Say "Installing Node.js with winget ..."
    winget install -e --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
    Say "Node.js installed. Close this window, open a new PowerShell and run the install command again."
    return
  }
  Say "Get it from https://nodejs.org, then run this again."
  return
}

Say "Downloading Pholama to $dir ..."
$tmp = Join-Path $env:TEMP ('pholama_' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $tmp | Out-Null
Invoke-WebRequest $zip -OutFile "$tmp\p.zip"
Expand-Archive "$tmp\p.zip" -DestinationPath $tmp -Force
New-Item -ItemType Directory -Path $dir -Force | Out-Null
Copy-Item "$tmp\Pholama-main\*" $dir -Recurse -Force
Remove-Item $tmp -Recurse -Force
# make the pholama command available in new terminals
$bin = Join-Path $env:USERPROFILE '.pholama\cmd'; New-Item -ItemType Directory -Path $bin -Force | Out-Null
foreach ($n in 'pholama','phollama') { Set-Content -Path (Join-Path $bin "$n.cmd") -Value "@echo off`r`nnode `"$dir\server\cli.js`" %*" -Encoding ASCII }
$path = [Environment]::GetEnvironmentVariable('Path','User')
if (($path -split ';') -notcontains $bin) { [Environment]::SetEnvironmentVariable('Path', "$path;$bin", 'User') }
# Desktop + Start Menu shortcuts that carry the Pholama llama icon, so it is easy to spot and click
try {
  $ws = New-Object -ComObject WScript.Shell
  $targets = @((Join-Path ([Environment]::GetFolderPath('Desktop')) 'Pholama.lnk'), (Join-Path ([Environment]::GetFolderPath('Programs')) 'Pholama.lnk'))
  foreach ($t in $targets) {
    $sc = $ws.CreateShortcut($t)
    $sc.TargetPath = Join-Path $env:SystemRoot 'System32\wscript.exe'
    $sc.Arguments = '"' + (Join-Path $dir 'install\Pholama.vbs') + '"'
    $sc.WorkingDirectory = $dir
    $sc.IconLocation = (Join-Path $dir 'install\pholama.ico') + ',0'
    $sc.Description = 'Pholama: private AI on your PC'
    $sc.Save()
  }
  Say "Added a Pholama icon (llama) to your Desktop and Start Menu. Double-click it to open Pholama."
} catch { Say "Could not add the Desktop icon ($($_.Exception.Message)). You can still double-click start.bat." }
Say "Installed. Open a NEW terminal and try:  pholama list    then:  pholama pull qwen2.5-0.5b"
Say "Or open the app now: double-click start.bat in $dir"
Set-Location $dir
node server\cli.js web
