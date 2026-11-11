<div align="center">

# 🚀 VolleyPrompt

**Two AIs volley your prompt back and forth until it's actually good.**

[![Download for Windows](https://img.shields.io/badge/Download-Windows%20.exe-blue?style=for-the-badge&logo=windows)](https://github.com/Chimthuwu/Volley-Prompt/releases/latest)
[![License: MIT](https://img.shields.io/badge/License-MIT-purple?style=for-the-badge)](LICENSE)

</div>

<img src="https://raw.githubusercontent.com/Chimthuwu/Volley-Prompt/main/docs/screenshots/composer.png" alt="The VolleyPrompt composer with an idea typed in" width="100%">

## How it works

Pick a **Writer AI** and a **Reviewer AI**. The Writer drafts your prompt, the Reviewer critiques it, and they go back and forth until the Reviewer approves — then you copy the final prompt.

<p align="center"><b>The Writer and Reviewer volleying a prompt live:</b></p>
<img src="https://raw.githubusercontent.com/Chimthuwu/Volley-Prompt/main/docs/gifs/02-volley.gif" alt="Writer and Reviewer volleying a prompt back and forth" width="100%">

<p align="center"><b>Copying the finished, approved prompt:</b></p>
<img src="https://raw.githubusercontent.com/Chimthuwu/Volley-Prompt/main/docs/screenshots/result.png" alt="The finished, approved prompt ready to copy" width="100%">

## Features

- **Images & screenshots** — drop one in, vision-capable models see it directly.
- **Project folders** — attach a folder and pick exactly which files go in with a checkbox tree; junk (`node_modules`, `.git`, `.env`, lockfiles) is filtered automatically.
- **Live theming** — retune the whole palette from the titlebar: accents, borders, panels, fields and the animated backdrop all follow the hue/saturation/contrast sliders.
- **OpenRouter-powered** — any model from OpenAI, Anthropic, Google, DeepSeek, etc., filtered to free/cheap by default.

## Getting started

1. Grab the installer from [Releases](https://github.com/Chimthuwu/Volley-Prompt/releases/latest).
2. Launch it, open **Settings**, and paste a free [OpenRouter](https://openrouter.ai) API key.
3. Start volleying.

### Run from source

```bash
git clone https://github.com/Chimthuwu/Volley-Prompt.git
cd Volley-Prompt
npm install
npm start       # or: npm run dist   (build an installer)
```

## Privacy

Your API key is encrypted on-disk via the OS keychain. Attachments are only sent when you hit Start, and saved run history never stores attachment contents — only filenames.

## Stack

Electron + vanilla JS/HTML/CSS + [OpenRouter](https://openrouter.ai). No frameworks.

## License

MIT
