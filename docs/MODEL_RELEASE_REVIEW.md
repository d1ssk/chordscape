# 48文脈Transformerの公開確認（2026-09-20）

対象は `20260919T181011273923Z-6f2c1be731` の `best.pt`（SHA-256 `cbbe788b9606ff65967b450a465e5f166c1c12a94b74060373b62ffa3f44c5b5`）。`run_manifest.json` は統合コーパスv1、48文脈、学習用566,561イベントを記録する。以下の件数は固定済み `harmony_model/data/processed/integrated-v1/corpus_manifest.json` の学習splitで選択された系列から集計した。

| 学習元                          | 学習系列 | 学習イベント | 公開に関係する条件                                                                                           |
| ------------------------------- | -------: | -----------: | ------------------------------------------------------------------------------------------------------------ |
| ChoCo v1.0.0                    |    4,538 |      364,187 | 原則CC BY 4.0。ただしJAAH 5系列・872イベント、Mozart Piano Sonatas 43系列・17,127イベントはCC BY-NC-SA 4.0。 |
| McGill Billboard 2.0            |      580 |       76,467 | 和音注釈はCC0。                                                                                              |
| POP909                          |        3 |          501 | リポジトリのMIT文面はsoftwareとdocumentationを対象とする。収録曲・編曲・注釈への権利範囲は明記されていない。 |
| POP909-CL                       |      716 |       91,238 | MIT文面の対象範囲と、元POP909の楽曲・編曲から引き継ぐ権利が明記されていない。                                |
| Weimar Jazz Database 2.1        |      331 |       22,285 | データベースはODbL 1.0。公開モデルがProduced WorkまたはDerivative Databaseに当たるかで義務が変わる。         |
| When in Rome / OpenScore Lieder |      150 |       11,883 | この新規分析はCC BY-SA 4.0。                                                                                 |

## 確認した一次資料

- [ChoCo v1.0.0のライセンス](https://github.com/smashub/choco/blob/v1.0.0/LICENSE.md)は、JAAH・Mozart Piano Sonata等の例外をCC BY-NC-SAと明記する。
- [McGill Billboardの配布ページ](<https://ddmal.ca/research/The_McGill_Billboard_Project_(Chord_Analysis_Dataset)/>)は注釈をCC0で公開する。
- [POP909のライセンス](https://github.com/music-x-lab/POP909-Dataset/blob/master/LICENSE)と[POP909-CLのライセンス](https://github.com/AndyWeasley2004/POP909-CL-Dataset/blob/main/LICENSE)はいずれもMITの「software and associated documentation files」という文面。[POP909-CLの説明](https://github.com/AndyWeasley2004/POP909-CL-Dataset)は元POP909の楽曲MIDIを含むと記す。
- [Jazzomatの配布ページ](https://jazzomat.hfm-weimar.de/download/download.html)はWeimar Jazz DatabaseのODbLを明示し、[ODbL本文](https://opendatacommons.org/licenses/odbl/1-0/)は公開されるProduced WorkとDerivative Databaseの義務を区別する。
- [When in Romeの説明](https://github.com/MarkGotham/When-in-Rome#licence-citation-contribution)は新規分析をCC BY-SAとし、外部由来の分析・楽譜には別条件があると記す。
- [Creative CommonsのAI学習ガイド](https://creativecommons.org/using-cc-licensed-works-for-ai-training-2/)は、モデルがadaptationに当たるか等を事案ごとの問題とし、保守的な公開方法ではShareAlike・NonCommercial条件をモデルにも適用する。[互換ライセンス一覧](https://creativecommons.org/compatible-licenses/)ではBY-SA 4.0とBY-NC-SA 4.0は相互に互換とされていない。

## 公開判断

現時点では**この重みをGitHub Pagesへ同梱しない**。POP909系の楽曲・編曲と派生成果物に対する許諾が確認できず、ChoCoのBY-NC-SA部分とWhen in RomeのBY-SA部分を同じ重みに含む場合の公開条件も確定できない。重みが元の表現のadaptationに当たらない可能性だけを根拠に、権利確認済みとは扱わない。出典表示やライセンス文面の同梱だけでは、未確認の許諾範囲を補えない。

同じcheckpointを公開するには、少なくともPOP909・POP909-CLの収録曲／編曲／注釈由来のモデル重みの再配布について権利者の確認を得て、ChoCoのNC-SA部分とWhen in RomeのBY-SA部分を含むモデルのライセンス適合性、およびODbLの扱いを確認する必要がある。確認できない場合は、公開条件が明確なデータに限定して48文脈モデルを再学習する方法がある。その場合、現行checkpointと同一の重みにはならない。
