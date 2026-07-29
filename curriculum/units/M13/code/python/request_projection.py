from __future__ import annotations

from copy import deepcopy
from dataclasses import dataclass, field
from typing import Any, Literal, Mapping, Sequence


@dataclass(frozen=True)
class DomainMessage:
    kind: Literal[
        "compact-boundary",
        "progress",
        "user-context",
        "human",
        "local-output",
        "attachment",
        "assistant",
        "tool-result",
    ]
    message_id: str
    text: str = ""
    response_id: str = ""
    blocks: tuple[Mapping[str, Any], ...] = ()
    tool_use_id: str = ""
    is_error: bool = False


@dataclass(frozen=True)
class ApiMessage:
    role: Literal["user", "assistant"]
    content: tuple[Mapping[str, Any], ...]


@dataclass(frozen=True)
class ProjectionReport:
    source_count: int
    selected_count: int
    api_count: int
    omitted_before_boundary: int
    replaced_tool_use_ids: tuple[str, ...]
    repaired_missing_tool_use_ids: tuple[str, ...]
    removed_orphan_tool_use_ids: tuple[str, ...]
    user_context_injected: bool


@dataclass(frozen=True)
class ProjectedRequest:
    messages: tuple[ApiMessage, ...]
    report: ProjectionReport


@dataclass
class ContentReplacementState:
    seen_ids: set[str] = field(default_factory=set)
    replacements: dict[str, str] = field(default_factory=dict)


class ProjectionError(ValueError):
    pass


def project_request(
    source: Sequence[DomainMessage],
    *,
    user_context: str = "",
    tool_result_budget_chars: int | None = None,
    pairing: Literal["strict", "repair"] = "strict",
    replacement_state: ContentReplacementState | None = None,
) -> ProjectedRequest:
    before = deepcopy(tuple(source))
    boundary = max(
        (index for index, message in enumerate(source) if message.kind == "compact-boundary"),
        default=-1,
    )
    selected = tuple(source[boundary if boundary >= 0 else 0 :])
    state = replacement_state or ContentReplacementState()
    budgeted, replaced = _apply_budget(selected, tool_result_budget_chars, state)
    context = user_context.strip()
    query_view = (
        (
            DomainMessage(
                "user-context",
                "request-user-context",
                f"<system-reminder>\n{context}\n</system-reminder>",
            ),
        )
        + budgeted
        if context
        else budgeted
    )
    normalized = _normalize(query_view)
    paired, repaired, removed = _ensure_pairing(normalized, pairing)

    if tuple(source) != before:
        raise ProjectionError("projection mutated its durable source")

    return ProjectedRequest(
        paired,
        ProjectionReport(
            len(source),
            len(selected),
            len(paired),
            0 if boundary < 0 else boundary,
            replaced,
            repaired,
            removed,
            bool(context),
        ),
    )


def build_final_params(
    model: str,
    projection: ProjectedRequest,
    tools: Sequence[Mapping[str, Any]],
    max_tokens: int,
) -> Mapping[str, Any]:
    if not model.strip():
        raise ProjectionError("model must not be empty")
    if max_tokens < 1:
        raise ProjectionError("max_tokens must be positive")
    return {
        "model": model,
        "messages": deepcopy(projection.messages),
        "tools": deepcopy(tuple(tools)),
        "max_tokens": max_tokens,
        "stream": True,
    }


def _apply_budget(
    messages: tuple[DomainMessage, ...],
    budget: int | None,
    state: ContentReplacementState,
) -> tuple[tuple[DomainMessage, ...], tuple[str, ...]]:
    if budget is not None and budget < 1:
        raise ProjectionError("tool_result_budget_chars must be positive")
    replacements: dict[str, str] = {}
    limit = float("inf") if budget is None else budget
    for group in _collect_candidates_by_api_user_group(messages):
        fresh = [message for message in group if message.tool_use_id not in state.seen_ids]
        frozen_size = sum(
            len(message.text)
            for message in group
            if message.tool_use_id in state.seen_ids
            and message.tool_use_id not in state.replacements
        )
        for message in group:
            prior = state.replacements.get(message.tool_use_id)
            if prior is not None:
                replacements[message.tool_use_id] = prior

        remaining = frozen_size + sum(len(message.text) for message in fresh)
        for message in sorted(fresh, key=lambda item: (-len(item.text), item.tool_use_id)):
            if remaining <= limit:
                break
            prefix = message.text[: min(24, budget or 24)]
            preview = (
                f"[tool result {message.tool_use_id} omitted: {len(message.text)} chars; "
                f"prefix={prefix!r}]"
            )
            replacements[message.tool_use_id] = preview
            state.replacements[message.tool_use_id] = preview
            remaining -= len(message.text)
        state.seen_ids.update(message.tool_use_id for message in fresh)
    projected = tuple(
        DomainMessage(
            message.kind,
            message.message_id,
            replacements.get(message.tool_use_id, message.text),
            message.response_id,
            message.blocks,
            message.tool_use_id,
            message.is_error,
        )
        if message.kind == "tool-result"
        else message
        for message in messages
    )
    return projected, tuple(replacements)


def _collect_candidates_by_api_user_group(
    messages: tuple[DomainMessage, ...],
) -> tuple[tuple[DomainMessage, ...], ...]:
    groups: list[tuple[DomainMessage, ...]] = []
    current: list[DomainMessage] = []
    seen_assistant_responses: set[str] = set()
    for message in messages:
        if message.kind == "tool-result":
            current.append(message)
        if (
            message.kind == "assistant"
            and message.response_id not in seen_assistant_responses
        ):
            if current:
                groups.append(tuple(current))
                current.clear()
            seen_assistant_responses.add(message.response_id)
    if current:
        groups.append(tuple(current))
    return tuple(groups)


def _normalize(messages: tuple[DomainMessage, ...]) -> tuple[ApiMessage, ...]:
    result: list[ApiMessage] = []
    for message in messages:
        if message.kind in {"compact-boundary", "progress"}:
            continue
        if message.kind in {"user-context", "human", "local-output", "attachment"}:
            _push_user(result, ({"type": "text", "text": message.text},))
        elif message.kind == "tool-result":
            _push_user(
                result,
                ({
                    "type": "tool_result",
                    "tool_use_id": message.tool_use_id,
                    "content": message.text,
                    "is_error": message.is_error,
                },),
            )
        elif message.kind == "assistant":
            blocks = tuple(deepcopy(message.blocks))
            if result and result[-1].role == "assistant":
                result[-1] = ApiMessage("assistant", result[-1].content + blocks)
            else:
                result.append(ApiMessage("assistant", blocks))
        else:
            raise ProjectionError(f"unknown message kind: {message.kind}")
    return tuple(result)


def _ensure_pairing(
    messages: tuple[ApiMessage, ...], mode: Literal["strict", "repair"]
) -> tuple[tuple[ApiMessage, ...], tuple[str, ...], tuple[str, ...]]:
    result: list[ApiMessage] = []
    repaired: list[str] = []
    removed: list[str] = []
    index = 0
    while index < len(messages):
        message = messages[index]
        if message.role != "assistant":
            orphan = [str(b["tool_use_id"]) for b in message.content if b["type"] == "tool_result"]
            if orphan:
                if mode == "strict":
                    raise ProjectionError("orphan tool results: " + ",".join(orphan))
                removed.extend(orphan)
                kept = tuple(b for b in message.content if b["type"] != "tool_result")
                if kept:
                    result.append(ApiMessage("user", kept))
            else:
                result.append(message)
            index += 1
            continue

        result.append(message)
        use_ids = [str(b["id"]) for b in message.content if b["type"] == "tool_use"]
        if len(use_ids) != len(set(use_ids)):
            raise ProjectionError("duplicate tool use id")
        if not use_ids:
            index += 1
            continue
        next_message = messages[index + 1] if index + 1 < len(messages) else None
        blocks = (
            tuple(b for b in next_message.content if b["type"] == "tool_result")
            if next_message and next_message.role == "user"
            else ()
        )
        result_ids = [str(b["tool_use_id"]) for b in blocks]
        if len(result_ids) != len(set(result_ids)):
            raise ProjectionError("duplicate tool result")
        missing = [call_id for call_id in use_ids if call_id not in result_ids]
        orphan = [call_id for call_id in result_ids if call_id not in use_ids]
        if not missing and not orphan:
            if next_message and next_message.role == "user":
                result.append(next_message)
                index += 2
            else:
                index += 1
            continue
        if mode == "strict":
            raise ProjectionError(f"tool pairing mismatch: missing={missing} orphan={orphan}")
        repaired.extend(missing)
        removed.extend(orphan)
        kept = (
            tuple(
                b
                for b in next_message.content
                if b["type"] != "tool_result" or str(b["tool_use_id"]) in use_ids
            )
            if next_message and next_message.role == "user"
            else ()
        )
        synthetic = tuple(
            {
                "type": "tool_result",
                "tool_use_id": call_id,
                "content": "[missing tool result repaired]",
                "is_error": True,
            }
            for call_id in missing
        )
        result.append(ApiMessage("user", synthetic + kept))
        index += 2 if next_message and next_message.role == "user" else 1
    return tuple(result), tuple(repaired), tuple(removed)


def _push_user(target: list[ApiMessage], blocks: tuple[Mapping[str, Any], ...]) -> None:
    if target and target[-1].role == "user":
        combined = target[-1].content + blocks
        tool_results = tuple(block for block in combined if block["type"] == "tool_result")
        other = tuple(block for block in combined if block["type"] != "tool_result")
        target[-1] = ApiMessage("user", tool_results + other)
    else:
        target.append(ApiMessage("user", blocks))


def _merge_users(messages: tuple[ApiMessage, ...]) -> tuple[ApiMessage, ...]:
    result: list[ApiMessage] = []
    for message in messages:
        if message.role == "user":
            _push_user(result, message.content)
        else:
            result.append(message)
    return tuple(result)
