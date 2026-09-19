# 教師データ調査・取得記録

調査日: 2026-09-18。ここでいう「利用可」は、各配布元が表示する条件に基づく技術上の採否であり、法的助言ではない。
公開前には、実際に採用した release、subset、出力物について再確認する。

機械可読な記録は [`catalog.json`](catalog.json) に置く。各項目は少なくとも source、version、URL、license、
download date、conversion notes を持ち、取得物は byte 数と SHA-256 で固定する。

## 結論

| 用途      | 優先候補                   | 現在の扱い         | 理由                                                                 |
| --------- | -------------------------- | ------------------ | -------------------------------------------------------------------- |
| POP       | McGill Billboard 2.0       | 取得済み           | 注釈が明示的な CC0。740 distinct songs の重複管理が必要              |
| POP       | POP909                     | local-only取得済み | MIT 表示と収録曲・編曲データの権利範囲が不明確なため公開には使わない |
| POP       | POP909-CL                  | local-only取得済み | 人手修正版は有用だが、MIT 表示と収録曲・編曲データの権利範囲が不明確 |
| JAZZ      | Weimar Jazz Database 2.1   | 取得済み           | ODbL/DbCL が明示。作品単位の grouping と share-alike 対応が必要      |
| JAZZ      | ChoCo Real Book partition  | 保留               | ChoCo は CC BY とするが、standalone upstream license を確認できない  |
| CLASSICAL | DCML の個別 corpus         | 条件決定後に取得   | meta-repo に単一 license はなく、主要 corpus は CC BY-NC-SA          |
| CLASSICAL | When in Rome の許可 subset | 選択取得済み       | 新規分析179件のみ展開。変換元 analysis と score は個別条件           |
| 横断      | ChoCo 1.0                  | 取得済み           | JAMSだけ展開。元 corpus との重複と subset 別 license は引き続き管理  |

現状の初期構成は **POP = Billboard（公開可）+ POP909系（local-only）、JAZZ = WJazzD、
CLASSICAL = When in Romeの明示allowlist**。ShareAlike等を学習済みartifactにどう適用するかを
決めるまでは、条件付きdatasetからのmodel exportを許可しない。

### source/subcorpus allowlist とは

repositoryが公開されていることを、収録物すべての一括許諾とはみなさないための許可リスト。
各行に `source ID / subcorpus ID / exact commit or release / license / 取得対象path / 許可用途` を持たせ、
取得CLIは一覧にないものを拒否する。

- When in Romeでは、repository自身が作ったanalysisと、外部から変換したanalysis、同梱score、remote scoreで
  条件が異なる。許可リストは確認済みのanalysis pathだけを対象にし、scoreを自動では取得しない。
- DCMLのmeta-repositoryは各corpusをgit submoduleとして束ねる。許可リストは、例えば
  `mozart_piano_sonatas @ <commit> / CC BY-NC-SA 4.0 / harmonies TSV only` のように固定する。
- これにより、親repositoryのlicenseや公開状態を子datasetへ誤って一括適用することを防ぐ。

`local-only` は、公式配布元から固定revisionを手元のignored raw領域へ取得して、調査・変換・ローカル評価には
利用できる状態を指す。raw再配布、正規化データの公開、checkpointやbrowser用modelの公開まで許可されたという
意味ではない。公開物を作る前に権利範囲を解決し、catalogの各rights gateを更新する。

## 候補別の確認結果

### ChoCo

- 公式 release: [ChoCo v1.0.0](https://github.com/smashub/choco/releases/tag/v1.0.0)、commit
  `f7dd3ee5670d367b57b412d640cc396e57c1b4ea`。
- 公式説明では20,080 JAMSをまとめ、Harte / Roman 系を標準化する。取得したv1.0.0 archiveでは
  20,086 `.jams` filesを確認した。Billboard、Real Book、WJazzD、When in Rome、Mozart Piano Sonata 等を含む。
- [公式 license 表示](https://github.com/smashub/choco/tree/v1.0.0#license)は原則 CC BY 4.0。
  Chordify、Mozart Piano Sonata、JAAH の3 subsetだけ CC BY-NC-SA 4.0。
- 元 corpus と ChoCo 変換版を別作品として split すると leakage になる。`source partition + work identity` で重複を除く。
- 公式 v1.0.0 archive（186,752,842 bytes）を取得済み。SHA-256はcatalogに固定した。
- archive内のJAMSは約297MB、Knowledge Graphは約2.13GB。学習入力候補の `LICENSE.md`、`meta.csv`、
  `jams/` のみ展開し、Knowledge Graphはarchive内に保持する。
- 採用時はsubsetとupstreamのどちらをcanonical sourceにするかを別途決める。

### McGill Billboard

- 公式配布: [The McGill Billboard Project](https://ddmal.ca/research/The_McGill_Billboard_Project_%28Chord_Analysis_Dataset%29/)。
- complete annotations は version 2.0。890 chart slots、740 distinct songs。注釈は CC0 1.0。
- 音源は著作権上配布されていない。取得したのは index と `salami_chords.txt` archive だけで、音声はない。
- phrase 先頭以外の LAB 時刻は一定 tempo を仮定した補間。次和音モデルには beat/phrase 記述を優先し、
  音声に対する厳密な onset ground truth とみなさない。
- 同じ曲が複数 chart slot に存在する。slot ID をそのまま train/test split key にしない。
- 取得済み: index 61,542 bytes、annotation archive 340,263 bytes、archive 内 890 files。
- `mcgill-billboard-v1` adapterで890件を正規化済み。Harteの数値bass、dot、`xN`、metre/tonic change、
  `N` / `&pause` / `*` / silence / non-musical境界を保持し、失敗にはsource referenceを残す。
- chart headerの正規化title+artistでは739 work familyとなり、公式説明の740と1件差がある。漏洩回避を優先して
  同じheader identityは同一familyとし、train/validation/testをfamily単位で固定する。公開評価前に差を再監査する。
- `chordscape_candidates.v1.json` は本体の42ノードから生成したfactor manifest。本体側unit testで同期し、
  corpus coverageをbass込み／bass除外に分けて測る。UI外の教師を削除するallowlistではない。

### POP909 / POP909-CL

- [POP909](https://github.com/music-x-lab/POP909-Dataset/tree/d83e6edba6872a704f5d3b8b32f5cb540088dae6)
  は 909 曲の piano arrangement MIDI と beat/key/chord 情報を含む。論文・README上、tempo curve以外の
  beat/key/chord は MIR algorithm 由来なので、和声の正解ラベルとしては弱い。
- [POP909-CL](https://github.com/AndyWeasley2004/POP909-CL-Dataset/tree/be9094392903c471a930519e1c0bacf8b6be5d62)
  は chord、beat、key、time signature を専門家が補正した版。品質面ではこちらを優先したい。
- 両 repository とも root に MIT license があるが、文面は “Software and associated documentation files” とし、
  既存楽曲、professional arrangement MIDI、annotation の権利を分けて説明していない。
- 元のPOP909はユーザー指示によりcommit固定archive（44,551,359 bytes）を取得・展開済み。ただし `local-only` とし、
  raw再配布、normalized sequence公開、model exportを許可済みとは扱わない。
- POP909-CLもユーザー指示によりcommit固定archive（24,729,951 bytes）を取得・展開済み。4系列それぞれ909件、
  合計3,636 MIDI filesを確認した。こちらも `local-only` であり、公開許可を意味しない。
- adapterが使用する固定`POP909_processed.zip`には実際には908 MIDIしかなく、`043.mid`がない。さらに`367.mid`には
  修正済みchord trackがないため、変換では空のSong recordとsource diagnosticを残す。READMEの909 tracksを実ファイル数へ
  読み替えたり、欠損labelを旧POP909から黙って補完したりしない。
- 両者ともmaintainerに「annotations-only の利用・再配布・model training/export」の条件を確認してから
  公開用途へ採用する。

### Real Book-derived corpora

- 2007年の研究は 244 jazz standards の chord transcription を説明するが、再配布条件を明示した
  standalone 公式配布元を今回確認できなかった。
- ChoCo v1.0.0 は Real Book partition を持ち、ChoCo の例外3件に含めず CC BY 4.0 としている。
- 採用するなら ChoCo release のみを出典にし、attribution と JAMS provenance を保持する。
  ただし曲単位で読める progression や公開 model artifact の扱いは release 前に再確認する。
- WJazzD や他の jazz standards corpus と作品が重なるため、title だけでなく composer、recording、form を用いた
  duplicate-family 監査が必要。

### Weimar Jazz Database

- 公式配布: [WJazzD download](https://jazzomat.hfm-weimar.de/download/download.html#weimar-jazz-database)。
- 配布ページと取得 DB の `db_info` は release 2.1 / database 2.2、456 solo transcriptions、FINAL とする。
- database は ODbL 1.0、individual contents は DB Contents License 1.0。元録音は含まれない。
- 取得済み SQLite は 42,512,384 bytes。456 solos、302 composition IDs、344 track IDs、
  30,548 non-empty beat chord rowsを確認した。
- 同じ composition の別録音・別 solo を跨いで split しない。`compid` を work family、`trackid` / `recordid` を
  performance として別々に保持する。
- ODbL の derivative database / Produced Work の区別を model export 前に判断し、必要な attribution、notice、
  share-alike、machine-readable access を満たす。
- 公式 content page には `r2.2/v2.3` という不整合な表記もある。今回の version は download page と DB 内部値を採用した。

### When in Rome

- 公式 repository: [When in Rome](https://github.com/MarkGotham/When-in-Rome/tree/1c61fe41b8c2910296d7d2bcbf6476c7c1f2fe35)。
- 約2,000 analyses / 1,500 works の RomanText meta-corpus。local key、tonicization、measure/beat、work hierarchy を持つ。
- repository 新規 analysis、code、既存 analysis の conversion は CC BY-SA 4.0。ただし、変換された analysis は
  original source license、score は各 score license に従うよう README が明示する。
- 一括 clone をそのまま教師集合にせず、analysis-only かつ license を解決できた subcorpus の allowlist を作る。
  alternative analyses は重複ではなく別 annotation view として同じ work family に束ねる。
- commit固定archive（32,819,282 bytes）を取得済み。archive中の手動 `analysis*.txt` は1,662件だが、初期allowlistは
  upstream READMEが新規分析と明記する `OpenScore-LiederCorpus` の `analysis.txt` 179件だけである。
- 展開したのはその179件とREADME・syntaxだけ。score、`remote.json`、外部由来変換、automatic analysisは展開していない。
  選択規則と公開gateは [`when_in_rome_allowlist.json`](when_in_rome_allowlist.json) に固定した。

### DCML harmony corpora

- meta release: [dcml_corpora v2.3](https://github.com/DCMLab/dcml_corpora/releases/tag/v2.3)、commit
  `ee6f278a42dccb4ce4f374c6bf738e3cd4fc5fe7`。各 corpus は submodule revision で固定される。
- meta repository 自体には単一の data license がない。選んだ subcorpus の `LICENSE` を必ず記録する。
- 今回確認した [ABC](https://github.com/DCMLab/ABC)、
  [romantic piano corpus](https://github.com/DCMLab/romantic_piano_corpus)、
  [Corelli](https://github.com/DCMLab/corelli)、
  [Mozart Piano Sonatas](https://github.com/DCMLab/mozart_piano_sonatas) は CC BY-NC-SA 4.0。
- harmonies TSV は global/local key、Roman numeral、applied chord、inversion、changes/additions、pedal、phrase、cadence 等を
  保持する。annotation-standard version と一緒に取り込み、未対応 field を捨てない。
- NC/SA と公開 model の関係を決めるまでは取得しない。採用時は Frictionless datapackage または release-pinned submodule を使う。

## 取得と検証

raw data、展開物、receipt はすべて `harmony_model/data/raw/` 以下に置き、`.gitignore` で除外する。
catalog と code/test だけを repository に残す。

```sh
cd harmony_model

# 権利状態と取得状態
python3 -m harmony_model.datasets list

# catalog と、手元にある取得物の byte 数・SHA-256
python3 -m harmony_model.datasets verify

# catalog で取得済み・checksum 固定済みとした source だけ再取得できる
python3 -m harmony_model.datasets fetch mcgill_billboard
python3 -m harmony_model.datasets fetch weimar_jazz_database
python3 -m harmony_model.datasets fetch choco
python3 -m harmony_model.datasets fetch pop909
python3 -m harmony_model.datasets fetch pop909_cl
python3 -m harmony_model.datasets fetch when_in_rome
```

`fetch` は HTTPS、catalog の保存先、byte 数、SHA-256 を固定し、一時ファイルから atomic に配置する。
tar/ZIP は absolute path、`..`、link、特殊 file を拒否してから展開する。ZIPのprefixまたはtarのglobを
catalogで指定し、許可したmemberだけを選択展開できる。取得時には ignored raw 領域へ
`receipt.json` を作り、source、version、URL、license、download date、conversion notes を再記録する。

## 公開前 gate

1. 使用する dataset / subset / exact revision を catalog へ固定する。
2. `raw_redistribution`、`normalized_redistribution`、`derived_artifacts` を別々に確認する。
3. NC、SA、ODbL、権利不明データを混ぜる場合、最も厳しい条件で済ませると推測せず、各条件の両立を確認する。
4. ChoCo と upstream、同一曲の別 chart、同一作品の別楽章・別演奏を `work_id` family へまとめてから split する。
5. raw/processed sequence、読み戻せる chord chart、checkpoint、browser 用 artifact を別の公開判断にする。
6. 公開 bundle へ attribution、license notice、source/version、conversion report、除外 dataset を同梱する。
