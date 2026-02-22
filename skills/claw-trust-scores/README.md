# Claw Trust Scores Skill Wrapper

This folder contains the official wrapper docs for using Claw Trust Scores as an installable skill bundle.

## Install intent

When published to ClawHub/OpenClaw distribution, install command should be:

```bash
npx clawhub@latest install claw-trust-scores
```

## Local bundle contents

- `SKILL.md` - tool behavior and usage contract
- `skill.json` - manifest metadata
- `examples/openclaw.env.example` - copy/paste env setup
- `examples/tool-payloads.json` - request body examples

## Quick setup

1. Set environment values:

```env
CLAWTRUST_API_KEY=INSERT_YOUR_API_KEY_HERE
CLAWTRUST_BASE_URL=https://clawtrustscores.com
```

2. Use tools described in `SKILL.md`:
- `get_score`
- `log_event`
- `preflight_payment`
- `connector_readiness`
