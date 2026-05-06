const express = require('express');
const { WebSocketServer } = require('ws');
const path = require('path');
const fs = require('fs');
const http = require('http');
const { kids, taskLibrary, rewardTarget, resetHour, getTasksForToday } = require('./config');

const DB_PATH = path.join(__dirname, 'data.json');

function loadData() {
  try {
    return JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
  } catch {
    return { stars: {}, rewards: {}, wishes: {}, tonight: null };
  }
}

function saveData(data) {
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
}

function getSessionDate() {
  const now = new Date();
  if (now.getHours() < resetHour) {
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    return yesterday.toISOString().slice(0, 10);
  }
  return now.toISOString().slice(0, 10);
}

function ensureTonightTasks(data) {
  const sessionDate = getSessionDate();
  if (!data.tonight || data.tonight.sessionDate !== sessionDate) {
    const tasks = getTasksForToday();
    data.tonight = { sessionDate, kids: {} };
    for (const kid of kids) {
      data.tonight.kids[kid.id] = tasks.map(t => ({
        task: t, icon: (taskLibrary[t] && taskLibrary[t].icon) || '', done: false, doneAt: null,
      }));
    }
    saveData(data);
  }
  return data;
}

function ensureKidData(data) {
  for (const kid of kids) {
    if (!data.stars[kid.id]) data.stars[kid.id] = 0;
    if (!data.rewards[kid.id]) data.rewards[kid.id] = 0;
    if (!data.wishes) data.wishes = {};
    if (!data.wishes[kid.id]) data.wishes[kid.id] = '';
  }
  return data;
}

function getState() {
  let data = loadData();
  data = ensureKidData(data);
  data = ensureTonightTasks(data);
  const state = {};
  for (const kid of kids) {
    const totalStars = data.stars[kid.id];
    const totalRewards = data.rewards[kid.id];
    const starsTowardNext = totalStars - (totalRewards * rewardTarget);
    state[kid.id] = {
      name: kid.name, key: kid.key, totalStars, starsTowardNext,
      rewardTarget, rewardCount: totalRewards,
      wish: data.wishes[kid.id] || '',
      wishImage: (data.wishImages && data.wishImages[kid.id]) || '',
      tasks: data.tonight.kids[kid.id],
    };
  }
  return state;
}

function pressButton(kidId, taskIndex) {
  let data = loadData();
  data = ensureKidData(data);
  data = ensureTonightTasks(data);
  const kid = kids.find(k => k.id === kidId);
  if (!kid) return { error: 'Unknown kid' };
  const kidTasks = data.tonight.kids[kidId];
  const idx = (taskIndex !== undefined) ? taskIndex : kidTasks.findIndex(t => !t.done);
  if (idx === -1 || idx >= kidTasks.length) return { error: 'All done for tonight!', allDone: true };
  if (kidTasks[idx].done) return { error: 'Already done', alreadyDone: true };
  kidTasks[idx].done = true;
  kidTasks[idx].doneAt = new Date().toISOString();
  data.stars[kidId]++;
  const threshold = (data.rewards[kidId] + 1) * rewardTarget;
  let rewardEarned = false;
  if (data.stars[kidId] >= threshold) {
    data.rewards[kidId]++;
    rewardEarned = true;
  }
  saveData(data);
  return { success: true, task: kidTasks[idx].task, rewardEarned };
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
app.get('/api/state', (req, res) => res.json(getState()));
app.use(express.json({ limit: '5mb' }));
app.post('/api/button/:kidId', (req, res) => {
  const taskIndex = (req.body && req.body.taskIndex !== undefined) ? req.body.taskIndex : undefined;
  const result = pressButton(req.params.kidId, taskIndex);
  res.json(result);
  broadcast();
});
app.post('/api/undo/:kidId', (req, res) => {
  const kid = kids.find(k => k.id === req.params.kidId);
  if (!kid) return res.json({ error: 'Unknown kid' });
  let data = loadData();
  data = ensureKidData(data);
  data = ensureTonightTasks(data);
  const kidTasks = data.tonight.kids[kid.id];
  const idx = req.body.taskIndex;
  if (idx === undefined || idx < 0 || idx >= kidTasks.length) return res.json({ error: 'Invalid task' });
  if (!kidTasks[idx].done) return res.json({ error: 'Task not done' });
  kidTasks[idx].done = false;
  kidTasks[idx].doneAt = null;
  if (data.stars[kid.id] > 0) data.stars[kid.id]--;
  // Recalculate rewards in case we dropped below a threshold
  const correctRewards = Math.floor(data.stars[kid.id] / rewardTarget);
  data.rewards[kid.id] = correctRewards;
  saveData(data);
  res.json({ success: true });
  broadcast();
});
app.post('/api/wish/:kidId', (req, res) => {
  const kid = kids.find(k => k.id === req.params.kidId);
  if (!kid) return res.json({ error: 'Unknown kid' });
  const data = loadData();
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
app.post('/api/reset', (req, res) => {
  const data = loadData();
  data.tonight = null;
  saveData(data);
  ensureTonightTasks(loadData());
  res.json({ ok: true });
  broadcast();
});
wss.on('connection', (ws) => {
  ws.send(JSON.stringify({ type: 'state', data: getState() }));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log('Bedtime Tracker running at http://localhost:' + PORT);
  console.log('Kids: ' + kids.map(k => k.name + ' (key: ' + k.key + ')').join(', '));
  console.log('Tasks: ' + getTasksForToday().join(', '));
  console.log('Reward target: ' + rewardTarget + ' stars');
});
