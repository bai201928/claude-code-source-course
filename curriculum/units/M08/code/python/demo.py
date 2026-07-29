import json
from dataclasses import asdict

from capability_projection import (
    CapabilityCatalog,
    CapabilityDefinition,
    CapabilityProjector,
    ExecutableRegistry,
    ProjectionOptions,
)

catalog = CapabilityCatalog()
projector = CapabilityProjector()
registry = ExecutableRegistry()
registry.register("Read", lambda value: f"read:{value}")
registry.register("Search", lambda value: f"search:{value}")

revision1 = catalog.publish(
    [
        CapabilityDefinition("Read", "Read a file", "builtin", 100),
        CapabilityDefinition("Deploy", "Deploy", "plugin", 50),
    ]
)
first = projector.project(
    revision1,
    ProjectionOptions(
        "model-iteration-1",
        "default",
        "first-party",
        "large",
        policy_hidden_names=frozenset({"Deploy"}),
    ),
)
revision2 = catalog.publish(
    [
        CapabilityDefinition(
            "Search", "Search files", "mcp", 40, deferred=True
        )
    ]
)
second = projector.project(
    revision2,
    ProjectionOptions(
        "model-iteration-2",
        "default",
        "first-party",
        "large",
        policy_hidden_names=frozenset({"Deploy"}),
        discovered_deferred_names=frozenset({"Search"}),
    ),
)

print(
    json.dumps(
        {
            "oldSnapshot": {
                "revision": first.catalog_revision,
                "visible": [schema.name for schema in first.schemas],
            },
            "refreshedSnapshot": {
                "revision": second.catalog_revision,
                "visible": [schema.name for schema in second.schemas],
            },
            "registry": registry.names(),
            "searchResult": registry.dispatch(second, "Search", "query loop"),
            "decisions": [asdict(item) for item in second.decisions],
        },
        ensure_ascii=False,
        indent=2,
    )
)

