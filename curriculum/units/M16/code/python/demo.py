from context_budget import (
    AggregateBudgetPolicy,
    Envelope,
    ResultBudgetLedger,
    ToolCall,
    apply_per_result_preview,
    project_and_commit,
    total_tool_result_chars,
)

source = (
    Envelope(
        "assistant",
        response_id="response-demo",
        calls=(
            ToolCall("search-a", "search"),
            ToolCall("search-b", "search"),
            ToolCall("search-c", "search"),
        ),
    ),
    Envelope("tool-result", call_id="search-a", content="A" * 80),
    Envelope("progress", call_id="search-b", text="halfway"),
    Envelope("tool-result", call_id="search-b", content="B" * 80),
    Envelope("attachment", text="workspace changed"),
    Envelope("tool-result", call_id="search-c", content="C" * 80),
)

per_result = apply_per_result_preview(source, 100, 4)
aggregate = project_and_commit(
    source,
    ResultBudgetLedger(),
    AggregateBudgetPolicy(190, 4),
)

print(
    {
        "durable_chars": total_tool_result_chars(source),
        "per_result_chars": total_tool_result_chars(per_result),
        "aggregate_chars": total_tool_result_chars(aggregate.messages),
        "report": aggregate.report,
    }
)
