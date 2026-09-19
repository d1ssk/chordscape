# Harmony Model の作業規則

- 変更前に README.md、DESIGN.md、PLAN.md を読む。設計・schema・表記の意味を変更したら、理由と本体連携への影響をDESIGN.mdへ記録する。
- UIの42候補は学習vocabularyではない。綴り・factor・raw notation・keyの出典を保持する。
- 本体の演奏イベントと学習イベントを混同しない。dataset固有表記はadapterに閉じ込める。
- Pythonのテストはこのディレクトリで `python3 -m unittest discover -s tests -v`。npmのcheckにはPythonテストが含まれない。
- 外部dataset、checkpoint、cacheをcommitしない。データ利用時はsource versionと使用・再配布・派生artifactの条件を確認する。
