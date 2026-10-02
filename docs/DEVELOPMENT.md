# Chordscapeの開発と公開

コマンドはリポジトリのルートで実行します。

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
| `npm run model:test`                      | 学習済みTransformerのローカル確認画面   |
| `npm run typecheck`                       | strict型検査                            |
| `npm run lint` / `npm run lint:fix`       | ESLint検査 / 修正                       |
| `npm run format:check` / `npm run format` | Prettier検査 / 修正                     |
| `npm run test`                            | 楽理などの単体テスト（1回）             |
| `npm run test:e2e`                        | production buildのPlaywright検証        |
| `npm run build`                           | `dist`へビルド                          |
| `npm run preview`                         | production buildの確認                  |
| `npm run check`                           | 型・lint・format・unit・buildを順次検証 |

E2Eの前に `npm run build` が必要。Linux CIでは `npx playwright install --with-deps chromium` を使用します。

学習済みモデルの対話確認には `harmony_model/.venv` と完了runが必要です。
`npm run model:test` の起動後、`http://127.0.0.1:5173/model-test.html` を開きます。
この画面は開発時専用で、GitHub Pagesには含まれません。詳細は
[Harmony Model](../harmony_model/README.md#学習済みモデルのローカル確認画面) を参照してください。

```sh
VITE_BASE_PATH=/chordscape-smoke/ npm run build
VITE_BASE_PATH=/chordscape-smoke/ npm run test:e2e
```

## Pages

`ci.yml` はPRとmainでcheckとroot / subpathのE2Eを実行。`pages.yml` はmainだけでcheck・E2Eを通した同じ `dist` を公開します。PATは不要です。

Settings → Pages → Source は **GitHub Actions** に設定済みです。別のリポジトリで使う場合も同じ設定にしてください。公開範囲は変更しません。

baseは `GITHUB_REPOSITORY` から導出します。`<owner>/<owner>.github.io` または `public/CNAME` があれば `/`。custom domainなどでは repository variable **PAGES_BASE_PATH** に `/` 等を設定して上書きできます。ローカルは `/`、手動指定は `VITE_BASE_PATH`。assetはVite経由で解決し、history routerは使用しません。

## 名前音声の再生成

再生成には公式 **VOICEVOX Nemo Engine 0.24.0**、Python 3、ffmpegを使用します。エンジンをローカルのポート50131で起動し、`node scripts/generate-listen-speech.mjs` を実行します。別ポートは `NEMO_URL=http://127.0.0.1:ポート番号` で指定できます。同じフレーズ・ハッシュの既存ファイルは再利用します。これらは開発時だけ必要で、Webアプリは音声モデルや外部の生成サービスを必要としません。

## 関連資料

- [機能・実装仕様](PRODUCT_SPEC.md)
- [検証記録](VALIDATION.md)
- [初回構築](FIRST_COMMIT.md)

互換性・API確認元: [Vite](https://vite.dev/guide/)、[Tone.js 15.1.22](https://tonejs.github.io/docs/15.1.22/classes/PolySynth.html)、[Playwright](https://playwright.dev/docs/intro)、[configure-pages](https://github.com/actions/configure-pages)、[upload-pages-artifact](https://github.com/actions/upload-pages-artifact)、[deploy-pages](https://github.com/actions/deploy-pages)。パッケージはnpm公式registry、Pages Actionsは公式release tagのcommit SHAを照合しています（2026-09-16）。

## サイトマップ

`public/sitemap.xml` はビルド時に `dist/sitemap.xml` へコピーされ、
`https://d1ssk.github.io/chordscape/sitemap.xml` で公開します。
単一ページアプリの入口 `https://d1ssk.github.io/chordscape/` のみを掲載します。
タブ・演奏状態・開発用ページ・音声確認ツールは掲載しません。
独立した公開ページを追加したときは、このファイルも更新してください。
内容の更新日としてビルド日時を付けないため、`lastmod` は省略しています。

Search Console はホスト全体の `https://d1ssk.github.io/` プロパティを使い、
ホスト側の `sitemap-index.xml` からこのサイトマップを参照します。
個別の所有権確認やサイトマップ送信は不要です。
