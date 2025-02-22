import Predictor from '../src/ai/predictor';

describe('Predictor', () => {
  it('should predict a value', async () => {
    const mockData = Array(20).fill(0).map((_, i) => ({ close: 100 + i, volume: 1000 }));
    const prediction = await Predictor.predict(mockData);
    expect(typeof prediction).toBe('number');
  });
});