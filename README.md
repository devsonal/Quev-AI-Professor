<h1 align="center">Quev AI Professor</h1>

<p align="center">
  <b>Learning doesn't have to be just text.</b><br>
  An AI tutor that doesn't reply with a wall of paragraphs — it stands at a
  chalkboard, speaks, gestures, writes and draws your answer.
</p>

<p align="center">
  <img alt="Python" src="https://img.shields.io/badge/Python-3.10+-3776AB?logo=python&logoColor=white">
  <img alt="Flask" src="https://img.shields.io/badge/Flask-backend-000000?logo=flask&logoColor=white">
  <img alt="Featherless" src="https://img.shields.io/badge/Featherless-AI-6E56CF">
  <img alt="DeepSeek" src="https://img.shields.io/badge/DeepSeek--V3-model-4D6BFE">
  <img alt="GSAP" src="https://img.shields.io/badge/GSAP-animation-88CE02">
</p>

---
<p align="center">
  <img src="https://i.pinimg.com/736x/4f/49/4a/4f494a4078ac5264c908b874d6e389d0.jpg" alt="Quev banner" width="100%">
</p>

## The problem

Ask any AI tutor to explain refraction and you get six paragraphs of text. The
student reads it, nods, and understands nothing — because the thing they needed
was a diagram, a pointing finger and someone saying it out loud.

Real teaching isn't a text response. It's a **performance**: a teacher talks,
pauses, draws on the board, points at the drawing, and checks you're following.
Every AI study tool we tried had skipped that part entirely.

Reading is not the same as understanding. We wanted to build the difference.

## What we built

**Quev AI Professor** is a web app where an animated professor teaches you.

You ask a question in plain words. Instead of returning prose, the AI returns a
**structured teaching plan** — a small JSON score describing what the professor
should say, which gestures to make, what to write on the chalkboard and what to
sketch, with per-step timing. A browser-side stage director reads that score and
performs it: speech synthesis for the voice, GSAP for the body, live SVG stroke
animation for the chalk.

The result is a lesson, not an answer.

| | |
|---|---|
| 🎓 **An actual professor** | A rigged SVG character with a head, arms, pupils and mouth, driven by 10 named gestures and 5 facial expressions |
| 🗣️ **Speaks while it teaches** | Browser text-to-speech tuned to a lower, more deliberate lecturing voice, with the mouth synced to the audio |
| ✏️ **Writes and draws live** | Text appears on the chalkboard stroke by stroke, plus a library of 18 hand-built chalk sketches (atom, DNA, rocket, tree, lightbulb, heart…) |
| ⏱️ **Choreographed, not sequential** | Steps carry absolute `at` times, so the professor can point *while* speaking — like a real lesson, not a queue of animations |
| 🖼️ **Pulls in visual references** | Relevant Wikipedia imagery appears alongside the board |
| 🔑 **Zero setup for the student** | No sign-up, no API key, no model dropdown. Open the page, ask a question |

## How it works

```
Student question
      │
      ▼
Flask backend  ──►  Featherless API  ──►  DeepSeek-V3
(holds the key)          (fast, open-source inference)
      │
      ▼
JSON teaching plan
{ "say": "…", "expression": "thinking",
  "steps": [ {"do":"write","board":"F = G·m₁m₂/r²","at":0},
             {"draw":"apple","at":2},
             {"do":"point","at":2.4} ] }
      │
      ▼
AI Stage Director  ──►  Professor Engine  ──►  live performance
                        (GSAP + SVG + TTS)
```

### Three layers

**1. The Professor Engine** — a character rig over hand-drawn SVG. It exposes
safe, named motions (`wave`, `nod`, `point`, `write`, `think`, `explain`,
`celebrate`…) and knows which body parts each one occupies, so two gestures that
would fight over the same arm never run together. Chalk is drawn by animating
SVG path dash offsets, so writing appears at a human speed.

**2. The AI Stage Director** — the bridge between language and motion. It
prompts the model for a strict JSON plan, parses and sanitises it, resolves the
timeline, and drives the engine. **The model never touches SVG, CSS, selectors
or transforms.** It can only request named gestures plus a small `tweak` object
with clamped ranges (head tilt −18°…18°, pupil direction −1…1, and so on). An
LLM cannot break the character, because it was never handed the controls.

**3. The Flask backend** — serves the site and owns the one API endpoint,
`POST /api/chat`. It holds the Featherless key server-side, picks the model,
validates and clamps incoming messages, rate-limits per IP, and walks a fallback
chain if a model is cold or busy. The browser knows nothing except "there is an
endpoint."

### Why the backend exists

The first version ran entirely in the browser and asked each student to paste
their own API key and pick a provider and a model. That's fine for a developer
demo and useless for the person we actually built this for — a student who wants
to understand refraction.

Moving inference server-side removed the key from the client, deleted the
settings panel, and turned a three-step setup into opening a URL.

### Why DeepSeek-V3 on Featherless

The director needs a model that emits clean JSON fast. We benchmarked the real
director prompt against the Featherless catalogue:

- **DeepSeek-V3-0324** — the pick. Best teaching plans, actually uses the drawing
  commands when the concept calls for one, honours strict JSON mode, ~3–8s.
- **Reasoning models (R1, V3.2-Speciale)** — rejected. They spend 10–30s emitting
  `<think>` tokens before the first useful character. On stage that reads as a
  frozen professor.
- **Qwen3-30B-A3B** — fastest overall (~2.4s warm) but weaker plans. Kept as a
  fallback.

Featherless gives flat-rate access to open-source models through an
OpenAI-compatible API, so the whole thing runs on one key and no GPU.

## Tech stack

| Layer | Technology |
|---|---|
| Backend | Python 3.10+, Flask, `requests` |
| Inference | Featherless AI → DeepSeek-V3-0324 (fallbacks: DeepSeek-V3.2, Qwen3-30B-A3B) |
| Animation | GSAP 3.12 timelines over hand-rigged SVG |
| Speech | Web Speech API (`speechSynthesis`), voice-tuned and mouth-synced |
| Frontend | Vanilla JavaScript (no framework, no build step), HTML, CSS |
| References | Wikipedia API |
| Hosting | PythonAnywhere |

Front end dependencies: one CDN script for GSAP. That's the whole build system.

## Running it

```bash
pip install flask requests
# paste your Featherless key into config.py
python flask_app.py          # http://127.0.0.1:5000
```

Deploying to PythonAnywhere: see **[DEPLOY.md](DEPLOY.md)**.

## Project structure

```
quev-ai-professor/
├── flask_app.py              # routes + the /api/chat proxy
├── config.py                 # API key, model chain, limits
├── requirements.txt
├── wsgi_pythonanywhere.py    # WSGI template for PythonAnywhere
├── DEPLOY.md
├── templates/
│   ├── index.html            # landing page
│   ├── about.html            # the idea + the command system
│   ├── team.html
│   └── tutor.html            # the stage
└── static/
    ├── style.css  main.js  img/
    └── tutor/
        ├── professor.svg     # the rigged character artwork
        ├── engine.js         # Professor Engine — gestures, chalk, expressions
        ├── ai-director.js    # AI Stage Director — plan → performance
        ├── app.js            # page wiring
        └── styles.css
```

### API

| Method | Route | Purpose |
|---|---|---|
| `GET` | `/` `/about` `/team` | Site pages |
| `GET` | `/tutor` | The classroom |
| `POST` | `/api/chat` | `{messages:[…]}` → OpenAI-shaped reply. Key stays server-side |
| `GET` | `/api/health` | Model in use and whether the key is configured |

## Challenges we ran into

**LLMs are unreliable choreographers.** Early versions let the model return free
-form instructions, and it invented gestures that didn't exist, set arms to 400°,
and produced doodles that looked like nothing. The fix was to make the
instruction set closed: named gestures only, every numeric tweak clamped to a
documented range, a curated drawing library, and the whole rig reset to neutral
after each performance. A plan can now be nonsense and the professor still looks
composed.

**Models ramble instead of returning JSON.** Fixed in three layers: strict JSON
mode on the API call, a parser that extracts the outermost object from whatever
comes back, and a one-shot repair prompt that feeds a bad reply back with
"fix this to strict JSON only."

**Chrome loads TTS voices asynchronously.** The classic silent failure — the
mouth moves and nothing is heard, because `getVoices()` returns an empty array on
first call. We warm the voice list at startup and re-resolve on
`voiceschanged`.

**Slow models look like crashes.** A cold serverless model can take twelve
seconds. Silence reads as a bug, so the status line counts the seconds and
explains that the model is warming up — and if the backend is unreachable
entirely, a built-in offline brain takes over so the demo never dies mid-lesson.

**The free PythonAnywhere tier blocks outbound HTTP** to anything not on its
allowlist, which quietly breaks the Featherless call. Documented in DEPLOY.md
rather than discovered at 2am.

## What we learned

- Constraining an LLM is more valuable than empowering it. The professor became
  reliable the moment we took away its freedom and gave it a vocabulary instead.
- Latency is a design problem, not just an engineering one. A visible counter
  changed the experience more than shaving two seconds would have.
- Asking a user for an API key is asking them not to use your product.
- A JSON schema is a surprisingly good interface between "thinking" and
  "performing." Swap the model, swap the character, swap the renderer — the
  contract holds.

## What's next

- Follow-up questions that build on what's already on the board, instead of
  wiping it
- Subject-aware modes — equation layout for maths, labelled diagrams for biology
- Tamil and Sinhala voice output, so this works for students in our own schools
- Teacher mode: paste a syllabus topic, get a performed lesson
- Saved lessons students can replay before an exam

## The team

| | | |
|---|---|---|
| **Aqshai** | Character & Animation Engine | Professor rig, gesture system, chalk rendering, visual experience |
| **Sonal** | Frontend & API | Flask backend, Featherless integration, stage director, UX |
| **Dithurshan** | Design & Testing | Visual design, testing, refining the learning experience |

> *"Learning shouldn't just give you an answer. It should help you understand it."*
