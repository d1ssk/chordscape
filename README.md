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

## P1でできること

- 長調15調・自然短調15調（異名同音を含む）、三和音／七の和音。F majorのB♭、F♯ majorのE♯など調に沿って綴ります。
- 調外パレット：セカンダリードミナント、同主調からの借用、短調の導音。分析は候補・変化音・解決先を示し、実際に続く和音との関係も説明します。
- 即時試聴、記録オン／オフ、進行の選択・複製・削除・drag／移動ボタン・長さ変更・全消去、Undo/Redo（直近50編集）。
- Play / Pause / Resume / Stop、40–200 BPM、ループ、拍位置・発音中／次の和音。音色は外部サンプル不要の **Soft synth**。
- 構成音bassの手動指定、slash表示と転回数字、実音MIDI鍵盤、根音／bassの別表示。Root position / Smoothと同じ進行でのA/B試聴。
- 11種類の基本コード辞典。root／familyで選び、構成音・音程・現れる調を確認。「試聴」と「進行へ追加」を区別します。
- ブラウザへの自動保存、schemaVersion付きJSONの書出し／検証付き読込、全体移調。日本語／英語、desktop／mobile、キーボード操作。

### 最初の操作

1. 「音声を開始」→ C、G、Am、Fを押します。初期は記録オン、1イベント4拍、90 BPMです。
2. 「再生」で進行を聴きます。「停止」は予約とvoiceを止めて先頭へ戻します。「一時停止」→「再開」は保持した拍から再発音します。
3. 停止中にイベントを選び、転回や長さを編集します。「配置」のSmoothで進行を再計算するか、A/Bボタンで保存データを変えずに比較します。
4. 「JSONを書き出す」でブラウザ外にも保存できます。

再生中はパレットが無効です。ループ編集は次の未予約の周回へ反映され、現在の周回は変えません（予約窓120ms）。一時停止中に進行自体を編集した場合は停止状態に戻り、編集済み進行を先頭から再生します。テンポ変更は拍を保って短く再発音します。タブ非表示やAudioContext中断時は一時停止し、復帰後にユーザーが再開します。

調選択は次の和音の文脈を変え、既存の音高とイベントの調は保持します。「進行全体を移調」は全イベントと各調を同じ半音差で移します。独立した転調境界の編集はP3の範囲です。

### 保存・配置の仕様

`src/music` は楽理・分析・配置の純粋関数、`src/state` は履歴とsession検証、`src/audio` はTone adapterと注入可能な時計のscheduler、UIは同じイベントのnotesから表示します。実音の構成音は省略・重複しません。

sessionは `schemaVersion: 1`、設定と安定ID付きイベント（Chord、調、duration、bass制約、policy、確定MIDI notes）を保持します。JSONは1MB・256イベント、40–200 BPM、0.25–16拍、音高とbassの整合性を検査します。無効／旧schemaは変更を加えず拒否します。400msのdebounce保存が失敗しても演奏と書出しを続けられます。

Smoothはオンラインでは直前配置から選び、進行への適用とA/Bでは動的計画法で選びます。冒頭は中央寄りの基本形、同点は固定順序。声部の挿入／削除、移動・跳躍、bass、低域密集、共通MIDI保持、ループ末尾→先頭を評価します。手動bass制約は全モードで優先します。これは定義したコスト内での最適化で、聴感上の唯一の正解ではありません。

### 実装外と手動確認

P2–P5の自動生成、拡張コード（add9 / 9等）、五度圏・転調bridge、旋律、読み上げ・quizは未実装です。非構成音bass、独立bassパート、Pianoサンプル、音声書出しも提供していません。

Playwrightは実際のWeb Audioの出力波形とStop後の無音を検査します。聴感を確認したとは扱いません。Chrome / Firefox / Safari・iOS実機での聴感、音量差、連打時のclickや低域の濁りは手動確認事項です。実施した検証は [VALIDATION.md](docs/VALIDATION.md) に記載します。

設計: [PRODUCT_SPEC](docs/PRODUCT_SPEC.md)、初回実装: [FIRST_COMMIT](docs/FIRST_COMMIT.md)。

互換性・API確認元: [Vite](https://vite.dev/guide/)、[Tone.js 15.1.22](https://tonejs.github.io/docs/15.1.22/classes/PolySynth.html)、[Playwright](https://playwright.dev/docs/intro)、[configure-pages](https://github.com/actions/configure-pages)、[upload-pages-artifact](https://github.com/actions/upload-pages-artifact)、[deploy-pages](https://github.com/actions/deploy-pages)。パッケージはnpm公式registry、Pages Actionsは公式release tagのcommit SHAを照合しています（2026-09-16）。
