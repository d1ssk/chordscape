"""Validated dataset provenance and checksum-locked acquisition helpers."""
from __future__ import annotations

from datetime import date, datetime, timezone
import fnmatch
import hashlib
import json
from pathlib import Path, PurePosixPath
import stat
import tarfile
from typing import Any, Dict, Iterable, List, Optional
from urllib.parse import urlparse
from urllib.request import Request, urlopen
import zipfile


PROJECT_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_CATALOG = PROJECT_ROOT / "datasets" / "catalog.json"
DEFAULT_RAW_ROOT = PROJECT_ROOT / "data" / "raw"
RIGHTS_VALUES = {"allowed", "conditional", "prohibited", "unclear", "review_required"}
ACQUISITION_VALUES = {
    "collected",
    "collected_local_only",
    "not_collected",
    "blocked_by_license_scope",
}
COLLECTED_VALUES = {"collected", "collected_local_only"}


class CatalogError(ValueError):
    """Raised when provenance or an acquired artifact is invalid."""


def load_catalog(path: Path = DEFAULT_CATALOG) -> Dict[str, Any]:
    with path.open(encoding="utf-8") as handle:
        catalog = json.load(handle)
    validate_catalog(catalog)
    return catalog


def validate_catalog(catalog: Dict[str, Any]) -> None:
    if catalog.get("schema_version") != 1:
        raise CatalogError("catalog schema_version must be 1")
    _iso_date(catalog.get("researched_at"), "researched_at")
    if not isinstance(catalog.get("notice"), str) or not catalog["notice"].strip():
        raise CatalogError("catalog notice is required")
    datasets = catalog.get("datasets")
    if not isinstance(datasets, list) or not datasets:
        raise CatalogError("catalog datasets must be a non-empty list")
    ids = set()
    for dataset in datasets:
        _validate_dataset(dataset)
        dataset_id = dataset["id"]
        if dataset_id in ids:
            raise CatalogError(f"duplicate dataset id: {dataset_id}")
        ids.add(dataset_id)


def _validate_dataset(dataset: Dict[str, Any]) -> None:
    required_text = ("id", "source", "version", "url", "conversion_notes")
    for field in required_text:
        if not isinstance(dataset.get(field), str) or not dataset[field].strip():
            raise CatalogError(f"dataset {dataset.get('id', '<unknown>')}: {field} is required")
    if not isinstance(dataset.get("styles"), list) or not dataset["styles"]:
        raise CatalogError(f"dataset {dataset['id']}: styles are required")
    if any(style not in {"pop", "jazz", "classical"} for style in dataset["styles"]):
        raise CatalogError(f"dataset {dataset['id']}: invalid style")

    license_info = dataset.get("license")
    if not isinstance(license_info, dict):
        raise CatalogError(f"dataset {dataset['id']}: license object is required")
    for field in ("name", "url", "scope", "evidence_url"):
        if not isinstance(license_info.get(field), str) or not license_info[field].strip():
            raise CatalogError(f"dataset {dataset['id']}: license.{field} is required")

    rights = dataset.get("rights")
    if not isinstance(rights, dict):
        raise CatalogError(f"dataset {dataset['id']}: rights object is required")
    for field in ("download", "raw_redistribution", "normalized_redistribution", "derived_artifacts"):
        if rights.get(field) not in RIGHTS_VALUES:
            raise CatalogError(f"dataset {dataset['id']}: invalid rights.{field}")
    if not isinstance(rights.get("notes"), str) or not rights["notes"].strip():
        raise CatalogError(f"dataset {dataset['id']}: rights.notes is required")

    acquisition = dataset.get("acquisition")
    if not isinstance(acquisition, dict) or acquisition.get("status") not in ACQUISITION_VALUES:
        raise CatalogError(f"dataset {dataset['id']}: invalid acquisition status")
    for field in ("method", "reason"):
        if not isinstance(acquisition.get(field), str) or not acquisition[field].strip():
            raise CatalogError(f"dataset {dataset['id']}: acquisition.{field} is required")
    if "download_date" not in acquisition:
        raise CatalogError(f"dataset {dataset['id']}: acquisition.download_date is required")
    download_date = acquisition.get("download_date")
    if download_date is not None:
        _iso_date(download_date, f"dataset {dataset['id']} download_date")
    artifacts = acquisition.get("artifacts")
    if not isinstance(artifacts, list):
        raise CatalogError(f"dataset {dataset['id']}: artifacts must be a list")
    if acquisition["status"] in COLLECTED_VALUES and (download_date is None or not artifacts):
        raise CatalogError(f"dataset {dataset['id']}: collected data needs date and artifacts")
    if acquisition["status"] not in COLLECTED_VALUES and artifacts:
        raise CatalogError(f"dataset {dataset['id']}: uncollected data cannot lock artifacts")
    allowlist = acquisition.get("allowlist")
    if allowlist is not None:
        if not isinstance(allowlist, str) or not allowlist.endswith(".json"):
            raise CatalogError(f"dataset {dataset['id']}: acquisition.allowlist must be a JSON path")
        _safe_relative(allowlist)
    for artifact in artifacts:
        _validate_artifact(dataset["id"], artifact)


def _validate_artifact(dataset_id: str, artifact: Dict[str, Any]) -> None:
    for field in ("download_url", "path", "sha256"):
        if not isinstance(artifact.get(field), str) or not artifact[field].strip():
            raise CatalogError(f"dataset {dataset_id}: artifact {field} is required")
    if urlparse(artifact["download_url"]).scheme != "https":
        raise CatalogError(f"dataset {dataset_id}: downloads must use HTTPS")
    _safe_relative(artifact["path"])
    extract_to = artifact.get("extract_to")
    if extract_to is not None:
        _safe_relative(extract_to)
        if not artifact["path"].endswith((".tar.gz", ".zip")):
            raise CatalogError(f"dataset {dataset_id}: only .tar.gz and .zip extraction is supported")
    prefixes = artifact.get("extract_prefixes")
    if prefixes is not None:
        if not artifact["path"].endswith(".zip") or not extract_to:
            raise CatalogError(f"dataset {dataset_id}: extract_prefixes requires ZIP extraction")
        if not isinstance(prefixes, list) or not prefixes:
            raise CatalogError(f"dataset {dataset_id}: extract_prefixes must be a non-empty list")
        for prefix in prefixes:
            if not isinstance(prefix, str) or not prefix:
                raise CatalogError(f"dataset {dataset_id}: invalid extraction prefix")
            _safe_relative(prefix.rstrip("/"))
    globs = artifact.get("extract_globs")
    if globs is not None:
        if not artifact["path"].endswith(".tar.gz") or not extract_to:
            raise CatalogError(f"dataset {dataset_id}: extract_globs requires TAR.GZ extraction")
        if not isinstance(globs, list) or not globs:
            raise CatalogError(f"dataset {dataset_id}: extract_globs must be a non-empty list")
        for pattern in globs:
            if not isinstance(pattern, str) or not pattern:
                raise CatalogError(f"dataset {dataset_id}: invalid extraction glob")
            if pattern.startswith("/") or ".." in PurePosixPath(pattern).parts:
                raise CatalogError(f"dataset {dataset_id}: unsafe extraction glob")
    sha256 = artifact["sha256"]
    if len(sha256) != 64 or any(char not in "0123456789abcdef" for char in sha256):
        raise CatalogError(f"dataset {dataset_id}: invalid SHA-256")
    if type(artifact.get("bytes")) is not int or artifact["bytes"] <= 0:
        raise CatalogError(f"dataset {dataset_id}: artifact bytes must be positive")


def _iso_date(value: Any, field: str) -> None:
    if not isinstance(value, str):
        raise CatalogError(f"{field} must be an ISO date")
    try:
        date.fromisoformat(value)
    except ValueError as error:
        raise CatalogError(f"{field} must be an ISO date") from error


def _safe_relative(value: str) -> PurePosixPath:
    path = PurePosixPath(value)
    if path.is_absolute() or not path.parts or any(part in {"", ".", ".."} for part in path.parts):
        raise CatalogError(f"unsafe relative path: {value!r}")
    return path


def dataset_by_id(catalog: Dict[str, Any], dataset_id: str) -> Dict[str, Any]:
    for dataset in catalog["datasets"]:
        if dataset["id"] == dataset_id:
            return dataset
    raise CatalogError(f"unknown dataset: {dataset_id}")


def verify_acquisitions(
    catalog: Dict[str, Any], raw_root: Path = DEFAULT_RAW_ROOT, dataset_id: Optional[str] = None
) -> List[str]:
    errors: List[str] = []
    datasets: Iterable[Dict[str, Any]] = catalog["datasets"]
    if dataset_id is not None:
        datasets = (dataset_by_id(catalog, dataset_id),)
    for dataset in datasets:
        if dataset["acquisition"]["status"] not in COLLECTED_VALUES:
            continue
        for artifact in dataset["acquisition"]["artifacts"]:
            path = raw_root.joinpath(*_safe_relative(artifact["path"]).parts)
            if not path.is_file():
                errors.append(f"{dataset['id']}: missing {artifact['path']}")
                continue
            size = path.stat().st_size
            if size != artifact["bytes"]:
                errors.append(f"{dataset['id']}: size mismatch for {artifact['path']}: {size}")
                continue
            digest = _sha256(path)
            if digest != artifact["sha256"]:
                errors.append(f"{dataset['id']}: checksum mismatch for {artifact['path']}")
    return errors


def fetch_dataset(
    catalog: Dict[str, Any], dataset_id: str, raw_root: Path = DEFAULT_RAW_ROOT
) -> Dict[str, Any]:
    dataset = dataset_by_id(catalog, dataset_id)
    acquisition = dataset["acquisition"]
    if acquisition["status"] not in COLLECTED_VALUES:
        raise CatalogError(
            f"{dataset_id} is not approved for automated acquisition: {acquisition['status']}"
        )
    raw_root.mkdir(parents=True, exist_ok=True)
    receipt_artifacts = []
    for artifact in acquisition["artifacts"]:
        destination = raw_root.joinpath(*_safe_relative(artifact["path"]).parts)
        destination.parent.mkdir(parents=True, exist_ok=True)
        if not destination.exists() or not _matches_lock(destination, artifact):
            _download(artifact["download_url"], destination)
        if not _matches_lock(destination, artifact):
            raise CatalogError(f"download does not match lock: {artifact['path']}")
        if artifact.get("extract_to"):
            extract_root = raw_root.joinpath(*_safe_relative(artifact["extract_to"]).parts)
            if destination.name.endswith(".tar.gz"):
                _extract_tar_gz(destination, extract_root, artifact.get("extract_globs"))
            else:
                _extract_zip(destination, extract_root, artifact.get("extract_prefixes"))
        receipt_artifact = {
            "path": artifact["path"],
            "sha256": artifact["sha256"],
            "bytes": artifact["bytes"],
        }
        for field in ("extract_to", "extract_prefixes", "extract_globs"):
            if field in artifact:
                receipt_artifact[field] = artifact[field]
        receipt_artifacts.append(receipt_artifact)
    receipt = {
        "source": dataset["source"],
        "version": dataset["version"],
        "url": dataset["url"],
        "license": dataset["license"]["name"],
        "download_date": datetime.now(timezone.utc).astimezone().date().isoformat(),
        "conversion_notes": dataset["conversion_notes"],
        "acquisition_status": acquisition["status"],
        "catalog_schema_version": catalog["schema_version"],
        "artifacts": receipt_artifacts,
    }
    if "allowlist" in acquisition:
        receipt["allowlist"] = acquisition["allowlist"]
    receipt_path = raw_root / dataset_id / "receipt.json"
    receipt_path.parent.mkdir(parents=True, exist_ok=True)
    receipt_path.write_text(json.dumps(receipt, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return receipt


def _matches_lock(path: Path, artifact: Dict[str, Any]) -> bool:
    return path.is_file() and path.stat().st_size == artifact["bytes"] and _sha256(path) == artifact["sha256"]


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _download(url: str, destination: Path) -> None:
    if urlparse(url).scheme != "https":
        raise CatalogError("refusing non-HTTPS download")
    temporary = destination.with_name(destination.name + ".part")
    request = Request(url, headers={"User-Agent": "Chordscape-harmony-data/1"})
    try:
        with urlopen(request, timeout=120) as response, temporary.open("wb") as output:
            while chunk := response.read(1024 * 1024):
                output.write(chunk)
        temporary.replace(destination)
    finally:
        if temporary.exists():
            temporary.unlink()


def _extract_tar_gz(
    archive: Path, destination: Path, include_globs: Optional[List[str]] = None
) -> None:
    destination.mkdir(parents=True, exist_ok=True)
    resolved_root = destination.resolve()
    with tarfile.open(archive, "r:gz") as bundle:
        all_members = bundle.getmembers()
        members = [
            member
            for member in all_members
            if include_globs is None
            or any(fnmatch.fnmatchcase(member.name, pattern) for pattern in include_globs)
        ]
        if include_globs is not None:
            missing = [
                pattern
                for pattern in include_globs
                if not any(fnmatch.fnmatchcase(member.name, pattern) for member in members)
            ]
            if missing:
                raise CatalogError(f"TAR extraction globs not found: {missing}")
        for member in members:
            if member.issym() or member.islnk() or not (member.isfile() or member.isdir()):
                raise CatalogError(f"unsupported archive member: {member.name!r}")
            target = (destination / member.name).resolve()
            try:
                target.relative_to(resolved_root)
            except ValueError as error:
                raise CatalogError(f"unsafe archive member: {member.name!r}") from error
        bundle.extractall(destination, members=members)


def _extract_zip(archive: Path, destination: Path, prefixes: Optional[List[str]] = None) -> None:
    destination.mkdir(parents=True, exist_ok=True)
    resolved_root = destination.resolve()
    with zipfile.ZipFile(archive) as bundle:
        selected = []
        for member in bundle.infolist():
            if prefixes is not None and not any(member.filename.startswith(prefix) for prefix in prefixes):
                continue
            relative = _safe_relative(member.filename.rstrip("/"))
            unix_mode = member.external_attr >> 16
            if stat.S_ISLNK(unix_mode):
                raise CatalogError(f"unsupported archive member: {member.filename!r}")
            target = destination.joinpath(*relative.parts).resolve()
            try:
                target.relative_to(resolved_root)
            except ValueError as error:
                raise CatalogError(f"unsafe archive member: {member.filename!r}") from error
            selected.append(member)
        if prefixes is not None:
            missing = [prefix for prefix in prefixes if not any(m.filename.startswith(prefix) for m in selected)]
            if missing:
                raise CatalogError(f"ZIP extraction prefixes not found: {missing}")
        bundle.extractall(destination, members=selected)
