# Harmonic Space

下部ナビゲーション右端の「和声空間」（`#space`）から開く、演奏・記録とは独立した探索画面。設定はヘッダー右上。

## 操作と表示

- 初期状態はC major / Free。12のmajor tonicとFree / Pop / Jazz / Classicalを選べる。styleは推薦の重みだけを変え、コード集合・位置・履歴・現在の配置は維持する。
- core 14個、near 15個、outer 13個の計42ノード。7三和音の蜂の巣状配置と小さな七の和音satellite、左〜左下のborrowed / minor側、上〜右のsharp / chromatic側を維持。座標は編集上の配置であり、距離は厳密な楽理尺度ではない。
- 調変更は既存の綴り付き移調関数で和音と音高を移す。位置・IDは維持。例えばC majorのA7 / DmはD majorでB7 / Em、F♯ majorの導音の和音はE♯°となる。
- クリックすると既存音源で試聴し、直近6回を無彩色の背景で表示。最新が最も濃く、同じノードを再訪した場合は最新の濃さを使う。現在コードは太字、発音中は内側の枠でも識別する。
- ボタンの凡例はダイアトニック（太枠）、近い調外和音（実線）、さらに外側の色彩（破線）。「提案」「履歴」のチェックは初期オンで、それぞれ候補の枠・haloと灰色の背景を非表示にできる。内部文脈と音のつながりは保持し、オンに戻すと最新の状態を再表示する。
- 次候補は最大6個。解決＝amber、継続＝blue、彩り＝violet、探索＝tealの枠・haloを付け、スコアで強さを変える。履歴の背景と候補の枠は独立して重なる。小さな凡例、tooltip・アクセシブルな説明でも種類を確認できる。
- 「自動voice leading」は初期オン。切替は次のクリックから反映し、現在の音と履歴・候補は保持する。オフでは前後関係に依存せず基本位置（明示的なslash bassは優先）で鳴らす。調変更・リセットでもチェックの選択を保持する。
- 自動voice leadingがオンの場合、最初の和音は基本位置（明示的なslash bassは優先）。以降は直前の実音と上位の次候補を使って転回・octave配置を選ぶ。ノードには和音名、試聴欄には実際の転回を反映したコード名・音名・最低音を同一イベントから表示する。
- 音色・音量は既存画面と共有。演奏画面の調・Record・Smooth・旋律設定は探索へ適用せず、探索の履歴はsessionや保存済み進行へ書き込まない。
- リセットでは発音・準備待ちを停止して履歴・現在コード・推薦・voice-leadingの状態を消す。調とstyleは保持する。
- 調変更では発音と読み込み待ちを止め、履歴・現在コード・推薦・voice-leadingの状態を消す。styleは保持。Stopでは音を止めて探索文脈を保持し、画面を離れるとローカル文脈を破棄する。
- 音源準備待ちのクリックは停止・調変更・画面移動・非表示などで取り消す。受理された試聴だけを履歴へ追加する。
- Tab、方向キー、Enter/Space、フォーカス表示に対応。PCは横長、モバイルは縦長の座標。既存のコンパクトな地図を維持し、320×667pxから全42ノードを初期画面に収める。
- 表示変化は200msのCSS transition。reduced motionを尊重し、音声はアニメーション完了を待たない。edgeやtrailは描画しない。

履歴色は `src/styles/main.css` の `.harmonic-space` 内の `--history-current`（最新）と `--history-1`〜`--history-5`（1〜5回前）で調整する。最新は `#c5c8ca`、古い履歴ほど明るい灰色。文字色は `.space-node[data-history]` に集約している。

## 構造と推薦の方針

- `src/space/layout.ts`: 安定ID、Harmony、bass制約、layer、region、anchor、satelliteOf、PC・モバイル座標。`spaceNodes` が調に応じて和音を移調する。`spaceEvent` はラベル用の基本配置イベントであり、実際の発音配置は別に決定する。
- `src/space/recommendations.ts`: UI・音声から独立した純粋関数。既存の分析を再利用し、key相対のdegree、secondary dominantのtarget、根音間隔、共通音で規則を評価。コード名やlayout IDで楽理を判定しない。基礎遷移・style重み・直近文脈・再訪抑制の寄与を保持し、0〜1のスコアと理由を返す。同根の似た候補が枠を埋めないよう選抜する。
- `src/space/context.ts`: ローカル状態と遷移。内部履歴は最大12、推薦は直近8のうち最大4コードのパターンを評価する。ii–V–I、IV–V–I、IV–iv–I、iii–vi–ii–V–I、I–vi–IV–V、secondary resolution、dominant chainを扱い、三和音と七の和音を同じdegree familyとして認識する。
- `src/space/voicings.ts`: 既存candidate generatorを再利用。転回とoctave配置を変え、MIDI 48〜84（C3〜C6）・最大2 octave幅に制限。明示的なbassと和音の構成音を保持する。
- `src/space/voiceLeading.ts`: 音数が違う場合も順序を保つ対応で、移動量・bass・跳躍・広すぎる間隔を評価し、同じMIDI音の保持を優遇。交差・音域外は除外。推薦上位3和音への最小コストをスコアで重み付けし、係数0.25で加える。候補がなければ直前の配置のみを使う。
- `src/components/HarmonicSpace.tsx`: 描画と操作を担当し、既存のaudio開始・取消・試聴経路に接続。developmentではconsole debugで推薦のscore / type / reasons / contributionsを確認できる。productionでは出力しない。

推薦は探索のためのrule-basedな傾向であり、和音の唯一の機能や次のクリックを断定しない。Classicalも厳密な時代様式モデルではない。先読みは次候補への移動費用だけを評価し、候補を自動再生しない。

## 対象外

minor / modal key、edge・progression trail、tritone substitution専用UI、swap、記録・保存・progression editor・loop・timeline、ML、旋律生成、楽器別配置、drop-2等の配置selector。

## 検証

`src/space/*.test.ts` で42和音・7satellite・綴り・移調の等価性、secondary resolutionと代表的な文脈pattern、style差、候補の件数・スコア、履歴とリセット、声部移動・共通音・音域・bass・先読みを検証。

`tests/e2e/space.spec.ts` はdesktop/mobileで初回発音、停止・画面移動・調変更による待機取消、既存sessionの保持、履歴と候補の重なり、style・key操作、方向キー、配置と全体の可視性を検証する。実施結果は `docs/VALIDATION.md` に記録。

実機Safari/iOSと人による聴感確認は未実施。
