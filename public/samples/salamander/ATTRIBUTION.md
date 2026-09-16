# Salamander Grand Piano — Alexander Holm

Piano recordings by **Alexander Holm**, Yamaha C5, distributed under **Creative Commons Attribution 3.0 Unported (CC BY 3.0)**.

- License: https://creativecommons.org/licenses/by/3.0/ (full text in LICENSE.txt)
- Audio distribution: https://github.com/Tonejs/audio/tree/efd8296360f9526e379bfbe5c1698ff54d6a1d34/salamander
- Original library: https://archive.org/details/SalamanderGrandPianoV3
- Original author notice: README (preserved verbatim; the upstream heading says V2 and its changelog includes V3).

Chordscape bundles 17 MP3 files from C2 through C6 in minor thirds. They are copied byte-for-byte from the pinned Tonejs/audio distribution. No trimming, normalization, or re-encoding was performed. Intermediate notes use playback-rate transposition. Runtime gain envelopes and a 35 Hz high-pass filter are applied during playback; the files are unchanged.

The selected MP3s total approximately 1.25 MB. They are served by the app itself, only fetched when Piano is selected, and retained as decoded buffers for this session. No external audio CDN is contacted at runtime. `manifest.json` records every upstream file's SHA-256 and size. Attribution does not imply endorsement.
