from __future__ import annotations

import math
import re
from typing import Any

import numpy as np
import pandas as pd


def column_id(index: int) -> str:
    return f"col_{index:03d}"


def display(value: Any) -> Any:
    if pd.isna(value):
        return None
    if hasattr(value, "item"):
        try:
            value = value.item()
        except (ValueError, TypeError):
            pass
    if isinstance(value, pd.Timestamp):
        return value.isoformat()
    if isinstance(value, (str, int, float, bool)) or value is None:
        if isinstance(value, float) and not math.isfinite(value):
            return None
        return value
    return str(value)


def frame_rows(frame: pd.DataFrame, limit: int = 10) -> list[dict[str, Any]]:
    return [
        {str(column): display(value) for column, value in row.items()}
        for row in frame.head(limit).to_dict(orient="records")
    ]


def _numeric_outlier_count(series: pd.Series) -> int:
    values = pd.to_numeric(series, errors="coerce").dropna()
    if len(values) < 4:
        return 0
    q1, q3 = values.quantile([0.25, 0.75])
    spread = q3 - q1
    if spread == 0:
        return 0
    return int(((values < q1 - 1.5 * spread) | (values > q3 + 1.5 * spread)).sum())


def build_profile(frame: pd.DataFrame) -> dict[str, Any]:
    columns: list[dict[str, Any]] = []
    for index, name in enumerate(frame.columns):
        series = frame.iloc[:, index]
        missing = int(series.isna().sum())
        non_missing = series.dropna()
        numeric = pd.api.types.is_numeric_dtype(series.dtype) and not pd.api.types.is_bool_dtype(series.dtype)
        boolean = pd.api.types.is_bool_dtype(series.dtype)
        text_values = non_missing[non_missing.map(lambda value: isinstance(value, str))]
        whitespace_count = int(text_values.map(lambda value: value != value.strip()).sum())
        case_groups: dict[str, set[str]] = {}
        for value in text_values:
            case_groups.setdefault(value.strip().casefold(), set()).add(value.strip())
        case_variant_count = sum(len(values) > 1 for values in case_groups.values())
        date_parse_rate = 0.0
        parsed_dates: pd.Series | None = None
        if len(text_values):
            parsed_dates = pd.to_datetime(text_values, errors="coerce", format="mixed")
            date_parse_rate = round(float(parsed_dates.notna().mean()), 3)
        name_hint = any(word in str(name).casefold() for word in ("date", "time", "created", "updated", "signup"))
        kind = "number" if numeric else "boolean" if boolean else "datetime" if date_parse_rate >= 0.8 and name_hint else "text"
        stats: dict[str, Any] = {}
        if numeric:
            values = pd.to_numeric(series, errors="coerce")
            stats = {key: display(value) for key, value in values.describe().to_dict().items()}
            stats["median"] = display(values.median())
        elif kind == "datetime" and parsed_dates is not None:
            valid_dates = parsed_dates.dropna()
            stats = {"min": display(valid_dates.min()) if len(valid_dates) else None, "max": display(valid_dates.max()) if len(valid_dates) else None}
        else:
            stats = {"top_values": series.value_counts(dropna=True).head(5).to_dict()}
        columns.append({
            "column_id": column_id(index),
            "name": str(name),
            "type": kind,
            "missing_count": missing,
            "missing_rate": round(missing / max(len(frame), 1), 4),
            "unique_count": int(series.nunique(dropna=True)),
            "whitespace_count": whitespace_count,
            "case_variant_count": case_variant_count,
            "outlier_count": _numeric_outlier_count(series) if numeric else 0,
            "date_parse_rate": date_parse_rate,
            "sample_values": [display(value) for value in non_missing.head(4).tolist()],
            "statistics": stats,
        })
    rows, column_count = frame.shape
    cells = rows * column_count
    missing_cells = int(frame.isna().sum().sum())
    type_counts = {kind: sum(column["type"] == kind for column in columns) for kind in ("number", "text", "datetime", "boolean")}
    issues: list[dict[str, Any]] = []

    def add_issue(issue_type: str, affected: list[str], count: int, examples: list[Any], severity: str, recommendation: str, confirmed: bool = True) -> None:
        if count <= 0:
            return
        issues.append({"issue_type": issue_type, "columns": affected, "count": count, "examples": examples[:4], "severity": severity, "recommendation": recommendation, "confirmed": confirmed})

    for index, column in enumerate(columns):
        series = frame.iloc[:, index]
        if column["missing_count"]:
            add_issue("missing_values", [column["name"]], column["missing_count"], [], "medium", "Review the affected field and choose an explicit fill strategy or leave it missing.")
        if column["whitespace_count"]:
            add_issue("surrounding_whitespace", [column["name"]], column["whitespace_count"], [value for value in column["sample_values"] if isinstance(value, str) and value != value.strip()], "low", "Trim leading and trailing spaces after reviewing the preview.")
        if column["case_variant_count"]:
            add_issue("category_case_variants", [column["name"]], column["case_variant_count"], column["sample_values"], "low", "Review case normalization; differently cased labels may have distinct meanings.", False)
        if column["outlier_count"]:
            values = pd.to_numeric(series, errors="coerce").dropna()
            q1, q3 = values.quantile([0.25, 0.75])
            spread = q3 - q1
            examples = values[(values < q1 - 1.5 * spread) | (values > q3 + 1.5 * spread)].head(4).tolist() if spread else []
            add_issue("possible_outliers", [column["name"]], column["outlier_count"], examples, "review", "Inspect the flagged values. The IQR rule identifies unusual values, not necessarily errors.", False)
        if column["unique_count"] == 1 and rows > 1:
            add_issue("constant_column", [column["name"]], rows, column["sample_values"], "low", "Consider whether this field is useful before optionally dropping it.", False)
        if rows > 0 and column["unique_count"] / rows >= 0.95 and rows >= 20:
            add_issue("high_cardinality", [column["name"]], column["unique_count"], column["sample_values"], "low", "This field is nearly unique; it may be an identifier rather than a category.", False)
        if re.search(r"(^id$|_id$|\bid\b|uuid|identifier)", column["name"], re.IGNORECASE) and column["unique_count"] >= max(1, int(rows * 0.8)):
            add_issue("potential_identifier", [column["name"]], column["unique_count"], column["sample_values"], "low", "Treat this column as an identifier and do not impute or normalize it automatically.", False)
        if re.search(r"(^|[_\W])(id|email|phone|uuid|identifier)([_\W]|$)", column["name"], re.IGNORECASE):
            repeated = series.dropna()[series.dropna().duplicated(keep=False)]
            duplicate_values = int(series.dropna().duplicated().sum())
            add_issue("possible_duplicate_records", [column["name"]], duplicate_values, repeated.astype(str).head(4).tolist(), "review", "Repeated identifier-like values may indicate duplicate records. Inspect the records before deciding what to remove.", False)
        if re.search(r"email|e_mail", column["name"], re.IGNORECASE):
            non_empty = series.dropna().astype(str)
            invalid = non_empty[~non_empty.str.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", na=False)]
            add_issue("invalid_email_format", [column["name"]], len(invalid), invalid.head(4).tolist(), "medium", "Review malformed values; identity data will not be guessed.")
        if column["type"] == "text" and len(series.dropna()) >= 4:
            numeric_cast = pd.to_numeric(series, errors="coerce")
            parse_rate = float(numeric_cast.notna().sum() / max(series.notna().sum(), 1))
            if parse_rate >= 0.8 and series.notna().any():
                add_issue("numeric_values_stored_as_text", [column["name"]], int(numeric_cast.notna().sum()), series.dropna().head(4).tolist(), "medium", "Convert valid values to numbers after checking the unparseable values.")
        if column["type"] == "text" and column["date_parse_rate"] >= 0.5:
            invalid_count = int(series.notna().sum() - pd.to_datetime(series, errors="coerce", format="mixed").notna().sum())
            add_issue("inconsistent_date_formats", [column["name"]], invalid_count or int(column["date_parse_rate"] * series.notna().sum()), series.dropna().head(4).tolist(), "low", "Standardize parseable dates; values that fail parsing should remain unchanged.", False)
    duplicates = int(frame.duplicated().sum())
    add_issue("exact_duplicate_rows", [], duplicates, [], "review", "Preview the row loss and explicitly approve duplicate removal.")
    completeness = round((1 - missing_cells / cells) * 100, 1) if cells else 0.0
    return {
        "rows": int(rows), "columns_count": int(column_count), "missing_cells": missing_cells,
        "missing_rate": round(missing_cells / max(cells, 1), 4), "duplicate_rows": duplicates,
        "duplicate_headers": 0, "completeness_score": completeness, "completeness_calculation": "100 × (1 − missing cells ÷ total cells)",
        "type_counts": type_counts, "quality_issues": issues, "columns": columns, "sample_rows": frame_rows(frame),
    }


def preview_frame(frame: pd.DataFrame, page: int = 1, page_size: int = 20, search: str = "", sort_by: str | None = None, sort_dir: str = "asc", version: str = "original") -> dict[str, Any]:
    page = max(page, 1)
    page_size = min(max(page_size, 1), 100)
    working = frame
    if sort_by:
        try:
            index = int(sort_by.removeprefix("col_"))
            if index < 0 or index >= len(frame.columns):
                raise ValueError
            working = frame.sort_values(frame.columns[index], ascending=sort_dir != "desc", na_position="last", kind="stable")
        except (ValueError, TypeError, IndexError):
            raise ValueError("Choose a valid column to sort by") from None
    if search.strip():
        text = search.strip()[:120].casefold()
        mask = working.astype("string").apply(lambda series: series.str.casefold().str.contains(text, regex=False, na=False)).any(axis=1)
        working = working.loc[mask]
    total = len(working)
    start = (page - 1) * page_size
    page_frame = working.iloc[start:start + page_size]
    return {"columns": [str(column) for column in frame.columns], "column_ids": [column_id(i) for i in range(len(frame.columns))], "rows": frame_rows(page_frame, page_size), "page": page, "page_size": page_size, "total_rows": total, "total_pages": max(1, math.ceil(total / page_size)), "version": version}


def eda_frame(frame: pd.DataFrame, version: str = "original") -> dict[str, Any]:
    profile = build_profile(frame)
    charts: list[dict[str, Any]] = []
    numeric_indices: list[int] = []
    for index, column in enumerate(profile["columns"]):
        series = frame.iloc[:, index]
        if column["type"] == "number":
            values = pd.to_numeric(series, errors="coerce").dropna()
            numeric_indices.append(index)
            if len(values):
                histogram, edges = np.histogram(values.to_numpy(dtype=float), bins=min(12, max(4, int(math.sqrt(len(values))))) if len(values) > 1 else 1)
                charts.append({"kind": "histogram", "column": column["name"], "data": [{"bin": f"{edges[i]:.3g}–{edges[i + 1]:.3g}", "count": int(histogram[i])} for i in range(len(histogram))]})
        elif column["type"] == "datetime":
            dates = pd.to_datetime(series, errors="coerce", format="mixed").dropna()
            if len(dates):
                counts = dates.dt.to_period("M").astype(str).value_counts().sort_index()
                charts.append({"kind": "time", "column": column["name"], "data": [{"label": label, "count": int(count)} for label, count in counts.items()]})
        else:
            counts = series.dropna().astype(str).value_counts().head(12)
            if len(counts):
                charts.append({"kind": "bar", "column": column["name"], "data": [{"label": str(label)[:80], "count": int(count)} for label, count in counts.items()]})
    correlation: list[dict[str, Any]] = []
    if len(numeric_indices) >= 2:
        numeric = frame.iloc[:, numeric_indices].apply(pd.to_numeric, errors="coerce")
        corr = numeric.corr(min_periods=2)
        for i, name_a in enumerate(numeric.columns):
            for j, name_b in enumerate(numeric.columns):
                value = corr.iloc[i, j]
                if pd.notna(value):
                    correlation.append({"x": str(name_a), "y": str(name_b), "value": round(float(value), 4)})
    scatter = []
    if len(numeric_indices) >= 2:
        left, right = numeric_indices[:2]
        pair = frame.iloc[:, [left, right]].apply(pd.to_numeric, errors="coerce").dropna().head(500)
        scatter = [{"x": display(row.iloc[0]), "y": display(row.iloc[1])} for _, row in pair.iterrows()]
    return {"version": version, "profile": profile, "charts": charts, "correlation": correlation, "scatter": {"x": str(frame.columns[numeric_indices[0]]), "y": str(frame.columns[numeric_indices[1]]), "data": scatter} if scatter else None}


def _find_column(question: str, frame: pd.DataFrame) -> int | None:
    lowered = re.sub(r"[^\w]+", " ", question.casefold().replace("_", " ")).strip()
    candidates = sorted(enumerate(frame.columns), key=lambda item: len(str(item[1])), reverse=True)
    for index, name in candidates:
        normalized = re.sub(r"[^\w]+", " ", str(name).casefold().replace("_", " ")).strip()
        variants = {normalized}
        if normalized.endswith("y"):
            variants.add(normalized[:-1] + "ies")
        if normalized and not normalized.endswith("s"):
            variants.update({normalized + "s", normalized + "es"})
        elif normalized.endswith("s"):
            variants.add(normalized[:-1])
        if any(value and re.search(rf"(?<!\w){re.escape(value)}(?!\w)", lowered) for value in variants):
            return index
    return None


def _column_variants(name: Any) -> set[str]:
    normalized = re.sub(r"[^\w]+", " ", str(name).casefold().replace("_", " ")).strip()
    variants = {normalized}
    if normalized.endswith("y"):
        variants.add(normalized[:-1] + "ies")
    if normalized and not normalized.endswith("s"):
        variants.update({normalized + "s", normalized + "es"})
    elif normalized.endswith("s"):
        variants.add(normalized[:-1])
    return {value for value in variants if value}


def _has_filter_clause(question: str) -> bool:
    return bool(re.search(r"\b(?:where|when)\b", question) and re.search(
        r"(?:\bis not\b|\bis\b|\bequals?\b|\bcontains\b|\bgreater than\b|\bmore than\b|\babove\b|\bover\b|\bless than\b|\bbelow\b|\bunder\b|>=|<=|!=|==|=|>|<)",
        question,
    ))


def _parse_filter(question: str, frame: pd.DataFrame) -> tuple[int | None, str, str]:
    column_index = _find_column(question, frame)
    if column_index is None:
        return None, "is", ""
    column_variants = sorted(_column_variants(frame.columns[column_index]), key=len, reverse=True)
    column_match = next((re.search(rf"(?<!\w){re.escape(name)}(?!\w)", question) for name in column_variants if re.search(rf"(?<!\w){re.escape(name)}(?!\w)", question)), None)
    if column_match is None:
        return column_index, "is", ""
    tail = question[column_match.end():].strip()
    tail = re.sub(r"^(?:is|are|equal to)\s+", "", tail) if re.match(r"^(?:is|are|equal to)\s+(?:greater|less|at least|at most)", tail) else tail
    operators = [
        (r"^(?:is not|not equal to|does not equal)\s+", "is not"),
        (r"^(?:at least|greater than or equal to|>=)\s*", ">="),
        (r"^(?:at most|less than or equal to|<=)\s*", "<="),
        (r"^(?:greater than|more than|above|over|>)\s*", ">"),
        (r"^(?:less than|below|under|<)\s*", "<"),
        (r"^(?:contains|containing)\s+", "contains"),
        (r"^(?:is|equals?|equal to|==|=)\s+", "is"),
    ]
    for pattern, operator in operators:
        match = re.match(pattern, tail)
        if match:
            value = re.sub(r"[?.!,;]+$", "", tail[match.end():].strip()).strip(" '\"")
            return column_index, operator, value[:120]
    return column_index, "is", re.sub(r"[?.!,;]+$", "", tail).strip(" '\"")[:120]


def analyze_question(
    frame: pd.DataFrame,
    question: str,
    version: str = "original",
    original_frame: pd.DataFrame | None = None,
    cleaned_frame: pd.DataFrame | None = None,
) -> dict[str, Any]:
    text = question.strip()[:1000]
    lowered = text.casefold()
    if not text:
        raise ValueError("Enter a question about this dataset.")
    profile = build_profile(frame)
    matched = _find_column(text, frame)
    result: list[dict[str, Any]] = []
    chart: dict[str, Any] | None = None
    intent = "summary"
    normalized_text = re.sub(r"[^\w]+", " ", lowered.replace("_", " ")).strip()
    named_columns = [i for i in range(len(frame.columns)) if _find_column(normalized_text, frame) == i or any(
        re.search(rf"(?<!\w){re.escape(variant)}(?!\w)", normalized_text)
        for variant in _column_variants(frame.columns[i])
    )]
    if any(word in lowered for word in ("compare original", "compare versions", "what changed", "after preprocessing", "before and after")):
        if cleaned_frame is None:
            raise ValueError("There is no approved cleaned version to compare yet. Preview and apply a cleaning action first.")
        before = build_profile(original_frame if original_frame is not None else frame)
        after = build_profile(cleaned_frame)
        fields = (("rows", "rows"), ("missing cells", "missing_cells"), ("exact duplicates", "duplicate_rows"), ("completeness", "completeness_score"))
        result = [{"measure": label, "original": before[key], "cleaned": after[key], "change": round(float(after[key]) - float(before[key]), 2)} for label, key in fields]
        answer = "Compared the original upload with the approved cleaned working copy. Review the before/after values; a higher completeness score does not guarantee correctness."
        intent = "compare_versions"
        return {"answer": answer, "intent": intent, "version": "comparison", "result": result, "chart": None}
    if any(word in lowered for word in ("quality issue", "quality concern", "data issue", "data problem", "quality signal", "what should i fix", "what needs cleaning", "cleaning issue")):
        issues = profile["quality_issues"]
        result = [{"issue": item["issue_type"], "columns": ", ".join(item["columns"]) or "dataset rows", "count": item["count"], "severity": item["severity"], "recommendation": item["recommendation"]} for item in issues[:20]]
        answer = f"The deterministic checks found {len(issues)} quality signals. These are review cues, not a guarantee that every flagged value is wrong."
        intent = "quality_issues"
    elif any(word in lowered for word in ("trend", "over time", "monthly", "weekly", "daily", "quarterly", "yearly", "by day", "by week", "by month", "by quarter", "by year")):
        date_candidates = [i for i, column in enumerate(profile["columns"]) if column["type"] == "datetime"]
        named_dates = [i for i in named_columns if i in date_candidates]
        if named_dates:
            date_index = named_dates[0]
        elif matched is not None and matched in date_candidates:
            date_index = matched
        elif date_candidates:
            date_index = date_candidates[0]
        else:
            raise ValueError("A date or time column is needed for a trend. Name a field that contains dates.")
        dates = pd.to_datetime(frame.iloc[:, date_index], errors="coerce", format="mixed")
        valid = dates.notna()
        if not valid.any():
            raise ValueError("No parseable dates were found in that field.")
        if "daily" in lowered or "by day" in lowered:
            frequency = "D"
            frequency_name = "day"
        elif "weekly" in lowered or "by week" in lowered:
            frequency = "W"
            frequency_name = "week"
        elif "quarterly" in lowered or "by quarter" in lowered:
            frequency = "Q"
            frequency_name = "quarter"
        elif "yearly" in lowered or "annual" in lowered or "by year" in lowered:
            frequency = "Y"
            frequency_name = "year"
        else:
            frequency = "M"
            frequency_name = "month"
        time_buckets = dates[valid].dt.to_period(frequency).astype(str)
        metric_index = next((i for i in named_columns if i != date_index and profile["columns"][i]["type"] == "number"), None)
        if metric_index is None:
            counts = time_buckets.value_counts().sort_index()
            result = [{"period": period, "count": int(count)} for period, count in counts.items()]
            chart = {"kind": "line", "label": str(frame.columns[date_index]), "data": [{"label": row["period"], "count": row["count"]} for row in result]}
            answer = f"Counted {int(valid.sum()):,} rows with parseable dates, grouped by {frequency_name}."
        else:
            metric = pd.to_numeric(frame.iloc[:, metric_index], errors="coerce")
            grouped = pd.DataFrame({"period": time_buckets, "value": metric[valid]}).dropna()
            operation_match = re.search(r"\b(sum|mean|average|median|min|minimum|max|maximum|count)\b", lowered)
            requested_operation = operation_match.group(1) if operation_match else "sum"
            operation = {"average": "mean", "minimum": "min", "maximum": "max"}.get(requested_operation, requested_operation)
            aggregate = grouped.groupby("period")["value"].agg(operation).sort_index()
            result = [{"period": period, operation: display(value)} for period, value in aggregate.items()]
            chart = {"kind": "line", "label": str(frame.columns[metric_index]), "data": [{"label": row["period"], "count": row[operation] if row[operation] is not None else 0} for row in result]}
            answer = f"Calculated {operation} {frame.columns[metric_index]} by {frequency_name} using rows with valid dates and numeric values."
        intent = "time_trend"
    elif any(word in lowered for word in ("row", "record", "show me", "list")) and any(word in lowered for word in ("missing", "null", "empty", "blank")):
        intent = "records_with_missing"
        selected = [matched] if matched is not None else list(range(len(frame.columns)))
        mask = frame.iloc[:, selected].isna().any(axis=1)
        positions = np.flatnonzero(mask.fillna(False).to_numpy())[:20]
        result = [
            {"row_number": int(position) + 1, **{str(column): display(value) for column, value in zip(frame.columns, frame.iloc[position].tolist())}}
            for position in positions
        ]
        answer = f"Showing up to 20 of {int(mask.sum()):,} records with missing values."
    elif _has_filter_clause(lowered):
        intent = "filter_records"
        column_index, operator, value = _parse_filter(lowered, frame)
        if column_index is None:
            raise ValueError("I could not identify the field in that filter. Use a column name from the preview.")
        series = frame.iloc[:, column_index]
        numeric = pd.to_numeric(series, errors="coerce")
        try:
            if operator == "is" and value.casefold() in {"missing", "null", "empty", "blank"}:
                mask = series.isna() | series.astype("string").str.strip().eq("").fillna(False)
            elif operator == "is not" and value.casefold() in {"missing", "null", "empty", "blank"}:
                mask = series.notna() & series.astype("string").str.strip().ne("").fillna(False)
            elif operator in {">", ">=", "<", "<="}:
                target = float(value)
                values = numeric
                mask = {">": values > target, ">=": values >= target, "<": values < target, "<=": values <= target}[operator]
            elif operator == "contains":
                mask = series.astype("string").str.casefold().str.contains(value.casefold(), regex=False, na=False)
            elif operator in {"is", "is not"} and pd.api.types.is_numeric_dtype(series.dtype):
                target = float(value)
                matched = numeric.eq(target)
                mask = (~matched & series.notna()) if operator == "is not" else matched
            elif operator == "is not":
                mask = series.astype("string").str.casefold().ne(value.casefold()) & series.notna()
            else:
                mask = series.astype("string").str.casefold().eq(value.casefold())
        except ValueError:
            raise ValueError("Numeric filters need a number, for example ‘age greater than 30’.") from None
        positions = np.flatnonzero(mask.fillna(False).to_numpy())[:20]
        result = [
            {"row_number": int(position) + 1, **{str(column): display(value) for column, value in zip(frame.columns, frame.iloc[position].tolist())}}
            for position in positions
        ]
        answer = f"Found {int(mask.sum()):,} rows where {frame.columns[column_index]} {operator} {value}; showing up to 20."
    elif any(word in lowered for word in ("missing", "null", "empty", "blank")):
        intent = "missing"
        if matched is None:
            result = [{"column": c["name"], "missing": c["missing_count"], "percent": round(c["missing_rate"] * 100, 1)} for c in profile["columns"]]
            answer = f"The dataset has {profile['missing_cells']:,} missing cells across {profile['rows']:,} rows."
        else:
            column = profile["columns"][matched]
            result = [{"column": column["name"], "missing": column["missing_count"], "percent": round(column["missing_rate"] * 100, 1)}]
            answer = f"{column['name']} has {column['missing_count']:,} missing values ({column['missing_rate'] * 100:.1f}% of rows)."
    elif "correlat" in lowered:
        intent = "correlation"
        numeric_columns = [i for i, c in enumerate(profile["columns"]) if c["type"] == "number"]
        chosen = [i for i in named_columns if i in numeric_columns]
        if len(chosen) < 2:
            chosen = numeric_columns[:2]
        if len(chosen) < 2:
            raise ValueError("Correlation needs at least two numeric columns. Ask about another analysis or select numeric fields.")
        correlation = frame.iloc[:, chosen].apply(pd.to_numeric, errors="coerce").corr(min_periods=2)
        a, b = chosen[0], chosen[1]
        result = [{"column_a": str(frame.columns[a]), "column_b": str(frame.columns[b]), "correlation": round(float(correlation.loc[frame.columns[a], frame.columns[b]]), 4)}]
        value = result[0]["correlation"]
        answer = f"The correlation between {result[0]['column_a']} and {result[0]['column_b']} is {value:.3f}. This measures association, not causation."
    elif "outlier" in lowered or "unusual value" in lowered:
        intent = "outliers"
        columns = [matched] if matched is not None and profile["columns"][matched]["type"] == "number" else [i for i, c in enumerate(profile["columns"]) if c["type"] == "number"]
        for index in columns:
            values = pd.to_numeric(frame.iloc[:, index], errors="coerce")
            q1, q3 = values.quantile([0.25, 0.75])
            spread = q3 - q1
            mask = (values < q1 - 1.5 * spread) | (values > q3 + 1.5 * spread) if pd.notna(spread) and spread else pd.Series(False, index=frame.index)
            result.append({"column": str(frame.columns[index]), "flagged": int(mask.sum()), "examples": [display(v) for v in values[mask].head(5).tolist()]})
        answer = "IQR screening flags possible unusual values. These are review candidates, not confirmed errors."
    elif " by " in lowered and re.search(r"\b(?:average|mean|median|sum|count|total)\b", lowered):
        intent = "group_aggregate"
        group_candidates = [i for i in named_columns if i != matched]
        if matched is None or not group_candidates:
            raise ValueError("For a grouped result, name both a numeric value column and a category column, such as ‘average spend by plan’.")
        metric_index = matched
        group_index = group_candidates[-1]
        if profile["columns"][metric_index]["type"] != "number":
            numeric_named = [i for i in named_columns if profile["columns"][i]["type"] == "number"]
            if not numeric_named:
                raise ValueError("The value column in a grouped calculation must be numeric.")
            metric_index = numeric_named[0]
            group_index = next((i for i in reversed(group_candidates) if i != metric_index), group_candidates[-1])
        values = pd.to_numeric(frame.iloc[:, metric_index], errors="coerce")
        grouped = pd.DataFrame({"group": frame.iloc[:, group_index], "value": values}).dropna(subset=["group"])
        operation = "sum" if "sum" in lowered or "total" in lowered else "count" if "count" in lowered else "median" if "median" in lowered else "mean"
        aggregation = grouped.groupby("group", dropna=False)["value"].agg(operation).sort_values(ascending=False).head(10)
        result = [{"group": str(group), operation: display(value)} for group, value in aggregation.items()]
        answer = f"Calculated {operation} {frame.columns[metric_index]} by {frame.columns[group_index]} for {len(result)} groups."
        chart = {"kind": "bar", "label": str(frame.columns[group_index]), "data": [{"label": row["group"], "count": float(row[operation] or 0)} for row in result]}
    elif any(word in lowered for word in ("distribution", "frequency", "top ", "most common", "count by", "breakdown")):
        intent = "value_counts"
        if matched is None:
            raise ValueError("Name a column from the preview so I can calculate its distribution.")
        limit_match = re.search(r"\btop\s+(\d{1,2})\b", lowered)
        limit = min(max(int(limit_match.group(1)), 1), 20) if limit_match else 10
        counts = frame.iloc[:, matched].dropna().astype(str).value_counts().head(limit)
        result = [{"value": str(value)[:120], "count": int(count)} for value, count in counts.items()]
        chart = {"kind": "bar", "label": str(frame.columns[matched]), "data": [{"label": item["value"], "count": item["count"]} for item in result]}
        answer = f"Here are the {len(result)} most frequent values in {frame.columns[matched]}."
    elif re.search(r"\b(?:average|mean|median|sum|maximum|minimum|describe|statistics)\b", lowered):
        intent = "statistics"
        indices = [matched] if matched is not None else [i for i, c in enumerate(profile["columns"]) if c["type"] == "number"]
        for index in indices:
            values = pd.to_numeric(frame.iloc[:, index], errors="coerce")
            result.append({"column": str(frame.columns[index]), "count": int(values.count()), "mean": display(values.mean()), "median": display(values.median()), "std": display(values.std()), "min": display(values.min()), "max": display(values.max())})
        if not result:
            raise ValueError("Descriptive statistics need a numeric column. Name a numeric field from the preview.")
        answer = "Calculated descriptive statistics from the selected dataset version."
    elif re.search(r"\b(?:how many|count|number of)\b", lowered):
        intent = "count"
        if matched is None or any(word in lowered for word in ("row", "record", "customer")):
            result = [{"rows": int(len(frame))}]
            answer = f"The selected dataset contains {len(frame):,} rows."
        else:
            series = frame.iloc[:, matched]
            result = [{"column": str(frame.columns[matched]), "non_missing": int(series.notna().sum()), "unique": int(series.nunique(dropna=True))}]
            answer = f"{frame.columns[matched]} has {series.notna().sum():,} non-missing values and {series.nunique(dropna=True):,} distinct values."
    elif any(word in lowered for word in ("summary", "summarize", "overview", "describe dataset", "about this dataset", "what is in this dataset")):
        intent = "summary"
        answer = f"This dataset contains {profile['rows']:,} rows and {profile['columns_count']} columns, with {profile['missing_cells']:,} missing cells, {profile['duplicate_rows']:,} exact duplicate rows, and {profile['completeness_score']:.1f}% completeness."
        result = [{"column": c["name"], "type": c["type"], "unique": c["unique_count"], "missing": c["missing_count"]} for c in profile["columns"]]
    else:
        raise ValueError("I can summarize, inspect missing values and quality issues, filter records, compare approved versions, show trends, rank category frequencies, calculate numeric statistics or correlations, and flag possible outliers. Please name a column for column-specific questions.")
    return {"answer": answer, "intent": intent, "version": version, "result": result, "chart": chart}


def report_payload(original: pd.DataFrame, cleaned: pd.DataFrame | None, filename: str, change_log: list[dict[str, Any]]) -> dict[str, Any]:
    before = build_profile(original)
    after = build_profile(cleaned) if cleaned is not None else None
    unresolved = after["quality_issues"] if after else before["quality_issues"]
    return {"filename": filename, "original": {"rows": before["rows"], "columns": before["columns_count"], "missing_cells": before["missing_cells"], "duplicate_rows": before["duplicate_rows"], "completeness_score": before["completeness_score"]}, "cleaned": ({"rows": after["rows"], "columns": after["columns_count"], "missing_cells": after["missing_cells"], "duplicate_rows": after["duplicate_rows"], "completeness_score": after["completeness_score"]} if after else None), "change_log": change_log, "unresolved_issues": unresolved, "limitations": ["Completeness is the proportion of non-missing cells; it does not measure correctness.", "Outliers and inconsistent categories are heuristic review signals, not confirmed errors.", "The original uploaded data remains unchanged in memory until the session is cleared or expires."]}
