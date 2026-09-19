# 実装計画

## Phase 1–2：完了

設計の再構成、独立package、factor表現、parser/normalizer、inspection CLI、代表例と境界テスト。
外部データなし、依存なしで実行できること。本体の挙動を変更しないこと。

## Phase 3：調査・取得基盤と取得済みcorpus変換を完了

次の候補を公式配布元で調査し、source/version/URL/license/download date/conversion notesを記録する。
2026-09-18に全候補の公式配布元・version・license scopeを調査し、結果を
`datasets/catalog.json` と `datasets/README.md` に記録した。McGill BillboardとWJazzDは
ignored raw領域へ取得してchecksumを固定済み。その後、ChoCo v1.0.0も取得しJAMSのみ展開、
POP909とPOP909-CLはユーザー指示によりlocal-onlyで取得した。When in Romeは固定archiveを取得し、
新規OpenScore Lieder分析179件だけをsource allowlistで展開した。Real Book standaloneとDCMLは
権利条件またはsubset policyが未解決のため未取得。

| 候補                 | 調査の観点                                                   |
| -------------------- | ------------------------------------------------------------ |
| ChoCo                | subsetごとの由来・表記・許諾、元corpusとの重複               |
| McGill Billboard     | pop、曲identity、key annotation、配布条件                    |
| POP909 / POP909-CL   | 両者の違いとversion、alignment、key推定の由来                |
| Real Book由来corpora | 具体的な配布元の特定、楽曲・annotation・派生物それぞれの条件 |
| Weimar Jazz Database | jazz、form・meter・chord/key annotationの粒度                |
| When in Rome         | Roman notation、local key、作品・楽章のgrouping              |
| DCML harmony corpora | corpusごとのversion/許諾、local key、転回・pedal表現         |

最初は条件の明確な1 corpusの小さなsubsetを選び、必要ならmanual acquisitionとする。
`datasets/<source>/` にadapterを追加し、download/manual input → parse → normalize → sequence → statisticsを再現可能にする。
rawはignore領域、テストは再配布可能な小例または手作りfixture。利用・raw再配布・derived artifact公開はそれぞれ確認する。

取得とprovenance gateに加え、McGill Billboardを最初のadapterとしてHarte、bar repeat、phrase repeat、
metre/tonic change、silence/unanalysed境界を失わずに端から通した。正規化JSONL、診断、UI候補coverage、
作品単位split manifestを同一commandで再現できる。次のcorpusはWJazzDとし、`compid` を作品split family、
track/record/soloをperformance identityとして保持する。ただしbaselineを先に作り、McGill単独で
sequence/scoring契約を固めてから複数corpus化してよい。

診断の受入条件：songs/events、style、degree/accidental/quality/seventh/extensions/alterations、key/出典、sequence length、
parse failure/partial/no-chord/未知因子率、dataset/style別coverage。分母を記録し、失敗例へのsource referenceを残す。
UI coverageは実際のTS候補をversion付きで取得して測る。完全一致とbassを除く一致を区別する。
同一作品をまとめたsplit manifestをwindow生成前に保存し、split間の重複ゼロを検査する。
以上はMcGill、WJazzD、POP909、POP909-CL、ChoCo、When in Rome adapter v1で達成。
各adapterは共通Song JSONL、診断、作品単位splitを出力し、dataset固有表記を専用moduleへ閉じ込める。
McGillの公式説明740 distinct songsに対し、headerの正規化title+artistは
739 familyとなるため、公開評価時にはidentity差1件を再監査する。

## Phase 4：Baseline完了

factorized unigram / first-order / second-order Markov、平滑化、未知contextのbackoff、style-balanced学習。
score API、完全candidateのUI正規化、free mixture、NLL/ranking評価をCLIとconfig/seedで再現可能にする。
小さなtoyデータでscoreの有限性、確率和、BCEの陰性ラベル、履歴の違い、候補数の変更、mixtureの順序をテストする。

`baseline-v1` で実装済み。styleごとに独立した条件モデルを学習し、freeはlog-spaceの明示mixtureとした。
現在の教師はpopだけなのでstyle balancingは自明で、freeもpopと同じ。McGill固定splitではMarkov-1が
validation/testのjoint NLLで最良。Markov-2はUI rankingをわずかに改善するがtest NLLがunigramより悪く、
疎なcontextへの過適合がある。以後のモデルはMarkov-1を主baselineとして同じsplitで比較する。

## Phase 5：複数corpus統合を完了

取得済みrawの個別adapterと全件変換に加え、ChoCoとupstream、POP909とPOP909-CL、同一jazz standard等を
共通work familyへ束ねた。公開可否・annotation品質・complete factor有無に基づくtraining allowlistをmanifest化し、
cross-corpus family確定後の統合splitでstyle別baselineを再生成した。巨大なevent JSONLは複製せず、source checksumと
採否理由を固定する。実測値と判断は`INTEGRATED_BASELINES.md`に記録する。

## Phase 6：Transformer

1 event = 1 timestep、causal mask、padding/未知factor loss mask、単一style-conditionedモデル。
未来情報漏洩テスト、baselineと同一splitでの評価、history ablation、style/source別診断を必須にする。
推定keyと注釈keyを分けて評価。長い履歴の効果が示せない限り複雑化を正当化しない。
依存versionと実験環境を固定し、train/evaluate/export commandと実験manifestを保存する。

## Phase 7：静的アプリへのexport

本体のquality ID→factor、key、履歴ID→実コード、bassのadapterを作る。
未対応candidateの扱いと和声重複を仕様化。既存の規則による説明・voice-leadingとの責務を保持する。
artifact容量・推論時間・メモリ・品質を比較しブラウザ技術を選ぶ。subpath/offline・schema互換性・fallbackを検証する。

## 検証コマンド

- `cd harmony_model && python3 -m unittest discover -s tests -v`
- repository rootで `npm run check`

候補manifestは本体の実データとunit testで同期する。音声・ブラウザ挙動は変更しないためE2Eは追加しない。
Pythonテストは外部rawを必要としないfixtureだけで独立CI jobとして実行する。全件変換は固定checksumのrawを持つ
local環境で行い、診断と件数を文書へ記録する。
