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

baseは `GITHUB_REPOSITORY` から導出します。`*.github.io` または `public/CNAME` があれば `/`。custom domainなどでは repository variable **PAGES_BASE_PATH** に `/` 等を設定して上書きできます。ローカルは `/`、手動指定は `VITE_BASE_PATH`。assetはVite経由で解決し、history routerは使用しません。

## 実装範囲と検証

P0: C majorの7三和音、構成音・ローマ数字・実音鍵盤、音声開始・音量・停止、日本語/英語、desktop/mobile、CIとPages。音色はTone.jsの **Soft synth** で外部サンプル不要です。最初の操作でAudioContextを開始し、約1秒発音します。

次の段階はP1（全調、outside、進行編集・保存、転回・smooth、基本辞典）。P2以降の生成、五度圏、旋律、読み上げは未実装です。

Playwrightは実際のWeb Audioを開始し画面とイベントを検証します。headlessで聴感は評価しません。Chrome / Firefox / Safari・iOS実機での聴感、連打時のclickや低域の濁りは手動確認が必要です。

設計: [PRODUCT_SPEC](docs/PRODUCT_SPEC.md)、初回実装: [FIRST_COMMIT](docs/FIRST_COMMIT.md)。

互換性・API確認元: [Vite](https://vite.dev/guide/)、[Tone.js 15.1.22](https://tonejs.github.io/docs/15.1.22/classes/PolySynth.html)、[Playwright](https://playwright.dev/docs/intro)、[configure-pages](https://github.com/actions/configure-pages)、[upload-pages-artifact](https://github.com/actions/upload-pages-artifact)、[deploy-pages](https://github.com/actions/deploy-pages)。パッケージはnpm公式registry、Pages Actionsは公式release tagのcommit SHAを照合しています（2026-09-16）。
