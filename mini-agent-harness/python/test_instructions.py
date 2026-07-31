from __future__ import annotations

import unittest
from pathlib import Path

from instructions import (
    InstructionCatalog,
    InstructionPipeline,
    InstructionSource,
    StaleInstructionRevisionError,
)

ROOT = Path.cwd().joinpath("instruction-fixture").resolve()


def source(identifier, kind, relative_path, **overrides):
    values = {
        "id": identifier,
        "kind": kind,
        "file_path": str(ROOT / relative_path),
        "scope_root": str(ROOT),
        "trust": "trusted",
        "content": "secret-delta" if identifier == "delta" else f"{identifier} content",
        "path_prefixes": (),
    }
    values.update(overrides)
    return InstructionSource(**values)


class InstructionPipelineTests(unittest.TestCase):
    def test_stable_source_order(self):
        catalog = InstructionCatalog((
            source("project", "project", "repo/CLAUDE.md"),
            source("managed", "managed", "managed/CLAUDE.md"),
            source("user", "user", "user/CLAUDE.md"),
            source("local", "local", "repo/CLAUDE.local.md"),
        ))
        result = InstructionPipeline().project(
            catalog.snapshot(), str(ROOT / "src/app.ts"),
            (source("turn", "dynamic", "dynamic/turn.md"),),
        )
        self.assertEqual(
            tuple(item.kind for item in result.instructions),
            ("managed", "user", "project", "local", "dynamic"),
        )

    def test_scope_and_conditional_prefixes(self):
        catalog = InstructionCatalog((
            source("java", "project", "repo/java.md", path_prefixes=("src/java",)),
            source("docs", "project", "repo/docs.md", path_prefixes=("docs",)),
            source("nested", "project", "nested/CLAUDE.md", scope_root=str(ROOT / "packages")),
        ))
        report = InstructionPipeline().project(
            catalog.snapshot(), str(ROOT / "src/java/App.java")
        ).report
        self.assertEqual(report.source_ids, ("java",))
        self.assertEqual(report.out_of_scope_count, 2)

    def test_trust_boundary(self):
        catalog = InstructionCatalog((
            source("external-no", "project", "external/no.md", trust="untrusted"),
            source("external-yes", "project", "external/yes.md", trust="approved"),
        ))
        report = InstructionPipeline().project(
            catalog.snapshot(), str(ROOT / "a.ts")
        ).report
        self.assertEqual(report.source_ids, ("external-yes",))
        self.assertEqual(report.untrusted_count, 1)

    def test_normalized_path_dedupe(self):
        catalog = InstructionCatalog((
            source("user-copy", "user", "repo/SHARED.md"),
            source("project-copy", "project", "repo/shared.md"),
        ))
        report = InstructionPipeline().project(
            catalog.snapshot(), str(ROOT / "a.ts")
        ).report
        self.assertEqual(report.source_ids, ("project-copy",))
        self.assertEqual(report.deduplicated_count, 1)

    def test_old_snapshot_is_immutable(self):
        catalog = InstructionCatalog((source("old", "project", "repo/old.md"),))
        old = catalog.snapshot()
        catalog.publish(0, (source("new", "project", "repo/new.md"),))
        self.assertEqual(tuple(item.id for item in old.sources), ("old",))

    def test_stale_writer_and_projection_fail(self):
        catalog = InstructionCatalog((source("old", "project", "repo/old.md"),))
        projected = InstructionPipeline().project(catalog.snapshot(), str(ROOT / "a.ts"))
        catalog.publish(0, (source("new", "project", "repo/new.md"),))
        with self.assertRaises(StaleInstructionRevisionError):
            catalog.publish(0, ())
        with self.assertRaises(StaleInstructionRevisionError):
            catalog.assert_current(projected.catalog_revision)

    def test_dynamic_is_request_only_and_report_is_content_free(self):
        catalog = InstructionCatalog((source("base", "project", "repo/base.md"),))
        result = InstructionPipeline().project(
            catalog.snapshot(), str(ROOT / "a.ts"),
            (source("delta", "dynamic", "dynamic/delta.md"),),
        )
        self.assertTrue(any(item.content == "secret-delta" for item in result.instructions))
        self.assertNotIn("secret-delta", repr(result.report))
        self.assertEqual(tuple(item.id for item in catalog.snapshot().sources), ("base",))


if __name__ == "__main__":
    unittest.main()
