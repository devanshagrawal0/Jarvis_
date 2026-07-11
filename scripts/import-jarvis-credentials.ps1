param(
  [string]$CredentialsFile = "$env:USERPROFILE\.jarvis\JARVIS_CREDENTIALS.local.json",
  [string]$JarvisUrl = "http://127.0.0.1:8799"
)

$ErrorActionPreference = "Stop"

function Add-Value {
  param(
    [hashtable]$Target,
    [string]$Name,
    [object]$Value
  )
  $text = [string]$Value
  if (-not [string]::IsNullOrWhiteSpace($text)) {
    $Target[$Name] = $text.Trim()
  }
}

function Normalize-PhoneNumber {
  param([string]$Value)
  $clean = ($Value -replace "[^\d+]", "")
  if ($clean -match "^\d{10}$") { return "+1$clean" }
  if ($clean -match "^1\d{10}$") { return "+$clean" }
  return $clean
}

$resolvedFile = Resolve-Path $CredentialsFile
$rawDocument = Get-Content $resolvedFile -Raw
try {
  $document = $rawDocument | ConvertFrom-Json
}
catch {
  # Accept a normal Windows path in rsaPrivateKeyFile even when its
  # backslashes were not JSON-escaped by the user.
  $repairedDocument = [regex]::Replace(
    $rawDocument,
    '("rsaPrivateKeyFile"\s*:\s*")([^"]*)(")',
    {
      param($match)
      $pathValue = $match.Groups[2].Value -replace '(?<!\\)\\(?!\\)', '\\'
      return $match.Groups[1].Value + $pathValue + $match.Groups[3].Value
    }
  )
  try {
    $document = $repairedDocument | ConvertFrom-Json
  }
  catch {
    throw "The credentials worksheet is not valid JSON. Check commas and quotation marks, then run the importer again."
  }
}
$settings = @{}

Add-Value $settings "twilioAccountSid" $document.twilio.accountSid
Add-Value $settings "twilioAuthToken" $document.twilio.authToken
Add-Value $settings "twilioFromNumber" (Normalize-PhoneNumber $document.twilio.jarvisPhoneNumber)
Add-Value $settings "phoneNumber" (Normalize-PhoneNumber $document.twilio.jarvisPhoneNumber)
Add-Value $settings "twilioAllowedCallers" (Normalize-PhoneNumber $document.twilio.yourAllowedPhoneNumber)
Add-Value $settings "webhookBaseUrl" ([string]$document.twilio.publicWebhookBaseUrl).TrimEnd("/")

Add-Value $settings "geminiKey" $document.gemini.apiKey
Add-Value $settings "googleClientId" $document.google.oauthClientId
Add-Value $settings "googleClientSecret" $document.google.oauthClientSecret
Add-Value $settings "googleFromEmail" $document.google.senderEmail

Add-Value $settings "kalshiKeyId" $document.kalshi.apiKeyId
if (-not [string]::IsNullOrWhiteSpace([string]$document.kalshi.rsaPrivateKeyFile)) {
  $privateKeyPath = Resolve-Path ([string]$document.kalshi.rsaPrivateKeyFile)
  $privateKey = Get-Content $privateKeyPath -Raw
  if ($privateKey -notmatch "BEGIN (RSA )?PRIVATE KEY") {
    throw "The Kalshi private-key file does not contain a PEM private key."
  }
  $settings.kalshiPrivateKey = $privateKey.Trim()
}
$settings.kalshiEnvironment = if ($document.kalshi.environment -eq "demo") { "demo" } else { "production" }

Add-Value $settings "instagramAccessToken" $document.instagram.accessToken
Add-Value $settings "instagramAccountId" $document.instagram.professionalAccountId
Add-Value $settings "canvasBaseUrl" $document.canvas.baseUrl
Add-Value $settings "canvasToken" $document.canvas.accessToken
Add-Value $settings "newsApiKey" $document.news.apiKey
Add-Value $settings "githubToken" $document.github.personalAccessToken
Add-Value $settings "higgsfieldKey" $document.higgsfield.apiKey
Add-Value $settings "figmaAccessToken" $document.figma.accessToken
Add-Value $settings "openaiKey" $document.openai.apiKey

if ($settings.Count -eq 1 -and $settings.ContainsKey("kalshiEnvironment")) {
  throw "No credentials were entered in the worksheet."
}

try {
  $session = New-Object Microsoft.PowerShell.Commands.WebRequestSession
  Invoke-WebRequest "$JarvisUrl/api/settings" -WebSession $session -UseBasicParsing -TimeoutSec 5 | Out-Null
  $result = Invoke-RestMethod "$JarvisUrl/api/settings" `
    -Method Post `
    -WebSession $session `
    -ContentType "application/json" `
    -Body ($settings | ConvertTo-Json -Depth 8) `
    -TimeoutSec 30

  Write-Host ""
  Write-Host "Credentials imported into the encrypted JARVIS vault." -ForegroundColor Green
  Write-Host ""
  foreach ($provider in $result.providers.PSObject.Properties) {
    $state = if ($provider.Value.connected) { "configured" } else { "needs setup or login" }
    Write-Host ("{0,-28} {1}" -f $provider.Value.label, $state)
  }

  $redacted = Get-Content $resolvedFile -Raw | ConvertFrom-Json
  $redacted.twilio.authToken = ""
  $redacted.gemini.apiKey = ""
  $redacted.google.oauthClientSecret = ""
  $redacted.instagram.accessToken = ""
  $redacted.canvas.accessToken = ""
  $redacted.news.apiKey = ""
  $redacted.github.personalAccessToken = ""
  $redacted.higgsfield.apiKey = ""
  $redacted.figma.accessToken = ""
  $redacted.openai.apiKey = ""
  $redacted.kalshi.apiKeyId = ""
  $redacted.kalshi.rsaPrivateKeyFile = ""
  $redacted.twilio.accountSid = ""
  $redacted.twilio.jarvisPhoneNumber = ""
  $redacted.twilio.yourAllowedPhoneNumber = ""
  $redacted.google.oauthClientId = ""
  $redacted.instagram.professionalAccountId = ""
  $redacted.canvas.baseUrl = ""
  $redacted | ConvertTo-Json -Depth 8 | Set-Content $resolvedFile -Encoding UTF8

  Write-Host ""
  Write-Host "The plaintext worksheet has been redacted." -ForegroundColor Yellow
  Write-Host "Google still requires OAuth login after its client credentials are imported."
}
finally {
  foreach ($key in @($settings.Keys)) {
    $settings[$key] = $null
  }
  $privateKey = $null
}
