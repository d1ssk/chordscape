# Integrated corpus baseline v1

McGill Billboard、WJazzD、POP909、POP909-CL、When in Rome、ChoCoをcross-corpus work familyへ統合し、
重複排除後の固定splitでfactorized unigram、1次Markov、2次Markovを学習・評価した結果。
実行日は2026-09-19。統合manifestはignored領域の`data/processed/integrated-v1/`、model artifactと
完全なsource/style別評価JSONは`runs/integrated-baselines-v1/`に置く。

## 統合と重複排除

- 入力: 23,872 songs/views、18,494 canonical work families。
- 学習可能として採用: 7,982 songs、6,818 works、715,706 complete factor events。
- splitはcanonical work単位で先に固定し、train 5,398 works / validation 728 / test 692。split間work漏洩は0。
- POP909-CLのexpert-corrected annotationを優先し、利用不能または欠落した3曲だけPOP909 weak labelへfallback。
- ChoCo内のMcGill/WJazzD mirror 1,346件と、direct When in Romeにexact matchした4件を除外。
- ChoCoの同一JAMSにある代替annotation view 444件、同一work内の完全一致系列348件を一度だけ採用。
- Billboard chart slotで直接対応したChoCo CASD 50件を同一recordingの重複として除外。
- 12,790件は重複ではなく、調がなく相対rootを生成できない等の理由でcomplete factor sequenceが0件のため学習対象外。
- 同一作品でも和声系列が異なる別演奏・別編曲・独立annotationは保持する。

作品familyはsource work ID、正規化title+creator、外部identifier、POP909 ID、明示Billboard slot、
creatorが矛盾しないjazzのexact titleを根拠に決定する。巨大JSONLは複製せず、元JSONLのSHA-256、採否理由、
canonical work、splitを`corpus_manifest.json`へ固定する。

## 学習条件

- train: 11,876 sequences / 566,561 events。
- style別train: classical 114,501、jazz 260,760、pop 191,300 events。
- validation 78,419 events、test 70,726 events。
- alpha 0.5、minimum context count 1。bassは予測対象外。
- pop / jazz / classicalは独立した条件モデル。`free`は3モデルのlog-space mixture。
- UI rankingはbassを除いた41 unique harmony候補。同点はaverage rank。
- NLLはUI候補外を含む全complete factor event、rankingは正解がUI候補内にあるeventで評価する。

## 全体結果

### Validation

| model    | joint NLL ↓ | perplexity ↓ | UI coverage |      MRR ↑ |    Top-1 ↑ |    Top-3 ↑ |
| -------- | ----------: | -----------: | ----------: | ---------: | ---------: | ---------: |
| unigram  |      4.3057 |        74.12 |      75.84% |     0.3655 |     18.51% |     46.44% |
| Markov-1 |  **3.7958** |    **44.51** |      75.84% |     0.4929 |     32.94% |     58.32% |
| Markov-2 |      3.9237 |        50.59 |      75.84% | **0.5218** | **36.81%** | **59.77%** |

### Test

| model    | joint NLL ↓ | perplexity ↓ | UI coverage |      MRR ↑ |    Top-1 ↑ |    Top-3 ↑ |
| -------- | ----------: | -----------: | ----------: | ---------: | ---------: | ---------: |
| unigram  |      4.5300 |        92.76 |      72.31% |     0.3374 |     15.01% |     44.49% |
| Markov-1 |  **3.9147** |    **50.13** |      72.31% |     0.4775 |     31.17% |     56.85% |
| Markov-2 |      4.0528 |        57.56 |      72.31% | **0.5176** | **36.35%** | **59.79%** |

### Test style別

| style     | events | Markov-1 NLL ↓ | Markov-1 MRR ↑ | Markov-2 NLL ↓ | Markov-2 MRR ↑ |
| --------- | -----: | -------------: | -------------: | -------------: | -------------: |
| classical |  9,742 |         2.9859 |         0.5446 |     **2.9819** |     **0.5732** |
| jazz      | 36,110 |     **4.4980** |         0.4513 |         4.6776 |     **0.4979** |
| pop       | 24,874 |     **3.4318** |         0.4803 |         3.5652 |     **0.5174** |

## 判断

代表baselineは引き続き**Markov-1**とする。validation/testの両方でjoint NLLとperplexityが最良で、
unigramから明確に改善した。Markov-2は全styleでUI rankingが最良だが、全体NLLはMarkov-1より悪く、
確率modelとしては過適合傾向が残る。UI候補の並べ替えだけを目的にする場合はMarkov-2も比較対象として残す。

McGill単独値とはsplitもcorpus構成も異なるため、数値を直接の改善率として解釈しない。統合testのUI coverageが
72.31%へ下がったことは、jazz/classicalやUI外の和声を含む範囲拡大の診断であり、教師をUI候補へ切り詰める理由ではない。

## 再実行

```sh
cd harmony_model
python3 -m harmony_model integrate-corpora \
  --processed-root data/processed \
  --output-dir data/processed/integrated-v1
python3 -m harmony_model train-integrated-baselines \
  --corpus-manifest data/processed/integrated-v1/corpus_manifest.json \
  --output-dir runs/integrated-baselines-v1
```
