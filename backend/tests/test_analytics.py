import asyncio
import io
import json

import pandas as pd
from fastapi.testclient import TestClient

from app.analytics import analyze_question, build_profile, eda_frame, preview_frame
from app.main import _validated_action, app, execute_actions, rule_plan
from app.retrieval import build_tabular_index


MESSY = """customer_id,name,amount,group,email,signup_date
1, Alice ,10,A,a@example.com,2024-01-01
2,Bob,,B,b@example.com,2024/02/01
3,alice,12,A,wrong-email,March 3 2024
3,alice,12,A,wrong-email,March 3 2024
4,Dee,999,B,d@example.com,not-a-date
"""


def test_profile_counts_missing_duplicates_and_quality_issues():
    frame = pd.read_csv(io.StringIO(MESSY))
    profile = build_profile(frame)
    assert profile["rows"] == 5
    assert profile["duplicate_rows"] == 1
    assert profile["missing_cells"] == 1
    assert profile["completeness_score"] < 100
    kinds = {issue["issue_type"] for issue in profile["quality_issues"]}
    assert {"exact_duplicate_rows", "surrounding_whitespace", "invalid_email_format"}.issubset(kinds)
    assert any(column["name"] == "amount" and column["statistics"]["median"] == 12 for column in profile["columns"])


def test_eda_uses_real_distribution_and_correlations():
    frame = pd.DataFrame({"x": [1, 2, 3, 4, 5], "y": [2, 4, 6, 8, 10], "kind": ["a", "a", "b", "b", "b"]})
    result = eda_frame(frame)
    assert result["profile"]["rows"] == 5
    assert any(chart["column"] == "x" and sum(point["count"] for point in chart["data"]) == 5 for chart in result["charts"])
    assert {pair["value"] for pair in result["correlation"] if pair["x"] == "x" and pair["y"] == "y"} == {1.0}
    assert result["scatter"] and len(result["scatter"]["data"]) == 5


def test_preview_search_paging_and_sorting():
    frame = pd.DataFrame({"name": ["Zed", "Ada", "Mina"], "score": [2, 3, 1]})
    result = preview_frame(frame, page=1, page_size=2, sort_by="col_001")
    assert [row["name"] for row in result["rows"]] == ["Mina", "Zed"]
    filtered = preview_frame(frame, search="ad")
    assert filtered["total_rows"] == 1
    assert filtered["rows"][0]["name"] == "Ada"


def test_data_chat_calculates_grouped_aggregates_and_correlation():
    frame = pd.DataFrame({"spend": [10, 30, 20, 40], "plan": ["A", "A", "B", "B"]})
    grouped = analyze_question(frame, "average spend by plan")
    assert grouped["intent"] == "group_aggregate"
    assert grouped["result"] == [{"group": "B", "mean": 30.0}, {"group": "A", "mean": 20.0}]
    corr = analyze_question(pd.DataFrame({"x": [1, 2, 3], "y": [3, 2, 1]}), "correlation between x and y")
    assert corr["result"][0]["correlation"] == -1.0


def test_records_missing_and_unsupported_question():
    frame = pd.DataFrame({"email": ["a@x.test", None], "age": [1, 2]})
    answer = analyze_question(frame, "show records with missing email")
    assert answer["intent"] == "records_with_missing"
    assert len(answer["result"]) == 1
    try:
        analyze_question(frame, "write a poem about these rows")
    except ValueError as error:
        assert "can summarize" in str(error)
    else:
        raise AssertionError("Unsupported questions should be rejected clearly")


def test_filter_records_supports_inclusive_numeric_filters_and_duplicate_indexes():
    frame = pd.DataFrame({"age": [18, 21, 30, None], "city": ["A", "B", "C", "D"]}, index=[5, 5, 9, 9])
    answer = analyze_question(frame, "show rows where age is at least 21")
    assert answer["intent"] == "filter_records"
    assert [row["row_number"] for row in answer["result"]] == [2, 3]
    assert analyze_question(frame, "show rows where age >= 30")["result"][0]["row_number"] == 3
    assert analyze_question(frame, "show rows where age is missing")["result"][0]["row_number"] == 4


def test_time_trend_uses_named_date_and_numeric_fields():
    frame = pd.DataFrame({
        "created_date": ["2024-01-01", "2024-01-15", "2024-02-01"],
        "revenue": [5, 7, 11],
    })
    answer = analyze_question(frame, "trend of revenue over time by created date")
    assert answer["intent"] == "time_trend"
    assert answer["result"] == [{"period": "2024-01", "sum": 12}, {"period": "2024-02", "sum": 11}]
    assert answer["chart"]["kind"] == "line"


def test_compare_versions_requires_an_approved_cleaned_copy():
    frame = pd.DataFrame({"value": [1, None]})
    try:
        analyze_question(frame, "compare original and cleaned")
    except ValueError as error:
        assert "no approved cleaned version" in str(error)
    else:
        raise AssertionError("Comparisons must not fabricate a cleaned version")
    answer = analyze_question(frame, "compare original and cleaned", original_frame=frame, cleaned_frame=frame.fillna(0))
    assert answer["intent"] == "compare_versions"
    assert answer["result"][1]["change"] == -1


def test_sparse_rag_retrieval_returns_ranked_row_evidence():
    frame = pd.DataFrame({"item": ["basic", "rare lavender tea", "basic"], "region": ["north", "canada", "south"]})
    sources = build_tabular_index(frame).search(frame, "lavender tea Canada")
    assert sources
    assert sources[0]["row_number"] == 2
    assert "rare lavender tea" in sources[0]["snippet"]


def test_top_n_frequency_and_weekly_metric_trends():
    categories = pd.DataFrame({"category": ["A", "A", "B", "B", "B", "C"]})
    assert len(analyze_question(categories, "top 2 values in category")["result"]) == 2

    time_data = pd.DataFrame({
        "event_date": ["2024-01-01", "2024-01-03", "2024-01-10"],
        "revenue": [5, 7, 9],
    })
    trend = analyze_question(time_data, "average revenue by week")
    assert trend["intent"] == "time_trend"
    assert trend["result"] == [
        {"period": "2024-01-01/2024-01-07", "mean": 6.0},
        {"period": "2024-01-08/2024-01-14", "mean": 9.0},
    ]


def test_approved_operations_copy_input_and_unknown_actions_are_rejected():
    original = pd.DataFrame({"name": [" Alice ", "Bob ", "Bob "], "value": [1, 2, 2]})
    profile = build_profile(original)
    candidate = {"operation": "trim_whitespace", "column_id": "col_000", "reason": "Trim observed whitespace", "parameters": {}}
    action = _validated_action(candidate, profile)
    assert action is not None
    transformed, _ = execute_actions(original, [action])
    assert original.iloc[0, 0] == " Alice "
    assert transformed.iloc[0, 0] == "Alice"
    assert _validated_action({**candidate, "operation": "run_python"}, profile) is None


def test_identity_fields_are_never_imputed_from_other_rows():
    frame = pd.DataFrame({"email": ["a@example.com", None], "customer_id": ["x1", None], "score": [2.0, None]})
    profile = build_profile(frame)
    actions = rule_plan(profile)
    assert not any(action["operation"] == "fill_missing" and action["column_name"] in {"email", "customer_id"} for action in actions)
    assert any(action["operation"] == "fill_missing" and action["column_name"] == "score" for action in actions)


def test_api_upload_eda_chat_review_and_confirmation_gate():
    client = TestClient(app)
    uploaded = client.post("/api/datasets", files={"file": ("messy.csv", MESSY.encode(), "text/csv")})
    assert uploaded.status_code == 200
    dataset = uploaded.json()
    headers = {"X-Session-Token": dataset["session_token"]}
    dataset_id = dataset["dataset_id"]
    assert client.get(f"/api/datasets/{dataset_id}/eda", headers=headers).status_code == 200
    chat = client.post(f"/api/datasets/{dataset_id}/chat", headers=headers, json={"question": "summarize this dataset", "version": "original"})
    assert chat.status_code == 200
    assert "5 rows" in chat.json()["answer"]
    plan = client.post(f"/api/datasets/{dataset_id}/plan", headers=headers, json={"mode": "rules", "user_request": ""}).json()
    duplicate_action = next(action for action in plan["actions"] if action["operation"] == "remove_exact_duplicates")
    selection = {"plan_version": plan["plan_version"], "action_ids": [duplicate_action["action_id"]]}
    preview = client.post(f"/api/datasets/{dataset_id}/preview", headers=headers, json=selection)
    assert preview.status_code == 200
    assert preview.json()["summary"]["duplicate_rows_removed"] == 1
    blocked = client.post(f"/api/datasets/{dataset_id}/apply", headers=headers, json={**selection, "confirm": False})
    assert blocked.status_code == 400
    applied = client.post(f"/api/datasets/{dataset_id}/apply", headers=headers, json={**selection, "confirm": True})
    assert applied.status_code == 200
    original_preview = client.get(f"/api/datasets/{dataset_id}/preview?version=original", headers=headers).json()
    cleaned_preview = client.get(f"/api/datasets/{dataset_id}/preview?version=cleaned", headers=headers).json()
    assert original_preview["total_rows"] == 5
    assert cleaned_preview["total_rows"] == 4
    report = client.get(f"/api/datasets/{dataset_id}/report", headers=headers).json()
    assert report["original"]["rows"] == 5 and report["cleaned"]["rows"] == 4
    reset = client.post(f"/api/datasets/{dataset_id}/reset", headers=headers)
    assert reset.status_code == 200
    reset_preview = client.get(f"/api/datasets/{dataset_id}/preview?version=cleaned", headers=headers).json()
    reset_report = client.get(f"/api/datasets/{dataset_id}/report", headers=headers).json()
    assert reset_preview["total_rows"] == 5 and reset_report["cleaned"] is None


def test_upload_rejects_headers_without_data_rows():
    client = TestClient(app)
    response = client.post("/api/datasets", files={"file": ("empty.csv", b"name,value\n", "text/csv")})
    assert response.status_code == 400
    assert "no data rows" in response.json()["detail"]["message"]


def test_groq_connect_verifies_key_without_returning_it(monkeypatch):
    import app.main as main_module

    class FakeResponse:
        status_code = 200

        @staticmethod
        def json():
            return {"data": [{"id": "model-a"}, {"id": "model-b"}]}

    class FakeClient:
        def __init__(self, *args, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return None

        async def get(self, url, headers):
            assert url == main_module.GROQ_MODELS_URL
            assert headers["Authorization"] == "Bearer test-key-that-must-not-be-returned"
            return FakeResponse()

    monkeypatch.setattr(main_module.httpx, "AsyncClient", FakeClient)
    client = TestClient(app)
    response = client.post("/api/groq/connect", headers={"X-Groq-API-Key": "test-key-that-must-not-be-returned"})
    assert response.status_code == 200
    assert response.json() == {"connected": True, "provider": "Groq", "model_count": 2}
    assert "test-key-that-must-not-be-returned" not in response.text


def test_groq_connect_requires_api_key():
    response = TestClient(app).post("/api/groq/connect")
    assert response.status_code == 400
    assert response.json()["detail"]["message"] == "Enter a Groq API key to connect."


def test_groq_default_model_is_active_budget_friendly_model():
    import app.main as main_module

    assert main_module.DEFAULT_GROQ_MODEL == "openai/gpt-oss-20b"


def test_groq_chat_classifier_preserves_top_n_and_trend_parameters(monkeypatch):
    import app.main as main_module

    responses = [
        {"intent": "value_counts", "column": "category", "top_n": 3, "retrieval_query": "top categories"},
        {"intent": "time_trend", "column": "revenue", "date_column": "event_date", "date_granularity": "week", "operation": "mean", "retrieval_query": "weekly revenue"},
    ]
    captured = []

    class FakeResponse:
        def __init__(self, payload):
            self.payload = payload

        @staticmethod
        def raise_for_status():
            return None

        def json(self):
            return {"choices": [{"message": {"content": json.dumps(self.payload)}}]}

    class FakeClient:
        def __init__(self, *args, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return None

        async def post(self, url, headers, json):
            captured.append(json)
            return FakeResponse(responses.pop(0))

    monkeypatch.setattr(main_module.httpx, "AsyncClient", FakeClient)
    frame = pd.DataFrame({"category": ["A", "B"], "event_date": ["2024-01-01", "2024-01-02"], "revenue": [5, 7]})
    top_n, _ = asyncio.run(main_module._groq_chat_query("show top three categories", frame, "test-key", []))
    trend, _ = asyncio.run(main_module._groq_chat_query("average revenue by week", frame, "test-key", []))
    assert top_n == "top 3 values in category"
    assert "weekly mean trend of revenue" in trend
    assert all(call["model"] == "openai/gpt-oss-20b" and call["reasoning_effort"] == "low" for call in captured)


def test_rag_prompt_never_sends_the_full_filtered_row_table(monkeypatch):
    import app.main as main_module

    captured = {}

    class FakeResponse:
        @staticmethod
        def raise_for_status():
            return None

        @staticmethod
        def json():
            return {"choices": [{"message": {"content": "I found matching records."}}]}

    class FakeClient:
        def __init__(self, *args, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return None

        async def post(self, url, headers, json):
            captured["payload"] = json
            return FakeResponse()

    monkeypatch.setattr(main_module.httpx, "AsyncClient", FakeClient)
    rows = [{"row_number": i, "private_value": f"private-canary-{i}"} for i in range(1, 21)]
    source = {"row_number": 1, "score": 0.8, "snippet": "row 1: category: selected"}
    answer = asyncio.run(main_module._groq_grounded_answer(
        "show selected records",
        {"intent": "filter_records", "answer": "Found 20 rows.", "result": rows},
        [source],
        [],
        "test-key",
    ))
    user_payload = json.loads(captured["payload"]["messages"][-1]["content"])
    assert answer == "I found matching records."
    assert "private-canary" not in json.dumps(user_payload)
    assert user_payload["computed_result"] == [{"rows_returned_in_result_table": 20}]
    assert user_payload["retrieved_row_evidence"] == [source]
    assert captured["payload"]["reasoning_effort"] == "low"


def test_chat_rag_requires_key_and_returns_cited_retrieval(monkeypatch):
    import app.main as main_module

    client = TestClient(app)
    csv_data = b"item,region,amount\nbasic,north,1\nrare lavender tea,Canada,8\nbasic,south,2\n"
    dataset = client.post("/api/datasets", files={"file": ("rag.csv", csv_data, "text/csv")}).json()
    url = f"/api/datasets/{dataset['dataset_id']}/chat"
    headers = {"X-Session-Token": dataset["session_token"]}
    blocked = client.post(url, headers=headers, json={"question": "find lavender", "use_rag": True})
    assert blocked.status_code == 400

    async def classify(question, frame, api_key, history):
        return "summarize this dataset", "lavender tea Canada"

    async def explain(question, analysis, sources, history, api_key):
        assert sources[0]["row_number"] == 2
        return "The matching record is in Canada [row 2]."

    monkeypatch.setattr(main_module, "_groq_chat_query", classify)
    monkeypatch.setattr(main_module, "_groq_grounded_answer", explain)
    response = client.post(url, headers={**headers, "X-Groq-API-Key": "test-key"}, json={"question": "find the lavender tea record", "use_rag": True})
    assert response.status_code == 200
    assert response.json()["source"] == "groq"
    assert response.json()["answer"].endswith("[row 2].")
    assert response.json()["sources"][0]["row_number"] == 2
    assert response.json()["retrieval"]["retrieved_count"] >= 1
