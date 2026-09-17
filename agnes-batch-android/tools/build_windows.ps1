$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location $projectRoot
if (!$env:JAVA_HOME) {
    $studioJava = Join-Path $env:ProgramFiles 'Android\Android Studio\jbr'
    if (Test-Path (Join-Path $studioJava 'bin\java.exe')) { $env:JAVA_HOME = $studioJava }
}
if (!$env:JAVA_HOME -or !(Test-Path (Join-Path $env:JAVA_HOME 'bin\java.exe'))) {
    throw 'Can Android Studio hoac JDK 17+. Cai Android Studio truoc, roi chay lai file nay.'
}
if (!$env:ANDROID_HOME) { $env:ANDROID_HOME = Join-Path $env:LOCALAPPDATA 'Android\Sdk' }
if (!(Test-Path (Join-Path $env:ANDROID_HOME 'platforms\android-35\android.jar'))) {
    throw 'Mo Android Studio > SDK Manager > cai Android SDK Platform 35, roi chay lai.'
}
$gradleVersion = '8.9'
$downloadFolder = Join-Path $projectRoot '.build-tools'
$gradleFolder = Join-Path $downloadFolder "gradle-$gradleVersion"
if (!(Test-Path (Join-Path $gradleFolder 'bin\gradle.bat'))) {
    New-Item -ItemType Directory -Force $downloadFolder | Out-Null
    $zipPath = Join-Path $downloadFolder "gradle-$gradleVersion-bin.zip"
    $distributionUrl = "https://services.gradle.org/distributions/gradle-$gradleVersion-bin.zip"
    Write-Host 'Dang tai Gradle chinh thuc...'
    Invoke-WebRequest -UseBasicParsing -Uri $distributionUrl -OutFile $zipPath
    $expectedHash = ((Invoke-WebRequest -UseBasicParsing -Uri "$distributionUrl.sha256").Content).Trim().Split(' ')[0]
    $actualHash = (Get-FileHash -Algorithm SHA256 $zipPath).Hash.ToLowerInvariant()
    if ($actualHash -ne $expectedHash.ToLowerInvariant()) { throw 'Checksum Gradle khong dung.' }
    Expand-Archive -Path $zipPath -DestinationPath $downloadFolder -Force
    Remove-Item $zipPath
}
$gradleCommand = Join-Path $gradleFolder 'bin\gradle.bat'
& $gradleCommand --no-daemon wrapper --gradle-version $gradleVersion --distribution-type bin
if ($LASTEXITCODE -ne 0) { throw 'Tao Gradle wrapper that bai.' }
& $gradleCommand --no-daemon lintDebug assembleDebug
if ($LASTEXITCODE -ne 0) { throw 'Build that bai. Xem loi o tren; khong co APK moi duoc xuat.' }
$apkPath = Join-Path $projectRoot 'AgnesBatchAndroid.apk'
Copy-Item (Join-Path $projectRoot 'app\build\outputs\apk\debug\app-debug.apk') $apkPath -Force
Write-Host "DA TAO APK: $apkPath" -ForegroundColor Green
Start-Process explorer.exe -ArgumentList "/select,`"$apkPath`""
