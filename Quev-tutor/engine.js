/*!
 * ProfessorEngine v1.0.0
 * A GSAP-powered animation engine for SVG character rigs.
 * Built for the SVG Professor character — core GSAP only, no paid plugins.
 *
 * QUICK USE
 *   const prof = new ProfessorEngine('#professor');
 *   prof.play('wave');                    // one-shot gesture (returns the timeline)
 *   prof.play('explain', { loop: true }); // looping gesture
 *   prof.expression('happy');             // face state: neutral|happy|surprised|thinking|angry
 *   prof.lookAt(-0.6, 0.2);              // pupils: x/y in -1..1 range
 *   prof.speak(true);                     // continuous mouth-flap loop
 *   prof.stopGesture();                   // stop current gesture + reset pose
 *   prof.register('myMove', (eng, tl) => { tl.to(eng.p.armRight, { rotation: 40, svgOrigin: eng.pivots.armRight }); return tl; });
 *   prof.destroy();                       // full teardown
 *
 * PREMADE ANIMATIONS
 *   explain, point, write, think, wave, nod, shake, talk, lookAround, celebrate
 *
 * AMBIENT LIFE (always on unless opts.ambient = false)
 *   - breathing (torso)  - auto blinking  - tassel sway
 *
 * DESIGN NOTES (why it won't break)
 *   - Every part lookup is null-guarded: a missing SVG part logs a warning and its tweens are skipped instead of throwing.
 *   - Gestures are authored to start and end at NEUTRAL pose, so looping is seamless and state never drifts.
 *   - play() kills the previous gesture timeline before starting a new one, so button spam can't stack tweens.
 *   - Pivots are set explicitly via svgOrigin on every rotation tween (no bbox-origin surprises).
 *   - The chalk "write-on" effect uses raw stroke-dasharray/offset — works with free GSAP (no DrawSVG plugin).
 */
(function (global) {
  'use strict';

  /* ------------------------------------------------------------------ *
   * CONFIG — part ids, pivot points (in SVG viewBox coords), neutral pose
   * ------------------------------------------------------------------ */
  var PART_IDS = {
    root:        '#professor',
    head:        '#head',
    torso:       '#torso',
    armLeft:     '#arm-left',
    armRight:    '#arm-right',
    eyes:        '#eyes',
    pupilLeft:   '#pupil-l',
    pupilRight:  '#pupil-r',
    browLeft:    '#brow-l',
    browRight:   '#brow-r',
    mouthOpen:   '#mouth-open',
    mouthSmile:  '#mouth-smile',
    tassel:      '#tassel',
    writeLine:   '#board-line'
  };

  var PIVOTS = {
    head:     '612 340',
    armLeft:  '572 356',
    armRight: '652 356',
    tassel:   '612 206'
  };

  var TRANSFORM_ORIGINS = {
    eyes:       '50% 50%',
    mouthOpen:  '50% 50%',
    mouthSmile: '50% 50%',
    torso:      '50% 100%'
  };

  var NEUTRAL = {
    root:       { x: 0, y: 0 },
    head:       { x: 0, y: 0, rotation: 0 },
    torso:      { y: 0, rotation: 0, scaleY: 1 },
    armLeft:    { rotation: 0 },
    armRight:   { rotation: 0 },
    pupilLeft:  { x: 0, y: 0 },
    pupilRight: { x: 0, y: 0 },
    browLeft:   { y: 0, rotation: 0 },
    browRight:  { y: 0, rotation: 0 },
    mouthOpen:  { opacity: 0, scaleY: 0.01 },
    mouthSmile: { opacity: 1, scaleY: 1 },
    tassel:     { rotation: 0 }
  };

  /* Parts that gestures own (reset before each play) */
  var GESTURE_PARTS = ['root', 'head', 'armLeft', 'armRight', 'tassel', 'pupilLeft', 'pupilRight'];

  /* ------------------------------------------------------------------ *
   * ENGINE
   * ------------------------------------------------------------------ */
  function ProfessorEngine(target, opts) {
    opts = opts || {};
    if (!global.gsap) {
      throw new Error('ProfessorEngine: GSAP not found. Load gsap.min.js before constructing the engine.');
    }
    this.root = typeof target === 'string' ? document.querySelector(target) : target;
    if (!this.root) {
      throw new Error('ProfessorEngine: rig root not found — "' + (target || '') + '"');
    }

    this.speed   = typeof opts.speed === 'number' ? opts.speed : 1;
    this.pivots  = PIVOTS;
    this.partsConfig = Object.assign({}, PART_IDS, opts.parts || {});

    this.p = {};          // resolved part elements
    this._missing = [];   // parts that could not be found (warned once)
    this._gestureTL  = null;
    this._ambientTLS = [];
    this._speakTL    = null;
    this._speaking   = false;
    this._dead       = false;
    this._writeLen   = 0;

    this._grabParts();
    this._prepareWriteLine();
    this.resetPose();
    if (opts.ambient !== false) this.startAmbient();

    this.animations = {};
    var premade = this._premade();
    for (var name in premade) this.animations[name] = premade[name];
    if (opts.animations) for (var custom in opts.animations) this.animations[custom] = opts.animations[custom];
  }

  ProfessorEngine.prototype = {

    constructor: ProfessorEngine,

    /* ---------- part resolution (null-safe) ---------- */
    _grabParts: function () {
      var self = this;
      Object.keys(this.partsConfig).forEach(function (key) {
        var sel = self.partsConfig[key];
        var el = self.root.querySelector(sel) || document.querySelector(sel);
        if (!el) {
          self._missing.push(key);
          self.p[key] = null;
        } else {
          self.p[key] = el;
        }
      });
      if (self._missing.length) {
        console.warn('ProfessorEngine: missing parts (their tweens will be skipped): ' + self._missing.join(', '));
      }
    },

    /* null-safe tween helper: skips tweens whose target is missing */
    _to: function (tl, key, props, position) {
      if (!this.p[key]) return tl;
      var full = Object.assign({}, props);
      if (PIVOTS[key]) full.svgOrigin = PIVOTS[key];
      if (TRANSFORM_ORIGINS[key]) full.transformOrigin = TRANSFORM_ORIGINS[key];
      return tl.to(this.p[key], full, position);
    },

    _set: function (key, props) {
      if (!this.p[key]) return;
      var full = Object.assign({}, props);
      if (PIVOTS[key]) full.svgOrigin = PIVOTS[key];
      if (TRANSFORM_ORIGINS[key]) full.transformOrigin = TRANSFORM_ORIGINS[key];
      gsap.set(this.p[key], full);
    },

    /* ---------- chalk line prep (write gesture) ---------- */
    _prepareWriteLine: function () {
      var line = this.p.writeLine;
      if (!line) return;
      try {
        var len = line.getTotalLength();
        this._writeLen = len;
        gsap.set(line, { strokeDasharray: len, strokeDashoffset: len });
      } catch (e) {
        console.warn('ProfessorEngine: write line could not be measured, "write" gesture will skip the chalk effect.');
        this.p.writeLine = null;
      }
    },

    /* ---------- pose control ---------- */
    resetPose: function () {
      var self = this;
      Object.keys(NEUTRAL).forEach(function (key) { self._set(key, NEUTRAL[key]); });
    },

    _resetGestureParts: function () {
      var self = this;
      GESTURE_PARTS.forEach(function (key) { self._set(key, NEUTRAL[key]); });
      this._set('browLeft', NEUTRAL.browLeft);
      this._set('browRight', NEUTRAL.browRight);
      /* while speaking, the mouth belongs to the speak() flap loop — resetting
         it to NEUTRAL (opacity 0) here was hiding the mouth for the entire
         performance. Keep the talking mouth open instead. */
      if (this._speaking && this.p.mouthOpen) {
        this._set('mouthSmile', { opacity: 0 });
        this._set('mouthOpen', { opacity: 1, scaleY: 0.3 });
      } else {
        this._set('mouthOpen', NEUTRAL.mouthOpen);
      }
    },

    /* ---------- ambient life ---------- */
    startAmbient: function () {
      var self = this;
      if (this._dead) return;
      this.stopAmbient();

      /* breathing: torso swell */
      if (this.p.torso) {
        var breath = gsap.timeline({ repeat: -1, yoyo: true, defaults: { ease: 'sine.inOut' } });
        breath.to(this.p.torso, { scaleY: 1.025, duration: 1.6, transformOrigin: TRANSFORM_ORIGINS.torso })
              .to(this.p.head,   { y: 1.5, duration: 1.6 }, 0);
        this._ambientTLS.push(breath);
      }

      /* blinking: eyes squash */
      if (this.p.eyes) {
        var blink = gsap.timeline({ repeat: -1, repeatDelay: 3.2, defaults: { ease: 'power2.inOut' } });
        blink.set(this.p.eyes, { scaleY: 1, transformOrigin: TRANSFORM_ORIGINS.eyes })
             .to(this.p.eyes, { scaleY: 0.06, duration: 0.09 })
             .to(this.p.eyes, { scaleY: 1, duration: 0.09 });
        this._ambientTLS.push(blink);
      }

      /* tassel sway */
      if (this.p.tassel) {
        var sway = gsap.timeline({ repeat: -1, yoyo: true, defaults: { ease: 'sine.inOut' } });
        sway.to(this.p.tassel, { rotation: 7, duration: 1.9, svgOrigin: PIVOTS.tassel });
        this._ambientTLS.push(sway);
      }
    },

    stopAmbient: function () {
      this._ambientTLS.forEach(function (tl) { tl.kill(); });
      this._ambientTLS = [];
      if (this.p.torso)  gsap.set(this.p.torso, { scaleY: 1, y: 0, transformOrigin: TRANSFORM_ORIGINS.torso });
      if (this.p.eyes)  gsap.set(this.p.eyes, { scaleY: 1, transformOrigin: TRANSFORM_ORIGINS.eyes });
      if (this.p.head)  gsap.set(this.p.head, { y: 0 });
      if (this.p.tassel) gsap.set(this.p.tassel, { rotation: 0 });
    },

    /* ---------- main playback ---------- */
    play: function (name, opts) {
      if (this._dead) return null;
      opts = opts || {};
      var factory = this.animations[name];
      if (typeof factory !== 'function') {
        console.warn('ProfessorEngine: unknown animation "' + name + '". Available: ' + Object.keys(this.animations).join(', '));
        return null;
      }
      this.stopGesture();
      this._resetGestureParts();
      var tl = factory.call(this);
      if (!tl) return null;
      this._gestureTL = tl;
      if (opts.loop) tl.repeat(-1);
      tl.timeScale(this.speed);
      return tl;
    },

    stopGesture: function () {
      if (this._gestureTL) {
        this._gestureTL.kill();
        this._gestureTL = null;
      }
      this._resetGestureParts();
    },

    register: function (name, factory) {
      this.animations[name] = factory;
    },

    /* ---------- face ---------- */
    lookAt: function (nx, ny) {
      var x = Math.max(-1, Math.min(1, nx || 0)) * 8;
      var y = Math.max(-1, Math.min(1, ny || 0)) * 5;
      if (this.p.pupilLeft)  gsap.to(this.p.pupilLeft,  { x: x, y: y, duration: 0.3, ease: 'power2.out' });
      if (this.p.pupilRight) gsap.to(this.p.pupilRight, { x: x, y: y, duration: 0.3, ease: 'power2.out' });
    },

    expression: function (name) {
      if (this._dead) return;
      var s = this;
      function brows(l, r) {
        s._set('browLeft',  { y: l.y, rotation: l.r || 0 });
        s._set('browRight', { y: r.y, rotation: r.r || 0 });
      }
      switch (name) {
        case 'happy':
          brows({ y: -2 }, { y: -2 });
          s._set('mouthSmile', { scaleY: 1.25, opacity: 1 });
          break;
        case 'surprised':
          brows({ y: -8 }, { y: -8 });
          s._set('mouthSmile', { scaleY: 1.05, opacity: 1 });
          break;
        case 'thinking':
          brows({ y: -4 }, { y: 3, r: 8 });
          if (s.p.pupilLeft)  gsap.to(s.p.pupilLeft,  { x: -5, y: -4, duration: 0.3 });
          if (s.p.pupilRight) gsap.to(s.p.pupilRight, { x: -5, y: -4, duration: 0.3 });
          s._set('mouthSmile', { scaleY: 0.85, opacity: 1 });
          break;
        case 'angry':
          brows({ y: 6, r: -14 }, { y: 6, r: 14 });
          s._set('mouthSmile', { scaleY: 0.6, opacity: 1 });
          break;
        default: /* neutral */
          brows({ y: 0 }, { y: 0 });
          s._set('mouthSmile', { scaleY: 1, opacity: 1 });
          if (s.p.pupilLeft)  gsap.to(s.p.pupilLeft,  { x: 0, y: 0, duration: 0.3 });
          if (s.p.pupilRight) gsap.to(s.p.pupilRight, { x: 0, y: 0, duration: 0.3 });
      }
    },

    /* continuous mouth flap (independent of gestures) */
    speak: function (on) {
      if (this._dead) return;
      if (on === this._speaking) return;
      this._speaking = !!on;
      var open = this.p.mouthOpen, smile = this.p.mouthSmile;
      if (on) {
        if (!open) { console.warn('ProfessorEngine: #mouth-open missing, cannot speak.'); return; }
        this._set('mouthSmile', { opacity: 0 });
        this._set('mouthOpen', { opacity: 1, scaleY: 0.3 });
        this._speakTL = gsap.timeline({ repeat: -1, defaults: { ease: 'sine.inOut' } })
          .to(open, { scaleY: 1, duration: 0.11 })
          .to(open, { scaleY: 0.25, duration: 0.13 });
      } else {
        if (this._speakTL) { this._speakTL.kill(); this._speakTL = null; }
        this._set('mouthOpen', NEUTRAL.mouthOpen);
        this._set('mouthSmile', { opacity: 1 });
      }
    },

    setSpeed: function (v) {
      this.speed = Math.max(0.1, Math.min(4, v || 1));
      if (this._gestureTL) this._gestureTL.timeScale(this.speed);
      if (this._speakTL)   this._speakTL.timeScale(this.speed);
    },

    /* A deliberately small, bounded pose vocabulary for directors/LLMs.
       It never exposes arbitrary SVG attributes and every value animates back
       to NEUTRAL, so a creative cue cannot leave the rig distorted. */
    tweak: function (pose, opts) {
      if (this._dead || !pose || typeof pose !== 'object') return null;
      opts = opts || {};
      var self = this;
      var duration = Math.max(0.15, Math.min(1.2, Number(opts.duration) || 0.38));
      var hold = Math.max(0, Math.min(3, Number(opts.hold) || 0));
      var t = gsap.timeline({ defaults: { ease: 'power2.inOut' } });
      var used = [];
      function bounded(value, min, max) {
        value = Number(value);
        return isFinite(value) ? Math.max(min, Math.min(max, value)) : null;
      }
      function add(key, props) {
        props.duration = duration;
        self._to(t, key, props, 0);
        if (used.indexOf(key) === -1) used.push(key);
      }
      var value;
      if ((value = bounded(pose.headTilt, -18, 18)) !== null) add('head', { rotation: value });
      if ((value = bounded(pose.lean, -8, 8)) !== null) add('torso', { rotation: value });
      if ((value = bounded(pose.leftArm, -20, 170)) !== null) add('armLeft', { rotation: value });
      if ((value = bounded(pose.rightArm, -20, 175)) !== null) add('armRight', { rotation: value });
      if ((value = bounded(pose.bounce, -36, 0)) !== null) add('root', { y: value });
      if ((value = bounded(pose.smile, 0.65, 1.45)) !== null && !this._speaking) add('mouthSmile', { scaleY: value, opacity: 1 });
      if (pose.look && typeof pose.look === 'object') {
        var x = bounded(pose.look.x, -1, 1), y = bounded(pose.look.y, -1, 1);
        if (x !== null || y !== null) {
          var pupilProps = { x: (x === null ? 0 : x) * 8, y: (y === null ? 0 : y) * 5 };
          add('pupilLeft', Object.assign({}, pupilProps));
          add('pupilRight', Object.assign({}, pupilProps));
        }
      }
      if (!used.length) return null;
      var backAt = '>+' + hold;
      used.forEach(function (key) {
        if (key === 'mouthSmile') self._to(t, key, { scaleY: NEUTRAL.mouthSmile.scaleY, opacity: NEUTRAL.mouthSmile.opacity, duration: duration }, backAt);
        else self._to(t, key, Object.assign({ duration: duration }, NEUTRAL[key]), backAt);
      });
      t.timeScale(this.speed);
      return t;
    },

    destroy: function () {
      this._dead = true;
      this.stopGesture();
      this.stopAmbient();
      this.speak(false);
      this.resetPose();
    },

    /* ------------------------------------------------------------------ *
     * PREMADE ANIMATIONS — each returns a timeline, starts+ends at NEUTRAL
     * ------------------------------------------------------------------ */
    _premade: function () {
      var self = this;

      return {

        /* lecture gestures: arm pumps + head sway + mouth pulses */
        explain: function () {
          var t = gsap.timeline({ defaults: { ease: 'power2.inOut', duration: 0.5 } });
          self._to(t, 'armRight', { rotation: 125, duration: 0.55 });
          self._to(t, 'head',     { rotation: -6 }, '<');
          self._to(t, 'browLeft',  { y: -4, duration: 0.3 }, '<');
          self._to(t, 'browRight', { y: -4, duration: 0.3 }, '<');
          /* 3 gesture beats */
          self._to(t, 'armRight', { rotation: 100, duration: 0.35, yoyo: true, repeat: 3, ease: 'power1.inOut' }, '>0.15');
          self._to(t, 'head',     { rotation: 5,  duration: 0.7,  yoyo: true, repeat: 1, ease: 'power1.inOut' }, '<');
          self._to(t, 'pupilLeft',  { x: -4, duration: 0.4 }, '<');
          self._to(t, 'pupilRight', { x: -4, duration: 0.4 }, '<');
          /* talk pulses */
          if (self.p.mouthOpen) {
            t.set(self.p.mouthOpen, { opacity: 1, scaleY: 0.3 }, '<');
            t.to(self.p.mouthOpen, { scaleY: 1, duration: 0.12, repeat: 5, yoyo: true, transformOrigin: TRANSFORM_ORIGINS.mouthOpen }, '<');
          }
          /* return to neutral — but never hide the mouth while the voice is
             still playing; speak()'s flap loop owns it then */
          if (!self._speaking) t.set(self.p.mouthOpen, { opacity: 0 }, '>-0.1');
          self._to(t, 'armRight', { rotation: 0 });
          self._to(t, 'head',     { rotation: 0 }, '<');
          self._to(t, 'browLeft',  { y: 0 }, '<');
          self._to(t, 'browRight', { y: 0 }, '<');
          self._to(t, 'pupilLeft',  { x: 0 }, '<');
          self._to(t, 'pupilRight', { x: 0 }, '<');
          return t;
        },

        /* extends pointer at the board, holds */
        point: function () {
          var t = gsap.timeline({ defaults: { ease: 'power3.inOut' } });
          self._to(t, 'armRight', { rotation: 138, duration: 0.6 });
          self._to(t, 'head',     { rotation: -4, duration: 0.6 }, '<');
          self._to(t, 'pupilLeft',  { x: -6, y: -2, duration: 0.4 }, '<');
          self._to(t, 'pupilRight', { x: -6, y: -2, duration: 0.4 }, '<');
          /* two emphasis nudges */
          self._to(t, 'armRight', { rotation: 146, duration: 0.22, yoyo: true, repeat: 3, ease: 'power1.inOut' }, '>0.4');
          self._to(t, 'armRight', { rotation: 0, duration: 0.6 }, '>0.5');
          self._to(t, 'head',     { rotation: 0, duration: 0.6 }, '<');
          self._to(t, 'pupilLeft',  { x: 0, y: 0, duration: 0.4 }, '<');
          self._to(t, 'pupilRight', { x: 0, y: 0, duration: 0.4 }, '<');
          return t;
        },

        /* writes on the chalkboard (stroke-dash draw-on) */
        write: function () {
          var t = gsap.timeline({ defaults: { ease: 'power2.inOut' } });
          /* fresh chalk line each time */
          if (self.p.writeLine && self._writeLen) {
            gsap.set(self.p.writeLine, { strokeDashoffset: self._writeLen });
          }
          self._to(t, 'armRight', { rotation: 148, duration: 0.55 });
          self._to(t, 'head',     { rotation: -7, duration: 0.55 }, '<');
          self._to(t, 'pupilLeft',  { x: -7, duration: 0.4 }, '<');
          self._to(t, 'pupilRight', { x: -7, duration: 0.4 }, '<');
          /* scribble motion while the line draws */
          self._to(t, 'armRight', { rotation: 138, duration: 0.18, yoyo: true, repeat: 9, ease: 'sine.inOut' }, '>0.1');
          if (self.p.writeLine && self._writeLen) {
            t.to(self.p.writeLine, { strokeDashoffset: 0, duration: 1.7, ease: 'none' }, '<');
          }
          self._to(t, 'armRight', { rotation: 0, duration: 0.6 }, '>0.2');
          self._to(t, 'head',     { rotation: 0, duration: 0.6 }, '<');
          self._to(t, 'pupilLeft',  { x: 0, duration: 0.4 }, '<');
          self._to(t, 'pupilRight', { x: 0, duration: 0.4 }, '<');
          return t;
        },

        /* thinking pose: arm out, head tilt, eyes up-left */
        think: function () {
          var t = gsap.timeline({ defaults: { ease: 'power2.inOut' } });
          self._to(t, 'armLeft', { rotation: 25, duration: 0.5 });
          self._to(t, 'head',    { rotation: 7, duration: 0.5 }, '<');
          self._to(t, 'browLeft',  { y: -4, duration: 0.4 }, '<');
          self._to(t, 'browRight', { y: 3, rotation: 8, duration: 0.4 }, '<');
          self._to(t, 'pupilLeft',  { x: -5, y: -4, duration: 0.5 }, '<');
          self._to(t, 'pupilRight', { x: -5, y: -4, duration: 0.5 }, '<');
          /* hold + look away then back */
          self._to(t, 'pupilLeft',  { x: -7, y: -5, duration: 0.8 }, '>0.6');
          self._to(t, 'pupilRight', { x: -7, y: -5, duration: 0.8 }, '<');
          self._to(t, 'armLeft', { rotation: 0, duration: 0.5 }, '>0.8');
          self._to(t, 'head',    { rotation: 0, duration: 0.5 }, '<');
          self._to(t, 'browLeft',  { y: 0, rotation: 0 }, '<');
          self._to(t, 'browRight', { y: 0, rotation: 0 }, '<');
          self._to(t, 'pupilLeft',  { x: 0, y: 0 }, '<');
          self._to(t, 'pupilRight', { x: 0, y: 0 }, '<');
          return t;
        },

        /* friendly wave */
        wave: function () {
          var t = gsap.timeline({ defaults: { ease: 'power2.inOut' } });
          self._to(t, 'armLeft', { rotation: 150, duration: 0.55 });
          self._to(t, 'head',    { rotation: -4, duration: 0.55 }, '<');
          self._to(t, 'browLeft',  { y: -3, duration: 0.3 }, '<');
          self._to(t, 'browRight', { y: -3, duration: 0.3 }, '<');
          if (self.p.mouthSmile) {
            t.to(self.p.mouthSmile, { scaleY: 1.3, duration: 0.3, transformOrigin: TRANSFORM_ORIGINS.mouthSmile }, '<');
          }
          self._to(t, 'armLeft', { rotation: 162, duration: 0.18, yoyo: true, repeat: 5, ease: 'sine.inOut' }, '>0.1');
          self._to(t, 'armLeft', { rotation: 0, duration: 0.6 }, '>0.15');
          self._to(t, 'head',    { rotation: 0, duration: 0.6 }, '<');
          self._to(t, 'browLeft',  { y: 0 }, '<');
          self._to(t, 'browRight', { y: 0 }, '<');
          if (self.p.mouthSmile) {
            t.to(self.p.mouthSmile, { scaleY: 1, duration: 0.3, transformOrigin: TRANSFORM_ORIGINS.mouthSmile }, '<');
          }
          return t;
        },

        /* yes-nod */
        nod: function () {
          var t = gsap.timeline({ defaults: { ease: 'power2.inOut' } });
          self._to(t, 'head', { y: 7, rotation: 2, duration: 0.18, yoyo: true, repeat: 3 }, '>0.05');
          self._to(t, 'head', { y: 0, rotation: 0, duration: 0.2 });
          return t;
        },

        /* no-shake */
        shake: function () {
          var t = gsap.timeline({ defaults: { ease: 'power2.inOut' } });
          self._to(t, 'head', { rotation: 8, duration: 0.2, yoyo: true, repeat: 5 });
          self._to(t, 'head', { rotation: 0, duration: 0.2 });
          return t;
        },

        /* short burst of talking (mouth + head bob + small hand motion) */
        talk: function () {
          var t = gsap.timeline({ defaults: { ease: 'sine.inOut' } });
          if (self.p.mouthOpen) {
            t.set(self.p.mouthOpen, { opacity: 1, scaleY: 0.3, transformOrigin: TRANSFORM_ORIGINS.mouthOpen });
            t.to(self.p.mouthOpen, { scaleY: 1, duration: 0.11, repeat: 9, yoyo: true });
            /* hide the talking mouth at gesture end — but NOT while the voice is
               still playing (speak() owns the mouth then) */
            if (!self._speaking) t.set(self.p.mouthOpen, { opacity: 0 });
          }
          self._to(t, 'head', { y: -3, duration: 0.4, yoyo: true, repeat: 2 }, 0);
          self._to(t, 'armRight', { rotation: 12, duration: 0.5, yoyo: true, repeat: 2 }, 0);
          self._to(t, 'head', { y: 0, duration: 0.3 }, '>0.1');
          self._to(t, 'armRight', { rotation: 0, duration: 0.3 }, '<');
          return t;
        },

        /* pupils sweep */
        lookAround: function () {
          var t = gsap.timeline({ defaults: { ease: 'power2.inOut' } });
          self._to(t, 'pupilLeft',  { x: -7, duration: 0.45 }, '>0.3');
          self._to(t, 'pupilRight', { x: -7, duration: 0.45 }, '<');
          self._to(t, 'pupilLeft',  { x: 7, duration: 0.9 }, '>0.35');
          self._to(t, 'pupilRight', { x: 7, duration: 0.9 }, '<');
          self._to(t, 'head', { rotation: -3, duration: 0.9 }, '<');
          self._to(t, 'pupilLeft',  { x: 0, duration: 0.4 }, '>0.3');
          self._to(t, 'pupilRight', { x: 0, duration: 0.4 }, '<');
          self._to(t, 'head', { rotation: 0, duration: 0.4 }, '<');
          return t;
        },

        /* eureka! jump + arms up + tassel swing */
        celebrate: function () {
          var t = gsap.timeline({ defaults: { ease: 'power2.inOut' } });
          self._to(t, 'armLeft',  { rotation: 165, duration: 0.45, ease: 'back.out(2)' });
          self._to(t, 'armRight', { rotation: 172, duration: 0.45, ease: 'back.out(2)' }, '<');
          self._to(t, 'browLeft',  { y: -5, duration: 0.3 }, '<');
          self._to(t, 'browRight', { y: -5, duration: 0.3 }, '<');
          if (self.p.mouthSmile) {
            t.to(self.p.mouthSmile, { scaleY: 1.4, duration: 0.3, transformOrigin: TRANSFORM_ORIGINS.mouthSmile }, '<');
          }
          /* jump squash-and-stretch */
          self._to(t, 'root', { y: -46, duration: 0.42, ease: 'power2.out' }, '>0.05');
          self._to(t, 'root', { y: 0, duration: 0.42, ease: 'bounce.out' });
          self._to(t, 'tassel', { rotation: 22, duration: 0.3, yoyo: true, repeat: 3 }, '<');
          /* hold briefly, then settle */
          self._to(t, 'armLeft',  { rotation: 0, duration: 0.55 }, '>0.25');
          self._to(t, 'armRight', { rotation: 0, duration: 0.55 }, '<');
          self._to(t, 'browLeft',  { y: 0 }, '<');
          self._to(t, 'browRight', { y: 0 }, '<');
          if (self.p.mouthSmile) {
            t.to(self.p.mouthSmile, { scaleY: 1, duration: 0.3, transformOrigin: TRANSFORM_ORIGINS.mouthSmile }, '<');
          }
          return t;
        }
      };
    }
  };

  /* expose */
  ProfessorEngine.version = '1.0.0';
  global.ProfessorEngine = ProfessorEngine;
  if (typeof module !== 'undefined' && module.exports) module.exports = ProfessorEngine;
})(typeof window !== 'undefined' ? window : globalThis);
