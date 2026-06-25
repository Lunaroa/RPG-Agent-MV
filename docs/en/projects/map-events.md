# Maps, Events, And Assets

[Back to User Guide](../README.md)

RPG Agent MV reads maps, events, database entries, plugins, and assets from the connected RPG Maker MV project so Agent work can be grounded in the real game.

Existing events can be inspected and edited through controlled flows. The Agent should identify the target map and event from project facts or from explicit user selection before proposing changes.

New events are handled as pending content. The Agent can draft the event, register it, and show a preview, but placement stays under user control. The user chooses the target map location on the map editor canvas, then the system writes the placed event and keeps it reviewable.

Assets are used as project facts. The Agent may reference available faces, characters, tilesets, audio, and plugins, but missing assets should be reported clearly rather than invented.

