"""Embeddings for the prototype.

The default `hash` backend is deterministic, dependency-free and good enough
for the synthetic corpus: normalised token n-grams are hashed into a fixed
vector, so identical wording maps to identical vectors and Arabic/English
shares no accidental structure. Set EMBED_BACKEND=bge-m3 (requires the `ml`
extra) for real multilingual embeddings before the bilingual evaluation.
"""

import hashlib
import math
import re

from rca.retrieval.normalise_ar import normalise

_DIM = 1024
_token_re = re.compile(r"[\w\u0600-\u06FF]+")

_embed_fn = None


def _hash_embed_one(text: str) -> list[float]:
    vec = [0.0] * _DIM
    tokens = _token_re.findall(normalise(text))
    grams = tokens + [f"{a}_{b}" for a, b in zip(tokens, tokens[1:], strict=False)]
    for g in grams:
        h = hashlib.blake2b(g.encode(), digest_size=16).digest()
        idx = int.from_bytes(h[:8], "little") % _DIM
        sign = 1.0 if h[8] & 1 else -1.0
        vec[idx] += sign
    norm = math.sqrt(sum(v * v for v in vec)) or 1.0
    return [v / norm for v in vec]


def _bge_embed(texts: list[str]):
    from functools import lru_cache

    @lru_cache
    def model():
        from sentence_transformers import SentenceTransformer

        from rca.settings import get_settings

        return SentenceTransformer(
            get_settings().embed_model if hasattr(get_settings(), "embed_model") else "BAAI/bge-m3"
        )

    out = model().encode(texts, normalize_embeddings=True, batch_size=16)
    return [list(map(float, row)) for row in out]


def embed(texts: list[str]) -> list[list[float]]:
    if not texts:
        return []
    from rca.settings import get_settings

    backend = get_settings().embed_backend
    if backend == "bge-m3":
        return _bge_embed(texts)
    return [_hash_embed_one(t) for t in texts]


def cosine(a: list[float], b: list[float]) -> float:
    return sum(x * y for x, y in zip(a, b, strict=False))
