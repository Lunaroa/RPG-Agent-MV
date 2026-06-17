# Third-party source

This directory is reserved for pinned third-party source that ships with the
product source checkout.

- `opencode/` contains the vendored opencode source used by the desktop Agent
  engine. Build the Windows x64 runtime with `npm run build:opencode-runtime`.
- Do not put credentials, logs, session state, generated package output, or
  local experiment folders here.
- Do not add embedded `.git` metadata. Vendor fixed source snapshots with
  version and license metadata so this repository contains the files it
  distributes.
