---
description: Remove the edit restriction set by /freeze
---

Disable **freeze**: delete the `.claude/.freeze` file.

Steps:
1. If `.claude/.freeze` exists → delete it. Report: "Freeze OFF — all files are editable again."
2. If it does not exist → report "No freeze is currently active."
