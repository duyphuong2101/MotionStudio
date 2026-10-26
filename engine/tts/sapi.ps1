param([string]$In, [string]$Wav, [string]$Out)
# Windows built-in speech (System.Speech). Offline; reports where each word starts in the audio.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Speech
$job = Get-Content -Raw -Encoding UTF8 $In | ConvertFrom-Json
$s = New-Object System.Speech.Synthesis.SpeechSynthesizer
$s.SelectVoice([string]$job.voice)
$s.Rate = [int]$job.rate
$fmt = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(24000, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)
$s.SetOutputToWaveFile($Wav, $fmt)
Register-ObjectEvent -InputObject $s -EventName SpeakProgress -SourceIdentifier sapiProgress | Out-Null
$s.Speak([string]$job.text)
$words = @()
foreach ($e in @(Get-Event -SourceIdentifier sapiProgress)) {
  $words += @{ w = [string]$e.SourceEventArgs.Text; ms = [double]$e.SourceEventArgs.AudioPosition.TotalMilliseconds }
}
Unregister-Event -SourceIdentifier sapiProgress
$s.SetOutputToNull()
$s.Dispose()
ConvertTo-Json -InputObject @{ words = $words } -Depth 4 | Set-Content -Encoding UTF8 $Out
exit 0
