# Skills

[Back to User Guide](../README.md)

Skills provide specialized instructions for the Agent runtime.

A skill should describe when it applies, what files or project facts it needs, and what boundaries it must respect. It should not replace product rules or invent a write path that bypasses staging and review.

Skills used for RPG Maker MV work must preserve the new-event placement boundary. They may generate event content or identify existing events, but they must not choose final coordinates without user placement.

Maintain skills as product-facing behavior, not one-off prompt snippets. Update them when the controlled workflow changes.

