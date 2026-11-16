

import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const ALL = args.includes("--all");
const HEADLESS = args.includes("--headless");
const AI = args.includes("--ai");
const DEBUG = args.includes("--debug");
const AI_URL = process.env.AI_URL || "http://localhost:11434/v1/chat/completions";
const AI_MODEL = process.env.AI_MODEL || "qwen3:4b";
const urlIdx = args.indexOf("--url");
const START_URL = urlIdx !== -1 ? args[urlIdx + 1] : "https://lernflip.com/app";
const DIR = path.dirname(new URL(import.meta.url).pathname);
const ANSWERS_FILE = path.join(DIR, "answers.json");
const MAX_RETRIES = 3;

let memory = {};
try { memory = JSON.parse(fs.readFileSync(ANSWERS_FILE, "utf8")); } catch {}
const saveMemory = () => fs.writeFileSync(ANSWERS_FILE, JSON.stringify(memory, null, 2));
const norm = (s) => String(s || "").replace(/\s+/g, " ").trim();

export function stripHtml(s) {
  return norm(
    String(s || "")
      .replace(/<[^>]*>/g, "")
      .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&")
  );
}

const log = (...m) => console.log(new Date().toLocaleTimeString(), ...m);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function exists(page, sel) {
  return (await page.$(sel)) !== null;
}

async function clickAndSettle(page, sel) {
  const ok = await page.$eval(sel, (el) => { el.click(); return true; }).catch(() => false);
  await page.waitForTimeout(ok ? 450 : 150);
}

async function readQuestion(page) {
  return page.evaluate(() => {
    const card = document.querySelector(".q-card");
    const q = card?.querySelector("h2")?.innerText || "";
    const multi = !!card?.querySelector(".q-multi-tag");
    const opts = [...document.querySelectorAll('button.q-ans[data-action="q-sel"]')].map((b) => ({
      o: b.getAttribute("data-o"),
      text: b.querySelector(".q-ans-tx")?.innerText || "",
    }));
    return { q, multi, opts };
  });
}

async function readFeedback(page) {
  return page.evaluate(() =>
    [...document.querySelectorAll(".q-ans-wrap")].map((w) => {
      const btn = w.querySelector(".q-ans");
      const status = w.querySelector(".q-status")?.innerText || "";
      return {
        text: btn?.querySelector(".q-ans-tx")?.innerText || "",
        correct: btn?.classList.contains("correct") || /Ausgelassen/.test(status),
      };
    })
  );
}

export function parseAiPick(reply, count, multi) {
  const clean = String(reply).replace(/<think>[\s\S]*?<\/think>/gi, "");
  const nums = [...clean.matchAll(/\d+/g)]
    .map((m) => +m[0] - 1)
    .filter((i) => i >= 0 && i < count);
  const uniq = [...new Set(nums)];
  if (!uniq.length) return null;
  return multi ? uniq : [uniq[0]];
}

async function askModel(q, opts, multi) {
  const list = opts.map((o, i) => `${i + 1}. ${o.text}`).join("\n");
  const prompt =
    `Frage:\n${q}\n\nOptionen:\n${list}\n\n` +
    (multi
      ? "Mehrere Antworten können richtig sein. Nenne die Nummern der richtigen Optionen, nur Ziffern durch Komma getrennt."
      : "Nenne die Nummer der einzigen richtigen Option, nur die Ziffer.") +
    " /no_think";
  let reply = "";
  try {
    const r = await fetch(AI_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: AI_MODEL,
        temperature: 0,
        messages: [
          { role: "system", content: "Du beantwortest Multiple-Choice-Fragen. Antworte ausschließlich mit Ziffern." },
          { role: "user", content: prompt },
        ],
      }),
      signal: AbortSignal.timeout(60000),
    });
    const j = await r.json();
    reply = j.choices?.[0]?.message?.content ?? "";
  } catch (e) {
    log("  KI nicht erreichbar:", e.message.split("\n")[0]);
    return null;
  }
  return parseAiPick(reply, opts.length, multi);
}

async function answerQuestion(page) {
  const { q, multi, opts } = await readQuestion(page);
  const key = norm(q);
  const mem = (memory[key] ||= { correct: null, wrong: [] });

  let pick;
  if (mem.correct) {
    pick = opts.filter((o) => mem.correct.includes(norm(o.text)));
  } else if (AI) {
    const idx = await askModel(q, opts, multi);
    pick = idx ? idx.map((i) => opts[i]) : null;
  }
  if (!pick || !pick.length) {
    const fresh = opts.filter((o) => !mem.wrong.includes(norm(o.text)));
    pick = [fresh[0] || opts[0]];
  }

  for (const o of pick) await clickAndSettle(page, `button.q-ans[data-o="${o.o}"]`);
  await clickAndSettle(page, '[data-action="q-check"]');

  const fb = await readFeedback(page);
  mem.correct = fb.filter((f) => f.correct).map((f) => norm(f.text));
  for (const o of pick) {
    if (!mem.correct.includes(norm(o.text)) && !mem.wrong.includes(norm(o.text))) mem.wrong.push(norm(o.text));
  }
  saveMemory();

  const right = pick.length === mem.correct.length && pick.every((o) => mem.correct.includes(norm(o.text)));
  log(right ? "  ✓" : "  ✗", key.slice(0, 70) + (multi ? "  (Mehrfach)" : ""));
  await clickAndSettle(page, '[data-action="q-next"]');
}

async function step(page, state) {
  if (await exists(page, ".ldn-karte")) {
    if (ALL && (await exists(page, '.ldn-knoepfe [data-action="open-lesson"]'))) {
      log("Lektion fertig – weiter zur nächsten");
      await clickAndSettle(page, '.ldn-knoepfe [data-action="open-lesson"]');
      return "continue";
    }
    log("Lektion fertig.");
    return "done";
  }
  if (await exists(page, '[data-action="q-resume"]')) return clickAndSettle(page, '[data-action="q-resume"]');
  if (await exists(page, '[data-action="q-start"]')) {
    log("Quiz gestartet");
    return clickAndSettle(page, '[data-action="q-start"]');
  }
  if (await exists(page, 'button.q-ans[data-action="q-sel"]')) return answerQuestion(page);
  if (await exists(page, '[data-action="q-retry"]')) {
    const score = await page.$eval(".q-card", (c) => c.innerText.match(/(\d+) von (\d+) Punkten/));
    const perfect = score && score[1] === score[2];
    const sid = await page.$eval('[data-action="q-retry"]', (b) => b.getAttribute("data-id"));
    state.retries[sid] = state.retries[sid] || 0;
    if (!perfect && state.retries[sid] < MAX_RETRIES) {
      state.retries[sid]++;
      log(`  Ergebnis ${score?.[1]}/${score?.[2]} – nochmal mit den gelernten Antworten`);
      return clickAndSettle(page, '[data-action="q-retry"]');
    }
    log(`  Ergebnis ${score?.[1]}/${score?.[2]}`);
    return clickAndSettle(page, '[data-action="next-station"]');
  }
  if (await exists(page, '[data-action="complete-input"]')) {
    log("Input: Verstanden");
    return clickAndSettle(page, '[data-action="complete-input"]');
  }
  if (await exists(page, '[data-action="complete-task"]')) {
    while (await exists(page, '.check-item[data-action="task-check"]:not(.checked)')) {
      await clickAndSettle(page, '.check-item[data-action="task-check"]:not(.checked)');
    }
    log("Aufgabe: erledigt");
    return clickAndSettle(page, '[data-action="complete-task"]:not([disabled])');
  }
  if (await exists(page, '[data-action="next-station"]')) return clickAndSettle(page, '[data-action="next-station"]');

  return "idle";
}

if (import.meta.main) {
const ctx = await chromium.launchPersistentContext(path.join(DIR, "profile"), { headless: HEADLESS, channel: "chromium", viewport: null });
const page = ctx.pages()[0] || (await ctx.newPage());
page.setDefaultTimeout(10000);
await page.goto(START_URL);
log("Browser offen. Melde dich mit dem Tester-Konto an und öffne eine Lektion – der Bot legt dann los.");

const state = { retries: {} };
let idle = 0;
while (true) {
  if (page.isClosed()) break;
  let r;
  try {
    if (!(await exists(page, ".lesson-top")) && !(await exists(page, ".ldn-karte"))) r = "idle";
    else r = await step(page, state);
  } catch (e) {
    if (page.isClosed()) break;
    log("Hoppla:", e.message.split("\n")[0]);
    r = "idle";
  }
  if (r === "done") break;
  if (r === "idle") {
    if (++idle % 60 === 1) log("Warte auf eine Lektion …");
    if (DEBUG && idle % 4 === 1) {
      const seen = await page.evaluate(() => ({
        url: location.href,
        lessonTop: !!document.querySelector(".lesson-top"),
        ldn: !!document.querySelector(".ldn-karte"),
        qcard: !!document.querySelector(".q-card"),
        qSel: !!document.querySelector('button.q-ans[data-action="q-sel"]'),
        actions: [...document.querySelectorAll("[data-action]")].slice(0, 6).map((e) => e.getAttribute("data-action")),
      })).catch(() => null);
      if (seen) log("debug:", JSON.stringify(seen));
    }

    await sleep(1000);
  } else idle = 0;
}
if (HEADLESS) { await ctx.close(); log("Fertig."); }
else log("Fertig. Browser bleibt offen – schließ ihn, wenn du willst.");
}
