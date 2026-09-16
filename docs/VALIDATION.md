# P0 / P1 検証記録

2026-09-16、macOS arm64 / Node 22.17.1 / npm 10.9.2。

## 自動検証

- P0は `npm ci` のクリーン導入から `npm run check` を実行。C majorの7三和音・Bdimの構成音、本番ビルドのroot/subpathで音声開始・切替・停止を確認して `fd86d9d` に記録。
- P1は `npm run check`（strict型検査、ESLint、Prettier、26 unit tests、production build）。楽理・配置・session・時計・Pages baseを検証。
- Playwright Chromium: 8シナリオ × desktop/mobile = 16 testsを `/` と `/chordscape-smoke/` の各production buildで実行。
- JS/CSSの読込失敗・page error・画面の横方向overflowを検出。desktop/mobileの全画面画像も目視確認。
- `npm run dev -- --port 4175 --strictPort` をChromiumで開き、タイトル表示・page errorなしを確認。
- `git diff --check`、lockfileとenginesの整合性、Pages Actionsの公式release SHAを確認。

## 重点ケース

楽理: C major / F major / F♯ major / A minor、C7とCmaj7、Bm7♭5とBdim7、C/E・C/G・G7/F（V4/2）、Am/Gを三和音の転回として拒否、短調のセカンダリードミナントの♭付き解決先、全調＋調外候補の移調・JSON往復。

配置・保存: 手動bass優先、三和音↔四和音の挿入／削除コスト、ループ境界、決定的な再計算、長さ変更だけでは実音配置を維持、調選択は既存音高を維持、全体移調は各文脈も移動、stable ID、Undo/Redo、JSON不正入力・件数上限・矛盾したnotes/bassを拒否、storage禁止時にも試聴・書出し可能。

再生: 注入した時計でStop・Pause/Resume・テンポ変更・周回編集・短いループ・遅延した時計を検証。Chromiumでは実際のAudioContextと出力波形を使い、発音時に信号があること、Stop後に無音になること、中断時にPauseしてユーザー操作で復帰することを検査。mockのみの確認ではありません。一時停止後の全消去で旧進行を再開しないことも確認。

## 未実施・制約

- 人による試聴は未実施。Root/Smoothの自然さ、click、音量差、低域の濁りについて品質保証はしません。
- 実機Chrome / Firefox / Safari・iOSでの音声開始・中断・復帰、端末固有の音量や背景制限は手動確認事項。
- GitHub上のworkflow実行・Pagesへのデプロイは未実施（pushしていません）。Pages SourceはAPIで `build_type: workflow` に設定済み。公開範囲は変更していません。
- P2–P5は未実装。独立した転調イベント・生成seedは、その機能を追加する段階でschemaを拡張します。

## モバイル画面・音色の改修（2026-09-16）

- 演奏／辞典／設定をhashによる別画面に分割。下部ナビゲーション、ブラウザの戻る、移動後の見出しへのフォーカス、横方向overflowなしを検査。
- モバイル幅320 / 375 / 390pxでダイアトニック7コードが同じ行にあり、鍵盤と進行見出しが高さ812pxの初期画面内にあることを検査。画面画像も目視確認。
- `npm run check`: 28 unit tests。音色の保存・既存sessionの移行・不正値の拒否、同梱サンプルと原文READMEのSHA-256／サイズ一致を追加。
- Playwright: 12シナリオ × desktop/mobile = 24 testsを `/` と `/chordscape-smoke/` の各production buildで実行し、すべて成功。4音色の実際の発音と停止、音色変更による停止、17サンプルのbase付きURL、Piano読込失敗時の代替音色と再試行、遅れて発音しないことを追加。
- Electric / Pad / Softの初回発音は出力波形のピーク、隣接サンプルの差、DC成分、35 Hz未満のスペクトルを検査。発音予約直後のStopでも音と鍵盤表示が残らないことを検査。
- 停止時の既存envelopeの書換えで波形が飛ぶケースをOfflineAudioContextで再現し、独立した停止用gainで18msのfadeを行うよう修正。実際のvoice実装に対し、3音色 × 7停止時点（発音前・attack・decay・release）の波形連続性と停止後の無音を決定的な時計で検査。

### 低域ノイズの調査

旧音源は正弦波ではなくTone.PolySynthのtriangle。ユーザーが報告した強い低周波ノイズはChromiumでは再現できず、原因を断定していません。

ChromiumのOfflineAudioContext（48 kHz）でC3 / E3 / G3を1秒鳴らし、旧音源と新4音色を比較しました。前半0.5秒にHann窓をかけたFFTの35 Hz未満のエネルギー比と、全1.2秒のピークを記録しています。新音源は35 Hz high-passと初期音量0.5を含みます。端末のスピーカー特性を含む測定ではありません。

| 音色                 | 波形ピーク | 35 Hz未満のエネルギー比 |
| -------------------- | ---------: | ----------------------: |
| 旧Soft synth         |      0.131 |               0.000158% |
| Electric piano       |      0.181 |               0.000005% |
| Pad                  |      0.160 |               0.000001% |
| Soft synth（改修後） |      0.152 |               0.000002% |
| Piano                |      0.115 |               0.049165% |

発音開始前の信号はゼロ、波形の飽和はありません。合成音源の超低域成分は減っていますが、これだけで報告された症状の解消や聴感の良さを保証できません。端末・ブラウザ・出力機器を含めた実機試聴は未実施です。

## 構成上の判断

初回から既存の `7298218 Initial commit` があったため履歴を保持しました。P0、楽理・配置、編集・時計、P1画面統合を別コミットにしています。

Loopの次周回は120ms先までの予約時点で固定します。編集中の新データと発音中のsnapshotを分け、Chord detailsは発音中のイベントを優先表示します。Pause中の進行編集は明示的にStopへ戻し、古いsnapshotが再開されるのを防ぎます。
