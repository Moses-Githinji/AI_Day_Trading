import { Pool } from "pg";
import Predictor from "../ai/predictor";
import RiskManager from "../risk/manager";
import { logger } from "../utils/logger";
import "dotenv/config";

const pool = new Pool({
  user: process.env.POSTGRES_USER,
  password: process.env.POSTGRES_PASSWORD,
  database: process.env.POSTGRES_DB,
  host: process.env.POSTGRES_HOST,
  port: 5432,
});

interface BacktestResult {
  totalProfit: number;
  trades: {
    symbol: string;
    side: string;
    price: number;
    qty: number;
    profit: number;
  }[];
}

class Backtester {
  async runBacktest(
    symbol: string,
    startDate: string,
    endDate: string
  ): Promise<BacktestResult> {
    const historical = await this.fetchHistoricalTrades(
      symbol,
      startDate,
      endDate
    );
    let cash = 10000;
    let position = 0;
    const trades: {
      symbol: string;
      side: string;
      price: any;
      qty: number;
      profit: number;
    }[] = [];

    for (let i = 20; i < historical.length; i++) {
      const window = historical.slice(i - 20, i);
      const prediction = await Predictor.predict(window);
      const currentPrice = historical[i].close;

      if (
        prediction > 0.5 &&
        cash > currentPrice &&
        (await RiskManager.checkRisk(symbol, 1, currentPrice))
      ) {
        position += 1;
        cash -= currentPrice;
        trades.push({
          symbol,
          side: "buy",
          price: currentPrice,
          qty: 1,
          profit: 0,
        });
      } else if (prediction < 0.5 && position > 0) {
        position -= 1;
        cash += currentPrice;
        const buyTrade = trades.find((t) => t.side === "buy" && t.profit === 0);
        if (buyTrade) buyTrade.profit = currentPrice - buyTrade.price;
      }
    }

    const totalProfit =
      cash - 10000 + position * historical[historical.length - 1].close;
    logger.info(`Backtest result for ${symbol}: Profit = ${totalProfit}`);
    return { totalProfit, trades };
  }

  private async fetchHistoricalTrades(
    symbol: string,
    start: string,
    end: string
  ) {
    const query = `
      SELECT price AS close, volume, timestamp
      FROM trades
      WHERE symbol = $1 AND timestamp BETWEEN $2 AND $3
      ORDER BY timestamp ASC
    `;
    const res = await pool.query(query, [symbol, start, end]);
    return res.rows;
  }
}

export default new Backtester();
