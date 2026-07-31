import asyncio
import unittest

from work_coordinator import (
    AcknowledgedMailbox,
    DurableScheduler,
    ExecutionSignal,
    RuntimeExecutionRegistry,
    ShutdownCoordinator,
    TeamDirectory,
    TeamMember,
    WorkItemStore,
    metadata_trace,
)


class ManualClock:
    def __init__(self) -> None:
        self.value = 1_000

    def now(self) -> int:
        return self.value

    def advance(self, ms: int) -> None:
        self.value += ms


class WorkCoordinatorTests(unittest.IsolatedAsyncioTestCase):
    def test_work_item_is_not_runtime_execution(self):
        store = WorkItemStore(new_token=lambda: "lease")
        item = store.create("work", "Research")
        self.assertEqual(item.status, "pending")
        self.assertFalse(hasattr(item, "output_file"))

    def test_blockers_then_claim(self):
        store = WorkItemStore(new_token=lambda: "lease")
        store.create("a", "First")
        store.create("b", "Second", ("a",))
        self.assertEqual(store.claim("b", "worker", 100).reason, "blocked")
        first = store.claim("a", "worker", 100)
        store.complete("a", first.lease.token)
        self.assertTrue(store.claim("b", "worker", 100).ok)

    def test_live_lease_fences_competitor(self):
        store = WorkItemStore(new_token=lambda: "lease")
        store.create("work", "Owned")
        self.assertTrue(store.claim("work", "a", 100).ok)
        self.assertEqual(store.claim("work", "b", 100).reason, "claimed")

    def test_heartbeat_expiry_reclaim_and_stale_token(self):
        clock = ManualClock()
        tokens = iter(("a", "b"))
        store = WorkItemStore(clock=clock, new_token=lambda: next(tokens))
        store.create("work", "Recover")
        first = store.claim("work", "a", 100)
        clock.advance(90)
        store.heartbeat("work", first.lease.token, 100)
        clock.advance(101)
        self.assertEqual(store.reclaim_expired(), ("work",))
        self.assertTrue(store.claim("work", "b", 100).ok)
        with self.assertRaisesRegex(ValueError, "stale or missing lease"):
            store.complete("work", first.lease.token)

    def test_stale_revision_is_rejected(self):
        store = WorkItemStore(new_token=lambda: "lease")
        original = store.create("work", "Versioned")
        store.claim("work", "worker", 100, original.revision)
        self.assertEqual(
            store.claim("work", "worker", 100, original.revision).reason,
            "stale_revision",
        )

    async def test_linked_child_follows_parent_cancel(self):
        parent = ExecutionSignal()
        registry = RuntimeExecutionRegistry()

        async def run(signal):
            while not signal.cancelled:
                await asyncio.sleep(0)
            signal.throw_if_cancelled()

        handle = registry.launch(
            execution_id="linked",
            work_item_id="work",
            owner_id="worker",
            mode="background",
            run=run,
            parent_signal=parent,
        )
        parent.cancel("parent stopped")
        self.assertEqual((await handle.done).status, "cancelled")

    async def test_detached_child_needs_explicit_owner_cancel(self):
        parent = ExecutionSignal()
        registry = RuntimeExecutionRegistry()

        async def run(signal):
            while not signal.cancelled:
                await asyncio.sleep(0)
            signal.throw_if_cancelled()

        handle = registry.launch(
            execution_id="detached",
            work_item_id="work",
            owner_id="worker",
            mode="background",
            run=run,
            cancellation="detached",
            parent_signal=parent,
        )
        parent.cancel()
        self.assertFalse(handle.signal.cancelled)
        self.assertTrue(registry.cancel("detached"))
        self.assertEqual((await handle.done).status, "cancelled")

    def test_team_shutdown_handshake(self):
        teams = TeamDirectory()
        teams.create("team", TeamMember("lead", "team-lead", "lead"))
        teams.add_member("team", TeamMember("worker", "researcher", "research"))
        shutdown = ShutdownCoordinator(teams)
        shutdown.request("request", "team", "lead", "worker")
        self.assertEqual(shutdown.respond("request", "worker", True).status, "approved")
        self.assertEqual(teams.require("team").members[1].status, "stopping")
        shutdown.complete("request")
        self.assertEqual(teams.require("team").members[1].status, "stopped")

    def test_mailbox_dedup_redelivery_and_ack(self):
        mailbox = AcknowledgedMailbox()
        kwargs = dict(
            message_id="m1",
            team_id="team",
            sender_id="lead",
            recipient_id="worker",
            kind="work",
            payload={"secret": "not-in-trace"},
        )
        self.assertFalse(mailbox.send(**kwargs).duplicate)
        self.assertTrue(mailbox.send(**kwargs).duplicate)
        self.assertEqual(mailbox.receive("worker")[0].delivery_count, 1)
        self.assertEqual(mailbox.receive("worker")[0].delivery_count, 2)
        mailbox.acknowledge("m1", "worker")
        self.assertEqual(mailbox.receive("worker"), ())

    def test_mailbox_order_and_collision(self):
        mailbox = AcknowledgedMailbox()
        mailbox.send(message_id="m1", team_id="t", sender_id="a", recipient_id="r", kind="text", payload="one")
        mailbox.send(message_id="m2", team_id="t", sender_id="b", recipient_id="r", kind="text", payload="two")
        self.assertEqual(tuple(item.sequence for item in mailbox.receive("r")), (1, 2))
        with self.assertRaisesRegex(ValueError, "collision"):
            mailbox.send(message_id="m1", team_id="t", sender_id="x", recipient_id="r", kind="text", payload="other")

    def test_scheduler_recovers_stable_missed_trigger(self):
        scheduler = DurableScheduler(missed_after_ms=50)
        scheduler.schedule("daily", "work", 100)
        self.assertEqual(scheduler.poll(200)[0].outcome, "missed")
        recovered = DurableScheduler(missed_after_ms=50, state=scheduler.export_state())
        self.assertEqual(recovered.poll(250)[0].trigger_id, "daily@100")
        recovered.commit("daily@100", 250)
        self.assertEqual(recovered.poll(300), ())

    def test_recurring_advance_and_metadata_trace(self):
        scheduler = DurableScheduler()
        scheduler.schedule("repeat", "work", 100, 30)
        scheduler.poll(100)
        scheduler.commit("repeat@100", 110)
        self.assertEqual(scheduler.poll(139), ())
        self.assertEqual(scheduler.poll(140)[0].trigger_id, "repeat@140")
        trace = metadata_trace("work.claimed", "work", "in_progress", 2, 1)
        self.assertNotIn("payload", repr(trace))


if __name__ == "__main__":
    unittest.main()
