"""Small, session-scoped sparse retrieval for tabular RAG.

The index stores one BM25 term-frequency document per 100-row block. After
retrieving blocks, it ranks the rows inside only those blocks and returns
short, row-numbered evidence snippets. This keeps memory and response sizes
bounded without a hosted vector database or local embedding model.
"""

from __future__ import annotations

import math
import re
from collections import Counter, defaultdict
from dataclasses import dataclass
from typing import Any

import pandas as pd


TOKEN_RE = re.compile(r"[a-z0-9]+", re.IGNORECASE)
STOP_WORDS = {
    "a", "about", "after", "all", "an", "and", "are", "as", "at", "be", "before",
    "by", "can", "dataset", "do", "does", "find", "for", "from", "give", "has", "have",
    "how", "i", "in", "is", "it", "me", "my", "of", "on", "or", "our", "please",
    "show", "summarize", "tell", "that", "the", "this", "to", "what", "which", "with",
    "would", "you", "your",
}
CHUNK_ROWS = 100
MAX_CELL_CHARS = 160
MAX_CHUNK_CHARS = 24_000


def _tokens(text: str) -> list[str]:
    terms: list[str] = []
    for raw in TOKEN_RE.findall(text.casefold()):
        if raw in STOP_WORDS or len(raw) < 2:
            continue
        term = raw
        if len(term) > 6 and term.endswith("ies"):
            term = term[:-3] + "y"
        elif len(term) > 5 and term.endswith("ing"):
            term = term[:-3]
        elif len(term) > 4 and term.endswith("es"):
            term = term[:-2]
        elif len(term) > 3 and term.endswith("s"):
            term = term[:-1]
        terms.append(term)
    return terms


def _text_value(value: Any) -> str:
    if value is None:
        return ""
    try:
        if pd.isna(value):
            return ""
    except (TypeError, ValueError):
        pass
    return str(value).replace("\r", " ").replace("\n", " ")[:MAX_CELL_CHARS]


def _row_text(columns: list[str], values: tuple[Any, ...], row_number: int) -> str:
    fields = [f"row {row_number}"]
    fields.extend(f"{name}: {_text_value(value)}" for name, value in zip(columns, values))
    return " | ".join(fields)


@dataclass
class _Chunk:
    start: int
    stop: int
    terms: Counter[str]
    length: int


class TabularBM25:
    """In-memory BM25 index over bounded row blocks, rebuilt per data version."""

    def __init__(self, frame: pd.DataFrame):
        self.row_count = len(frame)
        self.columns = [str(name) for name in frame.columns]
        self.chunks: list[_Chunk] = []
        document_frequency: Counter[str] = Counter()
        total_length = 0
        rows = frame.itertuples(index=False, name=None)
        pending: list[str] = []
        chunk_start = 0
        for row_number, values in enumerate(rows, start=1):
            text = _row_text(self.columns, values, row_number)
            if pending and (len(pending) >= CHUNK_ROWS or sum(map(len, pending)) + len(text) > MAX_CHUNK_CHARS):
                chunk = self._make_chunk(chunk_start, row_number - 1, pending)
                self.chunks.append(chunk)
                document_frequency.update(chunk.terms.keys())
                total_length += chunk.length
                pending = []
                chunk_start = row_number - 1
            pending.append(text)
        if pending:
            chunk = self._make_chunk(chunk_start, self.row_count, pending)
            self.chunks.append(chunk)
            document_frequency.update(chunk.terms.keys())
            total_length += chunk.length
        self.document_frequency = document_frequency
        self.average_chunk_length = total_length / max(len(self.chunks), 1)

    @staticmethod
    def _make_chunk(start: int, stop: int, lines: list[str]) -> _Chunk:
        terms = Counter(_tokens(" ".join(lines)))
        return _Chunk(start=start, stop=stop, terms=terms, length=sum(terms.values()))

    def _idf(self, term: str) -> float:
        count = self.document_frequency.get(term, 0)
        size = len(self.chunks)
        return math.log(1 + (size - count + 0.5) / (count + 0.5))

    def _score(self, terms: Counter[str], length: int, query: list[str], average_length: float, k1: float = 1.5, b: float = 0.75) -> float:
        score = 0.0
        for term in set(query):
            frequency = terms.get(term, 0)
            if not frequency:
                continue
            denominator = frequency + k1 * (1 - b + b * length / max(average_length, 1))
            score += self._idf(term) * frequency * (k1 + 1) / denominator
        return score

    def search(self, frame: pd.DataFrame, query: str, top_k: int = 5, candidate_chunks: int = 4) -> list[dict[str, Any]]:
        if not self.chunks or not query.strip():
            return []
        query_terms = _tokens(query[:2000])
        if not query_terms:
            return []
        chunk_scores = [self._score(chunk.terms, chunk.length, query_terms, self.average_chunk_length) for chunk in self.chunks]
        relevant = sorted((i for i, score in enumerate(chunk_scores) if score > 0), key=lambda i: chunk_scores[i], reverse=True)[:candidate_chunks]
        if not relevant:
            return []

        candidate_rows: list[int] = []
        for chunk_index in relevant:
            chunk = self.chunks[chunk_index]
            candidate_rows.extend(range(max(0, chunk.start), min(len(frame), chunk.stop)))
        if not candidate_rows:
            return []

        candidates: list[tuple[float, int, Counter[str], str]] = []
        total_terms = 0
        for row_index in candidate_rows:
            values = tuple(frame.iloc[row_index].tolist())
            text = _row_text(self.columns, values, row_index + 1)
            terms = Counter(_tokens(text))
            length = sum(terms.values())
            total_terms += length
            candidates.append((0.0, row_index, terms, text))
        average_length = total_terms / max(len(candidates), 1)
        ranked = []
        for _, row_index, terms, text in candidates:
            score = self._score(terms, sum(terms.values()), query_terms, average_length)
            if score > 0:
                ranked.append((score, row_index, text))
        ranked.sort(key=lambda item: (-item[0], item[1]))
        sources = []
        for score, row_index, text in ranked[:max(1, min(top_k, 8))]:
            sources.append({
                "row_number": row_index + 1,
                "score": round(float(score), 4),
                "snippet": text[:900],
            })
        return sources


def build_tabular_index(frame: pd.DataFrame) -> TabularBM25:
    return TabularBM25(frame)
