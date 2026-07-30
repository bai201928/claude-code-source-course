from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Any, Literal


class StreamProtocolError(RuntimeError):
    pass


@dataclass
class Usage:
    input_tokens: int = 0
    output_tokens: int = 0
    cache_read_input_tokens: int = 0


@dataclass(frozen=True)
class UsageSnapshot:
    input_tokens: int | None = None
    output_tokens: int | None = None
    cache_read_input_tokens: int | None = None


@dataclass
class AssistantMessage:
    response_id: str
    content: list[dict[str, Any]]
    usage: Usage
    stop_reason: str | None = None


@dataclass
class UsageRecord:
    snapshot: Usage = field(default_factory=Usage)
    total: Usage = field(default_factory=Usage)
    response_count: int = 0
    ttft_ms: int | None = None

    def apply_cumulative(self, update: UsageSnapshot) -> Usage:
        if update.input_tokens is not None and update.input_tokens > 0:
            self.snapshot.input_tokens = update.input_tokens
        if update.cache_read_input_tokens is not None and update.cache_read_input_tokens > 0:
            self.snapshot.cache_read_input_tokens = update.cache_read_input_tokens
        if update.output_tokens is not None:
            self.snapshot.output_tokens = update.output_tokens
        return Usage(**vars(self.snapshot))

    def record_response(self, response: Usage) -> None:
        self.response_count += 1
        self.total.input_tokens += response.input_tokens
        self.total.output_tokens += response.output_tokens
        self.total.cache_read_input_tokens += response.cache_read_input_tokens


class StreamingAssembler:
    def __init__(self, *, started_at: int = 0, now: int = 0) -> None:
        self._started_at = started_at
        self._now = now
        self._started = False
        self._response_id = "response-unknown"
        self._blocks: dict[int, dict[str, Any]] = {}
        self.messages: list[AssistantMessage] = []
        self.usage = UsageRecord()
        self.stop_reason: str | None = None

    def consume(self, event: dict[str, Any]) -> list[dict[str, Any]]:
        event_type = event["type"]
        if event_type == "message_start":
            if self._started:
                raise StreamProtocolError("duplicate message_start")
            self._started = True
            self._response_id = event["message"]["id"]
            self.usage.apply_cumulative(_snapshot(event["message"].get("usage", {})))
        elif event_type == "content_block_start":
            self._require_started()
            index = event["index"]
            if index in self._blocks:
                raise StreamProtocolError(f"duplicate content block {index}")
            block = event["content_block"]
            if block["type"] == "text":
                self._blocks[index] = {"type": "text", "text": ""}
            elif block["type"] == "thinking":
                self._blocks[index] = {"type": "thinking", "thinking": "", "signature": ""}
            elif block["type"] == "tool_use":
                self._blocks[index] = {
                    "type": "tool_use", "id": block["id"], "name": block["name"], "input": ""
                }
            else:
                raise StreamProtocolError(f"unsupported block type {block['type']}")
        elif event_type == "content_block_delta":
            self._require_started()
            self._apply_delta(event["index"], event["delta"])
        elif event_type == "content_block_stop":
            self._require_started()
            block = self._blocks.get(event["index"])
            if block is None:
                raise StreamProtocolError(f"content block {event['index']} not found")
            message = AssistantMessage(
                self._response_id, [self._finish_block(block)], Usage(**vars(self.usage.snapshot)), self.stop_reason
            )
            self.messages.append(message)
            return [
                {"type": "assistant", "message": message},
                {"type": "stream_event", "event": event},
            ]
        elif event_type == "message_delta":
            self._require_started()
            self.usage.apply_cumulative(_snapshot(event.get("usage", {})))
            self.stop_reason = event.get("stop_reason")
            if self.messages:
                self.messages[-1].usage = Usage(**vars(self.usage.snapshot))
                self.messages[-1].stop_reason = self.stop_reason
        elif event_type == "message_stop":
            self._require_started()
        else:
            raise StreamProtocolError(f"unknown event type {event_type}")
        return [{"type": "stream_event", "event": event}]

    def finish(self) -> dict[str, Any]:
        self._require_started()
        if not self.messages and not self.stop_reason:
            raise StreamProtocolError("stream ended without a completed message")
        return {"messages": self.messages, "usage": self.usage.snapshot, "stop_reason": self.stop_reason}

    def _require_started(self) -> None:
        if not self._started:
            raise StreamProtocolError("message_start is required first")

    def _apply_delta(self, index: int, delta: dict[str, Any]) -> None:
        block = self._blocks.get(index)
        if block is None:
            raise StreamProtocolError(f"content block {index} not found")
        kind = delta["type"]
        if kind == "text_delta":
            if block["type"] != "text":
                raise StreamProtocolError("text delta on non-text block")
            block["text"] += delta["text"]
        elif kind == "thinking_delta":
            if block["type"] != "thinking":
                raise StreamProtocolError("thinking delta on non-thinking block")
            block["thinking"] += delta["thinking"]
        elif kind == "signature_delta":
            if block["type"] != "thinking":
                raise StreamProtocolError("signature delta on non-thinking block")
            block["signature"] = delta["signature"]
        elif kind == "input_json_delta":
            if block["type"] != "tool_use":
                raise StreamProtocolError("input JSON delta on non-tool block")
            block["input"] += delta["partial_json"]
        else:
            raise StreamProtocolError(f"unknown delta type {kind}")

    @staticmethod
    def _finish_block(block: dict[str, Any]) -> dict[str, Any]:
        if block["type"] == "text":
            return {"type": "text", "text": block["text"]}
        if block["type"] == "thinking":
            return {"type": "thinking", "thinking": block["thinking"], "signature": block["signature"]}
        try:
            parsed = json.loads(block["input"] or "{}")
        except json.JSONDecodeError as exc:
            raise StreamProtocolError("invalid tool input JSON") from exc
        if not isinstance(parsed, dict):
            raise StreamProtocolError("tool input must be an object")
        return {"type": "tool_use", "id": block["id"], "name": block["name"], "input": parsed}


def _snapshot(raw: dict[str, Any]) -> UsageSnapshot:
    return UsageSnapshot(
        input_tokens=raw.get("input_tokens"),
        output_tokens=raw.get("output_tokens"),
        cache_read_input_tokens=raw.get("cache_read_input_tokens"),
    )
