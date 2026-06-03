const express = require('express');
const { WebSocketServer } = require('ws');
const path = require('path');
const fs = require('fs');
const http = require('http');

// Default config (used on first run, then stored in data.json)
const DEFAULT_CONFIG = {
  kids: [
    { id: 'elodie', name: 'Elodie', key: 'a' },
    { id: 'samuel', name: 'Samuel', key: 'b' },
  ],
  taskLibrary: {
    'Brush teeth':    { icon: '🪥' },
    'Feed the dogs':  { icon: '🐕' },
    'Get into PJs':   { icon: '👕' },
    'Make bed':       { icon: '🛏️' },
    'Pack toys away': { icon: '🧸' },
  },
  defaultTasks: ['Brush teeth', 'Feed the dogs', 'Get into PJs', 'Make bed', 'Pack toys away'],
  dayOverrides: {
    5: ['Brush teeth', 'Get into PJs', 'Make bed', 'Pack toys away'],
  },
  kidTasks: {},
  rewardTarget: 50,
  resetHour: 0,
};

const DB_PATH = path.join(__dirname, 'data.json');

// Server-side cursor tracking (in memory, resets on server restart)
let cursors = {};

function loadData() {
  try {
    return JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
  } catch {
    return {};
  }
}

function saveData(data) {
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
}

// Get live config from data.json (falls back to defaults)
function getConfig(data) {
  if (!data) data = loadData();
  return {
    kids: data.config?.kids || DEFAULT_CONFIG.kids,
    taskLibrary: data.config?.taskLibrary || DEFAULT_CONFIG.taskLibrary,
    defaultTasks: data.config?.defaultTasks || DEFAULT_CONFIG.defaultTasks,
    dayOverrides: data.config?.dayOverrides || DEFAULT_CONFIG.dayOverrides,
    kidTasks: data.config?.kidTasks || DEFAULT_CONFIG.kidTasks,
    rewardTarget: data.config?.rewardTarget ?? DEFAULT_CONFIG.rewardTarget,
    resetHour: data.config?.resetHour ?? DEFAULT_CONFIG.resetHour,
  };
}

function getTasksForKid(config, kidId) {
  // Per-kid override takes priority
  if (config.kidTasks[kidId] && config.kidTasks[kidId].length > 0) {
    return config.kidTasks[kidId];
  }
  // Then day-of-week override
  const day = new Date().getDay();
  if (config.dayOverrides[day]) {
    return config.dayOverrides[day];
  }
  // Then defaults
  return config.defaultTasks;
}

function getCursor(kidId) {
  if (cursors[kidId] === undefined) {
    const data = loadData();
    const config = getConfig(data);
    ensureKidData(data, config);
    ensureTonightTasks(data, config);
    const tasks = (data.tonight && data.tonight.kids[kidId]) || [];
    const idx = tasks.findIndex(t => !t.done);
    cursors[kidId] = idx === -1 ? 0 : idx;
  }
  return cursors[kidId];
}

function getSessionDate(config) {
  const now = new Date();
  if (now.getHours() < config.resetHour) {
    now.setDate(now.getDate() - 1);
  }
  // Use local date, not UTC
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function ensureTonightTasks(data, config) {
  const sessionDate = getSessionDate(config);
  if (!data.tonight || data.tonight.sessionDate !== sessionDate) {
    data.tonight = { sessionDate, kids: {} };
    for (const kid of config.kids) {
      const tasks = getTasksForKid(config, kid.id);
      data.tonight.kids[kid.id] = tasks.map(t => ({
        task: t, icon: (config.taskLibrary[t] && config.taskLibrary[t].icon) || '', done: false, doneAt: null,
      }));
    }
    saveData(data);
  }
  return data;
}

function ensureKidData(data, config) {
  if (!data.stars) data.stars = {};
  if (!data.rewards) data.rewards = {};
  if (!data.wishes) data.wishes = {};
  if (!data.wishImages) data.wishImages = {};
  for (const kid of config.kids) {
    if (!data.stars[kid.id]) data.stars[kid.id] = 0;
    if (!data.rewards[kid.id]) data.rewards[kid.id] = 0;
    if (!data.wishes[kid.id]) data.wishes[kid.id] = '';
  }
  return data;
}

function getState() {
  let data = loadData();
  const config = getConfig(data);
  data = ensureKidData(data, config);
  data = ensureTonightTasks(data, config);
  const state = {};
  for (const kid of config.kids) {
    const totalStars = data.stars[kid.id];
    const totalRewards = data.rewards[kid.id];
    const starsTowardNext = totalStars - (totalRewards * config.rewardTarget);
    state[kid.id] = {
      name: kid.name, key: kid.key, color: kid.color || '', totalStars, starsTowardNext,
      rewardTarget: config.rewardTarget, rewardCount: totalRewards,
      wish: data.wishes[kid.id] || '',
      wishImage: (data.wishImages && data.wishImages[kid.id]) || '',
      tasks: data.tonight.kids[kid.id],
      cursor: getCursor(kid.id),
    };
  }
  return state;
}

function pressButton(kidId, taskIndex) {
  let data = loadData();
  const config = getConfig(data);
  data = ensureKidData(data, config);
  data = ensureTonightTasks(data, config);
  const kid = config.kids.find(k => k.id === kidId);
  if (!kid) return { error: 'Unknown kid' };
  const kidTasks = data.tonight.kids[kidId];
  const idx = (taskIndex !== undefined) ? taskIndex : getCursor(kidId);
  if (idx === -1 || idx >= kidTasks.length) return { error: 'All done for tonight!', allDone: true };
  if (kidTasks[idx].done) {
    kidTasks[idx].done = false;
    kidTasks[idx].doneAt = null;
    if (data.stars[kidId] > 0) data.stars[kidId]--;
    const correctRewards = Math.floor(data.stars[kidId] / config.rewardTarget);
    data.rewards[kidId] = correctRewards;
    saveData(data);
    cursors[kidId] = idx;
    return { success: true, task: kidTasks[idx].task, undone: true };
  }
  kidTasks[idx].done = true;
  kidTasks[idx].doneAt = new Date().toISOString();
  data.stars[kidId]++;
  const threshold = (data.rewards[kidId] + 1) * config.rewardTarget;
  let rewardEarned = false;
  if (data.stars[kidId] >= threshold) {
    data.rewards[kidId]++;
    rewardEarned = true;
  }
  saveData(data);
  const len = kidTasks.length;
  let nextIdx = -1;
  for (let i = 1; i <= len; i++) {
    const candidate = (idx + i) % len;
    if (!kidTasks[candidate].done) { nextIdx = candidate; break; }
  }
  cursors[kidId] = nextIdx === -1 ? idx : nextIdx;
  return { success: true, task: kidTasks[idx].task, rewardEarned };
}

function cycleTask(kidId) {
  const data = loadData();
  const config = getConfig(data);
  const kid = config.kids.find(k => k.id === kidId);
  if (!kid) return { error: 'Unknown kid' };
  ensureTonightTasks(data, config);
  const kidTasks = data.tonight.kids[kidId];
  const current = getCursor(kidId);
  const next = (current + 1) % kidTasks.length;
  cursors[kidId] = next;
  return { success: true, cursor: next };
}

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

function broadcast() {
  const state = getState();
  const msg = JSON.stringify({ type: 'state', data: state });
  for (const client of wss.clients) {
    if (client.readyState === 1) client.send(msg);
  }
}

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json({ limit: '5mb' }));

app.get('/api/state', (req, res) => res.json(getState()));

// Get current config for admin page
app.get('/api/config', (req, res) => {
  const data = loadData();
  const config = getConfig(data);
  // Also include per-kid stats
  ensureKidData(data, config);
  const kidStats = {};
  for (const kid of config.kids) {
    kidStats[kid.id] = {
      totalStars: data.stars[kid.id] || 0,
      totalRewards: data.rewards[kid.id] || 0,
      starsTowardNext: (data.stars[kid.id] || 0) - ((data.rewards[kid.id] || 0) * config.rewardTarget),
      wish: (data.wishes && data.wishes[kid.id]) || '',
      wishImage: (data.wishImages && data.wishImages[kid.id]) || '',
    };
  }
  res.json({ config, kidStats });
});

// Save full config from admin page
app.post('/api/config', (req, res) => {
  const data = loadData();
  const newConfig = req.body;

  // Validate basics
  if (!newConfig.kids || !Array.isArray(newConfig.kids) || newConfig.kids.length === 0) {
    return res.json({ error: 'Need at least one kid' });
  }
  if (!newConfig.defaultTasks || !Array.isArray(newConfig.defaultTasks) || newConfig.defaultTasks.length === 0) {
    return res.json({ error: 'Need at least one task' });
  }

  // Generate IDs for new kids
  for (const kid of newConfig.kids) {
    if (!kid.id) {
      kid.id = kid.name.toLowerCase().replace(/[^a-z0-9]/g, '');
    }
  }

  data.config = {
    kids: newConfig.kids,
    taskLibrary: newConfig.taskLibrary || {},
    defaultTasks: newConfig.defaultTasks,
    dayOverrides: newConfig.dayOverrides || {},
    kidTasks: newConfig.kidTasks || {},
    rewardTarget: parseInt(newConfig.rewardTarget) || 50,
    resetHour: parseInt(newConfig.resetHour) ?? 0,
  };

  saveData(data);
  cursors = {};
  res.json({ ok: true });
  broadcast();
});

// Reset tonight's tasks (forces regeneration from current config)
app.post('/api/reset', (req, res) => {
  const data = loadData();
  data.tonight = null;
  saveData(data);
  const config = getConfig(loadData());
  ensureTonightTasks(loadData(), config);
  cursors = {};
  res.json({ ok: true });
  broadcast();
});

// Adjust stars for a kid
app.post('/api/stars/:kidId', (req, res) => {
  const data = loadData();
  const config = getConfig(data);
  const kid = config.kids.find(k => k.id === req.params.kidId);
  if (!kid) return res.json({ error: 'Unknown kid' });
  ensureKidData(data, config);
  const newStars = parseInt(req.body.stars);
  if (isNaN(newStars) || newStars < 0) return res.json({ error: 'Invalid star count' });
  data.stars[kid.id] = newStars;
  data.rewards[kid.id] = Math.floor(newStars / config.rewardTarget);
  saveData(data);
  res.json({ ok: true });
  broadcast();
});

app.post('/api/cycle/:kidId', (req, res) => {
  const result = cycleTask(req.params.kidId);
  res.json(result);
  broadcast();
});

app.post('/api/button/:kidId', (req, res) => {
  const taskIndex = (req.body && req.body.taskIndex !== undefined) ? req.body.taskIndex : undefined;
  const result = pressButton(req.params.kidId, taskIndex);
  res.json(result);
  broadcast();
});

app.post('/api/undo/:kidId', (req, res) => {
  const data = loadData();
  const config = getConfig(data);
  const kid = config.kids.find(k => k.id === req.params.kidId);
  if (!kid) return res.json({ error: 'Unknown kid' });
  ensureKidData(data, config);
  ensureTonightTasks(data, config);
  const kidTasks = data.tonight.kids[kid.id];
  const idx = req.body.taskIndex;
  if (idx === undefined || idx < 0 || idx >= kidTasks.length) return res.json({ error: 'Invalid task' });
  if (!kidTasks[idx].done) return res.json({ error: 'Task not done' });
  kidTasks[idx].done = false;
  kidTasks[idx].doneAt = null;
  if (data.stars[kid.id] > 0) data.stars[kid.id]--;
  const correctRewards = Math.floor(data.stars[kid.id] / config.rewardTarget);
  data.rewards[kid.id] = correctRewards;
  saveData(data);
  res.json({ success: true });
  broadcast();
});

app.post('/api/wish/:kidId', (req, res) => {
  const data = loadData();
  const config = getConfig(data);
  const kid = config.kids.find(k => k.id === req.params.kidId);
  if (!kid) return res.json({ error: 'Unknown kid' });
  if (!data.wishes) data.wishes = {};
  if (!data.wishImages) data.wishImages = {};
  data.wishes[kid.id] = (req.body.wish || '').slice(0, 200);
  if (req.body.wishImage !== undefined) {
    data.wishImages[kid.id] = req.body.wishImage || '';
  }
  saveData(data);
  res.json({ ok: true });
  broadcast();
});

wss.on('connection', (ws) => {
  ws.send(JSON.stringify({ type: 'state', data: getState() }));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  const config = getConfig();
  console.log('Bedtime Tracker running at http://localhost:' + PORT);
  console.log('Kids: ' + config.kids.map(k => k.name + ' (key: ' + k.key + ')').join(', '));
  console.log('Tasks: per-kid or default = ' + config.defaultTasks.join(', '));
  console.log('Reward target: ' + config.rewardTarget + ' stars');
});
