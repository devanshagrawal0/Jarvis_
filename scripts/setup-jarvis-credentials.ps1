param(
  [string]$JarvisUrl = "http://127.0.0.1:8799"
)

$ErrorActionPreference = "Stop"

function Read-PlainSecret {
  param([string]$Prompt)
  $secure = Read-Host $Prompt -AsSecureString
  $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try {
    return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
  }
  finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
  }
}

function Normalize-PhoneNumber {
  param([string]$Value)
  $clean = ($Value -replace "[^\d+]", "")
  if ($clean -match "^\d{10}$") { return "+1$clean" }
  if ($clean -match "^1\d{10}$") { return "+$clean" }
  return $clean
}

function Save-JarvisSettings {
  param([hashtable]$Values)
  $session = New-Object Microsoft.PowerShell.Commands.WebRequestSession
  Invoke-WebRequest "$JarvisUrl/api/settings" -WebSession $session -UseBasicParsing | Out-Null
  return Invoke-RestMethod "$JarvisUrl/api/settings" `
    -Method Post `
    -WebSession $session `
    -ContentType "application/json" `
    -Body ($Values | ConvertTo-Json -Depth 6)
}

try {
  Invoke-WebRequest "$JarvisUrl/api/health" -UseBasicParsing -TimeoutSec 5 | Out-Null
}
catch {
  Write-Host ""
  Write-Host "JARVIS is not running at $JarvisUrl." -ForegroundColor Red
  Write-Host "Start it with: npm start"
  exit 1
}

Write-Host ""
Write-Host "JARVIS Secure Provider Setup" -ForegroundColor Cyan
Write-Host "Secrets are entered privately and stored in the Windows encrypted vault."
Write-Host ""
Write-Host "1. Twilio Phone"
Write-Host "2. Gemini Brain"
Write-Host "3. Google Workspace"
Write-Host "4. Kalshi"
Write-Host "5. Instagram Professional Messaging"
Write-Host "6. Canvas"
Write-Host "7. Optional API Keys"
Write-Host ""

$choice = Read-Host "Choose a provider"
$settings = @{}

switch ($choice) {
  "1" {
    $settings.twilioAccountSid = Read-Host "Twilio Account SID (starts with AC)"
    $settings.twilioAuthToken = Read-PlainSecret "Twilio Auth Token"
    $settings.twilioFromNumber = Normalize-PhoneNumber (Read-Host "Purchased Twilio number")
    $settings.phoneNumber = $settings.twilioFromNumber
    $settings.twilioAllowedCallers = Normalize-PhoneNumber (Read-Host "Your personal allowed phone number")
    $webhook = Read-Host "Public webhook base URL (press Enter if not deployed yet)"
    if ($webhook) { $settings.webhookBaseUrl = $webhook.TrimEnd("/") }
  }
  "2" {
    $settings.geminiKey = Read-PlainSecret "Gemini API key"
  }
  "3" {
    $settings.googleClientId = Read-Host "Google OAuth Client ID"
    $settings.googleClientSecret = Read-PlainSecret "Google OAuth Client Secret"
    $sender = Read-Host "Gmail sender address (optional)"
    if ($sender) { $settings.googleFromEmail = $sender }
  }
  "4" {
    $settings.kalshiKeyId = Read-Host "Kalshi API Key ID"
    Write-Host "Paste the RSA private key. Finish with a line containing only END."
    $lines = [System.Collections.Generic.List[string]]::new()
    while ($true) {
      $line = Read-Host
      if ($line -eq "END") { break }
      $lines.Add($line)
    }
    $settings.kalshiPrivateKey = $lines -join "`n"
    $environment = Read-Host "Environment (production/demo)"
    $settings.kalshiEnvironment = if ($environment -eq "demo") { "demo" } else { "production" }
  }
  "5" {
    $settings.instagramAccessToken = Read-PlainSecret "Instagram access token"
    $settings.instagramAccountId = Read-Host "Instagram professional account ID"
  }
  "6" {
    $settings.canvasBaseUrl = Read-Host "Canvas base URL"
    $settings.canvasToken = Read-PlainSecret "Canvas access token"
  }
  "7" {
    $news = Read-PlainSecret "News API key (press Enter to skip)"
    $github = Read-PlainSecret "GitHub token (press Enter to skip)"
    $higgsfield = Read-PlainSecret "Higgsfield key (press Enter to skip)"
    $figma = Read-PlainSecret "Figma access token (press Enter to skip)"
    if ($news) { $settings.newsApiKey = $news }
    if ($github) { $settings.githubToken = $github }
    if ($higgsfield) { $settings.higgsfieldKey = $higgsfield }
    if ($figma) { $settings.figmaAccessToken = $figma }
  }
  default {
    Write-Host "No provider selected." -ForegroundColor Yellow
    exit 1
  }
}

try {
  $result = Save-JarvisSettings $settings
  Write-Host ""
  Write-Host "Credentials saved securely." -ForegroundColor Green
  Write-Host "Open JARVIS Connections to run the provider health check."
  if ($choice -eq "1" -and -not $settings.webhookBaseUrl) {
    Write-Host "Twilio is stored, but inbound texting will remain offline until the public webhook is deployed." -ForegroundColor Yellow
  }
}
finally {
  foreach ($key in @("twilioAuthToken", "geminiKey", "googleClientSecret", "kalshiPrivateKey", "instagramAccessToken", "canvasToken", "newsApiKey", "githubToken", "higgsfieldKey", "figmaAccessToken")) {
    if ($settings.ContainsKey($key)) { $settings[$key] = $null }
  }
}
