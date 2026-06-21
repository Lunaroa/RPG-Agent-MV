# 1.4 First Task

This page walks through a small event task: describe a request, let the Agent read project facts, answer key decisions, generate an event draft, place it manually, review the change, and decide whether to keep it.

## Before You Start

Confirm:

- The current project is the target RMMV project.
- The editor can open the target map.
- Settings contain a usable model.
- The project does not have a large set of unreviewed changes.

## Example Task

For a first task, choose a simple signpost or NPC hint. In the Agent panel, you can enter:

```text
Prepare a placeable signpost event for the current town map.
When the player checks it, show one line telling them to find the village chief at the inn.
Do not change the main story. If the target map is unclear, use ASK before continuing.
After preview approval, the user will choose Apply and drag the event onto the desktop map canvas.
```

If you already know the map ID, make it explicit:

```text
Prepare a placeable signpost event for Map003.
When the player checks it, show: The village chief is waiting at the inn tonight.
Do not decide coordinates. After the event enters the placement queue, the user will drag it near the village entrance.
```

## Flow

1. **Read project facts**: the Agent reads maps, events, switches, variables, and related context.
2. **Handle key decisions**: if map choice, asset choice, or story direction is unclear, the system pauses with ASK.
3. **Generate and preview**: the Agent registers event content and the UI shows an event preview.
4. **Apply to queue**: choose **Apply** in the confirmation card to move the event into the placement queue.
5. **Place manually**: drag the placeable event onto the RPG-Agent-MV desktop map canvas. The system writes the map data.
6. **Review changes**: inspect the chat flow, event preview, editor, run logs, or project diff.
7. **Keep or discard**: keep the change if it matches the request; otherwise discard this attempt or ask for an adjustment.

## First-Task Checklist

- Was the correct project and map recognized?
- Did unclear decisions go through ASK?
- Does the event text match the request?
- After preview approval, did you choose **Apply** before placement?
- Was the final position chosen by the user on the desktop map canvas?
- Are there any blocking errors or risk warnings?

## Next

- Connect or switch projects: [Project Setup](../projects/project.md)
- Fix project loading issues: [Project Detection Failed](../faq/project-detection.md)

