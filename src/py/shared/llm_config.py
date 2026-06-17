from __future__ import annotations

import json
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from py.shared.workflow_paths import resolve_agents_registry_path


@dataclass(frozen=True)
class LLMProfileConfig:
    profile_id: str
    model: str
    api_base: str | None
    api_key: str | None
    provider: str | None
    protocol: str | None


def _find_project_root() -> Path:
    from py.shared.workflow_paths import resolve_workflow_root

    return resolve_workflow_root(Path(__file__).resolve().parent)


def _read_json_yaml(file_path: Path) -> dict[str, Any]:
    text = file_path.read_text(encoding="utf-8").lstrip("\ufeff")
    return json.loads(text)


def _read_env_file(file_path: Path) -> dict[str, str]:
    result = {}
    if not file_path.exists():
        return result
    for raw_line in file_path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        eq = line.find("=")
        if eq < 0:
            continue
        key = line[:eq].strip()
        value = line[eq + 1:].strip()
        if (value.startswith('"') and value.endswith('"')) or (value.startswith("'") and value.endswith("'")):
            value = value[1:-1]
        if key:
            result[key] = value
    return result


def load_profiles(workflow_root: Path | None = None) -> dict[str, Any]:
    if workflow_root is None:
        workflow_root = _find_project_root()
    registry_path = resolve_agents_registry_path(workflow_root)
    if not registry_path.exists():
        return {}
    registry = _read_json_yaml(registry_path)
    profiles_file = registry.get("providerProfilesFile", ".agent-runtime/api-profiles/profiles.yaml")
    profiles_path = workflow_root / profiles_file
    if not profiles_path.exists():
        return {}
    doc = _read_json_yaml(profiles_path)
    return doc.get("profiles", {})


def get_llm_config(
    profile_id: str,
    workflow_root: Path | None = None,
) -> LLMProfileConfig:
    if workflow_root is None:
        workflow_root = _find_project_root()
    profiles = load_profiles(workflow_root)
    profile = profiles.get(profile_id)
    if not profile:
        raise ValueError(f"Profile '{profile_id}' not found in profiles.yaml")

    env_file_hint = os.environ.get("RMMV_AGENT_SECRETS_FILE", "").strip() or profile.get("envFileHint", "")
    env_file = Path(env_file_hint) if env_file_hint else None
    if env_file and not env_file.is_absolute():
        env_file = workflow_root / env_file

    env_vars = _read_env_file(env_file) if env_file and env_file.exists() else {}

    api_key_env = profile.get("apiKeyEnv", "")
    api_key = env_vars.get(api_key_env, "") if api_key_env else ""

    python_config = profile.get("python", {})
    model = python_config.get("litellm_model", profile.get("model", ""))
    api_base = python_config.get("api_base", profile.get("baseUrl", ""))

    if python_config.get("api_key_env"):
        api_key = env_vars.get(python_config["api_key_env"], api_key)

    return LLMProfileConfig(
        profile_id=profile_id,
        model=model,
        api_base=api_base or None,
        api_key=api_key or None,
        provider=profile.get("provider"),
        protocol=profile.get("protocol"),
    )


def get_default_llm_config(workflow_root: Path | None = None) -> LLMProfileConfig:
    if workflow_root is None:
        workflow_root = _find_project_root()
    registry_path = resolve_agents_registry_path(workflow_root)
    if not registry_path.exists():
        raise ValueError("agents/registry.yaml not found")
    registry = _read_json_yaml(registry_path)

    default_profile = registry.get("defaultProfile")
    if not default_profile:
        agents = registry.get("agents", [])
        for agent in agents:
            if agent.get("defaultProfile"):
                default_profile = agent["defaultProfile"]
                break
    if not default_profile:
        raise ValueError("No defaultProfile found in registry.yaml")
    return get_llm_config(default_profile, workflow_root)
