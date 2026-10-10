/* ==========================================================
   Discipline Engine — app.js
   Deterministic Core + State Management (Vanilla JS)
   ========================================================== */
(function () {
  'use strict';

  /* ---------- Constants ---------- */
  var STORAGE_KEY = 'discipline_engine_v1_data';
  var STREAK_THRESHOLD = 75;
  var POINTS_PER_PILLAR = 25;
  var FOCUS_SECONDS = 90 * 60;
  var WAKE_GRACE_MIN = 30; // เช็กอินช้ากว่าเป้าไม่เกินกี่นาทีถึงนับว่า "สำเร็จ"
  var THAI_MONTHS = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.',
    'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];

  /* ---------- Helpers ---------- */
  function $(id) { return document.getElementById(id); }
  function pad(n) { return n < 10 ? '0' + n : '' + n; }

  function todayStr(d) {
    d = d || new Date();
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  function dayDiff(a, b) { // จำนวนวันระหว่าง YYYY-MM-DD สองค่า (b - a)
    var pa = a.split('-'), pb = b.split('-');
    var da = Date.UTC(+pa[0], +pa[1] - 1, +pa[2]);
    var db = Date.UTC(+pb[0], +pb[1] - 1, +pb[2]);
    return Math.round((db - da) / 86400000);
  }

  function thaiDate(d) {
    d = d || new Date();
    return d.getDate() + ' ' + THAI_MONTHS[d.getMonth()] + ' ' + d.getFullYear();
  }

  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  function timeToMin(hhmm) {
    var p = hhmm.split(':');
    return (+p[0]) * 60 + (+p[1]);
  }

  /* ---------- State ---------- */
  function newDaily(dateStr) {
    return {
      date: dateStr,
      circadian: { targetWake: '06:00', targetSleep: '23:00', wakeCheckedAt: null, isSuccess: false },
      moneyMaker: { proofText: '', isDone: false },
      brainUpgrade: { learningNote: '', isDone: false },
      bodyBaseline: { isWorkoutDone: false },
      score: 0
    };
  }

  function calcScore(d) {
    var s = 0;
    if (d.circadian.isSuccess) s += POINTS_PER_PILLAR;
    if (d.moneyMaker.isDone) s += POINTS_PER_PILLAR;
    if (d.brainUpgrade.isDone) s += POINTS_PER_PILLAR;
    if (d.bodyBaseline.isWorkoutDone) s += POINTS_PER_PILLAR;
    return s;
  }

  function loadStore() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        var parsed = JSON.parse(raw);
        if (parsed && parsed.daily && Array.isArray(parsed.history)) return parsed;
      }
    } catch (e) { /* ข้อมูลเสีย -> เริ่มใหม่ */ }
    return { daily: newDaily(todayStr()), history: [] };
  }

  var store = loadStore();

  function saveStore() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(store)); } catch (e) { /* storage เต็ม/ถูกบล็อก */ }
  }

  /* ---------- Day Transition ---------- */
  function handleDayTransition() {
    var today = todayStr();
    if (store.daily.date === today) return false;

    var prev = store.daily;
    prev.score = calcScore(prev);
    var exists = store.history.some(function (h) { return h.date === prev.date; });
    if (!exists) store.history.push(clone(prev));
    store.history.sort(function (a, b) { return a.date < b.date ? -1 : 1; });

    store.daily = newDaily(today);
    saveStore();
    return true;
  }

  /* ---------- Streak ----------
     นับวันติดกัน (ปฏิทินต่อเนื่อง) ที่คะแนน >= 75
     วันนี้นับรวมเมื่อถึงเกณฑ์แล้ว ถ้ายังไม่ถึงไม่ทำให้ streak ขาด (ยังมีเวลาทั้งวัน) */
  function calcStreak() {
    var byDate = {};
    store.history.forEach(function (h) { byDate[h.date] = h.score; });

    var today = store.daily.date;
    var streak = 0;
    var cursor = new Date();

    if (calcScore(store.daily) >= STREAK_THRESHOLD) {
      streak = 1;
    }
    for (var i = 1; i < 3660; i++) {
      var d = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() - i);
      var key = todayStr(d);
      if (typeof byDate[key] === 'number' && byDate[key] >= STREAK_THRESHOLD) streak++;
      else break;
    }
    return streak;
  }

  /* ---------- UI helpers ---------- */
  var CARD_SELECTOR = '[data-pillar], .pillar-card, .card, article, section';
  var STATUS_SELECTOR = '[data-status], .status, .card-status, .pillar-status, .badge';

  function cardOf(el) { return el ? el.closest(CARD_SELECTOR) : null; }

  function setCardState(card, done, statusText) {
    if (!card) return;
    card.classList.toggle('is-done', !!done);
    var badges = card.querySelectorAll('.badge');
    for (var i = 0; i < badges.length; i++) badges[i].classList.toggle('is-done', !!done);
    var st = card.querySelector(STATUS_SELECTOR);
    if (st && statusText != null) st.textContent = statusText;
  }

  /* ---------- Render ---------- */
  function render() {
    var d = store.daily;
    d.score = calcScore(d);
    var streak = calcStreak();

    if ($('current-date')) $('current-date').textContent = thaiDate();
    if ($('streak-count')) $('streak-count').textContent = streak;
    if ($('discipline-score')) $('discipline-score').textContent = d.score;
    if ($('score-bar')) $('score-bar').style.width = d.score + '%';

    // Circadian
    var wakeCard = cardOf($('btn-wake-checkin'));
    if (d.circadian.wakeCheckedAt) {
      setCardState(wakeCard, true, 'Check-in แล้ว (เวลา ' + d.circadian.wakeCheckedAt + ')');
      if ($('btn-wake-checkin')) $('btn-wake-checkin').disabled = true;
    } else {
      setCardState(wakeCard, false, 'ยังไม่ได้ Check-in');
      if ($('btn-wake-checkin')) $('btn-wake-checkin').disabled = false;
    }

    // Money Maker
    var moneyCard = cardOf($('btn-submit-proof'));
    if ($('proof-input') && document.activeElement !== $('proof-input')) {
      $('proof-input').value = d.moneyMaker.proofText;
    }
    setCardState(moneyCard, d.moneyMaker.isDone, d.moneyMaker.isDone ? 'ส่งงานแล้ว' : 'ยังไม่ส่งงาน');

    // Brain Upgrade
    var brainCard = cardOf($('btn-save-learning'));
    if ($('learning-input') && document.activeElement !== $('learning-input')) {
      $('learning-input').value = d.brainUpgrade.learningNote;
    }
    setCardState(brainCard, d.brainUpgrade.isDone, d.brainUpgrade.isDone ? 'บันทึกการเรียนรู้แล้ว' : 'ยังไม่ได้บันทึก');

    // Body Baseline
    var bodyBtn = $('btn-workout-toggle');
    if (bodyBtn) bodyBtn.setAttribute('aria-pressed', d.bodyBaseline.isWorkoutDone ? 'true' : 'false');
    setCardState(cardOf(bodyBtn), d.bodyBaseline.isWorkoutDone,
      d.bodyBaseline.isWorkoutDone ? 'ออกกำลังกายแล้ว' : 'ยังไม่ได้ออกกำลังกาย');
  }

  function commit() {
    store.daily.score = calcScore(store.daily);
    saveStore();
    render();
  }

  /* ---------- Pillar Handlers ---------- */
  function onWakeCheckin() {
    var d = store.daily;
    if (d.circadian.wakeCheckedAt) return;
    var now = new Date();
    d.circadian.wakeCheckedAt = pad(now.getHours()) + ':' + pad(now.getMinutes());
    var nowMin = now.getHours() * 60 + now.getMinutes();
    d.circadian.isSuccess = nowMin <= timeToMin(d.circadian.targetWake) + WAKE_GRACE_MIN;
    commit();
    if (d.circadian.isSuccess) {
      window.appendTerminalMessage('SYSTEM', 'Check-in ' + d.circadian.wakeCheckedAt + ' — ตรงเวลา +25 คะแนน', false);
    } else {
      window.appendTerminalMessage('SYSTEM', 'Check-in ' + d.circadian.wakeCheckedAt + ' — เลยเวลาเป้าหมาย ' +
        d.circadian.targetWake + ' ไม่ได้คะแนนเสานี้', true);
    }
  }

  function onSubmitProof() {
    var input = $('proof-input');
    var text = input ? input.value.trim() : '';
    if (!text) {
      window.appendTerminalMessage('SYSTEM', 'ยังไม่มีหลักฐานงาน — ใส่ลิงก์หรือข้อความก่อนส่ง', true);
      return;
    }
    store.daily.moneyMaker.proofText = text;
    store.daily.moneyMaker.isDone = true;
    commit();
    window.appendTerminalMessage('SYSTEM', 'ส่งงานแล้ว +25 คะแนน', false);
  }

  function onOpenFocus() {
    var el = $('focus-timer');
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function onSaveLearning() {
    var input = $('learning-input');
    var text = input ? input.value.trim() : '';
    if (!text) {
      window.appendTerminalMessage('SYSTEM', 'โน้ตว่างเปล่า — เขียนสิ่งที่เรียนรู้วันนี้ก่อน', true);
      return;
    }
    store.daily.brainUpgrade.learningNote = text;
    store.daily.brainUpgrade.isDone = true;
    commit();
    window.appendTerminalMessage('SYSTEM', 'บันทึกการเรียนรู้แล้ว +25 คะแนน', false);
  }

  function onWorkoutToggle() {
    store.daily.bodyBaseline.isWorkoutDone = !store.daily.bodyBaseline.isWorkoutDone;
    commit();
  }

  /* ---------- Focus Timer ---------- */
  var timer = { remaining: FOCUS_SECONDS, endAt: 0, handle: null, running: false };

  function setTimerStatus(text) {
    var el = $('timer-status');
    if (!el) {
      var card = $('timer-card');
      el = card ? card.querySelector(STATUS_SELECTOR) : null;
    }
    if (el) el.textContent = text;
  }

  function renderTimer() {
    var m = Math.floor(timer.remaining / 60);
    var s = timer.remaining % 60;
    if ($('timer-display')) $('timer-display').textContent = pad(m) + ':' + pad(s);
    if ($('timer-fill')) {
      var pct = ((FOCUS_SECONDS - timer.remaining) / FOCUS_SECONDS) * 100;
      $('timer-fill').style.width = pct + '%';
    }
  }

  function stopTick() {
    if (timer.handle) { clearInterval(timer.handle); timer.handle = null; }
    timer.running = false;
    if ($('timer-card')) $('timer-card').classList.remove('is-running');
  }

  function beep() {
    try {
      var Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      var ctx = new Ctx();
      [660, 880].forEach(function (freq, i) {
        var osc = ctx.createOscillator();
        var gain = ctx.createGain();
        var t0 = ctx.currentTime + i * 0.25;
        osc.type = 'sine';
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.0001, t0);
        gain.gain.exponentialRampToValueAtTime(0.08, t0 + 0.03);
        gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.22);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(t0);
        osc.stop(t0 + 0.25);
      });
      setTimeout(function () { if (ctx.close) ctx.close(); }, 1000);
    } catch (e) { /* ไม่รองรับเสียง — ข้าม */ }
  }

  function tick() {
    var left = Math.max(0, Math.round((timer.endAt - Date.now()) / 1000));
    timer.remaining = left;
    renderTimer();
    if (left <= 0) {
      stopTick();
      timer.remaining = 0;
      renderTimer();
      setTimerStatus('Focus สำเร็จ!');
      beep();
      window.appendTerminalMessage('SYSTEM', 'Focus 90 นาทีสำเร็จ!', false);
    }
  }

  function onStart() {
    if (timer.running) return;
    if (timer.remaining <= 0) timer.remaining = FOCUS_SECONDS;
    timer.endAt = Date.now() + timer.remaining * 1000;
    timer.running = true;
    if ($('timer-card')) $('timer-card').classList.add('is-running');
    setTimerStatus('กำลัง Focus...');
    timer.handle = setInterval(tick, 250);
    tick();
  }

  function onPause() {
    if (!timer.running) return;
    tick(); // sync เวลาที่เหลือก่อนหยุด
    stopTick();
    if (timer.remaining > 0) setTimerStatus('หยุดชั่วคราว');
  }

  function onReset() {
    stopTick();
    timer.remaining = FOCUS_SECONDS;
    renderTimer();
    setTimerStatus('พร้อมเริ่ม');
  }

  /* ---------- Public Hooks (สำหรับ ai.js) ---------- */
  window.getDisciplineSnapshot = function () {
    var d = store.daily;
    return {
      date: d.date,
      score: calcScore(d),
      streak: calcStreak(),
      pillars: {
        circadian: {
          targetWake: d.circadian.targetWake,
          targetSleep: d.circadian.targetSleep,
          wakeCheckedAt: d.circadian.wakeCheckedAt,
          isSuccess: d.circadian.isSuccess
        },
        moneyMaker: { isDone: d.moneyMaker.isDone, proofText: d.moneyMaker.proofText },
        brainUpgrade: { isDone: d.brainUpgrade.isDone, learningNote: d.brainUpgrade.learningNote },
        bodyBaseline: { isWorkoutDone: d.bodyBaseline.isWorkoutDone }
      },
      learningNote: d.brainUpgrade.learningNote,
      history: clone(store.history)
    };
  };

  window.appendTerminalMessage = function (sender, text, isWarn) {
    var log = $('alter-ego-log');
    if (!log) return;
    var p = document.createElement('p');
    var isUser = typeof sender === 'string' && (sender.toLowerCase() === 'you' || sender.toLowerCase() === 'user');
    p.className = 'msg' + (isUser ? ' msg-user' : '') + (isWarn ? ' msg-warn' : '');
    if (sender) {
      var who = document.createElement('strong');
      who.className = 'who';
      who.textContent = sender + ': ';
      p.appendChild(who);
    }
    p.appendChild(document.createTextNode(text));
    log.appendChild(p);
    log.scrollTop = log.scrollHeight;
  };

  /* ---------- Init ---------- */
  function on(id, evt, fn) {
    var el = $(id);
    if (el) el.addEventListener(evt, fn);
  }

  function init() {
    var transitioned = handleDayTransition();

    on('btn-wake-checkin', 'click', onWakeCheckin);
    on('btn-submit-proof', 'click', onSubmitProof);
    on('btn-open-focus', 'click', onOpenFocus);
    on('btn-save-learning', 'click', onSaveLearning);
    on('btn-workout-toggle', 'click', onWorkoutToggle);
    on('btn-start', 'click', onStart);
    on('btn-pause', 'click', onPause);
    on('btn-reset', 'click', onReset);

    render();
    renderTimer();
    setTimerStatus('พร้อมเริ่ม');

    if (transitioned) {
      window.appendTerminalMessage('SYSTEM', 'วันใหม่เริ่มแล้ว — รีเซ็ต State และบันทึกเมื่อวานลงประวัติ', false);
    }

    // เปิดเว็บค้างข้ามเที่ยงคืน: ตรวจซ้ำทุกนาที
    setInterval(function () {
      if (handleDayTransition()) {
        render();
        window.appendTerminalMessage('SYSTEM', 'ข้ามวันแล้ว — รีเซ็ต State สำหรับวันนี้', false);
      }
    }, 60000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
