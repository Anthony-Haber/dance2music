"""Exercise the official native-shell helpers against disposable project fixtures."""

import importlib.util
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
POWERSHELL = shutil.which("pwsh") or shutil.which("powershell")


class SpecKitScriptTests(unittest.TestCase):
    """Validate the same file and JSON contracts on macOS and Windows."""

    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory(prefix="speckit contracts ")
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name).resolve() / "dancer's project"
        self.templates = self.root / ".specify/templates"
        self.templates.mkdir(parents=True)
        self.feature = self.root / "specs/001-dance"
        self.feature.mkdir(parents=True)
        for name in ("constitution", "plan", "tasks", "checklist", "spec"):
            (self.templates / f"{name}-template.md").write_text(
                f"# {name} template\n", encoding="utf-8"
            )
        for name in ("spec", "plan", "tasks", "quickstart"):
            (self.feature / f"{name}.md").write_text(f"# Existing {name}\n", encoding="utf-8")
        self.state = self.root / ".specify/feature.json"
        self.state.write_text('{"feature_directory":"specs/001-dance"}\n', encoding="utf-8")
        self.environment = os.environ.copy()
        for key in (
            "SPECIFY_INIT_DIR",
            "SPECIFY_FEATURE",
            "SPECIFY_FEATURE_DIRECTORY",
            "SPECIFY_FEATURE_NO_PERSIST",
            "SPECKIT_PYTHON",
            "SPECKIT_PYTHON_EXECUTABLE",
        ):
            self.environment.pop(key, None)
        self.environment["SPECIFY_INIT_DIR"] = str(self.root)
        self.environment["SPECKIT_PYTHON_EXECUTABLE"] = sys.executable
        self.shell = "ps" if os.name == "nt" else "sh"
        if self.shell == "ps" and not POWERSHELL:
            self.skipTest("PowerShell is unavailable")
        if self.shell == "sh" and not shutil.which("bash"):
            self.skipTest("Bash is unavailable")

    def run_helper(
        self,
        name: str,
        sh_args: tuple[str, ...],
        ps_args: tuple[str, ...],
        *,
        shell: str | None = None,
    ) -> subprocess.CompletedProcess[str]:
        """Run a bundled helper without touching the working project's feature state."""
        selected = shell or self.shell
        if selected == "ps":
            command = [
                str(POWERSHELL),
                "-NoProfile",
                "-File",
                f".specify/scripts/powershell/{name}.ps1",
                *ps_args,
            ]
        else:
            command = ["bash", f".specify/scripts/bash/{name}.sh", *sh_args]
        return subprocess.run(
            command,
            cwd=PROJECT_ROOT,
            env=self.environment,
            capture_output=True,
            text=True,
            encoding="utf-8",
            timeout=30,
            check=False,
        )

    def resolve(self) -> subprocess.CompletedProcess[str]:
        return self.run_helper(
            "resolve-template",
            ("constitution-template", "--json"),
            ("constitution-template", "-Json"),
        )

    def test_shared_template_and_override(self) -> None:
        result = self.resolve()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout)["TEMPLATE_CONTENT"], "# constitution template\n")
        overrides = self.templates / "overrides"
        overrides.mkdir()
        (overrides / "constitution-template.md").write_text("# Shared override\n", encoding="utf-8")
        result = self.resolve()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout)["TEMPLATE_CONTENT"], "# Shared override\n")

    def test_missing_template_fails_without_partial_json(self) -> None:
        (self.templates / "constitution-template.md").unlink()
        result = self.resolve()
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(result.stdout, "")
        self.assertIn("Could not resolve", result.stderr)

    def test_paths_only_preserves_local_feature_selection(self) -> None:
        before = self.state.read_bytes()
        self.environment["SPECIFY_FEATURE_DIRECTORY"] = "specs/002-other"
        result = self.run_helper(
            "check-prerequisites", ("--json", "--paths-only"), ("-Json", "-PathsOnly")
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(
            Path(json.loads(result.stdout)["FEATURE_DIR"]), self.root / "specs/002-other"
        )
        self.assertEqual(self.state.read_bytes(), before)

    def test_prerequisites_and_tasks_use_the_shared_documents(self) -> None:
        result = self.run_helper(
            "check-prerequisites",
            ("--json", "--require-spec", "--require-tasks", "--include-tasks"),
            ("-Json", "-RequireSpec", "-RequireTasks", "-IncludeTasks"),
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        data = json.loads(result.stdout)
        self.assertEqual(Path(data["FEATURE_DIR"]), self.feature)
        self.assertEqual(data["AVAILABLE_DOCS"], ["quickstart.md", "tasks.md"])
        result = self.run_helper("setup-tasks", ("--json",), ("-Json",))
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout)["TASKS_TEMPLATE_CONTENT"], "# tasks template\n")
        (self.feature / "tasks.md").unlink()
        result = self.run_helper(
            "check-prerequisites", ("--json", "--require-tasks"), ("-Json", "-RequireTasks")
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("tasks.md not found", result.stderr)

    def test_plan_setup_creates_once_and_preserves_existing_work(self) -> None:
        plan = self.feature / "plan.md"
        plan.unlink()
        result = self.run_helper("setup-plan", ("--json",), ("-Json",))
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(Path(json.loads(result.stdout)["IMPL_PLAN"]), plan)
        self.assertEqual(plan.read_text(encoding="utf-8"), "# plan template\n")
        plan.write_text("# Performer decisions\n", encoding="utf-8")
        result = self.run_helper("setup-plan", ("--json",), ("-Json",))
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(plan.read_text(encoding="utf-8"), "# Performer decisions\n")

    def test_invalid_project_override_fails(self) -> None:
        self.environment["SPECIFY_INIT_DIR"] = str(self.root / "missing")
        result = self.resolve()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("SPECIFY_INIT_DIR", result.stderr)

    @unittest.skipUnless(importlib.util.find_spec("yaml"), "Preset composition requires PyYAML")
    def test_preset_composition_and_invalid_manifest(self) -> None:
        presets = self.root / ".specify/presets"
        preset = presets / "dance"
        preset.mkdir(parents=True)
        (presets / ".registry").write_text('{"presets":{"dance":{"priority":1}}}', encoding="utf-8")
        manifest = preset / "preset.yml"
        manifest.write_text(
            "provides:\n  templates:\n    - type: template\n"
            "      name: constitution-template\n      file: rules.md\n      strategy: prepend\n",
            encoding="utf-8",
        )
        (preset / "rules.md").write_text("# Additional rules\n", encoding="utf-8")
        result = self.resolve()
        self.assertEqual(result.returncode, 0, result.stderr)
        content = json.loads(result.stdout)["TEMPLATE_CONTENT"]
        self.assertLess(
            content.index("# Additional rules"), content.index("# constitution template")
        )
        manifest.write_text("provides: invalid\n", encoding="utf-8")
        result = self.resolve()
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(result.stdout, "")

    def test_feature_creation_persists_a_relative_selection(self) -> None:
        result = self.run_helper(
            "create-new-feature",
            ("--json", "--number", "2", "--short-name", "new-dance", "Add a dance feature"),
            ("-Json", "-Number", "2", "-ShortName", "new-dance", "Add a dance feature"),
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        spec = Path(json.loads(result.stdout)["SPEC_FILE"])
        self.assertEqual(spec.read_text(encoding="utf-8"), "# spec template\n")
        selection = json.loads(self.state.read_text(encoding="utf-8"))["feature_directory"]
        self.assertFalse(Path(selection).is_absolute())
        self.assertEqual(self.root / selection, spec.parent)

    def test_unicode_feature_names_preserve_words_and_fit_the_byte_limit(self) -> None:
        for short_name in ("café-danse", "é" * 200):
            with self.subTest(short_name=short_name):
                result = self.run_helper(
                    "create-new-feature",
                    (
                        "--json",
                        "--dry-run",
                        "--number",
                        "3",
                        "--short-name",
                        short_name,
                        "Add a dance feature",
                    ),
                    (
                        "-Json",
                        "-DryRun",
                        "-Number",
                        "3",
                        "-ShortName",
                        short_name,
                        "Add a dance feature",
                    ),
                )
                self.assertEqual(result.returncode, 0, result.stderr)
                name = json.loads(result.stdout)["BRANCH_NAME"]
                self.assertTrue(name.startswith("003-"))
                self.assertLessEqual(len(name.encode("utf-8")), 244)
                if short_name == "café-danse":
                    self.assertEqual(name, "003-café-danse")

    @unittest.skipUnless(
        os.name != "nt" and POWERSHELL and shutil.which("bash"),
        "Parity requires both shells on a POSIX host",
    )
    def test_template_json_matches_across_shells(self) -> None:
        bash = self.run_helper(
            "resolve-template", ("constitution-template", "--json"), (), shell="sh"
        )
        powershell = self.run_helper(
            "resolve-template", (), ("constitution-template", "-Json"), shell="ps"
        )
        self.assertEqual(bash.returncode, 0, bash.stderr)
        self.assertEqual(powershell.returncode, 0, powershell.stderr)
        self.assertEqual(json.loads(bash.stdout), json.loads(powershell.stdout))


if __name__ == "__main__":
    unittest.main()
