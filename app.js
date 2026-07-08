/* ============================================
   趣味识字 - 核心逻辑 (app.js) v3
   纯原生 JS · 无依赖 · 支持 file:// 离线运行
   混合学习流 + 错题本 + 三组图 + 五步循环
   ============================================ */

(function () {
  'use strict';

  const STORAGE_KEY = 'shizi_progress_v3';
  const BOX_INTERVALS = [0, 0.5, 1, 2, 4, 7, 15];
  const MASTER_STREAK = 3;
  const CHARLIB = window.CHARLIB || [];
  // 模拟当前时间（支持推进天数测试复习流程）
  function SIM_NOW() { return Date.now() + ((progress && progress.simDayOffset) ? progress.simDayOffset : 0) * 86400000; }
  function TODAY() { return new Date(SIM_NOW()).toISOString().slice(0, 10); }

  const ACHIEVEMENTS = [
    { id: 'first', name: '初识汉字', icon: '🌱', cond: p => p.totalLearned >= 1 },
    { id: 'ten', name: '小有收获', icon: '🌿', cond: p => p.totalLearned >= 10 },
    { id: 'fifty', name: '识字新秀', icon: '🍀', cond: p => p.totalLearned >= 50 },
    { id: 'hundred', name: '百字达人', icon: '⭐', cond: p => p.totalLearned >= 100 },
    { id: 'threeh', name: '识字能手', icon: '🌟', cond: p => p.totalLearned >= 300 },
    { id: 'thousand', name: '识字大王', icon: '👑', cond: p => p.totalLearned >= 1000 },
    { id: 'm10', name: '牢记于心', icon: '💪', cond: p => p.totalMastered >= 10 },
    { id: 'm50', name: '过目不忘', icon: '🧠', cond: p => p.totalMastered >= 50 },
    { id: 's3', name: '坚持三天', icon: '🔥', cond: p => p.streakDays >= 3 },
    { id: 's7', name: '一周不辍', icon: '🔥🔥', cond: p => p.streakDays >= 7 },
    { id: 's30', name: '月度之星', icon: '🏆', cond: p => p.streakDays >= 30 },
    { id: 'star50', name: '星星收集', icon: '✨', cond: p => p.totalStars >= 50 },
    { id: 'star200', name: '星光璀璨', icon: '💫', cond: p => p.totalStars >= 200 },
    { id: 'star500', name: '满天星斗', icon: '🌠', cond: p => p.totalStars >= 500 },
    { id: 'combo5', name: '连击高手', icon: '⚡', cond: p => (p.maxCombo || 0) >= 5 },
    { id: 'wbclear', name: '错题克星', icon: '🛡️', cond: p => (p.wbCleared || 0) >= 1 },
  ];

  let progress = null;
  let viewState = {};
  let audioCtx = null;

  // ============ 存储 ============
  function defaultProgress() {
    return {
      records: {}, learnedIds: [], currentIndex: 0,
      totalStars: 0, totalLearned: 0, totalMastered: 0,
      streakDays: 0, lastStudyDate: '', history: [], achievements: [],
      wrongBook: [], wbCleared: 0, maxCombo: 0,
      dailyNew: 3, dailyReviewLimit: 10, sfxOn: true,
      simDayOffset: 0, autoNext: true,
    };
  }

  function loadProgress() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return defaultProgress();
      const p = Object.assign(defaultProgress(), JSON.parse(raw));
      Object.values(p.records).forEach(r => { if (r.streak == null) r.streak = 0; });
      return p;
    } catch (e) { return defaultProgress(); }
  }

  function saveProgress() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(progress)); }
    catch (e) { console.error('保存失败', e); }
  }

  // ============ 算法 ============
  function getNewWords() {
    const learnedToday = todayNewLearned();
    const remaining = Math.max(0, progress.dailyNew - learnedToday);
    if (remaining === 0) return [];
    const result = [];
    let idx = progress.currentIndex;
    while (result.length < remaining && idx < CHARLIB.length) {
      if (!progress.records[CHARLIB[idx].id]) result.push(CHARLIB[idx]);
      idx++;
    }
    return result;
  }

  function getDueReviews() {
    const now = SIM_NOW();
    return Object.values(progress.records)
      .filter(r => !r.mastered && r.nextReview <= now)
      .sort((a, b) => a.nextReview - b.nextReview)
      .slice(0, progress.dailyReviewLimit);
  }

  function getWrongBookChars() {
    return progress.wrongBook.map(id => CHARLIB.find(c => c.id === id)).filter(c => c);
  }

  function todayNewLearned() {
    const t = progress.history.find(d => d.date === TODAY());
    return t ? t.newLearned : 0;
  }
  function todayReviewed() {
    const t = progress.history.find(d => d.date === TODAY());
    return t ? t.reviewed : 0;
  }
  function todayStars() {
    const t = progress.history.find(d => d.date === TODAY());
    return t ? t.stars : 0;
  }

  // 混合队列：复习2个 → 新字1个 → 复习2个 → 新字1个 ...
  function buildStudyQueue() {
    const reviews = getDueReviews().map(r => CHARLIB.find(c => c.id === r.charId)).filter(c => c);
    const newWords = getNewWords();
    const queue = [];
    let rIdx = 0, nIdx = 0;
    while (nIdx < newWords.length || rIdx < reviews.length) {
      for (let i = 0; i < 2 && rIdx < reviews.length; i++) queue.push({ type: 'review', char: reviews[rIdx++] });
      if (nIdx < newWords.length) queue.push({ type: 'new', char: newWords[nIdx++] });
    }
    while (rIdx < reviews.length) queue.push({ type: 'review', char: reviews[rIdx++] });
    return queue;
  }

  function markLearned(item) {
    if (progress.records[item.id]) return;
    const now = SIM_NOW();
    progress.records[item.id] = {
      charId: item.id, box: 1, nextReview: now + BOX_INTERVALS[1] * 86400000,
      lastReview: now, reviewCount: 0, correctCount: 0, wrongCount: 0,
      mastered: false, learnedDate: TODAY(), streak: 0, weak: false,
    };
    progress.learnedIds.push(item.id);
    progress.currentIndex = Math.max(progress.currentIndex, item.id);
    while (progress.currentIndex < CHARLIB.length && progress.records[CHARLIB[progress.currentIndex].id]) progress.currentIndex++;
    progress.totalLearned = progress.learnedIds.length;
    updateStreak();
    updateHistory(1, 0, 0, 1);
    progress.totalStars += 1;
    saveProgress();
  }

  function reviewAnswer(charId, correct) {
    const r = progress.records[charId];
    if (!r) return { stars: 0, mastered: false };
    const now = SIM_NOW();
    r.reviewCount++;
    r.lastReview = now;
    let stars = 0, mastered = false;
    if (correct) {
      r.correctCount++;
      r.streak = (r.streak || 0) + 1;
      r.box = Math.min(5, r.box + 1);
      stars = 1;
      if (r.box >= 5 && r.reviewCount >= 4 && r.streak >= MASTER_STREAK && !r.mastered) {
        mastered = true; r.mastered = true; stars += 2;
        const wi = progress.wrongBook.indexOf(charId);
        if (wi >= 0) progress.wrongBook.splice(wi, 1);
      }
    } else {
      r.wrongCount++; r.streak = 0; r.box = 1; r.weak = true;
      if (!progress.wrongBook.includes(charId)) progress.wrongBook.push(charId);
    }
    r.nextReview = now + BOX_INTERVALS[r.box] * 86400000;
    progress.totalMastered = Object.values(progress.records).filter(x => x.mastered).length;
    progress.totalStars += stars;
    updateStreak();
    updateHistory(0, 1, correct ? 1 : 0, stars);
    saveProgress();
    return { stars, mastered };
  }

  function updateStreak() {
    const today = TODAY();
    if (progress.lastStudyDate === today) return;
    const yesterday = new Date(SIM_NOW() - 86400000).toISOString().slice(0, 10);
    if (progress.lastStudyDate === yesterday) progress.streakDays++;
    else progress.streakDays = 1;
    progress.lastStudyDate = today;
  }

  function updateHistory(newLearned, reviewed, correct, stars) {
    const today = TODAY();
    let day = progress.history.find(d => d.date === today);
    if (!day) {
      day = { date: today, newLearned: 0, reviewed: 0, correct: 0, stars: 0 };
      progress.history.push(day);
      if (progress.history.length > 90) progress.history = progress.history.slice(-90);
    }
    day.newLearned += newLearned; day.reviewed += reviewed;
    day.correct += correct; day.stars += stars;
  }

  function checkAchievements() {
    const unlocked = [];
    ACHIEVEMENTS.forEach(a => {
      if (!progress.achievements.includes(a.id) && a.cond(progress)) {
        progress.achievements.push(a.id); unlocked.push(a);
      }
    });
    if (unlocked.length) saveProgress();
    return unlocked;
  }

  // ============ TTS ============
  let voices = [];
  if ('speechSynthesis' in window) {
    voices = window.speechSynthesis.getVoices();
    window.speechSynthesis.onvoiceschanged = () => { voices = window.speechSynthesis.getVoices(); };
  }
  function speak(text, btn) {
    if (!('speechSynthesis' in window)) { toast('浏览器不支持语音'); return; }
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'zh-CN'; u.rate = 0.8; u.pitch = 1.1;
    const zh = voices.find(v => v.lang.startsWith('zh') && /female|女|ting/i.test(v.name)) || voices.find(v => v.lang.startsWith('zh'));
    if (zh) u.voice = zh;
    if (btn) { btn.classList.add('speaking'); u.onend = () => btn.classList.remove('speaking'); u.onerror = () => btn.classList.remove('speaking'); }
    window.speechSynthesis.speak(u);
  }

  // ============ WebAudio 音效 ============
  function ensureAudio() {
    if (!audioCtx) { try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return null; } }
    if (audioCtx.state === 'suspended') audioCtx.resume();
    return audioCtx;
  }
  function playTone(freq, duration, type) {
    if (progress && progress.sfxOn === false) return;
    const ctx = ensureAudio(); if (!ctx) return;
    const osc = ctx.createOscillator(), gain = ctx.createGain();
    osc.type = type || 'sine'; osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.18, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
    osc.connect(gain); gain.connect(ctx.destination);
    osc.start(); osc.stop(ctx.currentTime + duration);
  }
  function sfxCorrect() { playTone(880, 0.12, 'sine'); setTimeout(() => playTone(1175, 0.16, 'sine'), 90); }
  function sfxWrong() { playTone(196, 0.22, 'sawtooth'); }
  function sfxComplete() { [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => playTone(f, 0.2, 'triangle'), i * 110)); }
  function sfxCombo(n) { playTone(660 + Math.min(n, 10) * 80, 0.1, 'square'); }

  function confetti() {
    const colors = ['#FF8C42', '#4FC3F7', '#66BB6A', '#FFD54F', '#FF8A95', '#AB83E0'];
    const layer = document.createElement('div');
    layer.style.cssText = 'position:fixed;inset:0;z-index:300;pointer-events:none;overflow:hidden';
    document.body.appendChild(layer);
    for (let i = 0; i < 60; i++) {
      const p = document.createElement('div');
      const size = 6 + Math.random() * 8;
      p.style.cssText = `position:absolute;width:${size}px;height:${size}px;background:${colors[i % colors.length]};left:${Math.random() * 100}%;top:-20px;border-radius:${Math.random() > 0.5 ? '50%' : '2px'}`;
      layer.appendChild(p);
      const dur = 1800 + Math.random() * 1200;
      p.animate([{ transform: `translate(0,0)`, opacity: 1 }, { transform: `translate(${(Math.random() - 0.5) * 200}px, ${window.innerHeight + 40}px) rotate(${720}deg)`, opacity: 0 }],
        { duration: dur, easing: 'cubic-bezier(0.2,0.6,0.4,1)', fill: 'forwards' });
    }
    setTimeout(() => layer.remove(), 3200);
  }

  // ============ 组词智能过滤 ============
  // 构建字→难度等级映射
  let charLevelMap = {};
  function buildCharLevelMap() {
    charLevelMap = {};
    CHARLIB.forEach(c => { charLevelMap[c.c] = c.lv; });
  }
  // 返回不含太生僻字的组词（过滤掉含 lv > 当前字+1 的组词）
  function getGoodWords(item) {
    if (!item.w || item.w.length === 0) return [];
    const baseLv = item.lv || 1;
    const good = item.w.filter(w => {
      // 组词里每个非当前字，难度不能比当前字高超过1级
      for (const ch of w) {
        if (ch === item.c) continue;
        const lv = charLevelMap[ch];
        // lv 为 undefined 说明不在词库（可能是多字词里没收录的），视为可用
        if (lv != null && lv > baseLv + 1) return false;
      }
      return true;
    });
    // 如果过滤后为空，就返回原始组词（总比没有好）
    return good.length > 0 ? good : item.w;
  }

  // ============ 干扰项 ============
  function getDistractors(correct, count) {
    const result = [], used = new Set([correct.id]);
    const learnedPool = progress.learnedIds.filter(id => id !== correct.id).map(id => CHARLIB.find(c => c.id === id)).filter(c => c).sort(() => Math.random() - 0.5);
    for (const c of learnedPool) { if (result.length >= count) break; if (!used.has(c.id)) { result.push(c); used.add(c.id); } }
    if (result.length < count) {
      const pool = CHARLIB.slice(0, 200).filter(c => c.id !== correct.id && !used.has(c.id));
      for (const c of pool.sort(() => Math.random() - 0.5)) { if (result.length >= count) break; result.push(c); used.add(c.id); }
    }
    if (result.length < count) {
      const pool = CHARLIB.slice(0, 500).filter(c => c.id !== correct.id && !used.has(c.id));
      for (const c of pool.sort(() => Math.random() - 0.5)) { if (result.length >= count) break; result.push(c); used.add(c.id); }
    }
    return result.sort(() => Math.random() - 0.5);
  }

  // ============ 路由 ============
  function route() {
    const hash = location.hash.slice(1) || '/';
    const [path, query] = hash.split('?');
    const params = new URLSearchParams(query || '');
    // 从 URL query 读取模式（避免 onclick 字符串无法访问闭包内 viewState）
    if (params.get('mode') === 'replay') viewState = { replay: true };
    else if (params.get('mode') === 'wrong') viewState = { wrongPractice: true };
    else if (!viewState || (!viewState.replay && !viewState.wrongPractice)) viewState = {};
    const app = document.getElementById('app');
    if (path === '/' || path === '') renderHome(app);
    else if (path === '/study') renderStudy(app);
    else if (path === '/wrongbook') renderWrongBook(app);
    else if (path === '/library') renderLibrary(app);
    else if (path === '/stats') renderStats(app);
    else if (path === '/settings') renderSettings(app);
    else if (path === '/learn' || path === '/review') location.hash = '#/study';
    else if (path === '/nextday') advanceDay();
    else renderHome(app);
    window.scrollTo(0, 0);
  }

  function toast(msg) {
    const t = document.createElement('div');
    t.className = 'toast'; t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 2400);
  }

  // ============ 首页 ============
  function renderHome(app) {
    const queue = buildStudyQueue();
    const newCount = queue.filter(q => q.type === 'new').length;
    const reviewCount = queue.filter(q => q.type === 'review').length;
    const wrongCount = progress.wrongBook.length;
    const learnedPct = (progress.totalLearned / CHARLIB.length) * 100;
    const masteredPct = progress.totalLearned > 0 ? (progress.totalMastered / progress.totalLearned) * 100 : 0;
    const hasTask = queue.length > 0;
    const todayDone = todayNewLearned() >= progress.dailyNew && getDueReviews().length === 0;

    app.innerHTML = `
      <div class="topbar">
        <div class="topbar-title"><span class="logo">📖</span><span>趣味识字</span></div>
        <div class="topbar-stats">
          <div class="stat-pill"><span class="icon">⭐</span><span>${progress.totalStars}</span></div>
          <div class="stat-pill"><span class="icon">🔥</span><span>${progress.streakDays}</span></div>
        </div>
      </div>
      <div class="page">
        <div class="hero">
          <h1>每天学一点，认识大世界</h1>
          <p>适合5-6岁 · ${CHARLIB.length}字 · 由易到难${progress.simDayOffset > 0 ? ` · 📅 模拟第${progress.simDayOffset + 1}天` : ''}</p>
        </div>

        <div class="task-card study ${hasTask ? '' : 'done'}" onclick="${hasTask ? "location.hash='#/study'" : ''}">
          <div class="task-icon">${hasTask ? '🚀' : '🎉'}</div>
          <h3>今日学习</h3>
          <div class="task-sub">${hasTask
            ? `复习 ${reviewCount} 个 + 新学 ${newCount} 个，共 ${queue.length} 个`
            : '今天的任务都完成啦，真棒！'}</div>
          ${hasTask ? `
            <div class="task-meta"><span>今日进度</span><span>${todayNewLearned() + todayReviewed()} 个</span></div>
            <div class="progress-bar"><div class="fill" style="width:${Math.min(100, (todayNewLearned() + todayReviewed()) / Math.max(1, queue.length) * 100)}%"></div></div>
            <button class="btn btn-primary">开始学习 →</button>
          ` : `
            <button class="btn btn-primary" onclick="event.stopPropagation();location.hash='#/nextday'">📅 进行下一日学习 →</button>
            <button class="btn btn-outline" onclick="event.stopPropagation();location.hash='#/study?mode=replay'">🔁 再学一遍</button>
          `}
        </div>

        ${wrongCount > 0 ? `
          <div class="task-card wrongbook" onclick="location.hash='#/wrongbook'">
            <div class="task-icon">⚠️</div>
            <h3>错题本</h3>
            <div class="task-sub">有 ${wrongCount} 个字需要重点复习</div>
            <button class="btn btn-warn">去复习错题 →</button>
          </div>
        ` : ''}

        <div class="overview">
          <h3>📊 学习进度</h3>
          <div class="nums">
            <div><div class="num">${progress.totalLearned}</div><div class="label">已学汉字</div></div>
            <div><div class="num" style="color:var(--success)">${progress.totalMastered}</div><div class="label">已掌握</div></div>
            <div><div class="num" style="color:var(--star)">${todayStars()}</div><div class="label">今日星星</div></div>
          </div>
          <div class="bar-row"><span>总体进度</span><span>${progress.totalLearned} / ${CHARLIB.length}</span></div>
          <div class="progress-bar"><div class="fill" style="width:${learnedPct}%"></div></div>
          <div class="bar-row" style="margin-top:8px"><span>掌握率</span><span>${progress.totalMastered} / ${progress.totalLearned}</span></div>
          <div class="progress-bar"><div class="fill" style="width:${masteredPct}%;background:var(--success)"></div></div>
        </div>

        <div class="achievements">
          <h3>🏆 成就墙 <span style="font-size:12px;color:var(--text-light);font-weight:400">${progress.achievements.length}/${ACHIEVEMENTS.length}</span></h3>
          <div class="ach-grid">
            ${ACHIEVEMENTS.map(a => `<div class="ach-item ${progress.achievements.includes(a.id) ? '' : 'locked'}" title="${a.name}"><div class="ach-icon">${a.icon}</div><div class="ach-name">${a.name}</div></div>`).join('')}
          </div>
        </div>

        <div class="bottom-nav">
          <button class="btn btn-outline" onclick="location.hash='#/library'">📚 字库</button>
          <button class="btn btn-outline" onclick="location.hash='#/stats'">📈 统计</button>
          <button class="btn btn-outline" onclick="location.hash='#/settings'">⚙️ 设置</button>
        </div>
        <p style="text-align:center;font-size:11px;color:var(--text-light);padding:16px 0 8px">数据保存在本地浏览器 · 可离线使用</p>
      </div>
    `;
  }

  // ============ 混合学习 ============
  function renderStudy(app) {
    let queue;
    if (viewState && viewState.replay) {
      const recent = progress.learnedIds.slice(-Math.min(progress.dailyNew + progress.dailyReviewLimit, progress.learnedIds.length));
      queue = recent.map(id => CHARLIB.find(c => c.id === id)).filter(c => c).map(c => ({ type: 'review', char: c, replay: true }));
      if (queue.length === 0) { app.innerHTML = renderDoneHTML('还没有学过的字', '先去学几个新字再来复习吧！', 0, false); return; }
    } else if (viewState && viewState.wrongPractice) {
      queue = getWrongBookChars().map(c => ({ type: 'review', char: c, wrongPractice: true }));
      if (queue.length === 0) { app.innerHTML = renderDoneHTML('错题本是空的', '没有错题，学得很扎实！', 0, false); return; }
    } else {
      queue = buildStudyQueue();
    }

    if (queue.length === 0) {
      app.innerHTML = renderDoneHTML('今日学习完成啦！', `今天学了 ${todayNewLearned()} 个新字，复习 ${todayReviewed()} 个`, 0, true);
      return;
    }

    const isReplay = !!(viewState && viewState.replay);
    const isWrong = !!(viewState && viewState.wrongPractice);
    viewState = {
      queue, idx: 0, stars: 0, correctCount: 0, combo: 0, maxCombo: 0,
      feedback: null, replay: isReplay, wrongPractice: isWrong, startTime: Date.now(),
    };
    renderStudyIntro(app);
  }

  function renderStudyIntro(app) {
    const { queue } = viewState;
    const newCount = queue.filter(q => q.type === 'new').length;
    const reviewCount = queue.filter(q => q.type === 'review').length;

    app.innerHTML = `
      <div class="back-bar"><button class="back-btn" onclick="location.hash='#/'">←</button></div>
      <div class="char-card" style="margin-top:40px">
        <div style="font-size:72px;margin-bottom:16px">${viewState.wrongPractice ? '⚠️' : (viewState.replay ? '🔁' : '🚀')}</div>
        <h2 style="font-size:24px;margin-bottom:8px">${viewState.wrongPractice ? '错题复习' : (viewState.replay ? '再学一遍' : '今日学习')}</h2>
        <p style="color:var(--text-light);margin-bottom:20px">
          ${viewState.replay ? '巩固今天学过的字，不计星星不更新进度'
            : viewState.wrongPractice ? `共 ${queue.length} 个错题，连续答对 ${MASTER_STREAK} 次才能移出`
            : `复习 ${reviewCount} 个 + 新学 ${newCount} 个，共 ${queue.length} 个`}
        </p>
        <div style="background:#E3F2FD;border-radius:12px;padding:14px;margin-bottom:20px;text-align:left;font-size:14px;color:var(--text-light)">
          <p style="font-weight:600;color:var(--text);margin-bottom:6px">学习流程：</p>
          <p>🔁 先复习旧字，激活记忆</p>
          <p>🌱 再学新字（看三组图 → 听音 → 做练习）</p>
          <p>⚡ 答对连击有奖励，答错进错题本</p>
        </div>
        <button class="btn btn-primary" id="startBtn">开始学习 🚀</button>
      </div>
    `;
    document.getElementById('startBtn').onclick = () => { ensureAudio(); renderStudyStep(app); };
  }

  function renderStudyStep(app) {
    const { queue, idx } = viewState;
    const step = queue[idx];
    if (!step) { renderStudyDone(app); return; }
    if (step.type === 'new') renderNewCharFlow(app, step, 0);
    else renderReviewFlow(app, step, 0);
  }

  function nextStep(app, newAch) {
    if (newAch) newAch.forEach(a => setTimeout(() => toast(`🎉 解锁成就：${a.name} ${a.icon}`), 600));
    if (viewState.idx + 1 >= viewState.queue.length) renderStudyDone(app);
    else { viewState.idx++; renderStudyStep(app); }
  }

  function progressPct(extra) {
    const total = viewState.queue.length;
    const base = viewState.idx + (extra || 0);
    return Math.min(100, (base / total) * 100);
  }

  // ============ 新字五步流 ============
  function renderNewCharFlow(app, step, subStep) {
    const item = step.char;
    const subLabels = ['看图认字', '听音跟读', '看图选字', '听音选字', '看字选词'];
    const counter = `${viewState.idx + 1} / ${viewState.queue.length}`;

    if (subStep >= 5) {
      markLearned(item);
      viewState.stars++; viewState.combo++;
      viewState.maxCombo = Math.max(viewState.maxCombo, viewState.combo);
      progress.maxCombo = Math.max(progress.maxCombo || 0, viewState.maxCombo);
      saveProgress();
      sfxCorrect(); if (viewState.combo >= 3) sfxCombo(viewState.combo);
      const newAch = checkAchievements();
      nextStep(app, newAch);
      return;
    }

    if (subStep === 0) renderThreeImages(app, step, counter, subLabels[subStep]);
    else if (subStep === 1) renderListenRepeat(app, item, counter, subLabels[subStep], () => renderNewCharFlow(app, step, 2));
    else if (subStep === 2) renderPicToChar(app, item, counter, subLabels[subStep], 'new',
      () => renderNewCharFlow(app, step, 3),
      () => renderNewCharFlow(app, step, 2));
    else if (subStep === 3) renderAudioToChar(app, item, counter, subLabels[subStep], 'new',
      () => renderNewCharFlow(app, step, 4),
      () => renderNewCharFlow(app, step, 3));
    else if (subStep === 4) {
      if (!item.w || item.w.length === 0) { renderNewCharFlow(app, step, 5); return; }
      renderCharToWord(app, item, counter, subLabels[subStep], 'new',
        () => renderNewCharFlow(app, step, 5),
        () => renderNewCharFlow(app, step, 4));
    }
  }

  // 三组图
  function renderThreeImages(app, step, counter, subLabel) {
    const item = step.char;
    const hasEmoji = item.e && item.e !== '📖';
    const goodWords = getGoodWords(item);
    const hasWords = goodWords.length > 0;
    const hasSentence = item.s && item.s.length > 0;
    const hasStory = item.st && item.st.length > 0;

    app.innerHTML = `
      <div class="learn-header">
        <button class="exit-btn" onclick="if(confirm('退出学习？进度已保存'))location.hash='#/'">✕</button>
        <span class="counter">${counter} · ${subLabel}</span>
        ${viewState.combo >= 2 ? `<span class="combo-badge">⚡${viewState.combo}连</span>` : '<span style="width:36px"></span>'}
      </div>
      <div class="learn-progress"><div class="fill" style="width:${progressPct(0.1)}%"></div></div>
      <div class="char-card three-img">
        <div class="img-group img-1">
          <div class="img-label">① 实物联想</div>
          <div class="img-content">
            <span class="big-emoji">${hasEmoji ? item.e : `<span class="char-font" style="font-size:80px;color:var(--primary)">${item.c}</span>`}</span>
            <div class="img-hint">${hasEmoji ? `看到这个，就想到「${item.c}」字` : `仔细看「${item.c}」字的样子`}</div>
          </div>
        </div>
        <div class="img-group img-2">
          <div class="img-label">② 记忆口诀</div>
          <div class="img-content">
            ${hasStory
              ? `<div class="mnemonic">💡 ${item.st}</div>`
              : `<div class="big-char char-font" style="font-size:72px;color:var(--primary)">${item.c}</div>
                 <div class="img-hint">仔细看看「${item.c}」字怎么写</div>`}
          </div>
        </div>
        <div class="img-group img-3">
          <div class="img-label">③ 场景应用</div>
          <div class="img-content">
            ${hasSentence ? `<div class="scene-sentence">💬 ${item.s}</div>` : `<div class="scene-sentence">💬 用「${item.c}」说一句话</div>`}
            ${hasWords ? `<div class="scene-words">${goodWords.map(w => `<span class="word-chip">${w}</span>`).join('')}</div>` : ''}
          </div>
        </div>
        <button class="btn btn-primary" id="nextImg" style="margin-top:16px">听读音 →</button>
      </div>
    `;
    document.getElementById('nextImg').onclick = () => renderNewCharFlow(app, step, 1);
  }

  // 听音跟读
  function renderListenRepeat(app, item, counter, subLabel, onNext) {
    app.innerHTML = `
      <div class="learn-header">
        <button class="exit-btn" onclick="if(confirm('退出学习？进度已保存'))location.hash='#/'">✕</button>
        <span class="counter">${counter} · ${subLabel}</span>
        ${viewState.combo >= 2 ? `<span class="combo-badge">⚡${viewState.combo}连</span>` : '<span style="width:36px"></span>'}
      </div>
      <div class="learn-progress"><div class="fill" style="width:${progressPct(0.25)}%"></div></div>
      <div class="char-card">
        <div class="big-char char-font">${item.c}</div>
        ${item.sp ? `<div class="pinyin">${item.p}</div>` : `<div class="no-pinyin-hint">先认字，不学拼音哦</div>`}
        <button class="speak-btn" id="speakBtn" title="听读音">🔊</button>
        <p style="color:var(--text-light);margin:12px 0">点喇叭听一听，跟着读一读</p>
        <button class="btn btn-primary" id="nextBtn">读好了，做练习 →</button>
      </div>
    `;
    const speakBtn = document.getElementById('speakBtn');
    speakBtn.onclick = () => speak(item.c, speakBtn);
    setTimeout(() => speak(item.c, speakBtn), 300);
    document.getElementById('nextBtn').onclick = onNext;
  }

  // ============ 题型组件（统一接收 onCorrect/onWrong 回调）============

  function renderLearnHeader(counter, subLabel) {
    return `
      <div class="learn-header">
        <button class="exit-btn" onclick="if(confirm('退出学习？进度已保存'))location.hash='#/'">✕</button>
        <span class="counter">${counter}${subLabel ? ' · ' + subLabel : ''}</span>
        ${viewState.combo >= 2 ? `<span class="combo-badge">⚡${viewState.combo}连</span>` : '<span style="width:36px"></span>'}
      </div>
    `;
  }

  // 看图选字
  function renderPicToChar(app, item, counter, subLabel, mode, onCorrect, onWrong) {
    const options = [item, ...getDistractors(item, 3)].sort(() => Math.random() - 0.5);
    viewState.options = options; viewState.feedback = null; viewState.selectedIdx = -1;
    const wordHint = (item.w && item.w.length) ? item.w[0] : item.c;
    const prompt = mode === 'new' ? `哪个字是「${wordHint}」里的` : '选出正确的字';

    app.innerHTML = `
      ${renderLearnHeader(counter, subLabel)}
      <div class="learn-progress"><div class="fill" style="width:${progressPct(0.4)}%"></div></div>
      <div class="char-card" style="padding:20px 16px">
        <div class="quiz-prompt">${prompt}<span class="highlight">${item.e || '📖'}</span>${mode === 'review' ? `<span class="word-hint">「${wordHint}」</span>` : ''}</div>
        <div class="options-grid" id="optGrid">${options.map((opt, i) => `<button class="option-btn" data-i="${i}">${opt.c}</button>`).join('')}</div>
        <div id="feedbackArea"></div>
      </div>
    `;
    bindAnswer(app, item, mode, onCorrect, onWrong, opt => opt.id === item.id);
  }

  // 听音选字
  function renderAudioToChar(app, item, counter, subLabel, mode, onCorrect, onWrong) {
    const options = [item, ...getDistractors(item, 3)].sort(() => Math.random() - 0.5);
    viewState.options = options; viewState.feedback = null; viewState.selectedIdx = -1;

    app.innerHTML = `
      ${renderLearnHeader(counter, subLabel)}
      <div class="learn-progress"><div class="fill" style="width:${progressPct(0.55)}%"></div></div>
      <div class="char-card" style="padding:20px 16px">
        <div class="quiz-prompt">听一听，选出听到的字<button class="speak-btn" id="audioBtn" title="再听一次" style="margin:8px auto;display:flex">🔊</button></div>
        <div class="options-grid" id="optGrid">${options.map((opt, i) => `<button class="option-btn" data-i="${i}">${opt.c}</button>`).join('')}</div>
        <div id="feedbackArea"></div>
      </div>
    `;
    const ab = document.getElementById('audioBtn');
    ab.onclick = () => speak(item.c, ab);
    setTimeout(() => speak(item.c, ab), 300);
    bindAnswer(app, item, mode, onCorrect, onWrong, opt => opt.id === item.id);
  }

  // 看字选词
  function renderCharToWord(app, item, counter, subLabel, mode, onCorrect, onWrong) {
    const goodWords = getGoodWords(item);
    if (goodWords.length === 0) { onCorrect(); return; }
    const correctWord = goodWords[0];
    const otherWords = []; const used = new Set([correctWord]);
    for (const c of CHARLIB.slice(0, 300)) {
      const gw = getGoodWords(c);
      if (gw.length && !used.has(gw[0]) && otherWords.length < 3) { otherWords.push({ word: gw[0], correct: false }); used.add(gw[0]); }
    }
    while (otherWords.length < 3) {
      const c = CHARLIB[Math.floor(Math.random() * 300)];
      if (c.w && c.w.length && !used.has(c.w[0])) { otherWords.push({ word: c.w[0], correct: false }); used.add(c.w[0]); }
    }
    const options = [{ word: correctWord, correct: true }, ...otherWords].sort(() => Math.random() - 0.5);
    viewState.options = options; viewState.feedback = null;

    app.innerHTML = `
      ${renderLearnHeader(counter, subLabel)}
      <div class="learn-progress"><div class="fill" style="width:${progressPct(0.7)}%"></div></div>
      <div class="char-card" style="padding:20px 16px">
        <div class="quiz-prompt">「<span class="highlight char-font" style="font-size:48px">${item.c}</span>」和哪个词搭配？</div>
        <div class="options-grid word-grid" id="optGrid">${options.map((opt, i) => `<button class="option-btn word-opt" data-i="${i}">${opt.word}</button>`).join('')}</div>
        <div id="feedbackArea"></div>
      </div>
    `;
    bindAnswer(app, item, mode, onCorrect, onWrong, opt => opt.correct);
  }

  // 看字选图
  function renderCharToPic(app, item, counter, subLabel, mode, onCorrect, onWrong) {
    if (!item.e || item.e === '📖') { renderPicToChar(app, item, counter, subLabel, mode, onCorrect, onWrong); return; }
    let distractors = getDistractors(item, 3).filter(c => c.e && c.e !== '📖');
    let tries = 0;
    while (distractors.length < 3 && tries < 50) {
      const c = CHARLIB[Math.floor(Math.random() * 150)];
      if (c.e && c.e !== '📖' && c.id !== item.id && !distractors.find(d => d.id === c.id)) distractors.push(c);
      tries++;
    }
    const options = [item, ...distractors.slice(0, 3)].sort(() => Math.random() - 0.5);
    viewState.options = options; viewState.feedback = null; viewState.selectedIdx = -1;

    app.innerHTML = `
      ${renderLearnHeader(counter, subLabel)}
      <div class="learn-progress"><div class="fill" style="width:${progressPct(0.4)}%"></div></div>
      <div class="char-card" style="padding:20px 16px">
        <div class="quiz-prompt">「<span class="highlight char-font" style="font-size:48px">${item.c}</span>」对应哪幅图？</div>
        <div class="options-grid pic-grid" id="optGrid">${options.map((opt, i) => `<button class="option-btn pic-opt" data-i="${i}">${opt.e}</button>`).join('')}</div>
        <div id="feedbackArea"></div>
      </div>
    `;
    bindAnswer(app, item, mode, onCorrect, onWrong, opt => opt.id === item.id);
  }

  // 统一答题绑定
  function bindAnswer(app, item, mode, onCorrect, onWrong, isCorrectFn) {
    document.querySelectorAll('.option-btn').forEach(btn => {
      btn.onclick = () => {
        const i = parseInt(btn.dataset.i);
        const opt = viewState.options[i];
        const correct = isCorrectFn(opt);
        viewState.selectedIdx = i;
        handleAnswer(app, item, correct, mode, onCorrect, onWrong);
      };
    });
  }

  // 统一处理答题
  function handleAnswer(app, item, correct, mode, onCorrect, onWrong) {
    const opts = document.querySelectorAll('.option-btn');
    opts.forEach(o => o.disabled = true);

    if (correct) {
      opts.forEach(o => { const i = parseInt(o.dataset.i); if (viewState.options[i] && (viewState.options[i].id === item.id || viewState.options[i].correct)) o.classList.add('correct'); });
      sfxCorrect();
      viewState.combo++;
      viewState.maxCombo = Math.max(viewState.maxCombo, viewState.combo);
      progress.maxCombo = Math.max(progress.maxCombo || 0, viewState.maxCombo);

      if (mode === 'new') {
        viewState.stars++;
      } else if (viewState.replay) {
        // 再学一遍：不更新进度，只计 combo
        viewState.correctCount++;
      } else {
        const res = reviewAnswer(item.id, true);
        viewState.stars += res.stars; viewState.correctCount++;
        if (res.mastered) toast(`🎉「${item.c}」已掌握！`);
      }
      if (viewState.combo >= 3) sfxCombo(viewState.combo);
      saveProgress();
      const newAch = checkAchievements();
      showFeedback(app, true, item, '', onCorrect, newAch);
    } else {
      opts.forEach(o => { const i = parseInt(o.dataset.i); if (i === viewState.selectedIdx) o.classList.add('wrong'); if (viewState.options[i] && (viewState.options[i].id === item.id || viewState.options[i].correct)) o.classList.add('correct'); });
      sfxWrong();
      viewState.combo = 0;

      if (mode === 'new') {
        if (!progress.records[item.id]) markLearned(item);
        const r = progress.records[item.id];
        if (r) { r.streak = 0; r.weak = true; r.box = 1; if (!progress.wrongBook.includes(item.id)) progress.wrongBook.push(item.id); saveProgress(); }
        showFeedback(app, false, item, '没关系，再看一眼，重新选', onWrong);
      } else {
        if (!viewState.replay) {
          const res = reviewAnswer(item.id, false);
          showFeedback(app, false, item, '答错进错题本，重新选', onWrong);
        } else {
          showFeedback(app, false, item, '再想想，重新选', onWrong);
        }
      }
    }
  }

  function showFeedback(app, correct, item, extra, onContinue, newAch) {
    const area = document.getElementById('feedbackArea');
    if (!area) { onContinue(); return; }
    const isLast = viewState.idx + 1 >= viewState.queue.length;
    area.innerHTML = `
      <div class="feedback ${correct ? 'correct' : 'wrong'}">
        ${correct ? `<span class="fb-icon">⭐</span><div class="fb-text">${viewState.combo >= 3 ? `太棒了！${viewState.combo}连击！` : '答对了！'}</div>`
                 : `<span class="fb-icon">💪</span><div class="fb-text">正确答案是「${item.c}」</div>`}
        ${extra ? `<div style="font-size:13px;color:var(--text-light);margin-bottom:8px">${extra}</div>` : ''}
        <button class="btn ${correct ? 'btn-success' : 'btn-outline'}" id="contBtn">${correct ? (isLast ? '完成 🎉' : '下一个 →') : '重新选择 →'}</button>
      </div>
    `;
    // 答对后自动进入下一题（防重复触发）
    let triggered = false;
    const safeContinue = () => { if (triggered) return; triggered = true; onContinue(); };
    document.getElementById('contBtn').onclick = safeContinue;
    if (correct && progress.autoNext !== false) {
      setTimeout(safeContinue, 1300);
    }
    if (newAch) newAch.forEach(a => setTimeout(() => toast(`🎉 解锁成就：${a.name} ${a.icon}`), 400));
  }

  // ============ 复习流：随机2种题型 ============
  function renderReviewFlow(app, step, subIdx) {
    const item = step.char;
    // 每个复习字重新随机题型（subIdx===0 表示新字开始）
    if (subIdx === 0) {
      const types = ['picToChar', 'audioToChar', 'charToWord'];
      if (item.e && item.e !== '📖') types.push('charToPic');
      viewState.reviewSteps = types.sort(() => Math.random() - 0.5).slice(0, 2);
      viewState.reviewStepMax = viewState.reviewSteps.length;
      viewState.reviewStepIdx = 0;
    }
    if (subIdx >= viewState.reviewStepMax) { nextStep(app); return; }

    const counter = `${viewState.idx + 1} / ${viewState.queue.length}`;
    const t = viewState.reviewSteps[subIdx];
    const labels = { picToChar: '看图选字', audioToChar: '听音选字', charToWord: '看字选词', charToPic: '看字选图' };
    const onCorrect = () => { viewState.reviewStepIdx = (viewState.reviewStepIdx || 0) + 1; renderReviewFlow(app, step, viewState.reviewStepIdx); };
    const onWrong = () => renderReviewFlow(app, step, subIdx);

    if (t === 'picToChar') renderPicToChar(app, item, counter, labels[t], 'review', onCorrect, onWrong);
    else if (t === 'audioToChar') renderAudioToChar(app, item, counter, labels[t], 'review', onCorrect, onWrong);
    else if (t === 'charToWord') renderCharToWord(app, item, counter, labels[t], 'review', onCorrect, onWrong);
    else if (t === 'charToPic') renderCharToPic(app, item, counter, labels[t], 'review', onCorrect, onWrong);
  }

  // ============ 完成页 ============
  function renderStudyDone(app) {
    const newAch = checkAchievements();
    const total = viewState.queue.length;
    const correct = viewState.correctCount;
    const newLearned = viewState.queue.filter(q => q.type === 'new').length;
    const reviewed = viewState.queue.filter(q => q.type === 'review').length;
    const duration = Math.round((Date.now() - (viewState.startTime || Date.now())) / 1000);
    const min = Math.floor(duration / 60), sec = duration % 60;
    sfxComplete(); confetti();

    let starHtml = '';
    for (let i = 0; i < Math.min(viewState.stars, 5); i++) starHtml += '<span class="star">⭐</span>';
    if (viewState.stars > 5) starHtml += `<span style="font-size:20px;align-self:center">+${viewState.stars - 5}</span>`;

    app.innerHTML = `
      <div class="back-bar"><button class="back-btn" onclick="location.hash='#/'">←</button></div>
      <div class="done-card">
        <div class="done-icon">🎉</div>
        <h2>学习完成！</h2>
        <p>${viewState.replay ? '巩固了一遍今日所学' : viewState.wrongPractice ? `复习了 ${total} 个错题` : `新学 ${newLearned} · 复习 ${reviewed} · 答对 ${correct}/${total}`}</p>
        ${viewState.stars > 0 ? `<div class="stars-earned">${starHtml}</div>` : ''}
        <div style="background:#FFF8E7;border-radius:12px;padding:14px;margin:16px 0;font-size:14px;color:var(--text)">
          ${viewState.maxCombo >= 2 ? `<div>⚡ 最高连击：${viewState.maxCombo} 连</div>` : ''}
          <div>⏱️ 用时：${min}分${sec}秒</div>
          ${progress.wrongBook.length > 0 ? `<div>⚠️ 错题本：${progress.wrongBook.length} 个待复习</div>` : ''}
        </div>
        <div class="actions">
          ${viewState.wrongPractice
            ? `<button class="btn btn-primary" onclick="location.hash='#/study?mode=wrong'">🔁 再练一遍错题</button>`
            : `<button class="btn btn-primary" id="replayBtn">🔁 再学一遍</button>
               <button class="btn btn-outline" id="newDayBtn">📅 进入下一天 →</button>`}
          ${progress.wrongBook.length > 0 ? `<button class="btn btn-outline" onclick="location.hash='#/wrongbook'">📋 错题本</button>` : ''}
          <button class="btn btn-outline" onclick="location.hash='#/'">返回首页</button>
        </div>
      </div>
    `;
    const replayBtn = document.getElementById('replayBtn');
    if (replayBtn) replayBtn.onclick = () => { location.hash = '#/study?mode=replay'; };
    const newDayBtn = document.getElementById('newDayBtn');
    if (newDayBtn) newDayBtn.onclick = () => { advanceDay(); };
    newAch.forEach(a => setTimeout(() => toast(`🎉 解锁成就：${a.name} ${a.icon}`), 500));
  }

  // 推进到下一天：模拟日期 +1，让按真实间隔该到期的字进入复习队列
  function advanceDay() {
    progress.simDayOffset = (progress.simDayOffset || 0) + 1;
    saveProgress();
    const day = progress.simDayOffset + 1;
    toast(`已进入第 ${day} 天（模拟）`);
    viewState = {};
    location.hash = '#/';
  }

  function renderDoneHTML(title, sub, stars, withReplay) {
    let starHtml = '';
    for (let i = 0; i < Math.min(stars, 5); i++) starHtml += '<span class="star">⭐</span>';
    return `
      <div class="back-bar"><button class="back-btn" onclick="location.hash='#/'">←</button></div>
      <div class="done-card">
        <div class="done-icon">🎉</div>
        <h2>${title}</h2>
        <p>${sub}</p>
        ${stars > 0 ? `<div class="stars-earned">${starHtml}</div>` : ''}
        <div class="actions">
          ${withReplay ? `<button class="btn btn-primary" onclick="location.hash='#/study?mode=replay'">🔁 再学一遍</button>` : ''}
          <button class="btn btn-outline" onclick="location.hash='#/'">返回首页</button>
        </div>
      </div>
    `;
  }

  // ============ 错题本页 ============
  function renderWrongBook(app) {
    const chars = getWrongBookChars();
    app.innerHTML = `
      <div class="back-bar"><button class="back-btn" onclick="location.hash='#/'">←</button><strong style="font-size:18px">⚠️ 错题本</strong></div>
      ${chars.length === 0 ? `
        <div class="char-card" style="margin-top:40px">
          <div style="font-size:64px;margin-bottom:12px">✨</div>
          <h2 style="margin-bottom:8px">错题本是空的！</h2>
          <p style="color:var(--text-light);margin-bottom:20px">没有错题，说明学得很扎实！</p>
          <button class="btn btn-outline" onclick="location.hash='#/'">返回首页</button>
        </div>
      ` : `
        <div class="page">
          <div style="background:#FFF3E0;border-radius:12px;padding:14px;margin-bottom:16px;font-size:14px;color:var(--text)">
            📋 共 ${chars.length} 个字需要重点复习。每个字连续答对 ${MASTER_STREAK} 次才能移出错题本。
          </div>
          <button class="btn btn-warn" id="practiceWrong" style="margin-bottom:16px">开始复习错题 →</button>
          <div class="char-grid">
            ${chars.map(c => `<div class="char-cell learned" data-id="${c.id}">${c.c}<span class="badge">⚠️</span></div>`).join('')}
          </div>
          <button class="btn btn-outline" id="clearWrong" style="margin-top:16px">标记全部为已掌握（清空错题本）</button>
        </div>
      `}
    `;
    const pw = document.getElementById('practiceWrong');
    if (pw) pw.onclick = () => { location.hash = '#/study?mode=wrong'; };
    const cw = document.getElementById('clearWrong');
    if (cw) {
      let armed = false, armTimer = null;
      cw.onclick = () => {
        if (!armed) {
          armed = true;
          cw.textContent = '⚠️ 再点一次确认清空';
          cw.style.background = 'var(--danger)';
          cw.style.color = 'white';
          toast('再点一次确认清空错题本');
          armTimer = setTimeout(() => {
            armed = false;
            cw.textContent = '标记全部为已掌握（清空错题本）';
            cw.style.background = '';
            cw.style.color = '';
          }, 4000);
          return;
        }
        clearTimeout(armTimer);
        progress.wrongBook.forEach(id => { const r = progress.records[id]; if (r) { r.mastered = true; r.weak = false; r.streak = MASTER_STREAK; } });
        progress.wrongBook = [];
        progress.totalMastered = Object.values(progress.records).filter(x => x.mastered).length;
        progress.wbCleared = (progress.wbCleared || 0) + 1;
        saveProgress(); toast('错题本已清空'); route();
      };
    }
  }

  // ============ 字库 ============
  function renderLibrary(app) {
    viewState = { level: 1, search: '', selected: null };
    renderLibraryContent(app);
  }

  function renderLibraryContent(app) {
    const { level, search, selected } = viewState;
    const levels = [
      { lv: 1, name: 'L1 启蒙' }, { lv: 2, name: 'L2 入门' }, { lv: 3, name: 'L3 基础' },
      { lv: 4, name: 'L4 进阶' }, { lv: 5, name: 'L5 提高' }, { lv: 6, name: 'L6 挑战' },
    ];
    let list;
    if (search.trim()) {
      list = CHARLIB.filter(c => c.c === search.trim() || c.p.includes(search.trim()) || (c.w && c.w.some(w => w.includes(search.trim())))).slice(0, 200);
    } else {
      list = CHARLIB.filter(c => c.lv === level).slice(0, 200);
    }
    const learnedSet = new Set(progress.learnedIds);
    const masteredSet = new Set(Object.values(progress.records).filter(r => r.mastered).map(r => r.charId));
    const wrongSet = new Set(progress.wrongBook);

    app.innerHTML = `
      <div class="back-bar"><button class="back-btn" onclick="location.hash='#/'">←</button><strong style="font-size:18px">📚 字库浏览</strong></div>
      <div class="search-box"><input type="text" placeholder="搜索字、拼音或词语..." value="${search}" id="searchInput"></div>
      <div class="level-tabs">${levels.map(l => `<div class="level-tab ${!search && level === l.lv ? 'active' : ''}" data-lv="${l.lv}">${l.name}</div>`).join('')}</div>
      <div class="char-grid">
        ${list.map(c => {
          let cls = 'char-cell';
          if (wrongSet.has(c.id)) cls += ' wrong';
          else if (masteredSet.has(c.id)) cls += ' mastered';
          else if (learnedSet.has(c.id)) cls += ' learned';
          const badge = wrongSet.has(c.id) ? '⚠️' : (masteredSet.has(c.id) ? '⭐' : (learnedSet.has(c.id) ? '✓' : ''));
          return `<div class="${cls}" data-id="${c.id}">${c.c}<span class="badge">${badge}</span></div>`;
        }).join('')}
      </div>
      ${list.length === 0 ? '<p style="text-align:center;color:var(--text-light);padding:40px">没有找到相关汉字</p>' : ''}
      ${selected ? renderCharModal(selected) : ''}
    `;

    document.getElementById('searchInput').oninput = (e) => {
      viewState.search = e.target.value; renderLibraryContent(app);
      const inp = document.getElementById('searchInput');
      if (inp) { inp.focus(); inp.setSelectionRange(e.target.value.length, e.target.value.length); }
    };
    document.querySelectorAll('.level-tab').forEach(t => { t.onclick = () => { viewState.level = parseInt(t.dataset.lv); viewState.search = ''; renderLibraryContent(app); }; });
    document.querySelectorAll('.char-cell').forEach(c => { c.onclick = () => { viewState.selected = parseInt(c.dataset.id); renderLibraryContent(app); }; });
    const closeBtn = document.getElementById('modalClose');
    if (closeBtn) closeBtn.onclick = () => { viewState.selected = null; renderLibraryContent(app); };
    const modalSpeak = document.getElementById('modalSpeak');
    if (modalSpeak) modalSpeak.onclick = () => { const ch = CHARLIB.find(c => c.id === viewState.selected); if (ch) speak(ch.c, modalSpeak); };
  }

  function renderCharModal(id) {
    const c = CHARLIB.find(x => x.id === id);
    if (!c) return '';
    const learned = progress.learnedIds.includes(c.id);
    const mastered = progress.records[c.id] && progress.records[c.id].mastered;
    const isWrong = progress.wrongBook.includes(c.id);
    return `
      <div class="modal-overlay" id="modalClose">
        <div class="modal" onclick="event.stopPropagation()">
          <div class="modal-emoji">${c.e || '📖'}</div>
          <div class="modal-char char-font">${c.c}</div>
          ${c.sp ? `<div class="modal-pinyin">${c.p}</div>` : '<div class="no-pinyin-hint">先认字，不学拼音哦</div>'}
          <div class="modal-badges">
            <span class="tag">L${c.lv}</span>
            ${isWrong ? '<span class="tag" style="background:#FFCDD2">错题</span>' : (mastered ? '<span class="tag" style="background:#A5D6A7">已掌握</span>' : (learned ? '<span class="tag" style="background:#FFE0B2">已学</span>' : ''))}
          </div>
          <button class="speak-btn" id="modalSpeak" style="margin:8px 0">🔊</button>
          ${getGoodWords(c).length ? `<div class="modal-words">${getGoodWords(c).map(w => `<span class="tag">${w}</span>`).join('')}</div>` : ''}
          ${c.s ? `<div class="modal-sentence">💬 ${c.s}</div>` : ''}
          ${c.st ? `<div class="modal-story">💡 ${c.st}</div>` : ''}
          <button class="btn btn-outline" onclick="document.getElementById('modalClose').click()">关闭</button>
        </div>
      </div>
    `;
  }

  // ============ 统计 ============
  function renderStats(app) {
    const total = CHARLIB.length;
    const learnedPct = (progress.totalLearned / total) * 100;
    const masteredPct = progress.totalLearned > 0 ? (progress.totalMastered / progress.totalLearned) * 100 : 0;
    const last14 = progress.history.slice(-14);
    const maxStars = Math.max(1, ...last14.map(d => d.stars));
    const allRecords = Object.values(progress.records);
    const totalReviews = allRecords.reduce((s, r) => s + r.reviewCount, 0);
    const totalCorrect = allRecords.reduce((s, r) => s + r.correctCount, 0);
    const accuracy = totalReviews > 0 ? (totalCorrect / totalReviews * 100) : 0;
    const levelStats = [1, 2, 3, 4, 5, 6].map(lv => {
      const all = CHARLIB.filter(c => c.lv === lv);
      const learned = all.filter(c => progress.learnedIds.includes(c.id));
      const mastered = all.filter(c => progress.records[c.id] && progress.records[c.id].mastered);
      return { lv, total: all.length, learned: learned.length, mastered: mastered.length };
    });

    app.innerHTML = `
      <div class="back-bar"><button class="back-btn" onclick="location.hash='#/'">←</button><strong style="font-size:18px">📈 学习统计</strong></div>
      <div class="stat-card">
        <h3>📊 总览</h3>
        <div class="stat-row">
          <div><div class="num">${progress.totalLearned}</div><div class="label">已学字数</div></div>
          <div><div class="num green">${progress.totalMastered}</div><div class="label">已掌握</div></div>
          <div><div class="num" style="color:var(--star)">${progress.totalStars}</div><div class="label">累计星星</div></div>
        </div>
        <div style="margin-top:16px">
          <div class="bar-row"><span>总体进度</span><span>${progress.totalLearned}/${total}</span></div>
          <div class="progress-bar"><div class="fill" style="width:${learnedPct}%"></div></div>
          <div class="bar-row" style="margin-top:8px"><span>掌握率</span><span>${progress.totalMastered}/${progress.totalLearned}</span></div>
          <div class="progress-bar"><div class="fill" style="width:${masteredPct}%;background:var(--success)"></div></div>
        </div>
      </div>
      <div class="stat-card">
        <h3>⚡ 连击与错题</h3>
        <div class="stat-row">
          <div><div class="num" style="color:var(--purple)">${progress.maxCombo || 0}</div><div class="label">最高连击</div></div>
          <div><div class="num" style="color:var(--danger)">${progress.wrongBook.length}</div><div class="label">错题数量</div></div>
          <div><div class="num green">${progress.wbCleared || 0}</div><div class="label">清错次数</div></div>
        </div>
        ${progress.wrongBook.length > 0 ? `<button class="btn btn-warn" style="margin-top:12px" onclick="location.hash='#/wrongbook'">去复习错题 →</button>` : ''}
      </div>
      <div class="stat-card">
        <h3>📅 最近14天</h3>
        ${last14.length === 0 ? '<p style="color:var(--text-light);text-align:center;padding:20px">还没有学习记录</p>' : `
        <div class="chart-bars">${last14.map(d => `<div class="bar-col"><div class="bar" style="height:${(d.stars / maxStars) * 100}%" title="${d.date}: ${d.newLearned}新/${d.reviewed}复, ${d.stars}星"></div><div class="bar-date">${d.date.slice(5)}</div></div>`).join('')}</div>`}
      </div>
      <div class="stat-card">
        <h3>📚 各难度进度</h3>
        ${levelStats.map(ls => `<div class="level-stat"><div class="ls-head"><span>L${ls.lv}</span><span>已学 ${ls.learned}/${ls.total} · 掌握 ${ls.mastered}</span></div><div class="progress-bar"><div class="fill" style="width:${ls.total > 0 ? (ls.learned / ls.total * 100) : 0}%"></div></div></div>`).join('')}
      </div>
      <div class="stat-card">
        <h3>🔄 复习统计</h3>
        <div class="stat-row">
          <div><div class="num">${totalReviews}</div><div class="label">总复习次数</div></div>
          <div><div class="num green">${totalCorrect}</div><div class="label">答对次数</div></div>
          <div><div class="num blue">${accuracy.toFixed(0)}%</div><div class="label">正确率</div></div>
        </div>
      </div>
      <div style="height:24px"></div>
    `;
  }

  // ============ 设置 ============
  function renderSettings(app) {
    app.innerHTML = `
      <div class="back-bar"><button class="back-btn" onclick="location.hash='#/'">←</button><strong style="font-size:18px">⚙️ 设置</strong></div>
      <div class="page">
        <div class="section-title">学习设置</div>
        <div class="setting-row">
          <div><div class="sr-label">每日新字数量</div><div class="sr-desc">建议5-6岁每天3-5个</div></div>
          <select id="dailyNew">${[3, 5, 7, 10].map(n => `<option value="${n}" ${progress.dailyNew === n ? 'selected' : ''}>${n} 个/天</option>`).join('')}</select>
        </div>
        <div class="setting-row">
          <div><div class="sr-label">每日复习上限</div><div class="sr-desc">避免复习过多疲劳</div></div>
          <select id="dailyReview">${[5, 10, 15, 20].map(n => `<option value="${n}" ${progress.dailyReviewLimit === n ? 'selected' : ''}>${n} 个/天</option>`).join('')}</select>
        </div>
        <div class="setting-row">
          <div><div class="sr-label">音效</div><div class="sr-desc">答对答错的声音提示</div></div>
          <select id="sfxOn"><option value="1" ${progress.sfxOn !== false ? 'selected' : ''}>开启</option><option value="0" ${progress.sfxOn === false ? 'selected' : ''}>关闭</option></select>
        </div>
        <div class="setting-row">
          <div><div class="sr-label">答对自动下一题</div><div class="sr-desc">答对后1.3秒自动进入下一题</div></div>
          <select id="autoNext"><option value="1" ${progress.autoNext !== false ? 'selected' : ''}>开启</option><option value="0" ${progress.autoNext === false ? 'selected' : ''}>关闭</option></select>
        </div>
        <div class="section-title">数据管理</div>
        <div style="background:var(--card);border-radius:12px;padding:16px;margin:0 0 12px;font-size:13px;color:var(--text-light)">📦 学习进度保存在浏览器本地(LocalStorage)，不会上传服务器。<br>换设备或清理浏览器会丢失进度，请定期导出备份。</div>
        <button class="btn btn-outline" id="exportBtn" style="margin-bottom:10px">📥 导出备份</button>
        <label class="btn btn-outline" style="display:block;text-align:center;margin-bottom:12px;cursor:pointer">📤 导入备份<input type="file" id="importInput" accept=".json" style="display:none"></label>
        ${progress.simDayOffset > 0 ? `
        <div class="section-title">测试工具</div>
        <div style="background:#FFF3E0;border-radius:12px;padding:14px;margin-bottom:12px;font-size:13px;color:var(--text)">📅 当前模拟第 ${progress.simDayOffset + 1} 天（真实今天是 ${new Date().toISOString().slice(0, 10)}）</div>
        <button class="btn btn-outline" id="resetSimBtn" style="margin-bottom:12px">↩️ 回到真实今天</button>
        ` : ''}
        <div class="section-title" style="color:var(--danger)">危险操作</div>
        <button class="btn" id="resetBtn" style="background:var(--danger);color:white">🗑️ 重置所有进度</button>
        <p style="text-align:center;font-size:11px;color:var(--text-light);padding:24px 0 8px">趣味识字 v3.0 · 混合学习流 + 错题本 · 适合5-6岁</p>
      </div>
    `;
    document.getElementById('dailyNew').onchange = (e) => { progress.dailyNew = parseInt(e.target.value); saveProgress(); toast('设置已保存'); };
    document.getElementById('dailyReview').onchange = (e) => { progress.dailyReviewLimit = parseInt(e.target.value); saveProgress(); toast('设置已保存'); };
    document.getElementById('sfxOn').onchange = (e) => { progress.sfxOn = e.target.value === '1'; saveProgress(); toast('设置已保存'); };
    document.getElementById('autoNext').onchange = (e) => { progress.autoNext = e.target.value === '1'; saveProgress(); toast('设置已保存'); };
    document.getElementById('exportBtn').onclick = () => {
      const blob = new Blob([JSON.stringify(progress, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = `识字进度备份_${TODAY()}.json`; a.click();
      URL.revokeObjectURL(url); toast('备份已导出');
    };
    document.getElementById('importInput').onchange = (e) => {
      const file = e.target.files[0]; if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => { try { progress = Object.assign(defaultProgress(), JSON.parse(ev.target.result)); saveProgress(); toast('备份导入成功'); route(); } catch (err) { toast('导入失败：文件格式错误'); } };
      reader.readAsText(file);
    };
    document.getElementById('resetBtn').onclick = () => {
      if (confirm('确定要重置所有进度吗？这将清除所有学习记录、星星和成就，且无法恢复。')) {
        progress = defaultProgress(); saveProgress(); toast('已重置所有进度'); route();
      }
    };
    const rsb = document.getElementById('resetSimBtn');
    if (rsb) rsb.onclick = () => {
      progress.simDayOffset = 0; saveProgress(); toast('已回到真实今天'); route();
    };
  }

  // ============ 初始化 ============
  function init() {
    progress = loadProgress();
    buildCharLevelMap();
    window.addEventListener('hashchange', route);
    route();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
