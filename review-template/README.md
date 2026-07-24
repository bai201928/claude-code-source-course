# Review Template

This directory contains the template files copied into each isolated review workspace.

## CLAUDE.md

The `CLAUDE.md` file defines the constraints for Claude Code when running as a reviewer (backed by DeepSeek). It enforces:

- Strict access boundaries (no `../`, no absolute paths to main project)
- JSON-only output protocol
- Review independence rules (Stage A blind review vs Stage B comparative review)
- Credential safety rules
- No Codex invocation, no Git operations, no network access

## Usage

When creating a review workspace via `New-ReviewWorkspace.ps1`, the `CLAUDE.md` from this directory is automatically copied to the workspace root.
