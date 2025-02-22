import express from 'express';
import MarketData from '../data/marketData';
import Predictor from '../ai/predictor';
import Trader from '../trading/trader';
import Backtester from '../trading/backtester';
import RiskManager from '../risk/manager';
import { logger } from '../utils/logger';
import 'dotenv/config';
import Redis from 'ioredis';

const redis = new Redis({ host: process.env.REDIS_HOST });
const app = express();
app.use(express.json());

app.get('/predict/:symbol', async (req, res) => {
  try {
    const historical = await MarketData.fetchHistoricalData(req.params.symbol, '2023-01-01', '2023-12-31');
    const prediction = await Predictor.predict(historical.slice(-20));
    res.json({ symbol: req.params.symbol, prediction });
  } catch (err) {
    logger.error('Prediction error:', err);
    res.status(500).json({ error: 'Prediction failed' });
  }
});

app.post('/trade', async (req, res) => {
  const { symbol, qty, side } = req.body;
  try {
    const price = Number(await redis.get(`price:${symbol}`));
    if (!price) throw new Error('No current price available');
    if (!await RiskManager.checkRisk(symbol, qty, price)) {
      return res.status(400).json({ error: 'Risk threshold exceeded' });
    }
    const order = await Trader.executeTrade(symbol, qty, side);
    res.json(order);
  } catch (err) {
    logger.error('Trade error:', err);
    res.status(500).json({ error: 'Trade failed' });
  }
});

app.post('/backtest', async (req, res) => {
  const { symbol, startDate, endDate } = req.body;
  try {
    const result = await Backtester.runBacktest(symbol, startDate, endDate);
    res.json(result);
  } catch (err) {
    logger.error('Backtest error:', err);
    res.status(500).json({ error: 'Backtest failed' });
  }
});

app.post('/train', async (req, res) => {
  const { symbol, startDate, endDate } = req.body;
  try {
    const data = await MarketData.fetchHistoricalData(symbol, startDate, endDate);
    await Predictor.train(data);
    res.json({ status: 'Model trained' });
  } catch (err) {
    logger.error('Train error:', err);
    res.status(500).json({ error: 'Training failed' });
  }
});

app.listen(3000, () => logger.info('API running on port 3000'));