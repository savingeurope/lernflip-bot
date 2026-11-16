# LernFlip-Bot

Automatisiert eine LernFlip-**Lektion** im Browser: liest jede Station, klickt
„Verstanden", hakt Aufgaben ab und beantwortet die Quizze. Gedacht für das
Tester-Konto, das die Kurs-Leitung ausgegeben hat.

Der Bot startet **keine** Lektion von selbst: der Browser öffnet sich, du
meldest dich an und öffnest eine Lektion – dann legt er los. Am Ende der Lektion
stoppt er (außer mit `--all`).

## Einmalig einrichten

```bash
cd ~/Documents/projects/lernflip-bot
npm install          # Playwright
npx playwright install chromium
```

## Starten

| Befehl | Was es tut |
|---|---|
| `node bot.mjs` | Grundmodus: rät, lernt die richtige Antwort aus der Rückmeldung, wiederholt bis zur vollen Punktzahl. Gelerntes landet in `answers.json` und wird beim nächsten Mal wiederverwendet. |
| `node bot.mjs --ai` | Ein lokales Modell (Standard `qwen3:4b` über Ollama) beantwortet die Fragen. Falsches wird per Rückmeldung + Wiederholung trotzdem korrigiert. |
| `node bot.mjs --all` | Nach der Lektion automatisch weiter zur nächsten. Mit jedem Modus kombinierbar. |
| `node bot.mjs --debug` | Loggt alle paar Sekunden URL und erkannte Seiten-Merkmale (zur Fehlersuche). |
| `node bot.mjs --headless` | Ohne sichtbares Fenster. |
| `node bot.mjs --url <adresse>` | Startseite festlegen (Standard `https://lernflip.com/app`). |

Kombinieren geht, z. B.:

```bash
node bot.mjs --ai --all          # lokales Modell, ganze Kursreihe
node bot.mjs --ai --debug        # Modell + Diagnoseausgabe
```

## Wie der Bot arbeitet

Der Bot steuert kein eigenes Browser-Fenster fern, sondern ein normales
Chromium über [Playwright](https://playwright.dev). Das Fenster nutzt ein
eigenes Profil (`profile/`), damit dein Login erhalten bleibt und vom normalen
Browser getrennt ist.

**Zustands-Schleife.** Alle paar hundert Millisekunden schaut der Bot auf die
Seite und entscheidet anhand der sichtbaren Buttons (`data-action`-Attribute),
was als Nächstes dran ist: Info-Station bestätigen, Aufgabe abhaken, Quiz
starten, Frage beantworten, Ergebnis wiederholen oder zur nächsten Station
gehen. Ist nichts davon da, wartet er – so merkt er von selbst, wenn du eine
Lektion öffnest.

**Fragen beantworten.** Er liest Frage und Antwort-Optionen aus dem DOM. Pro
Frage gilt der Reihe nach:

1. Steht die richtige Antwort schon in `answers.json`, wird sie direkt geklickt.
2. Sonst, mit `--ai`, beantwortet das lokale Modell die Frage (Optionen werden
   nummeriert, es nennt nur die Ziffer(n)).
3. Sonst wird geraten – aber keine Option, die vorher schon als falsch
   markiert wurde.

**Aus der Rückmeldung lernen.** Nach dem Klick auf „Prüfen" zeigt die Seite,
welche Optionen richtig waren. Der Bot liest das aus, speichert die richtigen
Antworten in `answers.json` und merkt sich die falschen. Beim Wiederholen (oder
beim nächsten Durchlauf) sitzt dann jede Antwort. So kommt der Grundmodus ohne
Vorwissen auf die volle Punktzahl – er braucht nur eventuell einen zweiten
Versuch.

**Mehrfachauswahl** erkennt er am `q-multi-tag` und klickt entsprechend mehrere
Optionen an.

## Lokales Modell (für `--ai`)

Standard ist [Ollama](https://ollama.com) mit `qwen3:4b`:

```bash
ollama serve &        # Server starten
ollama pull qwen3:4b  # Modell holen (~2,6 GB)
```

Anderes Modell / anderer Server über Umgebungsvariablen:

```bash
AI_MODEL=qwen3:8b node bot.mjs --ai
AI_URL=http://localhost:8080/v1/chat/completions node bot.mjs --ai   # z. B. llama.cpp
```

Erwartet wird ein OpenAI-kompatibler `/v1/chat/completions`-Endpunkt.

## Dateien

- `bot.mjs` – der Bot
- `answers.json` – gelernte Antworten (wird automatisch angelegt)
- `profile/` – eigener Browser-Login, getrennt vom normalen Browser
- `test/mock.html` – Nachbau einer Lektion zum Testen ohne die echte Seite
