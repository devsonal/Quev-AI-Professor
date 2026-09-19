(function () {
  'use strict';
  var engine, director;
  var log = document.getElementById('chat-log');
  var status = document.getElementById('status');
  var form = document.getElementById('ask-form');
  var input = document.getElementById('ask-input');
  var provider = document.getElementById('provider');
  var key = document.getElementById('api-key');
  var model = document.getElementById('model');

  function setStatus(message, type) {
    status.textContent = message;
    status.style.color = type === 'err' ? '#bd3c46' : '';
  }
  function message(role, text) {
    if (!text) return;
    var article = document.createElement('article');
    article.className = 'message ' + role;
    var label = document.createElement('span');
    label.textContent = role === 'user' ? 'You' : 'Professor';
    var body = document.createElement('p');
    body.textContent = text;
    article.appendChild(label); article.appendChild(body); log.appendChild(article);
    log.scrollTop = log.scrollHeight;
  }
  function spokenText(plan) {
    var lines = [];
    [plan.say].concat((plan.steps || []).map(function (step) { return step.say; })).forEach(function (line) {
      line = String(line || '').trim();
      if (line && lines.indexOf(line) === -1) lines.push(line);
    });
    return lines.join('\n\n');
  }
  function settingsForCurrentProvider() {
    var id = provider.value;
    key.value = localStorage.getItem('hackthon_v5_key_' + id) || '';
    model.value = localStorage.getItem('hackthon_v5_model_' + id) || '';
    director.setProvider(id); director.setKey(key.value); director.setModel(model.value || null);
  }
  function loadModels() {
    model.innerHTML = '<option value="">Loading models…</option>';
    director.models().then(function (models) {
      model.innerHTML = '<option value="">Automatic</option>';
      models.slice(0, 40).forEach(function (item) {
        var option = document.createElement('option'); option.value = item.id; option.textContent = item.name; model.appendChild(option);
      });
      model.value = localStorage.getItem('hackthon_v5_model_' + provider.value) || '';
      director.setModel(model.value || null);
    }).catch(function () { model.innerHTML = '<option value="">Automatic (offline list)</option>'; });
  }
  function bootStage() {
    return fetch('professor.svg').then(function (response) {
      if (!response.ok) throw new Error('Professor artwork could not load');
      return response.text();
    }).then(function (source) {
      var parsed = new DOMParser().parseFromString(source, 'image/svg+xml');
      var original = parsed.documentElement;
      var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('viewBox', '0 0 800 600'); svg.setAttribute('role', 'img'); svg.setAttribute('aria-label', 'Professor with chalkboard');
      /* The board and professor are extracted from the source artwork as separate sibling layers. */
      var defs = original.querySelector('defs'); if (defs) svg.appendChild(document.importNode(defs, true));
      var professor = original.querySelector('#professor');
      Array.prototype.forEach.call(original.children, function (node) {
        if (node !== defs && node !== professor) svg.appendChild(document.importNode(node, true));
      });
      svg.appendChild(document.importNode(professor, true));
      document.getElementById('stage-holder').replaceChildren(svg);
      engine = new ProfessorEngine('#professor');
    });
  }
  function bootDirector() {
    director = new AIStageDirector({
      getEngine: function () { return engine; },
      onStatus: setStatus,
      /* Uses the best installed male English voice, then makes it lower and more deliberate. */
      voice: { preferred: /david|guy|daniel|mark|george|james|male/i, rate: 0.90, pitch: 0.72 }
    });
    /* Render just the natural-language speech; the JSON plan never enters the chat. */
    var perform = director._perform;
    director._perform = function (plan) { message('professor', spokenText(plan) || 'Let me show you.'); return perform.call(this, plan); };
    settingsForCurrentProvider();
  }
  function loadGsap() {
    if (window.gsap) return Promise.resolve();
    return new Promise(function (resolve, reject) {
      var script = document.createElement('script'); script.src = 'https://cdn.jsdelivr.net/npm/gsap@3.12.5/dist/gsap.min.js'; script.onload = resolve; script.onerror = reject; document.head.appendChild(script);
    });
  }
  document.getElementById('settings-toggle').addEventListener('click', function () {
    var panel = document.getElementById('settings'); panel.hidden = !panel.hidden; this.setAttribute('aria-expanded', String(!panel.hidden));
  });
  provider.addEventListener('change', function () { settingsForCurrentProvider(); loadModels(); });
  key.addEventListener('change', function () { localStorage.setItem('hackthon_v5_key_' + provider.value, key.value); director.setKey(key.value); });
  model.addEventListener('change', function () { localStorage.setItem('hackthon_v5_model_' + provider.value, model.value); director.setModel(model.value || null); });
  document.getElementById('refresh-models').addEventListener('click', loadModels);
  form.addEventListener('submit', function (event) { event.preventDefault(); var text = input.value.trim(); if (!text || !director) return; input.value = ''; message('user', text); director.chat(text); });
  loadGsap().then(function () { return bootStage(); }).then(function () { bootDirector(); setStatus('Ready to help'); }).catch(function (error) { setStatus(error.message || 'Unable to start', 'err'); });
})();
