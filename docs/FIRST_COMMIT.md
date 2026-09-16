# Chordscape — first commit と初期開発の指示

この文書は、対象GitHub repositoryで作業するCodexへの実行指示である。まず `AGENTS.md`、次に `docs/PRODUCT_SPEC.md` を読み、以下を実装する。設計提案だけで終了せず、動作する最小構成と検証結果を残す。

## 1. 今回の到達点

最初のcommitは **再現可能な開発・検証・Pages公開の基盤 + 実際に音が出る小さな縦断実装** にする。全機能を一度に作らない。

実装するもの：

- React + TypeScript strict + Viteの静的アプリ。
- Chordscapeのタイトル、簡潔な説明、音声開始、音量、Stop。
- C majorの7三和音ボタン（C / Dm / Em / F / G / Am / Bdim）。
- 選択コードの名前・ローマ数字・構成音、実際に鳴るMIDI音に対応した簡易鍵盤。
- ボタンからTone.jsのpolyphonic synthを鳴らす。最初はroot position、メロディなし。
- narrow screenで崩れないレイアウトと日本語／英語切替の基盤。
- npm scripts、lockfile、最小限の楽理テストとbrowser smoke test。
- PR検証とmain向けPages公開workflow、README。

転回・進行編集・自動生成等は次のcommitで実装する。未実装機能をクリック可能にしない。

## 2. 開始前

1. 作業ディレクトリ、git status、既存ファイル、branch、remoteを確認する。空repositoryを想定するが、既存コードやユーザーの変更を消さない。
2. この3文書を所定位置に保持する。既存のAGENTS.mdがあれば適切に統合する。
3. Nodeは実装時にVite等が対応しているLTSから1系列を選び、`.nvmrc`、package.jsonのengines、CIを合わせる。採用版をREADMEに記録する。
4. packageは実装時の公式情報で互換性を確認し、実在する安定版を導入。package-lock.jsonをcommitする。ドキュメント中の古いAPIを推測で呼ばない。
5. repository名はremoteまたはGitHub環境から求める。`chordscape`という名前をURLに決め打ちしない。

## 3. スタックとディレクトリ

- UI: React、TypeScript、Vite、通常のCSS。初期段階で巨大なUIライブラリは不要。
- Audio: Tone.jsを薄いadapterで包む。UIからToneのsingletonを直接操作しない。
- 楽理: 自前の小さな純粋関数を基本とし、必要ならTonal等を内部adapter経由で使用。
- State: React reducer/context程度から開始。音声インスタンスをReact stateに格納しない。
- Test: Vitest、必要なDOM testing tools、Playwright。
- ESLintとformatterを導入し、自動修正と検査を分ける。

配置の目安（空ファイルの大量作成は不要）：

```text
AGENTS.md
README.md
docs/FIRST_COMMIT.md
docs/PRODUCT_SPEC.md
.github/workflows/ci.yml
.github/workflows/pages.yml
src/app/
src/components/
src/music/       # 音名・和音・調・分析・voicing・生成の純粋関数
src/audio/       # engine、scheduler、後にspeech
src/state/
src/i18n/
src/styles/
public/
tests/e2e/
```

## 4. npmコマンド契約

次を実装しREADMEに記載する。

| コマンド | 用途 |
| --- | --- |
| `npm ci` | lockfileから再現可能に導入 |
| `npm run dev` | 開発サーバー |
| `npm run typecheck` | emitなしの型検査 |
| `npm run lint` | lint検査 |
| `npm run format:check` | formatting検査 |
| `npm run format` | formatting修正 |
| `npm run test` | unit/componentを一度だけ実行 |
| `npm run test:e2e` | Playwright smoke test |
| `npm run build` | production build、dist出力 |
| `npm run preview` | distをローカル確認 |
| `npm run check` | typecheck、lint、format:check、test、buildを順に実行 |

`check`はE2Eを含めなくてよい。CIではcheckとE2Eを別々に必須実行する。初回のPlaywright browser installation手順も記す。

## 5. PagesとCI

### base path

Viteのbaseは環境変数 `VITE_BASE_PATH` で指定可能にする。通常のローカル開発は `/`、project Pagesは `/<実際のrepository名>/`。user/organization Pagesおよびcustom domainでは `/`。

CIでGitHubのrepository情報からproject用baseを導出し、root Pagesの場合を判定する。custom domain用のrepository variable等による明示overrideも用意する。既存のCNAMEがあれば尊重する。

asset参照はimportまたは `import.meta.env.BASE_URL` を使う。初期版は単一画面のタブ切替にしてhistory routerを使わない。将来URL状態が必要ならhashベースを優先する。

### ci.yml

- pull_requestとmainへのpushで検証する。
- 必要権限はcontents: read。PRで公開はしない。
- checkout → 固定Node設定 → npm ci → npm run check → Playwright browser導入 → E2E。
- E2Eにはproduction buildを使用し、`/`だけでなく `/chordscape-smoke/` のようなサブパス配信を検証する。
- browserからJS/CSSの読込失敗やpage errorを検出する。失敗時は診断用artifactを残す。

### pages.yml

- mainへのpushとworkflow_dispatchで起動。手動起動もmainのみ公開可能にする。
- build jobで同じcheckとsmoke testを通した `dist` を公開artifactにする。別途未検証のbuildを公開しない。
- GitHub公式のconfigure-pages、upload-pages-artifact、deploy-pagesを利用する。実装時点の公式READMEで対応するversionを確認し、既存projectの方針がなければ検証したreleaseのcommit SHAで固定、versionをコメントする。
- deploy jobはbuild job成功後のみ、github-pages environmentを使用。contents: read、pages: write、id-token: writeを必要なjobに限って付与する。
- 公開workflowのconcurrency groupを設定し、同時deployを避ける。
- Personal Access Tokenは不要。artifactは `dist` のみ。node_modulesやsource treeを公開artifactに入れない。

Settings → Pages → SourceをGitHub Actionsにする操作が必要なら、権限がある環境では既存設定を確認して実施し、権限がなければREADMEと完了報告に1行の手順を残す。repositoryの公開範囲を勝手に変更しない。

## 6. 音声の縦断実装

- `Enable audio / 音声を開始` を押してcontextをresumeする。ページ読込時に鳴らさない。
- 短いattack/release付きの控えめな音量。連打で無制限にvoiceを増やさない。
- 第一段階は三和音を約1秒鳴らす。コードを替えたら前の和音をreleaseして新しい和音へ移る。
- Stopで全voiceと予約を停止。音声状態を表示し、開始失敗時は再試行できる。
- React StrictModeでもengineやlistenerが二重生成されず、unmountで解放する。
- C majorを丸ごとUIにハードコードせず、純粋関数で調から和音を導出する。
- synthをPianoと偽らない。初期音色名は `Soft synth` 等とする。

## 7. first commitの受入条件

- clean installからcheckが成功し、dev / previewで画面が開く。
- C, Dm, Em, F, G, Am, Bdimの構成音とローマ数字が正しい。
- 初回操作後に音が出る。Stopと連打が破綻せず、鍵盤が実際の発音と一致する。
- unit testは少なくともC majorの7和音とBdimの構成音を確認。
- E2Eはaudio開始、コード選択、表示変化、Stopとサブパス読込を確認。mockのみで実音確認済みとしない。
- 実際に試聴できない実行環境なら音声処理とイベントの検証までとし、未実施の聴感確認を正直に記す。
- desktop / mobile幅で表示し、キーボードで主要ボタンを操作できる。
- READMEにセットアップ、command、Pages設定、実装範囲、次の段階を記す。

以上を満たしたら `chore: bootstrap Chordscape with audio scaffold and Pages CI` 等で最初のcommitを作る。commit identityを偽造しない。remoteがなければローカルまで完了し、未設定を報告する。push・PR等はその実行環境で与えられた依頼に従う。

## 8. 続けて行う初期開発

first commitのあと、PRODUCT_SPECのP1を小さなcommitに分けて進める。

1. 全調の選択、major/natural minor、三和音/七の和音、outside key。
2. 即時演奏、記録、timeline編集、ループ再生、local保存。
3. 手動転回、root/smooth voicing、slash表示、bassの可視化。
4. コード辞典と基本解説、表示・音・保存の整合性を確認。

P1完了で一度使える状態を確保する。P2以降は仕様を保ったまま順次追加し、初回commitに押し込まない。

## 9. 実装時に参照する公式資料

公開構成の確認日：2026-09-16。version番号は実装時に再確認する。

- [Vite: Static deploy / GitHub Pages](https://vite.dev/guide/static-deploy.html#github-pages)
- [GitHub: Custom workflows with Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)
- [Tone.js](https://tonejs.github.io/)
- [Playwright](https://playwright.dev/docs/intro)
