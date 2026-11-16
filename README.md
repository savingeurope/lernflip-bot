# LernFlip Bot

Automates a LernFlip **lesson** in the browser: reads every station, clicks
"Understood", checks off tasks, and answers the quizzes. It is intended for the
tester account provided by the course administration.

The bot does **not** start a lesson on its own: the browser opens, you log in
and open a lesson, and then it gets started. It stops at the end of the lesson
(unless used with `--all`).

## One-time setup

```bash
cd ~/Documents/projects/lernflip-bot
npm install          # Playwright
npx playwright install chromium
```

## Starting

| Command | What it does |
|---|---|
| `node bot.mjs` | Basic mode: guesses, learns the correct answer from the feedback, and repeats until the full score is achieved. Learned answers are stored in `answers.json` and reused next time. |
| `node bot.mjs --ai` | A local model (by default, `qwen3:4b` through Ollama) answers the questions. Incorrect answers are still corrected through feedback and repetition. |
| `node bot.mjs --all` | Automatically continues to the next lesson after the current one. Can be combined with any mode. |
| `node bot.mjs --debug` | Logs the URL and detected page features every few seconds (for troubleshooting). |
| `node bot.mjs --headless` | Runs without a visible window. |
| `node bot.mjs --url <address>` | Sets the start page (default: `https://lernflip.com/app`). |

Options can be combined, for example:

```bash
node bot.mjs --ai --all          # local model, entire course series
node bot.mjs --ai --debug        # model + diagnostic output
```

## How the bot works

The bot does not remotely control a separate browser window; instead, it
controls a normal Chromium browser through [Playwright](https://playwright.dev).
The window uses its own profile (`profile/`) so that your login is preserved and
kept separate from your regular browser.

**State loop.** Every few hundred milliseconds, the bot examines the page and
uses the visible buttons (`data-action` attributes) to decide what to do next:
confirm an information station, check off a task, start a quiz, answer a
question, repeat a result, or move to the next station. If none of these are
present, it waits—this allows it to detect automatically when you open a lesson.

**Answering questions.** It reads the question and answer options from the DOM.
For each question, it proceeds in this order:

1. If the correct answer is already in `answers.json`, it clicks it directly.
2. Otherwise, with `--ai`, the local model answers the question (the options
   are numbered, and it returns only the digit(s)).
3. Otherwise, it guesses—but not an option that was previously marked as
   incorrect.

**Learning from feedback.** After clicking "Check", the page shows which
options were correct. The bot reads this, stores the correct answers in
`answers.json`, and remembers the incorrect ones. When repeating the question
(or on the next run), every answer is then correct. This allows basic mode to
achieve a full score without prior knowledge—it may only need a second attempt.

It detects **multiple choice** questions using `q-multi-tag` and clicks the
corresponding multiple options.

## Local model (for `--ai`)

The default is [Ollama](https://ollama.com) with `qwen3:4b`:

```bash
ollama serve &        # start the server
ollama pull qwen3:4b  # download the model (~2.6 GB)
```

Use environment variables to select a different model or server:

```bash
AI_MODEL=qwen3:8b node bot.mjs --ai
AI_URL=http://localhost:8080/v1/chat/completions node bot.mjs --ai   # e.g. llama.cpp
```

An OpenAI-compatible `/v1/chat/completions` endpoint is expected.

## Files

- `bot.mjs` – the bot
- `answers.json` – learned answers (created automatically)
- `profile/` – separate browser login, isolated from the regular browser
- `test/mock.html` – replica of a lesson for testing without the real site
