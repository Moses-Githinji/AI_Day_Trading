import Alpaca from '@alpacahq/alpaca-trade-api';
import { logger } from '../utils/logger';
import 'dotenv/config';


const alpaca = new Alpaca({
  keyId: process.env.ALPACA_KEY,
  secretKey: process.env.ALPACA_SECRET,
  paper: true,
});

class Trader {
  async executeTrade(symbol: string, qty: number, side: 'buy' | 'sell') {
    try {
      const order = await alpaca.createOrder({
        symbol,
        qty,
        side,
        type: 'market',
        time_in_force: 'day',
      });
      logger.info(`Trade executed: ${side} ${qty} ${symbol}`);
      return order;
    } catch (err) {
      logger.error('Trade execution failed:', err);
      throw err;
    }
  }
}

export default new Trader();