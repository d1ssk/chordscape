# Chordscape 読み上げ音声の試聴

`index.html` をブラウザで開くか、Vite 起動中に `voice-audition/index.html` を開いてください。
外部 API や音声エンジンは再生時には不要です。アプリ本体には試聴後に選ばれたNemo女声1を採用しました。

## 音声

- **VOICEVOX Nemo** 女声1（style 10005）、男声1（style 10001）。エンジン 0.24.0。
  クレジット：VOICEVOX Nemo。
  [公式](https://voicevox.hiroshiba.jp/nemo/) / [利用規約](https://voicevox.hiroshiba.jp/nemo/term/) / [話者の利用案内](LICENSE-Nemo.txt)。
- **AivisSpeech** コハク（ノーマル、style 1878365376、モデル 1.1.0）、
  まお（ノーマル、style 888753760、モデル 1.2.0）。エンジン 1.2.0。
  [公式](https://aivis-project.com/) /
  [コハクのモデル](https://hub.aivis-project.com/aivm-models/22e8ed77-94fe-4ef2-871f-a86f94e9a579) /
  [まおのモデル](https://hub.aivis-project.com/aivm-models/a59cb814-0083-4369-8542-f51a29e72af7)。
  エンジンの話者情報から取得した利用条件は [コハク](LICENSE-Aivis-Kohaku.txt) / [まお](LICENSE-Aivis-Mao.txt)（いずれも ACML 1.0）。
- **以前の声**：Open JTalk / HTS Voice Mei (Normal)。
  Copyright (c) 2009–2013 Nagoya Institute of Technology, Department of Computer Science / MMDAgent Project Team。
  [CC BY 3.0](CC-BY-3.0.txt) / [元の著作権表示](LICENSE-Mei.txt)。
  変更前のアプリの音声素材を 60 ms の間隔で接続し、再標本化・音量調整しました。

試聴音声は Chordscape 用に生成した非公式の合成音声です。話者本人による録音・公式コンテンツ・推奨を示すものではありません。
モデル自体は同梱していません。

## 比較条件

同じ読みを使用しています。

1. Cmaj7：シーメジャーセブンス
2. F♯m7：エフシャープマイナーセブンス
3. Bm7♭5：ビーマイナーセブンス、フラットファイブ

新しい音声はコード名全体を一度に合成し、話速 1.0、その他の読み・アクセントはエンジン既定値です。
以前の声は単語の接続方式を維持しています。声質だけでなく接続方式も異なる比較です。

全ファイルを mono / 24,000 Hz / PCM16 WAV に揃え、無音を除いた RMS の目標値 0.13、
ピーク上限 0.85 で線形ゲインのみ調整しました。連続再生用ファイルでは例の間に 1 秒の無音を入れています。

生成日：2026-09-17。ファイルの SHA-256・フレーム数・ゲイン・モデル ID は `manifest.json`、
新しい音声の `/synthesis` に渡したパラメータは `queries.json` に記録しています。
