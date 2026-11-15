# Windows speech-to-text helper. Streams the same NDJSON lines as speech-helper.swift to stdout:
#   {"partial":true,"text":"..."}   while recognizing (the whole transcript so far)
#   {"partial":false,"text":"..."}  final result, then exit 0
#   {"error":"..."}                 then exit 1
# Runs under Windows PowerShell 5.1 (powershell.exe): System.Speech ships with .NET Framework, not with PowerShell 7.
# A stop marker ends the session with no final line; a finish marker, or -EndpointMs of silence after speech, ends it
# with the final line.
#
# Engine: Windows' online dictation (Windows.Media.SpeechRecognition, the recognizer behind Win+H) when it starts, else
# the offline System.Speech dictation, which is far less accurate. Online needs Settings > Privacy & security > Speech >
# Online speech recognition; while that is off, starting it fails (0x80045509) and the offline engine takes over.
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

$said = ""
$lastChange = [DateTime]::UtcNow
function Joined([string]$tail) {
  if ($said -and $tail) { return "$said $tail" }
  if ($said) { return $said }
  return $tail
}

function Heard([string]$text, [bool]$final) {
  if (-not $text) { return }
  if ($final) {
    $script:said = Joined $text
    Emit @{ partial = $true; text = $script:said }
  } else {
    Emit @{ partial = $true; text = (Joined $text) }
  }
  $script:lastChange = [DateTime]::UtcNow
}

function Done([object]$task) {
  if (-not $task.Wait(10000)) { throw "timed out" }
  return $task
}

function Start-Online {
  try {
    Add-Type -AssemblyName System.Runtime.WindowsRuntime
    $null = [Windows.Media.SpeechRecognition.SpeechRecognizer, Windows.Media.SpeechRecognition, ContentType = WindowsRuntime]
    $null = [Windows.Globalization.Language, Windows.Globalization, ContentType = WindowsRuntime]
    # PowerShell cannot subscribe to WinRT events (Register-ObjectEvent refuses them), so a compiled sink queues them.
    Add-Type -TypeDefinition 'public static class DaniSpeechSink { public static readonly System.Collections.Concurrent.ConcurrentQueue<object[]> Q = new System.Collections.Concurrent.ConcurrentQueue<object[]>(); public static void Hypothesis(object s, object e) { Q.Enqueue(new object[] { "hypothesis", e }); } public static void Result(object s, object e) { Q.Enqueue(new object[] { "result", e }); } public static void Completed(object s, object e) { Q.Enqueue(new object[] { "completed", e }); } }'
    $asTask = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq "AsTask" -and $_.GetParameters().Count -eq 1 }
    $script:operationTask = $asTask | Where-Object { $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' } | Select-Object -First 1
    $script:actionTask = $asTask | Where-Object { $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncAction' } | Select-Object -First 1

    $supported = @([Windows.Media.SpeechRecognition.SpeechRecognizer]::SupportedTopicLanguages | ForEach-Object { $_.LanguageTag })
    $wanted = @((Get-Culture).Name) + @((Get-ItemProperty -LiteralPath "HKCU:\Control Panel\International\User Profile" -ErrorAction SilentlyContinue).Languages)
    $tag = $wanted | Where-Object { $supported -contains $_ } | Select-Object -First 1
    $script:recognizer = if ($tag) {
      New-Object Windows.Media.SpeechRecognition.SpeechRecognizer((New-Object Windows.Globalization.Language($tag)))
    } else {
      New-Object Windows.Media.SpeechRecognition.SpeechRecognizer
    }
    # No constraint added: the recognizer's default is free dictation.
    $compiled = (Done $script:operationTask.MakeGenericMethod([Windows.Media.SpeechRecognition.SpeechRecognitionCompilationResult]).Invoke($null, @($script:recognizer.CompileConstraintsAsync()))).Result
    if ("$($compiled.Status)" -ne "Success") { return $null }

    $session = $script:recognizer.ContinuousRecognitionSession
    $session.AutoStopSilenceTimeout = [TimeSpan]::FromMinutes(10)
    $sink = [DaniSpeechSink]
    [void]$script:recognizer.add_HypothesisGenerated([Delegate]::CreateDelegate([Windows.Foundation.TypedEventHandler[Windows.Media.SpeechRecognition.SpeechRecognizer, Windows.Media.SpeechRecognition.SpeechRecognitionHypothesisGeneratedEventArgs]], $sink.GetMethod("Hypothesis")))
    [void]$session.add_ResultGenerated([Delegate]::CreateDelegate([Windows.Foundation.TypedEventHandler[Windows.Media.SpeechRecognition.SpeechContinuousRecognitionSession, Windows.Media.SpeechRecognition.SpeechContinuousRecognitionResultGeneratedEventArgs]], $sink.GetMethod("Result")))
    [void]$session.add_Completed([Delegate]::CreateDelegate([Windows.Foundation.TypedEventHandler[Windows.Media.SpeechRecognition.SpeechContinuousRecognitionSession, Windows.Media.SpeechRecognition.SpeechContinuousRecognitionCompletedEventArgs]], $sink.GetMethod("Completed")))
    [void](Done $script:actionTask.Invoke($null, @($session.StartAsync())))
    return $session
  } catch {
    return $null
  }
}

$online = Start-Online
if (-not $online) {
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
  $engine.RecognizeAsync([System.Speech.Recognition.RecognizeMode]::Multiple)
}

# @(kind, text): "partial", "final", or "completed" with the online session's status.
function Next {
  if ($online) {
    $item = $null
    if (-not [DaniSpeechSink]::Q.TryDequeue([ref]$item)) { return $null }
    if ($item[0] -eq "hypothesis") { return @("partial", $item[1].Hypothesis.Text) }
    if ($item[0] -eq "completed") { return @("completed", "$($item[1].Status)") }
    $result = $item[1].Result
    if ("$($result.Status)" -eq "Success" -and "$($result.Confidence)" -ne "Rejected") { return @("final", $result.Text) }
    return @("partial", "")
  }
  $queued = Get-Event | Select-Object -First 1
  if (-not $queued) { return $null }
  Remove-Event -EventIdentifier $queued.EventIdentifier
  return @($(if ($queued.SourceIdentifier -eq "recognized") { "final" } else { "partial" }), $queued.SourceEventArgs.Result.Text)
}

$end = $null
try {
  while (-not $end) {
    if (Test-Path -LiteralPath $StopFile) { $end = "stop"; break }
    if (Test-Path -LiteralPath $FinishFile) { $end = "finish"; break }
    if ($EndpointMs -gt 0 -and $said -and ([DateTime]::UtcNow - $lastChange).TotalMilliseconds -ge $EndpointMs) { $end = "finish"; break }
    $got = Next
    if (-not $got) { Start-Sleep -Milliseconds 50; continue }
    if ($got[0] -eq "completed") {
      if (-not $said -and @("Success", "TimeoutExceeded", "PauseLimitExceeded") -notcontains $got[1]) { Fail "speech-unavailable" }
      $end = "ended"
      break
    }
    Heard $got[1] ($got[0] -eq "final")
  }
  if ($online -and $end -eq "finish") {
    # Stopping (not cancelling) hands back the phrase in progress before the session completes.
    try { [void](Done $actionTask.Invoke($null, @($online.StopAsync()))) } catch {}
    $deadline = [DateTime]::UtcNow.AddSeconds(3)
    while ([DateTime]::UtcNow -lt $deadline) {
      $got = Next
      if (-not $got) { Start-Sleep -Milliseconds 20; continue }
      if ($got[0] -eq "completed") { break }
      if ($got[0] -eq "final") { Heard $got[1] $true }
    }
  }
} finally {
  if (-not $online) {
    Unregister-Event -SourceIdentifier hypothesis
    Unregister-Event -SourceIdentifier recognized
    $engine.RecognizeAsyncCancel()
  }
}

if ($end -ne "stop") { Emit @{ partial = $false; text = $said } }
# No Dispose(): the process exit releases the microphone, and a run that disposed the engine first took 31s to exit.
[Environment]::Exit(0)
