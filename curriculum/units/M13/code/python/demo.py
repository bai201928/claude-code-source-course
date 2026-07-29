from request_projection import DomainMessage, build_final_params, project_request

source = (
    DomainMessage("human", "u-old", "old turn"),
    DomainMessage("compact-boundary", "b-1"),
    DomainMessage("human", "u-new", "summarize the file"),
    DomainMessage(
        "assistant",
        "a-1",
        response_id="r-1",
        blocks=({"type": "tool_use", "id": "call-1", "name": "read", "input": {"path": "README.md"}},),
    ),
    DomainMessage("tool-result", "tr-1", "A" * 96, tool_use_id="call-1"),
)

projection = project_request(
    source,
    user_context="cwd=/workspace",
    tool_result_budget_chars=32,
)
params = build_final_params(
    "demo-model",
    projection,
    ({"name": "read", "input_schema": {"type": "object"}},),
    512,
)
print({"source_count": len(source), "report": projection.report, "params": params})

