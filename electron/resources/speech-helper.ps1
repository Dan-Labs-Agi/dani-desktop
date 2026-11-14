# Windows speech-to-text helper. Streams the same NDJSON lines as speech-helper.swift to stdout:
#   {"partial":true,"text":"..."}   while recognizing (the whole transcript so far)
#   {"partial":false,"text":"..."}  final result, then exit 0
#   {"error":"..."}                 then exit 1
# Runs under Windows PowerShell 5.1 (powershell.exe): System.Speech ships with .NET Framework, not with PowerShell 7.
# A stop marker ends the session with no final line; a finish marker, or -EndpointMs of silence after speech, ends it
# with the final line.
param(
  [Parameter(Mandatory = $true)][string]$StopFile,
  [Parameter(Mandatory = $true)][string]$FinishFile,
  [int]$EndpointMs = 0
)

$ErrorActionPreference = "Stop"
$out = New-Object System.IO.StreamWriter([Console]::OpenStandardOutput(), (New-Object System.Text.UTF8Encoding($false)))
$out.AutoFlush = $true

function Emit($line) {
  $out.WriteLine(($line | ConvertTo-Json -Compress))
}

function Fail([string]$message) {
  Emit @{ error = $message }
  exit 1
}

try {
  Add-Type -AssemblyName System.Speech
  $engine = New-Object System.Speech.Recognition.SpeechRecognitionEngine
} catch {
  Fail "speech-unavailable"
}

try {
  $engine.LoadGrammar((New-Object System.Speech.Recognition.DictationGrammar))
  $engine.SetInputToDefaultAudioDevice()
} catch {
  Fail "microphone-unavailable"
}

Register-ObjectEvent -InputObject $engine -EventName SpeechHypothesized -SourceIdentifier hypothesis | Out-Null
Register-ObjectEvent -InputObject $engine -EventName SpeechRecognized -SourceIdentifier recognized | Out-Null

$said = ""
$lastChange = [DateTime]::UtcNow
function Joined([string]$tail) {
  if ($said -and $tail) { return "$said $tail" }
  if ($said) { return $said }
  return $tail
}

$engine.RecognizeAsync([System.Speech.Recognition.RecognizeMode]::Multiple)
$final = $false
try {
  while ($true) {
    if (Test-Path -LiteralPath $StopFile) { break }
    if (Test-Path -LiteralPath $FinishFile) { $final = $true; break }
    if ($EndpointMs -gt 0 -and $said -and ([DateTime]::UtcNow - $lastChange).TotalMilliseconds -ge $EndpointMs) { $final = $true; break }
    $queued = Get-Event | Select-Object -First 1
    if (-not $queued) { Start-Sleep -Milliseconds 50; continue }
    $text = $queued.SourceEventArgs.Result.Text
    if ($text) {
      if ($queued.SourceIdentifier -eq "recognized") {
        $said = Joined $text
        Emit @{ partial = $true; text = $said }
      } else {
        Emit @{ partial = $true; text = (Joined $text) }
      }
      $lastChange = [DateTime]::UtcNow
    }
    Remove-Event -EventIdentifier $queued.EventIdentifier
  }
} finally {
  Unregister-Event -SourceIdentifier hypothesis
  Unregister-Event -SourceIdentifier recognized
  $engine.RecognizeAsyncCancel()
}

if ($final) { Emit @{ partial = $false; text = $said } }
# No Dispose(): the process exit releases the microphone, and a run that disposed the engine first took 31s to exit.
[Environment]::Exit(0)
