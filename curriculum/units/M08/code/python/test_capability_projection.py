import unittest

from capability_projection import (
    CapabilityCatalog,
    CapabilityDefinition,
    CapabilityProjector,
    ExecutableRegistry,
    ProjectionOptions,
    SystemContextBuilder,
)

READ = CapabilityDefinition(
    name="Read",
    description="Read a file",
    source="builtin",
    priority=100,
)
DEPLOY = CapabilityDefinition(
    name="Deploy",
    description="Deploy the service",
    source="plugin",
    priority=50,
)


def options(boundary: str, **overrides) -> ProjectionOptions:
    values = {
        "boundary": boundary,
        "mode": "default",
        "provider": "first-party",
        "model": "large",
        **overrides,
    }
    return ProjectionOptions(**values)


class CapabilityProjectionTests(unittest.TestCase):
    def test_catalog_resolves_same_name_by_priority(self) -> None:
        catalog = CapabilityCatalog()
        snapshot = catalog.publish(
            [
                CapabilityDefinition(
                    name="Read",
                    description="plugin shadow",
                    source="plugin",
                    priority=20,
                ),
                READ,
            ]
        )
        self.assertEqual(len(snapshot.capabilities), 1)
        self.assertEqual(snapshot.capabilities[0].source, "builtin")

    def test_policy_hides_executable_without_removing_handler(self) -> None:
        catalog = CapabilityCatalog()
        registry = ExecutableRegistry()
        registry.register("Read", lambda _value: "read")
        registry.register("Deploy", lambda _value: "deployed")
        snapshot = CapabilityProjector().project(
            catalog.publish([READ, DEPLOY]),
            options("request-1", policy_hidden_names=frozenset({"Deploy"})),
        )
        self.assertEqual(tuple(schema.name for schema in snapshot.schemas), ("Read",))
        self.assertEqual(registry.names(), ("Deploy", "Read"))
        deploy_decision = next(
            item for item in snapshot.decisions if item.name == "Deploy"
        )
        self.assertEqual(deploy_decision.reason, "hidden-by-policy")

    def test_new_revision_does_not_mutate_old_request(self) -> None:
        catalog = CapabilityCatalog()
        projector = CapabilityProjector()
        request1 = projector.project(
            catalog.publish([READ]), options("request-1")
        )
        revision2 = catalog.publish(
            [
                CapabilityDefinition(
                    name="Search",
                    description="Search files",
                    source="mcp",
                    priority=40,
                )
            ]
        )
        self.assertEqual(request1.catalog_revision, 1)
        self.assertEqual(tuple(item.name for item in request1.schemas), ("Read",))
        self.assertEqual(revision2.revision, 2)

    def test_refresh_boundary_creates_a_new_snapshot(self) -> None:
        catalog = CapabilityCatalog()
        projector = CapabilityProjector()
        first = projector.project(
            catalog.publish([READ]), options("model-iteration-1")
        )
        second = projector.project(
            catalog.publish(
                [
                    CapabilityDefinition(
                        name="Search",
                        description="Search files",
                        source="mcp",
                        priority=40,
                    )
                ]
            ),
            options("model-iteration-2"),
        )
        self.assertEqual(tuple(item.name for item in first.schemas), ("Read",))
        self.assertEqual(
            tuple(item.name for item in second.schemas), ("Read", "Search")
        )

    def test_deferred_executable_requires_discovery_for_schema(self) -> None:
        catalog = CapabilityCatalog()
        projector = CapabilityProjector()
        registry = ExecutableRegistry()
        revision = catalog.publish(
            [
                READ,
                CapabilityDefinition(
                    name="Search",
                    description="Search files",
                    source="mcp",
                    priority=40,
                    deferred=True,
                ),
            ]
        )
        registry.register("Read", lambda _value: "read")
        registry.register("Search", lambda _value: "searched")
        before = projector.project(revision, options("before-discovery"))
        after = projector.project(
            revision,
            options(
                "after-discovery",
                discovered_deferred_names=frozenset({"Search"}),
            ),
        )
        self.assertEqual(tuple(item.name for item in before.schemas), ("Read",))
        self.assertEqual(
            tuple(item.name for item in after.schemas), ("Read", "Search")
        )
        self.assertEqual(registry.names(), ("Read", "Search"))

    def test_dispatch_fails_closed_without_handler(self) -> None:
        snapshot = CapabilityProjector().project(
            CapabilityCatalog().publish(
                [
                    CapabilityDefinition(
                        name="Ghost",
                        description="Injected schema",
                        source="dynamic",
                        priority=1,
                    )
                ]
            ),
            options("request-with-divergence"),
        )
        with self.assertRaisesRegex(
            ValueError, "visible tool has no executable handler"
        ):
            ExecutableRegistry().dispatch(snapshot, "Ghost", {})

    def test_projection_reasons_are_observable(self) -> None:
        catalog = CapabilityCatalog()
        snapshot = CapabilityProjector().project(
            catalog.publish(
                [
                    CapabilityDefinition(
                        "ModeOnly", "mode", "builtin", 100, modes=("plan",)
                    ),
                    CapabilityDefinition(
                        "ProviderOnly",
                        "provider",
                        "builtin",
                        100,
                        providers=("bedrock",),
                    ),
                    CapabilityDefinition(
                        "ModelOnly",
                        "model",
                        "builtin",
                        100,
                        models=("small",),
                    ),
                ]
            ),
            options("filtered-request"),
        )
        self.assertEqual(
            tuple(item.reason for item in snapshot.decisions),
            ("mode-mismatch", "model-mismatch", "provider-mismatch"),
        )

    def test_custom_prompt_replaces_default_and_append_is_separate(self) -> None:
        result = SystemContextBuilder().build(
            default_prompt=["default identity", "default rules"],
            custom_prompt="custom identity",
            append_prompt="enterprise policy",
            user_context={"claudeMd": "project guidance"},
            system_context={"cwd": "D:/work"},
        )
        self.assertEqual(result.base, "custom")
        self.assertEqual(
            result.system_prompt, ("custom identity", "enterprise policy")
        )
        self.assertEqual(result.meta_user_context["claudeMd"], "project guidance")
        self.assertEqual(result.system_context["cwd"], "D:/work")


if __name__ == "__main__":
    unittest.main()
