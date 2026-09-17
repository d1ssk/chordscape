# Chordscape Japanese listening voice

**音声：VOICEVOX Nemo 女声1（ノーマル）**

Bundled MP3 clips were synthesized locally using the official VOICEVOX Nemo
Engine **0.24.0**, speaker/style **10005**, speaker UUID
`abccafa5-174f-44d8-b70c-c41eebb3061c`.

- [VOICEVOX Nemo](https://voicevox.hiroshiba.jp/nemo/)
- [Voice usage terms](https://voicevox.hiroshiba.jp/nemo/term/)
- [Bundled speaker policy](LICENSE-Nemo.txt)
- [Official engine release](https://github.com/VOICEVOX/voicevox_nemo_engine/releases/tag/0.24.0)

These speech clips are subject to the VOICEVOX Nemo voice usage terms, including
credit requirements. They are **not** licensed under the piano samples' CC BY 3.0 license.
No endorsement by the voice provider is implied. The voice model is not distributed.

## Generation and changes

Input phrases are defined in `src/listen/speech.ts`. Each chord name is synthesized
in one request, rather than joining isolated root/accidental/quality words.
Key announcements are also complete phrases; degrees and inversions are separate
phrases. All use the same female 1 voice selected in the audition.

Settings: speedScale 1.0, default prosody, mono 24,000 Hz synthesis. The same
linear gain normalization as the audition targets active-sample RMS 0.13 with a
peak ceiling of 0.85. Clips are resampled to 22,050 Hz and encoded as mono
64 kbps MP3. Each MP3 embeds a VOICEVOX Nemo credit and terms URL.

`manifest.json` records engine/voice identifiers, input phrases, processing,
file sizes, gains and SHA-256 hashes. To reproduce, start the official engine on
localhost:50131 and run `node scripts/generate-listen-speech.mjs` with Python 3
and ffmpeg available. `NEMO_URL` overrides the local engine URL. No API or voice
engine is used by the browser at runtime.

Exported listening sets separately contain Salamander Grand Piano samples,
Copyright Alexander Holm, CC BY 3.0. See
[the piano attribution](../../samples/salamander/ATTRIBUTION.md).
Both sources are credited in the exported WAV's RIFF INFO metadata, with their
respective terms clearly separated.
