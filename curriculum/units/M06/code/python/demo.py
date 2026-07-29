import json

from configuration import (
    PolicyProvider,
    SourceInput,
    derive_snapshot_compatible_order,
    project_environment,
    resolve_configuration,
    thaw_json,
)

snapshot = resolve_configuration(
    revision=7,
    sources={
        "userSettings": SourceInput(
            {
                "permissions": {"defaultMode": "default", "allow": ["Read"]},
                "env": {"ANTHROPIC_BASE_URL": "https://user.example"},
            }
        ),
        "projectSettings": SourceInput(
            {
                "permissions": {
                    "defaultMode": "plan",
                    "allow": ["Read", "Glob"],
                },
                "env": {
                    "ANTHROPIC_BASE_URL": "https://project.example",
                    "CLAUDE_CODE_USE_BEDROCK": "1",
                },
            }
        ),
        "flagSettings": SourceInput(
            {"permissions": {"defaultMode": "acceptEdits"}}
        ),
    },
    policy_providers=[
        PolicyProvider(
            settings={}, valid=False, error="remote schema rejected", name="remote"
        ),
        PolicyProvider(
            settings={"permissions": {"defaultMode": "dontAsk"}},
            name="managedFile",
        ),
    ],
)

print("canonical order:", " -> ".join(snapshot.source_order))
print(
    'snapshot order with --setting-sources "":',
    " -> ".join(derive_snapshot_compatible_order([])),
)
print("policy provider:", snapshot.policy_provider)
print("effective:", json.dumps(thaw_json(snapshot.effective), indent=2))
print(
    "defaultMode source:",
    snapshot.provenance.leaves["permissions.defaultMode"],
)
print("pre-trust env:", project_environment(snapshot, "pre-trust"))
print("trusted env:", project_environment(snapshot, "trusted"))
print("errors:", snapshot.errors)
