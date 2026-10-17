// Served at /assets/fax.js. The page's CSP allows only same-origin scripts, so this can't be inline.
// It reads a reply link's fragment, fills in the form and removes the fragment. It never sends anything:
// the reply goes out only when the person clicks Send.
export const CLIENT_JS = `(function () {
  var form = document.getElementById('reply-form');
  // Runs on load, and again when a reply link is opened on a page that's already open:
  // browsers then only change the fragment and don't reload.
  function prefill() {
    if (apply(location.hash.slice(1))) history.replaceState(null, '', location.pathname + location.search);
  }
  // Fills the form from a reply fragment. Returns true if anything was filled.
  function apply(raw) {
  if (form && raw) {
    var filled = 0;
    raw.split('&').forEach(function (pair) {
      var i = pair.indexOf('=');
      if (i < 1) return;
      var id = pair.slice(0, i), value;
      try { value = decodeURIComponent(pair.slice(i + 1)); } catch (e) { return; }
      var fields = form.querySelectorAll('[name="' + CSS.escape(id) + '"]');
      var ok = false;
      fields.forEach(function (el) {
        if (el.type === 'radio') { if (el.value === value) { el.checked = true; ok = true; } }
        else { el.value = value; ok = true; }
      });
      if (ok) {
        filled++;
        var tag = form.querySelector('[data-filled-for="' + CSS.escape(id) + '"]');
        if (tag) tag.hidden = false;
      }
    });
    if (filled) {
      document.getElementById('prefill-banner').hidden = false;
      var ask = document.getElementById('ask-row');
      if (ask) ask.hidden = true;
    }
    if (filled) form.scrollIntoView({ block: 'start' });
    return filled > 0;
  }
  return false;
  }
  prefill();
  addEventListener('hashchange', prefill);

  // When a pasted reply names exactly one option of an unanswered choice, pick it and say so.
  // Never overrides a choice the person made.
  var box = form && form.querySelector('textarea[name="message"]');
  if (box) {
    box.addEventListener('input', function () {
      var text = box.value.toLowerCase();
      var groups = {};
      form.querySelectorAll('input[type="radio"]').forEach(function (r) { (groups[r.name] = groups[r.name] || []).push(r); });
      Object.keys(groups).forEach(function (name) {
        var radios = groups[name];
        if (radios.some(function (r) { return r.checked; })) return;
        var hits = radios.filter(function (r) {
          var word = r.value.toLowerCase().replace(/[.*+?^\${}()|[\\]\\\\]/g, '\\\\$&');
          return new RegExp('(^|[^\\\\p{L}\\\\p{N}])' + word + '($|[^\\\\p{L}\\\\p{N}])', 'u').test(text);
        });
        if (hits.length !== 1) return;
        hits[0].checked = true;
        var tag = form.querySelector('[data-picked-for="' + CSS.escape(name) + '"]');
        if (tag) tag.hidden = false;
      });
    });
  }

  // A reply needs the required answers or a message in the box. Got it is always fine.
  // The server checks the same thing; this just says it without a round trip.
  if (form) {
    var required = [];
    try { required = JSON.parse(form.getAttribute('data-required') || '[]'); } catch (e) {}
    form.addEventListener('submit', function (e) {
      if (e.submitter && e.submitter.name === 'ack') return;
      var note = document.getElementById('form-note');
      var message = form.querySelector('[name="message"]');
      if (message && message.value.trim()) return;
      var data = new FormData(form);
      var missing = required.filter(function (q) { return !String(data.get(q.id) || '').trim(); })[0];
      var answered = Array.from(data.entries()).some(function (p) { return p[0] !== 'message' && String(p[1]).trim(); });
      if (missing) { e.preventDefault(); note.textContent = 'Answer \\u201c' + missing.label + '\\u201d, or type a reply in the box.'; }
      else if (!answered) { e.preventDefault(); note.textContent = 'Type a reply in the box first.'; }
    });
  }

  // Size the sender frame to its content. Only a height number is accepted, and only from that frame.
  var frame = document.querySelector('.frame iframe');
  if (frame) {
    addEventListener('message', function (e) {
      var d = e.data;
      if (e.source !== frame.contentWindow || !d || d.type !== 'agentfax:height' || typeof d.height !== 'number' || !isFinite(d.height)) return;
      frame.style.minHeight = '0';
      frame.style.height = Math.max(60, Math.min(8000, Math.round(d.height))) + 'px';
    });
  }
  var button = document.getElementById('ask-ai');
  if (button) {
    button.hidden = false;
    button.addEventListener('click', function () {
      var prompt = button.getAttribute('data-prompt');
      var note = document.getElementById('ask-note');
      navigator.clipboard.writeText(prompt).then(
        function () { note.textContent = 'Copied. Paste it into your AI.'; },
        function () { note.textContent = prompt; }
      );
    });
  }
})();
`
