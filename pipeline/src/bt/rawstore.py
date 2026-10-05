"""Raw store: every fetched artifact is kept byte-for-byte so extraction can be re-run
and quotes re-verified. Local directory today; the key layout maps 1:1 onto an S3 prefix."""

from __future__ import annotations

import hashlib
from dataclasses import dataclass
from pathlib import Path

from bt.config import settings


@dataclass(frozen=True)
class StoredObject:
    key: str
    path: Path
    sha256: str
    size: int

    @property
    def uri(self) -> str:
        return f"raw://{self.key}"


def root() -> Path:
    return settings().raw_store


def path_for(key: str) -> Path:
    p = (root() / key).resolve()
    if root().resolve() not in p.parents:
        raise ValueError(f"raw key escapes store: {key}")
    return p


def exists(key: str) -> bool:
    return path_for(key).exists()


def read(key: str) -> bytes:
    return path_for(key).read_bytes()


def put(key: str, data: bytes) -> StoredObject:
    p = path_for(key)
    p.parent.mkdir(parents=True, exist_ok=True)
    tmp = p.with_suffix(p.suffix + ".tmp")
    tmp.write_bytes(data)
    tmp.replace(p)
    return StoredObject(key, p, hashlib.sha256(data).hexdigest(), len(data))


def describe(key: str) -> StoredObject:
    p = path_for(key)
    data = p.read_bytes()
    return StoredObject(key, p, hashlib.sha256(data).hexdigest(), len(data))


def sec_key(cik: str | int, accession: str, filename: str) -> str:
    return f"sec/{int(cik)}/{accession}/{filename}"
