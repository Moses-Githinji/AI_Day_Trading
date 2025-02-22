import yahooFinance from "yahoo-finance2";
import WebSocket from "ws";
import { Pool } from "pg";
import Redis from "ioredis";
import { logger } from "../utils/logger";
import "dotenv/config";

const pool = new Pool({
  user: process.env.POSTGRES_USER,
  password: process.env.POSTGRES_PASSWORD,
  database: process.env.POSTGRES_DB,
  host: process.env.POSTGRES_HOST,
  port: 5432,
});

const redis = new Redis({ host: process.env.REDIS_HOST });

interface HistoricalTrade {
  date: Date;
  close: number;
  volume: number;
}

class MarketData {
  private ws: WebSocket;

  constructor() {
    this.ws = new WebSocket("wss://stream.data.alpaca.markets/v2/iex");
    this.initRealTime();
  }

  async initRealTime() {
    this.ws.on("open", () => {
      this.ws.send(
        JSON.stringify({
          action: "auth",
          key: process.env.ALPACA_KEY,
          secret: process.env.ALPACA_SECRET,
        })
      );
      this.ws.send(JSON.stringify({ action: "subscribe", trades: ["AAPL"] }));
    });

    this.ws.on("message", async (data: string) => {
      try {
        const parsed = JSON.parse(data);
        if (parsed[0]?.T === "t") {
          const trade = {
            symbol: parsed[0].s,
            price: parsed[0].p,
            size: parsed[0].z,
            timestamp: new Date(parsed[0].t),
          };
          await this.storeTrade(trade);
          await redis.set(`price:${trade.symbol}`, trade.price, "EX", 60);
          await redis.lpush(`history:${trade.symbol}`, trade.price);
          redis.publish("trade", JSON.stringify(trade));
        }
      } catch (err) {
        logger.error("WebSocket message error:", err);
      }
    });

    this.ws.on("error", (err) => {
      logger.error("WebSocket error:", err);
      this.reconnect();
    });
  }

  async fetchHistoricalData(
    ticker: string,
    startDate: string,
    endDate: string
  ) {
    try {
      const data = await yahooFinance.chart(ticker, {
        period1: startDate,
        period2: endDate,
      });
      if (!data?.quotes || !Array.isArray(data.quotes)) {
        throw new Error("Invalid data format from Yahoo Finance");
      }

      // Map quotes array to HistoricalTrade format
      const df: HistoricalTrade[] = data.quotes
        .map((quote: any) => ({
          date: new Date(quote.date), // Use quote.date instead of timestamp
          close: quote.close || 0, // Fallback to 0 if null
          volume: quote.volume || 0, // Fallback to 0 if null
        }))
        .filter((trade) => trade.close !== 0); // Filter out invalid entries

      for (const trade of df) {
        await this.storeTrade({
          symbol: ticker,
          price: trade.close,
          size: trade.volume,
          timestamp: trade.date,
        });
        await redis.lpush(`history:${ticker}`, trade.close.toString());
      }
      return df;
    } catch (err) {
      logger.error("Error fetching historical data:", err);
      return [];
    }
  }

  private async storeTrade(trade: {
    symbol: string;
    price: number;
    size: number;
    timestamp: Date;
  }) {
    const query = `
      INSERT INTO trades (symbol, price, size, timestamp)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (timestamp, symbol) DO NOTHING
    `;
    await pool.query(query, [
      trade.symbol,
      trade.price,
      trade.size,
      trade.timestamp,
    ]);
  }

  private reconnect() {
    setTimeout(() => this.initRealTime(), 5000);
  }
}

export default new MarketData();
