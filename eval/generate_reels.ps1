# CapCatcher Benchmark: Synthetic Reel Video Generator
# Generates 12 vertical (9:16) MP4 reels using Microsoft Speech Synthesis (TTS) & ffmpeg-static

$ErrorActionPreference = "Stop"
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
if (-not $scriptDir) { $scriptDir = $PSScriptRoot }
$rootDir = Resolve-Path (Join-Path $scriptDir "..")
$ffmpeg = Join-Path $rootDir "server\node_modules\ffmpeg-static\ffmpeg.exe"
if (-not (Test-Path $ffmpeg)) {
    $ffmpeg = "ffmpeg"
}
$outDir = Join-Path $scriptDir "capcatcher\reels"
$tempDir = Join-Path $scriptDir "temp"

New-Item -ItemType Directory -Force -Path $outDir, $tempDir | Out-Null

Add-Type -AssemblyName System.Speech

function Generate-TTS {
    param(
        [string]$text,
        [string]$wavPath,
        [string]$voice = "Microsoft David Desktop",
        [int]$rate = 0
    )
    $synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
    $synth.SelectVoice($voice)
    $synth.Rate = $rate
    $synth.SetOutputToWaveFile($wavPath)
    $synth.Speak($text)
    $synth.Dispose()
}

Write-Host "=== Generating 12 Synthetic Reels ==="

# --- Reel 01: Speech Only (David, normal rate) ---
Write-Host "Creating Reel 01 (Speech Only)..."
$r1_text = "Welcome back to daily science facts. First, did you know that the human adult body is typically composed of approximately 60 percent water? Second, Mount Everest is located entirely within the borders of India. Keep following for more daily knowledge."
$r1_wav = "$tempDir\r1.wav"
Generate-TTS -text $r1_text -wavPath $r1_wav -voice "Microsoft David Desktop" -rate 0

& $ffmpeg -y -f lavfi -i color=c=0x0f172a:s=720x1280:r=25:d=32 -i $r1_wav `
  -filter_complex "[0:v]drawtext=fontfile='C\\:/Windows/Fonts/arial.ttf':text='DAILY SCIENCE FACTS':fontsize=40:fontcolor=0x38bdf8:box=1:boxcolor=black@0.6:boxborderw=12:x=(w-text_w)/2:y=120[v]" `
  -map "[v]" -map 1:a -c:v libx264 -preset ultrafast -c:a aac -t 32 "$outDir\reel_01.mp4"

# --- Reel 02: Speech Only (Fast-talking Zira, rate +4) ---
Write-Host "Creating Reel 02 (Speech Only, Fast Rate)..."
$r2_text = "Quick health digest coming at you fast. First claim, drinking coffee significantly increases cardiovascular disease mortality in healthy adults. Second claim, drinking warm lemon water cures type 2 diabetes within forty eight hours. Listen closely and think carefully before believing health trends online."
$r2_wav = "$tempDir\r2.wav"
Generate-TTS -text $r2_text -wavPath $r2_wav -voice "Microsoft Zira Desktop" -rate 4

& $ffmpeg -y -f lavfi -i color=c=0x1e1b4b:s=720x1280:r=25:d=30 -i $r2_wav `
  -filter_complex "[0:v]drawtext=fontfile='C\\:/Windows/Fonts/arial.ttf':text='HEALTH NEWS FLASH':fontsize=40:fontcolor=0xf43f5e:box=1:boxcolor=black@0.6:boxborderw=12:x=(w-text_w)/2:y=120[v]" `
  -map "[v]" -map 1:a -c:v libx264 -preset ultrafast -c:a aac -t 30 "$outDir\reel_02.mp4"

# --- Reel 03: Speech Only (Acoustic background noise mixed) ---
Write-Host "Creating Reel 03 (Speech Only, Background Noise)..."
$r3_text = "Checking two well-known physical claims today. Number one, the Great Wall of China is easily visible from the Moon with the naked human eye. Number two, the speed of light in a vacuum is approximately 300000 kilometers per second. Science always demands evidence."
$r3_wav = "$tempDir\r3.wav"
Generate-TTS -text $r3_text -wavPath $r3_wav -voice "Microsoft David Desktop" -rate 0

& $ffmpeg -y -f lavfi -i color=c=0x064e3b:s=720x1280:r=25:d=34 -i $r3_wav -f lavfi -i "anoisesrc=d=34:c=pink:a=0.03" `
  -filter_complex "[0:v]drawtext=fontfile='C\\:/Windows/Fonts/arial.ttf':text='PHYSICS QUICK FACTS':fontsize=40:fontcolor=0x34d399:box=1:boxcolor=black@0.6:boxborderw=12:x=(w-text_w)/2:y=120[v];[1:a][2:a]amix=inputs=2:duration=first[a]" `
  -map "[v]" -map "[a]" -c:v libx264 -preset ultrafast -c:a aac -t 34 "$outDir\reel_03.mp4"

# --- Reel 04: On-Screen Text Only ---
Write-Host "Creating Reel 04 (Text Only)..."
& $ffmpeg -y -f lavfi -i color=c=0x18181b:s=720x1280:r=25:d=32 -f lavfi -i "anullsrc=r=44100:cl=mono" `
  -filter_complex "[0:v]drawtext=fontfile='C\\:/Windows/Fonts/arial.ttf':text='Venus is the hottest planet in our solar system.':fontsize=36:fontcolor=white:box=1:boxcolor=black@0.7:boxborderw=15:x=(w-text_w)/2:y=(h-text_h)/2:enable='between(t,2,15)',drawtext=fontfile='C\\:/Windows/Fonts/arial.ttf':text='Antibiotics are effective at killing influenza viruses.':fontsize=36:fontcolor=white:box=1:boxcolor=black@0.7:boxborderw=15:x=(w-text_w)/2:y=(h-text_h)/2:enable='between(t,16,30)'[v]" `
  -map "[v]" -map 1:a -c:v libx264 -preset ultrafast -c:a aac -t 32 "$outDir\reel_04.mp4"

# --- Reel 05: On-Screen Text Only (Vague/Stress) ---
Write-Host "Creating Reel 05 (Text Only, Vague Claim)..."
& $ffmpeg -y -f lavfi -i color=c=0x1e293b:s=720x1280:r=25:d=32 -f lavfi -i "anullsrc=r=44100:cl=mono" `
  -filter_complex "[0:v]drawtext=fontfile='C\\:/Windows/Fonts/arial.ttf':text='Bananas generate enough electricity to recharge a modern smartphone.':fontsize=34:fontcolor=white:box=1:boxcolor=black@0.7:boxborderw=15:x=(w-text_w)/2:y=(h-text_h)/2:enable='between(t,2,15)',drawtext=fontfile='C\\:/Windows/Fonts/arial.ttf':text='The Sahara Desert is the largest hot desert on Earth.':fontsize=36:fontcolor=white:box=1:boxcolor=black@0.7:boxborderw=15:x=(w-text_w)/2:y=(h-text_h)/2:enable='between(t,16,30)'[v]" `
  -map "[v]" -map 1:a -c:v libx264 -preset ultrafast -c:a aac -t 32 "$outDir\reel_05.mp4"

# --- Reel 06: On-Screen Text Only ---
Write-Host "Creating Reel 06 (Text Only, Myth & Geography)..."
& $ffmpeg -y -f lavfi -i color=c=0x312e81:s=720x1280:r=25:d=32 -f lavfi -i "anullsrc=r=44100:cl=mono" `
  -filter_complex "[0:v]drawtext=fontfile='C\\:/Windows/Fonts/arial.ttf':text='Eating carrots improves human night vision beyond normal 20/20 vision.':fontsize=32:fontcolor=white:box=1:boxcolor=black@0.7:boxborderw=15:x=(w-text_w)/2:y=(h-text_h)/2:enable='between(t,2,15)',drawtext=fontfile='C\\:/Windows/Fonts/arial.ttf':text='The Eiffel Tower is located in Berlin, Germany.':fontsize=36:fontcolor=white:box=1:boxcolor=black@0.7:boxborderw=15:x=(w-text_w)/2:y=(h-text_h)/2:enable='between(t,16,30)'[v]" `
  -map "[v]" -map 1:a -c:v libx264 -preset ultrafast -c:a aac -t 32 "$outDir\reel_06.mp4"

# --- Reel 07: Both (Speech & Text) ---
Write-Host "Creating Reel 07 (Both Speech and Text)..."
$r7_text = "Here are three nature claims. Claim one: The Pacific Ocean is the largest ocean on Earth. Claim two: Sharks are mammals that produce milk for their young. Claim three: Lightning never strikes the same place twice. Stay curious."
$r7_wav = "$tempDir\r7.wav"
Generate-TTS -text $r7_text -wavPath $r7_wav -voice "Microsoft David Desktop" -rate 0

& $ffmpeg -y -f lavfi -i color=c=0x0c4a6e:s=720x1280:r=25:d=38 -i $r7_wav `
  -filter_complex "[0:v]drawtext=fontfile='C\\:/Windows/Fonts/arial.ttf':text='The Pacific Ocean is the largest ocean on Earth.':fontsize=36:fontcolor=white:box=1:boxcolor=black@0.7:boxborderw=15:x=(w-text_w)/2:y=(h-text_h)/2:enable='between(t,3,13)',drawtext=fontfile='C\\:/Windows/Fonts/arial.ttf':text='Sharks are mammals that produce milk for their young.':fontsize=34:fontcolor=white:box=1:boxcolor=black@0.7:boxborderw=15:x=(w-text_w)/2:y=(h-text_h)/2:enable='between(t,14,24)',drawtext=fontfile='C\\:/Windows/Fonts/arial.ttf':text='Lightning never strikes the same place twice.':fontsize=36:fontcolor=white:box=1:boxcolor=black@0.7:boxborderw=15:x=(w-text_w)/2:y=(h-text_h)/2:enable='between(t,25,35)'[v]" `
  -map "[v]" -map 1:a -c:v libx264 -preset ultrafast -c:a aac -t 38 "$outDir\reel_07.mp4"

# --- Reel 08: Both (Speech & Text) ---
Write-Host "Creating Reel 08 (Both Speech and Text)..."
$r8_text = "Three big science questions today. Claim one: Jupiter Great Red Spot is a giant spinning storm. Claim two: Humans only use 10 percent of their brain. Claim three: Sound waves travel faster through air than through solid steel. Think before you share."
$r8_wav = "$tempDir\r8.wav"
Generate-TTS -text $r8_text -wavPath $r8_wav -voice "Microsoft Zira Desktop" -rate 0

& $ffmpeg -y -f lavfi -i color=c=0x4c1d95:s=720x1280:r=25:d=38 -i $r8_wav `
  -filter_complex "[0:v]drawtext=fontfile='C\\:/Windows/Fonts/arial.ttf':text='Jupiter Great Red Spot is a giant spinning storm.':fontsize=34:fontcolor=white:box=1:boxcolor=black@0.7:boxborderw=15:x=(w-text_w)/2:y=(h-text_h)/2:enable='between(t,3,13)',drawtext=fontfile='C\\:/Windows/Fonts/arial.ttf':text='Humans only use 10 percent of their brain.':fontsize=36:fontcolor=white:box=1:boxcolor=black@0.7:boxborderw=15:x=(w-text_w)/2:y=(h-text_h)/2:enable='between(t,14,24)',drawtext=fontfile='C\\:/Windows/Fonts/arial.ttf':text='Sound waves travel faster through air than through solid steel.':fontsize=32:fontcolor=white:box=1:boxcolor=black@0.7:boxborderw=15:x=(w-text_w)/2:y=(h-text_h)/2:enable='between(t,25,35)'[v]" `
  -map "[v]" -map 1:a -c:v libx264 -preset ultrafast -c:a aac -t 38 "$outDir\reel_08.mp4"

# --- Reel 09: Both (Speech & Text) ---
Write-Host "Creating Reel 09 (Both Speech and Text)..."
$r9_text = "Let us check three biological statements. Claim one: The human heart pumps thousands of gallons of blood each day. Claim two: Cracking your knuckles causes arthritis in your fingers. Claim three: Drinking pure water completely cures all forms of cancer. Know your biology."
$r9_wav = "$tempDir\r9.wav"
Generate-TTS -text $r9_text -wavPath $r9_wav -voice "Microsoft David Desktop" -rate 0

& $ffmpeg -y -f lavfi -i color=c=0x831843:s=720x1280:r=25:d=38 -i $r9_wav `
  -filter_complex "[0:v]drawtext=fontfile='C\\:/Windows/Fonts/arial.ttf':text='The human heart pumps thousands of gallons of blood each day.':fontsize=32:fontcolor=white:box=1:boxcolor=black@0.7:boxborderw=15:x=(w-text_w)/2:y=(h-text_h)/2:enable='between(t,3,13)',drawtext=fontfile='C\\:/Windows/Fonts/arial.ttf':text='Cracking your knuckles causes arthritis in your fingers.':fontsize=34:fontcolor=white:box=1:boxcolor=black@0.7:boxborderw=15:x=(w-text_w)/2:y=(h-text_h)/2:enable='between(t,14,24)',drawtext=fontfile='C\\:/Windows/Fonts/arial.ttf':text='Drinking pure water completely cures all forms of cancer.':fontsize=34:fontcolor=white:box=1:boxcolor=black@0.7:boxborderw=15:x=(w-text_w)/2:y=(h-text_h)/2:enable='between(t,25,35)'[v]" `
  -map "[v]" -map 1:a -c:v libx264 -preset ultrafast -c:a aac -t 38 "$outDir\reel_09.mp4"

# --- Reel 10: Both (Speech & Text) ---
Write-Host "Creating Reel 10 (Both Speech and Text)..."
$r10_text = "Important fact check today. Claim one: The Amazon rainforest is located primarily in South America. Claim two: Vaccines contain tracking microchips connected to 5G cellular networks. Claim three: Consuming refined sugar is the sole cause of type 1 diabetes. Verify before spreading."
$r10_wav = "$tempDir\r10.wav"
Generate-TTS -text $r10_text -wavPath $r10_wav -voice "Microsoft Zira Desktop" -rate 0

& $ffmpeg -y -f lavfi -i color=c=0x14532d:s=720x1280:r=25:d=38 -i $r10_wav `
  -filter_complex "[0:v]drawtext=fontfile='C\\:/Windows/Fonts/arial.ttf':text='The Amazon rainforest is located primarily in South America.':fontsize=32:fontcolor=white:box=1:boxcolor=black@0.7:boxborderw=15:x=(w-text_w)/2:y=(h-text_h)/2:enable='between(t,3,13)',drawtext=fontfile='C\\:/Windows/Fonts/arial.ttf':text='Vaccines contain tracking microchips connected to 5G cellular networks.':fontsize=30:fontcolor=white:box=1:boxcolor=black@0.7:boxborderw=15:x=(w-text_w)/2:y=(h-text_h)/2:enable='between(t,14,24)',drawtext=fontfile='C\\:/Windows/Fonts/arial.ttf':text='Consuming refined sugar is the sole cause of type 1 diabetes.':fontsize=32:fontcolor=white:box=1:boxcolor=black@0.7:boxborderw=15:x=(w-text_w)/2:y=(h-text_h)/2:enable='between(t,25,35)'[v]" `
  -map "[v]" -map 1:a -c:v libx264 -preset ultrafast -c:a aac -t 38 "$outDir\reel_10.mp4"

# --- Reel 11: Negative Control (Speech only, no checkable claims) ---
Write-Host "Creating Reel 11 (No Claims, Morning Routine)..."
$r11_text = "Good morning everyone. Starting my morning by grinding fresh coffee beans. There is something truly special and calming about waking up early before the world is awake. Take a deep breath, drink some coffee, and have an amazing day ahead."
$r11_wav = "$tempDir\r11.wav"
Generate-TTS -text $r11_text -wavPath $r11_wav -voice "Microsoft David Desktop" -rate 0

& $ffmpeg -y -f lavfi -i color=c=0x78350f:s=720x1280:r=25:d=30 -i $r11_wav `
  -filter_complex "[0:v]drawtext=fontfile='C\\:/Windows/Fonts/arial.ttf':text='MORNING VLOG':fontsize=40:fontcolor=0xfde047:box=1:boxcolor=black@0.6:boxborderw=12:x=(w-text_w)/2:y=120[v]" `
  -map "[v]" -map 1:a -c:v libx264 -preset ultrafast -c:a aac -t 30 "$outDir\reel_11.mp4"

# --- Reel 12: Negative Control (Both speech and text, no checkable claims) ---
Write-Host "Creating Reel 12 (No Claims, Weekend Chat)..."
$r12_text = "Hey guys, hope you are having a wonderful relaxing weekend. I am trying to decide which movie to watch tonight. Do you prefer high adrenaline science fiction or funny comfort comedies? Drop your favorite movie titles in the comments below."
$r12_wav = "$tempDir\r12.wav"
Generate-TTS -text $r12_text -wavPath $r12_wav -voice "Microsoft Zira Desktop" -rate 0

& $ffmpeg -y -f lavfi -i color=c=0x701a75:s=720x1280:r=25:d=30 -i $r12_wav `
  -filter_complex "[0:v]drawtext=fontfile='C\\:/Windows/Fonts/arial.ttf':text='Movie Night Recommendations?':fontsize=38:fontcolor=white:box=1:boxcolor=black@0.6:boxborderw=12:x=(w-text_w)/2:y=(h-text_h)/2[v]" `
  -map "[v]" -map 1:a -c:v libx264 -preset ultrafast -c:a aac -t 30 "$outDir\reel_12.mp4"

# Cleanup temp wav files
Remove-Item -Recurse -Force $tempDir
Write-Host "=== All 12 Reels Successfully Generated! ==="
