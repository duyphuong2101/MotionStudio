param([string]$In, [string]$Wav, [string]$Out, [switch]$List)
# Windows' newer voices (OneCore, Windows.Media.SpeechSynthesis): the ones Windows installs with a language's speech
# pack, e.g. Microsoft An for Vietnamese. Offline; reports where each word starts. -List prints "name|language|gender".
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Media.SpeechSynthesis.SpeechSynthesizer, Windows.Media.SpeechSynthesis, ContentType = WindowsRuntime]
$null = [Windows.Storage.Streams.DataReader, Windows.Storage.Streams, ContentType = WindowsRuntime]
if ($List) {
  foreach ($v in [Windows.Media.SpeechSynthesis.SpeechSynthesizer]::AllVoices) { [Console]::WriteLine("$($v.DisplayName)|$($v.Language)|$($v.Gender)") }
  exit 0
}
# PowerShell 5.1 cannot await a WinRT operation: turn it into a Task and wait.
$asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' })[0]
function Await($op, [Type]$type) { $t = $asTask.MakeGenericMethod($type).Invoke($null, @($op)); $null = $t.Wait(-1); $t.Result }
$job = Get-Content -Raw -Encoding UTF8 $In | ConvertFrom-Json
$voice = [Windows.Media.SpeechSynthesis.SpeechSynthesizer]::AllVoices | Where-Object { $_.DisplayName -eq [string]$job.voice } | Select-Object -First 1
if (-not $voice) { throw "Windows voice not installed: $($job.voice)" }
$s = New-Object Windows.Media.SpeechSynthesis.SpeechSynthesizer
$s.Voice = $voice
$s.Options.IncludeWordBoundaryMetadata = $true
$s.Options.SpeakingRate = [double]$job.speed
$stream = Await ($s.SynthesizeTextToStreamAsync([string]$job.text)) ([Windows.Media.SpeechSynthesis.SpeechSynthesisStream])
$words = @()
foreach ($track in $stream.TimedMetadataTracks) {
  foreach ($cue in $track.Cues) { $words += @{ s = [int]$cue.StartPositionInInput; e = [int]$cue.EndPositionInInput; ms = [double]$cue.StartTime.TotalMilliseconds } }
}
$size = [uint32]$stream.Size
$reader = New-Object Windows.Storage.Streams.DataReader($stream.GetInputStreamAt(0))
$null = Await ($reader.LoadAsync($size)) ([uint32])
$bytes = New-Object byte[] $size
$reader.ReadBytes($bytes)
[IO.File]::WriteAllBytes($Wav, $bytes)
$reader.Dispose(); $stream.Dispose(); $s.Dispose()
ConvertTo-Json -InputObject @{ words = $words } -Depth 4 | Set-Content -Encoding UTF8 $Out
exit 0
