# Chordscape

ブラウザで和声を探索・演奏・学習する静的アプリ。GitHubで開発しGitHub Pagesで公開する。

- 初回構築は `docs/FIRST_COMMIT.md`。機能・データ設計・段階別受入条件は `docs/PRODUCT_SPEC.md` の該当箇所を読む。
- TypeScript strict + React + Vite、npm、Tone.js。バックエンド・外部生成AI・認証は不要。
- 楽理／生成は純粋関数、音声は独立サービス、UIは状態の表示と操作に分離する。
- Chord／Inversion／Voicing／実際の最低音を区別する。音名の綴りとpitch classを混同しない。
- コード名・ローマ数字・鍵盤・bass・解説は同じ演奏イベントから導出する。分析は文脈依存で、推測を断定しない。
- 音声はユーザー操作で開始。Audio clockで予約し、Stopで予約・発音・読み上げを確実に止める。
- Pagesのサブパスに対応。音源等の絶対ルートパスを禁止。秘密情報・node_modules・distはcommitしない。
- 日本語を初期表示。UI文字列は翻訳辞書へ集約。鍵盤操作、フォーカス、色以外の識別も実装する。
- 変更に必要な検証を実施。commit前に `npm run check`。楽理・時刻制御の重要な境界と主要操作をテストする。
- 実装済み範囲と未実装を明記し、未実装ボタンで完成を装わない。既存変更は保持。実施した検証と制約を報告する。
