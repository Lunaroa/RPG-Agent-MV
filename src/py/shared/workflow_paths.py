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


def _walk_install_root_from_dir(from_dir: Path) -> Path:
    current = from_dir.resolve()
    while True:
        for markers in _WORKFLOW_ROOT_MARKERS:
            if _has_markers(current, markers):
                return current
        for dir_name in ("RPG-Agent-MV", "workspace"):
            nested = current / dir_name
            for markers in _WORKFLOW_ROOT_MARKERS:
                if _has_markers(nested, markers):
                    return nested
        if current.parent == current:
            break
        current = current.parent
    raise RuntimeError(f"Cannot resolve RPG Agent MV product root from {from_dir}")


def resolve_install_root(
    from_dir: str | Path | None = None,
) -> Path:
    """Read-only install / source bundle root."""
    env = os.environ.get("AGENT_RPG_INSTALL_ROOT", "").strip()
    if env:
        return Path(env).resolve()
    start = Path(from_dir or Path.cwd()).resolve()
    return _walk_install_root_from_dir(start)


def resolve_user_data_root(
    from_dir: str | Path | None = None,
    *,
    project_root: str | Path | None = None,
) -> Path:
    """Writable user data root."""
    env = (
        os.environ.get("AGENT_RPG_ROOT", "").strip()
        or os.environ.get("AIWF_WORKFLOW_ROOT", "").strip()
        or os.environ.get("RMMV_AGENT_WORKFLOW_ROOT", "").strip()
    )
    if env:
        return Path(env).resolve()

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

    return resolve_install_root(from_dir)


def resolve_workflow_root(
    from_dir: str | Path | None = None,
    *,
    project_root: str | Path | None = None,
) -> Path:
    """Alias for writable workflow root."""
    return resolve_user_data_root(from_dir, project_root=project_root)


def resolve_shipped_root(fallback_workflow_root: str | Path | None = None) -> Path:
    install = os.environ.get("AGENT_RPG_INSTALL_ROOT", "").strip()
    if install:
        return Path(install).resolve()
    if fallback_workflow_root is not None:
        return Path(fallback_workflow_root).resolve()
    return resolve_install_root()


def resolve_agents_registry_path(workflow_root: Path) -> Path:
    return resolve_shipped_root(workflow_root) / PATHS["agents_registry"]


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
