# Harmony Model

Chordscape の次和音提案に向けた、独立した学習・データ処理プロジェクト。
42個のUI候補を学習クラスにせず、綴りを保持した根音度数・三和音・七度・拡張音・変化音を共有するモデルを育てる。

現在は **Phase 5のデータ基盤（全corpus変換、cross-corpus重複排除、統合Markov baselineまで完了）**。Python標準ライブラリだけで動作する。
McGill Billboard、Weimar Jazz Database、ChoCo v1.0.0をignored raw領域へchecksum固定で取得済み。
POP909とPOP909-CLは権利範囲の不明点を残したままlocal-onlyで取得し、公開対象から除外する。
When in Romeはsource別条件を尊重し、CC BY-SAの新規OpenScore Lieder分析179件だけをallowlist展開した。
候補別の license と採否は [datasets/README.md](datasets/README.md)、機械可読な来歴は
[datasets/catalog.json](datasets/catalog.json) を参照する。McGill Billboard 2.0はrawから正規化Song、診断、
作品単位splitまで再現できる。McGillは同じsplitでunigram・1次・2次Markovを学習・評価済み。
結果は [BASELINES.md](BASELINES.md) を参照する。TransformerとWeb連携はまだない。
全corpusの変換件数と既知制約は [CONVERSIONS.md](CONVERSIONS.md)、統合規則と再学習結果は
[INTEGRATED_BASELINES.md](INTEGRATED_BASELINES.md) を参照する。
今後の作業では [DESIGN.md](DESIGN.md) を設計の基準、[PLAN.md](PLAN.md) を段階別の受入条件として読み、設計変更と理由を同時に更新する。

## 実行

Python 3.9以上。リポジトリのルートから：

```sh
cd harmony_model
python3 -m harmony_model inspect-chord 'G7b9' --key C:maj
python3 -m harmony_model inspect-chord 'D7/F#' --key C:maj --local-key G:maj
python3 -m harmony_model.datasets list
python3 -m harmony_model.datasets verify
python3 -m harmony_model convert-mcgill \
  --raw-root data/raw/mcgill_billboard \
  --output-dir data/processed/mcgill_billboard-v1
python3 -m harmony_model convert-all \
  --raw-root data/raw \
  --output-root data/processed
python3 -m harmony_model train-baselines \
  --songs data/processed/mcgill_billboard-v1/songs.jsonl \
  --split-manifest data/processed/mcgill_billboard-v1/split_manifest.json \
  --output-dir runs/mcgill-baselines-v1
python3 -m harmony_model integrate-corpora \
  --processed-root data/processed \
  --output-dir data/processed/integrated-v1
python3 -m harmony_model train-integrated-baselines \
  --corpus-manifest data/processed/integrated-v1/corpus_manifest.json \
  --output-dir runs/integrated-baselines-v1
python3 -m unittest discover -s tests -v
```

JSONの `factors` に度数・accidental（半音差の整数）・quality・seventh・extensions・alterations・bassを表示する。
各`convert-*`と`convert-all`はignored領域へ `songs.jsonl`、`split_manifest.json`、`diagnostics.json` を書く。
Chordscapeの実際の42候補から作ったversion付きmanifestを既定で読み、bass込み／bass除外coverageを別々に測る。
`train-baselines` は `unigram.json`、`markov1.json`、`markov2.json`、`evaluation.json`、
`run_manifest.json` をignored領域へ書く。run manifestには入力checksum、split seed、全引数を記録する。

`raw_chord`、綴り、keyの由来も保持する。CLIのkeyはユーザー指定であり、コーパスの正解ラベルを意味しない。
未対応suffixは部分解析としてJSONを出し終了コード1、不正表記も1、引数エラーは2。成功と明示的な無和音は0。

実行・テストにpip installは不要。別環境へパッケージとして導入する場合のみ、仮想環境で `python3 -m pip install .` を使える。
`pyproject.toml` のbuild backend以外の依存はない。学習用依存とlockfileは採用時に別途追加する。
npm / Viteのビルド経路には入らず、本体のチェックはルートで `npm run check` を実行する。Pythonテストは別途必須。

## ファイル

- `harmony_model/schema.py`: 綴り付き音名、調の出典、factor、イベント、provenance、曲。
- `harmony_model/parser.py`: 明示的な `plain-v1` 表記のパーサーとparser interface。
- `harmony_model/normalize.py`: local優先・global fallbackを記録する純粋な相対化。
- `harmony_model/mcgill_billboard.py`: McGill固有Harte parser、構造展開、調推定、split、診断、JSONL出力。
- `harmony_model/weimar_jazz.py`: WJazzDのSQLite、compact chord symbol、composition/performance identity。
- `harmony_model/pop909.py`: POP909のchord/key/beat textと時刻からbeatへの変換。
- `harmony_model/midi.py` / `pop909_cl.py`: 依存なしMIDI readerと修正済みpitch-set和音track。
- `harmony_model/choco.py`: ChoCo JAMS、Harte明示interval list、partition・upstream来歴。
- `harmony_model/when_in_rome.py`: allowlist済みRomanText、転調・適用和音・転回・小節反復。
- `harmony_model/conversion.py`: 共通の診断、作品split、JSONL envelope。
- `harmony_model/integration.py`: cross-corpus work family、重複排除、統合split manifest。
- `harmony_model/baseline.py`: factorized Markov、平滑化、backoff、style mixture、学習・評価・artifact入出力。
- `harmony_model/__main__.py`: `inspect-chord` と `convert-mcgill` を公開。
- `harmony_model/dataset_catalog.py`: dataset catalogの検証、checksum照合、安全な取得・展開。
- `harmony_model/datasets.py`: `list` / `verify` / `fetch` CLI。
- `datasets/`: license調査、version固定、取得物checksum、変換上の注意、UI候補manifest。
- `tests/`: 手作りの例による解析・相対化・不正入力・CLI検証。外部楽曲データを含まない。

## 対応範囲

C / Cm / C7 / Cmaj7 / Cm7 / CmMaj7 / Cdim / Cdim7 / Caug / Csus2 / Csus4、
6・9・11・13、add9等、6/9、m7b5、7sus4、b5・#5・b9・#9・#11・b13の複合指定、slash bass。
`M` / `maj`、`°` / `dim`、Unicodeの♭・♯も対応する。`N` / `NC` / `N.C.` は明示的な無和音。

plain-v1は汎用コーパスパーサーではない。Roman、Harte interval list、compact jazz symbol、MIDI pitch setは
それぞれdataset adapterだけで対応する。省略音、alt、特殊増六などschema v1で完全表現できない情報はpartialにする。
未知のqualityをmajorへ丸めず、読めたroot/bassを残し、未知因子は `null` と診断理由を返す。
外部datasetごとの表記をこのパーサーへ無理に流用しない。

## 今回の検証（2026-09-19）

- Python 3.9.6: unittest 57件成功。代表和音、綴り・転調・部分未知・無和音・不正入力・CLI、
  McGillのHarte表記・数値bass・dot・phrase repeat・短い拍子変更・境界・作品split、dataset catalog、
  baselineの有限score・確率和・陰性label・履歴差・候補数・mixture順序・artifact再読込、checksum、
  取得拒否、local-only、allowlist、receipt、安全なtar/ZIP選択展開を検査。
- major/minorの綴り付きtonicと音名（各bb〜##）の2,450組で、度数とpitch classの整合性を検査。
- McGill Billboard 2.0のindexと890 annotation files、WJazzD release 2.1 / DB 2.2、ChoCo v1.0.0、
  POP909、POP909-CL、When in Rome固定commitを取得しSHA-256照合済み。POP909系はlocal-only、When in Romeは
  OpenScore Liederの手動分析179件だけをallowlist展開した。
- McGill 890 chartを全変換。117,311 eventsのうちok 115,524、no-chord 1,617、source自身の
  unanalysed `*` 112、schema v1で完全表現できない明示度数58。推定調を使えないeventは95。
  739 work familyをtrain 603 / validation 64 / test 72へ固定し、split間重複0を確認した。
- UI 42候補とのcoverageは完全factor eventを分母に、bass除外75.40%、bass込み68.47%。major推定区間に限ると
  それぞれ80.90%、73.66%。これはUI表示集合の診断であり、教師データの除外基準ではない。
- 本体の `npm run check` 成功（型検査・lint・format・116 unit tests・production build）。
- baselineはtrain 93,034 eventsで学習。test joint NLLはunigram 3.9789、Markov-1 3.5718、Markov-2 4.0317。
  Markov-1を代表baselineとする。詳細とrankingは [BASELINES.md](BASELINES.md)。
- WJazzD 456 solos / 30,548 events、POP909 909曲 / 124,805 events、POP909-CL raw archive内の
  908曲 / 116,872 events、When in Rome allowlist 179分析 / 14,030 events、ChoCo 20,086 JAMS・
  20,530 annotation views / 1,575,409 eventsを全変換した。
  POP909-CLはarchiveに043.midがなく、367.midには和音trackがないためsource noteとして保持した。
- 6 corpusを18,494 canonical work familyへ束ね、学習可能な7,982 songs / 715,706 eventsを重複排除後に採用。
  共通splitでpop / jazz / classicalのunigram・1次・2次Markovを再学習した。test NLLはMarkov-1が3.9147、
  UI MRRはMarkov-2が0.5176で最良。Transformer、ブラウザ連携、pip配布インストールは未実装・未検証。
