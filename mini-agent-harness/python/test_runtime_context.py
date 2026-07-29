import unittest

from configuration import resolve_configuration
from runtime_context import (
    SessionStateStore,
    SynchronousStore,
    create_request_context,
    create_runtime_context,
    read_fresh_session,
)


class RuntimeContextTests(unittest.TestCase):
    def test_configuration_revision_enters_runtime_context(self) -> None:
        configuration = resolve_configuration(revision=7)
        runtime = create_runtime_context(
            runtime_id="runtime-1",
            configuration_revision=configuration.revision,
            model_adapter="fake-model",
            started_at=100.0,
        )
        self.assertEqual(runtime.configuration_revision, 7)

    def test_dependencies_fail_before_request(self) -> None:
        with self.assertRaisesRegex(ValueError, "positive integer"):
            create_runtime_context(
                runtime_id="runtime-1",
                configuration_revision=0,
                model_adapter="fake-model",
                started_at=100.0,
            )
        with self.assertRaisesRegex(ValueError, "runtime context is required"):
            create_request_context(None, None, "request-1")

    def test_same_root_mutation_is_silent(self) -> None:
        trace: list[str] = []
        store = SynchronousStore(
            {"count": 0}, lambda _new, _old: trace.append("observer")
        )
        store.subscribe(lambda: trace.append("subscriber"))

        def mutate(previous):
            previous["count"] = 1
            return previous

        store.set_state(mutate)
        self.assertEqual(store.get_state()["count"], 1)
        self.assertEqual(trace, [])

    def test_observer_precedes_ordered_subscribers(self) -> None:
        trace: list[str] = []
        store = SynchronousStore(
            {"count": 0}, lambda new, _old: trace.append(f"observer:{new['count']}")
        )
        store.subscribe(lambda: trace.append("first"))
        unsubscribe = store.subscribe(lambda: trace.append("second"))
        store.set_state(lambda previous: {"count": previous["count"] + 1})
        unsubscribe()
        unsubscribe()
        store.set_state(lambda previous: {"count": previous["count"] + 1})
        self.assertEqual(
            trace, ["observer:1", "first", "second", "observer:2", "first"]
        )

    def test_listener_failure_keeps_committed_state(self) -> None:
        trace: list[str] = []
        store = SynchronousStore({"count": 0})

        def fail() -> None:
            trace.append("first")
            raise RuntimeError("listener failed")

        store.subscribe(fail)
        store.subscribe(lambda: trace.append("second"))
        with self.assertRaisesRegex(RuntimeError, "listener failed"):
            store.set_state(lambda previous: {"count": previous["count"] + 1})
        self.assertEqual(store.get_state()["count"], 1)
        self.assertEqual(trace, ["first"])

    def test_request_snapshot_and_fresh_read_coexist(self) -> None:
        runtime = create_runtime_context(
            runtime_id="runtime-1",
            configuration_revision=7,
            model_adapter="fake-model",
            started_at=100.0,
        )
        session = SessionStateStore({"mode": "default", "tools": ["Read"]})
        request = create_request_context(runtime, session, "request-1")
        session.publish({"mode": "plan", "tools": ["Read", "Glob"]})
        fresh = read_fresh_session(request, session)
        self.assertEqual(request.session_revision, 1)
        self.assertEqual(request.session_values["mode"], "default")
        self.assertEqual(fresh.observed_session_revision, 2)
        self.assertEqual(fresh.session_values["mode"], "plan")


if __name__ == "__main__":
    unittest.main()

