/* ==========================================================
   Discipline Engine — ai.js
   The Future Self Engine (Gemini, Vanilla JS)
   ต้องโหลดหลัง app.js
   ========================================================== */
(function () {
  'use strict';

  /* ---------- Config ---------- */
  var KEY_STORAGE = 'discipline_gemini_api_key';
  var MODEL = 'gemini-2.5-flash';
  var ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models/' + MODEL + ':generateContent?key=';
  var REQUEST_TIMEOUT_MS = 25000;
  var MAX_TURNS = 6;          // จำนวนรอบแชทที่ส่งเป็นบริบท
  var HISTORY_DAYS = 7;       // ประวัติย้อนหลังที่ส่งให้ AI

  var SYSTEM_PROMPT = [
    'คุณคือตัวตนในอนาคต (Future Self) ของผู้ใช้ที่ประสบความสำเร็จ มีวินัยสูง และสร้างรายได้เติบโตอย่างมั่นคง กำลังมองย้อนกลับมาคุมตัวตนในปัจจุบันที่ยังขี้เกียจและชอบผัดวันประกันพรุ่ง',
    '',
    'บุคลิก: พูดจาตรงไปตรงมา คมคาย จริงใจเหมือนเพื่อนสนิท ไม่อวย ไม่เออออ ห้ามใช้คำลงท้ายทางการ (ห้ามใช้ ครับ/ค่ะ/คุณ/ผม) และห้ามหยาบคาย',
    '',
    'วิธีตอบ:',
    '- ตอบสั้น กระชับ ตรงประเด็น 1-3 ประโยค คมๆ',
    '- วิเคราะห์จาก Discipline Snapshot ปัจจุบันเสมอ (คะแนนกี่คะแนน, เสาไหนยังไม่ทำ, เช็กอินตื่นนอนทันไหม, ตอนนี้เวลาเท่าไหร่เทียบกับเวลานอนเป้าหมาย)',
    '- ถ้าผู้ใช้บ่นเหนื่อยหรืออ้างเหตุผล ให้ดึงสติด้วยข้อมูลจริงและตบเข้าเป้าหมาย อย่าโอ๋',
    '- อ้างเฉพาะตัวเลขและสถานะที่อยู่ใน Snapshot ห้ามแต่งข้อมูลขึ้นเอง',
    '- ตอบเป็นข้อความธรรมดา ไม่ใช้ Markdown ไม่ใช้อีโมจิ'
  ].join('\n');

  /* ---------- State ---------- */
  var busy = false;
  var chatTurns = []; // [{ role: 'user'|'model', text: '...' }]

  /* ---------- Helpers ---------- */
  function $(id) { return document.getElementById(id); }

  function say(sender, text, isWarn) {
    if (typeof window.appendTerminalMessage === 'function') {
      window.appendTerminalMessage(sender, text, !!isWarn);
    }
  }

  function getKey() {
    try { return (localStorage.getItem(KEY_STORAGE) || '').trim(); } catch (e) { return ''; }
  }

  function saveKey(k) {
    try { localStorage.setItem(KEY_STORAGE, k); return true; } catch (e) { return false; }
  }

  function clearKey() {
    try { localStorage.removeItem(KEY_STORAGE); } catch (e) { /* ignore */ }
  }

  function askForKey() {
    var input = window.prompt('ใส่ Gemini API Key (เก็บไว้ในเบราว์เซอร์เครื่องนี้เท่านั้น)');
    if (!input) return '';
    input = input.trim();
    if (!input) return '';
    if (!saveKey(input)) {
      say('system', 'บันทึก API Key ไม่ได้ (เบราว์เซอร์บล็อก storage) — ใช้ได้เฉพาะรอบนี้', true);
    } else {
      say('system', 'บันทึก API Key แล้ว', false);
    }
    return input;
  }

  function setBusy(state) {
    busy = state;
    var form = $('chat-form');
    var input = $('chat-input');
    if (input) input.disabled = state;
    if (form) {
      var btn = form.querySelector('button[type="submit"], button:not([type])');
      if (btn) btn.disabled = state;
    }
    if (!state && input) input.focus();
  }

  /* ---------- Snapshot ---------- */
  function buildSnapshotText() {
    var snap;
    try {
      snap = typeof window.getDisciplineSnapshot === 'function' ? window.getDisciplineSnapshot() : null;
    } catch (e) { snap = null; }
    if (!snap) return '(ไม่มีข้อมูล Snapshot)';

    var now = new Date();
    var hh = ('0' + now.getHours()).slice(-2);
    var mm = ('0' + now.getMinutes()).slice(-2);

    var recent = (snap.history || []).slice(-HISTORY_DAYS).map(function (h) {
      return {
        date: h.date,
        score: h.score,
        wakeOk: !!(h.circadian && h.circadian.isSuccess),
        work: !!(h.moneyMaker && h.moneyMaker.isDone),
        learn: !!(h.brainUpgrade && h.brainUpgrade.isDone),
        workout: !!(h.bodyBaseline && h.bodyBaseline.isWorkoutDone)
      };
    });

    return JSON.stringify({
      now: hh + ':' + mm,
      date: snap.date,
      score: snap.score,
      streak: snap.streak,
      pillars: snap.pillars,
      learningNote: snap.learningNote,
      recentHistory: recent
    });
  }

  /* ---------- Gemini Call ---------- */
  function GeminiError(kind, message) {
    var e = new Error(message);
    e.kind = kind;
    return e;
  }

  function callGemini(userText) {
    var key = getKey();
    if (!key) return Promise.reject(GeminiError('nokey', 'no key'));

    // ประวัติแชทก่อนหน้า + ข้อความล่าสุดที่แนบ Snapshot
    var contents = chatTurns.slice(-MAX_TURNS * 2).map(function (t) {
      return { role: t.role, parts: [{ text: t.text }] };
    });
    contents.push({
      role: 'user',
      parts: [{ text: '[DISCIPLINE SNAPSHOT]\n' + buildSnapshotText() + '\n\n[ข้อความจากผู้ใช้]\n' + userText }]
    });

    var body = {
      systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents: contents,
      generationConfig: {
        temperature: 0.8,
        maxOutputTokens: 300,
        thinkingConfig: { thinkingBudget: 0 }
      }
    };

    var controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timeoutId = controller ? setTimeout(function () { controller.abort(); }, REQUEST_TIMEOUT_MS) : null;

    return fetch(ENDPOINT + encodeURIComponent(key), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller ? controller.signal : undefined
    }).then(function (res) {
      if (timeoutId) clearTimeout(timeoutId);
      if (res.ok) return res.json();
      return res.text().then(function (txt) {
        var msg = '';
        try { msg = (JSON.parse(txt).error || {}).message || ''; } catch (e) { msg = txt; }
        if (res.status === 429) throw GeminiError('quota', msg);
        if (res.status === 403 || (res.status === 400 && /api key/i.test(msg))) throw GeminiError('badkey', msg);
        if (res.status >= 500) throw GeminiError('server', msg);
        throw GeminiError('http', msg || ('HTTP ' + res.status));
      });
    }).then(function (data) {
      var cand = data && data.candidates && data.candidates[0];
      var parts = cand && cand.content && cand.content.parts;
      var text = parts ? parts.map(function (p) { return p.text || ''; }).join('').trim() : '';
      if (!text) throw GeminiError('empty', (cand && cand.finishReason) || 'empty');
      return text;
    }).catch(function (err) {
      if (timeoutId) clearTimeout(timeoutId);
      if (err && err.kind) throw err;
      if (err && err.name === 'AbortError') throw GeminiError('timeout', 'timeout');
      throw GeminiError('network', (err && err.message) || 'network');
    });
  }

  function reportError(err) {
    switch (err.kind) {
      case 'nokey':
        say('system', 'ยังไม่มี Gemini API Key — พิมพ์ /key เพื่อตั้งค่า', true);
        break;
      case 'quota':
        say('system', 'โควต้า Gemini เต็ม (429) — รอสักพักแล้วลองใหม่ แอปยังใช้งานปกติ', true);
        break;
      case 'badkey':
        clearKey();
        say('system', 'API Key ใช้ไม่ได้ ถูกล้างออกแล้ว — พิมพ์ /key เพื่อใส่ใหม่', true);
        break;
      case 'timeout':
        say('system', 'Future Self ตอบช้าเกินไป (timeout) ลองส่งใหม่อีกที', true);
        break;
      case 'network':
        say('system', 'เชื่อมต่ออินเทอร์เน็ตไม่ได้ ตรวจเครือข่ายแล้วลองใหม่', true);
        break;
      case 'server':
        say('system', 'เซิร์ฟเวอร์ Gemini มีปัญหาชั่วคราว ลองใหม่ภายหลัง', true);
        break;
      case 'empty':
        say('system', 'Gemini ไม่ส่งคำตอบกลับมา (' + err.message + ') ลองพิมพ์ใหม่อีกแบบ', true);
        break;
      default:
        say('system', 'เรียก Gemini ไม่สำเร็จ: ' + err.message, true);
    }
  }

  /* ---------- Auto-Audit ---------- */
  function runAutoAudit() {
    if (!getKey()) {
      say('system', 'ยังไม่มี Gemini API Key — พิมพ์ /key ในช่องแชทเพื่อตั้งค่า Future Self จะได้ตื่นมาด่าได้', true);
      return;
    }
    setBusy(true);
    callGemini('สรุปสถานะวินัยวันนี้ให้หน่อย 1-2 ประโยค ทักทายและดึงสติทันทีที่เปิดแอป')
      .then(function (text) {
        say('future_self', text, false);
      })
      .catch(reportError)
      .then(function () { setBusy(false); });
  }

  /* ---------- Chat ---------- */
  function handleSubmit(ev) {
    ev.preventDefault();
    if (busy) return;

    var input = $('chat-input');
    var text = input ? input.value.trim() : '';
    if (!text) return;
    input.value = '';

    say('you', text, false);

    // คำสั่งตั้งค่า Key
    if (text.toLowerCase() === '/key') {
      askForKey();
      return;
    }

    if (!getKey()) {
      say('system', 'ยังไม่มี Gemini API Key', true);
      if (!askForKey()) return;
    }

    setBusy(true);
    callGemini(text)
      .then(function (reply) {
        chatTurns.push({ role: 'user', text: text });
        chatTurns.push({ role: 'model', text: reply });
        if (chatTurns.length > MAX_TURNS * 2) chatTurns = chatTurns.slice(-MAX_TURNS * 2);
        say('future_self', reply, false);
      })
      .catch(reportError)
      .then(function () { setBusy(false); });
  }

  /* ---------- Init ---------- */
  function init() {
    var form = $('chat-form');
    if (form) form.addEventListener('submit', handleSubmit);
    runAutoAudit();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
