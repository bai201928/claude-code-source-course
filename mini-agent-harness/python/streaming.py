from __future__ import annotations

import asyncio
from contextlib import suppress
from collections.abc import AsyncIterable, AsyncIterator, Callable
from dataclasses import dataclass
from typing import Generic, TypeVar


T = TypeVar("T")
@dataclass(frozen=True)
class StreamTerminal:
    status: str
    item_count: int
    error_category: str | None = None


class AgentRunStream(Generic[T], AsyncIterable[T]):
    """Bounded, single-consumer pull stream with a terminal metadata result."""

    def __init__(
        self,
        source: AsyncIterable[T] | Callable[[asyncio.Event], AsyncIterable[T]],
        *,
        capacity: int = 32,
    ) -> None:
        if isinstance(capacity, bool) or not isinstance(capacity, int) or capacity < 1 or capacity > 1024:
            raise ValueError("stream capacity must be an integer between 1 and 1024")
        self._queue: asyncio.Queue[T] = asyncio.Queue(maxsize=capacity)
        self._slots = asyncio.Semaphore(capacity)
        self._done = asyncio.Event()
        self._signal = asyncio.Event()
        self._iterator: AsyncIterator[T] | None = None
        self._closed = False
        self._claimed = False
        self._item_count = 0
        self._terminal: asyncio.Future[StreamTerminal] = asyncio.get_running_loop().create_future()
        self._producer = asyncio.create_task(self._pump(source))

    @property
    def terminal(self) -> asyncio.Future[StreamTerminal]:
        return self._terminal

    def __aiter__(self) -> AsyncIterator[T]:
        if self._claimed:
            raise RuntimeError("AgentRunStream supports one consumer")
        self._claimed = True
        return self

    async def __anext__(self) -> T:
        if not self._queue.empty():
            item = self._queue.get_nowait()
            self._slots.release()
            return item
        if self._done.is_set():
            raise StopAsyncIteration

        item_task = asyncio.create_task(self._queue.get())
        done_task = asyncio.create_task(self._done.wait())
        await asyncio.wait({item_task, done_task}, return_when=asyncio.FIRST_COMPLETED)
        if item_task.done():
            done_task.cancel()
            with suppress(asyncio.CancelledError):
                await done_task
            self._slots.release()
            return item_task.result()
        item_task.cancel()
        with suppress(asyncio.CancelledError):
            await item_task
        if self._queue.empty():
            raise StopAsyncIteration
        item = self._queue.get_nowait()
        self._slots.release()
        return item

    async def aclose(self, reason: str = "consumer closed") -> StreamTerminal:
        if not self._closed:
            self._closed = True
            self._signal.set()
            self._producer.cancel()
            try:
                await self._producer
            except asyncio.CancelledError:
                pass
            if self._iterator is not None:
                aclose = getattr(self._iterator, "aclose", None)
                if aclose is not None:
                    with suppress(asyncio.CancelledError):
                        await aclose()
            self._complete("cancelled")
            self._done.set()
        return await self._terminal

    async def _pump(
        self,
        source: AsyncIterable[T] | Callable[[asyncio.Event], AsyncIterable[T]],
    ) -> None:
        slot_reserved = False
        try:
            iterable = source(self._signal) if callable(source) else source
            iterator = iterable.__aiter__()
            self._iterator = iterator
            while not self._closed:
                await self._slots.acquire()
                slot_reserved = True
                try:
                    item = await iterator.__anext__()
                except StopAsyncIteration:
                    self._slots.release()
                    slot_reserved = False
                    break
                if self._closed:
                    self._slots.release()
                    slot_reserved = False
                    break
                self._queue.put_nowait(item)
                slot_reserved = False
                self._item_count += 1
            if not self._closed:
                self._complete("completed")
        except asyncio.CancelledError:
            if not self._closed:
                self._closed = True
                self._complete("cancelled")
            raise
        except Exception as exc:
            if not self._closed:
                self._complete("failed", type(exc).__name__)
        finally:
            if slot_reserved:
                self._slots.release()
            self._done.set()

    def _complete(self, status: str, error_category: str | None = None) -> None:
        if self._terminal.done():
            return
        self._terminal.set_result(StreamTerminal(status, self._item_count, error_category))
