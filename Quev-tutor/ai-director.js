/*!
 * AIStageDirector v1.0.0
 * An LLM "brain" that puppeteers the ProfessorEngine character.
 * Talks to OpenRouter (free models) or Featherless and turns its replies into a live
 * performance: gestures, expressions, speech (TTS) and chalkboard writing —
 * sequential, parallel, or choreographed on a timeline with per-step "at" times.
 *
 * QUICK USE
 *   var director = new AIStageDirector({
 *     getEngine: () => currentEngine,          // always resolves the live engine (survives character swaps)
 *     apiKey: 'sk-or-...',                     // OpenRouter key (or set via .setKey)
 *     model: 'nvidia/nemotron-...:free',       // or leave null to auto-pick a free model
 *     onStatus: (msg, cls) => {}               // status line updates
 *   });
 *   await director.chat('Explain gravity to a 10 year old');   // AI replies + performs
 *   director.autonomous(true);                                  // AI does ANYTHING freely, in a loop
 *   director.autonomous(false);                                 // stop the free-run loop
 *   director.hardStop();                                        // kill performance NOW
 *
 * PLAN SCHEMA (what we ask the LLM for — strict JSON)
 *   {
 *     "say": "one short spoken line",
 *     "expression": "neutral|happy|surprised|thinking|angry",
 *     "steps": [
 *       { "do": "write", "board": "Gravity:\nF = G·m1·m2/r²", "wipe": true, "at": 0, "hold": 1.2 },
 *       { "draw": "apple", "at": 2 },                 // preset sketch, or draw ANYTHING:
 *       { "draw": {"name":"cat","d":["M -26 4 a 26 26 0 1 0 52 0 a 26 26 0 1 0 -52 0"]}, "at": 2 }
 *       { "do": "talk", "say": "…", "at": 3 }          // "at" = absolute seconds → timeline
 *     ]
 *   }
 *
 * DESIGN NOTES (why it won't break)
 *   - Every step is sandboxed: unknown gestures, missing parts, TTS-less browsers all degrade gracefully.
 *   - Parallel gestures run as independent timelines on compatible parts (wave+nod, point+talk…).
 *   - The OpenRouter call is retried once with a "repair to JSON" prompt when the model rambles.
 *   - Autonomous mode keeps a rolling memory of its last performances so it stays coherent.
 *   - With no API key, a built-in demo brain performs instead, so the demo never dies on stage.
 */
(function (global) {
  'use strict';

  var SVG_NS = 'http://www.w3.org/2000/svg';

  /* pluggable AI providers (both OpenAI-compatible) */
  var PROVIDERS = {
    openrouter: {
      label: 'OpenRouter',
      chat: 'https://openrouter.ai/api/v1/chat/completions',
      models: 'https://openrouter.ai/api/v1/models',
      freeOnly: true,
      headers: function (key) {
        return {
          'Authorization': 'Bearer ' + key,
          'Content-Type': 'application/json',
          'HTTP-Referer': global.location ? global.location.origin : 'https://example.com',
          'X-Title': 'AI Professor Stage Director'
        };
      }
    },
    featherless: {
      label: 'Featherless',
      chat: 'https://api.featherless.ai/v1/chat/completions',
      models: 'https://api.featherless.ai/v1/models',
      freeOnly: false,      /* all catalogue models usable on your Featherless plan credits */
      headers: function (key) {
        return { 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json' };
      }
    }
  };

  /* chalk sketches the AI can draw on the board (stroke paths around a local 0,0) */
  var DRAWINGS = {
    apple: ['M 0 22 C -38 22 -38 -22 0 -22 C 38 -22 38 22 0 22 Z',
            'M 0 -22 C 3 -34 -2 -40 -9 -44',
            'M -7 -36 C 8 -50 28 -42 24 -28 C 10 -24 -1 -28 -7 -36 Z'],
    star:  ['M 0 -42 L 13 -13 L 44 -13 L 19 6 L 27 37 L 0 19 L -27 37 L -19 6 L -44 -13 L -13 -13 Z'],
    arrow: ['M -40 0 L 34 0', 'M 16 -13 L 34 0 L 16 13'],
    smile: ['M 0 -28 a 28 28 0 1 0 0.01 0', 'M -13 -8 a 4 4 0 1 0 0.01 0', 'M 13 -8 a 4 4 0 1 0 0.01 0', 'M -15 9 Q 0 22 15 9'],
    sun:   ['M 0 -15 a 15 15 0 1 0 0.01 0', 'M 0 -34 L 0 -23 M 0 34 L 0 23 M -34 0 L -23 0 M 34 0 L 23 0 M -21 -21 L -14 -14 M 21 21 L 14 14 M -21 21 L -14 14 M 21 -21 L 14 -14'],
    /* ---- Sept 17: the AI kept inventing wonky doodles, so here's a proper library ---- */
    cat:   ['M -26 4 a 26 26 0 1 0 52 0 a 26 26 0 1 0 -52 0',
            'M -22 -16 L -28 -40 L -8 -28',
            'M 22 -16 L 28 -40 L 8 -28',
            'M -12 -2 a 3 3 0 1 0 0.01 0',
            'M 12 -2 a 3 3 0 1 0 0.01 0',
            'M -3 8 L 3 8 L 0 13 Z',
            'M -16 10 L -36 6 M -16 14 L -36 18 M 16 10 L 36 6 M 16 14 L 36 18'],
    dog:   ['M -24 6 a 24 24 0 1 0 48 0 a 24 24 0 1 0 -48 0',
            'M -20 -12 L -26 -34 L -8 -24',
            'M 20 -12 L 18 -30 L 6 -22',
            'M 24 -10 C 40 -18 42 -2 34 2',
            'M -12 0 a 3 3 0 1 0 0.01 0',
            'M 12 0 a 3 3 0 1 0 0.01 0',
            'M -5 12 C 0 16 5 12 5 12',
            'M -16 16 L -34 12 M 16 16 L 34 12'],
    rocket:['M 0 -48 C 14 -30 14 6 8 18 L -8 18 C -14 6 -14 -30 0 -48 Z',
            'M 0 -10 a 5 5 0 1 0 0.01 0',
            'M -8 4 C -20 12 -24 22 -26 32 L -8 20',
            'M 8 4 C 20 12 24 22 26 32 L 8 20',
            'M -7 18 C -3 30 -1 36 0 42 C 1 36 3 30 7 18'],
    house: ['M -30 26 L -30 -2 L 0 -30 L 30 -2 L 30 26 Z',
            'M -9 26 L -9 6 L 9 6 L 9 26',
            'M 14 0 L 24 0 L 24 12 L 14 12 Z',
            'M 0 -30 L 0 -44 M -9 -38 L 0 -47 L 9 -38'],
    tree:  ['M -4 28 L -4 2 M 4 28 L 4 2',
            'M 0 -34 C -22 -30 -32 -12 -22 0 C -30 6 -24 16 -12 12 C -4 20 8 16 8 6 C 20 8 26 -6 14 -12 C 18 -26 8 -34 0 -34 Z'],
    fish:  ['M -32 0 C -18 -20 10 -20 24 0 C 10 20 -18 20 -32 0 Z',
            'M 24 0 L 40 -14 L 40 14 Z',
            'M -20 -4 a 3 3 0 1 0 0.01 0',
            'M -32 0 C -26 -8 -22 -10 -14 -10'],
    heart: ['M 0 14 C -28 -2 -26 -26 -10 -26 C -4 -26 0 -20 0 -15 C 0 -20 4 -26 10 -26 C 26 -26 28 -2 0 14 Z'],
    flower:['M 0 -6 a 6 6 0 1 0 0.01 0',
            'M 0 -22 a 8 8 0 1 0 0.01 0',
            'M 15 -6 a 8 8 0 1 0 0.01 0',
            'M 0 10 a 8 8 0 1 0 0.01 0',
            'M -15 -6 a 8 8 0 1 0 0.01 0',
            'M 0 18 L 0 44',
            'M 0 32 C 12 30 16 22 15 15 C 5 19 0 25 0 32 Z'],
    drop:  ['M 0 -40 C -16 -16 -21 -5 -21 7 C -21 24 -10 35 0 35 C 10 35 21 24 21 7 C 21 -5 16 -16 0 -40 Z'],
    cloud: ['M -26 10 C -40 10 -40 -8 -25 -9 C -21 -22 -5 -26 5 -18 C 15 -26 28 -18 26 -8 C 38 -7 37 10 23 10 Z',
            'M -13 18 L -17 30 M 1 18 L -3 30 M 15 18 L 11 30'],
    lightbulb: ['M -18 -14 a 18 18 0 1 0 0.01 0',
            'M -7 8 L 7 8 M -6 15 L 6 15',
            'M -6 -10 L -2 -2 L 2 -10 L 6 -2',
            'M 0 -44 L 0 -36 M -26 -34 L -20 -28 M 26 -34 L 20 -28'],
    dna:   ['M 0 -44 C -20 -32 20 -14 0 0 C -20 14 20 32 0 44',
            'M 0 -44 C 20 -32 -20 -14 0 0 C 20 14 -20 32 0 44',
            'M -12 -37 L 12 -37 M 12 -19 L -12 -19 M -12 -3 L 12 -3 M 12 15 L -12 15 M -12 31 L 12 31'],
    moon:  ['M 10 -38 C -14 -30 -22 -4 -10 14 C 0 28 22 28 34 14 C 20 20 2 10 0 -8 C -2 -22 2 -32 10 -38 Z',
            'M -28 -28 L -24 -24 L -28 -20 L -32 -24 Z',
            'M -36 -2 L -32 2 L -36 6 L -40 2 Z']
  };

  /* preferred free models, best-first (September 2026 snapshot; the live list is fetched anyway) */
  var MODEL_PREFERENCE = ['nemotron', 'deepseek-chat', 'deepseek-v', 'qwen3', 'gpt-oss', 'gemini-2', 'llama-4', 'mistral', 'gemma'];
  /* Featherless picks, best-first — benchmarked Sept 17 with the real director prompt:
     DeepSeek-V3: best plans + actually draws when asked (~3-8s); Qwen3-30B-A3B: fastest (~2.4s warm).
     Note: gated models (meta-llama, google/*) 403 on chat calls — filtered below. */
  var FEATHERLESS_PREFERENCE = ['deepseek-v3', 'qwen3-30b-a3b', 'qwen3-next', 'qwen3-235b', 'llama-3.3-70b-instruct', 'mistral-nemo', 'phi-4'];

  var GESTURES = ['wave', 'nod', 'shake', 'point', 'write', 'think', 'explain', 'talk', 'lookAround', 'celebrate'];
  var EXPRESSIONS = ['neutral', 'happy', 'surprised', 'thinking', 'angry'];

  /* which gestures fight over the same body parts — used to sanity-check "parallel" */
  var USES = {
    wave: ['armLeft', 'head'], nod: ['head'], shake: ['head'], point: ['armRight', 'head'],
    write: ['armRight', 'head'], think: ['armLeft', 'head'], explain: ['armRight', 'head', 'mouth'],
    talk: ['mouth', 'head', 'armRight'], lookAround: ['pupils', 'head'], celebrate: ['armLeft', 'armRight', 'root']
  };

  function AIStageDirector(opts) {
    opts = opts || {};
    this.getEngine = opts.getEngine || function () { return null; };
    this.onStatus  = opts.onStatus || function () {};
    this.apiKey    = opts.apiKey || '';
    this.model     = opts.model || null;
    this.provider  = PROVIDERS[opts.provider] ? opts.provider : 'openrouter';
    this.voice     = opts.voice || {};  // optional browser-TTS character tuning
    this.history   = [];        // short chat memory
    this.recent    = [];        // rolling summary of recent performances (autonomous coherence)
    this.busy      = false;
    this.auto      = false;
    this._kill     = false;
    this._autoTimer = null;
    this._defaultModel = null;

    /* warm up the TTS voice list — Chrome populates getVoices() asynchronously,
       the classic silent failure where the mouth moves but nothing is heard */
    if (global.speechSynthesis) {
      try { global.speechSynthesis.getVoices(); } catch (e) {}
      try { global.speechSynthesis.onvoiceschanged = function () {}; } catch (e) {}
    }
  }

  AIStageDirector.prototype = {

    constructor: AIStageDirector,

    /* ---------------- public API ---------------- */

    setKey: function (key) { this.apiKey = (key || '').trim(); },
    setModel: function (model) { this.model = model; },
    setProvider: function (p) {
      if (PROVIDERS[p]) { this.provider = p; this._defaultModel = null; }
    },
    providerLabel: function () { return PROVIDERS[this.provider].label; },
    testVoice: function () {
      this.onStatus('\u{1F50A} testing text-to-speech\u2026', 'ok');
      return this._speak('Hello! I am the professor. My voice is working.');
    },

    /* fetch the live model list for the active provider (best-first) */
    models: function () {
      var self = this;
      var prov = PROVIDERS[this.provider] || PROVIDERS.openrouter;
      return fetch(prov.models)
        .then(function (r) { return r.json(); })
        .then(function (j) {
          var all = (j && j.data) ? j.data : (Array.isArray(j) ? j : []);
          if (self.provider === 'featherless') {
            /* gated models (e.g. meta-llama, google/*) reject chat calls with 403 — skip them */
            all = all.filter(function (m) { return m.is_gated !== true; });
          }
          var list = prov.freeOnly ? all.filter(function (m) {
            var p = m.pricing || {};
            if (String(p.prompt) !== '0' || String(p.completion) !== '0') return false;
            var arch = m.architecture || {};
            var ins  = arch.input_modalities  || ['text'];
            var outs = arch.output_modalities || ['text'];
            return ins.indexOf('text') !== -1 && outs.indexOf('text') !== -1;
          }) : all;
          var PREF = self.provider === 'featherless' ? FEATHERLESS_PREFERENCE : MODEL_PREFERENCE;
          list.sort(function (a, b) {
            var ra = PREF.findIndex(function (kw) { return (a.id + ' ' + (a.name || '')).toLowerCase().indexOf(kw) !== -1; });
            var rb = PREF.findIndex(function (kw) { return (b.id + ' ' + (b.name || '')).toLowerCase().indexOf(kw) !== -1; });
            if (ra === -1 && rb === -1) return (b.context_length || 0) - (a.context_length || 0);
            if (ra === -1) return 1;
            if (rb === -1) return -1;
            return ra - rb;
          });
          return list.slice(0, 250).map(function (m) { return { id: m.id, name: m.name || m.id, ctx: m.context_length || 0 }; });
        });
    },
    /* kept so older embeds keep working */
    freeModels: function () { return this.models(); },

    /* one-shot: user text -> plan -> performance */
    chat: function (userText) {
      var self = this;
      if (this.busy) { this.onStatus('⚠ already performing — one thing at a time (or ■ stop)', 'err'); return Promise.resolve(); }
      userText = (userText || '').trim();
      if (!userText) return Promise.resolve();
      this.busy = true; this._kill = false;
      return this._brain(userText)
        .then(function (plan) { console.log('AI JSON response:', plan); return self._perform(plan, userText); })
        .catch(function (e) { self.onStatus('⚠ ' + (e && e.message ? e.message : 'AI error'), 'err'); })
        .then(function () { self.busy = false; });
    },

    /* free-run mode: the AI decides EVERYTHING, repeatedly */
    autonomous: function (on) {
      this.auto = !!on;
      if (!on) {
        this._kill = true;
        if (this._autoTimer) { clearTimeout(this._autoTimer); this._autoTimer = null; }
        this.onStatus('🧠 free mode OFF — engine idle', 'ok');
        return;
      }
      this._kill = false;
      this.onStatus('🧠 free mode ON — the AI is in control…', 'ok');
      this._autoTick();
    },

    /* stop everything mid-performance */
    hardStop: function () {
      this._kill = true;
      this.auto = false;
      if (this._autoTimer) { clearTimeout(this._autoTimer); this._autoTimer = null; }
      var eng = this.getEngine();
      if (eng) { try { eng.stopGesture(); eng.speak(false); eng.expression('neutral'); eng.resetPose(); } catch (e) {} }
      this._speechQueue = [];
      if (global.speechSynthesis) { try { global.speechSynthesis.cancel(); } catch (e) {} }
      this._speakingQueue = false;
      this.busy = false;
      this.onStatus('■ stopped — pose reset', 'ok');
    },

    /* ---------------- brain: text -> plan ---------------- */

    _brain: function (userText) {
      var self = this;
      if (!this.apiKey) {
        this.onStatus('🤖 demo brain performing (no API key set)…', 'ok');
        return Promise.resolve(this._demoBrain(userText));
      }
      this.onStatus('🧠 ' + (this.model || 'auto free model') + ' is thinking…', 'ok');

      var msgs = [{ role: 'system', content: this._systemPrompt(false) }]
        .concat(this.history.slice(-6))
        .concat([{ role: 'user', content: userText }]);

      return this._openrouter(msgs)
        .then(function (raw) {
          var plan = self._parsePlan(raw);
          if (!plan) {
            /* one repair attempt */
            return self._openrouter([
              { role: 'system', content: self._systemPrompt(true) },
              { role: 'user', content: 'FIX TO STRICT JSON ONLY:\n\n' + String(raw).slice(0, 4000) }
            ]).then(function (raw2) {
              var p2 = self._parsePlan(raw2);
              if (!p2) throw new Error('model would not return JSON — pick another model');
              return p2;
            });
          }
          return plan;
        })
        .then(function (plan) {
          self.history.push({ role: 'user', content: userText });
          self.history.push({ role: 'assistant', content: plan.say || (plan.steps && plan.steps[0] && plan.steps[0].say) || '' });
          if (self.history.length > 12) self.history = self.history.slice(-12);
          return plan;
        });
    },

    _openrouter: function (messages) {
      var self = this;
      var model = this.model || this._defaultModel;
      if (!model) {
        return this.models().then(function (list) {
          if (!list.length) throw new Error('no models available — check the provider/key');
          self._defaultModel = list[0].id;
          return self._call(list[0].id, messages);
        });
      }
      return this._call(model, messages);
    },

    /* one call with automatic retry when free models are busy */
    _call: function (model, messages) {
      var self = this;
      return this._callOnce(model, messages).catch(function (e) {
        if (e && e.status === 429) {
          self.onStatus('\u23f3 model busy — retrying once in 4s\u2026', 'ok');
          return new Promise(function (res) { setTimeout(res, 4000); })
            .then(function () { return self._callOnce(model, messages); });
        }
        throw e;
      });
    },

    _callOnce: function (model, messages) {
      var self = this;
      var prov = PROVIDERS[this.provider] || PROVIDERS.openrouter;
      var body = { model: model, messages: messages, temperature: 0.6, max_tokens: 900 };
      if (this.provider === 'openrouter') {
        body.provider = { sort: 'throughput' };   /* OpenRouter: route to the fastest serving provider */
      } else if (this.provider === 'featherless' && !this._noJSONMode) {
        /* strict JSON mode: the model physically can't ramble — faster replies, no repair round-trips */
        body.response_format = { type: 'json_object' };
      }

      /* live timer so a slow free model never looks frozen */
      var t0 = Date.now();
      var tick = setInterval(function () {
        var secs = Math.round((Date.now() - t0) / 1000);
        self.onStatus('\u{1F9E0} ' + String(model).split('/').pop() + ' thinking\u2026 ' + secs + 's'
          + (secs >= 10 ? ' \u2014 serverless models can queue a bit, hang on' : ''), 'ok');
      }, 2000);
      var ctrl = null, stop = null;
      if (typeof AbortController !== 'undefined') {
        ctrl = new AbortController();
        stop = setTimeout(function () { try { ctrl.abort(); } catch (e) {} }, 60000);
      }
      var cleanup = function () { clearInterval(tick); if (stop) clearTimeout(stop); };

      return fetch(prov.chat, {
        method: 'POST',
        headers: prov.headers(this.apiKey),
        body: JSON.stringify(body),
        signal: ctrl ? ctrl.signal : undefined
      }).then(function (r) {
        var fail = function (msg, st) { var e = new Error(msg); e.status = st; return e; };
        if (r.status === 400 && body.response_format && !self._noJSONMode) {
          self._noJSONMode = true;          /* this model has no JSON mode — retry without it */
          return self._callOnce(model, messages);
        }
        if (r.status === 429) throw fail('rate limited \u2014 free models are busy', 429);
        if (r.status === 401) throw fail('bad API key \u2014 check your ' + prov.label + ' key', 401);
        if (!r.ok) throw fail(prov.label + ' error ' + r.status, r.status);
        return r.json();
      }).then(function (j) {
        cleanup();
        var msg = j && j.choices && j.choices[0] && j.choices[0].message;
        if (msg && typeof msg.content === 'string') return msg.content;
        if (msg && msg.reasoning) throw new Error('model only returned reasoning \u2014 pick a non-reasoning model');
        throw new Error('empty reply from model');
      }).catch(function (e) {
        cleanup();
        if (e && e.name === 'AbortError') throw new Error('timed out after 60s \u2014 try a faster model or switch provider');
        throw e;
      });
    },

    _parsePlan: function (raw) {
      if (!raw) return null;
      var text = String(raw).trim();
      /* strip markdown fences if the model added them anyway */
      text = text.replace(/^```(?:json)?/i, '').replace(/```$/g, '').trim();
      /* grab the outermost JSON object */
      var s = text.indexOf('{'), e = text.lastIndexOf('}');
      if (s === -1 || e <= s) return null;
      try {
        var plan = JSON.parse(text.slice(s, e + 1));
        if (!plan || typeof plan !== 'object') return null;
        if (!Array.isArray(plan.steps)) plan.steps = [];
        plan.steps = plan.steps.slice(0, 6).filter(function (step) {
          return step && typeof step === 'object';
        }).map(function (step) {
          step.tweak = this._normalizeTweak(step.tweak);
          return step;
        }, this);                                             // hard cap + safe pose schema
        plan.images = Array.isArray(plan.images)
          ? plan.images.filter(function (q) { return typeof q === 'string' && q.trim(); })
              .slice(0, 3).map(function (q) { return q.trim().slice(0, 60); })
          : [];
        return plan;
      } catch (err) { return null; }
    },

    /* Keep LLM motion requests inside the engine's narrow pose vocabulary. */
    _normalizeTweak: function (raw) {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
      function number(value, min, max) {
        value = Number(value);
        return isFinite(value) ? Math.max(min, Math.min(max, value)) : undefined;
      }
      var out = {};
      [['headTilt', -18, 18], ['lean', -8, 8], ['leftArm', -20, 170], ['rightArm', -20, 175], ['bounce', -36, 0], ['smile', 0.65, 1.45]].forEach(function (rule) {
        var value = number(raw[rule[0]], rule[1], rule[2]);
        if (value !== undefined) out[rule[0]] = value;
      });
      if (raw.look && typeof raw.look === 'object') {
        var x = number(raw.look.x, -1, 1), y = number(raw.look.y, -1, 1);
        if (x !== undefined || y !== undefined) out.look = { x: x === undefined ? 0 : x, y: y === undefined ? 0 : y };
      }
      return Object.keys(out).length ? out : null;
    },

    _systemPrompt: function (repair) {
      var mem = this.recent.length ? '\nRecent performances (do not repeat yourself): ' + this.recent.slice(-3).join(' | ') : '';
      if (repair) {
        return 'You previously replied with invalid JSON. Convert it into the exact schema requested. Output ONLY the JSON object, no prose, no fences.';
      }
      return 'You are the STAGE DIRECTOR of an animated teacher character (the Professor). You control the character\'s body, face, voice and chalkboard.\n\n'
        + 'Reply with STRICT JSON ONLY (no markdown, no prose outside JSON):\n'
        + '{"say":"<short opening line, max 2 sentences, plain text>","expression":"neutral|happy|surprised|thinking|angry","images":["<optional 1-3 short search queries for REAL photos, e.g. \"volcano eruption\" — omit for greetings/jokes>"],"steps":[{"do":"<gesture>","at":<optional start time in seconds, e.g. 0 or 2.5>,"parallel":["<gesture>"],"say":"<full teaching speech for this step, 1-4 sentences, plain text>","board":"<optional chalk text, \\n for new line, max 6 lines, max 28 chars/line>","draw":"<optional chalk sketch: preset keyword (apple, star, arrow, smile, sun, cat, dog, rocket, house, tree, fish, heart, flower, drop, cloud, lightbulb, dna, moon) OR object {\"name\":\"cat\",\"d\":[\"<svg path>",...]} to draw anything>","wipe":false,"hold":<0-3 seconds after this step>}]}\n\n'
        + 'Gestures: ' + GESTURES.join(', ') + '.\n'
        + '"parallel" runs extra gestures AT THE SAME TIME as "do" — only compatible combos (wave+nod ok, write+point not ok).\n'
        + '"tweak" is OPTIONAL, safe pose seasoning only: headTilt (-18..18), lean (-8..8), leftArm (-20..170), rightArm (-20..175), bounce (-36..0), look {x,y} (-1..1), smile (.65..1.45). Use one or two small values; never raw SVG/CSS/selector properties. Do NOT tweak a head or arm that the chosen gesture already owns. Every tweak automatically returns to idle after its hold.\n'
        + '"board" writes chalk text; "wipe":true erases everything first — clean slate, fresh redraw, use it when changing topic mid-act. The chalkboard is large and blank — write anything that teaches: terms, definitions, steps, equations, short lists, simple ASCII sketches. Use up to 6 lines; use \\n for new lines.\n'
        + '"draw" sketches a chalk picture. FIRST try a PRESET (exact keyword): apple, star, arrow, smile, sun, cat, dog, rocket, house, tree, fish, heart, flower, drop, cloud, lightbulb, dna, moon. If nothing fits, invent a custom doodle as {"name":"<thing>","d":["<svg path>",...]}: simple chalk line art, coordinates in a box from -55 to 55 with (0,0) at the center; ONLY M/L/Q/C/A/Z commands; no fills; 2-8 strokes, each stroke ONE continuous path string; draw BIG, filling the box; use full-circle arcs like "a 24 24 0 1 0 0.01 0" for round shapes and long smooth curves — never many tiny fragments. The drawing is shown live, so make it clear and recognizable. Example cat face: {"name":"cat","d":["M -26 4 a 26 26 0 1 0 52 0 a 26 26 0 1 0 -52 0","M -22 -16 L -28 -40 L -8 -28","M 22 -16 L 28 -40 L 8 -28","M -16 10 L -36 6 M -16 14 L -36 18 M 16 10 L 36 6 M 16 14 L 36 18"]}\n'
        + 'TIMELINE: give steps "at" (seconds from performance start) and you choreograph the whole act on a clock — steps may overlap. Example — teaching the word "apple":\n'
        + '  steps: [{"do":"write","board":"Apple","at":0},{"draw":"apple","do":"point","at":2},{"do":"talk","say":"This is an apple.","at":3}]\n'
        + '  Speech starts exactly at its "at" time; the mouth animation syncs to the audio automatically. Steps without "at" run in order, one after another.\n'
        + 'TEACH FULLY: never answer in one sentence — split the complete explanation across 3-6 steps, each carrying 1-4 sentences of real teaching (one idea per step), so the full topic is covered end to end.\n'
        + '"images": optional array of 1-3 SHORT plain-noun search queries (e.g. \"volcano eruption\", \"water cycle diagram\"); REAL photos for them load beneath the chalkboard. Use it whenever a real photo teaches better than chalk — most science/geography/history topics. Skip for greetings, jokes, chitchat.\n'
        + 'Perform naturally: think before hard questions, point at what you wrote, wave to greet, celebrate wins, talk while explaining.' + mem;
    },

    /* ---------------- demo brain (no API key) ---------------- */

    _demoBrain: function (userText) {
      var t = (userText || '').toLowerCase();
      var topic = (userText || 'science').trim().split(/\s+/).slice(0, 4).join(' ');
      if (/hi|hello|hey|vanakkam/.test(t)) {
        return { say: 'Hello! I am the Professor. Ask me anything and I will teach it.', expression: 'happy',
          steps: [{ do: 'wave', parallel: ['nod'], hold: 0.4 }] };
      }
      if (/joke|funny/.test(t)) {
        return { say: 'Why did the proton bring a suitcase? It was travelling light!', expression: 'happy',
          steps: [{ do: 'think', hold: 0.2 }, { do: 'celebrate', parallel: ['nod'], hold: 0.5 }] };
      }
      if (/cat|kitty/.test(t)) {
        /* "draw anything" showcase — custom doodle, no preset involved */
        return { say: 'Ask me to draw anything — watch, a cat!', expression: 'happy', images: ['cat'],
          steps: [
            { do: 'write', board: 'Cat', wipe: true, at: 0 },
            { draw: { name: 'cat', d: [
                'M -26 4 a 26 26 0 1 0 52 0 a 26 26 0 1 0 -52 0',
                'M -22 -16 L -28 -40 L -8 -28',
                'M 22 -16 L 28 -40 L 8 -28',
                'M -12 -2 a 3 3 0 1 0 0.01 0',
                'M 12 -2 a 3 3 0 1 0 0.01 0',
                'M -3 8 L 3 8 L 0 13 Z',
                'M -16 10 L -36 6 M -16 14 L -36 18 M 16 10 L 36 6 M 16 14 L 36 18'
              ] }, do: 'point', at: 2 },
            { do: 'talk', say: 'A cat. Chalk, zero pixels wasted.', at: 3.6, hold: 0.5 }
          ] };
      }
      if (/rocket|space/.test(t)) {
        return { say: 'A rocket, fresh from the preset library!', expression: 'happy',
          steps: [
            { do: 'write', board: 'Rocket', wipe: true, at: 0 },
            { draw: 'rocket', do: 'point', at: 2 },
            { do: 'talk', say: 'A rocket. Three, two, one, liftoff.', at: 3.6, hold: 0.5 }
          ] };
      }
      if (/apple|choreograph|timeline/.test(t)) {
        /* timeline showcase: 0-2s write, 2-3s draw, 3-5s say — exactly what "at" is for */
        return { say: 'Watch my schedule — I write it, I draw it, then I say it.', expression: 'happy',
          steps: [
            { do: 'write', board: 'Apple', wipe: true, at: 0 },
            { draw: 'apple', do: 'point', at: 2 },
            { do: 'talk', say: 'Apple. This is an apple.', at: 3, hold: 0.5 }
          ] };
      }
      var board = (t.match(/gravity|newton/) ? 'Gravity\nF = G·m1·m2/r²\nF = m·a\nW = m·g' : (t.match(/energy|einstein/) ? 'Energy\nE = mc²\nKE = ½mv²\nP = W/t' : topic));
      return { say: 'Great question. Let me write the key idea on the board.', expression: 'thinking',
        steps: [
          { do: 'think', hold: 0.3 },
          { do: 'write', board: board, wipe: true, hold: 0.6 },
          { do: 'point', say: 'See this? This is the heart of it.', hold: 0.4 },
          { do: 'explain', say: 'Add your OpenRouter key to let a real AI model improvise this part.', hold: 0.5 }
        ] };
    },

    /* ---------------- performance: plan -> body/voice/board ---------------- */

    _perform: function (plan) {
      var self = this;
      var eng = this.getEngine();
      if (!eng) { this.onStatus('⚠ no engine loaded yet', 'err'); return Promise.resolve(); }

      if (EXPRESSIONS.indexOf(plan.expression) !== -1) {
        try { eng.expression(plan.expression); } catch (e) {}
      }

      var chain = plan.steps.length ? plan.steps.slice() : [{ do: 'talk' }];

      /* real photos for the topic, beneath the board */
      this._showImages(plan.images);

      /* timeline mode: any step carrying "at" (seconds) is scheduled on a clock,
         so the AI can choreograph — e.g. 0-2s write, 2-3s draw, 3-5s speak */
      var timed = chain.some(function (st) { return isFinite(Number(st.at)); });
      if (timed) return this._performTimed(chain, plan);

      var i = 0;

      /* opening line spoken while the first step plays */
      var opener = plan.say ? this._speak(plan.say) : Promise.resolve();

      return new Promise(function (resolve) {
        (function next() {
          if (self._kill) { resolve(); return; }
          if (i >= chain.length) {
            self._speechIdle().then(function () {
              if (self._kill) { resolve(); return; }
              self._returnIdle();
              self._remember(chain);
              self.onStatus('✓ performance done — engine ready', 'ok');
              resolve();
            });
            return;
          }
          var step = chain[i++];
          var waiters = [opener];

          if (step.board) {
            if (!step.do) step.do = 'write';                      // writing implies the write gesture
            waiters.push(self._writeBoard(step.board, step.wipe));
          }
          if (step.draw) {
            waiters.push(self._drawBoard(step.draw));
            if (!step.do) step.do = 'point';                    // drawing implies pointing at it
          }
          if (step.tweak) waiters.push(self._tweak(step));
          var sayP = step.say ? self._speak(step.say) : null;
          if (sayP) waiters.push(sayP);
          if (step.do || (step.parallel && step.parallel.length)) {
            waiters.push(self._gestures(step, sayP));
          }
          self.onStatus('▶ performing: ' + [step.do].concat(step.parallel || []).filter(Boolean).join(' + ')
            + (step.board ? ' + writing' : '') + (step.draw ? ' + drawing ' + self._drawLabel(step.draw) : '') + (step.say ? ' + speaking' : ''));

          Promise.all(waiters).then(function () {
            if (self._kill) { resolve(); return; }
            var hold = Math.max(0, Math.min(3, Number(step.hold) || 0));
            self._autoTimer = setTimeout(next, hold * 1000);
          }).catch(function () { next(); });
        })();
      });
    },

    /* timeline mode: steps fire at absolute "at" seconds; overlapping is fine */
    _performTimed: function (chain, plan) {
      var self = this;
      if (plan.say) this._speak(plan.say);                     /* opening line at t=0 */

      var jobs = chain.map(function (step) {
        var at = Math.max(0, Math.min(60, Number(step.at) || 0));
        return new Promise(function (resolve) {
          setTimeout(function () {
            if (self._kill) { resolve(); return; }
            var w = [];
            if (step.board) { if (!step.do) step.do = 'write'; w.push(self._writeBoard(step.board, step.wipe)); }
            if (step.draw)  { w.push(self._drawBoard(step.draw)); if (!step.do) step.do = 'point'; }
            if (step.tweak) w.push(self._tweak(step));
            var sayP = step.say ? self._speak(step.say) : null;
            if (sayP) w.push(sayP);
            if (step.do || (step.parallel && step.parallel.length)) w.push(self._gestures(step, sayP));
            self.onStatus('▶ [' + at.toFixed(1) + 's] performing: ' + [step.do].concat(step.parallel || []).filter(Boolean).join(' + ')
              + (step.board ? ' + writing' : '') + (step.draw ? ' + drawing ' + self._drawLabel(step.draw) : '') + (step.say ? ' + speaking' : ''));
            var hold = Math.max(0, Math.min(3, Number(step.hold) || 0));
            Promise.all(w).then(function () { setTimeout(resolve, hold * 1000); }).catch(function () { resolve(); });
          }, at * 1000);
        });
      });
      return Promise.all(jobs).then(function () {
        return self._speechIdle();
      }).then(function () {
        if (!self._kill) self._returnIdle();
        self._remember(chain);
        self.onStatus('✓ performance done — engine ready', 'ok');
      });
    },

    /* run a step's gestures — main via play(), extras as independent timelines.
       If the step has speech, the gesture gently LOOPS until the sentence is
       finished, so the character never freezes mid-explanation. */
    _gestures: function (step, speakP) {
      var self = this;
      var eng = this.getEngine();
      var speaking = !!speakP;
      if (speakP) { speakP.then(function () { speaking = false; }, function () { speaking = false; }); }

      var play = function () {
        var tls = [];
        var main = GESTURES.indexOf(step.do) !== -1 ? step.do : null;
        if (main) {
          var tl = eng.play(main);
          if (tl) tls.push(tl);
        }
        var used = main ? (USES[main] || []).slice() : [];
        (step.parallel || []).forEach(function (name) {
          if (GESTURES.indexOf(name) === -1) return;
          var needs = USES[name] || [];
          for (var k = 0; k < needs.length; k++) {
            if (used.indexOf(needs[k]) !== -1) return;              // part conflict — skip, don't fight
          }
          used = used.concat(needs);
          try {
            var t2 = eng.animations[name] && eng.animations[name].call(eng);
            if (t2) { t2.timeScale(eng.speed || 1); tls.push(t2); }
          } catch (e) { /* character missing a part — skip */ }
        });
        if (!tls.length) return Promise.resolve();
        return new Promise(function (resolve) {
          var left = tls.length;
          var done = false;
          var fin = function () {
            if (done) return;
            if (--left <= 0) { done = true; resolve(); }
          };
          tls.forEach(function (t) {
            if (t && t.then) { t.then(fin); }
            else { setTimeout(fin, 1500); }
          });
          /* safety: never wait longer than 12s on a gesture */
          setTimeout(function () { if (!done) { done = true; resolve(); } }, 12000);
        });
      };

      var loops = 0;
      var round = function () {
        return play().then(function () {
          if (speaking && !self._kill && loops < 10) { loops++; return round(); }
          speaking = false;
        });
      };
      return round();
    },

    /* Runs a bounded engine tweak and waits for its automatic neutral return. */
    _tweak: function (step) {
      var eng = this.getEngine();
      if (!eng || !step.tweak || typeof eng.tweak !== 'function') return Promise.resolve();
      var tl;
      try { tl = eng.tweak(step.tweak, { hold: step.hold }); } catch (e) { return Promise.resolve(); }
      if (!tl || !tl.then) return Promise.resolve();
      return new Promise(function (resolve) {
        var done = false;
        function finish() { if (!done) { done = true; resolve(); } }
        tl.then(finish); setTimeout(finish, 6000);
      });
    },

    /* A completed act always leaves the stage in its stable neutral state. */
    _returnIdle: function () {
      var eng = this.getEngine();
      if (!eng) return;
      try { eng.stopGesture(); eng.speak(false); eng.expression('neutral'); eng.resetPose(); } catch (e) {}
    },

    /* pick the best available English voice */
    _pickVoice: function () {
      try {
        var vs = global.speechSynthesis.getVoices();
        if (!vs.length) return null;
        var en = vs.filter(function (v) { return /^en/i.test(v.lang); });
        var requested = this.voice && this.voice.preferred;
        if (requested) {
          var requestedVoices = en.filter(function (v) {
            return requested instanceof RegExp ? requested.test(v.name) : String(v.name).toLowerCase().indexOf(String(requested).toLowerCase()) !== -1;
          });
          if (requestedVoices.length) return requestedVoices[0];
        }
        var pref = en.filter(function (v) { return /google|natural|neural|premium|enhanced|online/i.test(v.name); });
        return pref[0] || en[0] || vs[0];
      } catch (e) { return null; }
    },

    /* speech: chunked + queued TTS. Every line joins ONE queue so overlapping
       steps never cut each other off, and long text is split into short sentence
       chunks (Chrome's engine breaks on long utterances). Mouth flaps from first
       word to last. */
    _speak: function (text) {
      var self = this;
      text = String(text || '').slice(0, 800);
      if (!text) return Promise.resolve();
      if (!this._speechQueue) { this._speechQueue = []; this._speakingQueue = false; }
      return new Promise(function (resolve) {
        self._speechQueue.push({ text: text, resolve: resolve });
        if (!self._speakingQueue) self._drainSpeech();
      });
    },

    /* play queue items one at a time, sentence-chunk by sentence-chunk */
    _drainSpeech: function () {
      var self = this;
      var item = (this._speechQueue || []).shift();
      var flap = function (on) {
        var e = self.getEngine();
        if (e) { try { e.speak(on); } catch (e2) {} }
      };
      if (!item) { this._speakingQueue = false; flap(false); return; }
      this._speakingQueue = true;

      var settled = false;
      var guard = null;
      var finishItem = function () {
        if (settled) return;
        settled = true;
        if (guard) clearTimeout(guard);
        item.resolve();
        self._drainSpeech();
      };

      var synth = global.speechSynthesis;
      var words = item.text.split(/\s+/).length;

      /* no TTS available — flap the mouth for the estimated duration instead */
      if (!synth || !global.SpeechSynthesisUtterance) {
        flap(true);
        setTimeout(function () { flap(false); finishItem(); }, Math.max(1200, words * 380));
        return;
      }

      var chunks = self._chunkText(item.text);
      var ci = 0, attempt = 0;
      var speakNext = function () {
        if (self._kill || ci >= chunks.length) { finishItem(); return; }
        var voice = self._pickVoice();
        /* Chrome loads voices asynchronously — retry briefly instead of dropping audio */
        if (!voice && attempt < 8) { attempt++; setTimeout(speakNext, 250); return; }
        if (!voice) { flap(true); setTimeout(finishItem, Math.max(1500, words * 380)); return; }
        try { if (synth.paused) synth.resume(); } catch (e) {}
        var u = new global.SpeechSynthesisUtterance(chunks[ci++]);
        u.voice = voice; u.lang = voice.lang || 'en-US';
        u.rate = Math.max(0.1, Math.min(10, Number(self.voice && self.voice.rate) || 1.0));
        u.pitch = Math.max(0, Math.min(2, Number(self.voice && self.voice.pitch) || 1.05));
        u.onstart = function () { flap(true); };        /* mouth moves with the audio */
        u.onend = function () { setTimeout(speakNext, 60); };
        u.onerror = function () { setTimeout(speakNext, 60); };
        try { synth.speak(u); } catch (e) { setTimeout(speakNext, 60); }
        setTimeout(function () { if (!settled) flap(true); }, 400);   /* no-onstart browsers */
      };
      speakNext();
      guard = setTimeout(function () {                 /* safety if events never fire */
        try { synth.cancel(); } catch (e) {}
        finishItem();
      }, Math.max(3000, words * 480) + 5000);
    },

    /* split into short sentence chunks — Chrome TTS breaks on long utterances */
    _chunkText: function (text) {
      var parts = String(text).replace(/\s+/g, ' ').trim().match(/[^.!?]+[.!?]*/g) || [String(text)];
      var chunks = [], cur = '';
      parts.forEach(function (p) {
        p = p.trim(); if (!p) return;
        if (cur && (cur + ' ' + p).length > 170) { chunks.push(cur); cur = p; }
        else cur = cur ? cur + ' ' + p : p;
      });
      if (cur) chunks.push(cur);
      return chunks.length ? chunks : [String(text)];
    },

    /* resolves once the speech queue has fully drained */
    _speechIdle: function () {
      var self = this;
      return new Promise(function (res) {
        (function check() {
          if (!self._speakingQueue) { res(); return; }
          setTimeout(check, 300);
        })();
      });
    },

    /* wipe the AI's chalk writing + doodles instantly — for the Clear board button */
    clearBoard: function () {
      var svgRoot = document.querySelector('#stage-holder svg');
      if (!svgRoot) return;
      var board = svgRoot.querySelector('#board-ai');
      var layer = svgRoot.querySelector('#board-draw');
      if (board) { try { board.innerHTML = ''; } catch (e) {} }
      if (layer) { try { layer.innerHTML = ''; } catch (e) {} }
      this.onStatus('\uD83E\uDDFC board cleared — ready to redraw', 'ok');
    },

    /* real photos beneath the board: 1-3 search queries -> Wikipedia thumbnails */
    _showImages: function (queries) {
      var existing = document.getElementById('related-images');
      if (existing) existing.innerHTML = '';                    /* fresh topic, fresh photos */
      queries = (queries || []).slice(0, 3);
      if (!queries.length) return;
      var self = this;
      var panel = this._ensureImgPanel();
      this.onStatus('\uD83D\uDDBC loading related images\u2026', 'ok');
      Promise.all(queries.map(function (q) {
        var url = 'https://en.wikipedia.org/w/api.php?action=query&format=json&origin=*'
          + '&generator=search&gsrsearch=' + encodeURIComponent(q)
          + '&gsrlimit=1&prop=pageimages|extracts&exintro=1&explaintext=1&piprop=thumbnail&pithumbsize=400';
        return fetch(url).then(function (r) { return r.json(); }).then(function (j) {
          var pages = (j && j.query && j.query.pages) || {};
          var ids = Object.keys(pages);
          for (var k = 0; k < ids.length; k++) {
            var p = pages[ids[k]];
            if (p.thumbnail && p.thumbnail.source) {
              return { src: p.thumbnail.source, title: p.title || q, extract: String(p.extract || '').slice(0, 140) };
            }
          }
          return null;
        }).catch(function () { return null; });
      })).then(function (found) {
        found = found.filter(Boolean);
        if (!found.length || self._kill) return;
        found.forEach(function (f) {
          var a = document.createElement('a');
          a.className = 'ri-card';
          a.href = 'https://en.wikipedia.org/wiki/' + encodeURIComponent(f.title.replace(/ /g, '_'));
          a.target = '_blank'; a.rel = 'noreferrer';
          a.title = f.extract;
          var img = document.createElement('img');
          img.src = f.src; img.alt = f.title; img.loading = 'lazy';
          var cap = document.createElement('div'); cap.className = 'ri-cap';
          var t = document.createElement('b'); t.textContent = f.title;
          var x = document.createElement('span'); x.textContent = f.extract;
          cap.appendChild(t); cap.appendChild(x);
          a.appendChild(img); a.appendChild(cap);
          panel.appendChild(a);
        });
        self.onStatus('\uD83D\uDDBC ' + found.length + ' related image' + (found.length > 1 ? 's' : '') + ' beneath the board', 'ok');
      });
    },

    /* the panel lives right beneath the stage; inject its CSS once on first use */
    _ensureImgPanel: function () {
      var panel = document.getElementById('related-images');
      if (panel) return panel;
      if (!document.getElementById('related-images-css')) {
        var st = document.createElement('style');
        st.id = 'related-images-css';
        st.textContent = '#related-images{display:flex;gap:10px;justify-content:center;flex-wrap:wrap;padding:10px 6px 2px}'
          + '.ri-card{width:158px;background:#fff;border-radius:8px;overflow:hidden;text-decoration:none;color:#222;'
          + 'box-shadow:0 2px 8px rgba(0,0,0,.22);transition:transform .2s}.ri-card:hover{transform:translateY(-2px)}'
          + '.ri-card img{width:100%;height:96px;object-fit:cover;display:block}'
          + '.ri-cap{padding:6px 8px;font:12px/1.3 system-ui,sans-serif}.ri-cap b{display:block;margin-bottom:2px}'
          + '.ri-cap span{color:#666;display:block;max-height:31px;overflow:hidden}';
        (document.head || document.documentElement).appendChild(st);
      }
      panel = document.createElement('div');
      panel.id = 'related-images';
      var holder = document.querySelector('#stage-holder');
      var host = holder ? (holder.parentElement || document.body) : document.body;
      host.appendChild(panel);   /* beneath the stage, inside the page flow */
      return panel;
    },

    /* chalkboard: write (and optionally wipe) AI text */
    _writeBoard: function (text, wipe) {
      /* NOTE: engine.root is the #professor GROUP, not the <svg> — board text
         must live on the SVG root so it stays put while the character moves. */
      var svgRoot = document.querySelector('#stage-holder svg');
      if (!svgRoot) return Promise.resolve();

      var self = this;
      var board = svgRoot.querySelector('#board-ai');
      if (!board) {
        board = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        board.setAttribute('id', 'board-ai');
        board.setAttribute('font-family', "'Caveat','Comic Sans MS','Segoe Print',cursive");
        board.setAttribute('fill', '#f3efe2');
        svgRoot.appendChild(board);
      }

      /* wrap words into lines of <=28 chars (big board: 428px wide) */
      var lines = String(text).split(/\n+/).map(function (l) { return l.trim(); }).filter(Boolean);
      var wrapped = [];
      lines.forEach(function (line) {
        var cur = '';
        line.split(/\s+/).forEach(function (w) {
          if ((cur + ' ' + w).trim().length > 28) { if (cur) wrapped.push(cur); cur = w; }
          else cur = (cur + ' ' + w).trim();
        });
        if (cur) wrapped.push(cur);
      });
      wrapped = wrapped.slice(0, 6);   /* board fits 6 lines now */

      var old = board.querySelectorAll('text');
      /* static decorative formulas group, if the character SVG has one — MUST exclude
         #board-ai itself, which also carries a font-family attribute. Matching board-ai
         here was the bug: every "wipe" faded the AI's own text group to 0.12 opacity
         and nothing ever reset it, so all later text rendered washed-out/near-invisible. */
      var chalk = Array.prototype.filter.call(svgRoot.querySelectorAll('g[font-family]'), function (el) {
        return el.id !== 'board-ai';
      })[0];
      var waveLine = svgRoot.querySelector('#board-line');   /* the "write" gesture line */

      return new Promise(function (resolve) {
        var proceed = function () {
          if (self._kill) { resolve(); return; }
          board.removeAttribute('opacity');                   /* undo any stray past dimming */
          board.style.opacity = '';
          board.innerHTML = '';
          if (wipe) {
            if (chalk)     { try { global.gsap.to(chalk, { opacity: 0.12, duration: 0.4 }); } catch (e) {} }
            if (waveLine) { try { global.gsap.to(waveLine, { opacity: 0.15, duration: 0.4 }); } catch (e) {} }
            var sketch = svgRoot.querySelector('#board-draw');
            if (sketch) { try { sketch.innerHTML = ''; } catch (e) {} }
          }
          var texts = wrapped.map(function (line, idx) {
            var t = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            t.setAttribute('x', 76 + (idx % 2) * 12);
            t.setAttribute('y', 108 + idx * 42);
            t.setAttribute('font-size', '30');
            t.setAttribute('opacity', '0');
            t.textContent = line;
            board.appendChild(t);
            return t;
          });
          if (!texts.length) { resolve(); return; }
          try {
            global.gsap.to(texts, {
              opacity: 0.92, duration: 0.45, stagger: 0.4,
              onComplete: resolve
            });
          } catch (e) { resolve(); }
        };

        if (old.length && global.gsap) {
          try { global.gsap.to(old, { opacity: 0, duration: 0.3, onComplete: proceed }); }
          catch (e) { proceed(); }
        } else { proceed(); }
      });
    },

    /* pretty label for the status line — preset name or custom doodle name */
    _drawLabel: function (spec) {
      if (spec && typeof spec === 'object') return spec.name || 'doodle';
      return String(spec || '');
    },

    /* draw a chalk sketch on the board (animated stroke reveal).
       spec: preset keyword (apple|star|arrow|smile|sun) OR custom doodle
             {name:"cat", d:["<svg path>",...]} invented by the AI — draw anything */
    _drawBoard: function (spec) {
      var svgRoot = document.querySelector('#stage-holder svg');
      if (!svgRoot) return Promise.resolve();
      var key, paths, isPreset = false;
      if (spec && typeof spec === 'object') {
        var raw = spec.d;
        if (typeof raw === 'string') raw = [raw];
        paths = (Array.isArray(raw) ? raw : []).slice(0, 14).map(function (d) {
          /* keep only legal path commands/coords — nothing else survives */
          return String(d).replace(/[^MmLlQqCcAaZzHhVv0-9 ,.\-]/g, '').slice(0, 800);
        }).filter(function (d) { return d && /(^| )[Mm]/.test(d); });
        key = 'custom';
      } else {
        key = String(spec || '').toLowerCase().trim();
        paths = DRAWINGS[key];
        isPreset = true;
      }
      if (!paths || !paths.length) return Promise.resolve();

      var layer = svgRoot.querySelector('#board-draw');
      if (!layer) {
        layer = document.createElementNS(SVG_NS, 'g');
        layer.setAttribute('id', 'board-draw');
        svgRoot.appendChild(layer);
      }
      /* a new picture replaces the old one; preset arrows append on top (for labelling) */
      if (!(isPreset && key === 'arrow')) { try { layer.innerHTML = ''; } catch (e) {} }

      var g = document.createElementNS(SVG_NS, 'g');
      g.setAttribute('transform', 'translate(410 150)');
      g.setAttribute('opacity', '0.95');
      var els = paths.map(function (d) {
        var p = document.createElementNS(SVG_NS, 'path');
        p.setAttribute('d', d);
        p.setAttribute('fill', 'none');
        p.setAttribute('stroke', '#f3efe2');
        p.setAttribute('stroke-width', 4);
        p.setAttribute('stroke-linecap', 'round');
        p.setAttribute('stroke-linejoin', 'round');
        g.appendChild(p);
        return p;
      });
      layer.appendChild(g);

      return new Promise(function (resolve) {
        var done = false;
        var fin = function () { if (!done) { done = true; resolve(); } };
        try {
          els.forEach(function (p, i) {
            var L = 1;
            try { L = p.getTotalLength() || 1; } catch (e) {}
            p.style.strokeDasharray = L;
            p.style.strokeDashoffset = L;
            global.gsap.to(p, {
              strokeDashoffset: 0, duration: 0.7, delay: i * 0.55, ease: 'power1.inOut',
              onComplete: i === els.length - 1 ? fin : null
            });
          });
        } catch (e) { /* no gsap — just show it instantly */ }
        setTimeout(fin, 900 + els.length * 550 + 500);   /* safety */
      });
    },

    /* ---------------- autonomous free-run ---------------- */

    _autoTick: function () {
      var self = this;
      if (!this.auto || this._kill) return;
      var prompt = 'FREE-RUN MODE: you are live on stage with no script. Decide yourself what to teach or do next '
        + '(pick any science/math topic, react, joke, show off — anything). Perform a SHORT varied act (1-3 steps), '
        + 'sometimes write on the board, sometimes just talk. Never repeat your last performance.';
      this.busy = false; /* allow chained brain calls */
      this.chat(prompt).then(function () {
        if (!self.auto || self._kill) return;
        self._autoTimer = setTimeout(function () { self._autoTick(); }, 1200);
      });
    },

    _remember: function (steps) {
      var self = this;
      var summary = steps.map(function (s) {
        return (s.do || '') + (s.board ? '(wrote: ' + String(s.board).split('\n')[0].slice(0, 20) + ')' : '') + (s.draw ? '(drew: ' + self._drawLabel(s.draw) + ')' : '') + (s.say ? '(said: ' + String(s.say).slice(0, 25) + ')' : '');
      }).join(', ');
      this.recent.push(summary);
      if (this.recent.length > 6) this.recent = this.recent.slice(-6);
    }
  };

  global.AIStageDirector = AIStageDirector;
})(window);
