import json

from runtime_context import (
    SessionStateStore,
    create_request_context,
    create_runtime_context,
    read_fresh_session,
)

trace: list[str] = []
runtime = create_runtime_context(
    runtime_id="demo-runtime",
    configuration_revision=3,
    model_adapter="fake-model",
    started_at=100.0,
)
session = SessionStateStore(
    {"permissionMode": "default", "tools": ["Read"]},
    lambda new, _old: trace.append(f"observer:{new.revision}"),
)
session.subscribe(lambda: trace.append(f"subscriber:{session.get_state().revision}"))
request = create_request_context(runtime, session, "request-1")
session.publish({"permissionMode": "plan", "tools": ["Read", "Glob"]})
fresh = read_fresh_session(request, session)

print(
    json.dumps(
        {
            "request_snapshot": {
                "request_id": request.request_id,
                "session_revision": request.session_revision,
                "session_values": dict(request.session_values),
            },
            "fresh_read": {
                "observed_session_revision": fresh.observed_session_revision,
                "session_values": dict(fresh.session_values),
            },
            "notification_trace": trace,
        },
        indent=2,
    )
)

