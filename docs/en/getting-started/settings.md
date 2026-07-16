# Settings

[Back to User Guide](../README.md)

Settings control the model provider, execution engine, product language, tool permissions, and local project behavior.

Model and provider settings bind the local Agent runtime to a provider, model, API key, and base URL. If a model test fails, fix the provider configuration before starting a production session.

The provider directory comes from two sources. Click **Sync providers** to write both into local storage:

- **Built-in providers**: the opencode/models.dev runtime catalog (OpenAI, Anthropic, and more).
- **Product supplements**: Volcano Ark Agent Plan / Coding Plan / DouBaoSeed / BytePlus (local seeds for endpoints that are not in the opencode catalog).

Some product supplements that don't expose a model-list endpoint (e.g. Volcano Ark Agent Plan) disable the "fetch models from API" action; pick from their preset list instead. Syncing providers writes the runtime catalog and product supplements (including model context-limit metadata) and removes unkeyed legacy presets that are outside the current catalog/seed set; providers that already have an API key are kept. Sync requires a working runtime; failures are reported explicitly and do not silently fall back to seed-only import.

Language settings control product UI language. RPG Agent MV supports `zh-CN` and `en-US`; this does not change the language of existing game content, dialogue, event text, or asset names.

Permission settings define what the Agent runtime may read or write. The Agent should work inside the selected RPG Maker MV or supported MZ project and the RPG Agent MV product workspace. It should not inspect unrelated user folders or global configuration paths.

Rules and preferences shape Agent behavior. Product rules protect controlled event placement, staged writes, reviewable changes, and fail-fast behavior when required context is missing.

