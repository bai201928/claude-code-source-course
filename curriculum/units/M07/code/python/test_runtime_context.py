import unittest

from runtime_context import (
    SessionStateStore,
    SynchronousStore,
    create_request_context,
    create_runtime_context,
    read_fresh_session,
)


class RuntimeContextTests(unittest.TestCase):
    def test_dependencies_fail_before_request_start(self) -> None:
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
        root = {"count": 0}
        store = SynchronousStore(root, lambda _new, _old: trace.append("observer"))
        store.subscribe(lambda: trace.append("subscriber"))

        def mutate(previous):
            previous["count"] = 1
            return previous

        store.set_state(mutate)
        self.assertEqual(store.get_state()["count"], 1)
        self.assertEqual(trace, [])

    def test_new_root_observer_precedes_ordered_subscribers(self) -> None:
        trace: list[str] = []
        store = SynchronousStore(
            {"count": 0},
            lambda new, old: trace.append(
                f"observer:{old['count']}->{new['count']}"
            ),
        )
        store.subscribe(lambda: trace.append("subscriber:first"))
        unsubscribe = store.subscribe(lambda: trace.append("subscriber:second"))
        store.set_state(lambda previous: {"count": previous["count"] + 1})
        unsubscribe()
        unsubscribe()
        store.set_state(lambda previous: {"count": previous["count"] + 1})
        self.assertEqual(
            trace,
            [
                "observer:0->1",
                "subscriber:first",
                "subscriber:second",
                "observer:1->2",
                "subscriber:first",
            ],
        )

    def test_listener_failure_leaves_state_committed(self) -> None:
        trace: list[str] = []
        store = SynchronousStore({"count": 0})

        def failing_listener() -> None:
            trace.append("first")
            raise RuntimeError("listener failed")

        store.subscribe(failing_listener)
        store.subscribe(lambda: trace.append("second"))
        with self.assertRaisesRegex(RuntimeError, "listener failed"):
            store.set_state(lambda previous: {"count": previous["count"] + 1})
        self.assertEqual(store.get_state()["count"], 1)
        self.assertEqual(trace, ["first"])

    def test_request_context_freezes_revisions(self) -> None:
        runtime = create_runtime_context(
            runtime_id="runtime-1",
            configuration_revision=7,
            model_adapter="fake-model",
            started_at=100.0,
        )
        session = SessionStateStore({"mode": "default"})
        request = create_request_context(runtime, session, "request-1")
        session.publish({"mode": "plan"})
        self.assertEqual(request.configuration_revision, 7)
        self.assertEqual(request.session_revision, 1)
        self.assertEqual(request.session_values["mode"], "default")
        self.assertEqual(session.get_state().revision, 2)
        self.assertEqual(session.get_state().values["mode"], "plan")

    def test_fresh_read_does_not_mutate_request_snapshot(self) -> None:
        runtime = create_runtime_context(
            runtime_id="runtime-1",
            configuration_revision=1,
            model_adapter="fake-model",
            started_at=100.0,
        )
        session = SessionStateStore({"tools": ["Read"]})
        request = create_request_context(runtime, session, "request-1")
        session.publish({"tools": ["Read", "Glob"]})
        fresh = read_fresh_session(request, session)
        self.assertEqual(request.session_values["tools"], ("Read",))
        self.assertEqual(request.session_revision, 1)
        self.assertEqual(fresh.session_values["tools"], ("Read", "Glob"))
        self.assertEqual(fresh.observed_session_revision, 2)

    def test_session_publication_copies_external_input(self) -> None:
        values = {"nested": {"value": 1}}
        session = SessionStateStore(values)
        values["nested"]["value"] = 2
        self.assertEqual(session.get_state().values["nested"]["value"], 1)
        with self.assertRaises(TypeError):
            session.get_state().values["new"] = True


if __name__ == "__main__":
    unittest.main()

