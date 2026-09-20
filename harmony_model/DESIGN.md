# 設計の基準

## 目的と既存アプリとの境界

履歴・style・調を条件に次和音の分布を学習する。長期目標は小型の単一style-conditioned causal Transformer。
学習空間はUIより広く、任意の表現可能な候補に比較可能なlog probabilityを返す。
音の配置、推薦の意味説明、候補の表示方法は別の責務とする。

2026-09-18のrepository確認に基づく接続点：

| 既存箇所                       | 現状と学習側への意味                                                                                                                               |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/music/harmony.ts`         | `Pitch = letter + accidental`、`Key = tonic + major/minor`。33 qualityには七度・拡張が混在する。既存IDをfactorへ変換するadapterが必要。            |
| `src/space/layout.ts`          | `spaceNodes(key)` がcore 14 / near 15 / outer 13、計42ノードを返す。12 major keys。C基準の安定IDは移調後も同じであり音名として解釈してはいけない。 |
| `src/space/context.ts`         | 独立した探索履歴は最大12 ID、表示は直近6回。style変更で保持、key変更で消去。記録用sessionとは別。                                                  |
| `src/space/recommendations.ts` | free/pop/jazz/classicalの規則によるスコア。直近8のうち最大4イベントのpattern、最大6候補。既存scoreは確率ではない。                                 |
| `src/state/session.ts`         | schemaVersion 5、最大256イベント、eventのkey/duration/notes、keyEvents、Undo/Redo。探索ID列と同一視しない。                                        |
| `src/music/voicing.ts`         | `bass` は和音構成音index、`addedBass` は独立した綴り付き低音、`notes[0]` が実際の最低音。MLのbass度数へ整数を直接コピーしない。                    |
| `src/music/generation.ts`      | 既存生成のstyleはpop/jazzのみ。探索の4 styleとは別契約。                                                                                           |
| build / audio                  | strict TS、React、Vite、npm、Tone.js。Pagesはdistだけ。Pythonをruntimeや音声予約へ持ち込まない。                                                   |

既存の層分離に合わせ、トップレベル `harmony_model/` に独立したPython packageを置く。
将来のPyTorch等に適し、今回は標準ライブラリのみなのでデータの検証にGPUやネットワークを必要としない。
本体の型を流用せず、将来はTSの実データからversion付きcandidate manifestを出力する。42件をPythonへ転記しない。

## 表現の契約（schema version 1）

`Pitch(letter, accidental)` は綴りを保存し、pitch classは派生値。C#とDbは別物。
accidentalは整数でbb=-2、b=-1、natural=0、#=1、##=2。schemaは整数範囲を固定しない。
将来の学習vocabularyはcorpusの分布を測って固定し、範囲外を黙ってclampしない。

`Key` は当面major/natural minorのみ。degreeは1始まり、**そのmodeの音階**に対するaccidentalを使う。
例えばA minorのGはVII natural、G#は#VII、CはIII natural。major基準のbIII方式ではない。
Roman表記adapterは出典の基準を確認して変換する必要がある。この選択を変える場合はschema versionを上げる。
綴りの文字間隔でdegreeを決め、音高差でaccidentalを決める。pitch classの近い側へ丸めない。

`SymbolicChord` は絶対root/bassと三和音・七度・extensions・alterationsを持ち、`ChordFactors` が調に相対化した姿。
七度はnone/minor7/major7/diminished7。qualityはmajor/minor/diminished/augmented/sus2/sus4/power/no3/other。
`None` は未知、空tupleは既知の不在。qualityのotherは部分的未知であり、和音全体のOTHER tokenではない。
`m7b5` は diminished + minor7（b5の重複記録なし）、`7b5` は major + minor7 + b5。
`aug` はaugmented、`7#5` はmajor + minor7 + #5と記譜の違いを残す。

extensions/alterationsは集合的なtuple。順序を正規化し重複を排除する。
`G7b9` はextensions=(9)、alterations=(b9)。`G7#9b13` は(9,13)、(#9,b13)。
plain-v1の `13` は明記された13だけを保存し、暗黙の9/11を作らない（七度はminor7）。`add9` は七度なし。
これは本体の13を7音へ展開する実装と意図的に違う。記号の意味を保存し、音集合を教師ラベルと混同しない。
異なるdatasetの暗黙音規則はadapter versionとconversion notesへ残す。

slash bassは独立した音名とkey相対度数。C/E、D/E、C/Cを保持し、slashなしを自動的にroot bassと決めない。
実際の最低音・転回index・voicingは推測しない。第一モデルではbassをscore対象外にできる。
その場合DbとDb/Fは同じharmony scoreになり、UI正規化前に同じ和声として集約し、配置選択で分ける方針。
42ノードをそのままsoftmaxすると重複和声が過大評価されるため、統合時の必須確認点とする。

## Key、失敗、文脈と来歴

`KeyAnnotation` にkey、origin（annotated/estimated/user）、evidenceを持たせる。estimatedには推定器version等のevidenceを必須にする。
localがあればlocalを使い、なければglobalを使い、どちらもなければ相対root/bassは未知とする。
`key_basis` にlocal/global_fallback/missingを明記する。globalをlocalの正解と見せない。
localとglobalそれぞれのoriginも保存するので、推定localが与えられても正解ラベルとは区別できる。
McGillの `# tonic` は長短を含まないため、そのまま完全なKeyAnnotationにはしない。adapter v1では
同じpitch classを根音に持つ最初のmajor/minor系コードからmodeだけを補い、複合したkey全体を
`estimated`、evidenceを `annotated tonic + 根拠chord/source reference + adapter version` として記録する。
判定できない区間はmissingのままにする。これは汎用key推定器ではなくMcGillの欠けたmodeを補う限定処理である。
将来は明示localを推定で上書きせず、未知keyの学習方針・confidence閾値を実験設定へ持つ。
転調前後のeventは各localで相対化し、key列も保持する。どの転調表現を入力するかは後続実験で比較する。

パイプラインはraw annotation → corpus parser → SymbolicChord → normalize → ChordEvent → sequence。
parser Protocolは `parse(raw) -> ParseResult`。raw_chordとsource_notationを常に保持。
`ok` / `partial` / `failure` / `no_chord` は別状態。未知suffixはroot/bassを残すpartial、読めないrootや壊れた括弧はfailure。
無和音は未知コードではない。失敗・無和音を単純削除して前後をつなぐと架空の遷移になるため、sequence化で境界またはmaskにする。

ChordEventはstyle（freeは教師ジャンルにしない）、duration/beat/bar/meter/phrase/section、global/local key、source referenceを保持できる。
時間単位はquarter-note beat、beat/barは0始まり。欠損はNoneであり0ではない。
Songはeventsとprovenance、work_idを保持する。provenanceにはsource/version/URL/license/download date/conversion notes。
ライセンス文字列があるだけで使用・再配布を承認したことにはしない。

McGill adapter v1は1 chord/barをbar全体、quadruple meterの2 chord/barを半分ずつ、明示dotをpulse継続、
それ以外をbar内等分としてquarter-note durationへ変換する。12/8・6/8は3 eighth notesを1 pulseとする。
短い `(2/4)` 等はそのbarだけに適用する。`xN` はline内の全barをN回に展開し、repeat indexをsource referenceへ残す。
`N` / `&pause` / `*` / silence / non-musical / endは削除せず境界として記録する。各境界は
「直後のevent index」を持ち、eventを持たないsilenceやZを挟んでも学習側が前後を接続しないようにする。

McGillのwork_idはchart headerのtitle+artistをNFKD・casefold・英数字列へ正規化したhash。slot IDは使わない。
公式説明の740 distinct songsに対して739 familyとなるため、split漏洩を避ける側へ保守的に統合し、差を診断へ残す。
将来cross-corpus identityを導入するときはこの暫定IDをversion付きで移行する。

## 学習・評価とscoreの契約

1 chord = 1 timestep。factor embeddingをsumする単純形から始め、style・positionを加える。
factorを時系列tokenに分割しない。初期候補はd_model 128–256、4–6層、4 heads、context 8–32。
まずfactorized unigram、1次・2次Markovと比較し、その後Transformerを実装する。

APIは `score_candidate(history, style, candidate) -> log_probability`。
初期multi-head baselineではカテゴリ因子のlog-softmaxと、**有無両方**を含むmulti-label Bernoulli log probabilityを加算する。
未知因子はloss maskにするが、不完全candidateを完全candidateと同条件でランキングしない。
完全なfactor tupleへの独立head分布は整合しない組合せにも質量を与えるため、後にd→a→q→s7→E→Aの条件付きheadと比較する。
loss重みやfocal weightingは確率の較正へ影響するので、training objectiveとscoreの定義を分離し検証する。
UI内のsoftmaxは「表示可能集合で条件付けした確率」であり、corpus全体の確率と説明しない。

freeはpop/jazz/classical条件分布の明示的な重み付きmixtureから始める。
log確率はlogsumexpで混合してからUI集合内で正規化する。style別のUI正規化後に平均する方式とは異なるので混同しない。
デフォルト均等重みを候補とし、学習はstyle-balanced sampling/weighting。最大corpusをfreeの意味にしない。

splitはevent/window生成より先に曲・作品単位で固定する。cross-corpusの同一曲、編曲、ChoCoと元datasetの重複を監査する。
seedだけでなくsource version・work grouping・split manifest・前処理version・hyperparameters・全実行commandを記録する。
評価はstyle/source別のNLL、factor accuracy、multi-label precision/recall、candidate ranking、較正、unknown/parse率。
UI候補coverageは別のdiagnosticであり、範囲外教師を捨てる基準にしない。

### Corpus adapter v1

McGillはSALAMI/Harte、WJazzDはSQLiteのbeat-gridとcompact symbol、POP909はtext annotation、
POP909-CLはMIDI chord track、ChoCoはJAMS/Harte、When in RomeはRomanTextを直接読む。
共通parserへ表記を推測変換せず、raw表記とsource referenceを残す。schema v1で失われる省略音、alt、
特殊増六、未知pitch setはpartialとしてsequenceを切る。ChoCoのaudio秒時刻はquarter-note durationへ偽変換せず、
durationをunknownにする。RomanTextも拍単位がmeterで変わるためsource beat位置だけを保持する。

POP909のkey/chordはalgorithmic weak label、POP909-CLはexpert-corrected labelとして区別する。
両者のwork IDは同じPOP909 numeric IDを使うが、個別split manifestは統合学習にそのまま使わない。
ChoCoはpartitionとannotation metadataを保持し、upstream copyを別教師として重複計上しない。
WJazzDはcompidをwork family、melid/trackid/recordidをperformance identityとして保持する。

### Baseline v1

unigram・1次・2次Markovは同じfactor headsを使う。degree / accidental / quality / seventhはcategorical、
extensions / alterationsは各語彙の有無を独立Bernoulliとし、陰性項もscoreへ加える。既定のalphaは0.5。
categorical語彙はschema由来の固定値とUNKを持ち、accidentalはbb〜##を明示語彙、それ以外をUNKとする。
contextは直前の完全なfactor tuple。未観測またはminimum count未満なら2次→1次→unigramとbackoffする。

部分解析、relative root欠損、no-chord、failure、明示boundaryではsequenceを切る。bassはbaseline v1のscore対象外。
UIの42ノードはbassを除くと41 unique harmonyなので、ranking前に集約する。候補集合内probabilityは
logsumexpで正規化し、corpus全体のprobabilityとは呼ばない。同点rankはaverage rank。

styleごとに別モデルを学習するため、最大corpusが他styleの分布を支配しない。freeはstyleモデルの
log probabilityを正の重みで混合してから候補集合内正規化する。現在はpopしかなく、free=popである。
artifactはmodel schema、語彙、counts、alpha、backoff閾値を含み、run manifestは入力SHA-256、split seed、commandを持つ。
評価はjoint NLL/perplexity、factor accuracy、multi-label precision/recall/F1、UI MRR/Top-k、backoff使用数を返す。

### Cross-corpus integration v1

統合データはeventを複製した巨大JSONLではなく、各変換済みJSONLを参照するversion付きmanifestとする。
source JSONLのSHA-256、source song/work、canonical work、採否、除外理由、共通splitを固定する。
work familyはsource work、exact title+creator、外部identifier、POP909 ID、明示Billboard slotを強い根拠とし、
jazzのtitle-only一致はcreatorの非空値が矛盾しない場合だけ採用する。曖昧なfuzzy title一致は自動統合しない。

重複排除は同じ情報を二重に重み付けしないためのtraining allowlistであり、raw recordを削除しない。
POP909-CLをweak POP909より優先し、ChoCoの完全upstream mirror、同一JAMSの代替view、同一work内の
完全一致factor sequenceを一度だけ採用する。一方、同一作品でも異なる演奏・編曲・独立annotationで系列が異なる場合は保持する。
相対root欠損等でcomplete sequenceが0のrecordは「重複」ではなくno-trainable-eventsとして別理由で除外する。
splitはallowlist適用前のcanonical workへ割り当て、同じ作品の全source recordを必ず同じsplitに置く。

### 公開学習用の統合profile v1

`datasets/publication_corpus_v1.json` はChoCo v1.0.0のWhen in Rome partition全449件を曲単位で審査した固定表である。
元の変換済みJSONLのSHA-256と、対応するWhen in Rome分析ファイルのpath・SHA-256を記録する。
165件のOpenScore Lieder mirrorは直接変換済みの179件の該当作品と結合し、mirrorを学習から除く。
これにより旧統合manifestで49件生じていた元分析とのsplit不一致も解消する。
54件のTAVERN由来分析と、When in Romeが新規分析と明記する27件を採用する。
残り203件は出典照合が曖昧、元ライセンスが不明、または今回の公開条件に含めないため除外する。
POP909/POP909-CLとChoCoのJAAH/Mozart Piano Sonatasも除外する。CC BY-SAとODbLの採用は
それぞれの表示・継承条件を満たす公開物の準備を前提とする。

統合器はこのprofileを指定した場合だけ`public-v1`を出力する。レビュー表がpartitionの全件を覆い、
固定した入力SHA-256と曲名・作曲者が一致することを要求する。採用・重複判定だけが分析pathによる
作品結合に参加し、除外行は採用しない。全行の採否・除外理由・許諾根拠をmanifestに保持する。
splitはこの作品結合後に割り当てるため、別sourceの同一分析が評価側へ漏れない。
今回の変更は教師集合とsplitに限り、因子表現・モデル構造・本体UIの契約を変えない。

`--pop-jazz-only`を指定した別profileは、公開用審査表を必須とし、採用レコードのstyleが
`pop`または`jazz`だけの場合に限って残す。複数styleが混在するレコードは全体を除外し、
将来のadapter変更で`classical`イベントが混入しても学習へ進めない。manifestの
`allowed_styles`をTransformer学習時に全系列と学習語彙へ照合する。出力データ版は
`public-pop-jazz-v1`、run保存先は`runs/transformer-pop-jazz/`とし、既存公開用runと分ける。
このモデルのstyle embeddingはpop・jazzの2件のみとなり、`classical`推論は受け付けない。
`free`は学習済みの2styleから計算する混合であり、独立した学習styleではない。

## Exportと拡張

### Transformer v1の実装判断

`model_versions.json`をsource管理のmodel定義indexとし、実行ごとの`runs/transformer/index.json`を
ignored artifactのrun indexとする。checkpointはmodel version・schema・語彙・重み・設定を保持し、
run manifestは入力とcheckpointのSHA-256、split seed、環境を記録する。再評価時にhashを照合する。
統合train 566,561 eventsのうち、同一sequence内に直前32和音を持つのは56.2%、直前8和音を
持つのは85.9%。短い履歴を優先して一度8へ変更したが、同条件の実験でcontext 32の
validation/test NLL 3.0024/2.9845、test UI MRR 0.6390が、8の3.2864/3.2902、0.5955より良かった。
この実測を受けて既定contextを32へ戻した。中間長や複数seedでの再現性は未確認。
学習率は固定を既定として残し、任意の`ReduceLROnPlateau`はvalidation NLLだけを監視する。
factor loss・checkpointのmodel schemaは変えない。schedulerの種類・係数・patience・改善閾値・
下限をrun configへ、各epochの使用学習率と次epochの学習率を履歴へ記録する。
早期終了patienceをschedulerより長く設定し、低下後の学習機会を確保する。
どちらのcontextでも全complete eventを一度ずつtargetにし、先頭の短い履歴も学習する。
短いcontextではwindow件数が増えるため、epoch時間が必ず短縮するとは限らない。
統合manifestに採用されたcomplete sequenceをそのまま使い、作品splitと境界を変えない。
styleはembeddingで条件付けし、学習windowはstyle間で均等サンプリングする。各windowの前半は履歴として
lossをmaskし、後半の各targetを一度だけ学習する。先頭はBOS、paddingはattentionとlossから除く。
未知accidentalは入力時UNKにし、そのheadの教師lossをmaskする。degree/quality/seventhは
schema語彙、extensions/alterationsは全ビットの有無をBernoulliで学習し、scoreにも陰性項を含める。
lossとscoreの各head係数は1。bassは予測せず、UI候補は和声を集約してからrankingする。
PythonのcheckpointをそのままPagesへ配布しない。

### ローカル確認画面

学習結果を人間が確認するため、Vite開発サーバーだけで開ける`model-test.html`を設ける。
本体のHarmonicSpace componentと42ノードのlayoutを再利用し、ローカルloopbackのPython APIが
version indexの完了checkpointを読み込んで41 unique harmonyの確率を返す。
APIは従来モデルとpop・jazz専用モデルの2つのrun indexを読み、run manifestのstyle語彙を
一覧へ返す。試験画面は選択runにないstyleのボタンを無効にする。classical選択中に
pop・jazz専用runへ切り替えた場合はfreeへ戻し、APIも未学習styleの予測要求を拒否する。
本体の履歴上限12は保持し、試験画面だけ最大runのcontext件まで履歴を保持して長文脈を試せるようにする。
学習と推論は入力を1時点ずらしており、モデルの最大入力長contextには直前context和音が入る。
画面に表示しAPIへ送る履歴は選択runのcontext件に切り詰め、runを切り替えても比較用の長い履歴を保持する。
run一覧には学習に使用した`dataset_version`を表示する。公開用と従来用では教師集合が異なり
validation NLLを直接比較できないため、初期選択は48文脈の公開用runを優先し、同一データ版内だけ
validation NLLで選ぶ。従来runも試験ページから手動で選べる。
UIは上位6和声の順位を枠と数字で示し、bass違いの複数ノードへ同じ順位を付ける。
上位6件の色はルール側の解決・継続・色彩・探索判定を全候補へ適用して求め、属七・減和音等の
緊張を別色にする。ルールにない候補も調内・借用の分析で分類する。分類は表示専用で、モデルの
候補数・順位・確率を変更しない。同じ候補に属するbass違いは一つの分類を共有する。
確率はUI候補集合で条件付けたもので、全和音への確率とは表示しない。候補manifestのchecksumと
version/IDを照合し、異なるUI候補定義とcheckpointを組み合わせない。
本体の規則推薦は変更しない。Python APIは127.0.0.1だけで待ち受け、Pages buildに含まれない。
これはモデルの複数run比較用の対話試験であり、本体の公開モデルとは別に扱う。

training → checkpoint → export → version付きruntime artifact → Chordscapeの順に切る。
公開pop・jazzモデルでは、入力manifestとcheckpointのSHA-256を照合してfloat32の重み配列と
候補manifestを静的artifactへ変換する。ブラウザのWeb Workerが重みのSHA-256と候補IDを検証し、
PyTorchのpre-norm causal attention、GELU、因子別headと候補集合内の正規化を再現する。
通常画面はPython APIを呼ばず、Classicalを受け付けない。出典と件数は
`public/model/TRAINING_DATA.md`に公開する。変更理由は、Pagesでbackendなしに同じ候補順位を出すため。
rulesによるresolve/continue/color/explore説明とvoice-leadingは独立のまま維持する。
専用backendを前提にしない。tablesは長い履歴を失う可能性、ONNX/TF.jsはruntime込み容量、custom inferenceは保守費用を比較する。
品質・download size・メモリ・推論時間を測るまで採用方式を固定しない。
将来のbass予測、local-key prediction、functional auxiliary loss、melody/phrase条件、style interpolationを妨げないよう生データを残す。

## 変更規則

schema / spelling / extension semantics / key基準 / scoringを変えるときは、理由・移行方法・UI adapterへの影響をこの文書に追記する。
今回の明示的な判断はmode-relative degree、記譜のみのextensions、部分未知と不在の分離、重複UI和声の集約方針。
実コーパスで妥当性を確認するまで、これらはversion付きの初期契約として扱う。
