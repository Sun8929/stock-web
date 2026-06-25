import { RandomForestRegressor } from './RandomForest';

export interface StockInfo {
  price: number;
  market_cap: number;
  avg_volume: number;
  pe_ratio: number;
  dividend_yield: number;
  beta: number;
  fifty_two_week_high: number;
  fifty_two_week_low: number;
  sector: string;
  industry: string;
  country: string;
  exchange: string;
}

export interface TPData {
  take_profit_1: number;
  take_profit_2: number;
  tp1_percent: number;
  tp2_percent: number;
  total_gain_percent: number;
  position_type: string;
}

export interface AnalysisResult {
  symbol: string;
  predicted_return: number;
  current_price: number;
  market_cap: number;
  avg_volume: number;
  pe_ratio: number;
  dividend_yield: number;
  beta: number;
  fifty_two_week_high: number;
  fifty_two_week_low: number;
  sector: string;
  industry: string;
  country: string;
  exchange: string;
  volatility: number;
  volume_ratio: number;
  price_trend: string;
  market_status: string;
  last_update: string;
  confidence: number;
  data_points: number;
  recommendation: string;
  action: 'BUY' | 'SELL' | 'HOLD';
  tp_data: TPData | null;
  historyClose: number[];
  historyTime: string[];
}

export interface ScreenFilters {
  minPrice: number;
  minMarketCap: number; // in USD
  maxMarketCap: number; // in USD
  minVolume: number;    // average volume
  minVolatility: number; // annualized volatility %
  minPredictedReturn: number;
}

// Proxies to bypass CORS. We will use corsproxy.io as primary because it handles browser requests very well.
const CORS_PROXIES = [
  (url: string) => `https://corsproxy.io/?${encodeURIComponent(url)}`,
  (url: string) => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
  (url: string) => url, // Direct fallback
];

async function fetchWithFallback(url: string): Promise<Response> {
  let lastError: Error | null = null;
  for (const proxyFn of CORS_PROXIES) {
    try {
      const proxiedUrl = proxyFn(url);
      const response = await fetch(proxiedUrl, {
        headers: {
          'Accept': 'application/json',
        }
      });
      if (response.ok) {
        return response;
      }
    } catch (e: any) {
      lastError = e;
    }
  }
  throw lastError || new Error(`Failed to fetch URL: ${url}`);
}

// Check if market is open (rough Eastern Time check)
export function isMarketOpen(): boolean {
  // Convert current time to ET
  const now = new Date();
  const etTime = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const day = etTime.getDay(); // 0 is Sunday, 6 is Saturday
  const hour = etTime.getHours();
  const minute = etTime.getMinutes();

  if (day === 0 || day === 6) return false;
  
  const marketStart = 9 * 60 + 30; // 9:30 AM
  const marketEnd = 16 * 60;       // 4:00 PM
  const currentMinutes = hour * 60 + minute;

  return currentMinutes >= marketStart && currentMinutes <= marketEnd;
}

// Fetch historical stock data
export async function fetchStockData(symbol: string, period = '3mo', interval = '1h'): Promise<any> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?range=${period}&interval=${interval}`;
  const response = await fetchWithFallback(url);
  const data = await response.json();
  
  if (!data?.chart?.result || data.chart.result.length === 0) {
    throw new Error(`No chart data found for ${symbol}`);
  }
  return data.chart.result[0];
}

// Fetch stock summary (P/E ratio, beta, industry, etc.)
export async function fetchStockSummary(symbol: string): Promise<StockInfo> {
  const url = `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${symbol}?modules=summaryProfile,financialData,defaultKeyStatistics,summaryDetail`;
  try {
    const response = await fetchWithFallback(url);
    const data = await response.json();
    
    const summary = data?.quoteSummary?.result?.[0];
    if (!summary) {
      throw new Error(`No summary data found for ${symbol}`);
    }

    const profile = summary.summaryProfile || {};
    const financial = summary.financialData || {};
    const keyStats = summary.defaultKeyStatistics || {};
    const detail = summary.summaryDetail || {};

    const price = financial.currentPrice?.raw || detail.regularMarketPrice?.raw || detail.previousClose?.raw || 0;
    const marketCap = detail.marketCap?.raw || keyStats.enterpriseValue?.raw || 0;
    const avgVolume = detail.averageVolume?.raw || detail.averageVolume10days?.raw || 1000000;

    return {
      price,
      market_cap: marketCap,
      avg_volume: avgVolume,
      pe_ratio: detail.trailingPE?.raw || detail.forwardPE?.raw || 0,
      dividend_yield: detail.dividendYield?.raw || 0,
      beta: detail.beta?.raw || 0,
      fifty_two_week_high: detail.fiftyTwoWeekHigh?.raw || price || 0,
      fifty_two_week_low: detail.fiftyTwoWeekLow?.raw || price || 0,
      sector: profile.sector || 'N/A',
      industry: profile.industry || 'N/A',
      country: profile.country || 'N/A',
      exchange: detail.exchange || summary.price?.exchangeName || 'N/A',
    };
  } catch (e) {
    // Return mock or stripped down info if summary fails, using basic meta from chart
    console.warn(`Summary fetch failed for ${symbol}, fallback used:`, e);
    return {
      price: 0,
      market_cap: 0,
      avg_volume: 1000000,
      pe_ratio: 0,
      dividend_yield: 0,
      beta: 0,
      fifty_two_week_high: 0,
      fifty_two_week_low: 0,
      sector: 'N/A',
      industry: 'N/A',
      country: 'N/A',
      exchange: 'N/A',
    };
  }
}

// Calculate technical indicators (rolling SMA, std, percent changes)
function calculatePriceFeatures(
  close: number[],
  high: number[],
  low: number[],
  volume: number[]
) {
  const n = close.length;
  if (n < 20) return null;

  // Features to compute
  const priceChange = new Array(n).fill(0);
  const priceChange5 = new Array(n).fill(0);
  const priceChange10 = new Array(n).fill(0);
  const sma5 = new Array(n).fill(0);
  const sma10 = new Array(n).fill(0);
  const sma20 = new Array(n).fill(0);
  const hlRatio = new Array(n).fill(0);
  const closePosition = new Array(n).fill(0);
  const volumeChange = new Array(n).fill(0);
  const volumeSma = new Array(n).fill(0);
  const volumeRatio = new Array(n).fill(0);
  const priceVolatility = new Array(n).fill(0);

  // Computations
  for (let i = 0; i < n; i++) {
    // Price change
    priceChange[i] = i >= 1 ? (close[i] - close[i - 1]) / close[i - 1] : 0;
    priceChange5[i] = i >= 5 ? (close[i] - close[i - 5]) / close[i - 5] : 0;
    priceChange10[i] = i >= 10 ? (close[i] - close[i - 10]) / close[i - 10] : 0;

    // High Low ratio & Close Position
    const hlDiff = high[i] - low[i];
    hlRatio[i] = close[i] !== 0 ? hlDiff / close[i] : 0;
    closePosition[i] = hlDiff !== 0 ? (close[i] - low[i]) / hlDiff : 0.5;

    // Volume change
    volumeChange[i] = i >= 1 && volume[i - 1] !== 0 ? (volume[i] - volume[i - 1]) / volume[i - 1] : 0;

    // Rollings
    sma5[i] = i >= 4 ? close.slice(i - 4, i + 1).reduce((s, v) => s + v, 0) / 5 : close[i];
    sma10[i] = i >= 9 ? close.slice(i - 9, i + 1).reduce((s, v) => s + v, 0) / 10 : close[i];
    sma20[i] = i >= 19 ? close.slice(i - 19, i + 1).reduce((s, v) => s + v, 0) / 20 : close[i];
    volumeSma[i] = i >= 19 ? volume.slice(i - 19, i + 1).reduce((s, v) => s + v, 0) / 20 : volume[i];
    volumeRatio[i] = volumeSma[i] !== 0 ? volume[i] / volumeSma[i] : 1;

    // Volatility (10-period standard deviation / 10-period rolling mean)
    if (i >= 9) {
      const slice = close.slice(i - 9, i + 1);
      const mean = sma10[i];
      const variance = slice.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / 10;
      const std = Math.sqrt(variance);
      priceVolatility[i] = mean !== 0 ? std / mean : 0.02;
    } else {
      priceVolatility[i] = 0.02;
    }
  }

  return {
    priceChange,
    priceChange5,
    priceChange10,
    sma5,
    sma10,
    sma20,
    hlRatio,
    closePosition,
    volumeChange,
    volumeRatio,
    priceVolatility,
  };
}

// Calculate annualized volatility
export function calculateVolatility(close: number[]): number {
  const n = close.length;
  if (n < 2) return 0;
  
  const returns: number[] = [];
  for (let i = 1; i < n; i++) {
    returns.push((close[i] - close[i - 1]) / close[i - 1]);
  }
  
  const mean = returns.reduce((s, v) => s + v, 0) / returns.length;
  const variance = returns.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / returns.length;
  const std = Math.sqrt(variance);
  
  // Annualized volatility (assuming ~252 trading days/periods)
  return std * Math.sqrt(252) * 100;
}

// Standard Scaler logic
class StandardScaler {
  private means: number[] = [];
  private stds: number[] = [];

  public fit(X: number[][]): void {
    const numSamples = X.length;
    if (numSamples === 0) return;
    const numFeatures = X[0].length;

    this.means = new Array(numFeatures).fill(0);
    this.stds = new Array(numFeatures).fill(0);

    for (let f = 0; f < numFeatures; f++) {
      let sum = 0;
      for (let s = 0; s < numSamples; s++) {
        sum += X[s][f];
      }
      this.means[f] = sum / numSamples;

      let varianceSum = 0;
      for (let s = 0; s < numSamples; s++) {
        varianceSum += Math.pow(X[s][f] - this.means[f], 2);
      }
      this.stds[f] = Math.sqrt(varianceSum / numSamples) || 1e-8; // Avoid division by zero
    }
  }

  public transform(X: number[][]): number[][] {
    return X.map(row =>
      row.map((val, f) => (val - this.means[f]) / this.stds[f])
    );
  }

  public transformRow(row: number[]): number[] {
    return row.map((val, f) => (val - this.means[f]) / this.stds[f]);
  }
}

// Aggressive take profit levels
function calculateTPLevelsAggressive(
  currentPrice: number,
  predictedReturn: number,
  volatilityEstimate: number
): TPData | null {
  if (predictedReturn <= 3) return null;

  const baseTarget = Math.max(5, Math.abs(predictedReturn) * 2);
  const volatilityFactor = Math.min(volatilityEstimate, 0.2); // Cap at 20%
  const predictionStrength = Math.min(Math.abs(predictedReturn) / 10, 1.0);

  const tp2Percent = Math.max(5, Math.min(100, baseTarget + (volatilityFactor * 50) + (predictionStrength * 30)));
  const tp1Percent = Math.max(5, tp2Percent * 0.6);

  const takeProfit1 = currentPrice * (1 + tp1Percent / 100);
  const takeProfit2 = currentPrice * (1 + tp2Percent / 100);

  return {
    take_profit_1: takeProfit1,
    take_profit_2: takeProfit2,
    tp1_percent: tp1Percent,
    tp2_percent: tp2Percent,
    total_gain_percent: tp2Percent,
    position_type: 'LONG',
  };
}

// AI Recommendation
function getAIRecommendation(
  predictedReturn: number,
  priceTrend: string,
  volumeRatio: number
): { recommendation: string; action: 'BUY' | 'SELL' | 'HOLD' } {
  let score = 0;

  if (predictedReturn > 5) score += 3;
  else if (predictedReturn > 0) score += 1;
  else if (predictedReturn < -5) score -= 3;
  else if (predictedReturn < 0) score -= 1;

  if (priceTrend === 'UP') score += 2;
  else if (priceTrend === 'DOWN') score -= 2;

  if (volumeRatio > 1.2) score += 1;
  else if (volumeRatio < 0.8) score -= 1;

  if (score >= 3) return { recommendation: '🟢 STRONG LONG', action: 'BUY' };
  if (score >= 1) return { recommendation: '🟡 WEAK LONG', action: 'BUY' };
  if (score <= -3) return { recommendation: '🔴 STRONG SHORT', action: 'SELL' };
  if (score <= -1) return { recommendation: '🟡 WEAK SHORT', action: 'SELL' };
  return { recommendation: '⚪ NEUTRAL', action: 'HOLD' };
}

// Analyze a stock symbol
export async function analyzeStock(
  symbol: string,
  forScan = false,
  filters: ScreenFilters = {
    minPrice: 3.0,
    minMarketCap: 300_000_000,
    maxMarketCap: 5_000_000_000,
    minVolume: 1_000_000,
    minVolatility: 5.0,
    minPredictedReturn: 5.0,
  }
): Promise<AnalysisResult | null> {
  try {
    // 1. Fetch Chart Data
    const chartData = await fetchStockData(symbol, '3mo', '1h');
    const timestamps = chartData.timestamp || [];
    const quotes = chartData.indicators.quote[0] || {};
    const close = quotes.close || [];
    const high = quotes.high || [];
    const low = quotes.low || [];
    const volume = quotes.volume || [];

    // Drop index-wise nulls or missing items
    const cleanData: { t: number; c: number; h: number; l: number; v: number }[] = [];
    for (let i = 0; i < close.length; i++) {
      if (
        close[i] !== null && close[i] !== undefined &&
        high[i] !== null && high[i] !== undefined &&
        low[i] !== null && low[i] !== undefined &&
        volume[i] !== null && volume[i] !== undefined
      ) {
        cleanData.push({
          t: timestamps[i],
          c: close[i],
          h: high[i],
          l: low[i],
          v: volume[i],
        });
      }
    }

    if (cleanData.length < 30) return null;

    const tClean = cleanData.map(d => d.t);
    const cClean = cleanData.map(d => d.c);
    const hClean = cleanData.map(d => d.h);
    const lClean = cleanData.map(d => d.l);
    const vClean = cleanData.map(d => d.v);

    // 2. Fetch Fundamentals
    const summary = await fetchStockSummary(symbol);
    
    // Fill current price from last chart close if summary has it zero
    if (summary.price === 0) {
      summary.price = cClean[cClean.length - 1];
    }
    // Fill market cap and average volume fallbacks if missing
    if (summary.market_cap === 0) {
      summary.market_cap = (chartData.meta?.marketCap) || 500_000_000;
    }
    if (summary.fifty_two_week_high === 0) {
      summary.fifty_two_week_high = (chartData.meta?.fiftyTwoWeekHigh) || summary.price * 1.2;
      summary.fifty_two_week_low = (chartData.meta?.fiftyTwoWeekLow) || summary.price * 0.8;
    }

    const price = summary.price;
    const marketCap = summary.market_cap;
    const avgVolume = summary.avg_volume;

    // Apply Screening Filters (Phase 1: Price, Cap, Volume)
    if (forScan) {
      if (price < filters.minPrice) return null;
      if (marketCap < filters.minMarketCap || marketCap > filters.maxMarketCap) return null;
      if (avgVolume < filters.minVolume) return null;
    }

    // 3. Compute indicators / features
    const feats = calculatePriceFeatures(cClean, hClean, lClean, vClean);
    if (!feats) return null;

    // Calculate annualized volatility
    const volatility = calculateVolatility(cClean);
    if (forScan && volatility <= filters.minVolatility) return null;

    // Prepare Features matrix (X) and targets (y)
    const featureKeys: (keyof typeof feats)[] = [
      'priceChange', 'priceChange5', 'priceChange10',
      'sma5', 'sma10', 'sma20',
      'hlRatio', 'closePosition', 'volumeChange',
      'volumeRatio', 'priceVolatility',
    ];

    const X: number[][] = [];
    const y: number[] = [];

    // Calculate future return (target is close 24 steps ahead, hourly)
    const lookahead = 24; 
    const dataLen = cClean.length;

    for (let i = 0; i < dataLen - lookahead; i++) {
      const row: number[] = [];
      let hasNaN = false;

      for (const key of featureKeys) {
        const val = feats[key][i];
        if (val === null || val === undefined || isNaN(val)) {
          hasNaN = true;
          break;
        }
        row.push(val);
      }

      if (hasNaN) continue;

      const futureReturn = ((cClean[i + lookahead] - cClean[i]) / cClean[i]) * 100;
      X.push(row);
      y.push(futureReturn);
    }

    if (X.length < 20) return null;

    // XLatest is the last complete row
    const XLatest: number[] = [];
    const lastIdx = dataLen - 1;
    for (const key of featureKeys) {
      XLatest.push(feats[key][lastIdx]);
    }

    if (XLatest.some(val => val === null || val === undefined || isNaN(val))) {
      return null;
    }

    // 4. Train RandomForestRegressor
    const scaler = new StandardScaler();
    scaler.fit(X);
    const XScaled = scaler.transform(X);
    const XLatestScaled = scaler.transformRow(XLatest);

    const rf = new RandomForestRegressor(50, 10, 5); // 50 estimators is enough and fast in browser
    rf.fit(XScaled, y);

    const predictedReturn = rf.predict(XLatestScaled);

    // Apply predicted return filter for scan
    if (forScan && predictedReturn < filters.minPredictedReturn) return null;

    // Volatility estimate for TP/SL (roughly based on standard deviation ratio)
    const priceVol = feats.priceVolatility[lastIdx] || 0.02;

    // Volume Ratio
    const volumeRatio = feats.volumeRatio[lastIdx] || 1;

    // Trend
    const sma20Val = feats.sma20[lastIdx] || price;
    const priceTrend = price > sma20Val ? 'UP' : 'DOWN';

    // Market status
    const isLive = isMarketOpen();
    const marketStatus = isLive ? 'LIVE' : 'CLOSED';
    
    const lastDate = new Date(tClean[tClean.length - 1] * 1000);
    const lastUpdateStr = lastDate.toISOString().replace('T', ' ').substring(0, 16);

    const { recommendation, action } = getAIRecommendation(
      predictedReturn,
      priceTrend,
      volumeRatio
    );

    const tpData = calculateTPLevelsAggressive(price, predictedReturn, priceVol);

    // For scan, we must have a long signal with TP data
    if (forScan && (!tpData || tpData.total_gain_percent < filters.minPredictedReturn)) {
      return null;
    }

    // History for charts: take last 30 closes & timestamps
    const historyClose = cClean.slice(-30);
    const historyTime = tClean.slice(-30).map(t => {
      const d = new Date(t * 1000);
      return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit' });
    });

    return {
      symbol: symbol.toUpperCase(),
      predicted_return: predictedReturn,
      current_price: price,
      market_cap: marketCap,
      avg_volume: avgVolume,
      pe_ratio: summary.pe_ratio,
      dividend_yield: summary.dividend_yield,
      beta: summary.beta,
      fifty_two_week_high: summary.fifty_two_week_high,
      fifty_two_week_low: summary.fifty_two_week_low,
      sector: summary.sector,
      industry: summary.industry,
      country: summary.country,
      exchange: summary.exchange,
      volatility,
      volume_ratio: volumeRatio,
      price_trend: priceTrend,
      market_status: marketStatus,
      last_update: lastUpdateStr,
      confidence: Math.min(Math.abs(predictedReturn) / 15, 1.0),
      data_points: cleanData.length,
      recommendation,
      action,
      tp_data: tpData,
      historyClose,
      historyTime,
    };
  } catch (e) {
    console.error(`Analysis error for ${symbol}:`, e);
    return null;
  }
}

// Built-in stocks list from app.py
export { GLOBAL_STOCK_LIST } from './stock_list';
