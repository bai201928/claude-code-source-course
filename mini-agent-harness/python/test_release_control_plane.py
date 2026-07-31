import unittest
from dataclasses import replace

from release_control_plane import (
    ProtocolRange,
    ReleaseCompatibilityError,
    ReleaseController,
    ReleaseManifest,
    ReleaseStateError,
    RolloutStage,
    SliWindow,
    SloPolicy,
    SloViolationError,
    WorkerCompatibilityError,
    WorkerDependencies,
    WorkerRegistration,
    WorkerStateError,
)


def active(**changes):
    manifest = ReleaseManifest("release-1", "0.6.0", ProtocolRange(1, 2), (1, 2), 1, 7, 10)
    return replace(manifest, **changes)


def candidate(**changes):
    manifest = ReleaseManifest("release-2", "0.7.0", ProtocolRange(2, 3), (1, 2), 2, 7, 11)
    return replace(manifest, **changes)


def worker(worker_id, manifest, **changes):
    registration = WorkerRegistration(
        worker_id,
        manifest.release_id,
        manifest.protocol.maximum,
        manifest.readable_schema_versions,
        manifest.write_schema_version,
        manifest.policy_revision,
        manifest.feature_revision,
        WorkerDependencies(True, True, True, True),
    )
    return replace(registration, **changes)


STAGES = (
    RolloutStage("canary", 10, 10),
    RolloutStage("half", 50, 50),
    RolloutStage("all", 100, 100),
)


def good_window(samples=100):
    return SliWindow(samples, 0.995, 900, 0, 0)


def controller():
    return ReleaseController(active(), SloPolicy(0.99, 1000, 0.01, 0.02))


def ready_canary():
    subject = controller()
    subject.prepare(1, candidate(), STAGES)
    subject.register_worker(worker("active-1", active()))
    subject.register_worker(worker("candidate-1", candidate()))
    subject.begin_canary(2)
    return subject


class ReleaseControlPlaneTests(unittest.TestCase):
    def test_candidate_must_read_active_schema(self):
        with self.assertRaises(ReleaseCompatibilityError):
            controller().prepare(
                1, candidate(readable_schema_versions=(2,)), STAGES
            )

    def test_previous_must_read_candidate_writes(self):
        subject = ReleaseController(
            active(readable_schema_versions=(1,)),
            SloPolicy(0.99, 1000, 0.01, 0.02),
        )
        with self.assertRaises(ReleaseCompatibilityError):
            subject.prepare(1, candidate(), STAGES)

    def test_binary_canary_cannot_split_policy(self):
        with self.assertRaises(ReleaseCompatibilityError):
            controller().prepare(1, candidate(policy_revision=8), STAGES)

    def test_worker_mismatch_fails_closed(self):
        subject = controller()
        subject.prepare(1, candidate(), STAGES)
        with self.assertRaises(WorkerCompatibilityError):
            subject.register_worker(worker("bad-protocol", candidate(), protocol_version=1))
        with self.assertRaises(WorkerCompatibilityError):
            subject.register_worker(worker("bad-schema", candidate(), write_schema_version=1))
        with self.assertRaises(WorkerCompatibilityError):
            subject.register_worker(worker("bad-policy", candidate(), policy_revision=6))
        with self.assertRaises(WorkerCompatibilityError):
            subject.register_worker(worker("bad-feature", candidate(), feature_revision=10))

    def test_canary_requires_ready_workers(self):
        subject = controller()
        subject.prepare(1, candidate(), STAGES)
        subject.register_worker(worker("active-1", active()))
        with self.assertRaises(ReleaseStateError):
            subject.begin_canary(2)
        subject.register_worker(
            worker(
                "candidate-bad",
                candidate(),
                dependencies=WorkerDependencies(True, False, True, True),
            )
        )
        with self.assertRaises(ReleaseStateError):
            subject.begin_canary(2)
        subject.register_worker(worker("candidate-1", candidate()))
        self.assertEqual(subject.begin_canary(2).traffic_percent, 10)

    def test_stable_bucket_routing(self):
        subject = ready_canary()
        self.assertEqual(subject.select_release(0), "release-2")
        self.assertEqual(subject.select_release(9), "release-2")
        self.assertEqual(subject.select_release(10), "release-1")
        self.assertEqual(subject.select_release(99), "release-1")

    def test_slo_blocks_advancement(self):
        subject = ready_canary()
        with self.assertRaises(SloViolationError):
            subject.advance(3, replace(good_window(10), success_rate=0.8))
        self.assertEqual(subject.report().traffic_percent, 10)

    def test_healthy_windows_promote_candidate(self):
        subject = ready_canary()
        subject.advance(3, good_window(10))
        subject.advance(4, good_window(50))
        report = subject.advance(5, good_window(100))
        self.assertEqual(report.active_release_id, "release-2")
        self.assertEqual(report.previous_release_id, "release-1")
        self.assertEqual(report.rollout_state, "promoted")

    def test_drain_rejects_new_work_and_completes_owned_work(self):
        subject = controller()
        subject.register_worker(worker("active-1", active()))
        subject.acquire_work("active-1", "release-1")
        self.assertEqual(subject.drain_worker("active-1").status, "draining")
        with self.assertRaises(WorkerStateError):
            subject.acquire_work("active-1", "release-1")
        self.assertEqual(subject.complete_work("active-1").status, "drained")

    def test_rollback_restores_routing_and_drains_new_worker(self):
        subject = ready_canary()
        subject.advance(3, good_window(10))
        subject.advance(4, good_window(50))
        subject.advance(5, good_window(100))
        report = subject.rollback(6)
        self.assertEqual(report.active_release_id, "release-1")
        self.assertEqual(report.rollout_state, "rolled_back")
        self.assertEqual(subject.worker("candidate-1").status, "drained")
        serialized = repr(report).lower()
        for forbidden in ("prompt", "tool_input", "tool_result", "secret"):
            self.assertNotIn(forbidden, serialized)


if __name__ == "__main__":
    unittest.main()
