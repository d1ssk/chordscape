# Chordscape

和音を押して、響きと構成音を探索する静的アプリ。
An interactive playground for learning chords, progressions, voicings, and modulation through sound and visualization.

## 開発

Node **22 LTS (22.13以上、23未満)** と npm を使用。`.nvmrc`、engines、CIを22系に統一しています。

```sh
nvm use
npm ci
npx playwright install chromium
npm run dev
```

| コマンド                                  | 用途                                    |
| ----------------------------------------- | --------------------------------------- |
| `npm ci`                                  | lockfileから導入                        |
| `npm run dev`                             | 開発サーバー                            |
| `npm run typecheck`                       | strict型検査                            |
| `npm run lint` / `npm run lint:fix`       | ESLint検査 / 修正                       |
| `npm run format:check` / `npm run format` | Prettier検査 / 修正                     |
| `npm run test`                            | 楽理などの単体テスト（1回）             |
| `npm run test:e2e`                        | production buildのPlaywright検証        |
| `npm run build`                           | `dist`へビルド                          |
| `npm run preview`                         | production buildの確認                  |
| `npm run check`                           | 型・lint・format・unit・buildを順次検証 |

E2Eの前に `npm run build` が必要。Linux CIでは `npx playwright install --with-deps chromium` を使用します。

```sh
VITE_BASE_PATH=/chordscape-smoke/ npm run build
VITE_BASE_PATH=/chordscape-smoke/ npm run test:e2e
```

## Pages

`ci.yml` はPRとmainでcheckとroot / subpathのE2Eを実行。`pages.yml` はmainだけでcheck・E2Eを通した同じ `dist` を公開します。PATは不要です。

Settings → Pages → Source は **GitHub Actions** に設定済みです。別のリポジトリで使う場合も同じ設定にしてください。公開範囲は変更しません。

baseは `GITHUB_REPOSITORY` から導出します。`<owner>/<owner>.github.io` または `public/CNAME` があれば `/`。custom domainなどでは repository variable **PAGES_BASE_PATH** に `/` 等を設定して上書きできます。ローカルは `/`、手動指定は `VITE_BASE_PATH`。assetはVite経由で解決し、history routerは使用しません。

## P1 / P2でできること

- 長調15調・自然短調15調（異名同音を含む）、三和音／七の和音。F majorのB♭、F♯ majorのE♯など調に沿って綴ります。
- 調外パレット：セカンダリードミナント、同主調からの借用、短調の導音。分析は候補・変化音・解決先を示し、実際に続く和音との関係も説明します。
- 即時試聴、記録オン／オフ、進行の選択・複製・削除・drag／移動ボタン・長さ変更・全消去、Undo/Redo（直近50編集）。
- Play / Pause / Resume / Stop、40–200 BPM、ループ、拍位置・発音中／次の和音。**Electric piano**（初期設定）、**Pad**、**Piano**、**Soft synth**の4音色。
- 構成音bassの手動指定、slash表示と転回数字、実音MIDI鍵盤、根音／bassの別表示。Root position / Smoothと同じ進行でのA/B試聴。
- 17種類のコード辞典。基本11種類に6 / m6 / add9 / 9 / maj9 / m9を追加。root／familyで選び、構成音・音程・現れる調を確認。「試聴」と「進行へ追加」を区別します。
- ブラウザへの自動保存、schemaVersion付きJSONの書出し／検証付き読込、全体移調。日本語／英語、desktop／mobile、キーボード操作。
- 下部ナビゲーションで「演奏」「進行生成」「コード辞典」「設定」を切り替えます。ブラウザの戻る操作にも対応。モバイルの演奏画面は7つのダイアトニックコードを常に横1列にし、鍵盤と進行を近くに配置しています。
- Pop / Jazzの進行生成、seedの指定・保存、フレーズごとの連続生成。生成後の編集、再生成のUndo/Redo、生成意図と実際の前後関係の解説。

### 最初の操作

1. 「音声を開始」→ C、G、Am、Fを押します。初期は記録オン、1イベント4拍、90 BPMです。
2. 「再生」で進行を聴きます。「停止」は予約とvoiceを止めて先頭へ戻します。「一時停止」→「再開」は保持した拍から再発音します。
3. 停止中にイベントを選び、転回を変更します。長さなどは「選択イベントの編集」、配置とA/B試聴は進行の「配置・移調」を開きます。
4. 「コード辞典」で和音を選んで試聴できます。「進行へ追加」で演奏画面に戻ります。
5. 「設定」で音色・音量・言語を選び、JSONの書出し／読込を行います。画面右上の音色名からも設定を開けます。
6. 「進行生成」でPop / Jazzを選び「生成する」を押すと、編集可能な進行に置き換わります。生成そのものは音声開始前でも利用できます。

再生中はパレットが無効です。ループ編集は次の未予約の周回へ反映され、現在の周回は変えません（予約窓120ms）。一時停止中に進行自体を編集した場合は停止状態に戻り、編集済み進行を先頭から再生します。テンポ変更は拍を保って短く再発音します。タブ非表示やAudioContext中断時は一時停止し、復帰後にユーザーが再開します。

調選択は次の和音の文脈を変え、既存の音高とイベントの調は保持します。「進行全体を移調」は全イベントと各調を同じ半音差で移します。独立した転調境界の編集はP3の範囲です。

### 保存・配置の仕様

`src/music` は楽理・分析・配置の純粋関数、`src/state` は履歴とsession検証、`src/audio` はTone adapterと注入可能な時計のscheduler、UIは同じイベントのnotesから表示します。実音の構成音は省略・重複しません。

sessionは `schemaVersion: 2`、設定と安定ID付きイベント（Chord、調、duration、bass制約、policy、確定MIDI notes、任意の生成意図）、生成時の設定・seed・フレーズ番号・編集済みフラグを保持します。JSONは1MB・256イベント、40–200 BPM、0.25–16拍、音高とbass・生成意図の整合性を検査します。未編集の生成結果はseedから再現した内容とも照合します。無効／未知schemaは変更を加えず拒否します。400msのdebounce保存が失敗しても演奏と書出しを続けられます。

既存のschemaVersion 1は確定MIDI・音色・設定を保持して2へ移行します。音色フィールドがなければElectric pianoを補います。localStorageは `chordscape.session.v2` を優先し、なければ旧 `chordscape.session.v1` を移行して利用します。旧保存データは削除しません。

Smoothはオンラインでは直前配置から選び、進行への適用とA/Bでは動的計画法で選びます。冒頭は中央寄りの基本形、同点は固定順序。声部の挿入／削除、移動・跳躍、bass、低域密集、共通MIDI保持、ループ末尾→先頭を評価します。手動bass制約は全モードで優先します。これは定義したコスト内での最適化で、聴感上の唯一の正解ではありません。

### P2の進行生成

入力は調、Pop / Jazz、4 / 8 / 16小節、2 / 4 / 8拍ごとの和音変更、三和音／七の和音、調外和音の確率、終止／ループ、配置、32-bit seedです。Popは短い定番型、Jazzはii–V–I・ターンアラウンドを使い、前のフレーズ末尾からの機能の移行に重みを付けます。終止は主和音、ループは冒頭の主和音へつながるIVまたはV（JazzはV）で終えます。I–V–vi–IVもそのままループできます。調外0%の短調では自然短音階のvを保持します。

調外の確率は候補位置で置換を検討する確率です。解決先を持つsecondary dominantや同主調からの借用を選び、全体に占める調外和音の割合を厳密には指定しません。無限に抽選せず8候補までで既知のパターンへfallbackし、その旨を表示します。4小節・8拍間隔では2和音しかなく、調外和音の挿入余地がないことを表示します。

**C major / Jazz / 4小節 / 4拍間隔 / 七の和音 / 調外100% / ループ / Seed 42**で **Cmaj7 → A7 → Dm7 → G7** を生成できます。表示は **Imaj7 → V7/ii → ii7 → V7**。A7の解決候補に対してDm7が実際に続く場合だけ、その関係を説明します。並べ替え後は現在の並びを再分析し、保存された生成時の意図とは別に表示します。

`src/music/generation.ts` はDOM・時計・音声に依存しない純粋な生成関数です。generator version 1、Mulberry32、seed、設定、フレーズ番号が同じならChord・意図・ID・voicing・notesは同じです。PlayやJSON読込で乱数を引き直しません。移調などで編集した後は「生成後に編集済み」とし、元の生成条件も残します。

「連続生成を開始」は最初と次のフレーズを確定してから再生します。audio clockへの予約では準備済みフレーズを参照し、その次を予約callbackの外で作ります。現在のフレーズを先に書き換えません。Pause / Resumeやテンポ変更で予約を作り直してもフレーズ番号を保ちます。Stop・音色変更・進行編集で連続生成を終了します。

連続生成は現在のフレーズをtimelineと保存データに保持し、過去のフレーズを無制限には蓄積しません。自動切替はUndo履歴を増やさず、開始前の進行へ戻せます。好きなフレーズで一時停止／停止してJSONへ保存できます。準備に失敗した場合は通知し、準備済みの範囲で終了します。

### 拡張和音の表記

Cadd9はC–E–G–D、C9はC–E–G–B♭–D。すべての構成音を省略・重複せず発音し、9thを最低音にする配置にも対応します。6 / m6 / add9 / 9 / maj9 / m9は古典的転回数字を付けず和音の種類を保ち、付加6度を含むローマ数字は `I(add6)` のように区別します。実際の最低音はslash名・bass表示・鍵盤で確認できます。

表記の確認元: [Open Music Theory: Chord Symbols](https://viva.pressbooks.pub/openmusictheory/chapter/chord-symbols/)、[Tonicization](https://viva.pressbooks.pub/openmusictheory/chapter/tonicization/)。

### 音色・サンプル

Electric pianoは減衰するFM音源、Padは緩やかな立ち上がりの倍音合成、Soft synthは控えめな倍音合成です。発音ごとの軽量なWeb Audio voiceをToneの時計で予約し、35 Hzのhigh-pass、gain envelope、limiterを通します。Stopは発音前の予約を取り消し、発音中は18msで減衰させます。音色を変更すると演奏を停止します。

PianoはAlexander Holm作 **Salamander Grand Piano / CC BY 3.0**の17サンプル（C2–C6、約1.25 MB）を同梱しています。初めて選んだときだけアプリのサブパスから読み込み、外部CDNには接続しません。読込失敗時はElectric pianoに戻して再試行を表示します。出典、変更の有無、原文の著作者表記、ライセンス全文、ファイルのSHA-256は [同梱音源の帰属表示](public/samples/salamander/ATTRIBUTION.md) にまとめています。

### 実装外と手動確認

P3–P5の五度圏・転調bridge、旋律、読み上げ・quizは未実装です。追加style（Classical-ish / City Pop / Lo-fi / Film）、tritone substitution、和音の省略・重複、非構成音bass、独立bassパート、音声書出し、オフライン起動・ホーム画面へのインストール機能も提供していません。

Playwrightは実際のWeb Audioの出力波形とStop後の無音を検査します。聴感を確認したとは扱いません。Chrome / Firefox / Safari・iOS実機での聴感、音量差、連打時のclickや低域の濁りは手動確認事項です。実施した検証は [VALIDATION.md](docs/VALIDATION.md) に記載します。

設計: [PRODUCT_SPEC](docs/PRODUCT_SPEC.md)、初回実装: [FIRST_COMMIT](docs/FIRST_COMMIT.md)。

互換性・API確認元: [Vite](https://vite.dev/guide/)、[Tone.js 15.1.22](https://tonejs.github.io/docs/15.1.22/classes/PolySynth.html)、[Playwright](https://playwright.dev/docs/intro)、[configure-pages](https://github.com/actions/configure-pages)、[upload-pages-artifact](https://github.com/actions/upload-pages-artifact)、[deploy-pages](https://github.com/actions/deploy-pages)。パッケージはnpm公式registry、Pages Actionsは公式release tagのcommit SHAを照合しています（2026-09-16）。
