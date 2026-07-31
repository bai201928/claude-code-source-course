import unittest

from extension_registry import (
    ExtensionBundle,
    ExtensionComponent,
    ExtensionRegistry,
    ExtensionSourceIdentity,
    SignatureTrustPolicy,
    StaleExtensionRevisionError,
)


def bundle(marketplace: str, locator: str, name: str = "Read") -> ExtensionBundle:
    return ExtensionBundle(
        "demo",
        ExtensionSourceIdentity(marketplace, locator, "sample", "1.0.0"),
        "local-trusted",
        (ExtensionComponent("skill", name, f"{name} files"),),
        "secret-signature",
    )


class ExtensionRegistryTests(unittest.TestCase):
    def test_full_source_identity_distinguishes_materializations(self) -> None:
        result = ExtensionRegistry().publish(
            0,
            (
                bundle("market-a", "alpha"),
                bundle("market-b", "beta", "Write"),
            ),
        )
        self.assertTrue(result.ok)
        assert result.snapshot is not None
        self.assertEqual(len({item.bundle_key for item in result.snapshot.entries}), 2)

    def test_collision_is_explicit_and_atomic(self) -> None:
        registry = ExtensionRegistry()
        result = registry.publish(
            0, (bundle("market-a", "same"), bundle("market-b", "same"))
        )
        self.assertFalse(result.ok)
        self.assertEqual(tuple(item.qualified_name for item in result.conflicts), ("demo:Read",))
        self.assertEqual(registry.snapshot(), registry.snapshot().__class__(0, ()))

    def test_replacement_is_revisioned_and_old_snapshot_is_immutable(self) -> None:
        registry = ExtensionRegistry()
        first = registry.publish(0, (bundle("market-a", "one"),))
        assert first.snapshot is not None
        old = first.snapshot
        registry.publish(1, (bundle("market-a", "two", "Write"),))
        self.assertEqual(tuple(item.qualified_name for item in old.entries), ("demo:Read",))
        with self.assertRaises(StaleExtensionRevisionError):
            registry.publish(1, ())

    def test_unload_removes_new_snapshot_membership(self) -> None:
        registry = ExtensionRegistry()
        registry.publish(0, (bundle("market-a", "one"),))
        result = registry.publish(1, ())
        assert result.snapshot is not None
        self.assertEqual(result.snapshot.entries, ())

    def test_old_snapshot_cannot_start_after_unload(self) -> None:
        registry = ExtensionRegistry()
        loaded = registry.publish(0, (bundle("market-a", "one"),))
        assert loaded.snapshot is not None
        registry.publish(1, ())
        with self.assertRaisesRegex(ValueError, "no longer active"):
            registry.acquire(loaded.snapshot, "demo:Read")

    def test_acquired_lease_survives_until_release(self) -> None:
        registry = ExtensionRegistry()
        loaded = registry.publish(0, (bundle("market-a", "one"),))
        assert loaded.snapshot is not None
        lease = registry.acquire(loaded.snapshot, "demo:Read")
        registry.publish(1, ())
        self.assertTrue(lease.valid)
        lease.release()
        self.assertFalse(lease.valid)

    def test_trust_policy_fails_before_publication(self) -> None:
        registry = ExtensionRegistry(SignatureTrustPolicy())
        signed = bundle("market-a", "one")
        signed = ExtensionBundle(
            signed.namespace, signed.source, "signed", signed.components
        )
        with self.assertRaisesRegex(ValueError, "signature"):
            registry.publish(0, (signed,))
        untrusted = ExtensionBundle(
            signed.namespace, signed.source, "untrusted", signed.components
        )
        with self.assertRaisesRegex(ValueError, "untrusted"):
            registry.publish(0, (untrusted,))
        self.assertEqual(registry.snapshot().revision, 0)

    def test_adapter_and_trace_are_metadata_only(self) -> None:
        registry = ExtensionRegistry()
        published = registry.publish(0, (bundle("market-a", "one"),))
        assert published.snapshot is not None
        definitions = registry.capability_definitions(published.snapshot)
        self.assertEqual(definitions[0][0], "demo:Read")
        self.assertNotIn("secret-signature", repr(registry.traces()))


if __name__ == "__main__":
    unittest.main()
