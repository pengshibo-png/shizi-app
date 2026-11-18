#!/usr/bin/env pwsh
<#
  android-fix.ps1 — 让 Capacitor 8 项目能在 JDK 17 下构建

  背景：Capacitor 8 的模板把 sourceCompatibility 钉死成 Java 21，
  而本机只有 JDK 17。Capacitor 的 Android 代码没有用到 Java 21 独有特性，
  降到 17 不影响功能。这三个文件里有两个是 `cap sync` 自动生成的，
  所以每次 sync 之后都要重新跑一遍这个脚本。

  用法（在 repo 根目录）：
    pwsh scripts/android-fix.ps1 -App learner
    pwsh scripts/android-fix.ps1 -App monitor
#>

param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('learner', 'monitor')]
    [string]$App
)

$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$androidDir = Join-Path $root "apps/$App/android"
if (-not (Test-Path $androidDir)) {
    throw "找不到 $androidDir，先跑 pnpm cap add android"
}

$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
$patched = @()

# 1) 自动生成的两个 gradle 文件：Java 21 -> 17
foreach ($rel in @('app/capacitor.build.gradle', 'capacitor-cordova-android-plugins/build.gradle')) {
    $p = Join-Path $androidDir $rel
    if (-not (Test-Path $p)) { continue }
    $c = [System.IO.File]::ReadAllText($p, [System.Text.Encoding]::UTF8)
    if ($c -match 'JavaVersion\.VERSION_21') {
        [System.IO.File]::WriteAllText($p, ($c -replace 'JavaVersion\.VERSION_21', 'JavaVersion.VERSION_17'), $utf8NoBom)
        $patched += $rel
    }
}

# 2) gradle.properties：允许含非 ASCII 字符的项目路径（AGP 默认拒绝）
$gp = Join-Path $androidDir 'gradle.properties'
$gpLines = @(
    '# Project-wide Gradle settings.',
    'org.gradle.jvmargs=-Xmx2048m -XX:MaxMetaspaceSize=512m',
    'android.useAndroidX=true',
    'android.enableJetifier=false',
    '# 项目目录含中文（用户指定），AGP 默认拒绝构建，这是官方绕过开关',
    'android.overridePathCheck=true'
)
$existing = if (Test-Path $gp) { Get-Content $gp -Raw } else { '' }
if ($existing -notmatch 'overridePathCheck') {
    $gpLines | Set-Content $gp -Encoding UTF8
    $patched += 'gradle.properties'
}

# 3) local.properties：指向本机 Android SDK
$lp = Join-Path $androidDir 'local.properties'
if (-not (Test-Path $lp)) {
    "sdk.dir=D\:\\Android\\Sdk" | Set-Content $lp -Encoding ASCII
    $patched += 'local.properties'
}

# 4) wrapper 镜像：services.gradle.org 常超时，改走腾讯镜像
$wp = Join-Path $androidDir 'gradle/wrapper/gradle-wrapper.properties'
if (Test-Path $wp) {
    $c = Get-Content $wp -Raw
    if ($c -match 'services\.gradle\.org') {
        $c = $c -replace 'https\\?://services\.gradle\.org/distributions', 'https\://mirrors.cloud.tencent.com/gradle'
        $c = $c -replace 'networkTimeout=10000', 'networkTimeout=120000'
        [System.IO.File]::WriteAllText($wp, $c, $utf8NoBom)
        $patched += 'gradle-wrapper.properties'
    }
}

if ($patched.Count -eq 0) {
    Write-Host "  $App: 已经是修好的状态，无需改动"
} else {
    Write-Host "  $App: 修复 $($patched -join ', ')"
}