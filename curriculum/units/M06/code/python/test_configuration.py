import unittest

from configuration import (
    PolicyProvider,
    SourceInput,
    assert_editable_source,
    derive_canonical_order,
    derive_snapshot_compatible_order,
    project_environment,
    resolve_configuration,
    thaw_json,
)


class ConfigurationTests(unittest.TestCase):
    def test_default_merge_and_provenance(self) -> None:
        snapshot = resolve_configuration(
            revision=1,
            sources={
                "userSettings": SourceInput(
                    {
                        "permissions": {
                            "defaultMode": "default",
                            "allow": ["Read", "Bash(git status)"],
                        }
                    }
                ),
                "projectSettings": SourceInput(
                    {
                        "permissions": {
                            "defaultMode": "plan",
                            "allow": ["Read", "Glob"],
                        }
                    }
                ),
                "flagSettings": SourceInput(
                    {"permissions": {"defaultMode": "acceptEdits"}}
                ),
            },
            policy_providers=[
                PolicyProvider(
                    settings={"permissions": {"defaultMode": "dontAsk"}},
                    name="managedFile",
                )
            ],
        )
        self.assertEqual(
            thaw_json(snapshot.effective["permissions"]),
            {
                "defaultMode": "dontAsk",
                "allow": ["Read", "Bash(git status)", "Glob"],
            },
        )
        self.assertEqual(
            snapshot.provenance.leaves["permissions.defaultMode"],
            "policySettings",
        )
        self.assertEqual(
            snapshot.provenance.array_items["permissions.allow[2]"],
            "projectSettings",
        )

    def test_snapshot_compatible_order_is_observable(self) -> None:
        self.assertEqual(
            derive_canonical_order([]), ["flagSettings", "policySettings"]
        )
        self.assertEqual(
            derive_snapshot_compatible_order([]),
            ["policySettings", "flagSettings"],
        )
        self.assertEqual(
            derive_snapshot_compatible_order(["localSettings", "userSettings"]),
            ["localSettings", "userSettings", "policySettings", "flagSettings"],
        )
        common = {
            "revision": 1,
            "selected_ordinary_sources": [],
            "sources": {
                "flagSettings": SourceInput({"model": "flag-model"})
            },
            "policy_providers": [
                PolicyProvider(settings={"model": "policy-model"}, name="mdm")
            ],
        }
        self.assertEqual(resolve_configuration(**common).effective["model"], "policy-model")
        self.assertEqual(
            resolve_configuration(
                **common, order_mode="snapshot-compatible"
            ).effective["model"],
            "flag-model",
        )

    def test_first_valid_non_empty_policy_provider_wins(self) -> None:
        snapshot = resolve_configuration(
            revision=1,
            policy_providers=[
                PolicyProvider(
                    settings={"model": "bad"},
                    valid=False,
                    error="remote invalid",
                    name="remote",
                ),
                PolicyProvider(settings={}, name="mdm"),
                PolicyProvider(
                    settings={"model": "managed", "env": {"A": "one"}},
                    name="managedFile",
                ),
                PolicyProvider(
                    settings={"model": "hkcu", "env": {"B": "two"}},
                    name="hkcu",
                ),
            ],
        )
        self.assertEqual(snapshot.policy_provider, "managedFile")
        self.assertEqual(snapshot.effective["model"], "managed")
        self.assertEqual(thaw_json(snapshot.effective["env"]), {"A": "one"})
        self.assertEqual(snapshot.errors, ("remote invalid",))

    def test_invalid_source_is_rejected_as_a_whole(self) -> None:
        snapshot = resolve_configuration(
            revision=1,
            sources={
                "userSettings": SourceInput({"model": "user"}),
                "projectSettings": SourceInput(
                    {"model": "project", "permissions": {"allow": ["Read"]}},
                    valid=False,
                    error="project schema rejected",
                ),
            },
        )
        self.assertEqual(snapshot.effective["model"], "user")
        self.assertNotIn("permissions", snapshot.effective)
        self.assertEqual(snapshot.errors, ("project schema rejected",))

    def test_flag_inline_overrides_file_inside_one_source(self) -> None:
        snapshot = resolve_configuration(
            revision=1,
            sources={
                "flagSettings": SourceInput(
                    {"model": "file", "permissions": {"allow": ["Read"]}}
                )
            },
            flag_inline=SourceInput(
                {"model": "inline", "permissions": {"allow": ["Glob"]}}
            ),
        )
        self.assertEqual(snapshot.effective["model"], "inline")
        self.assertEqual(
            thaw_json(snapshot.effective["permissions"]),
            {"allow": ["Read", "Glob"]},
        )

    def test_pre_trust_and_trusted_env_are_distinct(self) -> None:
        snapshot = resolve_configuration(
            revision=1,
            sources={
                "userSettings": SourceInput(
                    {
                        "env": {
                            "ANTHROPIC_BASE_URL": "https://user.example",
                            "USER_ONLY": "yes",
                        }
                    }
                ),
                "projectSettings": SourceInput(
                    {
                        "env": {
                            "ANTHROPIC_BASE_URL": "https://project.example",
                            "CLAUDE_CODE_USE_BEDROCK": "1",
                            "PATH": "project-bin",
                        }
                    }
                ),
            },
        )
        self.assertEqual(
            project_environment(snapshot, "pre-trust"),
            {
                "ANTHROPIC_BASE_URL": "https://user.example",
                "USER_ONLY": "yes",
                "CLAUDE_CODE_USE_BEDROCK": "1",
            },
        )
        self.assertEqual(
            project_environment(snapshot, "trusted"),
            {
                "ANTHROPIC_BASE_URL": "https://project.example",
                "USER_ONLY": "yes",
                "CLAUDE_CODE_USE_BEDROCK": "1",
                "PATH": "project-bin",
            },
        )

    def test_flag_and_policy_are_read_only(self) -> None:
        self.assertEqual(assert_editable_source("localSettings"), "localSettings")
        with self.assertRaisesRegex(ValueError, "read-only"):
            assert_editable_source("flagSettings")
        with self.assertRaisesRegex(ValueError, "read-only"):
            assert_editable_source("policySettings")

    def test_new_revision_does_not_mutate_old_snapshot(self) -> None:
        source = {"model": "v1", "nested": {"value": 1}}
        first = resolve_configuration(
            revision=1,
            sources={"userSettings": SourceInput(source)},
        )
        source["model"] = "v2"
        second = resolve_configuration(
            revision=2,
            sources={"userSettings": SourceInput(source)},
        )
        self.assertEqual(first.effective["model"], "v1")
        self.assertEqual(second.effective["model"], "v2")
        with self.assertRaises(TypeError):
            first.effective["model"] = "mutated"  # type: ignore[index]

    def test_explicit_order_requires_mandatory_layers(self) -> None:
        with self.assertRaisesRegex(ValueError, "must be present"):
            resolve_configuration(revision=1, source_order=["userSettings"])


if __name__ == "__main__":
    unittest.main()

