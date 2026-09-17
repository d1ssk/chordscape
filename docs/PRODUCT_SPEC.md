# Chordscape — 全体像・機能仕様・実装設計

仮題：**Chordscape**。副題案：Explore chords, progressions, and modulation.

この文書は合意した構想を実装可能な仕様へ整理したもの。技術構成、初期値、細かな操作規則は開発を進めるための提案デフォルトであり、ユーザーから変更指定があればそちらを優先する。first commitの範囲はFIRST_COMMIT.mdに従う。

## 1. 目的と基本体験

コード進行を触って遊びながら、耳と理論を対応づけるブラウザ上の楽器兼学習環境を作る。中心となる状態は「現在の調」「現在の和音」「直前までの進行」。

**押す → 鳴る → 音の構成と文脈が見える → 次を試す** という流れを最優先する。

常に対応づける情報：

- コード名、調に対するローマ数字、和声機能の候補。
- 構成音と音程、実際のoctave配置、bass。
- 鍵盤、進行timeline、五度圏、実際の音。

Theory、Playground、Earを別アプリにしない。同じ和音・進行・再生系を共有し、表示と学習方法を切り替える。

### 前提

- GitHubでCodexを使って開発し、GitHub Pagesで静的公開。
- アカウント、server、外部LLM、API keyは不要。生成はrule basedでブラウザ内完結。
- 12平均律、A4=440 Hz。最初の拍子は4/4、tempoは40–200 BPM、初期90。
- 日本語を初期表示にし、英語切替も提供。音楽記号と音名は共通データから表示。
- 初期はdesktop中心だがmobileでもコード演奏と停止ができる。
- 五線譜、MIDI入出力、録音書出し、PWA、共同編集、微分音は初期範囲外。

## 2. 画面と操作原則

### メイン画面：Playground

上部にKey / mode、BPM、Play / Pause / Stop、Record、Loop、音量。コード選択・試聴・再生の最初のユーザー操作で音声を開始し、音源の準備後にその操作を実行する。独立した「音声を開始」は任意の事前準備とし、操作の前提にしない。詳細操作を開いてもStopは常に到達可能にする。準備待ちの操作は停止・編集・画面移動・非表示で取り消す。

中央にdiatonic chordパレット。各ボタンにコード名とローマ数字を表示。三和音と七の和音を2行で同時表示し、モバイルでも各行7個の横並びを保つ。詳しい機能表示は選択和音の解説で示す。現在鳴っているものと次に予約されたものは別表示。

その下にOutside keyの折りたたみ、さらにprogression timeline。下段またはサイドパネルをKeyboard / Chord details / Library / Circle / Melody / Listenで切り替える。

色はTonic、Predominant、Dominant、Outsideの補助表現とし、ラベルや形でも識別する。機能が曖昧なコードを強制的に一色へ断定分類しない。

### 和声空間：Harmonic Space

演奏・記録から独立した探索画面。既存の42ノードの位置関係を維持し、12 major keysへ和音を移調する。初期はC major / Free。直近6回の履歴を灰色の背景、最大6個の次候補を種類別の色付き枠で重ねて表示する。Free / Pop / Jazz / Classicalは候補の重みを変更し、履歴や現在の配置を保持する。

発音は直前の配置と上位の次候補を考慮するautomatic voice leadingを使う。調変更では発音・待機を止め、探索文脈を消し、styleのみ保持。探索履歴は保存せず、演奏画面のsessionは変更しない。edge・trail・minor key・tritone substitution専用UI等は対象外。構造・推薦規則・検証範囲は [HARMONIC_SPACE.md](HARMONIC_SPACE.md) を参照。

### 初回体験

C major、triads、90 BPM、root position、melody off、speech off、Record onをデフォルトとする。Cを押すだけで音声の準備と発音を行い、C / I / C–E–Gが表示され、timelineへ追加される。説明を読まずに遊べること。

### 演奏・記録・編集の区別

- 停止中にパレットを押す：即時に鳴る。Record onなら1イベント追加、offなら試聴のみ。
- timelineのイベントをクリック：選択・試聴し、重複追加しない。
- timelineには選択・削除・複製・並べ替え・長さ変更を提供。dragに加え移動ボタン等も用意する。
- 初期durationは4 beats。停止中の記録はクリック間の実時間を採用せず設定durationを採用する。
- Loop再生中の編集は次の周回へ反映する。予約済み音を中途半端に書き換えない。
- P1のtimeline再生中はパレットを追加演奏させず、停止して編集する導線を示す。P4で独立したLiveモードを導入する。
- Pauseは予約とvoiceをreleaseしてbeat位置を保持。Resumeは保持位置で有効なコードを再発音し残り時間を再生。Stopは先頭に戻し、即時停止のため短いreleaseのみ許容。

## 3. 調とdiatonic chords（P1）

長調と自然短音階を選択可能にする。C majorのtriadsはC / Dm / Em / F / G / Am / B°、seventhsはCM7 / Dm7 / Em7 / FM7 / G7 / Am7 / Bm7♭5。

A natural minorのtriadsはAm / B° / C / Dm / Em / F / G。短調でのE / E7 / G♯°は和声的短音階に由来する追加候補として区別する。最初から自然短音階のdiatonic表にE7を混在させない。

- 音名は調に沿って綴る。F majorはB♭、F♯ majorにはE♯がある。表示をすべてsharpに統一しない。
- pitch classが同じでもC♯とD♭の綴りは保持する。
- コード名とローマ数字の表示はmajをM、dimを°に統一する（CM7、Cm(M7)、B°、C°7）。保存用quality IDと音声素材のIDは既存のまま維持する。
- major/minorの一般的な調号をサポートし、異名同音の調は表示選択で切替可能。五度圏の12スロットに全綴りを詰め込まない。
- 三和音と七の和音のどちらの行からも演奏・記録できる。五度圏の比較に使う和音種は五度圏画面内で選び、記録済み進行は変更しない。
- 調の切替は次に選ぶコードと表示文脈を変更し、既存イベントの音高は保持する。
- 「進行全体を移調」は別操作。全イベントとkey changesを同じ半音差で移し、綴りを再計算する。元の相対的な転調関係を保つ。

短調のdegree表記は主音からのmajor基準を既定とし、A minorでは i / ii° / ♭III / iv / v / ♭VI / ♭VII。設定やヘルプで慣習を説明する。流儀を混ぜず、内部のdegreeとalterationから描画する。

受入例：F majorでB♭を表示し、A minorのvはEm。E7を選ぶとV7としての短調の導音利用が説明される。

## 4. Outside keyと和声分析（P1、拡張P2）

「調外」を禁止や誤りと扱わず、利用目的を探せるパレットにする。

既定パレットはカテゴリ見出しを付けず、以下の順に表示する。他の調では根音の度数と綴りを保って移調する。D♭/F相当の転回プリセットは含めない。

- C major：A7、B7、C7、D7、E7、F♯7、C♯°7、D♯°7、F♯°7、G♯°7、Cm、E♭、Fm、Gm、A♭、B♭、Fm7、A♭M7、B♭7、D♭7、E♭7、A♭7、F7、D♭、Caug、Gaug、Am(M7)。
- C natural minor：G、G7、B°、B°7、Cm(M7)、E♭aug、E♭M7♯5、Dm7、F、F7、Am7♭5、Bm7♭5、C、CM7、Dm、Em、Em7、A、Am、Am7、C7、D7、E♭7、F7、A7、D♭、A♭7。F7の2か所の表示は意図的に保持する。

既定候補に加え、「＋ 追加」から根音と33種類のqualityを選んで任意の和音を登録できる。追加分は個別に削除可能。追加分と既定候補の同じ綴り・qualityの重複表示を防ぎ、調を変えても登録したコード名を保持する。追加分はこのブラウザのlocalStorageへ即時保存し、進行のJSONとは独立させる。保存不可でも画面内では使用でき、警告を表示する。

| 種類 | C majorでの例 | 説明の方針 |
| --- | --- | --- |
| Secondary dominant | A7 → Dm、D7 → G | V7/ii、V7/V。解決先の候補を示す |
| Parallel minorからの借用 | Fm、A♭、B♭ | iv、♭VI、♭VII。借用元と変更音を表示 |
| Minorのdominant | A minorでE7 | 第7音G♯による導音の形成 |
| Chromatic approach | A♭ → G → C | 音の動きに基づく解説。単一の機能と断定しない |
| 自由選択 | 任意root＋quality | 辞典から現在の調へ持ち込める |

コードを選ぶと、現在の調の音／変化音、解決候補、必要なら前後関係を示す。A7を押しただけなら「Dmへのsecondary dominantとして使える」、A7→Dmが実際に成立したら「ここではV7/ii→iiとして解釈できる」と区別する。

T/P/D分類は学習用の簡略モデル。iiiやviの機能、借用和音、ジャズの使い方は文脈依存である。静的なqualityだけで分析を確定しない。

分析器は候補ラベル・根拠・適用文脈を返す。生成器が与えた意図と後から推定した分析を分けて保持する。画面用の文字列を分析の唯一のデータにしない。

## 5. Chord Library（基本P1、拡張P2）

rootを選ぶと33種類のqualityをコード名のボタンで一覧表示する。ボタンで選択し、音声が利用可能ならその場で試聴する。family・qualityのプルダウンは置かない。「進行へ追加」は別操作とする。

辞典はモバイルも6列とし、小さなカテゴリ見出しと以下の学習順で表示する。Extensionsだけは9種類のため2行になる。

- Basic：major、minor、dim、aug、sus2、sus4。
- Seventh：M7、7、m7、m(M7)、m7♭5、dim7。
- Added tones / Sixth：6、m6、add9、m(add9)、6/9、7sus4。
- Extensions：M9、9、m9、11、m11、13、m13、M13、M7(♯11)。
- Altered：M7♯5、7♭5、7♯5、7♭9、7♯9、7(♭9,♯5)。

基本quality：major、minor、dim、aug、sus2、sus4、7、M7、m7、m7♭5、dim7。拡張：6、m6、add9、9、M9、m9等。

追加quality：7♭5、m(M7)、7sus4、7♯5、M7♯5、6/9、m(add9)、7♭9、7♯9、M7(♯11)、11、m11、13、m13、M13、7(♭9,♯5)。11系は6音、13系は7音を省略せず扱い、第5・第6転回にも対応する。名前の録音を使う聞き流しは既存17種類が対象で、新規16種類は含めない。

選択コードについて表示するもの：

- symbol、構成音、rootからの音程（1 / 3 / 5 / ♭7等）。
- 鍵盤と発音、転回の選択、現在の調における位置。
- 「現れる調」の例：D7はG majorのV7、C majorのV7/Vとして利用可能。網羅的・唯一の帰属ではない。
- 「進行へ追加」と「試聴」を区別。

Cadd9とC9（後者は♭7を含む）、CM7とC7、Cm7♭5とC°7を区別する。楽理上の全構成音と、voicingで実際に発音する音を別々に表示する。拡張和音の省略・重複は後の機能とし、初期は省略しない。

## 6. 転回形・voicing・bass（P1の中核）

次の3層をデータモデルとUIの双方で分離する。

1. Chord：rootとqualityで決まる和音。例C = {C,E,G}。
2. Inversion：和音のどの構成音が実際のbassに来るか。
3. Voicing：その構成音をどのoctave・配置・重複で鳴らすか。

C3–E3–G3はroot、E3–G3–C4は第1転回、G2–C3–E3は第2転回。C3–G3–E4はopenなroot position。

### 操作と表示

- 選択コードのbass候補を構成音から選ぶ。triadはroot / 1st / 2nd、seventhは3rdまで。
- timelineにはC / C/E / C/G等、実際の響きに対応するsymbolを表示する。
- Romanの転回数字は別の表記層：triadの6、6/4、seventhの7、6/5、4/3、4/2。secondary dominantのslashとbass slashを混同しない。
- 鍵盤は実音MIDIを点灯し、bassを強調。根音とbassを別ラベルで表示。
- voicing modeはRoot position / SmoothをP1で実装。Keep common tones / Bass motion / open配置は後から追加。
- 手動bass指定はautoより優先する。autoを有効にしても固定したイベントを勝手に変更しない。

### 最低音の定義

転回は伴奏全体の最低音で判定する。上声だけE–G–Cにして、その下にCのbassを鳴らすなら全体はroot positionでありC/Eではない。独立bass partを付ける場合も指定bassに従わせる。

C/Dのような非構成音bassはslash chordとして別データで表し、「第n転回」と呼ばない。初期UIは構成音bassだけ対応でよい。

### Smoothの実装

- root/qualityを変えず、使用音域内の候補voicingを列挙する。初期の伴奏音域の目安はMIDI 48–76、必要なbassは36–60。
- scoreは声部の半音移動量、最大jump、bass移動、音域逸脱、低域の密集へのpenalty、共通音保持へのrewardから作る。
- 同声数では順序を保った対応づけを行う。三和音と四和音の間では挿入・削除cost付き対応を使う。配列indexを無条件に比較しない。
- online演奏では直前のvoicingから局所選択。確定済みtimelineはdynamic programmingで全体最適化できる。loop末尾→先頭の移動も評価。
- 同点時の規則を固定する。最初の和音は中央付近のroot positionから始める。
- 「最適」はこのcost内での意味であり、唯一の音楽的正解とは説明しない。古典和声の禁則検査を初期に暗黙追加しない。
- 説明は実際の差分から生成する。「共通音保持」と表示するなら、その声部の同じMIDI音が保持されていること。

比較例：C → G/B → Am → C/G → F、bassはC → B → A → G → F。root movementとbass movementを別の線／段で表示する。

**Am/GはAm三和音の転回ではない**。Gを含めたAm7/Gとして扱う場合は和音自体が変わる。転回のA/B比較でこれを同一和音の別配置と偽らない。

A/B機能は同じ進行・tempo・音色・長さでRoot / Smoothを再生する。seventhの第3転回も検証し、G7/FのbassがFでRomanはV4/2になることを確認する。

## 7. Timelineと保存（P1）

各イベントは安定ID、開始beat、duration、Chord、key context、bass/voicing設定を持つ。P1は順番とdurationから開始位置を導出してもよい。編集中のIDを配列indexにしない。

- Play / Pause / Stop、loop、現在beat、イベント位置を表示。
- 複製、削除、並び替え、duration変更、全消去（undo可能）を実装。
- Undo/Redo対象は進行・key events・設定のユーザー編集。再生tickは履歴に入れない。
- 最後のsessionと設定をlocalStorageへdebounce保存。storage禁止や容量超過でも演奏を続けられる。
- schemaVersion付きJSONのexport/import。import時に型・数値範囲・最大件数を検証し、不正データは読み込まない。
- 保存するのは楽曲データと設定。AudioContext、node、speech voice object、timer IDは保存しない。
- auto生成のseedと生成設定を保存。演奏時は確定済みvoicing/notesを利用し、Playを押すたびにランダムに変わらない。
- 移調やvoicing設定を変更したら派生データを明示的に再計算。importした古いschemaへの対応はmigrationまたは明確なエラーにする。

## 8. Auto Progression（P2）

完全ランダム抽選ではなく、style別の短いtemplate、和声機能の遷移、cadence制約を組み合わせる。最初はPopとJazzから始める。

| Style | 例／狙い |
| --- | --- |
| Pop | I–V–vi–IV、vi–IV–I–V等、triads中心 |
| Jazz | ii7–V7–IM7、IM7–V7/ii–ii7–V7 |
| Classical-ish（追加） | T–P–D–T、cadenceを明確に |
| City Pop / Lo-fi（追加） | seventh・借用・配置・rhythmをpreset化 |
| Film（追加） | pedalやchromatic mediant等を限定的に導入 |

後半のstyleは名前だけのボタンを作らず、生成規則と例を実装した段階で公開する。

入力：key、style、長さ（4/8/16小節）、harmonic rhythm、triad/seventh、outside率、cadence/loop、seed。複雑度の上昇に応じsecondary dominantsやborrowed chordsを許可し、tritone substitutionは後のJazz拡張とする。

生成pipeline：Roman progression → keyに応じたChord → bass制約 → voicing → playback events。生成意図（例V7/ii）をイベントへ付ける。

- フレーズ終端に目標を持たせ、ii→V、V→I/vi等の遷移はstyleに応じた重みで扱う。
- 「Generate」は停止中の明示操作。生成後は編集可能で、再生成はUndoできる。
- Auto連続モードは次のフレーズを事前生成してから再生。現在鳴っているフレーズを変えない。
- 同じseed・設定・generator versionなら同じ結果。お気に入りをJSONで保存可能。
- 制約が満たせない場合は無限再試行せず既知のtemplateへfallbackし、その旨を表示。

受入例：C majorでCM7 → A7 → Dm7 → G7が生成可能、IM7 → V7/ii → ii7 → V7と表示。再生と表示が一致する。

## 9. 五度圏と転調（P3）

SVGでinteractiveな五度圏を作る。major outer ring、relative minor inner ring、現在調、候補調、共有音を表示する。隣接は調号の近さを示すもので、唯一の転調距離や推奨順序とみなさない。

### 操作を区別

- クリック：target keyを選択し比較する。
- 「この調を選ぶ」：以後のパレットを即時変更。既存進行は維持。
- 「転調して進む」：bridgeを提案し、試聴・追加後、演奏中の指定beatでkey changeする。
- 「全体を移調」：既存曲を一括transpositionする。転調bridgeとは別。

共通コードはrootだけでなくqualityと構成音を比較。C majorとG majorの共通triadsはC、Em、G、Am。七の和音設定では共有集合が変わることがある。

例：C → Am → D7 → G。Amは旧調のvi、新調のiiとしてpivot候補、D7は旧調のV7/V／新調のV7、Gは旧調のV／新調のI。採用したkey-change境界と旧新両分析を表示する。bridgeを鳴らす前にUIだけ先の調へ移さない。

D7→Gだけでは一時的なtonicizationとも解釈できる。アプリがその後Gを調として維持する設計上の転調と、音楽的に聴き取れる転調の強さを区別して説明する。必要なら新調のcadenceを続ける。

最初は近親調、pivot chord＋target dominant＋tonicを実装。遠隔調は経由調を提案するかdirect modulationとして明示し、無理な共通コードを捏造しない。

Circle travelはC → G → D → A等を経由する連続モード。各区間の進行とkey eventsを生成して通常のtimelineで再生する。

## 10. Auto Melody（P4）

伴奏和音の上にrule basedで旋律を付ける。生成AIは不要。音数の少ない、反復のある旋律から始める。

### 共通規則

- 強拍でchord toneを高確率にし、弱拍はscale toneや経過音を許容する。
- 近接進行を優先し、ときどき跳躍、跳躍後の逆方向の動き、休符を入れる。
- 1–2小節のmotifを反復・変形する。毎拍独立抽選しない。
- 音域の初期目安はMIDI 60–84。伴奏より上に置くことを優先するが、常に聴感確認する。
- 調外和音では元のscaleだけに縛られず、その和音の構成音・変化音を優先。
- chord tone / scale non-chord tone / chromatic toneを色とラベルで区別。
- passing toneは前後の音の関係、approachは解決先を確認して付ける。弱拍の非和声音すべてをpassing toneと呼ばない。

新規生成は旋律generator version 2。8拍のモチーフに半拍・1拍・1.5拍・2拍と休符を組み合わせ、前半の輪郭に後半で応答する。等間隔の連続と同音連打を抑え、音域の中心を固定して和音変更ごとに高音側へ偏らないようにする。activityは輪郭の幅と移動量を調整し、大きな跳躍を抑えつつ跳躍後の反対方向を優先する。半音アプローチは短い弱拍の発音だけに適用し、休符を埋めない。

既存version 1の生成器と保存済み音符を保持する。旧sessionを読み込んだだけでは音符を変更せず、「旋律を再生成」または密度・動き・音域・Seed変更でversion 2へ移行する。同じversion・Seed・設定・進行からは同じ音符列を再現する。

### 2つの動作モード

**Timeline mode**：次の和音が分かるため、小節末のapproachや解決先を先読みして生成。seedを保存し同じ旋律を再演できる。Regenerate melodyは伴奏を変えない。

**Live mode**：ユーザーが次に押すコードは未知。現在の和音＋直前のmotifだけで短く先行生成する。将来和音を知っているかのような解決を約束しない。

- LiveにはImmediate / Next beatの切替。Next beatでは予定和音を表示し、境界前の最後の選択で上書き。
- Immediateは和音を短くcrossfade/releaseし、未発音のmelody予約を取消・再生成する。現在の旋律音は短くreleaseする等、決まった規則で処理。
- Next beatは伴奏と旋律の文脈を同じ境界で変更。
- Recordは実際に適用されたbeatとdurationを記録し、クリック時刻との差を混同しない。
- Liveからtimeline playbackへ切り替えるときは一方を止める。2つのtransportを重ねない。

操作：Melody on/off、density、音域、activity、音量、motif保持、seed。表示はpiano rollを先行し、五線譜は後回し。鍵盤上で伴奏とmelodyを別表示。

受入条件：和音を変更すると古い旋律が遅れて鳴らず、新しいchord toneへ追従する。Stopで両partが停止。乱数seedを固定した回帰検証が可能。

## 11. Listen / Passive Learning / Ear（P5）

日常の聞き流しでコード名と音を対応づける。コード辞典の「聞き流し」から専用sceneへ入る。

2026-09-17の合意により、**既定20分のセットを事前生成し、同じセットを繰り返す**方式を採用。ブラウザのライブ読み上げを繰り返す旧案に代え、同梱の日本語音声（VOICEVOX Nemo 女声1、コード名全体を一続きで合成）とPianoを1本の音声へまとめ、通常のaudio要素で画面オフ再生を目指す。

| モード | 選曲・案内 |
| --- | --- |
| 根音固定 | 指定root × 選択したquality。名前と音を対応づける |
| 調の感覚 | 指定調の7和音。名前とdegreeを読み、開始時と12和音ごとに主和音で基準を確認 |
| 完全ランダム | 12 pitch classes × 選択したqualityを独立抽選。同じ和音の連続も許可 |
| 調内・音だけ | 指定調の7和音をランダムに流す。読み上げと基準和音の割込みなし |

名前を使うモードはName → SoundとSound → Delay → Name → Same Soundを選択可能。コード名をそのまま機械に読ませず、root / accidental / qualityの発音辞書からコード名全体を事前合成する。degree / inversionの案内は独立したフレーズとして続ける。字幕、コード、鍵盤、最低音は同一cueから導出。

設定：root / key / quality、三和音／七の和音、転回、和音2 / 3 / 4 / 6秒、間隔0.5 / 1 / 2 / 3秒、セット5 / 10 / 20分。生成ごとに新しいSeed。反復オンなら同じセットをループし、オフならセット末尾で終了。日本語音声・Pianoを提供し、英語音声・声の切替・quizは後続。

### 事前生成と再生の同期

- 名前と和音を1本の22,050 Hz mono PCM16 WAVへ合成。短い和音を順次生成し、キャッシュに上限を設ける。
- 20分の長さを守り、最後の名前・和音を途中で切らない。末尾の端数は無音。
- 作成中は進捗とキャンセルを表示。完成後のユーザー操作で再生を開始。
- Stopとscene離脱で作成ジョブを破棄し、古い非同期完了は反映しない。URL、native audio、OSメディア操作を適切に解放。
- 背景で和音・speechの予約を継続する必要がない構成。聞き流しのaudioを通常演奏のvisibility pauseに接続しない。
- currentTimeで字幕と鍵盤を更新。Pause、シーク、ループ、復帰後も同じcueを表示。
- Media Sessionでロック画面／イヤホン操作に対応する。対応可否はfeature detectionし、実機で画面ロック・長時間反復・通話割込みを確認する。
- 音声取得失敗は成功表示しない。調内・音だけでは読み上げ音声を取得しない。
- 設定は進行とは独立保存。WAVダウンロードに著作者とライセンスを付記。

### Quizの段階的追加

1. major/minor。
2. seventh quality。
3. root position vs inversion。
4. exact inversion。

答えは再生したVoicingから求める。同じ音高・音色に頼る暗記を避けるためrootやregisterを制御して変える。ただし転回問題では実際のbassを聴き取れる配置にする。

絶対的なroot名の同定とquality/degreeの相対聴音は異なる。Roman問題はkeyやtonic referenceを先に提示し、quality問題は必要に応じrootを変えても答えが変わらない設計にする。

## 12. 音色と再生エンジン

first commitはSoft synth、次にElectric piano風／Pad、licenseが明確なsampleを同梱できればPianoを追加。sampleが必要なら許諾・容量・出典をREADME等に記録する。外部CDNに初回の発音を依存させない。

- master、chord、melodyのgainを分離。polyphony制限、適度なheadroom、短いenvelope、必要ならlimiterを使用。
- 同時発音から開始し、arpeggio/strumは後から追加。random timingでUIと発音の同期を壊さない。
- musical timeはbeat、発音予約はAudioContext/Toneのclockに変換する。setInterval自体を音の正確な時刻としない。
- lookahead schedulerが短い未来を予約し、UIの描画は同じevent/timeに追従する。
- tempo変更はbeat位置を維持し、予約範囲外の未来に反映。再予約する場合は古い予約を確実に取り消す。
- engine APIの目安：unlock、audition、play、pause、stop、setTempo、setGains、dispose。
- stopはscheduler、voice、speech、UI pendingをまとめて終了。disposeはevent listenerも除去。
- 音源load失敗はfallback synthと再試行を提供し、無音のまま成功表示しない。
- AudioContextのsuspended/interrupted状態をUIへ通知する。React再renderで音声graphを作り直さない。

## 13. データモデルと責務境界

これは概念上の契約であり、下記の全型を空実装で初日から作る必要はない。

| 概念 | 主な内容 |
| --- | --- |
| SpelledPitch | letter、accidental、pitchClass。octave付き実音とは分離 |
| KeyContext | tonicの綴り、mode、scale variant |
| Chord | root、quality、intervals、任意のalterations。octaveを持たない |
| BassConstraint | auto / chord-member index / explicit bass pitch class |
| Voicing | MIDI notes、声部ID、実際のbass、使った構成音と省略、決定方式 |
| HarmonicAnalysis | degree、alteration、quality、appliedTo、機能候補、説明の根拠 |
| ChordEvent | id、beat/duration、Chord、bass制約、voicing policy、key context参照 |
| KeyEvent | beat、新KeyContext、bridge内での意図 |
| MelodyEvent | beat/duration、MIDI、velocity、役割と解決先 |
| Session | schemaVersion、tempo、meter、events、key events、設定、seed群 |
| PlaybackPlan | 確定したnotesと時刻、表示情報。Sessionから派生し再利用可能 |

数値例：C4=60とする。pitch class=0だけではC4なのかC3なのかは分からない。表示用symbolの文字列parseを全処理の中心にしない。

流れ：UI action → session reducer → music/analysis/voicingの純粋関数 → playback plan → audio scheduler。鍵盤やtimelineも同じplanから描画する。

乱数は注入可能なseeded RNG。audio singleton、日時、DOM、localStorageをmusic層へ持ち込まない。イベント編集で派生情報の更新が必要になったらrevisionを進め、古い計画と混ぜない。

## 14. 実装段階と完了判定

| 段階 | 実装内容 | 使える状態の判定 |
| --- | --- | --- |
| P0 / first commit | 開発基盤、CI、Pages、C majorの発音 | clean build、サブパス表示、開始と停止 |
| P1 / Playground | 全調、outside、timeline、基本辞典、転回、smooth、保存 | 自分で進行を作り、配置を比較し、保存・再生できる |
| P2 / Auto | Pop/Jazzの生成、分析、辞典拡張 | seed再現、編集可能、和音と解説が一致 |
| P3 / Circle | 五度圏、共通和音、転調bridge | key changeが音と同期し、旧新分析を表示 |
| P4 / Melody | timeline旋律とLive追従、piano roll | 手弾きの和音変更に追従し古い予約が残らない |
| P5 / Listen | 名前→音、音→名前、転回、quiz | speech失敗・Stop・復帰でも進行が破綻しない |

基本辞典と転回は後付け扱いにせずP1に入れる。まずP1を実用的に完成させる。P2–P5は同じモデルを使って追加する。

## 15. 検証の重点

### 楽理と音の一貫性

- C major / F major / F♯ major / A minorの綴り・構成音。
- C7とCM7、Cadd9とC9、Bm7♭5とB°7の区別。
- C/E、C/G、G7/Fの実音bassと表示。
- 手動転回がautoに上書きされない。
- 独立bassを追加してもsymbolが実際の最低音と一致。
- 転回だけを変えたA/Bでchordの構成が変わらない。
- 移調で相対進行を保ち、key切替だけでは既存音高が変わらない。

### 時刻制御

fake clockとscheduler adapterでStop後の未発音イベント、Pause/Resume、tempo変更、loop境界、古いspeech callbackを検証する。大部分のUI snapshotを量産するより、音が残る条件とデータ不整合を重点的に潰す。

### ブラウザでの確認

主要操作のE2E、サブパス配信、desktop/mobile、keyboard navigationを確認。実機でChrome系・Firefox・Safariを確認し、とくにSafari/iOSの音声開始と復帰、voice取得は手動確認事項とする。headlessで聴感の自然さを検証済みとはしない。

### 聴感チェック

C→G→Am→Fのroot/smooth比較、C→A7→Dm→G7、C→Fm→C、C major→G majorのbridgeを聴く。連打時のclick、音量差、低域の濁り、メロディの単調さを確認し、最適化scoreだけで品質を判断しない。

## 16. 初期版の完成像

ユーザーが調を選び、和音を押し、転回やbassを変え、その進行を繰り返し聴ける。表示が実際の音に忠実で、調外の音も自由に試せる。その上に進行生成、五度圏の移動、旋律、聞き流しを順に積み上げる。

優先順位は **操作してすぐ鳴ること → 音と表示の整合性 → 学習上の説明 → 生成の高度さ** とする。
