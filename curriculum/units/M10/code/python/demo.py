from conversation_store import (
    AssistantMessage,
    ConversationStore,
    HumanMessage,
    ToolResultMessage,
    envelope_id,
    response_id,
    text_block,
    tool_use_block,
    tool_use_id,
)

read_id = tool_use_id("tool-read-1")
store = ConversationStore()

store.append(
    0,
    (
        HumanMessage(
            "human", envelope_id("user-1"), "Read package.json"
        ),
        AssistantMessage(
            "assistant",
            envelope_id("assistant-text-1"),
            response_id("provider-response-1"),
            (text_block("I will inspect it."),),
        ),
        AssistantMessage(
            "assistant",
            envelope_id("assistant-tool-1"),
            response_id("provider-response-1"),
            (tool_use_block(read_id, "Read", {"path": "package.json"}),),
        ),
    ),
)

turn_view = store.snapshot()
progress = store.publish_progress(
    envelope_id("progress-1"), read_id, "reading"
)
store.append(
    turn_view.revision,
    (
        ToolResultMessage(
            "tool-result",
            envelope_id("result-1"),
            read_id,
            '{"name":"demo"}',
            False,
        ),
    ),
)
store.assert_request_ready(store.snapshot())

print(
    {
        "turn_view_revision": turn_view.revision,
        "turn_view_ids": [item.id for item in turn_view.messages],
        "progress": progress,
        "durable_revision": store.revision,
        "durable_ids": [item.id for item in store.snapshot().messages],
        "trace": store.traces(),
    }
)
