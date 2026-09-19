# Corpus conversion v1

2026-09-19に、checksum固定済みの取得済みraw dataを`convert-all`で変換した結果。
出力はすべて`data/processed/`以下のignored local artifactであり、rawまたは正規化列の公開許可を意味しない。

| dataset                |                songs/views |  works |    events |        ok | partial | failure | no chord | UI harmony coverage |
| ---------------------- | -------------------------: | -----: | --------: | --------: | ------: | ------: | -------: | ------------------: |
| McGill Billboard       |                        890 |    739 |   117,311 |   115,524 |      58 |     112 |    1,617 |              75.40% |
| WJazzD                 |                        456 |    302 |    30,548 |    29,983 |     164 |       0 |      401 |              70.16% |
| POP909                 |                        909 |    909 |   124,805 |   120,069 |       0 |       0 |    4,736 |              61.08% |
| POP909-CL              |                        908 |    908 |   116,872 |   115,344 |     583 |       0 |      945 |              71.15% |
| When in Rome allowlist |                        179 |    179 |    14,030 |    13,806 |     224 |       0 |        0 |              88.40% |
| ChoCo                  | 20,530 views / 20,086 JAMS | 18,529 | 1,575,409 | 1,536,402 |  26,568 |     124 |   12,315 |              76.05% |

coverageは完全factor eventのうちChordscapeの41 unique harmony候補にbassを無視して一致した割合。
教師の採否基準ではない。POP909-CLのbass込みcoverageは0.01%だが、これはMIDI chord trackの実最低音を
全eventで保持する一方、UI manifestの大半がbass未指定だからであり、harmony coverageとは分けて読む。

## Adapter境界

- McGill: SALAMI構造とHarte。小節反復、tonic/meter変更、silence/unanalysed境界を展開。
- WJazzD: SQLite。`compid`をwork family、melid/track/recordをperformance identityとして保持。
- POP909: `chord_midi.txt`、`key_audio.txt`、`beat_midi.txt`。timestampをbeat gridへ補間。labelはalgorithmic weak label。
- POP909-CL: dependency-free MIDI readerで修正済みchord trackとkey/time-signature meta eventを読む。
- When in Rome: RomanText。local key、適用和音、転回、pivot、小節・範囲反復を展開し、form／sectionとpedalをmetadataへ保持。許可済み179分析だけが対象。
- ChoCo: JAMSの`chord`と`chord_harte`を読み、全annotation viewを別Songとして同一workへ束ねる。
  明示interval listも解析し、partition・annotation provenance・upstream重複フラグを保持。

## 明示的に残した制約

- POP909-CLの固定`POP909_processed.zip`はREADMEの909件に対して908 MIDIで、`043.mid`がない。
  `367.mid`にはchord trackがなく、空のSong recordとして残した。旧POP909 labelで補完していない。
- WJazzDのmodal/chromatic keyはschema v1のmajor/minor外なので、source keyをmetadataへ残してfactorはkey missingにする。
- ChoCoのaudio時刻は秒なので、quarter-note単位の`EventContext.duration`へ変換しない。Billboard等のmodeなしkeyも推測しない。
- When in Romeの省略音、French/Italian augmented sixth等はschema v1で完全表現できないためpartial。
- ChoCoと各upstream、POP909とPOP909-CL、同一jazz standardのcross-corpus重複はまだ統合familyへまとめていない。
  個別split manifestを単純結合して学習してはいけない。

## 再実行

```sh
cd harmony_model
python3 -m harmony_model.datasets verify
python3 -m harmony_model convert-all \
  --raw-root data/raw \
  --output-root data/processed
python3 -m unittest discover -s tests -v
```
