# Pholama installer for Windows. In PowerShell run:
#   irm https://raw.githubusercontent.com/genity5-collab/Pholama/main/install/install.ps1 | iex
$ErrorActionPreference = 'Stop'
$dir = Join-Path $env:USERPROFILE 'Pholama'
$zip = 'https://github.com/genity5-collab/Pholama/archive/refs/heads/main.zip'
function Say($m) { Write-Host ""; Write-Host "  $m" }

# Use the Node.js already on this PC when it is new enough; otherwise fetch a private copy (no install, no admin, nothing system-wide).
$nodeExe = 'node'
$ok = $false
$found = Get-Command node -ErrorAction SilentlyContinue
if ($found) { $nodeExe = $found.Source; try { $ok = ([int](node -p "process.versions.node.split('.')[0]")) -ge 18 } catch { $ok = $false } }
if (-not $ok) {
  $priv = Join-Path $env:USERPROFILE '.pholama\node'
  $privNode = Join-Path $priv 'node.exe'
  if (-not (Test-Path $privNode)) {
    Say "No Node.js found, so Pholama is getting its own private copy (about 30 MB, one time). Nothing is installed on your PC."
    $nv = 'v20.20.2'
    $arch = if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { 'arm64' } else { 'x64' }
    $nzip = Join-Path $env:TEMP ('node_' + [guid]::NewGuid().ToString('N') + '.zip')
    $nout = Join-Path $env:TEMP ('nodex_' + [guid]::NewGuid().ToString('N'))
    try {
      Invoke-WebRequest "https://nodejs.org/dist/$nv/node-$nv-win-$arch.zip" -OutFile $nzip -UseBasicParsing
      Expand-Archive $nzip -DestinationPath $nout -Force
      $inner = Get-ChildItem $nout -Directory | Select-Object -First 1
      New-Item -ItemType Directory -Path $priv -Force | Out-Null
      Copy-Item (Join-Path $inner.FullName '*') $priv -Recurse -Force
    } catch {
      Say "Could not get Node.js ($($_.Exception.Message)). Check your internet connection and run the command again."
      return
    } finally {
      Remove-Item $nzip -Force -ErrorAction SilentlyContinue
      Remove-Item $nout -Recurse -Force -ErrorAction SilentlyContinue
    }
  }
  if (-not (Test-Path $privNode)) { Say "Node.js did not unpack correctly. Please run the command again."; return }
  $nodeExe = $privNode
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
foreach ($n in 'pholama','phollama') { Set-Content -Path (Join-Path $bin "$n.cmd") -Value "@echo off`r`n`"$nodeExe`" `"$dir\server\cli.js`" %*" -Encoding ASCII }
$null = & $nodeExe (Join-Path $dir 'server\cli.js') schedule-updates 2>&1
if ($LASTEXITCODE -eq 0) { Say "Background updates are scheduled every 5 hours while Pholama is closed." } else { Say "Could not install background updates. Retry later with: pholama schedule-updates" }
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
& $nodeExe server\cli.js web
