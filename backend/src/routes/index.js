const express = require('express');
const authRoutes = require('./auth.routes');
const gamesRoutes = require('./games.routes');
const usersRoutes = require('./users.routes');
const walletRoutes = require('./wallet.routes');
const leaderboardRoutes = require('./leaderboard.routes');
const questsRoutes = require('./quests.routes');
const tournamentsRoutes = require('./tournaments.routes');
const webhookRoutes = require('./webhook');
const { getDeepHealth } = require('../controllers/health.controller');

const router = express.Router();

const healthCheck = (req, res) => {
  res.status(200).json({
    status: 'Operational',
    timestamp: new Date().toISOString(),
    service: 'stellarcade-api',
  });
};

const v1Router = express.Router();
v1Router.get('/health', healthCheck);
v1Router.get('/health/deep', getDeepHealth);
v1Router.use('/auth', authRoutes);
v1Router.use('/games', gamesRoutes);
v1Router.use('/users', usersRoutes);
v1Router.use('/wallet', walletRoutes);
v1Router.use('/leaderboard', leaderboardRoutes);
v1Router.use('/quests', questsRoutes);
v1Router.use('/tournaments', tournamentsRoutes);
v1Router.use('/webhook', webhookRoutes);

router.use('/v1', v1Router);

router.get('/health', healthCheck);
router.get('/health/deep', getDeepHealth);
router.use('/auth', authRoutes);
router.use('/games', gamesRoutes);
router.use('/users', usersRoutes);
router.use('/wallet', walletRoutes);
router.use('/leaderboard', leaderboardRoutes);
router.use('/quests', questsRoutes);
router.use('/tournaments', tournamentsRoutes);
router.use('/webhook', webhookRoutes);

module.exports = router;
