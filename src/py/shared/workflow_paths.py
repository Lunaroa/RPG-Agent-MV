from __future__ import annotations

import os
import shutil
from pathlib import Path

WORKSPACE_LAYERS = {
    "config": "config",
    "src": "src",
    "data": "data",
    "runtime": "runtime",
}

PATHS = {
    "agents_registry": "config/agents/registry.yaml",
    "data_db": "data/rmmv.db",
    "runtime_root": "runtime",
    "py_root": "src/py",
    "py_root_legacy": "py",
    "cli_out_root": "runtime/out",
    "cli_out_root_legacy": "out",
}

_WORKFLOW_ROOT_MARKERS: tuple[tuple[str, ...], ...] = (
    (PATHS["agents_registry"],),
    (WORKSPACE_LAYERS["src"], "backend"),
    ("src", "backend", "src", "cli.ts"),
)


def _has_markers(root: Path, markers: tuple[str, ...]) -> bool:
    return all((root / segment).exists() for segment in markers)


def resolve_workflow_root(
    from_dir: str | Path | None = None,
    *,
    project_root: str | Path | None = None,
) -> Path:
    """Resolve workflow root: explicit env first, then walk parents for layout markers."""
    env = (
        os.environ.get("AGENT_RPG_ROOT", "").strip()
        or os.environ.get("AIWF_WORKFLOW_ROOT", "").strip()
        or os.environ.get("RMMV_AGENT_WORKFLOW_ROOT", "").strip()
    )
    if env:
        return Path(env).resolve()

    start = Path(from_dir or project_root or Path.cwd()).resolve()
    current = start
    while True:
        for markers in _WORKFLOW_ROOT_MARKERS:
            if _has_markers(current, markers):
                return current
        # Check nested product directories used by source checkouts and packaged layouts.
        for dir_name in ("RPG-Agent-MV", "workspace"):
            nested = current / dir_name
            for markers in _WORKFLOW_ROOT_MARKERS:
                if _has_markers(nested, markers):
                    return nested
        if current.parent == current:
            break
        current = current.parent

    if project_root is not None:
        resolved = Path(project_root).resolve()
        if (resolved / "runtime").is_dir():
            return resolved
        for parent in [resolved, *resolved.parents]:
            if (parent / "runtime").is_dir() and (
                (parent / "config" / "agents").is_dir()
                or (parent / "src" / "backend").is_dir()
            ):
                return parent
        return resolved.parent

    raise RuntimeError(f"Cannot resolve workflow root from {start}")


def resolve_agents_registry_path(workflow_root: Path) -> Path:
    return workflow_root / PATHS["agents_registry"]


def resolve_cli_out_root(workflow_root: Path) -> Path:
    """Ensure runtime/out exists; one-time migrate legacy top-level out/ contents."""
    root = workflow_root.resolve()
    canonical = root / PATHS["cli_out_root"]
    legacy = root / PATHS["cli_out_root_legacy"]

    canonical.mkdir(parents=True, exist_ok=True)

    if legacy.is_dir():
        for entry in list(legacy.iterdir()):
            dest = canonical / entry.name
            if dest.exists():
                if dest.is_dir():
                    shutil.rmtree(dest)
                else:
                    dest.unlink()
            entry.rename(dest)
        if legacy.is_dir() and not any(legacy.iterdir()):
            legacy.rmdir()

    return canonical
