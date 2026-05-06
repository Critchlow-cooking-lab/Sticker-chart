const kids = [
  { id: 'elodie', name: 'Elodie', key: '1' },
  { id: 'samuel', name: 'Samuel', key: '2' },
];

// Each task has a name and an icon (emoji)
const taskLibrary = {
  'Brush teeth':    { icon: '🪥' },
  'Feed the dogs':  { icon: '🐕' },
  'Get into PJs':   { icon: '👕' },
  'Make bed':       { icon: '🛏️' },
  'Pack toys away': { icon: '🧸' },
};

const defaultTasks = [
  'Brush teeth',
  'Feed the dogs',
  'Get into PJs',
  'Make bed',
  'Pack toys away',
];

const dayOverrides = {
  5: [
    'Brush teeth',
    'Get into PJs',
    'Make bed',
    'Pack toys away',
  ],
};

const rewardTarget = 50;
const resetHour = 0;

function getTasksForToday() {
  const day = new Date().getDay();
  return dayOverrides[day] || defaultTasks;
}

module.exports = { kids, taskLibrary, defaultTasks, dayOverrides, rewardTarget, resetHour, getTasksForToday };
