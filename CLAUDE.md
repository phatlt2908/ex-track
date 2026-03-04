# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

ex-track is a Telegram bot that parses Vietnamese natural language expense messages using AI (OpenRouter/Gemini) and records them into Google Sheets. Users send messages like "ăn phở 50k" and the bot parses, categorizes, and logs the expense automatically.

## Commands

- `npm start` — Run the bot (`node src/index.js`)
- `docker-compose up -d` — Deploy with Docker
- `docker-compose logs -f` — Follow container logs

There is no test suite, linter, or build step configured.

## Architecture

```
src/
├── index.js                  # Entry point, starts the bot
├── config/env.js             # Validates env vars, exports config
├── bot/telegram.js           # Telegram bot: commands, message handler, user feedback
├── services/ai-parser.js     # AI parsing via OpenRouter API (natural language → structured JSON)
├── services/sheets.js        # Google Sheets API: read categories, record expenses
└── utils/logger.js           # Timestamped console logger
```

**Flow:** Telegram message → `ai-parser.js` parses text into `{description, amount, category, date}` → `sheets.js` writes to the correct sheet tab and cell → bot confirms to user.

## Key Design Details

- **ES modules** throughout (`"type": "module"` in package.json)
- **Google Sheets layout:** Each month has a tab named `MM/YYYY`. Row 1 is headers (categories). Row N+1 = day N of the month. Categories come from the header row and are cached for 1 hour in `ai-parser.js`.
- **Cell formulas:** When adding to a cell that already has a value, `sheets.js` converts it to a formula (`= oldValue + newAmount`). Descriptions are stored as cell notes.
- **Spreadsheet ID is year-based:** env var `GOOGLE_SPREADSHEET_ID_<YEAR>` (e.g., `GOOGLE_SPREADSHEET_ID_2026`), resolved dynamically in `config/env.js`.
- **AI parsing:** Uses OpenRouter with JSON schema validation, temperature 0.1. System prompt is in Vietnamese and includes current date/weekday for relative date resolution ("hôm qua", "thứ 5 tuần trước").
- **Telegram bot uses long polling**, not webhooks.
- **All user-facing text is in Vietnamese.**
- **Date format:** DD/MM/YYYY. Amount abbreviations: "k" = thousand, "tr" = million.

## Environment Setup

Copy `.env.example` to `.env` and fill in: `TELEGRAM_BOT_TOKEN`, `OPENROUTER_API_KEY`, Google service account credentials (`GOOGLE_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_PRIVATE_KEY`), and `GOOGLE_SPREADSHEET_ID_<YEAR>`. Missing required vars cause immediate exit on startup.
