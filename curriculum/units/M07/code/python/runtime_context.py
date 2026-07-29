from __future__ import annotations

from collections.abc import Callable, Mapping
from copy import deepcopy
from dataclasses import dataclass
from math import isfinite
from time import time
from types import MappingProxyType
from typing import Generic, TypeVar

T = TypeVar("T")
Listener = Callable[[], None]
Observer = Callable[[T, T], None]


class SynchronousStore(Generic[T]):
    def __init__(self, initial_state: T, observer: Observer[T] | None = None) -> None:
        self._state = initial_state
        self._observer = observer
        self._listeners: dict[Listener, None] = {}

    def get_state(self) -> T:
        return self._state

    def set_state(self, updater: Callable[[T], T]) -> None:
        previous = self._state
        next_state = updater(previous)
        if next_state is previous:
            return

        self._state = next_state
        if self._observer is not None:
            self._observer(next_state, previous)
        for listener in tuple(self._listeners):
            listener()

    def subscribe(self, listener: Listener) -> Callable[[], None]:
        self._listeners[listener] = None

        def unsubscribe() -> None:
            self._listeners.pop(listener, None)

        return unsubscribe


@dataclass(frozen=True)
class RuntimeContext:
    runtime_id: str
    configuration_revision: int
    model_adapter: str
    started_at: float


def create_runtime_context(
    *,
    runtime_id: str,
    configuration_revision: int,
    model_adapter: str,
    started_at: float | None = None,
) -> RuntimeContext:
    _require_non_empty(runtime_id, "runtime_id")
    _require_non_empty(model_adapter, "model_adapter")
    _require_revision(configuration_revision, "configuration_revision")
    resolved_started_at = time() * 1000 if started_at is None else started_at
    if not isfinite(resolved_started_at):
        raise ValueError("started_at must be finite")
    return RuntimeContext(
        runtime_id=runtime_id,
        configuration_revision=configuration_revision,
        model_adapter=model_adapter,
        started_at=resolved_started_at,
    )


@dataclass(frozen=True)
class SessionState:
    revision: int
    values: Mapping[str, object]


class SessionStateStore:
    def __init__(
        self,
        initial_values: Mapping[str, object],
        observer: Observer[SessionState] | None = None,
    ) -> None:
        self._store = SynchronousStore(
            _create_session_state(1, initial_values), observer
        )

    def get_state(self) -> SessionState:
        return self._store.get_state()

    def subscribe(self, listener: Listener) -> Callable[[], None]:
        return self._store.subscribe(listener)

    def publish(self, values: Mapping[str, object]) -> SessionState:
        self._store.set_state(
            lambda previous: _create_session_state(previous.revision + 1, values)
        )
        return self._store.get_state()


@dataclass(frozen=True)
class RequestContext:
    request_id: str
    runtime_id: str
    configuration_revision: int
    session_revision: int
    session_values: Mapping[str, object]


def create_request_context(
    runtime: RuntimeContext | None,
    session_store: SessionStateStore | None,
    request_id: str,
) -> RequestContext:
    if runtime is None:
        raise ValueError("runtime context is required before a request")
    if session_store is None:
        raise ValueError("session state store is required before a request")
    _require_non_empty(request_id, "request_id")

    session = session_store.get_state()
    return RequestContext(
        request_id=request_id,
        runtime_id=runtime.runtime_id,
        configuration_revision=runtime.configuration_revision,
        session_revision=session.revision,
        session_values=session.values,
    )


@dataclass(frozen=True)
class FreshSessionRead:
    request_id: str
    observed_session_revision: int
    session_values: Mapping[str, object]


def read_fresh_session(
    request: RequestContext, session_store: SessionStateStore
) -> FreshSessionRead:
    current = session_store.get_state()
    return FreshSessionRead(
        request_id=request.request_id,
        observed_session_revision=current.revision,
        session_values=current.values,
    )


def _create_session_state(
    revision: int, values: Mapping[str, object]
) -> SessionState:
    _require_revision(revision, "session revision")
    return SessionState(revision=revision, values=_freeze_mapping(values))


def _freeze_mapping(value: Mapping[str, object]) -> Mapping[str, object]:
    copied = deepcopy(dict(value))
    return MappingProxyType(
        {key: _freeze_value(item) for key, item in copied.items()}
    )


def _freeze_value(value: object) -> object:
    if isinstance(value, Mapping):
        return MappingProxyType(
            {key: _freeze_value(item) for key, item in value.items()}
        )
    if isinstance(value, list):
        return tuple(_freeze_value(item) for item in value)
    if isinstance(value, tuple):
        return tuple(_freeze_value(item) for item in value)
    return value


def _require_non_empty(value: str, name: str) -> None:
    if not value.strip():
        raise ValueError(f"{name} must not be empty")


def _require_revision(value: int, name: str) -> None:
    if isinstance(value, bool) or not isinstance(value, int) or value < 1:
        raise ValueError(f"{name} must be a positive integer")
