# Settings

[Back to User Guide](../README.md)

Settings control the model provider, execution engine, product language, tool permissions, and local project behavior.

Model and provider settings bind the local Agent runtime to a provider, model, API key, and base URL. If a model test fails, fix the provider configuration before starting a production session.

Language settings control product UI language. RPG Agent MV supports `zh-CN` and `en-US`; this does not change the language of existing game content, dialogue, event text, or asset names.

Permission settings define what the Agent runtime may read or write. The Agent should work inside the selected RPG Maker MV project and the RPG Agent MV product workspace. It should not inspect unrelated user folders or global configuration paths.

Rules and preferences shape Agent behavior. Product rules protect controlled event placement, staged writes, reviewable changes, and fail-fast behavior when required context is missing.

