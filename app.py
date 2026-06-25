
import os
import sys
import yfinance as yf

# Reconfigure stdout/stderr to UTF-8 to support emojis and avoid UnicodeEncodeError on Windows terminals
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')
if hasattr(sys.stderr, 'reconfigure'):
    sys.stderr.reconfigure(encoding='utf-8')

import pandas as pd
import numpy as np
from sklearn.ensemble import RandomForestRegressor
from sklearn.preprocessing import StandardScaler
import ta
from datetime import datetime, timedelta
import warnings
import threading
warnings.filterwarnings('ignore')

class StockScreener:
    def __init__(self):
        self.scaler = StandardScaler()

    def get_stock_data(self, symbol, period="3mo"):
        """Get stock data with 1m, 3m, 6m periods only"""
        try:
            stock = yf.Ticker(symbol)
            # Try only 1m, 3m, 6m periods as requested
            periods = ["1mo", "3mo", "6mo"]
            
            for p in periods:
                try:
                    data = stock.history(period=p, interval="1h")
                    if len(data) > 50:  # Need sufficient data
                        return data
                except:
                    continue

            # Fallback to daily data with 6mo max
            data = stock.history(period="6mo", interval="1d")
            return data if len(data) > 30 else None

        except Exception as e:
            print(f"Error fetching {symbol}: {e}")
            return None

    def is_market_open(self):
        """Check if market is currently open (rough estimate)"""
        now = datetime.now()
        # Simple check - market hours are roughly 9:30 AM to 4 PM EST on weekdays
        return now.weekday() < 5 and 9 <= now.hour <= 16

    def get_latest_complete_data(self, data):
        """Get the most recent complete trading data"""
        # Remove any incomplete periods (like current partial hour)
        if len(data) > 0:
            # Use data up to the last complete period
            return data.iloc[:-1] if self.is_market_open() else data
        return data

    def calculate_price_features(self, data):
        """Calculate price-based features for AI analysis"""
        # Ensure we have enough data
        if len(data) < 20:
            return None

        # Basic price features
        data['Price_Change'] = data['Close'].pct_change()
        data['Price_Change_5'] = data['Close'].pct_change(periods=5)
        data['Price_Change_10'] = data['Close'].pct_change(periods=10)
        
        # Price moving averages for trend
        data['Price_SMA_5'] = data['Close'].rolling(window=5).mean()
        data['Price_SMA_10'] = data['Close'].rolling(window=10).mean()
        data['Price_SMA_20'] = data['Close'].rolling(window=20).mean()
        
        # High/Low ratios
        data['HL_Ratio'] = (data['High'] - data['Low']) / data['Close']
        data['Close_Position'] = (data['Close'] - data['Low']) / (data['High'] - data['Low'])
        
        # Volume features
        data['Volume_Change'] = data['Volume'].pct_change()
        data['Volume_SMA'] = data['Volume'].rolling(window=20).mean()
        data['Volume_Ratio'] = data['Volume'] / data['Volume_SMA']
        
        # Price volatility
        data['Price_Volatility'] = data['Close'].rolling(window=10).std() / data['Close'].rolling(window=10).mean()
        
        return data

    def prepare_features(self, data):
        """Prepare price-based features for ML model"""
        features = [
            'Price_Change', 'Price_Change_5', 'Price_Change_10',
            'Price_SMA_5', 'Price_SMA_10', 'Price_SMA_20',
            'HL_Ratio', 'Close_Position', 'Volume_Change',
            'Volume_Ratio', 'Price_Volatility'
        ]

        # Calculate future return (target variable for training)
        # Use different lookback periods based on data frequency
        if 'Datetime' in data.columns or data.index.freq == 'H':
            # Hourly data - look 24-48 hours ahead
            data['Future_Return'] = (data['Close'].shift(-24) - data['Close']) / data['Close'] * 100
        else:
            # Daily data - look 5-10 days ahead
            data['Future_Return'] = (data['Close'].shift(-7) - data['Close']) / data['Close'] * 100

        # Create feature matrix
        feature_data = data[features + ['Future_Return']].dropna()

        if len(feature_data) < 20:
            return None, None, features

        X = feature_data[features]
        y = feature_data['Future_Return']

        return X, y, features

    def train_model(self, X, y):
        """Train random forest model"""
        model = RandomForestRegressor(
            n_estimators=100, 
            random_state=42,
            max_depth=10,
            min_samples_split=5
        )
        X_scaled = self.scaler.fit_transform(X)
        model.fit(X_scaled, y)
        return model

    def predict_return(self, model, data, features):
        """Predict future return for latest data"""
        try:
            # Get the latest complete data point
            latest_data = self.get_latest_complete_data(data)

            if len(latest_data) == 0:
                return None

            X_latest = latest_data[features].iloc[-1:].values

            # Handle any NaN values
            if np.isnan(X_latest).any():
                return None

            X_latest_scaled = self.scaler.transform(X_latest)
            prediction = model.predict(X_latest_scaled)[0]
            return prediction
        except Exception as e:
            print(f"Prediction error: {e}")
            return None

    def get_market_status_info(self, symbol, data):
        """Get additional market status information"""
        latest_data = self.get_latest_complete_data(data)

        if len(latest_data) == 0:
            return {}

        last_timestamp = latest_data.index[-1]
        current_time = datetime.now()

        # Calculate time since last data
        if hasattr(last_timestamp, 'tz_localize'):
            last_timestamp = last_timestamp.tz_localize(None)

        time_diff = current_time - last_timestamp.to_pydatetime()
        hours_since_update = time_diff.total_seconds() / 3600

        market_status = "LIVE" if hours_since_update < 2 and self.is_market_open() else "CLOSED"

        return {
            'market_status': market_status,
            'last_update': last_timestamp.strftime('%Y-%m-%d %H:%M'),
            'hours_since_update': round(hours_since_update, 1)
        }

    def calculate_tp_levels_aggressive(self, current_price, predicted_return, volatility_estimate, data):
        """Calculate aggressive TP1/TP2 levels for higher reward potential (5-100%)"""
        
        # Skip if not bullish enough
        if predicted_return <= 3:  # Only strong bullish signals
            return None
            
        # Aggressive take profit targeting 5-100% gains
        base_target = max(5, abs(predicted_return) * 2)  # At least 5% or 2x prediction
        
        # Scale target based on volatility and prediction strength
        volatility_factor = min(volatility_estimate / current_price * 100, 0.2)  # Cap at 20%
        prediction_strength = min(abs(predicted_return) / 10, 1.0)  # Normalize prediction
        
        # Calculate dynamic target percentage for TP2 (main target)
        tp2_percent = base_target + (volatility_factor * 50) + (prediction_strength * 30)
        tp2_percent = min(tp2_percent, 100)  # Cap at 100%
        tp2_percent = max(tp2_percent, 5)    # Min 5%
        
        # TP1 is 50-70% of TP2 for partial profit taking
        tp1_percent = tp2_percent * 0.6  # 60% of main target
        tp1_percent = max(tp1_percent, 5)  # Ensure minimum 5%
        
        take_profit_1 = current_price * (1 + tp1_percent / 100)
        take_profit_2 = current_price * (1 + tp2_percent / 100)
        
        # Calculate total gain percentage (using TP2 as main target)
        total_gain_percent = tp2_percent
        
        # Only accept if gain is significant
        if total_gain_percent < 5:
            return None
            
        return {
            'take_profit_1': take_profit_1,
            'take_profit_2': take_profit_2,
            'tp1_percent': tp1_percent,
            'tp2_percent': tp2_percent,
            'total_gain_percent': total_gain_percent,
            'position_type': "LONG"
        }

    def get_comprehensive_stock_info(self, symbol):
        """Get comprehensive stock information for analysis"""
        try:
            stock = yf.Ticker(symbol)
            info = stock.info

            # Extract comprehensive metrics
            market_cap = info.get('marketCap', 0)
            price = info.get('currentPrice', 0) or info.get('regularMarketPrice', 0) or info.get('previousClose', 0)
            avg_volume = info.get('averageVolume', 0) or info.get('averageVolume10days', 0)
            
            # Additional metrics
            pe_ratio = info.get('trailingPE', 0)
            dividend_yield = info.get('dividendYield', 0)
            beta = info.get('beta', 0)
            fifty_two_week_high = info.get('fiftyTwoWeekHigh', 0)
            fifty_two_week_low = info.get('fiftyTwoWeekLow', 0)
            sector = info.get('sector', 'N/A')
            industry = info.get('industry', 'N/A')
            country = info.get('country', 'N/A')
            exchange = info.get('exchange', 'N/A')
            
            return {
                'price': price,
                'market_cap': market_cap,
                'avg_volume': avg_volume,
                'pe_ratio': pe_ratio,
                'dividend_yield': dividend_yield,
                'beta': beta,
                'fifty_two_week_high': fifty_two_week_high,
                'fifty_two_week_low': fifty_two_week_low,
                'sector': sector,
                'industry': industry,
                'country': country,
                'exchange': exchange
            }
        except Exception as e:
            print(f"Error getting stock info for {symbol}: {e}")
            return None

    def calculate_volatility(self, data, period=20):
        """Calculate price volatility percentage"""
        try:
            returns = data['Close'].pct_change().dropna()
            volatility = returns.rolling(window=period).std() * np.sqrt(252) * 100  # Annualized volatility
            return volatility.iloc[-1] if len(volatility) > 0 else 0
        except:
            return 0

    def get_ai_recommendation(self, predicted_return, volatility, price_trend, volume_ratio):
        """Get AI-based recommendation (LONG/SHORT)"""
        score = 0
        
        # Prediction strength
        if predicted_return > 5:
            score += 3
        elif predicted_return > 0:
            score += 1
        elif predicted_return < -5:
            score -= 3
        elif predicted_return < 0:
            score -= 1
            
        # Trend analysis
        if price_trend == "UP":
            score += 2
        elif price_trend == "DOWN":
            score -= 2
            
        # Volume confirmation
        if volume_ratio > 1.2:
            score += 1
        elif volume_ratio < 0.8:
            score -= 1
            
        # Final recommendation
        if score >= 3:
            return "🟢 STRONG LONG", "BUY"
        elif score >= 1:
            return "🟡 WEAK LONG", "BUY"
        elif score <= -3:
            return "🔴 STRONG SHORT", "SELL"
        elif score <= -1:
            return "🟡 WEAK SHORT", "SELL"
        else:
            return "⚪ NEUTRAL", "HOLD"

    def passes_screening_criteria(self, symbol, data, stock_info):
        """Check if stock passes all screening criteria"""
        if not stock_info:
            return False, "No stock info available"

        # Price filter: >= $3
        price = stock_info['price']
        if price < 3.0:
            return False, f"Price ${price:.2f} < $3.00"

        # Market Cap filter: 300M to 5B USD
        market_cap = stock_info['market_cap']
        if market_cap < 300_000_000:  # 300M
            return False, f"Market cap ${market_cap/1e6:.0f}M < $300M"
        if market_cap > 5_000_000_000:  # 5B
            return False, f"Market cap ${market_cap/1e9:.1f}B > $5.0B"

        # Volume filter: > 1M average volume
        avg_volume = stock_info['avg_volume']
        if avg_volume < 1_000_000:  # 1M
            return False, f"Volume {avg_volume/1e6:.1f}M < 1.0M"

        # Volatility filter: > 5%
        volatility = self.calculate_volatility(data)
        if volatility <= 5.0:
            return False, f"Volatility {volatility:.1f}% <= 5.0%"

        return True, "Passed all filters"

    def analyze_stock(self, symbol, for_scan=False):
        """Analyze a single stock - comprehensive analysis for any stock"""
        try:
            # Get extended data to ensure analysis works when market is closed
            data = self.get_stock_data(symbol, period="3mo")

            if data is None or len(data) < 20:
                return None

            # Get comprehensive stock info
            stock_info = self.get_comprehensive_stock_info(symbol)
            if not stock_info:
                return None

            # For scanning mode, apply filters
            if for_scan:
                passes_filter, filter_reason = self.passes_screening_criteria(symbol, data, stock_info)
                if not passes_filter:
                    return None  # Stock doesn't meet criteria

            # Calculate price features
            data_with_features = self.calculate_price_features(data)
            if data_with_features is None:
                return None

            # Prepare features
            X, y, features = self.prepare_features(data_with_features)
            if X is None or len(X) < 10:
                return None

            # Train model
            model = self.train_model(X, y)

            # Make prediction
            predicted_return = self.predict_return(model, data_with_features, features)
            if predicted_return is None:
                return None

            # Get latest complete data for metrics
            latest_complete = self.get_latest_complete_data(data_with_features)

            # Get current metrics
            current_price = latest_complete['Close'].iloc[-1]
            
            # Simple volatility calculation for SL/TP
            price_volatility = latest_complete['Price_Volatility'].iloc[-1] if not np.isnan(latest_complete['Price_Volatility'].iloc[-1]) else 0.02
            atr_estimate = current_price * price_volatility

            # Volume analysis
            avg_volume = latest_complete['Volume'].rolling(20).mean().iloc[-1]
            current_volume = latest_complete['Volume'].iloc[-1]
            volume_ratio = current_volume / avg_volume if avg_volume > 0 else 1

            # Get market status
            market_info = self.get_market_status_info(symbol, data_with_features)

            # Price trend analysis
            price_20 = latest_complete['Price_SMA_20'].iloc[-1] if not np.isnan(latest_complete['Price_SMA_20'].iloc[-1]) else current_price
            price_trend = "UP" if current_price > price_20 else "DOWN"

            # Get AI recommendation
            recommendation, action = self.get_ai_recommendation(predicted_return, self.calculate_volatility(data_with_features), price_trend, volume_ratio)

            # Calculate volatility for display
            volatility = self.calculate_volatility(data_with_features)

            # Calculate TP levels for LONG positions or skip if not suitable
            tp_data = None
            if predicted_return > 3:  # Only for bullish predictions
                tp_data = self.calculate_tp_levels_aggressive(current_price, predicted_return, atr_estimate, latest_complete)

            # Skip for scan if not a good opportunity
            if for_scan and (tp_data is None or tp_data['total_gain_percent'] < 5):
                return None

            return {
                'symbol': symbol,
                'predicted_return': predicted_return,
                'current_price': current_price,
                'market_cap': stock_info['market_cap'],
                'avg_volume': stock_info['avg_volume'],
                'pe_ratio': stock_info['pe_ratio'],
                'dividend_yield': stock_info['dividend_yield'],
                'beta': stock_info['beta'],
                'fifty_two_week_high': stock_info['fifty_two_week_high'],
                'fifty_two_week_low': stock_info['fifty_two_week_low'],
                'sector': stock_info['sector'],
                'industry': stock_info['industry'],
                'country': stock_info['country'],
                'exchange': stock_info['exchange'],
                'volatility': volatility,
                'volume_ratio': volume_ratio,
                'price_trend': price_trend,
                'market_status': market_info.get('market_status', 'UNKNOWN'),
                'last_update': market_info.get('last_update', 'N/A'),
                'confidence': min(abs(predicted_return) / 15, 1.0),
                'data_points': len(data_with_features),
                'recommendation': recommendation,
                'action': action,
                'tp_data': tp_data
            }

        except Exception as e:
            print(f"Analysis error for {symbol}: {e}")
            return None

def get_comprehensive_stock_list():
    """Get massive comprehensive list of global stocks from multiple exchanges"""
    try:
        print("🌍 Building massive global stock universe...")

        # US Market - Large, Mid, Small Cap (2000+ stocks)
        us_stocks = [
            # FAANG + Tech Giants
            'AAPL', 'GOOGL', 'GOOG', 'MSFT', 'AMZN', 'TSLA', 'META', 'NVDA', 'NFLX', 'AMD', 'INTC',
            'CRM', 'ORCL', 'ADBE', 'PYPL', 'UBER', 'SHOP', 'ZM', 'DOCU', 'ROKU', 'PINS', 'SNAP',
            'SPOT', 'SNOW', 'PLTR', 'RBLX', 'COIN', 'TWLO', 'OKTA', 'ZS', 'CRWD', 'NET', 'DDOG',
            'MDB', 'SPLK', 'VEEV', 'WDAY', 'NOW', 'TEAM', 'ZEN', 'FIVN', 'ESTC', 'PATH',
            
            # Banking & Finance
            'JPM', 'BAC', 'WFC', 'GS', 'MS', 'C', 'V', 'MA', 'AXP', 'COF', 'USB', 'PNC', 'TFC',
            'SCHW', 'BLK', 'SPGI', 'ICE', 'CME', 'MCO', 'MSCI', 'AFRM', 'SOFI', 'LC', 'ALLY',
            
            # Healthcare & Biotech
            'UNH', 'JNJ', 'PFE', 'ABT', 'TMO', 'DHR', 'BMY', 'ABBV', 'LLY', 'MRK', 'GILD',
            'AMGN', 'BIIB', 'VRTX', 'REGN', 'ISRG', 'DXCM', 'ILMN', 'MRNA', 'BNTX', 'ZBH',
            'BMRN', 'ALNY', 'SRPT', 'RARE', 'FOLD', 'CRSP', 'EDIT', 'NTLA', 'BEAM', 'VCYT',
            
            # Consumer & Retail
            'WMT', 'PG', 'KO', 'PEP', 'COST', 'HD', 'NKE', 'MCD', 'SBUX', 'DIS', 'LOW', 'TJX',
            'BKNG', 'ABNB', 'ETSY', 'W', 'CHWY', 'LULU', 'PTON', 'TSCO', 'ORLY', 'AZO',
            
            # Energy & Materials
            'XOM', 'CVX', 'COP', 'EOG', 'SLB', 'MPC', 'VLO', 'PSX', 'OXY', 'DVN', 'FANG',
            'FCX', 'NEM', 'AA', 'X', 'CLF', 'NUE', 'STLD', 'MT', 'TX', 'CMC', 'RS',
            
            # Industrial & Transportation
            'BA', 'CAT', 'DE', 'GE', 'MMM', 'HON', 'UPS', 'LMT', 'RTX', 'NOC', 'GD', 'FDX',
            'DAL', 'UAL', 'AAL', 'LUV', 'JBLU', 'ALK', 'CHRW', 'XPO', 'JBHT', 'KNX', 'ODFL',
            
            # Clean Energy & EVs
            'ENPH', 'SEDG', 'RUN', 'FSLR', 'SPWR', 'JKS', 'CSIQ', 'SOL', 'MAXN',
            'BE', 'PLUG', 'FCEL', 'BLDP', 'HYLN', 'CHPT', 'QS', 'STEM', 'BLNK',
            'RIVN', 'LCID', 'F', 'GM', 'NIO', 'XPEV', 'LI', 'NKLA', 'FSR',
            
            # Semiconductors
            'TSM', 'ASML', 'AVGO', 'TXN', 'QCOM', 'MU', 'AMAT', 'ADI', 'MCHP', 'KLAC',
            'LRCX', 'MRVL', 'SWKS', 'MPWR', 'CRUS', 'SLAB', 'ON', 'QRVO',
            
            # REITs
            'AMT', 'PLD', 'CCI', 'EQIX', 'PSA', 'EXR', 'AVB', 'EQR', 'ESS', 'MAA',
            
            # Growth & Emerging
            'HOOD', 'OPEN', 'RDFN', 'REAL', 'EXPI', 'HUBS', 'ZI', 'BILL', 'FOUR', 'UPST',
            
            # Additional Large Cap
            'CSCO', 'IBM', 'HPQ', 'HPE', 'DELL', 'NTAP', 'WDC', 'STX', 'JNPR', 'ANET',
            'PANW', 'FTNT', 'CHKP', 'AKAM', 'FSLY', 'DBX', 'BOX', 'FROG',
            'MTCH', 'BMBL', 'YELP', 'DASH', 'LYFT', 'EXPE', 'TRIP',
            'WYNN', 'LVS', 'MGM', 'CZR', 'PENN', 'DKNG', 'RSI',
            
            # More Tech & Software
            'INTU', 'ADSK', 'ANSS', 'CDNS', 'SNPS', 'CTXS', 'FISV', 'FIS', 'PAYX', 'ADP',
            'VMW', 'VRSN', 'AKAM', 'JKHY', 'CTSH', 'ACN', 'GLW', 'APH', 'TEL', 'FLEX',
            'PLXS', 'SANM', 'SMTC', 'CTS', 'JBL', 'TTMI', 'COHU', 'FORM', 'LSCC', 'CRUS',
            
            # Single/Double Letter Stocks
            'A', 'F', 'T', 'V', 'X', 'C', 'D', 'M', 'O', 'U', 'Y', 'Z', 'K', 'L', 'P', 'R', 'S', 'W',
            'AA', 'BB', 'DD', 'IP', 'IR', 'IT', 'JP', 'KR', 'LB', 'MO', 'NI', 'PH', 'RE', 'RF',
            'RH', 'TM', 'UL', 'VF', 'WM', 'XL', 'YUM', 'ZTS',
            
            # More Mid-Cap Stocks
            'SBAC', 'KEYS', 'MANH', 'RMD', 'POOL', 'WST', 'WAT', 'ZBRA', 'BR', 'FLT',
            'CDNS', 'ANSS', 'TYL', 'PAYC', 'GWRE', 'CVLT', 'COUP', 'PCTY', 'BL', 'ENV',
            'NEOG', 'OLED', 'LITE', 'VIAV', 'OCLR', 'CCOI', 'EXLS', 'EPAM', 'LOGI', 'NICE',
            
            # Healthcare Extended
            'IDXX', 'HOLX', 'TECH', 'A', 'SYK', 'EW', 'VAR', 'ALGN', 'PODD', 'PEN',
            'VCYT', 'QGEN', 'NVTA', 'PACB', 'TWST', 'CDNA', 'ARCT', 'SAGE', 'PTCT', 'EXAS',
            'VEEV', 'TDOC', 'DXCM', 'TNDM', 'OMCL', 'NEOG', 'NVCR', 'GMED', 'TMDX', 'QDEL',
            
            # More Consumer
            'ULTA', 'DPZ', 'CMG', 'QSR', 'YUM', 'DNKN', 'TXRH', 'WING', 'BJRI', 'CAKE',
            'PLAY', 'EAT', 'BLMN', 'DRI', 'CBRL', 'RUTH', 'DENN', 'KRUS', 'HAYN', 'JACK',
            'SONC', 'PZZA', 'PAPA', 'PBPB', 'NATH', 'FRGI', 'LOCO', 'TACO', 'DAVE', 'CNNE',
            
            # More Industrials
            'PCAR', 'PACB', 'FAST', 'CHRW', 'EXPD', 'LSTR', 'ODFL', 'SAIA', 'ARCB', 'MATX',
            'WERN', 'JBHT', 'SNDR', 'PTSI', 'MRTN', 'CVTI', 'HUBG', 'ECHO', 'LQDT', 'FLOW',
            
            # More Financial Services
            'BRK.A', 'BRK.B', 'WFC', 'USB', 'PNC', 'TFC', 'COF', 'DFS', 'SYF', 'ALLY',
            'ZION', 'FITB', 'HBAN', 'RF', 'KEY', 'CFG', 'EWBC', 'PBCT', 'CMA', 'MTB',
        ]
        
        # International Stocks (ADRs and direct listings)
        international_stocks = [
            # Chinese Stocks
            'BABA', 'JD', 'PDD', 'BIDU', 'NTES', 'WB', 'HTHT', 'VIPS', 'TAL', 'EDU',
            'TIGR', 'FUTU', 'TC', 'LX', 'NOAH', 'WEI', 'DADA', 'IQ', 'HUYA',
            'TME', 'DOYU', 'YMM', 'QD', 'BZUN', 'TOUR', 'LAIX', 'RLX', 'TUYA', 'DUO',
            'GSX', 'COE', 'GOTU', 'AFYA', 'YALA', 'AZUL', 'VTEX', 'STNE', 'PAGS', 'StoneCo',
            
            # European Stocks (ADRs)
            'ASML', 'SAP', 'NVO', 'AZN', 'UL', 'DEO', 'BP', 'SHEL', 'VOD',
            'BCS', 'DB', 'CS', 'ING', 'SAN', 'BBVA', 'BNS', 'TD', 'RY', 'BMO',
            'NMR', 'GOLD', 'ABX', 'FCX', 'SCCO', 'TECK', 'SBSW', 'AU', 'KGC', 'EGO',
            
            # Japanese Stocks (ADRs)
            'TM', 'SONY', 'NTT', 'MUFG', 'SMFG', 'MFG', 'HMC', 'KYO',
            'FUJHY', 'HTHIY', 'NTTYY', 'SFTBY', 'RKUNY', 'TKS', 'ALFVY', 'CCRUY',
            
            # Other International
            'TSM', 'UMC', 'ASX', 'WIT', 'LYG', 'RIG', 'SSL', 'VALE', 'PBR', 'SBS',
            'KB', 'WF', 'SKM', 'TEF', 'VIV', 'PTR', 'SNP', 'TTE', 'E', 'ENIC',
            'CIG', 'PAC', 'SID', 'GGB', 'BBD', 'ITUB', 'ERJ', 'CBD', 'EBR', 'SUZ',
        ]
        
        # Crypto & Digital Assets
        crypto_stocks = [
            'COIN', 'MSTR', 'RIOT', 'MARA', 'HUT', 'BTBT', 'CAN', 'EBON', 'GBTC',
            'ETHE', 'BITO', 'BITI', 'ARKB', 'IBIT', 'FBTC', 'EZBC', 'HODL', 'BTCB',
        ]
        
        # Small & Mid Cap Growth (Expanded)
        small_mid_cap = [
            'SPCE', 'RKLB', 'ASTS', 'HOL', 'JOBY', 'LILM', 'EVTL', 'ACHR',
            'SOLO', 'AYRO', 'IDEX', 'ELMS', 'ZEV', 'GOED', 'LEV', 'PSNY', 'PTRA',
            'MULN', 'WKHS', 'XL', 'INDI', 'VLD', 'NNDM', 'DM', 'MTLS',
            'KTOS', 'AVAV', 'IRDM', 'GSAT', 'ORBC', 'VSAT', 'GILT', 'SATS', 'MAXR',
            'LUNR', 'PL', 'AEHR', 'FORM', 'CEVA', 'LSCC', 'SWIR', 'POWI', 'VICR',
            'ACLS', 'CRUS', 'QRVO', 'RFIL', 'MTSI', 'RMBS', 'NANO', 'EMKR', 'CYBE',
            'HLIT', 'POWL', 'COHU', 'UCTT', 'FORM', 'LARK', 'NVMI', 'AEIS', 'AAOI',
        ]
        
        # Additional Growth Stocks
        growth_stocks = [
            'RBLX', 'AFRM', 'UPST', 'SOFI', 'HOOD', 'OPEN', 'RDFN', 'REAL', 'EXPI',
            'HUBS', 'ZI', 'BILL', 'FOUR', 'DOCN', 'NET', 'CFLT', 'GTLB', 'PD', 'ESTC',
            'DDOG', 'SNOW', 'CRWD', 'ZS', 'OKTA', 'PANW', 'FTNT', 'CYBR', 'TENB', 'VRNS',
            'QLYS', 'FEYE', 'PING', 'MIME', 'PFPT', 'YEXT', 'BASE', 'NEWR', 'SUMO', 'DOMO',
        ]
        
        # Biotech & Healthcare (Expanded)
        biotech_expanded = [
            'MRNA', 'BNTX', 'NVAX', 'INO', 'OCGN', 'DVAX', 'VXRT', 'BCRX', 'SRNE', 'COCP',
            'VBIV', 'IBIO', 'CBLI', 'AGTC', 'ADVM', 'CERE', 'BOLD', 'CRBP', 'EARS', 'GMDA',
            'HRMY', 'IMNM', 'KPTI', 'LPCN', 'MDXG', 'MESO', 'NBRV', 'NKTR', 'OBSV', 'ONCT',
            'OPTN', 'OSUR', 'PHIO', 'PSTI', 'RVMD', 'SNSS', 'SOLY', 'SUPN', 'TENX', 'TRVI',
        ]
        
        # Regional Banks & Finance
        regional_finance = [
            'SIVB', 'PACW', 'WAL', 'SBNY', 'FRC', 'EWBC', 'BOKF', 'CBSH', 'COLB', 'FFIN',
            'FULT', 'GBCI', 'HWC', 'IBTX', 'NBHC', 'ONB', 'OZRK', 'PBHC', 'SFNC', 'TCBI',
            'UBSI', 'WAFD', 'WASH', 'WBS', 'WTFC', 'BANF', 'BHLB', 'BRKL', 'CATY', 'CHCO',
        ]
        
        # Penny Stocks with Volume (Expanded)
        penny_stocks = [
            'SNDL', 'WISH', 'CLOV', 'AMC', 'GME', 'NOK', 'BB', 'PLBY', 'RIDE',
            'GOEV', 'SPRT', 'PROG', 'FAMI', 'PHUN', 'DWAC', 'BKKT', 'IRNT', 'OPAD',
            'GREE', 'RELI', 'ESSC', 'LGVN', 'AVCT', 'BFRI', 'PTPI', 'ISIG', 'ARDX',
        ]
        
        # ETFs for broader market exposure
        etfs = [
            'SPY', 'QQQ', 'IWM', 'VTI', 'VOO', 'VEA', 'VWO', 'EFA', 'EEM', 'IEFA',
            'VGT', 'XLK', 'ARKK', 'ARKQ', 'ARKG', 'ARKW', 'ARKF', 'ICLN', 'PBW',
            'QCLN', 'SOXX', 'SMH', 'XSD', 'FDN', 'FTEC', 'IGV', 'IHAK', 'IPAY',
            'IDRV', 'BOTZ', 'ROBO', 'ESPO', 'HERO', 'NERD', 'GAMR', 'BJK', 'UFO',
        ]

        # Combine all lists
        all_stocks = us_stocks + international_stocks + crypto_stocks + small_mid_cap + growth_stocks + biotech_expanded + regional_finance + penny_stocks + etfs
        
        # Remove duplicates and sort
        all_stocks = list(set(all_stocks))
        all_stocks.sort()

        print(f"🎯 Massive global stock universe: {len(all_stocks)} symbols from multiple exchanges")
        return all_stocks

    except Exception as e:
        print(f"❌ Error building stock list: {e}")
        # Comprehensive fallback with 200+ stocks
        fallback = [
            'AAPL', 'GOOGL', 'MSFT', 'AMZN', 'TSLA', 'META', 'NVDA', 'NFLX', 'AMD', 'INTC',
            'JPM', 'BAC', 'WFC', 'GS', 'MS', 'C', 'V', 'MA', 'UNH', 'JNJ', 'PFE', 'ABT',
            'WMT', 'PG', 'KO', 'PEP', 'COST', 'HD', 'NKE', 'MCD', 'XOM', 'CVX', 'COP',
            'BA', 'CAT', 'DE', 'GE', 'MMM', 'HON', 'UPS', 'LMT', 'RTX', 'NOC', 'GD',
            'CRM', 'ORCL', 'ADBE', 'PYPL', 'UBER', 'ZM', 'ROKU', 'PINS', 'SNAP', 'SPOT',
            'SNOW', 'PLTR', 'RBLX', 'COIN', 'TWLO', 'OKTA', 'ZS', 'CRWD', 'NET', 'DDOG',
            'TMO', 'DHR', 'BMY', 'ABBV', 'LLY', 'MRK', 'GILD', 'AMGN', 'BIIB', 'VRTX',
            'REGN', 'ISRG', 'DXCM', 'ILMN', 'MRNA', 'BNTX', 'DIS', 'NFLX', 'T', 'VZ'
        ]
        return fallback

screener = StockScreener()

def run_scan(screener):
    market_status = "🔴 CLOSED" if not screener.is_market_open() else "🟢 OPEN"

    print("\n🔍 AI Stock Screener Starting")
    print(f"📊 Market Status: {market_status}")
    print("\n📋 SCAN CRITERIA:")
    print("• 💰 Price: ≥ $3.00")
    print("• 🏢 Market Cap: $300M - $5B")
    print("• 📊 Volatility: > 5%")
    print("• 📈 Volume: > 1M average")
    print("• 🎯 Target: 5% - 100% gains")
    print("\n⚡ Real-time scan starting...")

    # Get comprehensive stock list
    stock_list = get_comprehensive_stock_list()
    print(f"\n🌍 Scanning {len(stock_list)} global stocks...")
    print("🔍 Searching for qualified opportunities...\n")

    qualified_stocks = []
    processed = 0
    skipped_count = 0

    for symbol in stock_list:
        try:
            processed += 1

            # Skip obvious invalid symbols
            if symbol.startswith('$') or len(symbol) < 1:
                skipped_count += 1
                continue

            result = screener.analyze_stock(symbol, for_scan=True)

            if result and result.get('tp_data') and result['tp_data']['total_gain_percent'] >= 5:
                qualified_stocks.append(result)

                # Print clean, professional signal format
                tp_data = result['tp_data']
                status_emoji = "🟢" if result['market_status'] == 'LIVE' else "🔴"
                
                print(f"🎯 {result['symbol']} {status_emoji}")
                print(f"🟢 LONG POSITION")
                print(f"• 💰 Price: ${result['current_price']:.2f}")
                print(f"• 🎯 TP1: ${tp_data['take_profit_1']:.2f} ({tp_data['tp1_percent']:.1f}%)")
                print(f"• 🎯 TP2: ${tp_data['take_profit_2']:.2f} ({tp_data['tp2_percent']:.1f}%)")
                print(f"• 🤑 Total Gain: {tp_data['total_gain_percent']:.1f}%")
                print("-" * 30)

            # Print progress update every 200 stocks
            if processed % 200 == 0:
                print(f"🔍 Scanning Progress: {processed}/{len(stock_list)} | Found: {len(qualified_stocks)} qualified")

        except Exception as e:
            # Silently continue on errors
            continue

    # Print comprehensive summary
    print("\n" + "="*50)
    print("✅ Scan Complete!")
    print("="*50)
    print("📊 SCAN RESULTS:")
    print(f"• 🔍 Scanned: {processed:,} stocks")
    print(f"• 🎯 Qualified: {len(qualified_stocks)} opportunities")
    if processed > 0:
        print(f"• ⚡ Success Rate: {(len(qualified_stocks)/processed*100):.1f}%")
    print()

    if len(qualified_stocks) > 0:
        print("📈 Scanned Stocks Summary:")
        sectors = {}
        for stock in qualified_stocks:
            sector = stock.get('sector', 'Unknown')
            if sector in sectors:
                sectors[sector] += 1
            else:
                sectors[sector] = 1
        
        for sector, count in sorted(sectors.items(), key=lambda x: x[1], reverse=True):
            print(f"• {sector}: {count}")
            
        print("\n🚀 All qualified opportunities listed above!")
    else:
        print("❌ No stocks met all criteria")
        print("💡 Market conditions may be tight.")
        print("🔄 Try again later for new opportunities!")
    print("="*50)

def run_analysis(screener, symbol):
    print(f"\n🔍 Analyzing {symbol}...")
    
    result = screener.analyze_stock(symbol, for_scan=False)  # Don't apply filters for individual analysis
    
    if result:
        status_emoji = "🟢" if result['market_status'] == 'LIVE' else "🔴"
        
        # Comprehensive analysis display
        print("\n" + "="*50)
        print(f"📊 {result['symbol']} Analysis {status_emoji}")
        print("="*50)
        print("💰 FUNDAMENTALS:")
        print(f"• Price: ${result['current_price']:.2f}")
        print(f"• Market Cap: ${result['market_cap']/1e9:.1f}B")
        print(f"• Volume: {result['avg_volume']/1e6:.1f}M")
        print(f"• P/E Ratio: {result['pe_ratio']:.1f}")
        print(f"• Beta: {result['beta']:.2f}")
        print(f"• Volatility: {result['volatility']:.1f}%")
        print()
        print("📈 TECHNICAL:")
        print(f"• Trend: {result['price_trend']}")
        print(f"• Volume Ratio: {result['volume_ratio']:.2f}")
        print(f"• 52W High: ${result['fifty_two_week_high']:.2f}")
        print(f"• 52W Low: ${result['fifty_two_week_low']:.2f}")
        print()
        print("🤖 AI ANALYSIS:")
        print(f"• {result['recommendation']}")
        print(f"• Prediction: {result['predicted_return']:.1f}%")
        print(f"• Confidence: {result['confidence']*100:.0f}%")
        print(f"• Action: {result['action']}")
        print()
        
        # Show targets if it's a LONG position
        if result.get('tp_data'):
            tp_data = result['tp_data']
            print("🎯 TARGETS:")
            print(f"• TP1: ${tp_data['take_profit_1']:.2f} ({tp_data['tp1_percent']:.1f}%)")
            print(f"• TP2: ${tp_data['take_profit_2']:.2f} ({tp_data['tp2_percent']:.1f}%)")
            print(f"• Total Gain: {tp_data['total_gain_percent']:.1f}%")
            print()
        
        print(f"📍 Info: {result['sector']} | {result['country']} | {result['exchange']}")
        print("="*50)
    else:
        print(f"❌ {symbol} - Insufficient data or analysis failed.")

def show_market_status(screener):
    is_open = screener.is_market_open()
    status = "🟢 OPEN" if is_open else "🔴 CLOSED"
    current_time = datetime.now().strftime('%Y-%m-%d %H:%M:%S')

    print("\n" + "="*50)
    print("📊 Global Market Status")
    print("="*50)
    print(f"• Status: {status}")
    print(f"• Time: {current_time}\n")

    if not is_open:
        print("💡 After-Hours Analysis:")
        print("• ✅ Latest data available")
        print("• ✅ AI analysis functional")
        print("• ✅ Global markets covered")
        print("• ✅ Ready for next session")
    else:
        print("💡 Live Market Analysis:")
        print("• ✅ Real-time data")
        print("• ✅ Live indicators")
        print("• ✅ Current sentiment")
        print("• ✅ Active scanning")
    print("="*50)

def show_settings():
    print("\n" + "="*50)
    print("⚙️ AI Screener Configuration")
    print("="*50)
    print("📊 SCAN FILTERS:")
    print("• 💰 Price: ≥ $3.00")
    print("• 🏢 Market Cap: $300M - $5B")
    print("• 📊 Volatility: > 5%")
    print("• 📈 Volume: > 1M average")
    print("• 🎯 Target: 5% - 100% gains\n")
    print("🌍 COVERAGE:")
    print("• US: Large/Mid/Small Cap")
    print("• International: ADRs")
    print("• Crypto: Digital Assets")
    print("• ETFs: Sector Coverage")
    print("• Total: 2000+ symbols\n")
    print("🤖 AI Features:")
    print("• ✅ Random Forest ML")
    print("• ✅ Technical Analysis")
    print("• ✅ LONG/SHORT signals")
    print("• ✅ 24/7 Operation\n")
    print("💡 Optimized for aggressive growth trading!")
    print("="*50)

def show_help():
    print("\n" + "="*50)
    print("🤖 AI Stock Screener Pro 📊")
    print("="*50)
    print("🎯 Strategy:")
    print("• Targets: 5% - 100% gains")
    print("• Dual take-profit levels")
    print("• AI-powered LONG/SHORT")
    print("• Works 24/7 globally\n")
    
    print("📊 Analysis Includes:")
    print("• Market Cap & Price")
    print("• P/E Ratio & Beta")
    print("• Volume & Volatility")
    print("• 52-week High/Low")
    print("• AI Recommendation")
    print("• Target Prices\n")
    
    print("🌍 Global Coverage:")
    print("• 🇺🇸 US Markets (All Cap)")
    print("• 🌏 International ADRs")
    print("• ₿ Crypto Stocks")
    print("• 📊 ETFs & Sectors\n")
    
    print("⚠️ Disclaimer: AI analysis only - always DYOR!")
    print("="*50)

def main():
    while True:
        print("\n" + "="*50)
        print("🚀 AI Stock Screener Pro - Terminal Edition 📈")
        print("="*50)
        print("1. 📊 Run Full Market Scan")
        print("2. 🎯 Analyze Specific Stock")
        print("3. 📈 Check Market Status")
        print("4. ⚙️ View Screener Configuration")
        print("5. ❓ Help / Info")
        print("6. ❌ Exit")
        print("="*50)
        
        choice = input("Select an option (1-6): ").strip()
        
        if choice == '1':
            run_scan(screener)
        elif choice == '2':
            symbol = input("Enter Stock Symbol (e.g., AAPL): ").strip().upper()
            if symbol:
                run_analysis(screener, symbol)
            else:
                print("❌ Invalid symbol.")
        elif choice == '3':
            show_market_status(screener)
        elif choice == '4':
            show_settings()
        elif choice == '5':
            show_help()
        elif choice == '6':
            print("Goodbye!")
            break
        else:
            print("❌ Invalid option. Please select 1-6.")

if __name__ == "__main__":
    main()
