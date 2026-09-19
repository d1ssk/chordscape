# McGill baseline v1

McGill Billboard 2.0の固定work splitに対するfactorized unigram、1次Markov、2次Markovの基準値。
実行日は2026-09-19。artifactと完全な評価JSONはignored領域の `runs/mcgill-baselines-v1/` に置く。

## 実行条件

- 入力: `data/processed/mcgill_billboard-v1/songs.jsonl`
- split seed: `chordscape-mcgill-split-v1`
- train: 1,247 sequences / 93,034 complete events
- validation: 10,239 events
- test: 12,158 events
- alpha: 0.5、minimum context count: 1
- bassは予測対象外。degree、accidental、quality、seventhをcategorical、extensionsとalterationsを
  multi-label Bernoulliとして、有／無の全項をlog probabilityへ含める。
- 1次・2次で未知のcontextは順に低次へbackoffする。部分解析、key欠損、no-chord、明示境界ではsequenceを切る。
- UI rankingはbassを除いた41 unique harmony候補で評価する。42ノードのうちDbとDb/Fは同じharmonyへ集約する。
  同点はaverage rank。coverageは正解がこの集合内にあるeventの割合。

## 結果

### Validation

| model    | joint NLL ↓ | perplexity ↓ | UI coverage |      MRR ↑ |    Top-1 ↑ |    Top-3 ↑ |
| -------- | ----------: | -----------: | ----------: | ---------: | ---------: | ---------: |
| unigram  |      3.8955 |        49.18 |      78.47% |     0.4700 |     29.41% |     57.65% |
| Markov-1 |  **3.4570** |    **31.72** |      78.47% |     0.5308 |     35.77% |     64.09% |
| Markov-2 |      3.6720 |        39.33 |      78.47% | **0.5329** | **36.42%** | **65.40%** |

### Test

| model    | joint NLL ↓ | perplexity ↓ | UI coverage |      MRR ↑ |    Top-1 ↑ |    Top-3 ↑ |
| -------- | ----------: | -----------: | ----------: | ---------: | ---------: | ---------: |
| unigram  |      3.9789 |        53.46 |      78.52% |     0.4611 |     30.32% |     54.75% |
| Markov-1 |  **3.5718** |    **35.58** |      78.52% |     0.5110 |     35.16% |     60.28% |
| Markov-2 |      4.0317 |        56.35 |      78.52% | **0.5179** | **36.99%** | **61.26%** |

test categorical accuracyはMarkov-1でdegree 39.66%、accidental 92.52%、quality 74.25%、seventh 79.96%。
extension F1は5.12%、alteration F1は5.13%で、希少ラベルはまだ弱い。Markov-2はUI rankingを少し改善する一方、
joint NLLが悪化し、extension F1もvalidation 32.77%からtest 14.74%へ落ちる。

## 判断

baseline v1の代表値は **Markov-1** とする。validationとtestの両方でjoint NLLが最良で、
UI rankingもunigramから明確に改善する。Markov-2はranking比較用として残すが、現設定では確率モデルとして採用しない。
Transformerは少なくともMarkov-1と同一split・同一candidate集合で比較し、NLLとrankingの両方を報告する。

これはpopだけの結果である。`free` は実装上、style別確率のlog-space mixtureだが、jazz/classical modelがない現状では
popと同じになる。WJazzD等を追加するまでstyle間比較やstyle-balanced全体評価は行わない。
