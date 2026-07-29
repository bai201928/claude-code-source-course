from __future__ import annotations

from copy import deepcopy
from dataclasses import dataclass
from types import MappingProxyType
from typing import Any, Literal, Mapping, NewType, TypeAlias

EnvelopeId = NewType("EnvelopeId", str)
ResponseId = NewType("ResponseId", str)
ToolUseId = NewType("ToolUseId", str)


@dataclass(frozen=True)
class TextBlock:
    kind: Literal["text"]
    text: str


@dataclass(frozen=True)
class ToolUseBlock:
    kind: Literal["tool-use"]
    id: ToolUseId
    name: str
    input: Mapping[str, Any]


AssistantBlock: TypeAlias = TextBlock | ToolUseBlock


@dataclass(frozen=True)
class HumanMessage:
    kind: Literal["human"]
    id: EnvelopeId
    text: str
    parent_id: EnvelopeId | None = None


@dataclass(frozen=True)
class AssistantMessage:
    kind: Literal["assistant"]
    id: EnvelopeId
    response_id: ResponseId
    blocks: tuple[AssistantBlock, ...]
    parent_id: EnvelopeId | None = None


@dataclass(frozen=True)
class ToolResultMessage:
    kind: Literal["tool-result"]
    id: EnvelopeId
    tool_use_id: ToolUseId
    output: str
    is_error: bool
    parent_id: EnvelopeId | None = None


@dataclass(frozen=True)
class SystemMessage:
    kind: Literal["system"]
    id: EnvelopeId
    text: str
    parent_id: EnvelopeId | None = None


DurableMessage: TypeAlias = (
    HumanMessage | AssistantMessage | ToolResultMessage | SystemMessage
)


@dataclass(frozen=True)
class ProgressEvent:
    kind: Literal["progress"]
    id: EnvelopeId
    tool_use_id: ToolUseId
    detail: str
    sequence: int


@dataclass(frozen=True)
class ConversationSnapshot:
    revision: int
    messages: tuple[DurableMessage, ...]


@dataclass(frozen=True)
class ConversationTrace:
    operation: Literal["append", "replace", "progress"]
    status: Literal["committed", "rejected", "published"]
    revision: int
    message_ids: tuple[EnvelopeId, ...]
    reason: str | None = None


class RevisionConflictError(ValueError):
    pass


class MessageInvariantError(ValueError):
    pass


class ConversationOwnershipError(RuntimeError):
    pass


class ActiveRunError(RuntimeError):
    pass


class ConversationRunLease:
    pass


@dataclass(frozen=True)
class _ValidatedState:
    messages: tuple[DurableMessage, ...]
    envelope_ids: frozenset[EnvelopeId]
    tool_uses: Mapping[ToolUseId, Literal["pending", "resolved"]]


class ConversationStore:
    def __init__(self, initial_messages: tuple[DurableMessage, ...] = ()) -> None:
        validated = _validate_sequence(initial_messages)
        self._revision = 0
        self._messages = validated.messages
        self._envelope_ids = set(validated.envelope_ids)
        self._tool_uses = dict(validated.tool_uses)
        self._progress_sequence = 0
        self._trace: list[ConversationTrace] = []
        self._runtime_owner: object | None = None
        self._active_run_lease: ConversationRunLease | None = None

    @property
    def revision(self) -> int:
        return self._revision

    def snapshot(self) -> ConversationSnapshot:
        return ConversationSnapshot(self._revision, self._messages)

    def traces(self) -> tuple[ConversationTrace, ...]:
        return tuple(self._trace)

    def bind_runtime(self, owner: object) -> None:
        if self._runtime_owner is None:
            self._runtime_owner = owner
            return
        if self._runtime_owner is not owner:
            raise ConversationOwnershipError(
                "conversation is already bound to another AgentRuntime"
            )

    def acquire_run(self, owner: object) -> ConversationRunLease:
        if self._runtime_owner is not owner:
            raise ConversationOwnershipError(
                "AgentRuntime does not own this conversation"
            )
        if self._active_run_lease is not None:
            raise ActiveRunError("conversation already has an active run")
        lease = ConversationRunLease()
        self._active_run_lease = lease
        return lease

    def release_run(self, owner: object, lease: ConversationRunLease) -> None:
        if self._runtime_owner is not owner or self._active_run_lease is not lease:
            raise ConversationOwnershipError("invalid conversation run lease release")
        self._active_run_lease = None

    def append(
        self,
        expected_revision: int,
        incoming: tuple[DurableMessage, ...],
        run_lease: ConversationRunLease | None = None,
    ) -> ConversationSnapshot:
        self._require_write_access(run_lease)
        self._require_revision(expected_revision, "append")
        try:
            validated = _validate_sequence(
                incoming,
                _ValidatedState(
                    self._messages,
                    frozenset(self._envelope_ids),
                    MappingProxyType(dict(self._tool_uses)),
                ),
            )
            return self._commit(
                "append", validated, tuple(item.id for item in incoming)
            )
        except Exception as error:
            self._record_rejection(
                "append", tuple(item.id for item in incoming), error
            )
            raise

    def replace(
        self,
        expected_revision: int,
        replacement: tuple[DurableMessage, ...],
        run_lease: ConversationRunLease | None = None,
    ) -> ConversationSnapshot:
        self._require_write_access(run_lease)
        self._require_revision(expected_revision, "replace")
        try:
            validated = _validate_sequence(replacement)
            return self._commit(
                "replace", validated, tuple(item.id for item in replacement)
            )
        except Exception as error:
            self._record_rejection(
                "replace", tuple(item.id for item in replacement), error
            )
            raise

    def publish_progress(
        self,
        message_id: EnvelopeId,
        tool_use_id: ToolUseId,
        detail: str,
    ) -> ProgressEvent:
        _require_non_empty(message_id, "progress envelope id")
        _require_non_empty(detail, "progress detail")
        if self._tool_uses.get(tool_use_id) != "pending":
            error = MessageInvariantError(
                f"progress requires a pending tool use: {tool_use_id}"
            )
            self._record_rejection("progress", (message_id,), error)
            raise error
        self._progress_sequence += 1
        event = ProgressEvent(
            "progress",
            message_id,
            tool_use_id,
            detail,
            self._progress_sequence,
        )
        self._trace.append(
            ConversationTrace(
                "progress", "published", self._revision, (message_id,)
            )
        )
        return event

    def assert_request_ready(self, snapshot: ConversationSnapshot) -> None:
        if snapshot.revision > self._revision:
            raise MessageInvariantError("snapshot revision is from the future")

        waiting: set[ToolUseId] = set()
        for message in snapshot.messages:
            if isinstance(message, AssistantMessage):
                if waiting:
                    raise MessageInvariantError(
                        "missing tool results before assistant message: "
                        + ",".join(sorted(waiting))
                    )
                waiting.update(
                    block.id
                    for block in message.blocks
                    if isinstance(block, ToolUseBlock)
                )
                continue

            if isinstance(message, ToolResultMessage):
                if message.tool_use_id not in waiting:
                    raise MessageInvariantError(
                        f"orphan or duplicate tool result: {message.tool_use_id}"
                    )
                waiting.remove(message.tool_use_id)
                continue

            if waiting:
                raise MessageInvariantError(
                    "tool results must immediately follow their assistant: "
                    + ",".join(sorted(waiting))
                )

        if waiting:
            raise MessageInvariantError(
                "request has unresolved tool uses: "
                + ",".join(sorted(waiting))
            )

    def _require_revision(
        self,
        expected_revision: int,
        operation: Literal["append", "replace"],
    ) -> None:
        if (
            not isinstance(expected_revision, int)
            or isinstance(expected_revision, bool)
            or expected_revision < 0
        ):
            raise RevisionConflictError(
                "expected revision must be a non-negative integer"
            )
        if expected_revision == self._revision:
            return
        error = RevisionConflictError(
            f"stale {operation}: expected revision {expected_revision}, "
            f"current revision {self._revision}"
        )
        self._record_rejection(operation, (), error)
        raise error

    def _require_write_access(
        self, run_lease: ConversationRunLease | None
    ) -> None:
        if (
            self._active_run_lease is not None
            and run_lease is not self._active_run_lease
        ):
            raise ActiveRunError(
                "conversation writes require the active AgentRuntime run lease"
            )

    def _commit(
        self,
        operation: Literal["append", "replace"],
        validated: _ValidatedState,
        message_ids: tuple[EnvelopeId, ...],
    ) -> ConversationSnapshot:
        self._messages = validated.messages
        self._envelope_ids = set(validated.envelope_ids)
        self._tool_uses = dict(validated.tool_uses)
        self._revision += 1
        self._trace.append(
            ConversationTrace(
                operation,
                "committed",
                self._revision,
                message_ids,
            )
        )
        return self.snapshot()

    def _record_rejection(
        self,
        operation: Literal["append", "replace", "progress"],
        message_ids: tuple[EnvelopeId, ...],
        error: Exception,
    ) -> None:
        self._trace.append(
            ConversationTrace(
                operation,
                "rejected",
                self._revision,
                message_ids,
                str(error),
            )
        )


def envelope_id(value: str) -> EnvelopeId:
    _require_non_empty(value, "envelope id")
    return EnvelopeId(value)


def response_id(value: str) -> ResponseId:
    _require_non_empty(value, "response id")
    return ResponseId(value)


def tool_use_id(value: str) -> ToolUseId:
    _require_non_empty(value, "tool use id")
    return ToolUseId(value)


def text_block(text: str) -> TextBlock:
    _require_non_empty(text, "text block")
    return TextBlock("text", text)


def tool_use_block(
    use_id: ToolUseId,
    name: str,
    tool_input: Mapping[str, Any],
) -> ToolUseBlock:
    _require_non_empty(use_id, "tool use id")
    _require_non_empty(name, "tool name")
    return ToolUseBlock("tool-use", use_id, name, _freeze_value(tool_input))


def is_human_input(message: DurableMessage) -> bool:
    return isinstance(message, HumanMessage)


def group_assistant_fragments(
    messages: tuple[DurableMessage, ...],
) -> Mapping[ResponseId, tuple[AssistantMessage, ...]]:
    groups: dict[ResponseId, list[AssistantMessage]] = {}
    for message in messages:
        if isinstance(message, AssistantMessage):
            groups.setdefault(message.response_id, []).append(message)
    return MappingProxyType(
        {key: tuple(value) for key, value in groups.items()}
    )


def _validate_sequence(
    incoming: tuple[DurableMessage, ...],
    base: _ValidatedState | None = None,
) -> _ValidatedState:
    if base is None:
        messages: list[DurableMessage] = []
        envelope_ids: set[EnvelopeId] = set()
        tool_uses: dict[ToolUseId, Literal["pending", "resolved"]] = {}
    else:
        messages = list(base.messages)
        envelope_ids = set(base.envelope_ids)
        tool_uses = dict(base.tool_uses)

    for raw_message in incoming:
        message = _clone_message(raw_message)
        _require_non_empty(message.id, "message envelope id")
        if message.id in envelope_ids:
            raise MessageInvariantError(
                f"duplicate envelope id: {message.id}"
            )
        if message.parent_id is not None and message.parent_id not in envelope_ids:
            raise MessageInvariantError(
                f"unknown parent envelope id: {message.parent_id}"
            )

        if isinstance(message, (HumanMessage, SystemMessage)):
            _require_non_empty(message.text, f"{message.kind} text")
        elif isinstance(message, AssistantMessage):
            _require_non_empty(message.response_id, "assistant response id")
            if not message.blocks:
                raise MessageInvariantError("assistant blocks must not be empty")
            for block in message.blocks:
                if not isinstance(block, ToolUseBlock):
                    continue
                if block.id in tool_uses:
                    raise MessageInvariantError(
                        f"duplicate tool use id: {block.id}"
                    )
                tool_uses[block.id] = "pending"
        else:
            state = tool_uses.get(message.tool_use_id)
            if state is None:
                raise MessageInvariantError(
                    "tool result has no matching tool use: "
                    f"{message.tool_use_id}"
                )
            if state == "resolved":
                raise MessageInvariantError(
                    f"duplicate tool result: {message.tool_use_id}"
                )
            tool_uses[message.tool_use_id] = "resolved"

        envelope_ids.add(message.id)
        messages.append(message)

    return _ValidatedState(
        tuple(messages),
        frozenset(envelope_ids),
        MappingProxyType(tool_uses),
    )


def _clone_message(message: DurableMessage) -> DurableMessage:
    if isinstance(message, AssistantMessage):
        blocks: list[AssistantBlock] = []
        for block in message.blocks:
            if isinstance(block, TextBlock):
                blocks.append(TextBlock("text", block.text))
            else:
                blocks.append(
                    ToolUseBlock(
                        "tool-use",
                        ToolUseId(str(block.id)),
                        block.name,
                        _freeze_value(block.input),
                    )
                )
        return AssistantMessage(
            "assistant",
            EnvelopeId(str(message.id)),
            ResponseId(str(message.response_id)),
            tuple(blocks),
            EnvelopeId(str(message.parent_id))
            if message.parent_id is not None
            else None,
        )
    return deepcopy(message)


def _freeze_value(value: Any) -> Any:
    if isinstance(value, Mapping):
        return MappingProxyType(
            {str(key): _freeze_value(item) for key, item in value.items()}
        )
    if isinstance(value, (list, tuple)):
        return tuple(_freeze_value(item) for item in value)
    if isinstance(value, set):
        return frozenset(_freeze_value(item) for item in value)
    return deepcopy(value)


def _require_non_empty(value: str, name: str) -> None:
    if not isinstance(value, str) or not value.strip():
        raise MessageInvariantError(f"{name} must not be empty")
