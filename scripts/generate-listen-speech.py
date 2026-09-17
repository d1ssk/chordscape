"""Generate Japanese full-phrase clips using VOICEVOX Nemo female 1.
Requires Python 3, ffmpeg, and official Nemo engine 0.24.0 on localhost.
NEMO_URL overrides the default http://127.0.0.1:50131. No cloud API is used.
"""
import array
import hashlib
import io
import json
import math
import os
from pathlib import Path
import subprocess
import sys
import urllib.parse
import urllib.request
import wave

phrases = json.load(sys.stdin)
out = Path('public/speech/ja')
out.mkdir(parents=True, exist_ok=True)
base = os.environ.get('NEMO_URL', 'http://127.0.0.1:50131').rstrip('/')
speaker = 10005

def request(path, data=None):
    req = urllib.request.Request(base + path, data=data,
        headers={'Content-Type': 'application/json'} if data is not None else {})
    return urllib.request.urlopen(req, timeout=120).read()

version = json.loads(request('/version'))
if version != '0.24.0':
    raise ValueError('Expected the audition engine version 0.24.0, got ' + version)
speakers = json.loads(request('/speakers'))
voice = next(s for s in speakers if any(style['id'] == speaker for style in s['styles']))
if voice['speaker_uuid'] != 'abccafa5-174f-44d8-b70c-c41eebb3061c':
    raise ValueError('Expected VOICEVOX Nemo female 1')
info = json.loads(request('/speaker_info?' + urllib.parse.urlencode({'speaker_uuid': voice['speaker_uuid']})))
(out / 'LICENSE-Nemo.txt').write_text(info['policy'])
previous = json.loads((out / 'manifest.json').read_text()) if (out / 'manifest.json').exists() else {}
old = {f['token']: f for f in previous.get('files', [])} if (previous.get('generator') == 'VOICEVOX Nemo' and previous.get('version') == version and previous.get('speaker') == speaker and previous.get('sampleRate') == 22050) else {}
manifest = {'generator': 'VOICEVOX Nemo', 'version': version, 'speaker': speaker,
    'speakerUuid': voice['speaker_uuid'], 'voice': '女声1 / ノーマル',
    'sampleRate': 22050, 'format': 'MP3 mono 64 kbps',
    'processing': 'speedScale=1; default prosody; active RMS 0.13, peak ceiling 0.85; same normalization as audition; resampled from 24000 Hz',
    'files': []}

def save():
    (out / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')

try:
    for index, (token, phrase) in enumerate(phrases.items()):
        path = out / (token + '.mp3')
        cached = old.get(token)
        if cached and cached['phrase'] == phrase and path.exists() and hashlib.sha256(path.read_bytes()).hexdigest() == cached['sha256']:
            manifest['files'].append(cached)
            continue
        query = json.loads(request('/audio_query?' + urllib.parse.urlencode({'text': phrase, 'speaker': speaker}), b''))
        query.update(speedScale=1.0, outputSamplingRate=24000, outputStereo=False)
        wav = request(f'/synthesis?speaker={speaker}', json.dumps(query).encode())
        with wave.open(io.BytesIO(wav)) as w:
            if w.getsampwidth() != 2 or w.getnchannels() != 1 or w.getframerate() != 24000:
                raise ValueError('Unexpected WAV format')
            samples = array.array('h', w.readframes(w.getnframes()))
        if sys.byteorder != 'little': samples.byteswap()
        active = [s for s in samples if abs(s) > 328]
        if not active: raise ValueError('Empty speech: ' + token)
        rms = math.sqrt(sum(s * s for s in active) / len(active))
        gain = min(0.13 * 32767 / rms, 0.85 * 32767 / max(abs(s) for s in samples))
        normalized = array.array('h', (round(s * gain) for s in samples))
        if sys.byteorder != 'little': normalized.byteswap()
        subprocess.run(['ffmpeg', '-nostdin', '-v', 'error', '-y', '-f', 's16le', '-ar', '24000', '-ac', '1', '-i', 'pipe:0',
            '-ar', '22050', '-c:a', 'libmp3lame', '-b:a', '64k', '-map_metadata', '-1',
            '-metadata', 'artist=VOICEVOX Nemo', '-metadata', 'comment=VOICEVOX Nemo female 1; https://voicevox.hiroshiba.jp/nemo/term/', str(path)],
            input=normalized.tobytes(), check=True)
        data = path.read_bytes()
        manifest['files'].append({'token': token, 'phrase': phrase, 'file': path.name,
            'bytes': len(data), 'gain': gain, 'sha256': hashlib.sha256(data).hexdigest()})
        if (index + 1) % 25 == 0:
            save()
            print(f'Generated {index + 1}/{len(phrases)} clips', flush=True)
finally:
    save()
print(f'Complete: {len(manifest["files"])} clips, {sum(f["bytes"] for f in manifest["files"])} bytes', flush=True)
