"""Command-line entry point for provenance validation and safe acquisition."""
from __future__ import annotations

import argparse

from .dataset_catalog import CatalogError, fetch_dataset, load_catalog, verify_acquisitions


def main() -> int:
    parser = argparse.ArgumentParser(description="教師データの来歴・取得状態を管理します")
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("list", help="dataset と取得・権利状態を一覧表示")
    verify = commands.add_parser("verify", help="catalog と取得済み checksum を検証")
    verify.add_argument("dataset", nargs="?", help="省略時は取得済み dataset 全件")
    fetch = commands.add_parser("fetch", help="許可済み dataset を checksum 固定で取得")
    fetch.add_argument("dataset")
    args = parser.parse_args()

    try:
        catalog = load_catalog()
        if args.command == "list":
            for dataset in catalog["datasets"]:
                rights = dataset["rights"]
                print(
                    f"{dataset['id']}\t{dataset['acquisition']['status']}\t"
                    f"raw={rights['raw_redistribution']}\tderived={rights['derived_artifacts']}"
                )
            return 0
        if args.command == "verify":
            errors = verify_acquisitions(catalog, dataset_id=args.dataset)
            if errors:
                for error in errors:
                    print(error)
                return 1
            print("catalog and acquired artifacts: ok")
            return 0
        receipt = fetch_dataset(catalog, args.dataset)
        print(f"fetched {args.dataset} on {receipt['download_date']}")
        return 0
    except (CatalogError, OSError) as error:
        print(f"error: {error}")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
