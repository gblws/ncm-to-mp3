$ErrorActionPreference = 'Stop'
$NcmProject = Split-Path -Parent $PSScriptRoot
$NcmTools = Join-Path $NcmProject '.tools'
New-Item -ItemType Directory -Force -Path $NcmTools | Out-Null
$NcmArchive = Join-Path $NcmTools 'ffmpeg-essentials.zip'
$NcmExtract = Join-Path $NcmTools 'ffmpeg-essentials'
$NcmDownload = 'https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip'
Write-Host 'Downloading FFmpeg from gyan.dev (listed by ffmpeg.org)...'
Invoke-WebRequest -UseBasicParsing -Uri $NcmDownload -OutFile $NcmArchive
$NcmChecksum = (Invoke-WebRequest -UseBasicParsing -Uri ($NcmDownload + '.sha256')).Content
if ($NcmChecksum -is [byte[]]) { $NcmChecksum = [Text.Encoding]::UTF8.GetString($NcmChecksum) }
$NcmExpected = [regex]::Match([string]$NcmChecksum, '[a-fA-F0-9]{64}').Value
$NcmActual = (Get-FileHash -Algorithm SHA256 -LiteralPath $NcmArchive).Hash
if (-not $NcmExpected -or $NcmActual -ne $NcmExpected) { throw 'FFmpeg SHA256 checksum mismatch. No binaries have been installed.' }
Expand-Archive -LiteralPath $NcmArchive -DestinationPath $NcmExtract -Force
$NcmBinary = Get-ChildItem -LiteralPath $NcmExtract -Recurse -File -Filter ffmpeg.exe | Select-Object -First 1
if (-not $NcmBinary) { throw 'ffmpeg.exe was not found in the downloaded archive.' }
Copy-Item -LiteralPath $NcmBinary.FullName -Destination (Join-Path $NcmTools 'ffmpeg.exe') -Force
Write-Host 'FFmpeg is ready. Restart the local server to enable FLAC conversion.'
Write-Host 'FFmpeg is separate software with its own license: https://ffmpeg.org/legal.html'
