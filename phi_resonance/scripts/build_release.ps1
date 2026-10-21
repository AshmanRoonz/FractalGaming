<#
Build the signed Android App Bundle (.aab) for Google Play.

Created: 2026-10-19
Last updated: 2026-10-20
Version: 1.1

Run it yourself, in PowerShell, from anywhere:

    powershell -ExecutionPolicy Bypass -File C:\Users\ashro\Fractal_Reality\FractalGaming\phi_resonance\scripts\build_release.ps1

- The first run makes your upload key: keytool asks for a new password twice. The key file lives
  outside the repo, at %USERPROFILE%\phi-resonance-keys\phi-resonance-upload.jks. Back up that file and
  its password: every update to the app on Google Play has to be signed with this key.
- Every run asks for the password. It holds it in this window's memory only, passes it to Gradle in the
  environment, and clears it when the build ends; nothing writes it to disk.
- The bundle is signed with your upload key; Google Play signs the app for phones with its own key
  (Play App Signing), so the upload key never reaches anyone's phone.
- The page in the bundle is www/index.html as it stands (build it first with scripts/build_page.py when
  the web page changed). Before each new upload, raise versionCode in android/app/build.gradle.

Revision history:
- 2026-10-20 v1.1: finds git when it is not on Windows' PATH (the first real run stopped right after
  cap sync, because Git for Windows was on Git Bash's path only), checks its tools before asking for
  anything, and judges each program by its exit code instead of by what it prints on stderr
- 2026-10-19 v1.0: initial
#>
param(
    [string]$Keystore = (Join-Path $env:USERPROFILE 'phi-resonance-keys\phi-resonance-upload.jks'),
    [string]$Alias = 'upload'
)
$ErrorActionPreference = 'Stop'
$jdk = 'C:\Program Files\Android\openjdk\jdk-21.0.8'
$sdk = 'C:\Program Files (x86)\Android\android-sdk'
$keytool = Join-Path $jdk 'bin\keytool.exe'
$app = Split-Path -Parent $PSScriptRoot          # phi_resonance\
$repo = Split-Path -Parent $app                   # FractalGaming\

if (-not (Test-Path (Join-Path $app 'node_modules'))) {
    throw "phi_resonance\node_modules is missing: run 'npm ci' in $app first."
}

# Find every tool before asking for anything. git is often missing from Windows' PATH (Git for Windows
# can leave it to Git Bash), so look in its usual homes too.
$git = (Get-Command git.exe -ErrorAction SilentlyContinue | Select-Object -First 1).Source
if (-not $git) {
    $git = @("$env:ProgramFiles\Git\cmd\git.exe", "$env:LOCALAPPDATA\Programs\Git\cmd\git.exe") |
        Where-Object { Test-Path $_ } | Select-Object -First 1
}
if (-not $git) { throw 'git was not found. Install Git for Windows (git-scm.com), then run this again.' }
if (-not (Get-Command npx -ErrorAction SilentlyContinue)) { throw 'npx was not found. Install Node.js (nodejs.org), then run this again.' }
if (-not (Test-Path $keytool)) { throw "keytool was not found at $keytool." }
if (-not (Test-Path $sdk)) { throw "The Android SDK was not found at $sdk." }

function Invoke-Native([scriptblock]$Command, [string]$Failure) {
    # Programs run under 'Continue' and are judged by their exit code: Windows PowerShell can turn a
    # warning a program prints on stderr into an error, which 'Stop' would make fatal. A program that
    # cannot start leaves no exit code, which also counts as a failure.
    $ErrorActionPreference = 'Continue'
    $global:LASTEXITCODE = $null
    & $Command
    if ($LASTEXITCODE -ne 0) { throw $Failure }
}

if (-not (Test-Path $Keystore)) {
    New-Item -ItemType Directory -Force (Split-Path $Keystore) | Out-Null
    Write-Host ''
    Write-Host "Making your upload key at $Keystore"
    Write-Host 'keytool asks for a new password twice. Choose a strong one and keep it somewhere safe.'
    Invoke-Native { & $keytool -genkeypair -keystore $Keystore -storetype PKCS12 -alias $Alias -keyalg RSA -keysize 4096 -validity 10000 -dname 'CN=Ashman Roonz, O=Fractal Reality, C=CA' } 'keytool could not make the key.'
    Write-Host "Upload key made. Back up $Keystore now (and its password)."
}

$secure = Read-Host -AsSecureString 'Upload key password'
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
$password = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
try {
    $env:JAVA_HOME = $jdk
    $env:ANDROID_HOME = $sdk
    $env:ORG_GRADLE_PROJECT_androidBuildTools = '36.0.0'   # the build-tools this PC's SDK has
    $env:PHI_UPLOAD_KEYSTORE = $Keystore
    $env:PHI_UPLOAD_KEY_ALIAS = $Alias
    $env:PHI_UPLOAD_STORE_PASSWORD = $password
    $env:PHI_UPLOAD_KEY_PASSWORD = $password

    Push-Location $app
    try {
        Invoke-Native { & npx --no cap sync android } 'cap sync failed.'
        # cap sync writes absolute paths here when node_modules is a link; keep the committed files
        Invoke-Native { & $git -C $repo checkout -q -- phi_resonance/android/app/capacitor.build.gradle phi_resonance/android/capacitor.settings.gradle } 'git could not restore the Capacitor Gradle files.'
        Push-Location (Join-Path $app 'android')
        try {
            Invoke-Native { & .\gradlew.bat bundleRelease --no-daemon --console=plain } 'The release build failed (see above). A wrong password shows up here as a keystore error.'
        } finally { Pop-Location }
    } finally { Pop-Location }

    $aab = Join-Path $app 'android\app\build\outputs\bundle\release\app-release.aab'
    $gradle = Get-Content (Join-Path $app 'android\app\build.gradle') -Raw
    $code = [regex]::Match($gradle, 'versionCode\s+(\d+)').Groups[1].Value
    $name = [regex]::Match($gradle, 'versionName\s+"([^"]+)"').Groups[1].Value
    $out = Join-Path (Split-Path $aab) "phi-resonance-$name-$code.aab"
    Copy-Item $aab $out -Force
    Write-Host ''
    Write-Host "Signed bundle ready to upload to Google Play: $out"
} finally {
    Remove-Item Env:PHI_UPLOAD_STORE_PASSWORD, Env:PHI_UPLOAD_KEY_PASSWORD -ErrorAction SilentlyContinue
    $password = $null
    if ($bstr) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
}
