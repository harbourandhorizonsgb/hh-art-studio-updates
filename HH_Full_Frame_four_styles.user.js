// ==UserScript==
// @name         H&H Full Frame – 4 Style Maker for ChatGPT
// @namespace    harbourandhorizonsgb
// @version      2.3
// @description  The Full Frame Studio's twin of the Art Studio's 5 Style Maker: a panel on ChatGPT where you type the place and choose your photo; it makes the four full-frame styles (Cubism, Line Drawing, Japanese Woodblock, Sumi Ink Wash) one after another and saves each to Downloads as a JPEG for the H&H Full Frame Studio.
// @match        https://chatgpt.com/*
// @run-at       document-idle
// @grant        GM_xmlhttpRequest
// @connect      *
// @updateURL    https://raw.githubusercontent.com/harbourandhorizonsgb/hh-art-studio-updates/main/HH_Full_Frame_four_styles.user.js
// @downloadURL  https://raw.githubusercontent.com/harbourandhorizonsgb/hh-art-studio-updates/main/HH_Full_Frame_four_styles.user.js
// ==/UserScript==
/* Made from the Art Studio's own script (hh-chatgpt 1.3, James, 23 Nov 2026: "work like the art studio … where the image is
   uploaded with place and county"). Its own panel (#hhff-panel, bottom right like the Art Studio's; 2.1, James: no county field, panel on the right; 2.2: no Get place from the app, no artist names or seal stamp in the prompts – ChatGPT refused Sumi over "similarity to third-party content"). No facts – the Full Frame prints have none. */

(function () {
  'use strict';

  // ---------------------------------------------------------------------------
  // STYLE PROMPTS – edit these freely. "key" is used in the filename.
  // ---------------------------------------------------------------------------
  function common(place) {
    const where = place ? place + ', England' : 'the place';
    return [
      'Using the photograph of ' + where + ' I uploaded at the start of this chat, create ONE new image.',
      'Format: portrait 2:3 (1024x1536).',
      'Intelligently recompose the landscape photo into portrait – no stretching, squashing or matting – while keeping the location instantly recognisable: same architecture, landmarks, perspective, lighting, proportions and character.',
      'FULL FRAME: the artwork must fill the whole canvas edge to edge – NO border, margin, white space, frame, text, title, caption, signature, watermark or logo anywhere on the image.',
      'Do not ask me any questions and do not describe the image – just generate it.'
    ].join(' ');
  }

  // "key" goes in the file name – the Full Frame Studio reads the style from it (keep these words)
  const STYLES = [
    {
      key: 'Cubism',
      plain: 'Style: a cubist-style painting made of simple geometric shapes and bold colour.',
      name: 'Cubism',
      prompt: 'Style: an original Cubist-style painting – the scene broken into bold geometric planes and facets, seen from several angles at once, strong outlines, a rich but limited palette. It must still clearly be this place.'
    },
    {
      key: 'Line_Drawing',
      plain: 'Style: a simple black pen line drawing on white paper.',
      name: 'Line Drawing',
      prompt: 'Style: a clean black ink line drawing on a plain white background, the drawing running right to the edges of the picture – lines only, NO colour, NO shading, NO grey fills. Elegant varied line weight, accurate detail on buildings and landmarks.'
    },
    {
      key: 'Japanese_Woodblock',
      plain: 'Style: a flat-colour woodblock-print style artwork with clean outlines.',
      name: 'Japanese Woodblock',
      prompt: 'Style: an original Japanese woodblock-print style artwork – flat areas of colour, crisp black key lines, subtle colour gradients in the sky and water, visible paper texture. No Japanese writing or seals.'
    },
    {
      key: 'Sumi_Ink_Wash',
      plain: 'Style: a black and grey ink-wash painting with soft brush strokes.',
      name: 'Sumi Ink Wash',
      prompt: 'Style: a Japanese sumi ink painting – black and grey ink ONLY on off-white rice paper, bold expressive brush strokes and soft washes reaching the edges of the picture, NO colour, no stamps or seals.'
    }
  ];

  const PER_IMAGE_TIMEOUT_MS = 6 * 60 * 1000; // 6 minutes per style
  const JPEG_QUALITY = 0.95;

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  let stopRequested = false;
  let running = false;

  function store(key, val) {
    try {
      if (val === undefined) return localStorage.getItem('hhff_' + key);
      localStorage.setItem('hhff_' + key, val);
    } catch (e) { return null; }
  }

  function composer() {
    return document.querySelector('#prompt-textarea') ||
      document.querySelector('div[contenteditable="true"][role="textbox"]') ||
      document.querySelector('form textarea');
  }

  function sendButton() {
    return document.querySelector('button[data-testid="send-button"]') ||
      document.querySelector('#composer-submit-button') ||
      document.querySelector('button[aria-label="Send prompt"]') ||
      document.querySelector('form button[type="submit"]') ||
      [...document.querySelectorAll('button')].find((b) =>
        !b.closest('#hhff-panel') && !b.closest('#hh-panel') && /^send/i.test(b.getAttribute('aria-label') || ''));
  }

  function composerText() {
    const el = composer();
    if (!el) return '';
    return (el.tagName === 'TEXTAREA' ? el.value : el.textContent || '').trim();
  }

  // Attach a photo chosen in the panel to ChatGPT's message box.
  async function attachPhoto(file) {
    const dt = new DataTransfer();
    dt.items.add(file);
    // 1) ChatGPT's own (hidden) file input
    const inputs = [...document.querySelectorAll('input[type="file"]')]
      .filter((i) => !i.closest('#hhff-panel') && !i.closest('#hh-panel') && (!i.accept || /image|\*/.test(i.accept)));
    if (inputs.length) {
      const inp = inputs[0];
      inp.files = dt.files;
      inp.dispatchEvent(new Event('change', { bubbles: true }));
      return 'upload';
    }
    // 2) Paste it into the message box
    const el = composer();
    if (!el) throw new Error('Could not find the ChatGPT message box – are you logged in?');
    el.focus();
    el.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: dt }));
    await sleep(500);
    // 3) Drop it onto the message box
    const drop = (type) => el.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt }));
    drop('dragenter'); drop('dragover'); drop('drop');
    return 'paste';
  }

  function isBusy() {
    return !!document.querySelector('button[data-testid="stop-button"], button[aria-label="Stop streaming"], button[aria-label="Stop generating"]');
  }

  function generatedImages() {
    return [...document.querySelectorAll('main img')].filter((img) => {
      if (img.closest('#hhff-panel') || img.closest('#hh-panel')) return false;
      if (img.closest('[data-message-author-role="user"]')) return false; // your uploaded photo
      const alt = (img.alt || '').toLowerCase();
      const src = img.src || '';
      return alt.includes('generated image') ||
        /estuary|oaiusercontent|files\.openai/.test(src);
    });
  }

  async function typePrompt(text) {
    const el = composer();
    if (!el) throw new Error('Could not find the ChatGPT message box.');
    el.focus();
    if (el.tagName === 'TEXTAREA') {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
      setter.call(el, text);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    } else {
      document.execCommand('selectAll', false, null);
      document.execCommand('insertText', false, text);
    }
    await sleep(600);
  }

  async function clickSend() {
    for (let i = 0; i < 30; i++) {
      const btn = sendButton();
      if (btn && !btn.disabled && btn.getAttribute('aria-disabled') !== 'true') { btn.click(); return; }
      await sleep(500); // e.g. photo still uploading
    }
    // Fallback: press Enter in the message box
    const el = composer();
    if (!el) throw new Error('Could not find the ChatGPT message box – are you logged in?');
    el.focus();
    const opts = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true };
    el.dispatchEvent(new KeyboardEvent('keydown', opts));
    el.dispatchEvent(new KeyboardEvent('keyup', opts));
    await sleep(2000);
    if (isBusy() || composerText() === '') return;
    throw new Error('Could not send the message (no Send button found and Enter did nothing).');
  }

  // ChatGPT's replies (to spot a refusal such as "…may violate our guardrails…").
  function assistantReplies() {
    return [...document.querySelectorAll('[data-message-author-role="assistant"]')].filter((el) => !el.closest('#hhff-panel') && !el.closest('#hh-panel'));
  }
  const REFUSAL = /(we['’]re so sorry|i['’]m sorry|violate|guardrail|content polic|can['’]t (help|create|generate|make)|unable to (create|generate|make)|not able to (create|generate|make))/i;

  async function waitForNewImage(beforeEls, beforeSrcs, beforeReplies) {
    const start = Date.now();
    let lastSrc = '';
    let stableSince = 0;
    let refusedSince = 0;
    // give ChatGPT a moment to start
    await sleep(3000);
    while (Date.now() - start < PER_IMAGE_TIMEOUT_MS) {
      if (stopRequested) throw new Error('Stopped by you.');
      const fresh = generatedImages().filter((img) =>
        !beforeEls.has(img) && !beforeSrcs.has(img.src) && img.complete && img.naturalWidth >= 512);
      const latest = fresh[fresh.length - 1];
      if (latest && !isBusy()) {
        if (latest.src !== lastSrc) { lastSrc = latest.src; stableSince = Date.now(); }
        else if (Date.now() - stableSince > 4000) return latest; // finished & stable
      } else if (!latest && !isBusy()) {
        const replies = assistantReplies();
        const txt = replies.length > beforeReplies ? (replies[replies.length - 1].innerText || '') : '';
        if (txt && REFUSAL.test(txt)) {
          if (!refusedSince) refusedSince = Date.now();
          else if (Date.now() - refusedSince > 4000) {
            const e = new Error('ChatGPT refused: "' + txt.trim().slice(0, 120) + '"');
            e.refused = true;
            throw e;
          }
        } else refusedSince = 0;
      }
      await sleep(1500);
    }
    throw new Error('Timed out waiting for the image (ChatGPT may have hit a limit or refused).');
  }

  function gmFetchBlob(url) {
    return new Promise((resolve, reject) => {
      if (typeof GM_xmlhttpRequest !== 'function') return reject(new Error('no GM_xmlhttpRequest'));
      GM_xmlhttpRequest({
        method: 'GET', url, responseType: 'blob', anonymous: false,
        onload: (r) => (r.status >= 200 && r.status < 300 ? resolve(r.response) : reject(new Error('HTTP ' + r.status))),
        onerror: () => reject(new Error('Network error'))
      });
    });
  }

  async function getImageBlob(img) {
    try {
      const r = await fetch(img.src, { credentials: 'include' });
      if (r.ok) return await r.blob();
    } catch (e) { /* fall through */ }
    return await gmFetchBlob(img.src);
  }

  async function toJpeg(blob) {
    const bmp = await createImageBitmap(blob);
    const c = document.createElement('canvas');
    c.width = bmp.width; c.height = bmp.height;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(bmp, 0, 0);
    return await new Promise((res) => c.toBlob(res, 'image/jpeg', JPEG_QUALITY));
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  function cleanLocation(s) {
    return s.trim()
      .replace(/[^A-Za-z0-9 ]+/g, ' ')
      .split(/\s+/).filter(Boolean)
      .map((w) => w[0].toUpperCase() + w.slice(1))
      .join('');
  }

  // ---------------------------------------------------------------------------
  // Main run
  // ---------------------------------------------------------------------------
  async function run() {
    if (running) return;
    const loc = cleanLocation(ui.loc.value || '');
    if (!loc) { log('Enter a location name first.'); return; }
    const chosen = STYLES.filter((s) => ui.checks[s.key].checked);
    if (!chosen.length) { log('Tick at least one style.'); return; }

    store('loc', ui.loc.value);
    STYLES.forEach((s) => store('style_' + s.key, ui.checks[s.key].checked ? '1' : '0'));

    if (!composer()) { log('✗ Can\'t find the ChatGPT message box. Make sure you are logged in and on a normal chat page.'); return; }
    if (!ui.photo && !confirm('No photo chosen in this panel.\n\nHave you already attached your photo to the chat some other way?')) return;

    running = true; stopRequested = false; setRunning(true);
    let ok = 0;
    if (ui.photo) {
      try {
        log('Attaching photo…');
        await attachPhoto(ui.photo);
        await sleep(5000); // let it upload
      } catch (e) {
        log('✗ ' + e.message);
        running = false; setRunning(false);
        return;
      }
    }
    const redo = [];
    for (let i = 0; i < chosen.length; i++) {
      const s = chosen[i];
      if (stopRequested) break;
      // a refusal is tried once more in plainer words, then the next style carries on (James, 23 Nov 2026)
      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          log(`(${i + 1}/${chosen.length}) ${s.name}: ${attempt === 1 ? 'sending prompt…' : 'trying again in plainer words…'}`);
          const beforeEls = new Set(generatedImages());
          const beforeSrcs = new Set([...beforeEls].map((im) => im.src));
          const beforeReplies = assistantReplies().length;
          await typePrompt(common(ui.loc.value.trim()) + ' ' + (attempt === 1 ? s.prompt : s.plain));
          await clickSend();
          log(`(${i + 1}/${chosen.length}) ${s.name}: generating…`);
          const img = await waitForNewImage(beforeEls, beforeSrcs, beforeReplies);
          const raw = await getImageBlob(img);
          const jpg = await toJpeg(raw);
          const name = `${loc}_${s.key}.jpg`;
          downloadBlob(jpg, name);
          ok++;
          log(`✓ Saved ${name}`);
          await sleep(2500);
          break;
        } catch (e) {
          log(`✗ ${s.name}: ${e.message}`);
          if (stopRequested) break;
          if (e.refused && attempt === 1) { await sleep(2000); continue; }
          redo.push(s.name);
          if (!e.refused && ok === 0 && i === 0) { log('Stopping – the first style failed, so the rest would too.'); i = chosen.length; }
          break;
        }
      }
    }
    ui.photo = null; ui.photoName.textContent = 'No photo chosen';
    log(`Done – ${ok} of ${chosen.length} saved to Downloads – the Full Frame Studio collects them.`);
    if (redo.length) log(`Still to make: ${redo.join(', ')}. Tick only ${redo.length > 1 ? 'those' : 'that one'} and press Make styles again – a new chat (with the photo chosen again) often helps.`);
    running = false; setRunning(false);
  }

  // ---------------------------------------------------------------------------
  // Panel UI
  // ---------------------------------------------------------------------------
  const ui = { checks: {} };

  function log(msg) {
    const t = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    ui.log.textContent = `[${t}] ${msg}\n` + ui.log.textContent;
  }

  function setRunning(on) {
    ui.start.disabled = on;
    ui.stop.disabled = !on;
    ui.start.textContent = on ? 'Working…' : 'Make styles';
  }

  function buildPanel() {
    if (document.getElementById('hhff-panel')) return;
    const p = document.createElement('div');
    p.id = 'hhff-panel';
    p.innerHTML = `
      <style>
        #hhff-panel{position:fixed;right:16px;bottom:90px;z-index:99999;width:270px;
          background:#13243a;color:#f3efe6;border-radius:12px;box-shadow:0 8px 28px rgba(0,0,0,.35);
          font:13px/1.4 system-ui,Segoe UI,sans-serif}
        #hhff-panel header{display:flex;justify-content:space-between;align-items:center;
          padding:10px 12px;cursor:pointer;font-weight:600;border-bottom:1px solid rgba(255,255,255,.12)}
        #hhff-panel .hh-body{padding:10px 12px}
        #hhff-panel.hh-min .hh-body{display:none}
        #hhff-panel input[type=text]{width:100%;box-sizing:border-box;padding:6px 8px;border-radius:6px;
          border:1px solid #3c5675;background:#0c1828;color:#fff;margin:4px 0 8px}
        #hhff-panel label.hh-chk{display:flex;gap:8px;align-items:center;margin:3px 0;cursor:pointer}
        #hhff-panel input[type=checkbox]{appearance:auto !important;-webkit-appearance:checkbox !important;
          display:inline-block !important;opacity:1 !important;position:static !important;
          width:15px !important;height:15px !important;margin:0 !important;accent-color:#d9a441;flex:none}
        #hhff-panel .hh-btns{display:flex;gap:6px;margin-top:10px}
        #hhff-panel button{flex:1;padding:7px;border:0;border-radius:6px;font-weight:600;cursor:pointer}
        #hhff-panel .hh-go{background:#d9a441;color:#13243a}
        #hhff-panel .hh-photo-row{margin:0 0 8px}
        #hhff-panel .hh-pick{width:100%;background:#2c4766;color:#fff;padding:7px;border:0;border-radius:6px;font-weight:600;cursor:pointer}
        #hhff-panel .hh-photo-name{font-size:11px;color:#b8c9dc;margin-top:4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
        #hhff-panel .hh-stop{background:#5b6b80;color:#fff}
        #hhff-panel .hh-sep{border-top:1px solid rgba(255,255,255,.12);margin:6px 0 4px}
        #hhff-panel button:disabled{opacity:.5;cursor:default}
        #hhff-panel pre{white-space:pre-wrap;max-height:130px;overflow:auto;background:#0c1828;
          border-radius:6px;padding:6px;margin:10px 0 0;font:11px/1.35 Consolas,monospace;color:#cfe0f2}
      </style>
      <header><span>🖼 H&amp;H Full Frame</span><span class="hh-tog">–</span></header>
      <div class="hh-body">
        <div>Location name</div>
        <input type="text" class="hh-loc" placeholder="e.g. Polperro Harbour">
        <div class="hh-photo-row">
          <button class="hh-pick" type="button">📷 Choose photo</button>
          <input type="file" class="hh-file" accept="image/*" style="display:none">
          <div class="hh-photo-name">No photo chosen</div>
        </div>
        <div class="hh-styles"></div>
        <div class="hh-btns">
          <button class="hh-go">Make styles</button>
          <button class="hh-stop" disabled>Stop</button>
        </div>
        <pre class="hh-log">1. Start a new chat
2. Type the location
3. Choose photo, then press Make styles</pre>
      </div>`;
    document.body.appendChild(p);

    ui.loc = p.querySelector('.hh-loc');
    ui.loc.value = store('loc') || '';
    const box = p.querySelector('.hh-styles');
    STYLES.forEach((s) => {
      const l = document.createElement('label');
      l.className = 'hh-chk';
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = store('style_' + s.key) !== '0';
      l.appendChild(cb);
      l.appendChild(document.createTextNode(s.name));
      box.appendChild(l);
      ui.checks[s.key] = cb;
    });
    ui.start = p.querySelector('.hh-go');
    ui.stop = p.querySelector('.hh-stop');
    ui.log = p.querySelector('.hh-log');
    ui.photo = null;
    ui.photoName = p.querySelector('.hh-photo-name');
    const fileInput = p.querySelector('.hh-file');
    p.querySelector('.hh-pick').addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', () => {
      ui.photo = fileInput.files[0] || null;
      ui.photoName.textContent = ui.photo ? '✓ ' + ui.photo.name : 'No photo chosen';
      fileInput.value = '';
    });
    ui.start.addEventListener('click', run);
    ui.stop.addEventListener('click', () => { stopRequested = true; log('Stopping after current step…'); });

    const header = p.querySelector('header');
    const tog = p.querySelector('.hh-tog');
    if (store('min') === '1') { p.classList.add('hh-min'); tog.textContent = '+'; }
    header.addEventListener('click', () => {
      const min = p.classList.toggle('hh-min');
      tog.textContent = min ? '+' : '–';
      store('min', min ? '1' : '0');
    });
  }

  // ChatGPT is a single-page app; keep the panel present.
  buildPanel();
  setInterval(buildPanel, 3000);
})();