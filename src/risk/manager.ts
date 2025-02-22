import { Pool } from 'pg';
import { logger } from '../utils/logger';
import 'dotenv/config';


const pool = new Pool({
  user: process.env.POSTGRES_USER,
  password: process.env.POSTGRES_PASSWORD,
  database: process.env.POSTGRES_DB,
  host: process.env.POSTGRES_HOST,
  port: 5432,
});

class RiskManager {
  async checkRisk(symbol: string, qty: number, price: number): Promise<boolean> {
    const volatility = await this.calculateVolatility(symbol);
    const maxLoss = await this.getMaxLoss();
    const potentialLoss = qty * price * volatility;

    if (potentialLoss > maxLoss) {
      logger.warn(`Risk exceeded: ${potentialLoss} > ${maxLoss}`);
      return false;
    }
    return true;
  }

  private async calculateVolatility(symbol: string): Promise<number> {
    const query = `
      SELECT STDDEV(price) as volatility
      FROM trades
      WHERE symbol = $1 AND timestamp > NOW() - INTERVAL '1 hour'
    `;
    const res = await pool.query(query, [symbol]);
    return res.rows[0]?.volatility || 0.05;
  }

  private async getMaxLoss(): Promise<number> {
    return 1000;
  }
}

export default new RiskManager();