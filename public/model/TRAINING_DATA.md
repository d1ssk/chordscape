# 公開pop・jazz Transformerの教師データと出典

公開モデル `pop-jazz-v1` は、和音注釈を和声因子の系列へ変換して学習した48文脈のモデルです。ブラウザには推論用に変換した重みと候補定義を配布します。元の楽曲、録音、MIDI、注釈データ、正規化した教師系列、PyTorch checkpointは配布しません。

使用したのは重複・学習不能系列を除いた6,317系列（453,952利用可能イベント）です。内訳は次のとおりです。

| 出典                                                                                                       | 採用系列 | 条件と出典                                                                                                                                                                                             |
| ---------------------------------------------------------------------------------------------------------- | -------: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [ChoCo v1.0.0](https://github.com/smashub/choco/releases/tag/v1.0.0)                                       |    5,168 | [CC BY 4.0、ただし指定されたNC例外を除く](https://github.com/smashub/choco/blob/v1.0.0/LICENSE.md)。採用元はReal Book 2,843、iReal Pro 2,027、Rock Corpus 200、Robbie Williams 52、Isophonics 46系列。 |
| [McGill Billboard 2.0](<https://ddmal.ca/research/The_McGill_Billboard_Project_(Chord_Analysis_Dataset)/>) |      738 | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/)。原音源は含まない。                                                                                                                      |
| [Weimar Jazz Database 2.1](https://jazzomat.hfm-weimar.de/download/download.html)                          |      411 | データベースは[ODbL 1.0](https://opendatacommons.org/licenses/odbl/1-0/)、個別内容はDbCL 1.0。元データベースへのアクセスは配布元から可能。原音源は含まない。                                           |

各出典の和音表記を共通のdegree・accidental・quality・seventh・extensions・alterationsへ変換し、作品単位でtrain / validation / testへ分割しました。同じ作品の別注釈、他データセットとの重複、利用不可のサブセットは除外しました。POP909、POP909-CL、ChoCoのNC例外、When in Rome、Classical系列はこのモデルに採用していません。出典の表示と利用条件は元データの権利表示を置き換えません。

モデルrun: `20260920T093553350268Z-045b33e287`。元checkpoint SHA-256: `73b5991e7878c2af5a8d832d1d730e670df4550a144834b3e9d0457f3300e05c`。公開重み SHA-256: `6f528af775c7be60da368e8e0fb1f79bfc93bd78fd0f5bccd5a56cf3c5ab68be`。再現用の出典選別方針はリポジトリの `harmony_model/datasets/publication_corpus_v1.json` に記録しています。

この重みの再利用では、上記の出典表示と各データの条件を確認してください。モデル重みを教師データそのものとして再配布するものではありません。
