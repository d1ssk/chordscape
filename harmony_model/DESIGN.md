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

## Exportと拡張

training → checkpoint → export → version付きruntime artifact → Chordscapeの順に切る。
rulesによるresolve/continue/color/explore説明とvoice-leadingは独立のまま維持する。
専用backendを前提にしない。tablesは長い履歴を失う可能性、ONNX/TF.jsはruntime込み容量、custom inferenceは保守費用を比較する。
品質・download size・メモリ・推論時間を測るまで採用方式を固定しない。
将来のbass予測、local-key prediction、functional auxiliary loss、melody/phrase条件、style interpolationを妨げないよう生データを残す。

## 変更規則

schema / spelling / extension semantics / key基準 / scoringを変えるときは、理由・移行方法・UI adapterへの影響をこの文書に追記する。
今回の明示的な判断はmode-relative degree、記譜のみのextensions、部分未知と不在の分離、重複UI和声の集約方針。
実コーパスで妥当性を確認するまで、これらはversion付きの初期契約として扱う。
