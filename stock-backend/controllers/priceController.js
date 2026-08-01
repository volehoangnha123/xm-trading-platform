// Global in-memory price state

// Mapping from local coin symbols to Binance Futures pairs
const BINANCE_FUTURES_MAPPING = {
  BTC: 'btcusdt',
  XAU: 'xauusdt',
  ETH: 'ethusdt',
  ZEC: 'zecusdt',
  XMR: 'xmrusdt',
  AAVE: 'aaveusdt',
  NEAR: 'nearusdt',
  TAO: 'taousdt',
  UNI: 'uniusdt',
  SHIB: 'shibusdt',
  DOGE: 'dogeusdt',
  PEPE: 'pepeusdt',
  WIF: 'wifusdt',
  BONK: 'bonkusdt',
  FLOKI: 'flokiusdt',
  FIL: 'filusdt',
  STORJ: 'storjusdt',
  AR: 'arusdt',
  SKL: 'sklusdt',
  VET: 'vetusdt',
  THETA: 'thetausdt',
  SAND: 'sandusdt',
  ANKR: 'ankrusdt',
  RVN: 'rvnusdt',
  SFP: 'sfpusdt',
  COTI: 'cotiusdt',
  CHR: 'chrusdt',
  MANA: 'manausdt',
  ALICE: 'aliceusdt',
  HBAR: 'hbarusdt',
  ONE: 'oneusdt',
  CELR: 'celrusdt',
  HOT: 'hotusdt',
  PYTH: 'pythusdt',
  SUPER: 'superusdt',
  USTC: 'ustcusdt',
  ONG: 'ongusdt',
  ETHW: 'ethwusdt',
  JTO: 'jtousdt',
  '1000SATS': '1000satsusdt',
  AUCTION: 'auctionusdt',
  '1000RATS': '1000ratsusdt',
  ACE: 'aceusdt',
  MOVR: 'movrusdt',
  NFP: 'nfpusdt',
  RENDER: 'renderusdt',
  BANANA: 'bananausdt',
  RARE: 'rareusdt',
  G: 'gusdt',
  SYN: 'synusdt',
  BRETT: 'brettusdt',
  POPCAT: 'popcatusdt',
  SUN: 'sunusdt',
  DOGS: 'dogsusdt',
  FLUX: 'fluxusdt',
  RPL: 'rplusdt',
  POL: 'polusdt'
};

const LATEST_BINANCE_PRICES = {};

let WebSocketClass = null;
let wsStatus = 'not connected';
let wsLastError = null;
let wsMessageCount = 0;

// Khởi chạy kết nối Binance Futures WebSocket
async function connectBinanceFutures() {
  try {
    wsStatus = 'initializing';
    if (!WebSocketClass) {
      const module = await import('ws');
      WebSocketClass = module.default;
    }
    
    const streams = Object.values(BINANCE_FUTURES_MAPPING).map(s => `${s}@markPrice`);
    const wsUrl = `wss://fstream.binance.com/market/stream?streams=${streams.join('/')}`;
    const ws = new WebSocketClass(wsUrl);

    ws.on('open', () => {
      wsStatus = 'connected';
      console.log('Connected to Binance Futures WebSocket successfully for gold & crypto');
    });

    ws.on('message', (data) => {
      wsMessageCount++;
      try {
        const response = JSON.parse(data.toString());
        if (response.data && response.data.s && response.data.p) {
          const pair = response.data.s.toLowerCase();
          const price = parseFloat(response.data.p);
          const coinKey = Object.keys(BINANCE_FUTURES_MAPPING).find(
            k => BINANCE_FUTURES_MAPPING[k] === pair
          );
          if (coinKey) {
            // Shift history to match the actual Binance price level on first update
            if (!LATEST_BINANCE_PRICES[coinKey] && prices && prices[coinKey]) {
              const currentSimPrice = prices[coinKey].price;
              if (currentSimPrice) {
                const diff = price - currentSimPrice;
                // Offset all candles in history
                if (candleHistory && candleHistory[coinKey]) {
                  candleHistory[coinKey] = candleHistory[coinKey].map(c => ({
                    ...c,
                    open: c.open + diff,
                    high: c.high + diff,
                    low: c.low + diff,
                    close: c.close + diff
                  }));
                }
                // Offset current candle
                if (currentCandles && currentCandles[coinKey]) {
                  currentCandles[coinKey].open += diff;
                  currentCandles[coinKey].high += diff;
                  currentCandles[coinKey].low += diff;
                  currentCandles[coinKey].close += diff;
                }
                // Directly set the current price to Binance price
                prices[coinKey].price = price;
                prices[coinKey].prev = price;
              }
            }
            LATEST_BINANCE_PRICES[coinKey] = price;
            // Ghi nhận log giá nhận được để chẩn đoán
            console.log(`[Binance Sync] ${coinKey} price updated: ${price}`);
          }
        }
      } catch (err) {
        wsLastError = 'parse_error: ' + err.message;
        console.error('Error parsing Binance message:', err.message);
      }
    });

    ws.on('error', (err) => {
      wsStatus = 'error';
      wsLastError = err.message;
      console.warn('Binance WebSocket error:', err.message);
    });

    ws.on('close', () => {
      wsStatus = 'closed';
      console.log('Binance WebSocket disconnected. Reconnecting in 10s...');
      setTimeout(connectBinanceFutures, 10000);
    });
  } catch (e) {
    wsStatus = 'init_failed';
    wsLastError = e.message;
    console.warn('Failed to start Binance WebSocket, running fallback random prices. Error:', e.message);
    setTimeout(connectBinanceFutures, 15000);
  }
}

const INITIAL_COINS = {
  // All markets
  BTC:   { price: 62630.00, name: 'BTC'   },
  XAU:   { price: 4150.00,  name: 'XAU'   },
  ETH:   { price: 1690.00,  name: 'ETH'   },
  // Alpha
  BULL:      { price: 0.00479,   name: 'BULL'      },
  DEGEN:     { price: 0.001735,  name: 'DEGEN'     },
  BSO:       { price: 0.77337,   name: 'BSO'       },
  UP:        { price: 0.28334,   name: 'UP'        },
  ESPORTS:   { price: 0.79886,   name: 'ESPORTS'   },
  VIRL:      { price: 0.002996,  name: 'VIRL'      },
  RTX:       { price: 1.36045,   name: 'RTX'       },
  BABYTROLL: { price: 0.000912,  name: 'BABYTROLL' },
  EITHER:    { price: 0.16539,   name: 'EITHER'    },
  SKYAI:     { price: 0.31262,   name: 'SKYAI'     },
  SPCX:      { price: 0.002395,  name: 'SPCX'      },
  TITAN:     { price: 0.045059,  name: 'TITAN'     },
  WORLDCUP:  { price: 0.004468,  name: 'WORLDCUP'  },
  sato:      { price: 0.78079,   name: 'sato'      },
  Goblin:    { price: 0.009554,  name: 'Goblin'    },
  AWF:       { price: 0.007199,  name: 'AWF'       },
  RAGEGUY:   { price: 0.002628,  name: 'RAGEGUY'   },
  HANTA:     { price: 0.000725,  name: 'HANTA'     },
  BURNIE:    { price: 0.007445,  name: 'BURNIE'    },
  USDUC:     { price: 0.005204,  name: 'USDUC'     },
  ASTEROID:  { price: 0.000313,  name: 'ASTEROID'  },
  PAYAI:     { price: 0.008607,  name: 'PAYAI'     },
  SAND:      { price: 0.05046,   name: 'SAND'      },
  ANKR:      { price: 0.003698,  name: 'ANKR'      },
  RVN:       { price: 0.004134,  name: 'RVN'       },
  SFP:       { price: 0.2305,    name: 'SFP'       },
  COTI:      { price: 0.00936,   name: 'COTI'      },
  CHR:       { price: 0.01504,   name: 'CHR'       },
  MANA:      { price: 0.0661,    name: 'MANA'      },
  ALICE:     { price: 0.1010,    name: 'ALICE'     },
  HBAR:      { price: 0.07896,   name: 'HBAR'      },
  ONE:       { price: 0.001404,  name: 'ONE'       },
  CELR:      { price: 0.002077,  name: 'CELR'      },
  HOT:       { price: 0.0003009, name: 'HOT'       },
  PYTH:      { price: 0.03507,   name: 'PYTH'      },
  SUPER:     { price: 0.0926,    name: 'SUPER'     },
  USTC:      { price: 0.005840,  name: 'USTC'      },
  ONG:       { price: 0.04577,   name: 'ONG'       },
  ETHW:      { price: 0.2308,    name: 'ETHW'      },
  JTO:       { price: 0.7125,    name: 'JTO'       },
  '1000SATS':{ price: 0.00000937,name: '1000SATS'  },
  AUCTION:   { price: 3.706,     name: 'AUCTION'   },
  '1000RATS':{ price: 0.02696,   name: '1000RATS'  },
  ACE:       { price: 0.07732,   name: 'ACE'       },
  MOVR:      { price: 1.274,     name: 'MOVR'      },
  NFP:       { price: 0.007780,  name: 'NFP'       },
  RENDER:    { price: 1.670,     name: 'RENDER'    },
  BANANA:    { price: 2.843,     name: 'BANANA'    },
  RARE:      { price: 0.01251,   name: 'RARE'      },
  G:         { price: 0.002611,  name: 'G'         },
  SYN:       { price: 0.14893,   name: 'SYN'       },
  POPCAT:    { price: 0.04146,   name: 'POPCAT'    },
  SUN:       { price: 0.017076,  name: 'SUN'       },
  DOGS:      { price: 0.00003902,name: 'DOGS'      },
  FLUX:      { price: 0.04930,   name: 'FLUX'      },
  RPL:       { price: 1.332,     name: 'RPL'       },
  POL:       { price: 0.07757,   name: 'POL'       },
  ZEC:   { price: 582.76,   name: 'ZEC'   },
  XMR:   { price: 338.20,   name: 'XMR'   },
  AAVE:  { price: 87.68,    name: 'AAVE'  },
  NEAR:  { price: 1.65,     name: 'NEAR'  },
  TAO:   { price: 263.06,   name: 'TAO'   },
  UNI:   { price: 8.6,      name: 'UNI'   },
  // Meme
  SHIB:  { price: 0.00000574,  name: 'SHIB'  },
  DOGE:  { price: 0.10386562,  name: 'DOGE'  },
  PEPE:  { price: 0.0000036899,name: 'PEPE'  },
  WIF:   { price: 0.19288759,  name: 'WIF'   },
  BONK:  { price: 0.00000602,  name: 'BONK'  },
  FLOKI: { price: 0.00003021,  name: 'FLOKI' },
  BRETT: { price: 0.00755767,  name: 'BRETT' },
  // Storage
  FIL:   { price: 0.95315038,  name: 'FIL'   },
  STORJ: { price: 0.11257603,  name: 'STORJ' },
  AR:    { price: 2.16,        name: 'AR'    },
  DATA:  { price: 0.00062571,  name: 'DATA'  },
  SKL:   { price: 0.00607331,  name: 'SKL'   },
  ELA:   { price: 0.45340071,  name: 'ELA'   },
  ALEPH: { price: 0.01628207,  name: 'ALEPH' },
  // Supply chain
  VET:   { price: 0.00659373,  name: 'VET'   },
  // Media
  THETA: { price: 0.19828165,  name: 'THETA' },
  AIOZ:  { price: 0.06672652,  name: 'AIOZ'  },
  KIN:   { price: 0.00506442,  name: 'KIN'   },
  WAXP:  { price: 0.00619318,  name: 'WAXP'  },
  TFUEL: { price: 0.01058834,  name: 'TFUEL' },
};

function seededRand(seed) {
  let t = (seed + 0x6D2B79F5) | 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

function hashStr(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

function generateInitialCandles(coinSym, count = 1000) {
  const info = INITIAL_COINS[coinSym];
  const initialPrice = info ? info.price : 100;
  const coinHash = hashStr(coinSym);
  
  let price = initialPrice;
  const candles = [];
  const nowMin = Math.floor(Date.now() / 1000 / 60);
  const startMin = nowMin - count;
  
  const FIXED_EPOCH_MIN = 29453760; // Jan 1, 2026
  const simulationStart = Math.min(startMin, FIXED_EPOCH_MIN);
  
  for (let m = simulationStart; m < nowMin; m++) {
    const seed1 = coinHash + m * 3;
    const seed2 = coinHash + m * 3 + 1;
    const seed3 = coinHash + m * 3 + 2;
    const seed4 = coinHash + m * 3 + 3;
    
    const r1 = seededRand(seed1);
    const drift = ((initialPrice - price) / initialPrice) * 0.01;
    const change = (r1 * 0.003 - 0.0015) + drift;
    const factor = Math.max(0.1, 1 + change);
    const nextPrice = Math.max(price * factor, initialPrice * 0.01);
    
    const open = price;
    const close = nextPrice;
    
    if (m >= startMin) {
      const r2 = seededRand(seed2);
      const r3 = seededRand(seed3);
      const high = Math.max(open, close) + Math.abs(open * r2 * 0.001);
      const low  = Math.max(Math.min(open, close) - Math.abs(open * r3 * 0.001), initialPrice * 0.001);
      
      candles.push({
        time: m * 60,
        open,
        high,
        low,
        close,
        _seed4: seed4
      });
    }
    
    price = nextPrice;
  }
  return { candles, lastPrice: price };
}

function initializePriceState() {
  const state = {};
  const history = {};
  const current = {};
  const nowMin = Math.floor(Date.now() / 1000 / 60);

  Object.keys(INITIAL_COINS).forEach(key => {
    const { candles, lastPrice } = generateInitialCandles(key, 20000);
    history[key] = candles;
    state[key] = {
      price: lastPrice,
      prev: lastPrice,
      change: +(Math.random() * 10 - 5).toFixed(2),
      isUp: Math.random() > 0.5
    };
    current[key] = {
      time: nowMin * 60,
      open: lastPrice,
      high: lastPrice,
      low: lastPrice,
      close: lastPrice,
      minute: nowMin
    };
  });
  return { state, history, current };
}

const { state: initialStates, history: initialHistories, current: initialCurrents } = initializePriceState();
let prices = initialStates;
let candleHistory = initialHistories;
let currentCandles = initialCurrents;
let coinTrends = {}; // { BTC: 'up', quq: 'down', ... }
let coinOffsets = {}; // { BTC: 0.003, quq: -0.003, ... }

// Background task to update prices every 2 seconds
setInterval(() => {
  const next = { ...prices };
  const nowMin = Math.floor(Date.now() / 1000 / 60);

  Object.keys(next).forEach(key => {
    const trend = coinTrends[key] || 'neutral';
    const p = next[key].price;
    let newP = p;
    let change = 0;

    if (trend === 'up') {
      // 85% chance to go up, 15% chance to go down for steady, clear rise
      const isUpTick = Math.random() < 0.85;
      change = isUpTick ? (Math.random() * 0.0008) : -(Math.random() * 0.0003);
      newP = Math.max(p * (1 + change), p * 0.0001);
      coinOffsets[key] = (coinOffsets[key] || 0) + change;
    } else if (trend === 'down') {
      // 85% chance to go down, 15% chance to go up
      const isDownTick = Math.random() < 0.85;
      change = isDownTick ? -(Math.random() * 0.0008) : (Math.random() * 0.0003);
      newP = Math.max(p * (1 + change), p * 0.0001);
      coinOffsets[key] = (coinOffsets[key] || 0) + change;
    } else {
      // Neutral trend: 50/50 fluctuation or follow Binance Live price
      if (LATEST_BINANCE_PRICES[key]) {
        // Smooth transition towards actual Binance price
        const targetRealPrice = LATEST_BINANCE_PRICES[key];
        const gap = targetRealPrice - p;
        // Move 20% of the gap every 2 seconds for a smooth chart line without big jumps
        newP = p + (gap * 0.2) + (Math.random() * p * 0.0002 - p * 0.0001);
      } else {
        change = Math.random() * 0.0004 - 0.0002;
        newP = Math.max(p * (1 + change), p * 0.0001);
      }
      // Decaying offset to return to base Binance price slowly when neutral
      coinOffsets[key] = ((coinOffsets[key] || 0) * 0.99) + (Math.random() * 0.0001 - 0.00005);
    }
    
    // Cap maximum change from candle open to prevent extremely tall (monster) candles
    // But if we are syncing to Binance and the gap is large, bypass the cap to jump to the correct price quickly
    // Also bypass this cap if there is an active admin trend (up/down) to let the price rise/fall continuously.
    const openP = currentCandles[key]?.open || p;
    const diffPct = (newP - openP) / openP;
    
    const isBinanceSynced = !!LATEST_BINANCE_PRICES[key];
    const isFarFromBinance = isBinanceSynced && (Math.abs(LATEST_BINANCE_PRICES[key] - p) / p > 0.015);

    if (!isFarFromBinance && trend === 'neutral') {
      const MAX_CANDLE_DIFF = 0.0025; // max 0.25% body change per candle
      if (diffPct > MAX_CANDLE_DIFF) {
        newP = openP * (1 + MAX_CANDLE_DIFF);
      } else if (diffPct < -MAX_CANDLE_DIFF) {
        newP = openP * (1 - MAX_CANDLE_DIFF);
      }
    }
    
    // Calculate the true change percentage based on the initial price
    const initialPrice = INITIAL_COINS[key]?.price || p || 1;
    const chg = ((newP - initialPrice) / initialPrice) * 100;
    
    next[key] = {
      price: newP,
      prev: p,
      change: parseFloat(chg.toFixed(2)),
      isUp: newP >= p,
    };

    // Update candle
    if (!currentCandles[key] || currentCandles[key].minute !== nowMin) {
      if (currentCandles[key]) {
        candleHistory[key].push({
          time: currentCandles[key].time,
          open: currentCandles[key].open,
          high: currentCandles[key].high,
          low: currentCandles[key].low,
          close: currentCandles[key].close
        });
        if (candleHistory[key].length > 20000) {
          candleHistory[key].shift();
        }
      }
      currentCandles[key] = {
        time: nowMin * 60,
        open: p,
        high: Math.max(p, newP),
        low: Math.min(p, newP),
        close: newP,
        minute: nowMin
      };
    } else {
      currentCandles[key].high = Math.max(currentCandles[key].high, newP);
      currentCandles[key].low = Math.min(currentCandles[key].low, newP);
      currentCandles[key].close = newP;
    }
  });
  prices = next;
}, 2000);

function getNormalizedSymbol(symbol) {
  if (!symbol) return '';
  const match = Object.keys(INITIAL_COINS).find(
    k => k.toLowerCase() === symbol.toLowerCase()
  );
  return match || symbol;
}

export const getCandles = (req, res) => {
  const { symbol } = req.query;
  if (!symbol) return res.status(400).json({ success: false, message: 'Missing symbol' });
  const targetSymbol = getNormalizedSymbol(symbol);
  const hist = candleHistory[targetSymbol] || [];
  const curr = currentCandles[targetSymbol];
  if (curr) {
    res.json([...hist, {
      time: curr.time,
      open: curr.open,
      high: curr.high,
      low: curr.low,
      close: curr.close
    }]);
  } else {
    res.json(hist);
  }
};

export const getPricesData = () => prices;

export const getPrices = (req, res) => {
  res.json({ 
    prices, 
    coinOffsets, 
    debug: { wsStatus, wsLastError, wsMessageCount, LATEST_BINANCE_PRICES } 
  });
};

export const setTrend = (req, res) => {
  const { symbol, trend } = req.body;
  const targetSymbol = getNormalizedSymbol(symbol || 'BTC');
  if (['up', 'down', 'neutral'].includes(trend)) {
    coinTrends[targetSymbol] = trend;
    
    // Tự động tắt tính năng Bơm/Xả sau 5 phút để tránh giá phình to nếu admin quên tắt
    if (trend !== 'neutral') {
      setTimeout(() => {
        if (coinTrends[targetSymbol] === trend) {
          coinTrends[targetSymbol] = 'neutral';
        }
      }, 5 * 60 * 1000);
    }

    res.json({ success: true, symbol: targetSymbol, trend });
  } else {
    res.status(400).json({ success: false, message: 'Invalid trend' });
  }
};

export const getTrend = (req, res) => {
  const { symbol } = req.query;
  const targetSymbol = getNormalizedSymbol(symbol || 'BTC');
  res.json({ trend: coinTrends[targetSymbol] || 'neutral' });
};

export const resetTrendToNeutral = (symbol) => {
  const targetSymbol = getNormalizedSymbol(symbol || 'BTC');
  coinTrends[targetSymbol] = 'neutral';
};

connectBinanceFutures();
