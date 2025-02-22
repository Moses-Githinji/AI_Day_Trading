import * as tf from "@tensorflow/tfjs";
import Redis from "ioredis";
import { SMA, RSI, MACD } from "technicalindicators";
import { logger } from "../utils/logger";
import "dotenv/config";

const redis = new Redis({ host: process.env.REDIS_HOST });

interface TradeData {
  close: number;
  volume: number;
  sma10?: number;
  sma50?: number;
  rsi?: number;
  macd?: number;
}

class Predictor {
  private model: tf.Sequential; // Always tf.Sequential, no undefined
  private scalerMin: number[] = [];
  private scalerMax: number[] = [];

  constructor() {
    // Synchronously initialize the model in the constructor
    this.model = this.initModel();
  }

  private initModel(): tf.Sequential {
    const model = tf.sequential();
    model.add(
      tf.layers.lstm({ units: 64, inputShape: [20, 6], returnSequences: true })
    );
    model.add(tf.layers.dropout({ rate: 0.3 }));
    model.add(tf.layers.lstm({ units: 32 }));
    model.add(tf.layers.dense({ units: 1, activation: "sigmoid" }));
    model.compile({
      optimizer: tf.train.adam(0.001),
      loss: "binaryCrossentropy",
      metrics: ["accuracy"],
    });
    return model;
  }

  async addIndicators(data: TradeData[]): Promise<TradeData[]> {
    const closes = data.map((d) => d.close);
    const sma10 = SMA.calculate({ period: 10, values: closes });
    const sma50 = SMA.calculate({ period: 50, values: closes });
    const rsi = RSI.calculate({ period: 14, values: closes });
    const macdValues = MACD.calculate({
      values: closes,
      fastPeriod: 12,
      slowPeriod: 26,
      signalPeriod: 9,
      SimpleMAOscillator: false,
      SimpleMASignal: false,
    });

    return data
      .slice(50)
      .map((row, i) => ({
        ...row,
        sma10: sma10[i + 40] || 0,
        sma50: sma50[i] || 0,
        rsi: rsi[i + 36] || 0,
        macd: macdValues[i + 17]?.MACD || 0,
      }))
      .filter((r) => r.sma10 && r.sma50 && r.rsi && r.macd);
  }

  async train(data: TradeData[]) {
    if (!data || data.length < 50) {
      logger.error("Insufficient data for training");
      throw new Error("Insufficient data for training");
    }

    const processedData = await this.addIndicators(data);
    const featureColumns = [
      "close",
      "volume",
      "sma10",
      "sma50",
      "rsi",
      "macd",
    ] as const;
    // X is an array of number arrays, where each inner array corresponds to the feature values
    const X = processedData.map(
      (row) => featureColumns.map((col) => row[col] as number) // TypeScript now knows col is a valid key
    );
    const y = processedData.map((row, i, arr) =>
      i > 0 && row.close > arr[i - 1].close * 1.01 ? 1 : 0
    );

    const normalizedX = this.normalize(X);
    const trainSize = Math.floor(0.8 * X.length);
    const XTrain = tf.tensor3d(
      normalizedX.slice(0, trainSize).map((row) => row.map((v) => [v])),
      [trainSize, 20, 6]
    );
    const yTrain = tf.tensor2d(
      y.slice(0, trainSize).map((v) => [v]),
      [trainSize, 1]
    );

    await this.model.fit(XTrain, yTrain, {
      epochs: 100,
      batchSize: 32,
      validationSplit: 0.2,
      callbacks: {
        onEpochEnd: (epoch: number, logs?: tf.Logs) => {
          // Just log, don’t return anything
          logger.info(`Epoch ${epoch}: Loss = ${logs?.loss}`);
        },
      },
    });
    await this.model.save("file://./model");
    logger.info("Model trained and saved");
  }

  async predict(data: TradeData[]): Promise<number> {
    if (!data || data.length < 20) {
      logger.error("Insufficient data for prediction");
      return 0; // Default prediction if data is insufficient
    }

    const processedData = await this.addIndicators(data.slice(-20));
    const featureColumns = [
      "close",
      "volume",
      "sma10",
      "sma50",
      "rsi",
      "macd",
    ] as const;
    const X = processedData.map((row) =>
      featureColumns.map((col) => row[col] as number)
    );
    const normalizedX = this.normalize(X);

    // Ensure we have enough data points after normalization
    if (normalizedX.length < 1) {
      logger.error("Not enough processed data for prediction");
      return 0;
    }

    const input = tf.tensor3d(
      [normalizedX.map((row) => row.map((v) => [v]))[0]],
      [1, 20, 6]
    );
    return tf.tidy(
      () => (this.model.predict(input) as tf.Tensor).dataSync()[0]
    );
  }

  private normalize(data: number[][]): number[][] {
    if (!data.length) return [];
    this.scalerMin = data[0].map((_, i) =>
      Math.min(...data.map((row) => row[i]))
    );
    this.scalerMax = data[0].map((_, i) =>
      Math.max(...data.map((row) => row[i]))
    );
    return data.map((row) =>
      row.map(
        (v, i) =>
          (v - this.scalerMin[i]) / (this.scalerMax[i] - this.scalerMin[i] || 1)
      )
    );
  }
}

export default new Predictor();
