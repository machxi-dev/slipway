<!-- slipway -->
## Slipway

This repository runs the scope → build → ship workflow of the Slipway plugin. A lane closes with `/slipway:ship`; Claude Code's own `/ship` is for ad-hoc branches outside a lane. Commands are run with `slipway run <name>` (see `slipway.config.json`), never by their tool's own name.
