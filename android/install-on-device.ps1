[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidateNotNullOrEmpty()]
    [string]$Serial,
    [string]$ApkPath = (Join-Path $PSScriptRoot 'app\build\outputs\apk\debug\app-debug.apk'),
    [string]$AdbPath = (Join-Path $env:LOCALAPPDATA 'Android\Sdk\platform-tools\adb.exe')
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$packageName = 'com.antisdream.nunsum'
$resolvedAdb = (Resolve-Path -LiteralPath $AdbPath).Path
$resolvedApk = (Resolve-Path -LiteralPath $ApkPath).Path
$sdkDirectory = Split-Path (Split-Path $resolvedAdb -Parent) -Parent
$aapt2Path = Join-Path $sdkDirectory 'build-tools\36.0.0\aapt2.exe'
if (-not (Test-Path -LiteralPath $aapt2Path -PathType Leaf)) {
    throw "APK 패키지 확인에 필요한 Android Build Tools 36.0.0을 찾지 못했습니다: $aapt2Path"
}

# 설치 전에 APK와 지정 기기부터 확인한다. 다른 패키지의 APK는 설치하지 않는다.
$badging = & $aapt2Path dump badging $resolvedApk 2>&1
if ($LASTEXITCODE -ne 0) { throw "APK 정보를 읽지 못했습니다: $badging" }
$packageLine = $badging | Where-Object { $_ -match '^package: name=' } | Select-Object -First 1
if (-not $packageLine -or $packageLine -notmatch "^package: name='com\.antisdream\.nunsum'") {
    throw '눈숨 테스트 패키지가 아닌 APK입니다. 설치를 중단합니다.'
}

function Invoke-DeviceAdb {
    param([Parameter(Mandatory)][string[]]$Arguments)
    $result = & $resolvedAdb -s $Serial @Arguments 2>&1
    if ($LASTEXITCODE -ne 0) { throw "adb 작업 실패 ($($Arguments -join ' ')): $result" }
    $result
}

$state = (Invoke-DeviceAdb -Arguments @('get-state') | Out-String).Trim()
if ($state -ne 'device') { throw "기기를 사용할 수 없습니다: $Serial ($state)" }

Invoke-DeviceAdb -Arguments @('reverse', 'tcp:3100', 'tcp:3100')
Invoke-DeviceAdb -Arguments @('reverse', 'tcp:2568', 'tcp:2568')
Invoke-DeviceAdb -Arguments @('install', '-r', $resolvedApk)
$launchResult = Invoke-DeviceAdb -Arguments @('shell', 'am', 'start', '-W', '-n', "$packageName/.MainActivity")
$launchResult | Write-Output
if (-not ($launchResult | Where-Object { $_ -match '^Status:\s+ok\s*$' })) {
    throw 'APK는 설치했지만 앱 실행 성공 응답을 확인하지 못했습니다.'
}
Write-Output "눈숨 테스트 설치 및 실행 완료: $Serial / $packageName"
