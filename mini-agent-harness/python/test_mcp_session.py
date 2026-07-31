import unittest

from mcp_session import (
    IndeterminateMcpOutcomeError,
    McpCallResult,
    McpHandshake,
    McpRemoteTool,
    McpServerCapabilities,
    McpSession,
    McpSessionExpiredError,
    StaleMcpSnapshotError,
)


class Signal:
    def __init__(self, cancelled: bool = False) -> None:
        self._cancelled = cancelled

    @property
    def cancelled(self) -> bool:
        return self._cancelled

    def throw_if_cancelled(self) -> None:
        if self._cancelled:
            raise RuntimeError("stop waiting")


READ = McpRemoteTool("read", "Read remotely", {"type": "object"}, {"readOnlyHint": True})


class FakeTransport:
    def __init__(self, tools=(READ,)) -> None:
        self.tools = tools
        self.list_error = None
        self.call_error = None
        self.closed = False
        self.calls = []
        self.observe_signal = False

    async def connect(self, signal):
        signal.throw_if_cancelled()
        return McpHandshake(
            "demo server",
            "1.0.0",
            McpServerCapabilities(True, False, False),
        )

    async def list_tools(self, signal):
        signal.throw_if_cancelled()
        if self.list_error:
            raise self.list_error
        return tuple(self.tools)

    async def call_tool(
        self, tool_name, arguments, *, signal, idempotency_key, timeout_ms
    ):
        self.calls.append((tool_name, idempotency_key))
        if self.observe_signal:
            signal.throw_if_cancelled()
        if self.call_error:
            raise self.call_error
        return McpCallResult("ok")

    async def close(self, reason):
        self.closed = True


class AllowRetry:
    def allow_session_recovery(self, tool):
        return True


class McpSessionTests(unittest.IsolatedAsyncioTestCase):
    async def test_connect_publishes_qualified_immutable_snapshot(self):
        session = McpSession(lambda: FakeTransport())
        snapshot = await session.connect(Signal())
        self.assertEqual((snapshot.generation, snapshot.revision), (1, 1))
        self.assertEqual(snapshot.tools[0].qualified_name, "mcp__demo_server__read")

    async def test_list_failure_has_no_partial_snapshot(self):
        transport = FakeTransport()
        transport.list_error = RuntimeError("remote-list-secret")
        session = McpSession(lambda: transport)
        with self.assertRaisesRegex(RuntimeError, "remote-list-secret"):
            await session.connect(Signal())
        self.assertEqual(session.state.type, "degraded")
        self.assertTrue(transport.closed)
        with self.assertRaisesRegex(RuntimeError, "not ready"):
            session.snapshot()

    async def test_notification_revision_rejects_old_snapshot(self):
        transport = FakeTransport()
        session = McpSession(lambda: transport)
        old = await session.connect(Signal())
        transport.tools = (McpRemoteTool("search", "Search", {"type": "object"}),)
        fresh = await session.handle_tools_changed(Signal())
        self.assertEqual(fresh.revision, 2)
        with self.assertRaises(StaleMcpSnapshotError):
            await session.call(old, "mcp__demo_server__read", {}, "call-1", Signal())

    async def test_refresh_failure_degrades_instead_of_serving_stale(self):
        transport = FakeTransport()
        session = McpSession(lambda: transport)
        snapshot = await session.connect(Signal())
        transport.list_error = RuntimeError("refresh failed")
        with self.assertRaises(RuntimeError):
            await session.handle_tools_changed(Signal())
        with self.assertRaisesRegex(RuntimeError, "not ready"):
            await session.call(snapshot, "mcp__demo_server__read", {}, "call-1", Signal())

    async def test_disconnect_blocks_old_generation(self):
        transport = FakeTransport()
        session = McpSession(lambda: transport)
        snapshot = await session.connect(Signal())
        await session.disconnect()
        with self.assertRaisesRegex(RuntimeError, "not ready"):
            await session.call(snapshot, "mcp__demo_server__read", {}, "call-1", Signal())

    async def test_expiry_without_policy_is_indeterminate(self):
        transport = FakeTransport()
        transport.call_error = McpSessionExpiredError("expired")
        session = McpSession(lambda: transport)
        snapshot = await session.connect(Signal())
        with self.assertRaises(IndeterminateMcpOutcomeError):
            await session.call(snapshot, "mcp__demo_server__read", {}, "call-1", Signal())
        self.assertEqual(len(transport.calls), 1)

    async def test_approved_retry_reuses_idempotency_key(self):
        first = FakeTransport()
        first.call_error = McpSessionExpiredError("expired")
        second = FakeTransport()
        transports = [first, second]
        session = McpSession(
            lambda: transports.pop(0), retry_policy=AllowRetry()
        )
        snapshot = await session.connect(Signal())
        result = await session.call(
            snapshot, "mcp__demo_server__read", {}, "call-1", Signal()
        )
        self.assertEqual(result.content, "ok")
        self.assertEqual(first.calls[0][1], second.calls[0][1])

    async def test_abort_reaches_adapter_without_rollback_claim(self):
        transport = FakeTransport()
        transport.observe_signal = True
        session = McpSession(lambda: transport)
        snapshot = await session.connect(Signal())
        with self.assertRaisesRegex(RuntimeError, "stop waiting"):
            await session.call(
                snapshot,
                "mcp__demo_server__read",
                {},
                "call-1",
                Signal(True),
            )

    async def test_trace_is_metadata_only(self):
        transport = FakeTransport()
        session = McpSession(lambda: transport)
        snapshot = await session.connect(Signal())
        await session.call(
            snapshot,
            "mcp__demo_server__read",
            {"secret": "do-not-log"},
            "call-1",
            Signal(),
        )
        rendered = repr(session.traces())
        self.assertNotIn("do-not-log", rendered)
        self.assertNotIn("Read remotely", rendered)


if __name__ == "__main__":
    unittest.main()
