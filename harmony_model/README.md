# Harmony Model

Chordscape の次和音提案に向けた、独立した学習・データ処理プロジェクト。
42個のUI候補を学習クラスにせず、綴りを保持した根音度数・三和音・七度・拡張音・変化音を共有するモデルを育てる。

現在は **Phase 6のTransformer学習・評価基盤まで実装**。変換、統合、Markov baselineはPython標準ライブラリだけで動作し、Transformer学習には別途PyTorchが必要。
McGill Billboard、Weimar Jazz Database、ChoCo v1.0.0をignored raw領域へchecksum固定で取得済み。
POP909とPOP909-CLは権利範囲の不明点を残したままlocal-onlyで取得し、公開対象から除外する。
When in Romeはsource別条件を尊重し、CC BY-SAの新規OpenScore Lieder分析179件だけをallowlist展開した。
候補別の license と採否は [datasets/README.md](datasets/README.md)、機械可読な来歴は
[datasets/catalog.json](datasets/catalog.json) を参照する。McGill Billboard 2.0はrawから正規化Song、診断、
作品単位splitまで再現できる。McGillは同じsplitでunigram・1次・2次Markovを学習・評価済み。
結果は [BASELINES.md](BASELINES.md) を参照する。
全corpusの変換件数と既知制約は [CONVERSIONS.md](CONVERSIONS.md)、統合規則と再学習結果は
[INTEGRATED_BASELINES.md](INTEGRATED_BASELINES.md) を参照する。和声空間本体は`npm run model:test`で起動するローカルAPIから、完了済み48文脈runの提案を取得する。権利条件の確認が済むまでcheckpointは公開版へ同梱しない。
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

### Transformerの学習

Python 3.12で確認済み。学習用依存は独立した仮想環境へ導入する。`uv.lock`に間接依存も固定した。

```sh
cd harmony_model
python3.12 -m venv .venv
.venv/bin/python -m pip install -e '.[train]'
.venv/bin/python -m harmony_model train-transformer \
  --corpus-manifest data/processed/integrated-v1/corpus_manifest.json \
  --candidate-manifest datasets/chordscape_candidates.v1.json \
  --output-root runs/transformer
```

`uv` がある場合は `uv sync --extra train --locked --python 3.12` でlockfileと一致する環境を作れる。

既定はcontext 32、128次元、4層・4 heads、8 epochs、seed 42。`--device auto`はCUDA、MPS、CPUの順で選ぶ。
全統合corpusの採用済み系列を使用し、styleごとにwindowを均等サンプリングする。未採用の重複・不完全系列は統合manifestの規則どおり除外する。CPUでは全件学習に時間がかかる。短い動作確認には `--epochs 1 --context 8 --d-model 16 --layers 1` を使えるが、品質比較には既定設定か十分に検証した設定を用いる。

学習を止めるときは実行中の端末で `Ctrl+C`。run manifestは`interrupted`となり、完了済みepochの履歴と最良checkpointは残る。`--context 16`など設定を変えて同じ学習commandを再実行すると、新しいrun IDで最初から学習する。設定変更後に旧checkpointから重みを再開する機能はない。中断runは完了runのindexへ登録しない。

全epochが終わった後の最終評価中に止めたrunは、最良checkpointから評価だけを再実行できる。元の学習プロセスを `Ctrl+C` で完全に終了させてから実行すること。既定のCPU評価はbatch単位で指標を計算し、完了したrunをindexへ登録する。

```sh
.venv/bin/python -m harmony_model finalize-transformer \
  --run-dir runs/transformer/transformer-v1/<run-id> \
  --corpus-manifest data/processed/integrated-v1/corpus_manifest.json \
  --candidate-manifest datasets/chordscape_candidates.v1.json \
  --device cpu
```

完了したrunは `runs/transformer/index.json` から `transformer-v1/<run-id>/` を参照できる。runディレクトリには最良の `best.pt`、epoch履歴、run manifest、validation/testのstyle・source別NLLとUI候補rankingを保存する。model定義のsource管理indexは [harmony_model/model_versions.json](harmony_model/model_versions.json)。run manifestは使用データ・候補のSHA-256、split seed、設定、PyTorch/Python version、実行command、checkpoint hashを記録する。checkpointとrun indexはignored local artifactでありcommitしない。

再評価は入力ファイルとcheckpointのchecksumを照合してから実行する。

```sh
.venv/bin/python -m harmony_model evaluate-transformer \
  --run-dir runs/transformer/transformer-v1/<run-id> \
  --corpus-manifest data/processed/integrated-v1/corpus_manifest.json \
  --candidate-manifest datasets/chordscape_candidates.v1.json
```

予測はbassを含まない6 factorのjoint log probability。UI候補はbass差を集約した41和声で評価する。未知accidentalの教師labelはそのheadのlossから除外し、系列境界をまたいで履歴を作らない。静的アプリ用exportとブラウザ推論は未実装。
Pythonからは `TransformerScorer.from_checkpoint(path)` で読み、`score_candidate(history, style, candidate)` と `normalize_candidates(...)` を利用できる。`free` は学習したstyleのjoint確率を均等混合し、その後に候補集合内で正規化する。

### Context比較（2026-09-20）

同じ統合corpus・split・seed・モデル次元・層数・学習率でcontext 8と32を比較した。
最良checkpointは8がepoch 6、32がepoch 7。context 32のvalidation/test NLLは3.0024/2.9845、
context 8は3.2864/3.2902。test UI候補MRRも0.6390対0.5955で32が上回った。
長い履歴そのものの効果を確定するには、中間長や複数seedを比較する必要があるが、
現在の実測最良値に合わせて既定contextを32へ戻した。

### 学習率schedulerと比較実験

既定の学習率は従来どおり固定。`--lr-schedule plateau` を指定すると、各epochのvalidation NLLを
PyTorch `ReduceLROnPlateau`へ渡し、改善が止まったとき学習率を下げる。
`--lr-patience`は学習率低下までの猶予、`--patience`は学習全体の早期終了までの猶予で別物。
低下係数は`--lr-factor`、下限は`--min-learning-rate`、改善判定の相対閾値は`--lr-threshold`。
各epochで使用した学習率と次epochの学習率は標準出力と`history.json`へ保存する。
既存checkpointは固定学習率として引き続き読み込める。

以下で実験コマンドを確認し、5条件を順番に実行できる。どの条件も同じdata・split・seed・
128次元／4層・plateau schedulerを使い、名前にある値だけを変える。各実行は新しいrun IDを持つ。

```sh
cd harmony_model
bash scripts/run_transformer_sweep.sh --dry-run
bash scripts/run_transformer_sweep.sh
```

順序はcontext 32のscheduler基準run、context 16、context 24、context 32で初期学習率0.0002、
context 32でdropout 0.2。共通設定は最大12 epoch、早期終了patience 5、scheduler patience 1、
低下係数0.5、最小学習率0.00001。標準出力とエラー出力を
`runs/transformer/experiment-logs/<UTC時刻>-<PID>/<条件名>.log`へ同時記録する。
途中で止めて3番目以降だけ実行するときは `bash scripts/run_transformer_sweep.sh --from 3`。
結果はまずvalidation NLLとUI候補MRRで比較し、testは最終選択の確認に使う。

### 学習済みモデルのローカル確認画面

repository rootで `npm run model:test` を実行し、表示されるVite URLの
`/model-test.html`を開く。`harmony_model/.venv` と、`runs/transformer/index.json`に登録された
完了runが必要。コマンドはローカル専用のPyTorch推論API（127.0.0.1:8765）とViteを同時に起動し、
Ctrl+Cで終了する。APIだけを起動する場合は、このディレクトリで
`.venv/bin/python -m harmony_model.preview_server`を実行する。

画面は本体のHarmonic Spaceを再利用し、同じ42ノードの配置・調・style・試聴・履歴を持つ。
テスト画面は最大の選択可能runに合わせて履歴を保持し、予測・表示には選択したrunのcontext件数だけを使う。
context 32なら直前32和音、context 48なら直前48和音を入力できる。モデルの入力は1時点ずらしているため、
学習時のcontext長は予測に使える直前和音の最大件数と一致する。モデル一覧は「run一覧を更新」で再読込できる。
モデルrunを選ぶと、クリック履歴を入力にPyTorch checkpointで41種類の異なる和声を採点し、
上位6種類の順位をノードに示す。DbとDb/Fのようなbass違いは同じ和声確率を共有する。
上位6件の枠・凡例・一覧には、既存の和声ルールによる解決・継続・緊張・色彩・探索の色と文字を付ける。
色は順位や確率の計算には使わず、bass違いで同じ候補に属するノードは同じ色にする。
表示する確率は41候補内で正規化した値であり、全和音に対する確率ではない。
モデルの因子は調に相対的なので、major keyを変えるとノード名が移調されるが順位は変わらない。
この画面は開発サーバー専用で、本番のGitHub Pages buildには含めない。
通常の和声空間の規則提案とブラウザ単体のモデル推論は引き続き別機能。

JSONの `factors` に度数・accidental（半音差の整数）・quality・seventh・extensions・alterations・bassを表示する。
各`convert-*`と`convert-all`はignored領域へ `songs.jsonl`、`split_manifest.json`、`diagnostics.json` を書く。
Chordscapeの実際の42候補から作ったversion付きmanifestを既定で読み、bass込み／bass除外coverageを別々に測る。
`train-baselines` は `unigram.json`、`markov1.json`、`markov2.json`、`evaluation.json`、
`run_manifest.json` をignored領域へ書く。run manifestには入力checksum、split seed、全引数を記録する。

`raw_chord`、綴り、keyの由来も保持する。CLIのkeyはユーザー指定であり、コーパスの正解ラベルを意味しない。
未対応suffixは部分解析としてJSONを出し終了コード1、不正表記も1、引数エラーは2。成功と明示的な無和音は0。

データ処理とbaselineの実行・テストにpip installは不要。Transformerだけは `.[train]` のPyTorchを使用する。
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
- `harmony_model/transformer.py`: style条件付きcausal Transformer、学習・評価・version付きcheckpoint。
- `harmony_model/model_versions.json`: source管理のmodel version index。
- `scripts/run_transformer_sweep.sh`: plateau schedulerを使った5条件の順次学習とログ保存。
- `harmony_model/__main__.py`: 変換・baseline・TransformerのCLI。
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
  UI MRRはMarkov-2が0.5176で最良。これはTransformer実装前のbaseline結果。
- Transformerのcausal mask・checkpoint再読込・version index・schedulerを含む
  Pythonのunittest 63件成功。context 8と32で全件学習を完了し、上記のvalidation/test結果を比較済み。
  plateau schedulerを使う5条件と24 epochの3条件を実行済み。ローカル試験画面でcheckpointを比較できるが、
  静的アプリ向けのブラウザ単体推論は未実装。
