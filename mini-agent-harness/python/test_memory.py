import unittest

from memory import (
    MemoryCandidateInput,
    MemoryProjector,
    MemoryRevisionConflictError,
    MemoryScope,
    MemoryStore,
    MemoryTransitionError,
    MemoryProvenance,
)


PROJECT = MemoryScope("project", "repo-a")
SESSION = MemoryScope("session", "session-1")


def candidate(identifier, key, content, scope):
    return MemoryCandidateInput(
        identifier,
        key,
        content,
        scope,
        MemoryProvenance("user", (identifier,), 1000),
    )


class MemoryStoreTests(unittest.TestCase):
    def test_candidate_requires_acceptance(self):
        store = MemoryStore(lambda: 1000)
        store.propose(0, candidate("m1", "style", "Use TypeScript", PROJECT))
        self.assertEqual(store.recall(PROJECT, "TypeScript"), ())
        store.transition(1, "m1", "accepted", retention_ms=500)
        self.assertEqual(len(store.recall(PROJECT, "TypeScript", now_ms=1200)), 1)

    def test_scope_isolation(self):
        store = MemoryStore(lambda: 1000)
        store.propose(0, candidate("project", "rule", "project rule", PROJECT))
        store.transition(1, "project", "accepted")
        store.propose(2, candidate("session", "rule", "session rule", SESSION))
        store.transition(3, "session", "accepted")
        self.assertEqual(tuple(item.record.id for item in store.recall(PROJECT, "")), ("project",))
        self.assertEqual(tuple(item.record.id for item in store.recall(SESSION, "")), ("session",))

    def test_duplicate_merge(self):
        store = MemoryStore(lambda: 1000)
        store.propose(0, candidate("m1", "preference", "compact output", PROJECT))
        snapshot = store.propose(1, candidate("m2", "preference", "different text", PROJECT))
        self.assertEqual(snapshot.revision, 1)
        self.assertEqual(tuple(item.id for item in snapshot.records), ("m1",))
        self.assertEqual(store.traces()[-1].operation, "merge")

    def test_stale_revision(self):
        store = MemoryStore(lambda: 1000)
        store.propose(0, candidate("m1", "key", "value", PROJECT))
        with self.assertRaises(MemoryRevisionConflictError):
            store.transition(0, "m1", "accepted")
        store.transition(1, "m1", "accepted")
        with self.assertRaises(MemoryRevisionConflictError):
            store.update_accepted(1, "m1", content="new", provenance=MemoryProvenance("user", ("x",), 1000))

    def test_expiry(self):
        store = MemoryStore(lambda: 1000)
        store.propose(0, candidate("m1", "temporary", "expires", PROJECT))
        store.transition(1, "m1", "accepted", retention_ms=10)
        self.assertEqual(len(store.recall(PROJECT, "", now_ms=1009)), 1)
        store.expire(2, 1010)
        self.assertEqual(store.recall(PROJECT, "", now_ms=1010), ())
        self.assertEqual(store.snapshot().records[0].status, "expired")

    def test_bounded_recall_and_projector(self):
        store = MemoryStore(lambda: 1000)
        store.propose(0, candidate("m1", "language", "Answer in Chinese", PROJECT))
        store.transition(1, "m1", "accepted")
        item = store.recall(PROJECT, "language", max_chars=5)[0]
        self.assertEqual(item.content, "Answe")
        self.assertTrue(item.truncated)
        projection = MemoryProjector(store).project(PROJECT, "language", max_chars=100)
        self.assertIn("Answer in Chinese", projection.text)
        self.assertNotIn("Answer in Chinese", repr(store.traces()))

    def test_only_accepted_can_update(self):
        store = MemoryStore(lambda: 1000)
        store.propose(0, candidate("old", "rule", "old", PROJECT))
        store.propose(1, candidate("new", "new-rule", "new", PROJECT))
        with self.assertRaises(MemoryTransitionError):
            store.transition(2, "old", "superseded")
        store.transition(2, "old", "accepted")
        store.transition(3, "new", "accepted")
        store.transition(4, "old", "superseded", superseded_by="new")
        self.assertEqual(
            next(item for item in store.snapshot().records if item.id == "old").status,
            "superseded",
        )


if __name__ == "__main__":
    unittest.main()
