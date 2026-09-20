"""Only implemented operations are exposed as commands."""
import argparse
from dataclasses import asdict
import json
from pathlib import Path
import sys

from .baseline import train_baselines, train_integrated_baselines
from . import choco, integration, pop909, pop909_cl, weimar_jazz, when_in_rome
from .conversion import write_conversion as write_generic_conversion
from .mcgill_billboard import (
    DEFAULT_CANDIDATE_MANIFEST,
    convert_dataset,
    write_conversion,
)
from .normalize import normalize
from .parser import PlainChordParser, parse_key
from .schema import KeyAnnotation


def main() -> int:
    parser = argparse.ArgumentParser(description="和音表記を解析・調に相対化します")
    commands = parser.add_subparsers(dest="command", required=True)
    inspect = commands.add_parser("inspect-chord", help="factorと解析結果をJSON表示")
    inspect.add_argument("chord")
    inspect.add_argument("--key", type=parse_key, help="global key（例 C:maj）")
    inspect.add_argument("--local-key", type=parse_key, help="local key（例 G:maj）")
    mcgill = commands.add_parser(
        "convert-mcgill", help="McGill Billboard 2.0を正規化し診断を出力"
    )
    mcgill.add_argument("--raw-root", type=Path, required=True)
    mcgill.add_argument("--output-dir", type=Path, required=True)
    mcgill.add_argument("--seed", default="chordscape-mcgill-split-v1")
    mcgill.add_argument(
        "--candidate-manifest",
        type=Path,
        default=DEFAULT_CANDIDATE_MANIFEST if DEFAULT_CANDIDATE_MANIFEST.is_file() else None,
    )
    adapters = {
        "convert-weimar": (
            weimar_jazz, "weimar_jazz_database",
            "release 2.1, database version 2.2", "compid from composition_info",
        ),
        "convert-pop909": (
            pop909, "pop909", "d83e6edba687", "POP909 numeric song ID",
        ),
        "convert-pop909-cl": (
            pop909_cl, "pop909_cl", "be9094392903", "POP909 numeric song ID",
        ),
        "convert-choco": (
            choco, "choco", "v1.0.0", "source partition + upstream identifiers/title/creator",
        ),
        "convert-when-in-rome": (
            when_in_rome, "when_in_rome", "1c61fe41b8c2",
            "composer + title + allowlisted corpus path",
        ),
    }
    for command, (module, dataset_id, _version, _identity) in adapters.items():
        adapter = commands.add_parser(command, help=f"{dataset_id}を共通schemaへ変換")
        adapter.add_argument("--raw-root", type=Path, required=True)
        adapter.add_argument("--output-dir", type=Path, required=True)
        adapter.add_argument("--seed", default=module.DEFAULT_SEED)
        adapter.add_argument(
            "--candidate-manifest", type=Path,
            default=DEFAULT_CANDIDATE_MANIFEST if DEFAULT_CANDIDATE_MANIFEST.is_file() else None,
        )
    convert_all = commands.add_parser(
        "convert-all", help="取得済みの全raw datasetを変換"
    )
    convert_all.add_argument("--raw-root", type=Path, required=True)
    convert_all.add_argument("--output-root", type=Path, required=True)
    convert_all.add_argument(
        "--candidate-manifest", type=Path,
        default=DEFAULT_CANDIDATE_MANIFEST if DEFAULT_CANDIDATE_MANIFEST.is_file() else None,
    )
    baseline = commands.add_parser(
        "train-baselines", help="固定splitでunigram／1次／2次Markovを学習・評価"
    )
    baseline.add_argument("--songs", type=Path, required=True)
    baseline.add_argument("--split-manifest", type=Path, required=True)
    baseline.add_argument(
        "--candidate-manifest",
        type=Path,
        default=DEFAULT_CANDIDATE_MANIFEST if DEFAULT_CANDIDATE_MANIFEST.is_file() else None,
    )
    baseline.add_argument("--output-dir", type=Path, required=True)
    baseline.add_argument("--alpha", type=float, default=0.5)
    baseline.add_argument("--min-context-count", type=int, default=1)
    integrate = commands.add_parser(
        "integrate-corpora", help="変換済みcorpusを作品単位で統合し重複を除外"
    )
    integrate.add_argument("--processed-root", type=Path, required=True)
    integrate.add_argument("--output-dir", type=Path, required=True)
    integrate.add_argument("--seed", default=integration.DEFAULT_SEED)
    integrated_baseline = commands.add_parser(
        "train-integrated-baselines",
        help="統合corpus manifestでunigram／1次／2次Markovを学習・評価",
    )
    integrated_baseline.add_argument("--corpus-manifest", type=Path, required=True)
    integrated_baseline.add_argument(
        "--candidate-manifest",
        type=Path,
        default=DEFAULT_CANDIDATE_MANIFEST if DEFAULT_CANDIDATE_MANIFEST.is_file() else None,
    )
    integrated_baseline.add_argument("--output-dir", type=Path, required=True)
    integrated_baseline.add_argument("--alpha", type=float, default=0.5)
    integrated_baseline.add_argument("--min-context-count", type=int, default=1)
    transformer = commands.add_parser(
        "train-transformer", help="統合corpusでversion付きcausal Transformerを学習・評価"
    )
    transformer.add_argument("--corpus-manifest", type=Path, required=True)
    transformer.add_argument("--candidate-manifest", type=Path, default=DEFAULT_CANDIDATE_MANIFEST)
    transformer.add_argument("--output-root", type=Path, default=Path("runs/transformer"))
    transformer.add_argument("--context", type=int, default=32)
    transformer.add_argument("--d-model", type=int, default=128)
    transformer.add_argument("--layers", type=int, default=4)
    transformer.add_argument("--heads", type=int, default=4)
    transformer.add_argument("--dropout", type=float, default=0.1)
    transformer.add_argument("--batch-size", type=int, default=64)
    transformer.add_argument("--epochs", type=int, default=8)
    transformer.add_argument("--learning-rate", type=float, default=0.0003)
    transformer.add_argument("--lr-schedule", choices=("constant", "plateau"), default="constant")
    transformer.add_argument("--lr-factor", type=float, default=0.5)
    transformer.add_argument("--lr-patience", type=int, default=1)
    transformer.add_argument("--lr-threshold", type=float, default=0.0001)
    transformer.add_argument("--min-learning-rate", type=float, default=0.00001)
    transformer.add_argument("--weight-decay", type=float, default=0.01)
    transformer.add_argument("--seed", type=int, default=42)
    transformer.add_argument("--patience", type=int, default=3)
    transformer.add_argument("--device", choices=("auto", "cpu", "mps", "cuda"), default="auto")
    transformer_eval = commands.add_parser(
        "evaluate-transformer", help="checkpointを読み込み固定splitを再評価"
    )
    transformer_eval.add_argument("--run-dir", type=Path, required=True)
    transformer_eval.add_argument("--corpus-manifest", type=Path, required=True)
    transformer_eval.add_argument("--candidate-manifest", type=Path, default=DEFAULT_CANDIDATE_MANIFEST)
    transformer_eval.add_argument("--device", choices=("auto", "cpu", "mps", "cuda"), default="auto")
    transformer_finalize = commands.add_parser(
        "finalize-transformer", help="中断runの最良checkpointを評価しindexへ登録"
    )
    transformer_finalize.add_argument("--run-dir", type=Path, required=True)
    transformer_finalize.add_argument("--corpus-manifest", type=Path, required=True)
    transformer_finalize.add_argument("--candidate-manifest", type=Path, default=DEFAULT_CANDIDATE_MANIFEST)
    transformer_finalize.add_argument("--device", choices=("auto", "cpu", "mps", "cuda"), default="cpu")
    args = parser.parse_args()
    if args.command == "convert-mcgill":
        try:
            songs = convert_dataset(args.raw_root)
            report = write_conversion(
                songs,
                args.output_dir,
                seed=args.seed,
                candidate_manifest=args.candidate_manifest,
            )
        except (OSError, ValueError, KeyError, json.JSONDecodeError) as error:
            parser.error(str(error))
        print(json.dumps(report, ensure_ascii=False, indent=2))
        return 0
    if args.command in adapters:
        module, dataset_id, version, identity = adapters[args.command]
        try:
            songs = module.convert_dataset(args.raw_root)
            report = write_generic_conversion(
                songs, args.output_dir,
                dataset_id=dataset_id,
                dataset_version=version,
                adapter_version=module.ADAPTER_VERSION,
                seed=args.seed,
                identity=identity,
                candidate_manifest=args.candidate_manifest,
                source_notes=getattr(module, "SOURCE_NOTES", ()),
            )
        except (OSError, ValueError, KeyError, IndexError, json.JSONDecodeError) as error:
            parser.error(str(error))
        print(json.dumps(report, ensure_ascii=False, indent=2))
        return 0
    if args.command == "convert-all":
        reports = {}
        try:
            mcgill_songs = convert_dataset(args.raw_root / "mcgill_billboard")
            reports["mcgill_billboard"] = write_conversion(
                mcgill_songs,
                args.output_root / "mcgill_billboard-v1",
                candidate_manifest=args.candidate_manifest,
            )
            for _command, (module, dataset_id, version, identity) in adapters.items():
                songs = module.convert_dataset(args.raw_root / dataset_id)
                reports[dataset_id] = write_generic_conversion(
                    songs,
                    args.output_root / f"{dataset_id}-v1",
                    dataset_id=dataset_id,
                    dataset_version=version,
                    adapter_version=module.ADAPTER_VERSION,
                    seed=module.DEFAULT_SEED,
                    identity=identity,
                    candidate_manifest=args.candidate_manifest,
                    source_notes=getattr(module, "SOURCE_NOTES", ()),
                )
        except (OSError, ValueError, KeyError, IndexError, json.JSONDecodeError) as error:
            parser.error(str(error))
        print(json.dumps(reports, ensure_ascii=False, indent=2))
        return 0
    if args.command == "train-baselines":
        if args.candidate_manifest is None:
            parser.error("--candidate-manifest is required outside the repository checkout")
        try:
            report = train_baselines(
                args.songs,
                args.split_manifest,
                args.candidate_manifest,
                args.output_dir,
                alpha=args.alpha,
                min_context_count=args.min_context_count,
                command=[sys.executable, "-m", "harmony_model", *sys.argv[1:]],
            )
        except (OSError, ValueError, KeyError, json.JSONDecodeError) as error:
            parser.error(str(error))
        print(json.dumps(report, ensure_ascii=False, indent=2))
        return 0
    if args.command == "integrate-corpora":
        try:
            report = integration.build_integrated_manifest(
                args.processed_root,
                args.output_dir,
                seed=args.seed,
            )
        except (OSError, ValueError, KeyError, json.JSONDecodeError) as error:
            parser.error(str(error))
        print(json.dumps(report["summary"], ensure_ascii=False, indent=2))
        return 0
    if args.command == "train-integrated-baselines":
        if args.candidate_manifest is None:
            parser.error("--candidate-manifest is required outside the repository checkout")
        try:
            report = train_integrated_baselines(
                args.corpus_manifest,
                args.candidate_manifest,
                args.output_dir,
                alpha=args.alpha,
                min_context_count=args.min_context_count,
                command=[sys.executable, "-m", "harmony_model", *sys.argv[1:]],
            )
        except (OSError, ValueError, KeyError, json.JSONDecodeError) as error:
            parser.error(str(error))
        print(json.dumps(report, ensure_ascii=False, indent=2))
        return 0
    if args.command in {"train-transformer", "evaluate-transformer", "finalize-transformer"}:
        try:
            from . import transformer as module
            if args.command == "train-transformer":
                config = module.Config(
                    context=args.context, d_model=args.d_model, layers=args.layers,
                    heads=args.heads, dropout=args.dropout, batch_size=args.batch_size,
                    epochs=args.epochs, learning_rate=args.learning_rate,
                    lr_schedule=args.lr_schedule, lr_factor=args.lr_factor,
                    lr_patience=args.lr_patience,
                    lr_threshold=args.lr_threshold,
                    min_learning_rate=args.min_learning_rate,
                    weight_decay=args.weight_decay, seed=args.seed,
                    patience=args.patience, device=args.device,
                )
                result = module.train(
                    args.corpus_manifest, args.candidate_manifest, args.output_root,
                    config, command=[sys.executable, "-m", "harmony_model", *sys.argv[1:]],
                )
                print(json.dumps({"run_dir": result["run_dir"], "best_validation_nll": result["run"]["best_validation_nll"]}, ensure_ascii=False))
            elif args.command == "evaluate-transformer":
                result = module.evaluate_run(
                    args.run_dir, args.corpus_manifest, args.candidate_manifest,
                    device_name=args.device,
                )
                print(json.dumps(result, ensure_ascii=False, indent=2))
            else:
                result = module.finalize_run(
                    args.run_dir, args.corpus_manifest, args.candidate_manifest,
                    device_name=args.device,
                )
                print(json.dumps({
                    "run_dir": str(args.run_dir),
                    "validation_nll": result["results"]["validation"]["overall"]["nll"],
                    "test_nll": result["results"]["test"]["overall"]["nll"],
                }, ensure_ascii=False))
        except KeyboardInterrupt:
            print("中断しました。設定を変えて再実行すると新しいrunが作成されます。", file=sys.stderr)
            return 130
        except (OSError, ValueError, KeyError, json.JSONDecodeError, ImportError) as error:
            parser.error(str(error))
        return 0
    parsed = PlainChordParser().parse(args.chord)
    event = normalize(
        parsed,
        global_key=KeyAnnotation(args.key, "user") if args.key else None,
        local_key=KeyAnnotation(args.local_key, "user") if args.local_key else None,
    )
    print(json.dumps(asdict(event), ensure_ascii=False, indent=2))
    return 1 if parsed.status in {"failure", "partial"} else 0


if __name__ == "__main__":
    raise SystemExit(main())
