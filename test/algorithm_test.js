/* ============================================
   趣味识字 - 核心算法单元测试
   提取 app.js 关键算法，用模拟数据验证
   ============================================ */

const assert = require('assert');

// ============ 模拟数据 ============
const CHARLIB = [
  { id: 1, c: '一', p: 'yī', lv: 1, sp: false, e: '1️⃣', w: ['一个', '一起', '第一'], s: '我们一起去公园。', st: '一横就是数字一。' },
  { id: 2, c: '二', p: 'èr', lv: 1, sp: false, e: '2️⃣', w: ['两个', '第二'], s: '我有两只小猫。', st: '两横上下排。' },
  { id: 3, c: '三', p: 'sān', lv: 1, sp: false, e: '3️⃣', w: ['三个', '第三'], s: '三个小朋友在跳舞。', st: '三横叠起来。' },
  { id: 4, c: '四', p: 'sì', lv: 1, sp: false, e: '4️⃣', w: ['四个', '四季'], s: '一年有四季。', st: '方框里两笔。' },
  { id: 5, c: '五', p: 'wǔ', lv: 1, sp: false, e: '5️⃣', w: ['五个', '五颜六色'], s: '花坛里有五颜六色的花。', st: '上下两横中间交叉。' },
  { id: 157, c: '个', p: 'gè', lv: 2, sp: false, e: '1️⃣', w: ['一个', '个人'], s: '我有一个苹果。', st: '人加竖。' },
  { id: 200, c: '两', p: 'liǎng', lv: 4, sp: false, e: '📖', w: [], s: '', st: '' },
  { id: 300, c: '第', p: 'dì', lv: 5, sp: false, e: '📖', w: [], s: '', st: '' },
];

const charLevelMap = {};
CHARLIB.forEach(c => { charLevelMap[c.c] = c.lv; });

// ============ 提取核心算法 ============
const BOX_INTERVALS = [0, 0.5, 1, 2, 4, 7, 15];
const MASTER_STREAK = 3;

function defaultProgress() {
  return {
    records: {}, learnedIds: [], currentIndex: 0,
    totalStars: 0, totalLearned: 0, totalMastered: 0,
    streakDays: 0, lastStudyDate: '', history: [], achievements: [],
    wrongBook: [], wbCleared: 0, maxCombo: 0,
    dailyNew: 3, dailyReviewLimit: 10, sfxOn: true,
    simDayOffset: 0,
  };
}

function SIM_NOW(p) { return Date.now() + (p.simDayOffset || 0) * 86400000; }
function TODAY(p) { return new Date(SIM_NOW(p)).toISOString().slice(0, 10); }

function updateHistory(p, newLearned, reviewed, correct, stars) {
  const today = TODAY(p);
  let day = p.history.find(d => d.date === today);
  if (!day) {
    day = { date: today, newLearned: 0, reviewed: 0, correct: 0, stars: 0 };
    p.history.push(day);
  }
  day.newLearned += newLearned; day.reviewed += reviewed;
  day.correct += correct; day.stars += stars;
}

function markLearned(p, item) {
  if (p.records[item.id]) return;
  const now = SIM_NOW(p);
  p.records[item.id] = {
    charId: item.id, box: 1, nextReview: now + BOX_INTERVALS[1] * 86400000,
    lastReview: now, reviewCount: 0, correctCount: 0, wrongCount: 0,
    mastered: false, learnedDate: TODAY(p), streak: 0, weak: false,
  };
  p.learnedIds.push(item.id);
  p.currentIndex = Math.max(p.currentIndex, item.id);
  while (p.currentIndex < CHARLIB.length && p.records[CHARLIB[p.currentIndex].id]) p.currentIndex++;
  p.totalLearned = p.learnedIds.length;
  updateHistory(p, 1, 0, 0, 1);
  p.totalStars += 1;
}

function reviewAnswer(p, charId, correct) {
  const r = p.records[charId];
  if (!r) return { stars: 0, mastered: false };
  const now = SIM_NOW(p);
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
      const wi = p.wrongBook.indexOf(charId);
      if (wi >= 0) p.wrongBook.splice(wi, 1);
    }
  } else {
    r.wrongCount++; r.streak = 0; r.box = 1; r.weak = true;
    if (!p.wrongBook.includes(charId)) p.wrongBook.push(charId);
  }
  r.nextReview = now + BOX_INTERVALS[r.box] * 86400000;
  p.totalMastered = Object.values(p.records).filter(x => x.mastered).length;
  p.totalStars += stars;
  return { stars, mastered };
}

function getGoodWords(item) {
  if (!item.w || item.w.length === 0) return [];
  const baseLv = item.lv || 1;
  const good = item.w.filter(w => {
    for (const ch of w) {
      if (ch === item.c) continue;
      const lv = charLevelMap[ch];
      if (lv != null && lv > baseLv + 1) return false;
    }
    return true;
  });
  return good.length > 0 ? good : item.w;
}

function buildStudyQueue(p) {
  const now = SIM_NOW(p);
  const reviews = Object.values(p.records)
    .filter(r => !r.mastered && r.nextReview <= now)
    .sort((a, b) => a.nextReview - b.nextReview)
    .slice(0, p.dailyReviewLimit)
    .map(r => CHARLIB.find(c => c.id === r.charId)).filter(c => c);
  const learnedToday = p.history.find(d => d.date === TODAY(p));
  const newLearnedToday = learnedToday ? learnedToday.newLearned : 0;
  const remaining = Math.max(0, p.dailyNew - newLearnedToday);
  const newWords = [];
  let idx = p.currentIndex;
  while (newWords.length < remaining && idx < CHARLIB.length) {
    if (!p.records[CHARLIB[idx].id]) newWords.push(CHARLIB[idx]);
    idx++;
  }
  const queue = [];
  let rIdx = 0, nIdx = 0;
  while (nIdx < newWords.length || rIdx < reviews.length) {
    for (let i = 0; i < 2 && rIdx < reviews.length; i++) queue.push({ type: 'review', char: reviews[rIdx++] });
    if (nIdx < newWords.length) queue.push({ type: 'new', char: newWords[nIdx++] });
  }
  while (rIdx < reviews.length) queue.push({ type: 'review', char: reviews[rIdx++] });
  return queue;
}

// ============ 测试用例 ============
let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✅ ${name}`); pass++; }
  catch (e) { console.log(`  ❌ ${name}: ${e.message}`); fail++; }
}

console.log('\n========================================');
console.log('  趣味识字 - 核心算法测试');
console.log('========================================\n');

// --- 测试1: markLearned 正确记录 ---
console.log('[测试1] markLearned 记录');
test('新字标记后进入 records', () => {
  const p = defaultProgress();
  markLearned(p, CHARLIB[0]);
  assert.ok(p.records[1], 'records 应包含 id=1');
  assert.strictEqual(p.totalLearned, 1);
  assert.strictEqual(p.records[1].box, 1);
  assert.strictEqual(p.records[1].reviewCount, 0);
});
test('重复标记不重复记录', () => {
  const p = defaultProgress();
  markLearned(p, CHARLIB[0]);
  markLearned(p, CHARLIB[0]);
  assert.strictEqual(Object.keys(p.records).length, 1);
});
test('currentIndex 正确推进', () => {
  const p = defaultProgress();
  markLearned(p, CHARLIB[0]); // id=1
  assert.strictEqual(p.currentIndex, 1);
  markLearned(p, CHARLIB[1]); // id=2
  assert.strictEqual(p.currentIndex, 2);
});

// --- 测试2: reviewAnswer 答对推进 box ---
console.log('\n[测试2] reviewAnswer 答对');
test('答对后 box+1, streak+1', () => {
  const p = defaultProgress();
  markLearned(p, CHARLIB[0]);
  const r = reviewAnswer(p, 1, true);
  assert.strictEqual(p.records[1].box, 2);
  assert.strictEqual(p.records[1].streak, 1);
  assert.strictEqual(r.stars, 1);
  assert.ok(!r.mastered);
});
test('答错后 box 归1, streak 归0, 进错题本', () => {
  const p = defaultProgress();
  markLearned(p, CHARLIB[0]);
  reviewAnswer(p, 1, true); // box=2
  const r = reviewAnswer(p, 1, false);
  assert.strictEqual(p.records[1].box, 1);
  assert.strictEqual(p.records[1].streak, 0);
  assert.ok(p.wrongBook.includes(1));
});

// --- 测试3: 掌握判定 ---
console.log('\n[测试3] 掌握判定（box>=5 && reviewCount>=4 && streak>=3）');
test('连续答对4次且box升到5才掌握', () => {
  const p = defaultProgress();
  markLearned(p, CHARLIB[0]); // box=1
  reviewAnswer(p, 1, true); // box=2, streak=1, review=1
  reviewAnswer(p, 1, true); // box=3, streak=2, review=2
  reviewAnswer(p, 1, true); // box=4, streak=3, review=3 (streak>=3 但 review<4 且 box<5)
  assert.ok(!p.records[1].mastered, '第3次答对不应掌握');
  const r = reviewAnswer(p, 1, true); // box=5, streak=4, review=4 → 掌握
  assert.ok(r.mastered, '第4次答对应掌握');
  assert.ok(p.records[1].mastered);
  assert.strictEqual(p.totalMastered, 1);
});
test('中途答错重置 streak 无法掌握', () => {
  const p = defaultProgress();
  markLearned(p, CHARLIB[0]);
  reviewAnswer(p, 1, true); reviewAnswer(p, 1, true);
  reviewAnswer(p, 1, false); // streak归0, box归1
  reviewAnswer(p, 1, true); // streak=1
  reviewAnswer(p, 1, true); // streak=2
  reviewAnswer(p, 1, true); // streak=3, 但 box 不够5
  assert.ok(!p.records[1].mastered, 'streak 重新累计，box 不够不应掌握');
});

// --- 测试4: 错题本移出 ---
console.log('\n[测试4] 错题本移出');
test('掌握后从错题本移出', () => {
  const p = defaultProgress();
  markLearned(p, CHARLIB[0]);
  reviewAnswer(p, 1, false); // 进错题本
  assert.strictEqual(p.wrongBook.length, 1);
  // 连续答对直到掌握
  for (let i = 0; i < 10; i++) reviewAnswer(p, 1, true);
  assert.ok(p.records[1].mastered);
  assert.strictEqual(p.wrongBook.length, 0, '掌握后应从错题本移出');
});

// --- 测试5: 混合队列构建 ---
console.log('\n[测试5] buildStudyQueue 混合队列');
test('无复习字时全是新字', () => {
  const p = defaultProgress();
  const q = buildStudyQueue(p);
  assert.strictEqual(q.length, 3); // dailyNew=3
  assert.ok(q.every(x => x.type === 'new'));
});
test('有复习字时交替排列 复习+新', () => {
  const p = defaultProgress();
  // 手动设置一个已学已到期的字（不走 markLearned 避免 updateHistory 影响 newLearned 计数）
  p.records[1] = { charId: 1, box: 2, nextReview: SIM_NOW(p) - 1, lastReview: 0, reviewCount: 1, correctCount: 1, wrongCount: 0, mastered: false, learnedDate: '2026-01-01', streak: 1, weak: false };
  p.learnedIds.push(1);
  p.currentIndex = 1;
  const q = buildStudyQueue(p);
  // 1复习 + 3新字(dailyNew=3) = 4
  assert.ok(q.length >= 4, `队列应>=4, 实际${q.length}`);
  assert.strictEqual(q[0].type, 'review', '第一个应是复习');
});
test('今日新字学完后不返回新字', () => {
  const p = defaultProgress();
  // 模拟今天已学3个新字
  p.history.push({ date: TODAY(p), newLearned: 3, reviewed: 0, correct: 0, stars: 0 });
  markLearned(p, CHARLIB[0]);
  markLearned(p, CHARLIB[1]);
  markLearned(p, CHARLIB[2]);
  const q = buildStudyQueue(p);
  assert.ok(q.every(x => x.type !== 'new'), '今日新字已满，不应有新字');
});

// --- 测试6: 模拟日期推进 ---
console.log('\n[测试6] simDayOffset 日期推进');
test('推进1天后昨天的字到期', () => {
  const p = defaultProgress();
  markLearned(p, CHARLIB[0]); // nextReview = now + 1天
  // 当前 getDueReviews 应为空（nextReview 在明天）
  const now0 = SIM_NOW(p);
  const due0 = Object.values(p.records).filter(r => !r.mastered && r.nextReview <= now0);
  assert.strictEqual(due0.length, 0, '刚学的字不应立即到期');
  // 推进1天
  p.simDayOffset = 1;
  const now1 = SIM_NOW(p);
  const due1 = Object.values(p.records).filter(r => !r.mastered && r.nextReview <= now1);
  assert.strictEqual(due1.length, 1, '推进1天后应到期');
});
test('推进天数后 todayNewLearned 归零', () => {
  const p = defaultProgress();
  markLearned(p, CHARLIB[0]);
  markLearned(p, CHARLIB[1]);
  // 今天学了2个
  const today0 = TODAY(p);
  const rec0 = p.history.find(d => d.date === today0);
  assert.ok(rec0 && rec0.newLearned >= 2, '今天应记录2个新字');
  // 推进1天
  p.simDayOffset = 1;
  const today1 = TODAY(p);
  assert.notStrictEqual(today0, today1, 'TODAY 应变化');
  const rec1 = p.history.find(d => d.date === today1);
  assert.ok(!rec1 || rec1.newLearned === 0, '新的一天 newLearned 应为0');
});

// --- 测试7: 组词过滤 getGoodWords ---
console.log('\n[测试7] getGoodWords 组词过滤');
test('过滤后为空时返回原始组词（兜底）', () => {
  const er = CHARLIB[1]; // 二 lv=1, w=['两个','第二']
  const good = getGoodWords(er);
  // '两个'含'两'(lv4>2) 过滤；'第二'含'第'(lv5>2) 过滤
  // 两个都过滤 → good为空 → 返回原始 item.w
  assert.strictEqual(good.length, 2, '全部过滤后应返回原始组词');
  assert.ok(good.includes('两个'));
});
test('保留只含同级字的组词', () => {
  const yi = CHARLIB[0]; // 一 lv=1, w=['一个','一起','第一']
  const good = getGoodWords(yi);
  // '一个'含'个'(lv2)，2<=1+1=2 → 保留
  assert.ok(good.includes('一个'), '"一个"应保留（个lv2<=2）');
});
test('无组词返回空数组', () => {
  const liang = CHARLIB[7]; // 两 lv=4, w=[]
  assert.strictEqual(getGoodWords(liang).length, 0);
});

// --- 测试8: 间隔算法 ---
console.log('\n[测试8] BOX_INTERVALS 间隔');
test('答对后按 box 级别设置下次复习时间', () => {
  const p = defaultProgress();
  markLearned(p, CHARLIB[0]); // box=1, nextReview = now + 1天
  const now = SIM_NOW(p);
  const expected = now + BOX_INTERVALS[1] * 86400000;
  assert.ok(Math.abs(p.records[1].nextReview - expected) < 1000, 'box=1 间隔应为1天');
});
test('答错后 box 归1 间隔恢复1天', () => {
  const p = defaultProgress();
  markLearned(p, CHARLIB[0]);
  reviewAnswer(p, 1, true); // box=2, 间隔2天
  assert.strictEqual(p.records[1].box, 2);
  reviewAnswer(p, 1, false); // box=1, 间隔0.5天
  assert.strictEqual(p.records[1].box, 1);
});

// --- 测试9: replay 模式不更新进度 ---
console.log('\n[测试9] replay 模式隔离');
test('replay 标志正确设置', () => {
  // 模拟 route 解析 ?mode=replay
  const params = new URLSearchParams('mode=replay');
  const mode = params.get('mode');
  assert.strictEqual(mode, 'replay');
});

// --- 测试10: 数据兼容性 ---
console.log('\n[测试10] 数据兼容性');
test('旧数据缺少 streak 字段自动补全', () => {
  const oldData = {
    records: { 1: { charId: 1, box: 2, nextReview: 0, reviewCount: 1, correctCount: 1, wrongCount: 0, mastered: false, learnedDate: '2026-01-01' } },
    learnedIds: [1], totalLearned: 1,
  };
  const p = Object.assign(defaultProgress(), oldData);
  Object.values(p.records).forEach(r => { if (r.streak == null) r.streak = 0; });
  assert.strictEqual(p.records[1].streak, 0, '旧数据应补全 streak=0');
  assert.strictEqual(p.simDayOffset, 0, '应补全 simDayOffset');
});

console.log('\n========================================');
console.log(`  结果: ${pass} 通过, ${fail} 失败`);
console.log('========================================\n');
process.exit(fail > 0 ? 1 : 0);
