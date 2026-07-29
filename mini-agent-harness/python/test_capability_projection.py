import unittest

from capability_projection import (
    CapabilityCatalog,
    CapabilityDefinition,
    CapabilityProjector,
    ExecutableRegistry,
    ProjectionOptions,
    SystemContextBuilder,
)

READ = CapabilityDefinition("Read", "Read", "builtin", 100)


def options(boundary: str, **overrides) -> ProjectionOptions:
    return ProjectionOptions(
        boundary=boundary,
        mode="default",
        provider="first-party",
        model="large",
        **overrides,
    )


class CapabilityProjectionTests(unittest.TestCase):
    def test_priority_resolves_one_active_definition(self) -> None:
        value = CapabilityCatalog().publish(
            [
                CapabilityDefinition("Read", "shadow", "plugin", 10),
                READ,
            ]
        )
        self.assertEqual(len(value.capabilities), 1)
        self.assertEqual(value.capabilities[0].source, "builtin")

    def test_policy_visibility_and_registry_are_separate(self) -> None:
        catalog = CapabilityCatalog()
        registry = ExecutableRegistry()
        registry.register("Read", lambda _value: "read")
        registry.register("Deploy", lambda _value: "deploy")
        snapshot = CapabilityProjector().project(
            catalog.publish(
                [READ, CapabilityDefinition("Deploy", "Deploy", "plugin", 50)]
            ),
            options("request-1", policy_hidden_names=frozenset({"Deploy"})),
        )
        self.assertEqual(tuple(item.name for item in snapshot.schemas), ("Read",))
        self.assertEqual(registry.names(), ("Deploy", "Read"))
        self.assertEqual(
            (snapshot.boundary, snapshot.mode, snapshot.provider, snapshot.model),
            ("request-1", "default", "first-party", "large"),
        )

    def test_new_revision_does_not_mutate_old_request(self) -> None:
        catalog = CapabilityCatalog()
        projector = CapabilityProjector()
        first = projector.project(catalog.publish([READ]), options("iteration-1"))
        second = projector.project(
            catalog.publish(
                [CapabilityDefinition("Search", "Search", "mcp", 40)]
            ),
            options("iteration-2"),
        )
        self.assertEqual(first.catalog_revision, 1)
        self.assertEqual(tuple(item.name for item in first.schemas), ("Read",))
        self.assertEqual(second.catalog_revision, 2)
        self.assertEqual(
            tuple(item.name for item in second.schemas), ("Read", "Search")
        )

    def test_deferred_tool_requires_discovery(self) -> None:
        revision = CapabilityCatalog().publish(
            [
                READ,
                CapabilityDefinition(
                    "Search", "Search", "mcp", 40, deferred=True
                ),
            ]
        )
        projector = CapabilityProjector()
        before = projector.project(revision, options("before"))
        after = projector.project(
            revision,
            options(
                "after",
                discovered_deferred_names=frozenset({"Search"}),
            ),
        )
        self.assertEqual(tuple(item.name for item in before.schemas), ("Read",))
        self.assertEqual(
            tuple(item.name for item in after.schemas), ("Read", "Search")
        )

    def test_visible_but_unregistered_dispatch_fails_closed(self) -> None:
        snapshot = CapabilityProjector().project(
            CapabilityCatalog().publish(
                [CapabilityDefinition("Ghost", "Ghost", "dynamic", 1)]
            ),
            options("divergent"),
        )
        with self.assertRaisesRegex(
            ValueError, "visible tool has no executable handler"
        ):
            ExecutableRegistry().dispatch(snapshot, "Ghost", {})

    def test_custom_prompt_replaces_default_and_append_is_separate(self) -> None:
        result = SystemContextBuilder().build(
            default_prompt=["default"],
            custom_prompt="custom",
            append_prompt="policy",
            user_context={"claudeMd": "rules"},
            system_context={"cwd": "D:/work"},
        )
        self.assertEqual(result.system_prompt, ("custom", "policy"))
        self.assertEqual(result.base, "custom")
        self.assertEqual(result.meta_user_context["claudeMd"], "rules")


if __name__ == "__main__":
    unittest.main()
