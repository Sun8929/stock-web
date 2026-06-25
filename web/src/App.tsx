import { useState, useEffect, useRef } from 'react';
import {
  analyzeStock,
  isMarketOpen,
  GLOBAL_STOCK_LIST,
  type AnalysisResult,
  type ScreenFilters
} from './screener';
import './App.css';

// Pre-mapped sectors for top stocks to instantly find similar stocks without excessive API hits
const STOCK_SECTOR_MAP: Record<string, { sector: string; industry: string }> = {
  AAPL: { sector: 'Technology', industry: 'Consumer Electronics' },
  MSFT: { sector: 'Technology', industry: 'Software - Infrastructure' },
  GOOGL: { sector: 'Communication Services', industry: 'Internet Content & Information' },
  AMZN: { sector: 'Consumer Cyclical', industry: 'Internet Retail' },
  TSLA: { sector: 'Consumer Cyclical', industry: 'Auto Manufacturers' },
  META: { sector: 'Communication Services', industry: 'Internet Content & Information' },
  NVDA: { sector: 'Technology', industry: 'Semiconductors' },
  NFLX: { sector: 'Communication Services', industry: 'Entertainment' },
  AMD: { sector: 'Technology', industry: 'Semiconductors' },
  INTC: { sector: 'Technology', industry: 'Semiconductors' },
  CRM: { sector: 'Technology', industry: 'Software - Application' },
  ORCL: { sector: 'Technology', industry: 'Software - Infrastructure' },
  ADBE: { sector: 'Technology', industry: 'Software - Infrastructure' },
  PYPL: { sector: 'Financial', industry: 'Credit Services' },
  UBER: { sector: 'Technology', industry: 'Software - Application' },
  SHOP: { sector: 'Technology', industry: 'Software - Application' },
  PLTR: { sector: 'Technology', industry: 'Software - Infrastructure' },
  COIN: { sector: 'Financial', industry: 'Capital Markets' },
  MSTR: { sector: 'Technology', industry: 'Software - Application' },
  JPM: { sector: 'Financial', industry: 'Banks - Diverse' },
  BAC: { sector: 'Financial', industry: 'Banks - Diverse' },
  WFC: { sector: 'Financial', industry: 'Banks - Diverse' },
  GS: { sector: 'Financial', industry: 'Capital Markets' },
  MS: { sector: 'Financial', industry: 'Capital Markets' },
  V: { sector: 'Financial', industry: 'Credit Services' },
  MA: { sector: 'Financial', industry: 'Credit Services' },
  UNH: { sector: 'Healthcare', industry: 'Healthcare Plans' },
  JNJ: { sector: 'Healthcare', industry: 'Drug Manufacturers - General' },
  PFE: { sector: 'Healthcare', industry: 'Drug Manufacturers - General' },
  MRNA: { sector: 'Healthcare', industry: 'Biotechnology' },
  WMT: { sector: 'Consumer Defensive', industry: 'Discount Stores' },
  PG: { sector: 'Consumer Defensive', industry: 'Household & Personal Products' },
  KO: { sector: 'Consumer Defensive', industry: 'Beverages - Non-Alcoholic' },
  PEP: { sector: 'Consumer Defensive', industry: 'Beverages - Non-Alcoholic' },
  COST: { sector: 'Consumer Defensive', industry: 'Discount Stores' },
  HD: { sector: 'Consumer Cyclical', industry: 'Home Improvement Retail' },
  NKE: { sector: 'Consumer Cyclical', industry: 'Footwear & Accessories' },
  DIS: { sector: 'Communication Services', industry: 'Entertainment' },
  XOM: { sector: 'Energy', industry: 'Oil & Gas Integrated' },
  CVX: { sector: 'Energy', industry: 'Oil & Gas Integrated' },
};

interface TerminalLine {
  text: string;
  type: 'info' | 'success' | 'warning' | 'error' | 'neutral';
}

export default function App() {
  const [activeTab, setActiveTab] = useState<'analyze' | 'scan'>('analyze');
  const [searchSymbol, setSearchSymbol] = useState('');
  const [selectedStock, setSelectedStock] = useState<AnalysisResult | null>(null);
  const [similarStocks, setSimilarStocks] = useState<AnalysisResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState({ current: 0, total: 0 });
  const [qualifiedStocks, setQualifiedStocks] = useState<AnalysisResult[]>([]);
  
  // Terminal Logs
  const [terminalLogs, setTerminalLogs] = useState<TerminalLine[]>([
    { text: '🤖 AI Stock Screener Pro Terminal v1.0.0 initialized.', type: 'info' },
    { text: 'Ready for scanning or stock analysis. Select option above.', type: 'neutral' },
  ]);
  
  // Screener Filters
  const [filters, setFilters] = useState<ScreenFilters>({
    minPrice: 3.0,
    minMarketCap: 300_000_000,
    maxMarketCap: 50_000_000_000, // Boosted maximum market cap for flexibility
    minVolume: 500_000,          // Reduced from 1M to allow more interesting mid-caps
    minVolatility: 3.0,          // Reduced from 5% to capture standard volatility
    minPredictedReturn: 3.0,     // Predict at least 3% return
  });

  const terminalEndRef = useRef<HTMLDivElement>(null);
  const scanCancelRef = useRef<boolean>(false);

  // Auto Scroll Terminal to bottom
  useEffect(() => {
    if (terminalEndRef.current) {
      terminalEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [terminalLogs]);

  const addTerminalLine = (text: string, type: 'info' | 'success' | 'warning' | 'error' | 'neutral' = 'neutral') => {
    setTerminalLogs(prev => [...prev, { text, type }]);
  };

  // Perform Stock Analysis
  const handleAnalyze = async (symbol: string) => {
    if (!symbol) return;
    setIsLoading(true);
    setSelectedStock(null);
    setSimilarStocks([]);
    
    addTerminalLine(`\n$ python app.py --analyze ${symbol.toUpperCase()}`, 'info');
    addTerminalLine(`🔍 Initializing analysis for ${symbol.toUpperCase()}...`, 'info');
    addTerminalLine(`📥 Fetching data from Yahoo Finance API via CORS proxy...`, 'neutral');

    try {
      const result = await analyzeStock(symbol, false, filters);
      
      if (result) {
        addTerminalLine(`✅ Data fetched. Data points: ${result.data_points} periods.`, 'neutral');
        addTerminalLine(`📊 Volatility: ${result.volatility.toFixed(2)}% | Trend: ${result.price_trend}`, 'neutral');
        addTerminalLine(`🧠 Training RandomForestRegressor Model (50 trees, max_depth=10)...`, 'neutral');
        addTerminalLine(`🔮 Prediction: Return is forecast at ${result.predicted_return.toFixed(2)}%`, 'success');
        addTerminalLine(`🎯 Recommendation: ${result.recommendation}`, 'success');
        
        setSelectedStock(result);

        // Find similar stocks based on Sector/Industry
        const searchUpper = symbol.toUpperCase();
        let matchedSector = result.sector;
        let matchedIndustry = result.industry;

        // Fallback to static map if API profile is empty
        if ((!matchedSector || matchedSector === 'N/A') && STOCK_SECTOR_MAP[searchUpper]) {
          matchedSector = STOCK_SECTOR_MAP[searchUpper].sector;
          matchedIndustry = STOCK_SECTOR_MAP[searchUpper].industry;
        }

        if (matchedSector && matchedSector !== 'N/A') {
          addTerminalLine(`🌍 Finding other stocks in Sector: "${matchedSector}" & Industry: "${matchedIndustry}"...`, 'info');
          
          // Filter GLOBAL_STOCK_LIST for candidates in the same sector
          const candidates = GLOBAL_STOCK_LIST.filter(sym => {
            if (sym === searchUpper) return false;
            const mapped = STOCK_SECTOR_MAP[sym];
            return mapped && mapped.sector === matchedSector;
          }).slice(0, 4); // Analyze up to 4 related stocks in parallel

          if (candidates.length > 0) {
            addTerminalLine(`⚡ Scanning related symbols: ${candidates.join(', ')}...`, 'neutral');
            const similarResults: AnalysisResult[] = [];
            
            for (const cand of candidates) {
              const res = await analyzeStock(cand, false, filters);
              if (res) {
                similarResults.push(res);
                addTerminalLine(`   • ${cand}: ${res.recommendation} (${res.predicted_return.toFixed(1)}% Pred)`, 
                  res.action === 'BUY' ? 'success' : 'neutral'
                );
              }
            }
            // Sort by predicted return descending
            similarResults.sort((a, b) => b.predicted_return - a.predicted_return);
            setSimilarStocks(similarResults);
          } else {
            addTerminalLine(`⚠️ No other pre-cached stocks found in this sector.`, 'warning');
          }
        }
      } else {
        addTerminalLine(`❌ Symbol ${symbol.toUpperCase()} - Analysis failed. Insufficient data or symbol not found.`, 'error');
      }
    } catch (e: any) {
      addTerminalLine(`❌ Analysis Error: ${e?.message || e}`, 'error');
    } finally {
      setIsLoading(false);
    }
  };

  // Run Full Scan
  const handleStartScan = async () => {
    setIsScanning(true);
    setQualifiedStocks([]);
    scanCancelRef.current = false;
    
    addTerminalLine(`\n$ python app.py --scan`, 'info');
    addTerminalLine(`🔍 AI Stock Screener Starting...`, 'info');
    addTerminalLine(`📊 Market Status: ${isMarketOpen() ? '🟢 OPEN' : '🔴 CLOSED'}`, 'neutral');
    addTerminalLine(`📋 SCAN CRITERIA:`, 'info');
    addTerminalLine(`• 💰 Price: ≥ $${filters.minPrice.toFixed(2)}`);
    addTerminalLine(`• 🏢 Market Cap: $${(filters.minMarketCap / 1e6).toFixed(0)}M - $${(filters.maxMarketCap / 1e9).toFixed(1)}B`);
    addTerminalLine(`• 📊 Volatility: > ${filters.minVolatility}%`);
    addTerminalLine(`• 📈 Volume: > ${(filters.minVolume / 1e6).toFixed(1)}M average`);
    addTerminalLine(`• 🎯 Target Return: ≥ ${filters.minPredictedReturn}%`);
    addTerminalLine(`⚡ Real-time scan starting on ${GLOBAL_STOCK_LIST.length} global symbols...`, 'neutral');

    const qualified: AnalysisResult[] = [];
    setScanProgress({ current: 0, total: GLOBAL_STOCK_LIST.length });

    for (let i = 0; i < GLOBAL_STOCK_LIST.length; i++) {
      if (scanCancelRef.current) {
        addTerminalLine(`🛑 Scan aborted by user.`, 'warning');
        break;
      }

      const symbol = GLOBAL_STOCK_LIST[i];
      setScanProgress(prev => ({ ...prev, current: i + 1 }));

      try {
        // Slow down slightly to avoid API rate limits
        await new Promise(resolve => setTimeout(resolve, 200));

        const result = await analyzeStock(symbol, true, filters);
        
        if (result && result.tp_data) {
          qualified.push(result);
          setQualifiedStocks([...qualified]);
          
          addTerminalLine(`🎯 ${symbol} 🟢 LONG POSITION`, 'success');
          addTerminalLine(`   • Price: $${result.current_price.toFixed(2)}`);
          addTerminalLine(`   • TP1: $${result.tp_data.take_profit_1.toFixed(2)} (${result.tp_data.tp1_percent.toFixed(1)}%)`);
          addTerminalLine(`   • TP2: $${result.tp_data.take_profit_2.toFixed(2)} (${result.tp_data.tp2_percent.toFixed(1)}%)`);
          addTerminalLine(`   • Potential Gain: ${result.tp_data.total_gain_percent.toFixed(1)}%`, 'success');
          addTerminalLine(`------------------------------------------------`, 'neutral');
        } else {
          // Silent progress update log in terminal every 10 stocks
          if ((i + 1) % 10 === 0) {
            addTerminalLine(`🔍 Progress: ${i + 1}/${GLOBAL_STOCK_LIST.length} scanned | Found: ${qualified.length}`, 'neutral');
          }
        }
      } catch (e) {
        // Ignore single errors and proceed
      }
    }

    addTerminalLine(`\n================================================`, 'info');
    addTerminalLine(`✅ Scan Complete!`, 'success');
    addTerminalLine(`• Scanned: ${GLOBAL_STOCK_LIST.length} stocks`);
    addTerminalLine(`• Qualified: ${qualified.length} opportunities`, 'success');
    addTerminalLine(`================================================`, 'info');
    setIsScanning(false);
  };

  const handleStopScan = () => {
    scanCancelRef.current = true;
    setIsScanning(false);
  };

  // Custom SVG chart path rendering
  const renderChart = (stock: AnalysisResult) => {
    const prices = stock.historyClose;
    const minVal = Math.min(...prices);
    const maxVal = Math.max(...prices);
    const spread = maxVal - minVal || 1;
    
    // Draw in a 500x200 canvas coordinate system
    const width = 500;
    const height = 180;
    const padding = 20;

    const points = prices.map((price, idx) => {
      const x = padding + (idx / (prices.length - 1)) * (width - padding * 2);
      const y = height - padding - ((price - minVal) / spread) * (height - padding * 2);
      return { x, y };
    });

    const pathData = points.reduce((acc, p, idx) => {
      return idx === 0 ? `M ${p.x} ${p.y}` : `${acc} L ${p.x} ${p.y}`;
    }, '');

    // Shadow Area below line
    const areaData = pathData + ` L ${points[points.length - 1].x} ${height - padding} L ${points[0].x} ${height - padding} Z`;

    // Dynamic targets
    const tp1 = stock.tp_data?.take_profit_1;
    const tp2 = stock.tp_data?.take_profit_2;

    const getTargetY = (targetVal: number) => {
      return height - padding - ((targetVal - minVal) / spread) * (height - padding * 2);
    };

    return (
      <svg className="chart-svg" viewBox={`0 0 ${width} ${height}`}>
        <defs>
          <linearGradient id="chartGlow" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--accent-blue)" stopOpacity="0.25" />
            <stop offset="100%" stopColor="var(--accent-blue)" stopOpacity="0.0" />
          </linearGradient>
          <linearGradient id="lineGrad" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="var(--accent-cyan)" />
            <stop offset="100%" stopColor="var(--accent-purple)" />
          </linearGradient>
        </defs>

        {/* Grid lines */}
        <line x1={padding} y1={padding} x2={width - padding} y2={padding} stroke="rgba(255,255,255,0.03)" />
        <line x1={padding} y1={height / 2} x2={width - padding} y2={height / 2} stroke="rgba(255,255,255,0.03)" />
        <line x1={padding} y1={height - padding} x2={width - padding} y2={height - padding} stroke="rgba(255,255,255,0.05)" />

        {/* Area fill */}
        <path d={areaData} fill="url(#chartGlow)" />

        {/* Price Line */}
        <path d={pathData} fill="none" stroke="url(#lineGrad)" strokeWidth="3.5" strokeLinecap="round" />

        {/* Highlight current price */}
        <circle cx={points[points.length - 1].x} cy={points[points.length - 1].y} r="6" fill="var(--accent-cyan)" />
        <circle cx={points[points.length - 1].x} cy={points[points.length - 1].y} r="12" fill="none" stroke="var(--accent-cyan)" strokeOpacity="0.5" strokeWidth="2">
          <animate attributeName="r" values="6;16;6" dur="2s" repeatCount="indefinite" />
        </circle>

        {/* Target Lines (TP1 and TP2) if available */}
        {tp1 && tp1 <= maxVal * 1.3 && (
          <>
            <line 
              x1={padding} 
              y1={getTargetY(tp1)} 
              x2={width - padding} 
              y2={getTargetY(tp1)} 
              stroke="var(--accent-cyan)" 
              strokeDasharray="4 4" 
              strokeOpacity="0.4"
            />
            <text x={width - 80} y={getTargetY(tp1) - 5} fill="var(--accent-cyan)" fontSize="8" fontWeight="bold">
              TP1: ${tp1.toFixed(2)}
            </text>
          </>
        )}

        {tp2 && tp2 <= maxVal * 1.3 && (
          <>
            <line 
              x1={padding} 
              y1={getTargetY(tp2)} 
              x2={width - padding} 
              y2={getTargetY(tp2)} 
              stroke="var(--accent-purple)" 
              strokeDasharray="4 4" 
              strokeOpacity="0.4"
            />
            <text x={width - 80} y={getTargetY(tp2) - 5} fill="var(--accent-purple)" fontSize="8" fontWeight="bold">
              TP2: ${tp2.toFixed(2)}
            </text>
          </>
        )}
      </svg>
    );
  };

  return (
    <div className="app-container">
      {/* Header */}
      <header className="app-header">
        <div className="logo-section">
          <span className="logo-icon">🤖</span>
          <div>
            <h1>AI Stock Screener Pro</h1>
            <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Automated Machine Learning Trading Signals</p>
          </div>
          <span>v1.0</span>
        </div>

        <div className={`market-status-pill ${isMarketOpen() ? 'open' : 'closed'}`}>
          <span className={`status-dot ${isMarketOpen() ? 'blink' : ''}`}></span>
          MARKET: {isMarketOpen() ? 'LIVE' : 'CLOSED'}
        </div>
      </header>

      {/* Tabs */}
      <div className="tabs">
        <button 
          className={`tab-btn ${activeTab === 'analyze' ? 'active' : ''}`}
          onClick={() => setActiveTab('analyze')}
        >
          🎯 Single Stock Analysis
        </button>
        <button 
          className={`tab-btn ${activeTab === 'scan' ? 'active' : ''}`}
          onClick={() => setActiveTab('scan')}
        >
          🔍 Market Screener Scan
        </button>
      </div>

      {/* Grid */}
      <div className="app-grid">
        {/* Sidebar Controls */}
        <aside className="sidebar">
          {/* Option 2: Search */}
          <div className="card">
            <h3 className="card-title">🔍 Analyze Symbol</h3>
            <div className="search-box">
              <input 
                type="text" 
                placeholder="Enter stock symbol (e.g. AAPL)" 
                className="search-input"
                value={searchSymbol}
                onChange={e => setSearchSymbol(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleAnalyze(searchSymbol)}
                disabled={isLoading || isScanning}
              />
              <button 
                className="btn" 
                onClick={() => handleAnalyze(searchSymbol)}
                disabled={isLoading || isScanning || !searchSymbol}
              >
                Analyze
              </button>
            </div>
            <p style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '0.5rem' }}>
              Queries historical hourly data, trains RandomForest model, and suggests targets.
            </p>
          </div>

          {/* Option 1: Screener Scan */}
          <div className="card">
            <h3 className="card-title">📊 Screener Scan</h3>
            {isScanning ? (
              <button className="btn btn-danger btn-scan" onClick={handleStopScan}>
                🛑 Stop Market Scan
              </button>
            ) : (
              <button className="btn btn-scan" onClick={handleStartScan} disabled={isLoading}>
                ⚡ Run Full Market Scan
              </button>
            )}
            
            {isScanning && (
              <div style={{ marginTop: '1rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                  <span>Scanning Stocks...</span>
                  <span>{scanProgress.current}/{scanProgress.total}</span>
                </div>
                <div style={{ background: 'var(--bg-tertiary)', height: '6px', borderRadius: '3px', marginTop: '0.25rem', overflow: 'hidden' }}>
                  <div 
                    style={{ 
                      background: 'linear-gradient(to right, var(--accent-cyan), var(--accent-purple))', 
                      height: '100%', 
                      width: `${(scanProgress.current / scanProgress.total) * 100}%`,
                      transition: 'width 0.1s ease'
                    }}
                  ></div>
                </div>
              </div>
            )}
          </div>

          {/* Configuration Panel */}
          <div className="card">
            <h3 className="card-title">⚙️ Scan Settings</h3>
            <div className="settings-form">
              <div className="form-group">
                <label>Minimum Price ($)</label>
                <input 
                  type="number" 
                  step="0.5" 
                  value={filters.minPrice} 
                  onChange={e => setFilters(prev => ({ ...prev, minPrice: parseFloat(e.target.value) || 0 }))}
                />
              </div>

              <div className="form-group">
                <label>Market Cap Range ($)</label>
                <div className="range-inputs">
                  <input 
                    type="number" 
                    placeholder="Min M"
                    value={filters.minMarketCap / 1e6} 
                    onChange={e => setFilters(prev => ({ ...prev, minMarketCap: (parseFloat(e.target.value) || 0) * 1e6 }))}
                  />
                  <input 
                    type="number" 
                    placeholder="Max B"
                    value={filters.maxMarketCap / 1e9} 
                    onChange={e => setFilters(prev => ({ ...prev, maxMarketCap: (parseFloat(e.target.value) || 0) * 1e9 }))}
                  />
                </div>
              </div>

              <div className="form-group">
                <label>Min Average Volume</label>
                <input 
                  type="number" 
                  value={filters.minVolume} 
                  onChange={e => setFilters(prev => ({ ...prev, minVolume: parseInt(e.target.value) || 0 }))}
                />
              </div>

              <div className="form-group">
                <label>Min Volatility (%)</label>
                <input 
                  type="number" 
                  step="0.5"
                  value={filters.minVolatility} 
                  onChange={e => setFilters(prev => ({ ...prev, minVolatility: parseFloat(e.target.value) || 0 }))}
                />
              </div>

              <div className="form-group">
                <label>Min Predicted Return (%)</label>
                <input 
                  type="number" 
                  step="0.5"
                  value={filters.minPredictedReturn} 
                  onChange={e => setFilters(prev => ({ ...prev, minPredictedReturn: parseFloat(e.target.value) || 0 }))}
                />
              </div>
            </div>
          </div>
        </aside>

        {/* Main Content Area */}
        <main className="main-content">
          {activeTab === 'analyze' ? (
            /* ANALYZE TAB */
            selectedStock ? (
              <div className="analysis-grid">
                {/* Left Card: Main statistics, charts, and recommendations */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                  <div className={`card ai-recommendation-card ${selectedStock.action.toLowerCase()}`}>
                    <div className="rec-header">
                      <div>
                        <h2 style={{ fontSize: '1.8rem', fontWeight: 800 }}>{selectedStock.symbol}</h2>
                        <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
                          {selectedStock.exchange} • {selectedStock.sector} • {selectedStock.country}
                        </p>
                      </div>
                      <span className={`rec-badge ${selectedStock.action.toLowerCase()}`}>
                        {selectedStock.recommendation}
                      </span>
                    </div>

                    <div className="metrics-row">
                      <div className="metric-box">
                        <span className="metric-label">Current Price</span>
                        <span className="metric-value">${selectedStock.current_price.toFixed(2)}</span>
                      </div>
                      <div className="metric-box">
                        <span className="metric-label">AI Forecast (24h)</span>
                        <span className={`metric-value ${selectedStock.predicted_return > 0 ? 'up' : 'down'}`}>
                          {selectedStock.predicted_return > 0 ? '+' : ''}{selectedStock.predicted_return.toFixed(2)}%
                        </span>
                        <span className="metric-desc">Confidence: {(selectedStock.confidence * 100).toFixed(0)}%</span>
                      </div>
                    </div>

                    {/* Target Price Levels */}
                    {selectedStock.tp_data ? (
                      <div className="targets-box">
                        <div className="targets-title">
                          <span>🎯 Target Price Levels (Bullish Signal)</span>
                          <span className="target-gain">Potential Gain: {selectedStock.tp_data.total_gain_percent.toFixed(1)}%</span>
                        </div>
                        <div className="target-row">
                          <span className="target-tag">🟢 Take Profit 1 (Partial)</span>
                          <span className="target-price">${selectedStock.tp_data.take_profit_1.toFixed(2)}</span>
                        </div>
                        <div className="target-row">
                          <span className="target-tag">🚀 Take Profit 2 (Main)</span>
                          <span className="target-price">${selectedStock.tp_data.take_profit_2.toFixed(2)}</span>
                        </div>
                      </div>
                    ) : (
                      <div className="targets-box" style={{ background: 'rgba(255,255,255,0.01)' }}>
                        <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', textAlign: 'center' }}>
                          ⚪ Signal is neutral or bearish. No buy targets calculated.
                        </span>
                      </div>
                    )}

                    {/* Chart Component */}
                    <div style={{ marginTop: '0.5rem' }}>
                      <h4 style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', fontWeight: 700, marginBottom: '0.25rem' }}>
                        📈 Price History & AI Targets (Last 30 periods)
                      </h4>
                      <div className="chart-container">
                        {renderChart(selectedStock)}
                      </div>
                    </div>
                  </div>

                  {/* Stock Fundamentals Card */}
                  <div className="card">
                    <h3 className="card-title">📊 Key Fundamentals & Indicators</h3>
                    <div className="stats-table">
                      <div className="stat-item">
                        <span className="stat-label">Market Capitalization</span>
                        <span className="stat-value">${(selectedStock.market_cap / 1e9).toFixed(2)}B</span>
                      </div>
                      <div className="stat-item">
                        <span className="stat-label">Average Trading Volume</span>
                        <span className="stat-value">${(selectedStock.avg_volume / 1e6).toFixed(1)}M</span>
                      </div>
                      <div className="stat-item">
                        <span className="stat-label">P/E Ratio (Trailing)</span>
                        <span className="stat-value">{selectedStock.pe_ratio ? selectedStock.pe_ratio.toFixed(2) : 'N/A'}</span>
                      </div>
                      <div className="stat-item">
                        <span className="stat-label">Beta (Systemic Risk)</span>
                        <span className="stat-value">{selectedStock.beta ? selectedStock.beta.toFixed(2) : 'N/A'}</span>
                      </div>
                      <div className="stat-item">
                        <span className="stat-label">Annualized Volatility</span>
                        <span className="stat-value">{selectedStock.volatility.toFixed(1)}%</span>
                      </div>
                      <div className="stat-item">
                        <span className="stat-label">Volume Ratio</span>
                        <span className="stat-value">{selectedStock.volume_ratio.toFixed(2)}x</span>
                      </div>
                      <div className="stat-item">
                        <span className="stat-label">52-Week Range High</span>
                        <span className="stat-value" style={{ color: 'var(--accent-cyan)' }}>${selectedStock.fifty_two_week_high.toFixed(2)}</span>
                      </div>
                      <div className="stat-item">
                        <span className="stat-label">52-Week Range Low</span>
                        <span className="stat-value" style={{ color: 'var(--accent-purple)' }}>${selectedStock.fifty_two_week_low.toFixed(2)}</span>
                      </div>
                      <div className="stat-item">
                        <span className="stat-label">Last Updated Time</span>
                        <span className="stat-value">{selectedStock.last_update}</span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Right Card: Similar Stocks Finder ("Find a stock based from this one") */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                  <div className="card" style={{ height: '100%' }}>
                    <h3 className="card-title">
                      🌟 Similar Stocks in {selectedStock.sector || 'Sector'}
                    </h3>
                    <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '1rem', lineHeight: '1.4' }}>
                      Based on <strong>{selectedStock.symbol}</strong>, we scanned other stocks in the same sector. Here are the top-rated opportunities:
                    </p>

                    <div className="similar-stocks-box">
                      {similarStocks.length > 0 ? (
                        similarStocks.map(sim => (
                          <div 
                            key={sim.symbol} 
                            className="similar-stock-item"
                            onClick={() => handleAnalyze(sim.symbol)}
                          >
                            <div className="sim-sym-info">
                              <span className="sim-sym">{sim.symbol}</span>
                              <span className="sim-price">${sim.current_price.toFixed(2)}</span>
                            </div>
                            <div className="sim-sym-info" style={{ alignItems: 'flex-end' }}>
                              <span className={`sim-signal ${sim.action.toLowerCase()}`}>
                                {sim.recommendation.split(' ').slice(1).join(' ')}
                              </span>
                              <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                                {sim.predicted_return > 0 ? '+' : ''}{sim.predicted_return.toFixed(1)}%
                              </span>
                            </div>
                          </div>
                        ))
                      ) : (
                        <div style={{ textAlign: 'center', padding: '2rem 1rem', color: 'var(--text-muted)' }}>
                          🔍 No similar stocks scanned yet. Search a popular stock (like AAPL, MSFT, JPM, XOM) to find related ideas!
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              /* Analyze Welcome / Empty State */
              <div className="card welcome-card">
                <span className="welcome-icon">📈</span>
                <h2>Find Stock Signals & Predictions</h2>
                <p>
                  Enter any public stock symbol in the sidebar to fetch real-time market data, calculate pricing indices, fit an AI model, and predict short-term bullish returns.
                </p>
                <div className="welcome-actions">
                  <button className="btn" onClick={() => { setSearchSymbol('AAPL'); handleAnalyze('AAPL'); }}>
                    Try "AAPL"
                  </button>
                  <button className="btn btn-secondary" onClick={() => { setSearchSymbol('NVDA'); handleAnalyze('NVDA'); }}>
                    Try "NVDA"
                  </button>
                  <button className="btn btn-secondary" onClick={() => { setSearchSymbol('TSLA'); handleAnalyze('TSLA'); }}>
                    Try "TSLA"
                  </button>
                </div>
              </div>
            )
          ) : (
            /* SCAN TAB */
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
              {/* Retro Terminal Console */}
              <div className="card terminal-card">
                <div className="terminal-header">
                  <div className="terminal-title">
                    <span className="terminal-dot"></span>
                    <span>bash - stock_bot_screener.py</span>
                  </div>
                  <div className="terminal-controls">
                    <span className="term-btn red"></span>
                    <span className="term-btn yellow"></span>
                    <span className="term-btn green"></span>
                  </div>
                </div>
                <div className="terminal-body">
                  {terminalLogs.map((line, idx) => (
                    <div key={idx} className={`terminal-line ${line.type}`}>
                      {line.text}
                    </div>
                  ))}
                  <div className="terminal-input-line">
                    <span className="prompt">admin@antigravity:~/stock-bot$</span>
                    <span className="cursor"></span>
                  </div>
                  <div ref={terminalEndRef}></div>
                </div>
              </div>

              {/* Scan Results */}
              <div className="card">
                <h3 className="card-title">
                  🎯 Qualified Bullish Opportunities ({qualifiedStocks.length})
                </h3>
                
                {qualifiedStocks.length > 0 ? (
                  <div className="results-grid">
                    {qualifiedStocks.map(stock => (
                      <div 
                        key={stock.symbol} 
                        className="scan-result-card"
                        onClick={() => {
                          setSelectedStock(stock);
                          setActiveTab('analyze');
                        }}
                      >
                        <div className="res-card-header">
                          <div className="res-symbol-info">
                            <span className="res-symbol">{stock.symbol}</span>
                            <span className="res-industry">{stock.industry}</span>
                          </div>
                          <span className="res-gain-badge">
                            +{stock.predicted_return.toFixed(1)}% Est.
                          </span>
                        </div>

                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', marginTop: '0.25rem' }}>
                          <span style={{ color: 'var(--text-secondary)' }}>Price:</span>
                          <strong style={{ color: '#fff' }}>${stock.current_price.toFixed(2)}</strong>
                        </div>

                        {stock.tp_data && (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem', marginTop: '0.5rem', padding: '0.5rem', background: 'rgba(0,242,254,0.03)', borderRadius: '6px' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem' }}>
                              <span style={{ color: 'var(--text-secondary)' }}>TP1 target:</span>
                              <span style={{ color: 'var(--accent-cyan)', fontWeight: 'bold' }}>${stock.tp_data.take_profit_1.toFixed(2)}</span>
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem' }}>
                              <span style={{ color: 'var(--text-secondary)' }}>TP2 target:</span>
                              <span style={{ color: 'var(--accent-purple)', fontWeight: 'bold' }}>${stock.tp_data.take_profit_2.toFixed(2)}</span>
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div style={{ textAlign: 'center', padding: '4rem 2rem', color: 'var(--text-muted)' }}>
                    {isScanning ? (
                      <div>
                        <div className="welcome-icon">⚡</div>
                        <h4>Market Scan Running...</h4>
                        <p style={{ fontSize: '0.85rem', marginTop: '0.5rem' }}>
                          AI models are scanning active global stocks. Qualified bullish opportunities will pop up here in real-time.
                        </p>
                      </div>
                    ) : (
                      <div>
                        <div className="welcome-icon">🔍</div>
                        <h4>No scan results yet</h4>
                        <p style={{ fontSize: '0.85rem', marginTop: '0.5rem' }}>
                          Click the "Run Full Market Scan" button in the sidebar to start filtering stocks.
                        </p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
        </main>
      </div>

      <footer className="app-footer">
        <p>
          AI Stock Screener Pro • Code base: <a href="file:///D:/stock-bot_zenixy/app.py">app.py</a> • ML Strategy: RandomForestRegressor (Aggressive Targets)
        </p>
        <p style={{ fontSize: '0.75rem', marginTop: '0.5rem', color: 'var(--text-muted)' }}>
          Disclaimer: This dashboard simulates algorithmic quantitative models. AI projections are speculative. Always do your own research before trading.
        </p>
      </footer>
    </div>
  );
}
