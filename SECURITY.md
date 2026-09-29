# Security Policy

## What Colonia is (and isn't)

Colonia is a static, single-page browser game. It has **no server, no accounts and no network code**. The only outside request is the optional Google Fonts stylesheet (the game works fine without it). Saved games live in your browser's `localStorage`, and save files you export or paste are plain JSON.

That keeps the attack surface small, but a few things are still worth reporting:

- A crafted **save file or pasted save data** that runs script, breaks out of the page, or freezes/crashes the browser instead of showing a readable error.
- Any way to get **HTML or script injected** into the UI (for example through a city name inside a save).
- A dependency or build-pipeline problem that could put **malicious code into `dist/colonia.html`**.

Gameplay bugs (a building that never works, a crash screen during normal play) are regular bugs: please open a normal issue for those.

## Supported versions

Only the latest code on the default branch (and the `dist/colonia.html` built from it) receives fixes.

## Reporting a vulnerability

Please **do not open a public issue** for a security problem.

1. Use GitHub's private reporting: **Security** tab → **Report a vulnerability** on this repository.
2. If that isn't available, contact [@Er2oneousbit](https://github.com/Er2oneousbit) on GitHub and ask for a private channel.

Include the browser and version, the steps or save file that trigger it, and what you expected. You should get an answer within about a week. Once a fix is out, you're welcome to be credited in the release notes.

Made with ❤️ from your friendly hacker - er2oneousbit
