from __future__ import annotations

import logging
from typing import Any

from .llm_config import LLMProfileConfig, get_default_llm_config, get_llm_config

logger = logging.getLogger(__name__)


def call_llm(
    messages: list[dict[str, str]],
    config: LLMProfileConfig | None = None,
    profile_id: str | None = None,
    temperature: float = 0.1,
    max_tokens: int = 4096,
) -> str:
    from litellm import completion

    if config is None:
        if profile_id:
            config = get_llm_config(profile_id)
        else:
            config = get_default_llm_config()

    if not config.model:
        raise ValueError(f"No model configured for profile '{config.profile_id}'")

    kwargs: dict[str, Any] = {
        "model": config.model,
        "messages": messages,
        "temperature": temperature,
        "max_tokens": max_tokens,
    }
    if config.api_base:
        kwargs["api_base"] = config.api_base
    if config.api_key:
        kwargs["api_key"] = config.api_key

    logger.debug("LLM call: model=%s, api_base=%s", config.model, config.api_base)
    response = completion(**kwargs)
    content = response.choices[0].message.content
    if content is None:
        raise ValueError("LLM returned empty content")
    return content.strip()
