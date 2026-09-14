---
public: true
title: Overview
order: 0
---

# Examples

Four complete devices built on cino-sdk, each one something a production
actually runs. Each is a single file to copy, run, and change to fit your
equipment. The [integration guide](../integrations/index.md) explains the
pieces they are made from.

| Example | What it does | Token role needs |
| --- | --- | --- |
| [Camera switcher](./camera-switcher.md) | Cuts a vMix or ATEM switcher to the camera the script calls for, on the frame | `VIEW` |
| [Control panel](./control-panel.md) | A stage manager's panel: timecode, what is live, play and pause, notes, and buttons for a Stream Deck | `VIEW`, or `EDIT_TIMELINE` for notes |
| [Lighting and sound cues](./lighting-cues.md) | Fires cues on an ETC Eos desk and in QLab over OSC, with standby calls | `VIEW` |
| [Camera display](./camera-display.md) | A moving strip of the camera script, with on air and next, for the top or bottom of a multiview | `VIEW` |

---

## Before you start

You need:

- **Node.js 22.18 or later**, which runs TypeScript files directly. On an older
  Node.js, run the same files with `npx tsx` instead of `node`.
- **A token** for the production, with the role the table above names.
  [Authentication](../integrations/authentication.md) covers issuing one.
- **The timeline's id**: the last part of the editor's address, after `/editor/`.

Every example starts from the same project:

```sh
mkdir cino-device && cd cino-device
npm init -y
npm pkg set type=module
npm install cino-sdk
```

and reads its settings from a `.env` file beside it:

```sh
CINO_URL=https://cino.no
CINO_TOKEN=cino_svc_…
CINO_TIMELINE=<timeline id>
```

Node.js reads that file when you ask it to:

```sh
node --env-file=.env switcher.ts
```

The `.env` file holds the token, so keep it out of source control and readable
only by whoever runs the device.

---

## Rehearse before the show

Every example is safe to run against a copy of the real timeline. Duplicate it
in the editor, point `CINO_TIMELINE` at the copy, and aim the equipment settings
at `127.0.0.1` until you trust what it does. Press play in the editor and watch
the log.

When it runs for real, run it under whatever keeps services alive on that
machine, such as systemd, launchd or a Windows service. Make sure that supervisor does not restart it after it
exits with code 1. That exit means the token was refused, and restarting will
not fix it.
