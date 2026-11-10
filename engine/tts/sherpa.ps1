param([string]$In, [string]$Wav, [string]$Out)
# Piper voices through sherpa-onnx's own .NET binding (models/sherpa-onnx/, 1.13.8: espeak-ng inside, offline).
# The text comes in a UTF-8 JSON file, so Vietnamese marks survive (a command-line argument would lose them).
# Writes the WAV and { sampleRate, samples, speakers } as JSON.
$ErrorActionPreference = 'Stop'
$job = Get-Content -Raw -Encoding UTF8 $In | ConvertFrom-Json
$lib = [string]$job.lib
# sherpa-onnx.dll loads sherpa-onnx-c-api.dll and onnxruntime.dll by name: put their folder first on the search path.
$env:PATH = "$lib;$env:PATH"
Add-Type -Path (Join-Path $lib 'sherpa-onnx.dll')
# The configs are structs: each is filled, then set on its parent (a nested field set in place would change a copy).
$vits = New-Object SherpaOnnx.OfflineTtsVitsModelConfig
$vits.Model = [string]$job.model
$vits.Tokens = [string]$job.tokens
$vits.DataDir = [string]$job.dataDir
$vits.Lexicon = ''
$vits.DictDir = ''
$vits.NoiseScale = 0.667
$vits.NoiseScaleW = 0.8
$vits.LengthScale = 1.0
$model = New-Object SherpaOnnx.OfflineTtsModelConfig
$model.Vits = $vits
$model.NumThreads = [int]$job.threads
$model.Debug = 0
$model.Provider = 'cpu'
$cfg = New-Object SherpaOnnx.OfflineTtsConfig
$cfg.Model = $model
$cfg.RuleFsts = ''
$cfg.RuleFars = ''
$cfg.MaxNumSentences = 1
$cfg.SilenceScale = 0.2
$tts = New-Object SherpaOnnx.OfflineTts($cfg)
$speakers = $tts.NumSpeakers
$audio = $tts.Generate([string]$job.text, [single]$job.speed, [int]$job.sid)
if ($audio.NumSamples -le 0) { throw 'The voice produced no audio' }
$null = $audio.SaveToWaveFile($Wav)
$result = @{ sampleRate = $audio.SampleRate; samples = $audio.NumSamples; speakers = $speakers }
$audio.Dispose(); $tts.Dispose()
ConvertTo-Json -InputObject $result | Set-Content -Encoding UTF8 $Out
exit 0
