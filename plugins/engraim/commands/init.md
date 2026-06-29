---
description: Adopt the current project into EngrAIm — create the .engraim/ workspace if missing and confirm memory is active.
---
Ensure this project has an EngrAIm workspace.

1. Check whether `.engraim/` exists in the project root. If it does, report its status using the `engraim-memory` MCP tool `status` (fact count, wiki pages, episodes, pending sessions, schema version) and stop.
2. If it does not exist, tell the user the SessionStart hook normally creates it automatically; offer to create it now by running the workspace bootstrap (the hook will also create it on the next session). 
3. Briefly remind the user that `.engraim/` is the workspace's own memory (safe to commit to git) and is never touched by plugin updates.
