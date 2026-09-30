# Security

## What Colonia is

A static, single-file browser game: **no server, no accounts, no network code**. The only outside request is an optional web font. Saved games live in your browser's `localStorage`, and save files you export or paste are plain JSON.

Worth reporting privately:

- A crafted **save file or pasted save data** that runs script, breaks out of the page, or freezes the browser instead of showing a readable error.
- Any way to get **HTML or script injected** into the game's screens (for example through a name inside a save).
- A problem in the build that could put **malicious code into `dist/colonia.html`**.

Everything else (a building that never works, a crash screen during normal play) is a normal bug: use the bug report form.

## Reporting

Use GitHub's private reporting: the **Security** tab of this repository, then **Report a vulnerability**. Please do not open a public issue for a security problem, and do not send it by direct message.

Include the browser and version, and the steps or the save file that trigger it. Reports are read and fixed in a later release; there may be no reply. Only the latest version on the default branch (and the `dist/colonia.html` built from it) gets fixes.

Made with ❤️ from your friendly hacker - er2oneousbit
