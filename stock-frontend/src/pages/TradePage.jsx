import { useEffect, useRef, useState, useMemo } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { createChart, CandlestickSeries, HistogramSeries } from 'lightweight-charts';
import { useCoinPrice, usePrices, INITIAL_COIN_PRICES, computeCurrentCoinPrice } from '../contexts/PriceContext';
import axios from 'axios';
import { API_BASE_URL } from '../config';
import { ToastContainer, toast } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import './TradePage.css';
import { BuyCryptoMenu, TradeMenu, DerivativesMenu, EarnMenu, MoreMenu, LaunchpadMenu, InstitutionalMenu } from './MegaMenus';
import CoinLogo from '../components/CoinLogo';


/* ─── Seeded PRNG (mulberry32) — same seed → same number always ─── */
function seededRand(seed) {
  let t = (seed + 0x6D2B79F5) | 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
function hashStr(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/* ─── Helpers ─── */
function getPriceFormatOptions(price) {
  let precision = 2;
  let minMove = 0.01;
  if (price < 0.0001) {
    precision = 8;
    minMove = 0.00000001;
  } else if (price < 0.01) {
    precision = 6;
    minMove = 0.000001;
  } else if (price < 1) {
    precision = 4;
    minMove = 0.0001;
  }
  return {
    type: 'price',
    precision,
    minMove,
  };
}

function generateVolume(candles) {
  return candles.map(c => ({
    time:  c.time,
    value: seededRand(c._seed4 ?? c.time) * 5000 + 500,
    color: c.close >= c.open ? 'rgba(0,255,163,0.4)' : 'rgba(246,70,93,0.4)',
  }));
}

function genOrderBook(price) {
  const asks = [], bids = [];
  let cumAsk = 0, cumBid = 0;
  for (let i = 0; i < 30; i++) {
    // Generate 30 levels for a smoother depth chart
    const pAsk = price * (1 + 0.0005 * (30 - i)); // Highest to lowest ask
    const pBid = price * (1 - 0.0005 * (i + 1));  // Highest to lowest bid
    const amtAsk  = Math.random() * 5 + 0.1;
    const amtBid  = Math.random() * 5 + 0.1;
    
    cumAsk += amtAsk;
    cumBid += amtBid;

    asks.push({ price: pAsk, amount: amtAsk.toFixed(2), total: cumAsk.toFixed(0) });
    bids.push({ price: pBid, amount: amtBid.toFixed(2), total: cumBid.toFixed(0) });
  }
  // Reverse asks so it goes from lowest to highest (for the UI and depth chart)
  asks.reverse(); 
  
  // Now recalculate cumulative totals for asks (since we reversed, the lowest ask should have lowest cumulative, building up to highest ask)
  let ascCumAsk = 0;
  const finalAsks = asks.map(a => {
    ascCumAsk += parseFloat(a.amount);
    return { ...a, total: ascCumAsk.toFixed(0), cum: ascCumAsk };
  });

  // For bids, they are already sorted highest to lowest. 
  // Cumulative volume should build up as price goes DOWN (away from center).
  let ascCumBid = 0;
  const finalBids = bids.map(b => {
    ascCumBid += parseFloat(b.amount);
    return { ...b, total: ascCumBid.toFixed(0), cum: ascCumBid }; // b.cum is cumulative from center
  });

  return { asks: finalAsks, bids: finalBids };
}

const fmt = (v, digits = 2) => {
  const num = Number(v);
  if (isNaN(num)) return '0.00';
  if (num === 0) return '0.00';
  if (num < 0.0001) {
    return num.toLocaleString('en-US', { minimumFractionDigits: 8, maximumFractionDigits: 8 });
  }
  if (num < 0.01) {
    return num.toLocaleString('en-US', { minimumFractionDigits: 6, maximumFractionDigits: 6 });
  }
  if (num < 1) {
    return num.toLocaleString('en-US', { minimumFractionDigits: 4, maximumFractionDigits: 4 });
  }
  return num.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
};
const fmtP = (v) => fmt(v, 2);

const formatDateTime = (dateStr) => {
  if (!dateStr) return '-';
  const cleanStr = dateStr.endsWith('Z') || dateStr.includes('+') ? dateStr : `${dateStr.replace(' ', 'T')}Z`;
  const d = new Date(cleanStr);
  if (isNaN(d.getTime())) return dateStr;
  return d.toLocaleString('vi-VN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });
};

// Self-contained pending status cell with circular countdown progress spinner
function PendingStatusCell({ endTime, duration, serverTimeOffset }) {
  const [remainSec, setRemainSec] = React.useState(() => {
    if (!endTime) return 0;
    const s = endTime.endsWith('Z') ? endTime : `${endTime}Z`;
    let endMs = new Date(s).getTime();
    const nowMs = Date.now() + (serverTimeOffset || 0);
    const diffMs = endMs - nowMs;
    
    // Auto-detect and fix timezone shift of the database datetimes
    if (diffMs < -1800000) {
      const shiftHours = Math.round(Math.abs(diffMs) / 3600000);
      if (shiftHours > 0 && shiftHours < 24) {
        endMs += shiftHours * 3600000;
      }
    }
    
    return Math.max(0, Math.round((endMs - nowMs) / 1000));
  });

  React.useEffect(() => {
    const calc = () => {
      if (!endTime) return setRemainSec(0);
      const s = endTime.endsWith('Z') ? endTime : `${endTime}Z`;
      let endMs = new Date(s).getTime();
      const nowMs = Date.now() + (serverTimeOffset || 0);
      const diffMs = endMs - nowMs;
      
      if (diffMs < -1800000) {
        const shiftHours = Math.round(Math.abs(diffMs) / 3600000);
        if (shiftHours > 0 && shiftHours < 24) {
          endMs += shiftHours * 3600000;
        }
      }
      
      setRemainSec(Math.max(0, Math.round((endMs - nowMs) / 1000)));
    };
    calc();
    const iv = setInterval(calc, 1000);
    return () => clearInterval(iv);
  }, [endTime, serverTimeOffset]);

  if (remainSec <= 0) {
    return (
      <span style={{ color: '#FCD535', fontWeight: 'bold', display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
        ⏳ Đang kết toán...
      </span>
    );
  }

  const totalSec = duration || 60;
  const progress = totalSec > 0 ? Math.max(0, Math.min(1, remainSec / totalSec)) : 0;
  const r = 6;
  const circ = 2 * Math.PI * r;

  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', color: '#FCD535', fontWeight: 'bold' }}>
      <svg width={r*2+4} height={r*2+4} style={{ transform: 'rotate(-90deg)', flexShrink: 0 }}>
        <circle cx={r+2} cy={r+2} r={r} fill="none" stroke="rgba(252,213,53,0.18)" strokeWidth="1.8"/>
        <circle cx={r+2} cy={r+2} r={r} fill="none"
          stroke="#FCD535" strokeWidth="1.8"
          strokeDasharray={circ}
          strokeDashoffset={circ * (1 - progress)}
          strokeLinecap="round"
        />
      </svg>
      <span>Đang chờ ({remainSec}s)</span>
    </div>
  );
}

// Settlement time cell: countdown circle when PENDING, formatted datetime when expired
function SettlementTimeCell({ status, endTime, duration, serverTimeOffset }) {
  const computeRemain = React.useCallback(() => {
    if (!endTime) return 0;
    const s = endTime.endsWith('Z') ? endTime : `${endTime}Z`;
    let endMs = new Date(s).getTime();
    const nowMs = Date.now() + (serverTimeOffset || 0);
    const diffMs = endMs - nowMs;
    // Auto-correct timezone shift stored in DB
    if (diffMs < -1800000) {
      const shiftH = Math.round(Math.abs(diffMs) / 3600000);
      if (shiftH > 0 && shiftH < 24) endMs += shiftH * 3600000;
    }
    return Math.max(0, Math.round((endMs - nowMs) / 1000));
  }, [endTime, serverTimeOffset]);

  const [remainSec, setRemainSec] = React.useState(() =>
    status === 'PENDING' ? computeRemain() : 0
  );

  React.useEffect(() => {
    if (status !== 'PENDING') { setRemainSec(0); return; }
    const tick = () => setRemainSec(computeRemain());
    tick();
    const iv = setInterval(tick, 1000);
    return () => clearInterval(iv);
  }, [status, endTime, serverTimeOffset, computeRemain]);

  // When not pending OR countdown reached 0 → show formatted datetime
  if (status !== 'PENDING' || remainSec <= 0) {
    return <span>{formatDateTime(endTime, serverTimeOffset)}</span>;
  }

  const totalSec = duration || 60;
  const progress = totalSec > 0 ? Math.max(0, Math.min(1, remainSec / totalSec)) : 0;
  const r = 8;
  const circ = 2 * Math.PI * r;

  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: '7px', color: '#FCD535', fontWeight: 'bold' }}>
      <svg width={r * 2 + 4} height={r * 2 + 4} style={{ transform: 'rotate(-90deg)', flexShrink: 0 }}>
        <circle cx={r + 2} cy={r + 2} r={r} fill="none" stroke="rgba(252,213,53,0.15)" strokeWidth="2.5" />
        <circle
          cx={r + 2} cy={r + 2} r={r}
          fill="none"
          stroke="#FCD535"
          strokeWidth="2.5"
          strokeDasharray={circ}
          strokeDashoffset={circ * (1 - progress)}
          strokeLinecap="round"
          style={{ transition: 'stroke-dashoffset 0.9s linear' }}
        />
      </svg>
      <span>{remainSec}s</span>
    </div>
  );
}

// ─── SVG Depth Chart Component ───
function DepthChartSVG({ obData }) {
  if (!obData || !obData.bids.length) return null;

  // bids are sorted highest price to lowest price
  // asks are sorted lowest price to highest price

  // For drawing, we want X axis: lowest bid -> highest bid -> lowest ask -> highest ask
  // Reverse bids for drawing so it goes low -> high
  const drawBids = [...obData.bids].reverse(); 
  const drawAsks = obData.asks;

  const minBid = drawBids[0].price;
  const maxBid = drawBids[drawBids.length - 1].price;
  const minAsk = drawAsks[0].price;
  const maxAsk = drawAsks[drawAsks.length - 1].price;

  const maxCum = Math.max(
    drawBids[0].cum, // Last item in original bids array (lowest price) has max cum
    drawAsks[drawAsks.length - 1].cum
  );

  // viewBox is 1000x300
  const width = 1000;
  const height = 300;
  const midX = width / 2;

  // Map Bid price to X: minBid -> 0, maxBid -> midX
  const mapBidX = p => ((p - minBid) / (maxBid - minBid)) * midX;
  
  // Map Ask price to X: minAsk -> midX, maxAsk -> width
  const mapAskX = p => midX + ((p - minAsk) / (maxAsk - minAsk)) * (width - midX);

  const mapY = cum => height - (cum / maxCum) * height * 0.9; // leave 10% padding top

  // Build SVG path for Bids (green)
  let bidPath = `M 0 ${height} `;
  for (let i = 0; i < drawBids.length; i++) {
    const pt = drawBids[i];
    const x = mapBidX(pt.price);
    const y = mapY(pt.cum);
    // Step line: horizontal then vertical
    if (i === 0) {
      bidPath += `L ${x} ${height} L ${x} ${y} `;
    } else {
      const prevX = mapBidX(drawBids[i-1].price);
      bidPath += `L ${x} ${mapY(drawBids[i-1].cum)} L ${x} ${y} `;
    }
  }
  bidPath += `L ${midX} ${mapY(drawBids[drawBids.length-1].cum)} L ${midX} ${height} Z`;

  // Build SVG path for Asks (red)
  let askPath = `M ${midX} ${height} `;
  // Asks cum goes up as X goes right
  for (let i = 0; i < drawAsks.length; i++) {
    const pt = drawAsks[i];
    const x = mapAskX(pt.price);
    const y = mapY(pt.cum);
    if (i === 0) {
      askPath += `L ${midX} ${y} L ${x} ${y} `;
    } else {
      const prevY = mapY(drawAsks[i-1].cum);
      askPath += `L ${x} ${prevY} L ${x} ${y} `;
    }
  }
  askPath += `L ${width} ${mapY(drawAsks[drawAsks.length-1].cum)} L ${width} ${height} Z`;

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" style={{ width: '100%', height: '100%', display: 'block' }}>
        <path d={bidPath} fill="rgba(0, 255, 163, 0.15)" stroke="#00FFA3" strokeWidth="2" vectorEffect="non-scaling-stroke" />
        <path d={askPath} fill="rgba(246, 70, 93, 0.15)" stroke="#F6465D" strokeWidth="2" vectorEffect="non-scaling-stroke" />
        
        {/* Center dashed line */}
        <line x1={midX} y1="0" x2={midX} y2={height} stroke="#333" strokeWidth="1" strokeDasharray="4 4" vectorEffect="non-scaling-stroke" />
      </svg>
      {/* Price Labels */}
      <div style={{ position: 'absolute', bottom: '10px', left: '10px', color: '#848e9c', fontSize: '11px' }}>{fmtP(minBid)}</div>
      <div style={{ position: 'absolute', bottom: '10px', left: 'calc(50% - 20px)', color: '#848e9c', fontSize: '11px' }}>{fmtP(maxBid)}</div>
      <div style={{ position: 'absolute', bottom: '10px', right: '10px', color: '#848e9c', fontSize: '11px' }}>{fmtP(maxAsk)}</div>
    </div>
  );
}

// ─── Separate Volume Chart Component ───
function VolumeChartComponent({ candles, volSeriesRef }) {
  const chartRef = useRef(null);
  
  useEffect(() => {
    if (!chartRef.current || !candles || candles.length === 0) return;
    
    const chart = createChart(chartRef.current, {
      layout: { background: { color: '#0b0e11' }, textColor: '#848e9c' },
      grid:   { vertLines: { color: '#1a1e27' }, horzLines: { color: '#1a1e27' } },
      timeScale: { 
        borderColor: '#1e2329', 
        timeVisible: true, 
        secondsVisible: false,
        tickMarkFormatter: (time, tickMarkType, locale) => {
          const date = new Date(time * 1000);
          const hours = String(date.getHours()).padStart(2, '0');
          const minutes = String(date.getMinutes()).padStart(2, '0');
          return `${hours}:${minutes}`;
        }
      },
      rightPriceScale: { borderColor: '#1e2329' },
      width: chartRef.current.clientWidth,
      height: chartRef.current.clientHeight,
    });
    
    const volSeries = chart.addSeries(HistogramSeries, {
      priceFormat: { type: 'volume' },
      priceScaleId: '', // Default scale
    });
    
    volSeries.setData(generateVolume(candles));
    if (volSeriesRef) {
      volSeriesRef.current = volSeries;
    }

    chart.timeScale().setVisibleLogicalRange({
      from: candles.length - 100,
      to: candles.length + 10,
    });
    
    const onResize = () => {
      chart.applyOptions({ width: chartRef.current.clientWidth, height: chartRef.current.clientHeight });
    };
    const ro = new ResizeObserver(onResize);
    ro.observe(chartRef.current);
    
    return () => { 
      if (volSeriesRef) volSeriesRef.current = null;
      ro.disconnect(); 
      chart.remove(); 
    };
  }, [candles, volSeriesRef]);

  return <div ref={chartRef} style={{ width: '100%', height: '100%' }} />;
}

/* ─── Component ─── */
export default function TradePage() {
  const { symbol } = useParams();
  
  // Chuẩn hóa tên coin: nếu có đuôi 'USDT-M' hoặc '-M' (futures) hoặc 'USDT', chuyển thành symbol cơ bản để khớp với PriceContext (ví dụ: BTCUSDT-M -> BTC, BTC-USDT -> BTC)
  const coin = useMemo(() => {
    let sym = (symbol || 'BULL').toUpperCase();
    // Xóa đuôi USDT-M hoặc -M (chấp nhận cả có gạch ngang và không)
    sym = sym.replace(/[-_]?USDT[-_]?M$/i, '').replace(/[-_]?M$/i, '');
    // Xóa đuôi USDT nếu có (ví dụ BTC-USDT -> BTC) trừ phi coin đó chính là USDT
    if (sym !== 'USDT') {
      sym = sym.replace(/[-_]?USDT$/i, '');
    }
    
    // Tìm symbol khớp viết hoa/thường chuẩn trong danh sách coin
    const matchedKey = Object.keys(INITIAL_COIN_PRICES).find(
      k => k.toUpperCase() === sym
    );
    return matchedKey || sym;
  }, [symbol]);

  const navigate = useNavigate();

  // Get logged-in user info from localStorage
  const currentUser = useMemo(() => {
    try {
      const u = JSON.parse(localStorage.getItem('user') || 'null');
      if (u && u.fullName) {
        const original = u.fullName;
        u.fullName = u.fullName
          .replace(/Quáº£n/g, 'Quản')
          .replace(/trá»‹/g, 'trị')
          .replace(/viÃªn/g, 'viên')
          .replace(/HÃ¡»‡/g, 'Hệ')
          .replace(/Há»‡/g, 'Hệ')
          .replace(/thá»‘ng/g, 'thống')
          .replace(/Tá»‘i/g, 'Tối')
          .replace(/TiÃªu/g, 'Tiêu')
          .replace(/chuáº©n/g, 'chuẩn');
        if (u.fullName !== original) {
          localStorage.setItem('user', JSON.stringify(u));
        }
      }
      return u;
    } catch { return null; }
  }, []);
  const userInitial = currentUser?.username?.charAt(0)?.toUpperCase() || currentUser?.email?.charAt(0)?.toUpperCase() || 'U';

  const chartRef     = useRef(null);
  const chartInst    = useRef(null);
  const candleSRef   = useRef(null);
  const volSeriesRef = useRef(null);
  // Candle aggregation state (mutated in-place — no re-renders needed)
  const candleState  = useRef({ open: 0, high: 0, low: 0, minute: 0 });
  const clockOffsetRef = useRef(0);

  // Live price driven entirely by global context
  const prices = usePrices();
  const globalCoin = useCoinPrice(coin);
  const btcCoin = useCoinPrice('BTC');
  const ethCoin = useCoinPrice('ETH');

  // Track symbol and isReal status used to initialize the chart
  const chartInitRef = useRef({ symbol: coin, isReal: !!globalCoin?.isReal });

  // Use REAL computed current coin price as the base for historical candles
  const base = globalCoin?.price ?? computeCurrentCoinPrice(coin) ?? INITIAL_COIN_PRICES[coin] ?? 100;

  const [livePrice, setLivePrice] = useState(base);
  const [prevPrice, setPrevPrice] = useState(base);
  const [obData,    setObData]    = useState(() => genOrderBook(base));
  const [tradeTab,  setTradeTab]   = useState('buy'); // 'buy' | 'sell'
  const [orderType, setOrderType]  = useState('market');
  const [activeTab, setActiveCoinTab] = useState(coin);
  const [tf,        setTf]         = useState('1m');
  const [bottomTab, setBottomTab]  = useState('binary');
  const [chartTopTab, setChartTopTab] = useState('chart');
  const [historicalCandles, setHistoricalCandles] = useState([]);
  const [showIndicatorsMenu, setShowIndicatorsMenu] = useState(false);
  const [showCoinSelector, setShowCoinSelector] = useState(false);

  // Binary Options state
  const [activeSubTab, setActiveSubTab] = useState('Alpha');
  const [binaryAmount, setBinaryAmount] = useState('');
  const [binaryBets, setBinaryBets] = useState([]);
  const [binaryLoading, setBinaryLoading] = useState(false);
  const [balance, setBalance] = useState(0);
  const [showBalance, setShowBalance] = useState(true);
  const [binaryDuration, setBinaryDuration] = useState(60);
  const prevBetsRef = useRef([]);
  const [showMobileTradeModal, setShowMobileTradeModal] = useState(false);
  const [mobileTradeType, setMobileTradeType] = useState('UP'); // 'UP' | 'DOWN'

  // Countdown Circle state
  const [countdownActive, setCountdownActive] = useState(false);
  const [countdownTotal, setCountdownTotal] = useState(0);
  const [countdownLeft, setCountdownLeft] = useState(0);
  const countdownIntervalRef = useRef(null);
  const [countdownBetType, setCountdownBetType] = useState('UP');
  const [tick, setTick] = useState(0);
  const [serverTimeOffset, setServerTimeOffset] = useState(0);

  // Fast Deposit state
  const [showFastDepositModal, setShowFastDepositModal] = useState(false);
  const [fastDepositAmount, setFastDepositAmount] = useState('');

  // Notifications state
  const [notifications, setNotifications] = useState([]);
  const [showNotifications, setShowNotifications] = useState(false);
  const prevLatestNotificationId = useRef(null);

  // Bank Transfer state
  const [showTransferModal, setShowTransferModal] = useState(false);
  const [transferBankName, setTransferBankName] = useState('');
  const [transferAccountNumber, setTransferAccountNumber] = useState('');
  const [transferAccountHolder, setTransferAccountHolder] = useState('');
  const [transferNote, setTransferNote] = useState('');

  // Fetch balance
  const fetchBalance = async () => {
    try {
      const u = JSON.parse(localStorage.getItem('user') || 'null');
      if (!u || !u.id) return;
      const res = await axios.get(`${API_BASE_URL}/api/auth/balance/${u.id}`);
      if (res.data && typeof res.data.balance === 'number') {
        setBalance(res.data.balance);
      }
    } catch (err) {
      console.error('Failed to fetch balance', err);
    }
  };

  // Fetch binary history
  const fetchBinaryHistory = async () => {
    try {
      const token = localStorage.getItem('token');
      if (!token) return;
      const res = await axios.get(`${API_BASE_URL}/api/binary/history`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.data.success) {
        if (res.data.serverTime) {
          const offset = new Date(res.data.serverTime).getTime() - Date.now();
          setServerTimeOffset(offset);
        }
        const newOrders = res.data.orders;
        
        // Show notification toast if any pending order transitioned to WIN / LOSE / TIE
        if (prevBetsRef.current && prevBetsRef.current.length > 0) {
          newOrders.forEach(newOrder => {
            const oldOrder = prevBetsRef.current.find(o => o.Id === newOrder.Id);
            if (oldOrder && oldOrder.Status === 'PENDING' && newOrder.Status !== 'PENDING') {
              if (newOrder.Status === 'WIN') {
                const profit = newOrder.Payout - newOrder.BetAmount;
                toast.success(
                  <div style={{ fontSize: '13px', lineHeight: '1.6' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px', paddingBottom: '8px', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                      {renderKuCoinLogo(22)}
                      <span style={{ fontWeight: 'bold', fontSize: '14px', color: '#EAECEF', letterSpacing: '0.3px' }}>KuCoin</span>
                    </div>
                    <div style={{ color: '#848e9c', marginBottom: '4px' }}>Cặp giao dịch: <span style={{ color: '#EAECEF', fontWeight: 600 }}>{newOrder.Symbol}/USDT ({newOrder.BetType === 'UP' ? 'Mua lên' : 'Bán xuống'})</span></div>
                    <div style={{ color: '#848e9c', marginBottom: '4px' }}>Trạng thái: <span style={{ color: '#00FFA3', fontWeight: 'bold' }}>Thắng</span></div>
                    <div style={{ color: '#848e9c' }}>Nhận về: <span style={{ color: '#00FFA3', fontWeight: 'bold' }}>+{newOrder.Payout} USDT</span> <span style={{ color: '#848e9c', fontSize: '11px' }}>(Lợi nhuận: +{profit.toFixed(2)} USDT)</span></div>
                  </div>,
                  { theme: 'dark', autoClose: 6000, icon: false }
                );
              } else if (newOrder.Status === 'LOSE') {
                toast.error(
                  <div style={{ fontSize: '13px', lineHeight: '1.6' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px', paddingBottom: '8px', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                      {renderKuCoinLogo(22)}
                      <span style={{ fontWeight: 'bold', fontSize: '14px', color: '#EAECEF', letterSpacing: '0.3px' }}>KuCoin</span>
                    </div>
                    <div style={{ color: '#848e9c', marginBottom: '4px' }}>Cặp giao dịch: <span style={{ color: '#EAECEF', fontWeight: 600 }}>{newOrder.Symbol}/USDT ({newOrder.BetType === 'UP' ? 'Mua lên' : 'Bán xuống'})</span></div>
                    <div style={{ color: '#848e9c', marginBottom: '4px' }}>Trạng thái: <span style={{ color: '#F6465D', fontWeight: 'bold' }}>Thua</span></div>
                    <div style={{ color: '#848e9c' }}>Số dư thay đổi: <span style={{ color: '#F6465D', fontWeight: 'bold' }}>-{newOrder.BetAmount} USDT</span></div>
                  </div>,
                  { theme: 'dark', autoClose: 6000, icon: false }
                );
              } else if (newOrder.Status === 'TIE') {
                toast.info(
                  <div style={{ fontSize: '13px', lineHeight: '1.6' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px', paddingBottom: '8px', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                      {renderKuCoinLogo(22)}
                      <span style={{ fontWeight: 'bold', fontSize: '14px', color: '#EAECEF', letterSpacing: '0.3px' }}>KuCoin</span>
                    </div>
                    <div style={{ color: '#848e9c', marginBottom: '4px' }}>Cặp giao dịch: <span style={{ color: '#EAECEF', fontWeight: 600 }}>{newOrder.Symbol}/USDT ({newOrder.BetType === 'UP' ? 'Mua lên' : 'Bán xuống'})</span></div>
                    <div style={{ color: '#848e9c', marginBottom: '4px' }}>Trạng thái: <span style={{ color: '#EAECEF', fontWeight: 'bold' }}>Hòa</span></div>
                    <div style={{ color: '#848e9c' }}>Hoàn trả: <span style={{ color: '#FCD535', fontWeight: 'bold' }}>+{newOrder.Payout} USDT</span></div>
                  </div>,
                  { theme: 'dark', autoClose: 6000, icon: false }
                );
              }
            }
          });
        }
        
        prevBetsRef.current = newOrders;
        setBinaryBets(newOrders);

        // Find the latest pending bet to restore the right panel's active countdown
        const pendingBet = newOrders.find(o => o.Status === 'PENDING');
        if (pendingBet) {
          const offset = res.data.serverTime ? (new Date(res.data.serverTime).getTime() - Date.now()) : serverTimeOffset;
          const cleanEndStr = pendingBet.EndTime ? (pendingBet.EndTime.endsWith('Z') ? pendingBet.EndTime : `${pendingBet.EndTime}Z`) : '';
          let endMs = cleanEndStr ? new Date(cleanEndStr).getTime() : 0;
          const nowMs = Date.now() + offset;
          const diffMs = endMs - nowMs;
          if (diffMs < -1800000) {
            const shiftHours = Math.round(Math.abs(diffMs) / 3600000);
            if (shiftHours > 0 && shiftHours < 24) {
              endMs += shiftHours * 3600000;
            }
          }
          const remainSec = Math.max(0, Math.round((endMs - nowMs) / 1000));
          if (remainSec > 0) {
            setCountdownTotal(pendingBet.Duration || 60);
            setCountdownLeft(remainSec);
            setCountdownBetType(pendingBet.BetType);
            setCountdownActive(true);
            
            if (countdownIntervalRef.current) clearInterval(countdownIntervalRef.current);
            let remaining = remainSec;
            countdownIntervalRef.current = setInterval(() => {
              remaining -= 1;
              setCountdownLeft(remaining);
              if (remaining <= 0) {
                clearInterval(countdownIntervalRef.current);
                setCountdownActive(false);
                fetchBinaryHistory();
                fetchBalance();
              }
            }, 1000);
          } else {
            setCountdownActive(false);
          }
        } else {
          setCountdownActive(false);
        }
      }
    } catch (err) {
      console.error('Failed to fetch binary history', err);
    }
  };

  const [tradeStats, setTradeStats] = useState({ upUsers: 0, upAmount: 0, downUsers: 0, downAmount: 0 });
  const [adminTrend, setAdminTrend] = useState('neutral');

  useEffect(() => {
    fetchBinaryHistory();
    fetchBalance();
    const interval = setInterval(() => {
      fetchBinaryHistory();
      fetchBalance();
    }, 5000);
    return () => clearInterval(interval);
  }, []);

  // 1-second interval to force re-render for smooth order history countdown
  useEffect(() => {
    const timer = setInterval(() => {
      setTick(t => t + 1);
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // Fetch notifications
  useEffect(() => {
    let intervalId;
    const fetchNotifications = () => {
      if (currentUser && currentUser.id) {
        fetch(`${API_BASE_URL}/api/notifications/${currentUser.id}`)
          .then(res => res.json())
          .then(data => {
            if (Array.isArray(data)) {
              setNotifications(data);
              
              if (data.length > 0) {
                const latestId = data[0].Id;
                if (prevLatestNotificationId.current !== null && latestId !== prevLatestNotificationId.current) {
                  // Toast new notification
                  toast.info(data[0].Message, {
                    position: "top-right",
                    autoClose: 5000,
                    hideProgressBar: false,
                    closeOnClick: true,
                    pauseOnHover: true,
                    draggable: true,
                  });
                }
                prevLatestNotificationId.current = latestId;
              }
            }
          })
          .catch(console.error);
      }
    };
    
    if (currentUser && currentUser.id) {
      fetchNotifications();
      intervalId = setInterval(fetchNotifications, 5000);
    }
    return () => clearInterval(intervalId);
  }, [currentUser]);

  const unreadCount = notifications.filter(n => !n.IsRead).length;

  const handleOpenNotifications = (e) => {
    e.stopPropagation();
    setShowNotifications(!showNotifications);
    if (!showNotifications && unreadCount > 0 && currentUser && currentUser.id) {
      // Mark as read
      fetch(`${API_BASE_URL}/api/notifications/${currentUser.id}/read`, { method: 'POST' })
        .then(() => {
          setNotifications(prev => prev.map(n => ({ ...n, IsRead: true })));
        })
        .catch(console.error);
    }
  };

  // Close notifications dropdown on click outside
  useEffect(() => {
    if (!showNotifications) return;
    const handleClose = () => setShowNotifications(false);
    document.addEventListener('click', handleClose);
    return () => document.removeEventListener('click', handleClose);
  }, [showNotifications]);

  // Close coin selector dropdown on click outside
  useEffect(() => {
    if (!showCoinSelector) return;
    const handleClose = () => setShowCoinSelector(false);
    document.addEventListener('click', handleClose);
    return () => document.removeEventListener('click', handleClose);
  }, [showCoinSelector]);

  useEffect(() => {
    if (currentUser?.isAdmin) {
      const fetchAdminData = async () => {
        try {
          const statsRes = await axios.get(`${API_BASE_URL}/api/admin/trade-stats?symbol=${coin}`);
          setTradeStats(statsRes.data);
          const trendRes = await axios.get(`${API_BASE_URL}/api/prices/trend?symbol=${coin}`);
          setAdminTrend(trendRes.data.trend);
        } catch (e) { console.error('Error fetching admin data', e); }
      };
      fetchAdminData();
      const id = setInterval(fetchAdminData, 2000);
      return () => clearInterval(id);
    }
  }, [currentUser?.isAdmin, coin]);

  const handleSetAdminTrend = async (newTrend) => {
    try {
      const res = await axios.post(`${API_BASE_URL}/api/prices/trend`, {
        symbol: coin, trend: newTrend
      });
      if (res.data.success) setAdminTrend(newTrend);
    } catch (e) {
      console.error(e);
    }
  };

  // Hàm vẽ SVG logo KuCoin
  const renderKuCoinLogo = (size = 20) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M7.5 4L4 7.5V16.5L7.5 20H10.5L7 16.5V7.5L10.5 4H7.5Z" fill="#24DB9B" />
      <path d="M16.5 4L20 7.5V16.5L16.5 20H13.5L17 16.5V7.5L13.5 4H16.5Z" fill="#24DB9B" />
      <path d="M12 10L14 12L12 14L10 12L12 10Z" fill="#24DB9B" />
    </svg>
  );

  const kuToast = (type, message) => {
    const toastFn = type === 'success' ? toast.success : type === 'error' ? toast.error : toast.warning;
    toastFn(
      <div style={{ fontSize: '13px', lineHeight: '1.6' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px', paddingBottom: '8px', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
          {renderKuCoinLogo(20)}
          <span style={{ fontWeight: 'bold', fontSize: '13px', color: '#EAECEF', letterSpacing: '0.3px' }}>KuCoin</span>
        </div>
        <div style={{ color: '#EAECEF' }}>{message}</div>
      </div>,
      { theme: 'dark', autoClose: 4000, icon: false }
    );
  };

  const handleBinaryBet = async (type) => {
    if (!binaryAmount || isNaN(binaryAmount) || Number(binaryAmount) <= 0) {
      kuToast('warning', 'Vui lòng nhập số tiền cược hợp lệ.');
      return;
    }
    try {
      setBinaryLoading(true);
      const token = localStorage.getItem('token');
      if (!token) {
        kuToast('warning', 'Vui lòng đăng nhập để đặt cược.');
        return;
      }
      const res = await axios.post(`${API_BASE_URL}/api/binary/place`, {
        symbol: coin,
        betAmount: Number(binaryAmount),
        betType: type,
        duration: binaryDuration
      }, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.data.success) {
        if (res.data.serverTime) {
          const offset = new Date(res.data.serverTime).getTime() - Date.now();
          setServerTimeOffset(offset);
        }
        kuToast('success', `Đã đặt lệnh ${type === 'UP' ? 'Mua lên' : 'Bán xuống'} ${Number(binaryAmount).toFixed(2)} USDT`);
        setBinaryAmount('');
        fetchBinaryHistory();
        fetchBalance();
        // Start countdown circle
        const dur = binaryDuration;
        setCountdownTotal(dur);
        setCountdownLeft(dur);
        setCountdownBetType(type);
        setCountdownActive(true);
        if (countdownIntervalRef.current) clearInterval(countdownIntervalRef.current);
        let remaining = dur;
        countdownIntervalRef.current = setInterval(() => {
          remaining -= 1;
          setCountdownLeft(remaining);
          if (remaining <= 0) {
            clearInterval(countdownIntervalRef.current);
            setCountdownActive(false);
            fetchBinaryHistory();
            fetchBalance();
          }
        }, 1000);
      }
    } catch (err) {
      kuToast('error', err.response?.data?.message || 'Lỗi khi đặt cược.');
    } finally {
      setBinaryLoading(false);
    }
  };

  const handlePercentClick = (pct) => {
    if (balance <= 0) return;
    const amount = ((balance * pct) / 100).toFixed(2);
    setBinaryAmount(amount);
  };

  const handleFastDepositConfirm = () => {
    const amountVal = parseFloat(fastDepositAmount);
    if (!fastDepositAmount.trim() || isNaN(amountVal) || amountVal <= 0) {
      toast.error('Vui lòng nhập số tiền nạp hợp lệ.');
      return;
    }
    
    // Construct message to send to admin chat
    const userStr = localStorage.getItem('user');
    let userDetails = '';
    try {
      const u = JSON.parse(userStr);
      if (u) {
        userDetails = ` (User: ${u.fullName || u.email || 'Khách'}, ID: ${u.id || 'N/A'}${u.accountCode ? `, UID: ${u.accountCode}` : ''})`;
      }
    } catch {}

    const messageContent = `Yêu cầu nạp tiền nhanh: ${amountVal.toLocaleString('vi-VN')} USDT.${userDetails} Vui lòng hướng dẫn tôi cách thức thanh toán và phê duyệt giao dịch.`;
    
    // Dispatch the open-chat custom event to ChatWidget
    window.dispatchEvent(new CustomEvent('open-chat', {
      detail: { message: messageContent }
    }));
    
    toast.success(`Đã gửi yêu cầu nạp tiền nhanh: ${amountVal.toLocaleString('vi-VN')} USDT!`);
    setShowFastDepositModal(false);
    setFastDepositAmount('');
  };

  const handleTransferConfirm = () => {
    if (!transferBankName.trim() || !transferAccountNumber.trim() || !transferAccountHolder.trim() || !transferNote.trim()) {
      toast.error('Vui lòng điền đầy đủ tất cả các trường thông tin.');
      return;
    }

    // Construct message to send to admin chat
    const userStr = localStorage.getItem('user');
    let userDetails = '';
    try {
      const u = JSON.parse(userStr);
      if (u) {
        userDetails = ` (User: ${u.fullName || u.email || 'Khách'}, ID: ${u.id || 'N/A'}${u.accountCode ? `, UID: ${u.accountCode}` : ''})`;
      }
    } catch {}

    const msg = `Yêu cầu chuyển khoản:${userDetails}\n- Ngân hàng: ${transferBankName.trim().toUpperCase()}\n- Số tài khoản: ${transferAccountNumber.trim()}\n- Tên chủ tài khoản: ${transferAccountHolder.trim().toUpperCase()}\n- Ghi chú: ${transferNote.trim().toUpperCase()}`;

    // Dispatch the open-chat custom event to ChatWidget
    window.dispatchEvent(new CustomEvent('open-chat', {
      detail: { message: msg }
    }));

    toast.success('Đã gửi thông tin chuyển khoản đến hỗ trợ viên!');
    setShowTransferModal(false);
    setTransferBankName('');
    setTransferAccountNumber('');
    setTransferAccountHolder('');
    setTransferNote('');
  };

  /* ─── Build chart once ─── */
  useEffect(() => {
    const el = chartRef.current;
    if (!el) return;

    const chart = createChart(el, {
      layout: { background: { color: '#0b0e11' }, textColor: '#848e9c' },
      grid:   { vertLines: { color: '#1a1e27' }, horzLines: { color: '#1a1e27' } },
      crosshair: { mode: 1 },
      rightPriceScale: { borderColor: '#1e2329' },
      localization: {
        timeFormatter: (time) => {
          const date = new Date(time * 1000);
          return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        }
      },
      timeScale: { 
        borderColor: '#1e2329', 
        timeVisible: true, 
        secondsVisible: false,
        tickMarkFormatter: (time, tickMarkType, locale) => {
          const date = new Date(time * 1000);
          const hours = String(date.getHours()).padStart(2, '0');
          const minutes = String(date.getMinutes()).padStart(2, '0');
          return `${hours}:${minutes}`;
        }
      },
      width:  el.clientWidth,
      height: el.clientHeight,
    });
    chartInst.current = chart;

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: '#00FFA3', downColor: '#F6465D',
      borderVisible: false,
      wickUpColor: '#00FFA3', wickDownColor: '#F6465D',
      priceFormat: getPriceFormatOptions(base),
    });
    candleSRef.current = candleSeries;

    let isMounted = true;

    // Fetch initial candles from the backend
    const loadInitialCandles = async () => {
      try {
        const res = await axios.get(`${API_BASE_URL}/api/prices/candles?symbol=${coin}`);
        if (!isMounted) return;
        const originalCandles = res.data;
        if (originalCandles && originalCandles.length > 0) {
          candleSeries.setData(originalCandles);
          setHistoricalCandles(originalCandles);

          // Update logical visible range to show the last 100 candles
          chart.timeScale().setVisibleLogicalRange({
            from: originalCandles.length - 100,
            to: originalCandles.length + 10,
          });

          // Seed candle aggregation state from the last candle
          const lastCandle = originalCandles[originalCandles.length - 1];
          const serverLastMin = Math.floor(lastCandle.time / 60);
          const localNowMin = Math.floor(Date.now() / 1000 / 60);
          clockOffsetRef.current = serverLastMin - localNowMin;
          candleState.current = {
            open: lastCandle.open,
            high: lastCandle.high,
            low: lastCandle.low,
            minute: serverLastMin
          };
          setLivePrice(lastCandle.close);
          setPrevPrice(lastCandle.close);
        } else {
          console.warn('Backend returned no candles for', coin);
        }
      } catch (err) {
        console.warn('Failed to load initial candles:', err);
      }
    };

    loadInitialCandles();

    // Infinite backward scrolling by prepending historical candles dynamically on the fly
    let loadingMore = false;
    chart.timeScale().subscribeVisibleLogicalRangeChange((logicalRange) => {
      if (!logicalRange || loadingMore) return;
      
      // If user scrolls close to the left boundary (from index < 15)
      if (logicalRange.from < 15) {
        loadingMore = true;
        
        setHistoricalCandles(prev => {
          if (!prev || prev.length === 0) return prev;
          
          const firstCandle = prev[0];
          const t0 = firstCandle.time;
          let currentPrice = firstCandle.open;
          const prepended = [];
          const coinHash = hashStr(coin);
          
          // Prepend 1000 older candles
          for (let i = 1; i <= 1000; i++) {
            const time = t0 - i * 60;
            const seed = coinHash + Math.floor(time / 60) * 3;
            const r = seededRand(seed);
            const change = (r * 0.003 - 0.0015);
            
            const prevPrice = currentPrice / (1 + change);
            const open = prevPrice;
            const close = currentPrice;
            
            const r2 = seededRand(seed + 1);
            const r3 = seededRand(seed + 2);
            const high = Math.max(open, close) + Math.abs(open * r2 * 0.001);
            const low = Math.max(Math.min(open, close) - Math.abs(open * r3 * 0.001), 0.001);
            
            prepended.unshift({
              time,
              open,
              high,
              low,
              close
            });
            
            currentPrice = prevPrice;
          }
          
          const merged = [...prepended, ...prev];
          candleSeries.setData(merged);
          return merged;
        });
        
        setTimeout(() => {
          loadingMore = false;
        }, 300);
      }
    });

    // Save active state to chartInitRef
    chartInitRef.current = { symbol: coin, isReal: !!globalCoin?.isReal, backendSynced: !!globalCoin?.backendSynced };

    const onResize = () => {
      chart.applyOptions({ width: el.clientWidth, height: el.clientHeight });
    };
    const ro = new ResizeObserver(onResize);
    ro.observe(el);

    return () => {
      isMounted = false;
      ro.disconnect();
      chart.remove();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coin]);



  /* ─── Sync chart with global price context ───
   * Runs every time PriceContext emits a new price for this coin.
   * No independent timer needed — perfect sync across all pages.
   */
  useEffect(() => {
    if (!globalCoin) return;

    const newPrice = globalCoin.price;
    setPrevPrice(prev => prev);
    setLivePrice(prev => {
      setPrevPrice(prev);
      return newPrice;
    });

    // Update chart candle (1-minute aggregation)
    if (candleSRef.current) {
      const localNowMin = Math.floor(Date.now() / 1000 / 60);
      let nowMin = localNowMin + clockOffsetRef.current;
      const cs = candleState.current;

      if (nowMin < cs.minute) {
        nowMin = cs.minute;
      }
      const candleTs = nowMin * 60;

      if (nowMin !== cs.minute) {
        // New minute → close old candle, open new one
        cs.minute = nowMin;
        cs.open   = newPrice;
        cs.high   = newPrice;
        cs.low    = newPrice;
      } else {
        if (newPrice > cs.high) cs.high = newPrice;
        if (newPrice < cs.low)  cs.low  = newPrice;
      }

      candleSRef.current.update({
        time:  candleTs,
        open:  cs.open,
        high:  cs.high,
        low:   cs.low,
        close: newPrice,
      });

      // Volume bar synced with candle color
      if (volSeriesRef.current) {
        const volSeed = hashStr(coin + candleTs);
        volSeriesRef.current.update({
          time:  candleTs,
          value: seededRand(volSeed) * 3000 + 300,
          color: newPrice >= cs.open
            ? 'rgba(0,255,163,0.45)'
            : 'rgba(246,70,93,0.45)',
        });
      }
    }

    // Update order book with new price
    setObData(genOrderBook(newPrice));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [globalCoin]);

  const changePercent = globalCoin ? globalCoin.change : 0;
  const priceUp  = changePercent >= 0;
  const priceCls = priceUp ? 'green' : 'red';

  const tabs = [
    { key: coin, label: coin, price: fmt(livePrice, 2), up: priceUp },
    { key: 'BTC',  label: 'BTC/USDT',  price: btcCoin ? fmt(btcCoin.price, 2) : '77,390.98', up: btcCoin ? btcCoin.isUp : true  },
    { key: 'ETH',  label: 'ETH/USDT',  price: ethCoin ? fmt(ethCoin.price, 2) : '2,127.08',  up: ethCoin ? ethCoin.isUp : true  },
  ];

  const timeframes = ['1m', '3m', '5m', '15m', '1h', '4h', '1d', '1w'];
  const mobileTimeframes = [
    {k:'1m',l:'1phút'},{k:'5m',l:'5phút'},{k:'15m',l:'15phút'},
    {k:'30m',l:'30phút'},{k:'1h',l:'1giờ'},{k:'4h',l:'4giờ'},
    {k:'1d',l:'1ngày'},{k:'1w',l:'1tuần'},{k:'1M',l:'1Tháng'},
  ];

  return (
    <div className="trade-page">
      <ToastContainer
        position="top-right"
        autoClose={6000}
        hideProgressBar={false}
        newestOnTop
        closeOnClick
        rtl={false}
        pauseOnFocusLoss
        draggable
        pauseOnHover
        theme="dark"
        toastStyle={{
          background: '#1e2329',
          border: '1px solid #2b3139',
          borderRadius: '10px',
          boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
          minWidth: '320px'
        }}
      />

      {/* ═══════════ MOBILE ONLY ELEMENTS (hidden on desktop via CSS) ═══════════ */}

      {/* Mobile Top Navigation Bar */}
      <div className="tp-m-topbar">
        <button 
          className="tp-m-nav-btn" 
          onClick={() => navigate('/')}
          style={{ 
            display: 'flex', 
            alignItems: 'center', 
            gap: '4px', 
            padding: '4px 8px', 
            borderRadius: '4px', 
            background: 'rgba(255,255,255,0.06)',
            border: '1px solid rgba(255,255,255,0.1)'
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#24DB9B" strokeWidth="2.5">
            <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
            <polyline points="9 22 9 12 15 12 15 22"/>
          </svg>
          <span style={{ fontSize: '11px', color: '#eaecef', fontWeight: 600 }}>Trang chủ</span>
        </button>
        <div className="tp-m-pair-selector" onClick={(e) => { e.stopPropagation(); setShowCoinSelector(!showCoinSelector); }} style={{ position: 'relative', marginLeft: '6px' }}>
          <span className="tp-m-pair-name">{coin}USDT</span>
          <span className="tp-m-pair-caret">▾</span>
          {showCoinSelector && (
            <div className="tp-m-coin-dropdown" onClick={(e) => e.stopPropagation()}>
              {Object.keys(INITIAL_COIN_PRICES).map((sym) => (
                <div key={sym} className={`tp-m-coin-item${coin === sym ? ' active' : ''}`}
                  onClick={() => { setShowCoinSelector(false); navigate(`/trade/${sym}`); }}>
                  <span>{sym}-USDT</span>
                  <span className="tp-m-coin-item-price">
                    ${(prices?.[sym]?.price ?? INITIAL_COIN_PRICES[sym]) < 1
                      ? (prices?.[sym]?.price ?? INITIAL_COIN_PRICES[sym]).toFixed(6)
                      : (prices?.[sym]?.price ?? INITIAL_COIN_PRICES[sym]).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
        <div style={{ flex: 1 }} />
        {currentUser && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', justifyContent: 'center', marginRight: '10px', position: 'relative' }}>
            <span style={{ fontSize: '9px', color: '#848e9c', fontWeight: 500, lineHeight: '1' }}>Số dư</span>
            <span style={{ fontSize: '13px', color: '#FCD535', fontWeight: 700, marginTop: '2px' }}>
              ${balance.toLocaleString('en-US', { minimumFractionDigits: 2 })}
            </span>
          </div>
        )}
        <button className="tp-m-nav-btn">
          <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/></svg>
        </button>
      </div>

      {/* Mobile Price Info Section */}
      <div className="tp-m-price-section">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
            <div className="tp-m-big-price" style={{ color: priceUp ? '#00FFA3' : '#F6465D', lineHeight: 1.1 }}>
              {fmt(livePrice)}
            </div>
            <div className="tp-m-price-change" style={{ color: priceUp ? '#00FFA3' : '#F6465D', display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px' }}>
              <span>≈ ${fmt(livePrice)}</span>
              <span>{changePercent >= 0 ? '+' : ''}{changePercent.toFixed(2)}%</span>
            </div>
            <div className="tp-m-ref-price" style={{ marginBottom: 0, fontSize: '10.5px' }}>Giá tham chiếu {fmt(livePrice * 0.9996, 2)}</div>
          </div>

          {/* Mobile Price Section Countdown */}
          {countdownActive && (
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              background: countdownBetType === 'UP' ? 'rgba(0,255,163,0.08)' : 'rgba(246,70,93,0.08)',
              border: `1.2px solid ${countdownBetType === 'UP' ? 'rgba(0,255,163,0.3)' : 'rgba(246,70,93,0.3)'}`,
              borderRadius: '10px',
              padding: '6px 10px',
              boxShadow: countdownBetType === 'UP' ? '0 0 12px rgba(0,255,163,0.1)' : '0 0 12px rgba(246,70,93,0.1)',
            }}>
              <div style={{ position: 'relative', width: '38px', height: '38px' }}>
                <svg width="38" height="38" style={{ transform: 'rotate(-90deg)' }}>
                  <circle cx="19" cy="19" r="16" fill="none" stroke="#1e2329" strokeWidth="3" />
                  <circle
                    cx="19" cy="19" r="16"
                    fill="none"
                    stroke={countdownBetType === 'UP' ? '#00FFA3' : '#F6465D'}
                    strokeWidth="3"
                    strokeLinecap="round"
                    strokeDasharray={`${2 * Math.PI * 16}`}
                    strokeDashoffset={`${2 * Math.PI * 16 * (1 - countdownLeft / countdownTotal)}`}
                    style={{ transition: 'stroke-dashoffset 0.95s linear' }}
                  />
                </svg>
                <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <span style={{ fontSize: '12px', fontWeight: '900', color: countdownBetType === 'UP' ? '#00FFA3' : '#F6465D', fontFamily: 'monospace', lineHeight: 1 }}>{countdownLeft}</span>
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center' }}>
                <span style={{ fontSize: '13px', color: countdownBetType === 'UP' ? '#00FFA3' : '#F6465D', fontWeight: '900', display: 'flex', alignItems: 'center', gap: '2px' }}>
                  {countdownBetType === 'UP' ? '▲ TĂNG' : '▼ GIẢM'}
                </span>
              </div>
            </div>
          )}
        </div>
        <div className="tp-m-stats-grid">
          <div className="tp-m-stats-col">
            <div className="tp-m-stat-item">
              <span className="tp-m-stat-label">Cao 24h</span>
              <span className="tp-m-stat-val">{fmt(livePrice * 1.021, 2)}</span>
            </div>
            <div className="tp-m-stat-item">
              <span className="tp-m-stat-label">Thấp 24h</span>
              <span className="tp-m-stat-val">{fmt(livePrice * 0.979, 2)}</span>
            </div>
          </div>
          <div className="tp-m-stats-col">
            <div className="tp-m-stat-item">
              <span className="tp-m-stat-label">24h vol({coin})</span>
              <span className="tp-m-stat-val">{(livePrice * 350).toFixed(3)}</span>
            </div>
            <div className="tp-m-stat-item">
              <span className="tp-m-stat-label">24h vol(USDT)</span>
              <span className="tp-m-stat-val">{(livePrice * livePrice * 350 / 1e6).toFixed(4)}M</span>
            </div>
          </div>
        </div>
      </div>



      {/* ═══════════ HEADER ═══════════ */}
      {/* ═══════════ NEW 3-ROW HEADER ═══════════ */}
      <header className="trade-header-container">
        
        {/* ROW 1: Global Nav */}
        <div className="th-global-nav">
          <div className="th-gn-left">
            <Link to="/" className="th-logo">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
                <path d="M7.5 4L4 7.5V16.5L7.5 20H10.5L7 16.5V7.5L10.5 4H7.5Z" fill="#24DB9B"/>
                <path d="M16.5 4L20 7.5V16.5L16.5 20H13.5L17 16.5V7.5L13.5 4H16.5Z" fill="#24DB9B"/>
                <path d="M12 10L14 12L12 14L10 12L12 10Z" fill="#24DB9B"/>
              </svg>
              <span className="th-logo-text">KUCOIN</span>
            </Link>

            <Link
              to="/"
              style={{
                background: 'rgba(255, 255, 255, 0.06)',
                color: '#eaecef',
                border: '1px solid rgba(255, 255, 255, 0.15)',
                borderRadius: '6px',
                padding: '4px 12px',
                fontSize: '12px',
                fontWeight: 600,
                textDecoration: 'none',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                marginLeft: '12px',
                marginRight: '8px',
                transition: 'all 0.2s',
                height: '28px'
              }}
              onMouseOver={(e) => {
                e.currentTarget.style.background = 'rgba(36, 219, 155, 0.15)';
                e.currentTarget.style.color = '#24DB9B';
                e.currentTarget.style.borderColor = 'rgba(36, 219, 155, 0.3)';
              }}
              onMouseOut={(e) => {
                e.currentTarget.style.background = 'rgba(255, 255, 255, 0.06)';
                e.currentTarget.style.color = '#eaecef';
                e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.15)';
              }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
                <polyline points="9 22 9 12 15 12 15 22"/>
              </svg>
              Trang chủ
            </Link>
            
            <div className="th-nav-switch">
              <div className="th-switch-item active">Sàn giao dịch</div>
              <div className="th-switch-item">Web3</div>
            </div>

            <nav className="k-nav-menu">
              <div className="k-nav-item dropdown">
                <span>Mua tiền điện tử</span>
                <span className="k-nav-arrow">▼</span>
                <BuyCryptoMenu />
              </div>
              <a href="#" className="k-nav-item">Thị trường</a>
              <div className="k-nav-item dropdown">
                <span>Giao dịch</span>
                <span className="k-nav-arrow">▼</span>
                <TradeMenu />
              </div>
              <div className="k-nav-item dropdown">
                <span>Phái sinh</span>
                <span className="k-nav-arrow">▼</span>
                <DerivativesMenu />
              </div>
              <div className="k-nav-item dropdown">
                <span>Trung tâm bệ phóng</span>
                <span className="k-nav-arrow">▼</span>
                <LaunchpadMenu />
              </div>
              <div className="k-nav-item dropdown">
                <span>Kiếm tiền</span>
                <span className="k-nav-arrow">▼</span>
                <EarnMenu />
              </div>
              <div className="k-nav-item dropdown">
                <span>Tổ chức</span>
                <span className="k-nav-arrow">▼</span>
                <InstitutionalMenu />
              </div>
            </nav>
          </div>
          <div className="th-gn-right" style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            {/* Icons Group */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              {/* Search */}
              <div className="th-icon-btn" title="Tìm kiếm">
                <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>
              </div>

              {/* Download */}
              <div className="th-icon-btn" title="Tải xuống">
                <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
              </div>

              {/* Bell */}
              <div 
                className="th-icon-btn th-bell-btn" 
                title="Thông báo" 
                style={{ position: 'relative' }} 
                onClick={handleOpenNotifications}
              >
                <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
                  <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
                </svg>
                {unreadCount > 0 && (
                  <span style={{ 
                    position: 'absolute', 
                    top: '-2px', 
                    right: '-2px', 
                    background: '#f6465d', 
                    color: 'white', 
                    fontSize: '9px', 
                    borderRadius: '50%', 
                    width: '13px', 
                    height: '13px', 
                    display: 'flex', 
                    alignItems: 'center', 
                    justifyContent: 'center',
                    fontWeight: 'bold',
                    boxShadow: '0 0 4px rgba(246, 70, 93, 0.5)'
                  }}>
                    {unreadCount}
                  </span>
                )}

                {showNotifications && (
                  <div 
                    className="th-notifications-dropdown" 
                    onClick={(e) => e.stopPropagation()} 
                    style={{ 
                      position: 'absolute', 
                      top: '32px', 
                      right: '-140px', 
                      width: '320px', 
                      background: '#151821', 
                      borderRadius: '8px', 
                      boxShadow: '0 8px 24px rgba(0,0,0,0.6)', 
                      zIndex: 1000, 
                      border: '1px solid rgba(255, 255, 255, 0.08)', 
                      padding: '10px 0',
                      cursor: 'default',
                      textAlign: 'left'
                    }}
                  >
                    <div style={{ padding: '10px 20px', fontWeight: '600', borderBottom: '1px solid rgba(255, 255, 255, 0.08)', color: '#eaecef', fontSize: '13px' }}>Thông báo</div>
                    <div style={{ maxHeight: '250px', overflowY: 'auto' }}>
                      {notifications.length === 0 ? (
                        <div style={{ padding: '20px', textAlign: 'center', color: '#848e9c', fontSize: '13px' }}>Không có thông báo nào</div>
                      ) : (
                        notifications.map(n => (
                          <div key={n.Id} style={{ padding: '12px 20px', borderBottom: '1px solid rgba(255, 255, 255, 0.05)', color: n.IsRead ? '#848e9c' : '#eaecef', background: n.IsRead ? 'transparent' : 'rgba(36, 219, 155, 0.05)', fontSize: '12px' }}>
                            <div style={{ marginBottom: '4px', lineHeight: '1.4' }}>{n.Message}</div>
                            <div style={{ fontSize: '10px', color: '#848e9c' }}>{new Date(n.CreatedAt.replace('Z', '')).toLocaleString('vi-VN')}</div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* Globe */}
              <div className="th-icon-btn" title="Ngôn ngữ">
                <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
              </div>

              {/* Dark Mode */}
              <div className="th-icon-btn" title="Chế độ tối">
                <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
              </div>
            </div>

            <div style={{ width: '1px', height: '14px', background: '#2b3139', margin: '0 4px' }}></div>

            {currentUser?.isAdmin && (
              <Link
                to="/admin"
                style={{
                  background: 'linear-gradient(135deg, #F6465D, #d43a4e)',
                  color: '#fff',
                  border: 'none',
                  borderRadius: '6px',
                  padding: '6px 14px',
                  fontSize: '12px',
                  fontWeight: 700,
                  textDecoration: 'none',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  margin: '0 10px',
                  boxShadow: '0 2px 8px rgba(246,70,93,0.3)',
                  transition: 'all 0.2s',
                  height: '28px'
                }}
                onMouseOver={(e) => e.currentTarget.style.opacity = '0.9'}
                onMouseOut={(e) => e.currentTarget.style.opacity = '1'}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
                Trang Quản Trị
              </Link>
            )}

            {/* User Avatar & Name */}
            {currentUser ? (
              <div className="k-user-menu">
                <div className="k-user-trigger" title={currentUser.username || 'Tài khoản'}>
                  <div className="k-user-avatar" style={{ width: '28px', height: '28px', fontSize: '14px', background: 'transparent', border: '1px solid #24DB9B', color: '#24DB9B' }}>
                    {userInitial}
                  </div>
                  <span className="k-user-name" style={{ fontSize: '12px', color: '#eaecef', fontWeight: '500' }}>
                    {currentUser.username ? (currentUser.username.length > 15 ? currentUser.username.substring(0, 15) + '...' : currentUser.username) : 'Nhà giao dịch...'}
                  </span>
                  <span className="k-user-arrow" style={{ fontSize: '10px', color: '#848e9c', marginLeft: '2px' }}>▾</span>
                </div>

                <div className="k-user-dropdown">
                  <div className="k-user-dropdown-header">
                    <div className="k-user-avatar k-user-avatar-lg">
                      {userInitial}
                    </div>
                    <div>
                      <div style={{ color: '#eaecef', fontWeight: 600, fontSize: '13px' }}>
                        {currentUser.username || currentUser.fullName || currentUser.email}
                      </div>
                      <div style={{ color: '#848e9c', fontSize: '11px' }}>
                        {currentUser.email}
                      </div>
                      {currentUser.accountCode && (
                        <div style={{ color: '#00FFA3', fontSize: '11px', marginTop: '4px', fontWeight: 600, display: 'inline-block', background: 'rgba(0, 255, 163, 0.1)', padding: '2px 6px', borderRadius: '4px' }}>
                          UID: {currentUser.accountCode}
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="k-user-dropdown-divider" />
                  
                  {/* Phần tài sản hiển thị số dư trực tiếp trong user menu hover */}
                  <div style={{ padding: '8px 16px', display: 'flex', flexDirection: 'column', gap: '2px' }}>
                    <div style={{ fontSize: '11px', color: '#848e9c' }}>Tài sản của tôi</div>
                    <div style={{ fontSize: '15px', color: '#24DB9B', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <span>{balance.toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
                      <span style={{ fontSize: '11px', color: '#eaecef', fontWeight: 'normal' }}>USDT</span>
                    </div>
                    <div style={{ fontSize: '11px', color: '#848e9c' }}>
                      ≈ {(balance / (btcCoin?.price || 77000)).toFixed(6)} BTC
                    </div>
                  </div>
                  <div className="k-user-dropdown-divider" />

                  {currentUser.isAdmin && (
                    <Link to="/admin" className="k-user-dropdown-item k-user-dropdown-admin">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>
                      Quản trị viên
                    </Link>
                  )}
                  <button onClick={() => { localStorage.removeItem('token'); localStorage.removeItem('user'); window.location.href = '/login'; }} className="k-user-dropdown-item k-user-dropdown-logout">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
                    Đăng xuất
                  </button>
                </div>
              </div>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Link to="/login" style={{ color: '#fff', textDecoration: 'none', fontSize: '12px', fontWeight: '500', fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif" }}>Đăng nhập</Link>
                <Link to="/register" style={{ color: '#24DB9B', textDecoration: 'none', fontSize: '12px', fontWeight: '500', fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif" }}>Đăng ký</Link>
              </div>
            )}


            {/* Deposit Button */}
            <Link to="/support/deposit" className="th-deposit-btn">↓ Thêm tiền</Link>

            <div className="th-nav-links" style={{ gap: '16px' }}>
              <div className="th-dropdown-wrapper">
                <span>Tài sản ▾</span>
                <div className="th-assets-dropdown">
                  <div className="th-assets-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span>Tổng quan</span>
                    <svg 
                      onClick={(e) => { e.preventDefault(); e.stopPropagation(); setShowBalance(!showBalance); }} 
                      style={{ cursor: 'pointer' }} 
                      width="14" 
                      height="14" 
                      fill="none" 
                      stroke="#848e9c" 
                      strokeWidth="2" 
                      viewBox="0 0 24 24"
                    >
                      {showBalance ? (
                        <>
                          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                          <circle cx="12" cy="12" r="3" />
                        </>
                      ) : (
                        <>
                          <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                          <line x1="1" y1="1" x2="23" y2="23" />
                        </>
                      )}
                    </svg>
                  </div>
                  <div className="th-assets-balance" style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '4px', marginBottom: '16px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', width: '100%' }}>
                      {showBalance ? (
                        <>
                          <span className="th-stars">{(balance / (btcCoin?.price || 77000)).toFixed(6)}</span>{' '}
                          <span className="th-currency">BTC</span>
                        </>
                      ) : (
                        <>
                          <span className="th-stars">***</span> <span className="th-currency">BTC</span>
                        </>
                      )}
                      <svg 
                        className="th-copy-icon" 
                        onClick={(e) => { 
                          e.preventDefault(); 
                          e.stopPropagation(); 
                          navigator.clipboard.writeText((balance / (btcCoin?.price || 77000)).toFixed(6));
                          alert('Đã sao chép số dư BTC!');
                        }}
                        width="14" 
                        height="14" 
                        fill="none" 
                        stroke="#848e9c" 
                        strokeWidth="2" 
                        viewBox="0 0 24 24"
                      >
                        <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/>
                        <rect x="8" y="2" width="8" height="4" rx="1" ry="1"/>
                      </svg>
                    </div>
                    {showBalance && (
                      <div style={{ fontSize: '11px', color: '#848e9c', marginTop: '2px' }}>
                        ≈ {balance.toLocaleString('en-US', { minimumFractionDigits: 2 })} USDT
                      </div>
                    )}
                  </div>
                  <div className="th-assets-divider" />
                  <a href="#"><svg width="16" height="16" fill="none" stroke="#848e9c" strokeWidth="2" viewBox="0 0 24 24"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>Tài khoản tài trợ</a>
                  <a href="#"><svg width="16" height="16" fill="none" stroke="#848e9c" strokeWidth="2" viewBox="0 0 24 24"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>Tài khoản giao dịch</a>
                  <a href="#"><svg width="16" height="16" fill="none" stroke="#848e9c" strokeWidth="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg>Tài khoản Futures</a>
                  <a href="#"><svg width="16" height="16" fill="none" stroke="#848e9c" strokeWidth="2" viewBox="0 0 24 24"><path d="M3 3h18v18H3z"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="21" x2="9" y2="9"/></svg>Tài khoản Ký quỹ</a>
                  <a href="#"><svg width="16" height="16" fill="none" stroke="#848e9c" strokeWidth="2" viewBox="0 0 24 24"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>Tài khoản tài chính</a>
                </div>
              </div>
              <div className="th-dropdown-wrapper">
                <span>Lệnh ▾</span>
              </div>
            </div>
          </div>
        </div>

        {/* ROW 2: Coin Info */}
        <div className="th-coin-info">
          <div className="th-ci-left">
            <div className="th-coin-identity">
              <div className="th-coin-logo-circle" style={{background: 'transparent', width: '32px', height: '32px', display: 'flex', alignItems: 'center', justifyContent: 'center'}}>
                {renderKuCoinLogo(30)}
              </div>
              <div 
                className="th-coin-names" 
                style={{ position: 'relative' }}
                onClick={(e) => e.stopPropagation()}
              >
                <div 
                  className="th-coin-main-name"
                  onClick={() => setShowCoinSelector(!showCoinSelector)}
                  style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px' }}
                >
                  <CoinLogo name={coin} size={24} />
                  <span>{coin}</span>
                </div>
                <div className="th-coin-contract">
                  Fmj...pump <span>📋</span>
                </div>

                {showCoinSelector && (
                  <div 
                    className="th-coin-selector-dropdown"
                    style={{
                      position: 'absolute',
                      top: '100%',
                      left: 0,
                      background: '#151821',
                      border: '1px solid rgba(255, 255, 255, 0.08)',
                      borderRadius: '8px',
                      boxShadow: '0 8px 24px rgba(0,0,0,0.6)',
                      zIndex: 1005,
                      width: '220px',
                      maxHeight: '300px',
                      overflowY: 'auto',
                      padding: '6px 0',
                    }}
                  >
                    <div style={{ padding: '8px 12px', fontSize: '11px', color: '#848e9c', borderBottom: '1px solid rgba(255, 255, 255, 0.05)', fontWeight: 'bold' }}>
                      Chọn loại tài sản
                    </div>
                    {Object.keys(INITIAL_COIN_PRICES).map((symbolKey) => {
                      const liveCoinPrice = prices?.[symbolKey]?.price ?? INITIAL_COIN_PRICES[symbolKey];
                      return (
                        <div
                          key={symbolKey}
                          onClick={() => {
                            setShowCoinSelector(false);
                            navigate(`/trade/${symbolKey}`);
                          }}
                          style={{
                            padding: '10px 12px',
                            color: coin === symbolKey ? '#24DB9B' : '#eaecef',
                            fontSize: '13px',
                            fontWeight: coin === symbolKey ? 'bold' : 'normal',
                            cursor: 'pointer',
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            background: coin === symbolKey ? 'rgba(36, 219, 155, 0.05)' : 'transparent',
                            transition: 'background 0.15s',
                          }}
                          onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255, 255, 255, 0.04)'}
                          onMouseLeave={(e) => e.currentTarget.style.background = coin === symbolKey ? 'rgba(36, 219, 155, 0.05)' : 'transparent'}
                        >
                          <div style={{ display: 'flex', alignItems: 'center' }}>
                            <CoinLogo name={symbolKey} size={18} />
                            <span>{symbolKey}-USDT</span>
                          </div>
                          <span style={{ fontSize: '11px', color: '#848e9c' }}>
                            ${(liveCoinPrice < 1 
                              ? liveCoinPrice.toFixed(6) 
                              : liveCoinPrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }))}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            <div className="th-ci-price-block">
              <div className={`th-ci-price ${priceUp ? 'text-green' : 'text-red'}`}>{fmt(livePrice, 2)}</div>
              <div className={`th-ci-change ${priceUp ? 'text-green' : 'text-red'}`}>{changePercent >= 0 ? '+' : ''}{changePercent.toFixed(2)}%</div>
            </div>

            <div className="th-ci-stats-list">
              <div className="th-ci-stat">
                <div className="th-ci-label">Trần 24H</div>
                <div className="th-ci-val">{fmt(livePrice*1.3, 2)}</div>
              </div>
              <div className="th-ci-stat">
                <div className="th-ci-label">Sàn 24H</div>
                <div className="th-ci-val">{fmt(livePrice*0.7, 2)}</div>
              </div>
              <div className="th-ci-stat">
                <div className="th-ci-label">Khối lượng 24 giờ</div>
                <div className="th-ci-val">81.47M</div>
              </div>
              <div className="th-ci-stat">
                <div className="th-ci-label">Giao dịch 24 giờ</div>
                <div className="th-ci-val">28.7K</div>
              </div>
              <div className="th-ci-stat">
                <div className="th-ci-label">Vốn hóa thị trường</div>
                <div className="th-ci-val">81.80M</div>
              </div>
              <div className="th-ci-stat">
                <div className="th-ci-label">Nguồn cung lưu hành</div>
                <div className="th-ci-val">50B</div>
              </div>
              <div className="th-ci-stat">
                <div className="th-ci-label">Người nắm giữ</div>
                <div className="th-ci-val">24.89K</div>
              </div>
              <div className="th-ci-stat">
                <div className="th-ci-label">Rủi ro {'>'}</div>
                <div className="th-ci-val text-green">✓</div>
              </div>
            </div>
          </div>
          
          <div className="th-ci-right">
            <div 
              className="th-ci-action" 
              onClick={() => navigate('/')} 
              style={{ color: '#24DB9B', fontWeight: 'bold', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}
            >
              <span>🏠 Trang chủ</span>
            </div>
            <div className="th-ci-action">
              <span>📄 Thông tin giao dịch</span>
            </div>
            <div className="th-ci-action"><span>❓</span></div>
            <div className="th-ci-action"><span>⚙️</span></div>
          </div>
        </div>

        {/* ROW 3: Favorites / Sub nav */}
        <div className="th-favorites-nav">
          <div className="th-fav-item">⭐ Mục yêu thích ▾</div>
        </div>
      </header>

      {/* ═══════════ BODY ═══════════ */}
      <div className="trade-body">

        {/* ─── Left Toolbar ─── */}
        <div className="trade-left-toolbar">
          {[
            <svg key="cursor" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><path d="M3 3l7.07 16.97 2.51-7.39 7.39-2.51L3 3z"/></svg>,
            <svg key="cross" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><line x1="12" y1="2" x2="12" y2="22"/><line x1="2" y1="12" x2="22" y2="12"/></svg>,
            <svg key="line" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><line x1="3" y1="21" x2="21" y2="3"/></svg>,
            <svg key="rect" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18"/></svg>,
            <svg key="fib" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><path d="M3 12h18M3 6h18M3 18h18"/></svg>,
            <svg key="text" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><path d="M4 6h16M4 12h10M4 18h14"/></svg>,
          ].map((icon, i) => (
            <div key={i} className="toolbar-btn">{icon}</div>
          ))}
          <div className="toolbar-divider"/>
          <div className="toolbar-btn">
            <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-2 14H7L5 6"/></svg>
          </div>
        </div>

        {/* ─── Chart Area ─── */}
        <div className="trade-chart-area">
          <div className="chart-top-bar">
            <div className="chart-top-bar-tabs">
              {[{k:'chart',l:'Biểu đồ'},{k:'depth',l:'Nguồn cấp dữ liệu'}].map(t=>(
                <div key={t.k} className={`chart-top-tab ${chartTopTab===t.k?'active':''}`} onClick={()=>setChartTopTab(t.k)}>{t.l}</div>
              ))}
              
              {/* New Dropdown for Indicators */}
              <div 
                className={`chart-top-tab ${chartTopTab==='volume'?'active':''}`} 
                onMouseEnter={() => setShowIndicatorsMenu(true)}
                onMouseLeave={() => setShowIndicatorsMenu(false)}
                style={{ position: 'relative' }}
              >
                Chỉ báo ▾
                {showIndicatorsMenu && (
                  <div className="dropdown-menu">
                    <div className="dropdown-item" onClick={() => setChartTopTab('volume')}>
                      Khối lượng (Volume)
                    </div>
                  </div>
                )}
              </div>
            </div>
            <div style={{marginLeft:'auto', display:'flex', alignItems:'center', gap:'8px'}}>
              <svg width="14" height="14" fill="none" stroke="#848e9c" strokeWidth="1.5" viewBox="0 0 24 24"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></svg>
              <svg width="14" height="14" fill="none" stroke="#848e9c" strokeWidth="1.5" viewBox="0 0 24 24"><polyline points="8 3 4 3 4 21 20 21 20 17"/><rect x="8" y="3" width="12" height="12" rx="1"/></svg>
            </div>
          </div>

          <div className="chart-timeframe-bar">
            <span style={{color:'#848e9c',fontSize:'11px',marginRight:'6px'}}>Thời gian</span>
            {timeframes.map(t => (
              <button key={t} className={`tf-btn ${tf===t?'active':''}`} onClick={()=>setTf(t)}>{t}</button>
            ))}
            <div className="tf-separator"/>
            <button className="tf-btn">N</button>
            <button className="tf-btn">
              <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><line x1="4" y1="6" x2="20" y2="6"/><line x1="4" y1="12" x2="20" y2="12"/><line x1="4" y1="18" x2="20" y2="18"/></svg>
            </button>
            <button className="tf-btn">
              <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
            </button>
            <div style={{marginLeft:'auto', display:'flex', gap:'4px'}}>
              <button className="tf-btn">
                <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>
              </button>
              <button className="tf-btn">
                <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
              </button>
            </div>
          </div>

          <div className="chart-container" style={{ display: chartTopTab === 'chart' ? 'block' : 'none' }}>
            {/* Mobile MA labels overlay (hidden on desktop) */}
            <div className="tp-m-ma-strip">
              <span className="tp-m-ma-tag">MA(5,10,30,60)</span>
              <span className="tp-m-ma-5">MA5: {fmt(livePrice * 0.9992, 2)}</span>
              <span className="tp-m-ma-10">MA10: {fmt(livePrice * 1.0008, 2)}</span>
              <span className="tp-m-ma-30">MA30: {fmt(livePrice * 1.0004, 2)}</span>
              <span className="tp-m-ma-60">MA60: {fmt(livePrice * 0.9996, 2)}</span>
            </div>
            <div ref={chartRef} className="chart-inner"/>
          </div>
          {chartTopTab === 'depth' && (
            <div className="chart-container" style={{ padding: '20px' }}>
              <DepthChartSVG obData={obData} />
            </div>
          )}
          {chartTopTab === 'volume' && (
            <div className="chart-container">
              <VolumeChartComponent candles={historicalCandles} volSeriesRef={volSeriesRef} />
            </div>
          )}
        </div>

        {/* ─── Market Trades (Replaces Order Book for Alpha) ─── */}
        <div className="trade-orderbook-panel">
          <div className="ob-header">
            <div className={`ob-tab ${true?'active':''}`}>Giao dịch thị trường</div>
            <div className="ob-tab">Thanh khoản</div>
          </div>
          <div className="ob-col-header">
            <span style={{flex: 1}}>Tỷ lệ</span>
            <span style={{flex: 1, textAlign: 'right'}}>Số tiền ({coin})</span>
            <span style={{flex: 1, textAlign: 'right'}}>Time</span>
          </div>
          <div className="ob-list" style={{ overflowY: 'auto' }}>
            {/* Generate some fake recent trades based on the live price */}
            {Array.from({ length: 40 }).map((_, i) => {
              const isBuy = Math.random() > 0.5;
              const tradePrice = livePrice * (1 + (Math.random() * 0.002 - 0.001));
              const amount = Math.floor(Math.random() * 500000 + 1000);
              // Create a fake time descending from now
              const d = new Date(Date.now() - i * 4000);
              const timeStr = `${d.getHours().toString().padStart(2,'0')}:${d.getMinutes().toString().padStart(2,'0')}:${d.getSeconds().toString().padStart(2,'0')}`;
              
              return (
                <div key={i} className="ob-row" style={{ padding: '4px 8px' }}>
                  <span className={isBuy ? 'ob-price-bid' : 'ob-price-ask'} style={{flex: 1}}>{fmtP(tradePrice)}</span>
                  <span className="ob-amount" style={{flex: 1, textAlign: 'right'}}>{amount.toLocaleString()}</span>
                  <span className="ob-total" style={{flex: 1, textAlign: 'right'}}>{timeStr}</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* ─── Right Trading Panel ─── */}
        <div className="trade-right-panel">
          <div className="rp-tab-bar">
            <div className={`rp-tab ${true?'active':''}`}>Thủ công</div>
            <div className="rp-tab">Bot</div>
          </div>
          <div className="rp-body">
            {currentUser?.isAdmin ? (
              <div className="admin-trade-controls" style={{ padding: '20px 0' }}>
                <h3 style={{ color: '#eaecef', fontSize: '15px', marginBottom: '16px' }}>Điều khiển Biểu đồ</h3>
                
                <div style={{ marginBottom: '16px', background: '#1a1e27', padding: '12px', borderRadius: '8px' }}>
                  <h4 style={{ color: '#00FFA3', fontSize: '13px', margin: '0 0 8px 0' }}>Cược TĂNG</h4>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px' }}>
                    <span style={{ color: '#848e9c' }}>Số người: <span style={{ color: '#eaecef' }}>{tradeStats.upUsers}</span></span>
                    <span style={{ color: '#848e9c' }}>Tổng: <span style={{ color: '#00FFA3' }}>${Number(tradeStats.upAmount).toLocaleString('en-US', { minimumFractionDigits: 2 })}</span></span>
                  </div>
                </div>
                
                <div style={{ marginBottom: '24px', background: '#1a1e27', padding: '12px', borderRadius: '8px' }}>
                  <h4 style={{ color: '#F6465D', fontSize: '13px', margin: '0 0 8px 0' }}>Cược GIẢM</h4>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px' }}>
                    <span style={{ color: '#848e9c' }}>Số người: <span style={{ color: '#eaecef' }}>{tradeStats.downUsers}</span></span>
                    <span style={{ color: '#848e9c' }}>Tổng: <span style={{ color: '#F6465D' }}>${Number(tradeStats.downAmount).toLocaleString('en-US', { minimumFractionDigits: 2 })}</span></span>
                  </div>
                </div>

                <div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
                  <button 
                    onClick={() => handleSetAdminTrend('up')}
                    style={{ flex: 1, padding: '12px', background: adminTrend === 'up' ? '#00FFA3' : '#1e2329', color: adminTrend === 'up' ? '#000' : '#848e9c', border: 'none', borderRadius: '4px', fontWeight: 600, cursor: 'pointer', transition: 'all 0.2s' }}
                  >
                    TĂNG
                  </button>
                  <button 
                    onClick={() => handleSetAdminTrend('down')}
                    style={{ flex: 1, padding: '12px', background: adminTrend === 'down' ? '#F6465D' : '#1e2329', color: adminTrend === 'down' ? '#fff' : '#848e9c', border: 'none', borderRadius: '4px', fontWeight: 600, cursor: 'pointer', transition: 'all 0.2s' }}
                  >
                    GIẢM
                  </button>
                </div>
                <button 
                  onClick={() => handleSetAdminTrend('neutral')}
                  style={{ width: '100%', padding: '12px', background: adminTrend === 'neutral' ? '#eaecef' : '#1e2329', color: adminTrend === 'neutral' ? '#000' : '#848e9c', border: 'none', borderRadius: '4px', fontWeight: 600, cursor: 'pointer', transition: 'all 0.2s' }}
                >
                  NGẪU NHIÊN
                </button>
              </div>
            ) : countdownActive ? (
              <div style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '16px',
                padding: '24px 12px',
                background: countdownBetType === 'UP' ? 'rgba(0,255,163,0.06)' : 'rgba(246,70,93,0.06)',
                borderRadius: '12px',
                border: `1.5px solid ${countdownBetType === 'UP' ? 'rgba(0,255,163,0.25)' : 'rgba(246,70,93,0.25)'}`,
                boxShadow: countdownBetType === 'UP' ? '0 8px 32px rgba(0,255,163,0.08)' : '0 8px 32px rgba(246,70,93,0.08)',
                margin: '12px 0 20px 0',
              }}>
                <div style={{ position: 'relative', width: '130px', height: '130px' }}>
                  <svg width="130" height="130" style={{ transform: 'rotate(-90deg)', filter: countdownBetType === 'UP' ? 'drop-shadow(0 0 10px rgba(0,255,163,0.45))' : 'drop-shadow(0 0 10px rgba(246,70,93,0.45))' }}>
                    <circle cx="65" cy="65" r="54" fill="none" stroke="#1e2329" strokeWidth="8" />
                    <circle
                      cx="65" cy="65" r="54"
                      fill="none"
                      stroke={countdownBetType === 'UP' ? '#00FFA3' : '#F6465D'}
                      strokeWidth="8"
                      strokeLinecap="round"
                      strokeDasharray={`${2 * Math.PI * 54}`}
                      strokeDashoffset={`${2 * Math.PI * 54 * (1 - countdownLeft / countdownTotal)}`}
                      style={{ transition: 'stroke-dashoffset 0.95s linear' }}
                    />
                  </svg>
                  <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '2px' }}>
                    <span style={{ fontSize: '38px', fontWeight: '900', color: countdownBetType === 'UP' ? '#00FFA3' : '#F6465D', fontFamily: 'monospace', lineHeight: 1 }}>{countdownLeft}</span>
                    <span style={{ fontSize: '12px', color: '#848e9c', fontWeight: 'bold', letterSpacing: '1px' }}>GIÂY</span>
                  </div>
                </div>
                <div style={{ fontSize: '14px', fontWeight: '800', color: countdownBetType === 'UP' ? '#00FFA3' : '#F6465D', textTransform: 'uppercase', letterSpacing: '0.8px', textAlign: 'center' }}>
                  {countdownBetType === 'UP' ? '▲ Đang chờ kết toán TĂNG' : '▼ Đang chờ kết toán GIẢM'}
                </div>
              </div>
            ) : (
              <>
                {/* New Sub-tabs from screenshot */}
                <div className="rp-sub-tabs" style={{ display: 'flex', gap: '12px', fontSize: '11px', color: '#848e9c', marginBottom: '8px' }}>
                  <span style={{ cursor: 'pointer' }}>Giao ngay</span>
                  <span style={{ cursor: 'pointer' }}>Ký quỹ Độc lập ▾</span>
                  <span style={{ cursor: 'pointer', color: '#eaecef', borderBottom: '2px solid #eaecef', paddingBottom: '4px' }}>Alpha</span>
                  <span style={{ cursor: 'pointer' }}>Hợp đồng ▾</span>
                </div>

                <div className="rp-buy-sell">
                  <button className={`rp-bs-btn buy ${tradeTab==='buy'?'active':''}`} onClick={()=>setTradeTab('buy')}>Mua</button>
                  <button className={`rp-bs-btn sell ${tradeTab==='sell'?'active':''}`} onClick={()=>setTradeTab('sell')}>Bán</button>
                </div>

                {/* Time Expiration Selector */}
                <div className="rp-time-selector" style={{ margin: '12px 0 16px 0' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: '#848e9c', marginBottom: '8px' }}>
                    <span>Thời gian kết toán</span>
                    <span style={{ color: '#EAECEF', fontWeight: '500' }}>{binaryDuration} giây</span>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '4px' }}>
                    {[60, 120, 180, 360].map((d) => (
                      <button
                        key={d}
                        type="button"
                        onClick={() => setBinaryDuration(d)}
                        style={{
                          padding: '6px 0',
                          background: binaryDuration === d ? '#1e2329' : 'transparent',
                          border: `1px solid ${binaryDuration === d ? '#EAECEF' : '#2b3139'}`,
                          borderRadius: '4px',
                          color: binaryDuration === d ? '#EAECEF' : '#848e9c',
                          fontSize: '11px',
                          fontWeight: 'bold',
                          cursor: 'pointer',
                          transition: 'all 0.15s',
                          textAlign: 'center'
                        }}
                      >
                        {d}s
                      </button>
                    ))}
                  </div>
                </div>

                <div className="rp-order-type">
                  {['limit','market','condition'].map(t=>(
                    <button key={t} className={`rp-ot-btn ${orderType===t?'active':''}`} onClick={()=>setOrderType(t)}>
                      {t==='limit'?'Giới hạn':t==='market'?'Thị trường':'Có điều kiện'}
                    </button>
                  ))}
                </div>

                <div className="rp-input-row">
                  <div className="rp-label">
                    <span>Giá hạn</span>
                    <span style={{color:'#00FFA3'}}>Mới nhất</span>
                  </div>
                  <div className="rp-input-wrap">
                    <span className="rp-input-label-left">Giá</span>
                    <input type="text" defaultValue={fmt(livePrice, 2)} key={fmt(livePrice,2)}/>
                    <span className="rp-input-unit">USDT</span>
                  </div>
                </div>

                <div className="rp-input-row" style={{ marginBottom: '14px' }}>
                  <div className="rp-label" style={{ marginBottom: '6px' }}>
                    <span style={{ fontSize: '12px', fontWeight: 'bold' }}>Khả dụng</span>
                    <span style={{color:'#848e9c', fontSize: '12px'}}>{balance.toLocaleString('en-US', { minimumFractionDigits: 2 })} USDT</span>
                  </div>
                  <div className="rp-input-wrap" style={{ height: '52px', padding: '0 12px', borderRadius: '6px', border: '1px solid #474f59' }}>
                    <span className="rp-input-label-left" style={{ fontSize: '14px', fontWeight: 'bold', color: '#eaecef' }}>Số lượng</span>
                    <input 
                      type="number" 
                      placeholder="0.00" 
                      value={binaryAmount}
                      onChange={(e) => setBinaryAmount(e.target.value)}
                      style={{ fontSize: '22px', fontWeight: '800', color: '#00FFA3', textAlign: 'right', flex: 1, paddingRight: '8px' }}
                    />
                    <span className="rp-input-unit" style={{ fontSize: '14px', fontWeight: 'bold', color: '#eaecef' }}>{coin}</span>
                  </div>
                </div>

                <div>
                  <input 
                    type="range" 
                    className="rp-slider" 
                    min="0" 
                    max="100" 
                    value={balance > 0 ? Math.min(100, Math.max(0, Math.round((Number(binaryAmount) || 0) / balance * 100))) : 0} 
                    onChange={(e) => {
                      const pct = Number(e.target.value);
                      const amount = ((balance * pct) / 100).toFixed(2);
                      setBinaryAmount(amount);
                    }}
                  />
                  <div className="rp-pct-labels">
                    <span style={{ cursor: 'pointer' }} onClick={() => handlePercentClick(0)}>0%</span>
                    <span style={{ cursor: 'pointer' }} onClick={() => handlePercentClick(25)}>25%</span>
                    <span style={{ cursor: 'pointer' }} onClick={() => handlePercentClick(50)}>50%</span>
                    <span style={{ cursor: 'pointer' }} onClick={() => handlePercentClick(75)}>75%</span>
                    <span style={{ cursor: 'pointer' }} onClick={() => handlePercentClick(100)}>100%</span>
                  </div>
                </div>

                <button
                  className={`rp-submit-btn ${tradeTab==='sell'?'sell-btn':''}`}
                  onClick={() => handleBinaryBet(tradeTab === 'buy' ? 'UP' : 'DOWN')}
                  disabled={binaryLoading || countdownActive}
                >
                  {tradeTab === 'buy' ? `Mua ${coin}` : `Bán ${coin}`}
                </button>

                <div className="rp-info-box">
                  <svg width="14" height="14" fill="none" stroke="#848e9c" strokeWidth="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
                  <span>Lệnh sẽ kết toán sau {binaryDuration} giây</span>
                </div>
              </>
            )}
          </div>


          <div className="rp-overview" style={{ borderTop: '1px solid #1e2329', padding: '12px' }}>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
              <span style={{ fontSize: '13px', color: '#eaecef', fontWeight: '500', borderBottom: '2px solid #eaecef', paddingBottom: '4px' }}>Tổng quan</span>
              <span style={{ color: '#848e9c', cursor: 'pointer', fontSize: '14px' }}>⋮</span>
            </div>

            {/* Balance Big Display */}
            <div style={{ background: 'linear-gradient(135deg, rgba(36,219,155,0.12), rgba(0,255,163,0.06))', borderRadius: '12px', padding: '20px', marginBottom: '14px', border: '1px solid rgba(0,255,163,0.25)', boxShadow: '0 4px 20px rgba(0,255,163,0.05)' }}>
              <div style={{ fontSize: '13px', color: '#eaecef', marginBottom: '8px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontWeight: 'bold' }}>
                <span>Số dư tài khoản</span>
                <span
                  style={{ cursor: 'pointer', display: 'inline-flex', alignItems: 'center' }}
                  onClick={() => setShowBalance(!showBalance)}
                >
                  {showBalance ? (
                    <svg width="15" height="15" fill="none" stroke="#848e9c" strokeWidth="2" viewBox="0 0 24 24"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                  ) : (
                    <svg width="15" height="15" fill="none" stroke="#848e9c" strokeWidth="2" viewBox="0 0 24 24"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                  )}
                </span>
              </div>
              <div style={{ fontSize: '38px', fontWeight: '900', color: '#00FFA3', letterSpacing: '-0.5px', fontFamily: 'monospace', lineHeight: 1.1, textShadow: '0 0 12px rgba(0,255,163,0.3)' }}>
                {showBalance ? `$${balance.toLocaleString('en-US', { minimumFractionDigits: 2 })}` : '$••••••'}
              </div>
              <div style={{ fontSize: '13px', color: '#848e9c', marginTop: '8px', fontWeight: '500' }}>
                ≈ {showBalance ? (balance / (btcCoin?.price || 77000)).toFixed(6) : '••••••'} BTC
              </div>
            </div>



            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '8px 0 4px 0', fontSize: '11px', color: '#848e9c' }}>
              <span>Tài khoản Giao dịch</span>
            </div>
            
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', marginBottom: '4px' }}>
              <span style={{ color: '#eaecef' }}>BTC</span>
              <span style={{ color: '#eaecef', fontWeight: 'bold' }}>
                {showBalance ? `${(balance / (btcCoin?.price || 77000)).toFixed(6)}` : '******'} BTC
              </span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', marginBottom: '12px' }}>
              <span style={{ color: '#eaecef' }}>USDT</span>
              <span style={{ color: '#eaecef', fontWeight: 'bold' }}>
                {showBalance ? `${balance.toLocaleString('en-US', { minimumFractionDigits: 2 })}` : '******'} USDT
              </span>
            </div>

            <div style={{ fontSize: '11px', color: '#848e9c', margin: '8px 0 4px 0' }}>
              Tài khoản tài trợ
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', marginBottom: '4px' }}>
              <span style={{ color: '#eaecef' }}>BTC</span>
              <span style={{ color: '#eaecef', fontWeight: 'bold' }}>
                {showBalance ? '0.000000' : '******'} BTC
              </span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', marginBottom: '16px' }}>
              <span style={{ color: '#eaecef' }}>USDT</span>
              <span style={{ color: '#eaecef', fontWeight: 'bold' }}>
                {showBalance ? '0.00' : '******'} USDT
              </span>
            </div>

            <div style={{ display: 'flex', gap: '8px' }}>
              <button 
                type="button"
                onClick={() => setShowFastDepositModal(true)}
                style={{ 
                  flex: 1, 
                  padding: '8px 0', 
                  background: '#1e2329', 
                  color: '#eaecef', 
                  border: 'none', 
                  borderRadius: '16px', 
                  fontSize: '12px', 
                  fontWeight: '500', 
                  cursor: 'pointer', 
                  textAlign: 'center',
                  textDecoration: 'none',
                  display: 'block',
                  transition: 'background 0.2s'
                }}
                onMouseOver={(e) => e.target.style.background = '#2b3139'}
                onMouseOut={(e) => e.target.style.background = '#1e2329'}
              >
                Nạp tiền nhanh
              </button>
              <button 
                type="button"
                onClick={() => setShowTransferModal(true)}
                style={{ 
                  flex: 1, 
                  padding: '8px 0', 
                  background: '#1e2329', 
                  color: '#eaecef', 
                  border: 'none', 
                  borderRadius: '16px', 
                  fontSize: '12px', 
                  fontWeight: '500', 
                  cursor: 'pointer',
                  transition: 'background 0.2s'
                }}
                onMouseOver={(e) => e.target.style.background = '#2b3139'}
                onMouseOut={(e) => e.target.style.background = '#1e2329'}
              >
                Chuyển khoản
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* ═══════════ MOBILE VOLUME STRIP (mobile only) OR ADMIN CONTROL PANEL ═══════════ */}
      {currentUser?.isAdmin ? (
        /* Admin: 3 nút xếp dọc bên trái & thông tin đặt cược bên phải (Thay thế hoàn toàn Volume Strip ngay dưới biểu đồ) */
        <div style={{ display: 'flex', gap: '16px', alignItems: 'center', padding: '16px 12px', background: '#0f1217', borderTop: '1px solid #1e2329', height: '150px' }}>
          {/* Cột trái: 3 nút xếp dọc, to rõ ràng */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', width: '160px', flexShrink: 0 }}>
            <button
              onClick={() => handleSetAdminTrend('up')}
              style={{
                height: '36px', borderRadius: '6px', fontWeight: 700, fontSize: '14px', cursor: 'pointer', transition: 'all 0.2s',
                background: adminTrend === 'up' ? 'linear-gradient(135deg,#00C087,#00a070)' : 'rgba(0,192,135,0.12)',
                color: adminTrend === 'up' ? '#fff' : '#00C087',
                border: `1.5px solid ${adminTrend === 'up' ? '#00C087' : 'rgba(0,192,135,0.35)'}`,
                boxShadow: adminTrend === 'up' ? '0 4px 12px rgba(0,192,135,0.45)' : 'none',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px'
              }}
            >
              <span>▲ Tăng</span>
            </button>
            <button
              onClick={() => handleSetAdminTrend('down')}
              style={{
                height: '36px', borderRadius: '6px', fontWeight: 700, fontSize: '14px', cursor: 'pointer', transition: 'all 0.2s',
                background: adminTrend === 'down' ? 'linear-gradient(135deg,#F6465D,#d43a4e)' : 'rgba(246,70,93,0.12)',
                color: adminTrend === 'down' ? '#fff' : '#F6465D',
                border: `1.5px solid ${adminTrend === 'down' ? '#F6465D' : 'rgba(246,70,93,0.35)'}`,
                boxShadow: adminTrend === 'down' ? '0 4px 12px rgba(246,70,93,0.45)' : 'none',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px'
              }}
            >
              <span>▼ Giảm</span>
            </button>
            <button
              onClick={() => handleSetAdminTrend('neutral')}
              style={{
                height: '36px', borderRadius: '8px', fontWeight: 700, fontSize: '13px', cursor: 'pointer', transition: 'all 0.2s',
                background: adminTrend === 'neutral' ? 'linear-gradient(135deg,#FCD535,#e6c02e)' : 'rgba(252,213,53,0.1)',
                color: adminTrend === 'neutral' ? '#000' : '#FCD535',
                border: `1.5px solid ${adminTrend === 'neutral' ? '#FCD535' : 'rgba(252,213,53,0.3)'}`,
                boxShadow: adminTrend === 'neutral' ? '0 4px 12px rgba(252,213,53,0.3)' : 'none',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px'
              }}
            >
              <span>⟳ Ngẫu Nhiên</span>
            </button>
          </div>

          {/* Cột phải: Thông tin đặt cược */}
          <div style={{
            flex: 1, height: '100%', background: 'rgba(255,255,255,0.02)', borderRadius: '10px',
            padding: '12px 16px', border: '1px solid rgba(255,255,255,0.05)', display: 'flex',
            flexDirection: 'column', justifyContent: 'space-between'
          }}>
            <div style={{ fontSize: '12px', fontWeight: 700, color: '#848e9c', borderBottom: '1px solid rgba(255,255,255,0.06)', paddingBottom: '6px', letterSpacing: '0.5px' }}>
              📊 THỐNG KÊ ĐẶT CƯỢC THỜI GIAN THỰC ({coin}/USDT)
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '16px', flex: 1, alignItems: 'center', marginTop: '6px' }}>
              {/* UP side info */}
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <div style={{ color: '#00C087', fontWeight: 800, fontSize: '13px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <span style={{ fontSize: '8px' }}>🟢</span> MUA LÊN (UP)
                </div>
                <div style={{ fontSize: '12px', color: '#848e9c' }}>Số người: <span style={{ color: '#fff', fontWeight: '700', fontSize: '13px' }}>{tradeStats.upUsers}</span></div>
                <div style={{ fontSize: '12px', color: '#848e9c' }}>Tổng: <span style={{ color: '#00FFA3', fontWeight: '700', fontSize: '14px' }}>${Number(tradeStats.upAmount).toLocaleString('en-US', { minimumFractionDigits: 2 })}</span></div>
              </div>

              {/* Vertical Divider */}
              <div style={{ width: '1px', alignSelf: 'stretch', background: 'rgba(255,255,255,0.08)', margin: '0 6px' }} />

              {/* DOWN side info */}
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <div style={{ color: '#F6465D', fontWeight: 800, fontSize: '13px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <span style={{ fontSize: '8px' }}>🔴</span> MUA XUỐNG (DOWN)
                </div>
                <div style={{ fontSize: '12px', color: '#848e9c' }}>Số người: <span style={{ color: '#fff', fontWeight: '700', fontSize: '13px' }}>{tradeStats.downUsers}</span></div>
                <div style={{ fontSize: '12px', color: '#848e9c' }}>Tổng: <span style={{ color: '#F6465D', fontWeight: '700', fontSize: '14px' }}>${Number(tradeStats.downAmount).toLocaleString('en-US', { minimumFractionDigits: 2 })}</span></div>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="tp-m-vol-strip">
          <div className="tp-m-vol-labels">
            <span style={{color:'#848e9c'}}>VOL(5,10,20)</span>
            <span style={{color:'#00c087'}}>MA5: {(livePrice * 0.00040).toFixed(2)}M</span>
            <span style={{color:'#f0b90b'}}>MA10: {(livePrice * 0.00051).toFixed(3)}M</span>
            <span style={{color:'#e85d7a'}}>MA20: {(livePrice * 0.00038).toFixed(3)}M</span>
            <span style={{color:'#848e9c'}}>VOLUME: {(livePrice * 0.00022).toFixed(3)}M</span>
          </div>
          <div className="tp-m-vol-bars">
            {Array.from({length: 50}).map((_, i) => {
              const h = seededRand(hashStr(coin + i)) * 75 + 10;
              const isUp = seededRand(hashStr(coin + i + 500)) > 0.48;
              return (
                <div key={i} className="tp-m-vol-bar" style={{
                  height: `${h}%`,
                  background: isUp ? 'rgba(0,192,135,0.55)' : 'rgba(246,70,93,0.55)'
                }}/>
              );
            })}
          </div>
        </div>
      )}

      {/* ═══════════ BOTTOM PANEL ═══════════ */}
      {!currentUser?.isAdmin && (
        <div className="trade-bottom-panel">
          <div className="bp-tab-bar">
            {[
              {k:'binary', l:`Lịch sử đặt lệnh (${binaryBets.length})`},
            ].map(t=>(
              <div key={t.k} className={`bp-tab ${bottomTab===t.k?'active':''}`} onClick={()=>setBottomTab(t.k)}>{t.l}</div>
            ))}
          </div>
          <div className="bp-content">
            {bottomTab === 'binary' ? (
              <div style={{ width: '100%', overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', color: '#EAECEF', fontSize: '12px', textAlign: 'left', whiteSpace: 'nowrap' }}>
                  <thead>
                    <tr style={{ color: '#848e9c', borderBottom: '1px solid #2B3139' }}>
                      <th style={{ padding: '10px 16px' }}>Thời gian vào</th>
                      <th style={{ padding: '10px 16px' }}>Thời gian kết toán</th>
                      <th style={{ padding: '10px 16px' }}>Cặp giao dịch</th>
                      <th style={{ padding: '10px 16px' }}>Loại cược</th>
                      <th style={{ padding: '10px 16px' }}>Giá vào</th>
                      <th style={{ padding: '10px 16px' }}>Giá kết toán</th>
                      <th style={{ padding: '10px 16px' }}>Số tiền (USDT)</th>
                      <th style={{ padding: '10px 16px' }}>Thanh toán</th>
                      <th style={{ padding: '10px 16px' }}>Trạng thái</th>
                    </tr>
                  </thead>
                  <tbody>
                    {binaryBets.map((bet) => {
                      return (
                      <tr key={bet.Id} style={{ borderBottom: '1px solid #1e2329' }}>
                        <td style={{ padding: '10px 16px' }}>{formatDateTime(bet.StartTime)}</td>
                        <td style={{ padding: '10px 16px' }}>
                          <SettlementTimeCell
                            status={bet.Status}
                            endTime={bet.EndTime}
                            duration={bet.Duration || 60}
                            serverTimeOffset={serverTimeOffset}
                          />
                        </td>
                        <td style={{ padding: '10px 16px' }}>{bet.Symbol}</td>
                        <td style={{ padding: '10px 16px', color: bet.BetType === 'UP' ? '#00FFA3' : '#F6465D' }}>{bet.BetType}</td>
                        <td style={{ padding: '10px 16px' }}>{fmtP(bet.StartPrice)}</td>
                        <td style={{ padding: '10px 16px' }}>{bet.EndPrice ? fmtP(bet.EndPrice) : '--'}</td>
                        <td style={{ padding: '10px 16px' }}>{fmtP(bet.BetAmount)}</td>
                        <td style={{ padding: '10px 16px' }}>{bet.Payout > 0 ? `+${fmtP(bet.Payout)}` : '--'}</td>
                        <td style={{ padding: '10px 16px' }}>
                          {bet.Status === 'PENDING' ? (
                            <PendingStatusCell
                              endTime={bet.EndTime}
                              duration={bet.Duration || countdownTotal || 60}
                              serverTimeOffset={serverTimeOffset}
                            />
                          ) : (
                            <>
                              {bet.Status === 'WIN' && <span style={{ color: '#00FFA3' }}>Thắng</span>}
                              {bet.Status === 'LOSE' && <span style={{ color: '#F6465D' }}>Thua</span>}
                              {bet.Status === 'TIE' && <span style={{ color: '#EAECEF' }}>Hòa</span>}
                            </>
                          )}
                        </td>
                      </tr>
                      );
                    })}
                    {binaryBets.length === 0 && (
                      <tr>
                        <td colSpan="9" style={{ textAlign: 'center', padding: '20px', color: '#848e9c' }}>Chưa có lệnh quyền chọn nào</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            ) : (
              <>
                <svg width="40" height="40" fill="none" stroke="#5e6673" strokeWidth="1" viewBox="0 0 24 24">
                  <rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/>
                </svg>
                <span>Sổ đặt Khai dụng — JSDT</span>
              </>
            )}
          </div>
        </div>
      )}

      {/* ═══════════ MOBILE BOTTOM ACTION BAR ═══════════ */}
      {!currentUser?.isAdmin && (
        <div className="tp-m-bottom-bar">
          <button className="tp-m-wallet-btn" onClick={() => setShowFastDepositModal(true)}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="1" y="4" width="22" height="16" rx="2" ry="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>
            <span>Tiền điện tử</span>
          </button>
          <button className="tp-m-buy-up-btn" onClick={() => {
            if (!currentUser) { navigate('/login'); return; }
            setMobileTradeType('UP'); setShowMobileTradeModal(true);
          }}>Mua lên</button>
          <button className="tp-m-buy-down-btn" onClick={() => {
            if (!currentUser) { navigate('/login'); return; }
            setMobileTradeType('DOWN'); setShowMobileTradeModal(true);
          }}>Mua xuống</button>
        </div>
      )}



      {/* ═══════════ MOBILE TRADE BOTTOM SHEET MODAL ═══════════ */}
      {showMobileTradeModal && (
        <div className="tp-m-modal-overlay" onClick={() => setShowMobileTradeModal(false)}>
          <div className="tp-m-modal-sheet" onClick={(e) => e.stopPropagation()}>
            <div className="tp-m-modal-handle"/>
            <div className="tp-m-modal-header">
              <div>
                <span className="tp-m-modal-type" style={{color: mobileTradeType==='UP'?'#00C087':'#F6465D'}}>
                  {mobileTradeType === 'UP' ? '▲ Mua lên' : '▼ Mua xuống'}
                </span>
                <span className="tp-m-modal-pair">{coin}USDT</span>
              </div>
              <button className="tp-m-modal-close-btn" onClick={() => setShowMobileTradeModal(false)}>✕</button>
            </div>
            <div className="tp-m-modal-row">
              <span className="tp-m-modal-label">Giá hiện tại</span>
              <span style={{color: priceUp?'#00C087':'#F6465D', fontWeight:700}}>{fmt(livePrice,2)} USDT</span>
            </div>
            <div className="tp-m-modal-row">
              <span className="tp-m-modal-label">Khả dụng</span>
              <span style={{color:'#eaecef',fontWeight:600}}>{balance.toLocaleString('en-US',{minimumFractionDigits:2})} USDT</span>
            </div>
            <div className="tp-m-modal-section-title">Thời gian kết toán</div>
            <div className="tp-m-dur-grid">
              {[60,120,180,360].map(d => (
                <button key={d} className={`tp-m-dur-btn${binaryDuration===d?' active':''}`}
                  onClick={() => setBinaryDuration(d)}>{d}s</button>
              ))}
            </div>
            <div className="tp-m-modal-section-title">Số tiền đặt cược (USDT)</div>
            <div className="tp-m-amount-row">
              <button className="tp-m-amount-adj" onClick={() => setBinaryAmount(String(Math.max(0,(Number(binaryAmount)||0)-10).toFixed(2)))}>-</button>
              <input type="number" className="tp-m-amount-input" placeholder="0.00"
                value={binaryAmount} onChange={e => setBinaryAmount(e.target.value)}/>
              <button className="tp-m-amount-adj" onClick={() => setBinaryAmount(String(((Number(binaryAmount)||0)+10).toFixed(2)))}>+</button>
            </div>
            <div className="tp-m-pct-row">
              {[10,25,50,75,100].map(pct => (
                <button key={pct} className="tp-m-pct-btn" onClick={() => handlePercentClick(pct)}>{pct}%</button>
              ))}
            </div>
            <button
              className={`tp-m-confirm-btn${mobileTradeType==='UP'?' up':' down'}`}
              onClick={() => { handleBinaryBet(mobileTradeType); setShowMobileTradeModal(false); }}
              disabled={binaryLoading}
            >
              {binaryLoading ? 'Đang xử lý...' : (mobileTradeType==='UP' ? '▲ Xác nhận Mua lên' : '▼ Xác nhận Mua xuống')}
            </button>
          </div>
        </div>
      )}

      {/* Custom Fast Deposit Modal */}
      {showFastDepositModal && (
        <div className="tp-m-deposit-modal-overlay">
          <div style={{
            background: 'linear-gradient(135deg, #1e222d 0%, #151821 100%)',
            border: '1px solid rgba(255, 255, 255, 0.08)',
            borderRadius: '16px',
            width: '90%',
            maxWidth: '400px',
            padding: '24px',
            boxShadow: '0 8px 32px 0 rgba(0, 0, 0, 0.5)',
            color: '#eaecef',
            fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
          }}>
            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
              <h3 style={{ margin: 0, fontSize: '18px', fontWeight: '600', color: '#24DB9B', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon></svg> Nạp tiền nhanh
              </h3>
              <button 
                onClick={() => setShowFastDepositModal(false)}
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#848e9c',
                  cursor: 'pointer',
                  fontSize: '24px',
                  padding: '4px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  transition: 'color 0.2s',
                  lineHeight: '1'
                }}
                onMouseOver={(e) => e.target.style.color = '#eaecef'}
                onMouseOut={(e) => e.target.style.color = '#848e9c'}
              >
                &times;
              </button>
            </div>

            {/* Input field */}
            <div style={{ marginBottom: '16px' }}>
              <label style={{ display: 'block', fontSize: '12px', color: '#848e9c', marginBottom: '8px' }}>
                Số tiền muốn nạp (USDT)
              </label>
              <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                <input 
                  type="number"
                  placeholder="Nhập số tiền..."
                  value={fastDepositAmount}
                  onChange={(e) => setFastDepositAmount(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '12px 16px',
                    paddingRight: '60px',
                    background: '#1a1e26',
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                    borderRadius: '8px',
                    color: '#eaecef',
                    fontSize: '16px',
                    outline: 'none',
                    transition: 'border-color 0.2s'
                  }}
                  onFocus={(e) => e.target.style.borderColor = '#24DB9B'}
                  onBlur={(e) => e.target.style.borderColor = 'rgba(255, 255, 255, 0.1)'}
                />
                <span style={{
                  position: 'absolute',
                  right: '16px',
                  color: '#848e9c',
                  fontWeight: '600',
                  fontSize: '14px',
                  pointerEvents: 'none'
                }}>
                  USDT
                </span>
              </div>
            </div>

            {/* Preset Amounts */}
            <div style={{ marginBottom: '24px' }}>
              <label style={{ display: 'block', fontSize: '12px', color: '#848e9c', marginBottom: '8px' }}>
                Chọn nhanh số tiền
              </label>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px' }}>
                {[50, 100, 200, 500, 1000, 2000, 5000, 10000].map((amt) => (
                  <button
                    key={amt}
                    onClick={() => setFastDepositAmount(String(amt))}
                    style={{
                      background: '#1a1e26',
                      border: '1px solid rgba(255, 255, 255, 0.05)',
                      borderRadius: '6px',
                      padding: '8px 0',
                      color: '#eaecef',
                      fontSize: '12px',
                      cursor: 'pointer',
                      transition: 'all 0.2s',
                      fontWeight: '500'
                    }}
                    onMouseOver={(e) => {
                      e.target.style.background = 'rgba(36, 219, 155, 0.1)';
                      e.target.style.borderColor = '#24DB9B';
                      e.target.style.color = '#24DB9B';
                    }}
                    onMouseOut={(e) => {
                      e.target.style.background = '#1a1e26';
                      e.target.style.borderColor = 'rgba(255, 255, 255, 0.05)';
                      e.target.style.color = '#eaecef';
                    }}
                  >
                    {amt.toLocaleString()}
                  </button>
                ))}
              </div>
            </div>

            {/* Actions */}
            <div style={{ display: 'flex', gap: '12px' }}>
              <button
                onClick={() => setShowFastDepositModal(false)}
                style={{
                  flex: 1,
                  padding: '12px 0',
                  background: 'rgba(255, 255, 255, 0.05)',
                  border: 'none',
                  borderRadius: '8px',
                  color: '#eaecef',
                  fontSize: '14px',
                  fontWeight: '500',
                  cursor: 'pointer',
                  transition: 'background 0.2s'
                }}
                onMouseOver={(e) => e.target.style.background = 'rgba(255, 255, 255, 0.1)'}
                onMouseOut={(e) => e.target.style.background = 'rgba(255, 255, 255, 0.05)'}
              >
                Hủy bỏ
              </button>
              <button
                onClick={handleFastDepositConfirm}
                style={{
                  flex: 1,
                  padding: '12px 0',
                  background: '#24DB9B',
                  border: 'none',
                  borderRadius: '8px',
                  color: '#000',
                  fontSize: '14px',
                  fontWeight: '600',
                  cursor: 'pointer',
                  transition: 'background 0.2s'
                }}
                onMouseOver={(e) => e.target.style.background = '#1fc489'}
                onMouseOut={(e) => e.target.style.background = '#24DB9B'}
              >
                Gửi yêu cầu
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Custom Bank Transfer Modal */}
      {showTransferModal && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.75)',
          backdropFilter: 'blur(8px)',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          zIndex: 9999
        }}>
          <div style={{
            background: 'linear-gradient(135deg, #1e222d 0%, #151821 100%)',
            border: '1px solid rgba(255, 255, 255, 0.08)',
            borderRadius: '16px',
            width: '90%',
            maxWidth: '650px',
            padding: '28px',
            boxShadow: '0 8px 32px 0 rgba(0, 0, 0, 0.5)',
            color: '#eaecef',
            fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
          }}>
            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
              <h3 style={{ margin: 0, fontSize: '20px', fontWeight: '600', color: '#24DB9B', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="10" width="16" height="10" rx="2" ry="2"></rect><path d="M12 2L2 7l10 5 10-5-10-5Z"></path><path d="M12 22V12"></path></svg> Chuyển khoản ngân hàng
              </h3>
              <button 
                onClick={() => setShowTransferModal(false)}
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#848e9c',
                  cursor: 'pointer',
                  fontSize: '26px',
                  padding: '4px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  transition: 'color 0.2s',
                  lineHeight: '1'
                }}
                onMouseOver={(e) => e.target.style.color = '#eaecef'}
                onMouseOut={(e) => e.target.style.color = '#848e9c'}
              >
                &times;
              </button>
            </div>

            {/* Two Column Layout */}
            <div style={{ display: 'flex', gap: '24px', flexWrap: 'wrap', marginBottom: '24px' }}>
              {/* Left Column - Bank Info */}
              <div style={{ flex: '1 1 280px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '12px', color: '#848e9c', marginBottom: '6px' }}>
                    Tên ngân hàng
                  </label>
                  <input 
                    type="text"
                    placeholder="Ví dụ: VIETCOMBANK, TECHCOMBANK..."
                    value={transferBankName}
                    onChange={(e) => setTransferBankName(e.target.value.toUpperCase())}
                    style={{
                      width: '100%',
                      padding: '12px 16px',
                      background: '#1a1e26',
                      border: '1px solid rgba(255, 255, 255, 0.1)',
                      borderRadius: '8px',
                      color: '#eaecef',
                      fontSize: '14px',
                      outline: 'none',
                      textTransform: 'uppercase'
                    }}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '12px', color: '#848e9c', marginBottom: '6px' }}>
                    Số tài khoản
                  </label>
                  <input 
                    type="text"
                    placeholder="Nhập số tài khoản..."
                    value={transferAccountNumber}
                    onChange={(e) => setTransferAccountNumber(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '12px 16px',
                      background: '#1a1e26',
                      border: '1px solid rgba(255, 255, 255, 0.1)',
                      borderRadius: '8px',
                      color: '#eaecef',
                      fontSize: '14px',
                      outline: 'none'
                    }}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '12px', color: '#848e9c', marginBottom: '6px' }}>
                    Tên chủ tài khoản
                  </label>
                  <input 
                    type="text"
                    placeholder="Nhập tên viết hoa không dấu..."
                    value={transferAccountHolder}
                    onChange={(e) => setTransferAccountHolder(e.target.value.toUpperCase())}
                    style={{
                      width: '100%',
                      padding: '12px 16px',
                      background: '#1a1e26',
                      border: '1px solid rgba(255, 255, 255, 0.1)',
                      borderRadius: '8px',
                      color: '#eaecef',
                      fontSize: '14px',
                      outline: 'none',
                      textTransform: 'uppercase'
                    }}
                  />
                </div>
              </div>

              {/* Right Column - Note */}
              <div style={{ flex: '1 1 280px', display: 'flex', flexDirection: 'column' }}>
                <label style={{ display: 'block', fontSize: '12px', color: '#848e9c', marginBottom: '6px' }}>
                  Ghi chú
                </label>
                <textarea 
                  placeholder="Nhập ghi chú chuyển khoản..."
                  value={transferNote}
                  onChange={(e) => setTransferNote(e.target.value.toUpperCase())}
                  rows={6}
                  style={{
                    width: '100%',
                    padding: '12px 16px',
                    background: '#1a1e26',
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                    borderRadius: '8px',
                    color: '#eaecef',
                    fontSize: '14px',
                    outline: 'none',
                    resize: 'none',
                    textTransform: 'uppercase',
                    flexGrow: 1
                  }}
                />
                <div style={{
                  marginTop: '10px',
                  fontSize: '11px',
                  color: '#f6465d',
                  fontWeight: '600',
                  letterSpacing: '0.5px'
                }}>
                  ⚠️ LƯU Ý: GHI CHÚ PHẢI VIẾT HOA TOÀN BỘ
                </div>
              </div>
            </div>

            {/* Actions */}
            <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
              <button
                onClick={() => setShowTransferModal(false)}
                style={{
                  padding: '12px 24px',
                  background: 'rgba(255, 255, 255, 0.05)',
                  border: 'none',
                  borderRadius: '8px',
                  color: '#eaecef',
                  fontSize: '14px',
                  fontWeight: '500',
                  cursor: 'pointer',
                  transition: 'background 0.2s',
                  minWidth: '100px'
                }}
                onMouseOver={(e) => e.target.style.background = 'rgba(255, 255, 255, 0.1)'}
                onMouseOut={(e) => e.target.style.background = 'rgba(255, 255, 255, 0.05)'}
              >
                Hủy bỏ
              </button>
              <button
                onClick={handleTransferConfirm}
                style={{
                  padding: '12px 32px',
                  background: '#24DB9B',
                  border: 'none',
                  borderRadius: '8px',
                  color: '#000',
                  fontSize: '14px',
                  fontWeight: '600',
                  cursor: 'pointer',
                  transition: 'background 0.2s',
                  minWidth: '120px'
                }}
                onMouseOver={(e) => e.target.style.background = '#1fc489'}
                onMouseOut={(e) => e.target.style.background = '#24DB9B'}
              >
                Gửi yêu cầu
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
