import { useState, useEffect, useCallback } from "react";

const DEFAULT_CONFIG = {
  polygonKey: "",
  twilioSid: "",
  twilioToken: "",
  twilioFrom: "",
  twilioTo: "",
};

const DEFAULT_WATCHLIST = [
  { ticker: "ARM", name: "ARM Holdings", type: "earnings", catalyst: "Q2 Earnings", catalystDate: "2025-08-07", expectedMove: 12, thesis: "AI chip architecture royalties accelerating. Beat = spike.", alertThreshold: 2.5, scarcityAngle: null },
  { ticker: "PLTR", name: "Palantir", type: "earnings", catalyst: "Q2 Earnings", catalystDate: "2025-08-04", expectedMove: 15, thesis: "AIP commercial growth. Government contracts expanding. High short interest.", alertThreshold: 3.0, scarcityAngle: null },
  { ticker: "MU", name: "Micron Technology", type: "scarcity", catalyst: "DRAM Supply Squeeze", catalystDate: "2026-12-01", expectedMove: 20, thesis: "DRAM shortage extending to 2027-2030. Only 60% of demand met. Pricing power incoming.", alertThreshold: 2.0, scarcityAngle: "DRAM/Memory — AI data center demand outstripping supply" },
  { ticker: "FCX", name: "Freeport-McMoRan", type: "scarcity", catalyst: "Copper Deficit", catalystDate: "2026-12-31", expectedMove: 18, thesis: "330K metric ton US copper deficit. AI + military demand. Tariffs amplifying.", alertThreshold: 2.5, scarcityAngle: "Copper — AI infrastructure, EVs, military competing for supply" },
  { ticker: "LNG", name: "Cheniere Energy", type: "scarcity", catalyst: "Hormuz LNG Disruption", catalystDate: "2026-09-01", expectedMove: 14, thesis: "Strait of Hormuz disruption rerouting LNG demand to US exporters.", alertThreshold: 2.0, scarcityAngle: "Natural Gas — geopolitical squeeze benefiting US exporters" },
];

function daysUntil(dateStr) {
  return Math.ceil((new Date(dateStr) - new Date()) / (1000 * 60 * 60 * 24));
}
function urgencyColor(days) {
  if (days <= 7) return "#ff4444";
  if (days <= 30) return "#ffaa00";
  return "#44aaff";
}
function formatPct(n) {
  if (n === null || n === undefined) return "—";
  return `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
}

async function fetchPrice(ticker, apiKey) {
  if (!apiKey) return null;
  try {
    const res = await fetch(`https://api.polygon.io/v2/aggs/ticker/${ticker}/prev?adjusted=true&apiKey=${apiKey}`);
    const data = await res.json();
    if (data.results?.[0]) {
      const r = data.results[0];
      return { close: r.c, open: r.o, changePct: ((r.c - r.o) / r.o) * 100 };
    }
  } catch {}
  return null;
}

async function fetchTickerDetails(ticker, apiKey) {
  if (!apiKey) return null;
  try {
    const res = await fetch(`https://api.polygon.io/v3/reference/tickers/${ticker}?apiKey=${apiKey}`);
    const data = await res.json();
    if (data.results) {
      return { name: data.results.name || ticker };
    }
  } catch {}
  return null;
}

async function sendSMS(config, message) {
  const endpoint = "https://catalyst-sms-proxy.vercel.app/send-sms";
  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ to: config.twilioTo, message }),
    });
    return res.ok;
  } catch { return false; }
}

export default function CatalystTracker() {
  const [config, setConfig] = useState(() => {
    try {
      const saved = localStorage.getItem("catalyst_config");
      return saved ? { ...DEFAULT_CONFIG, ...JSON.parse(saved) } : DEFAULT_CONFIG;
    } catch { return DEFAULT_CONFIG; }
  });
  const [showConfig, setShowConfig] = useState(false);
  const [watchlist, setWatchlist] = useState(DEFAULT_WATCHLIST);
  const [prices, setPrices] = useState({});
  const [alertLog, setAlertLog] = useState([]);
  const [loading, setLoading] = useState({});
  const [activeTab, setActiveTab] = useState("all");
  const [showAddForm, setShowAddForm] = useState(false);
  const [newStock, setNewStock] = useState({ ticker: "", name: "", type: "earnings", catalyst: "", catalystDate: "", expectedMove: 10, thesis: "", alertThreshold: 2.0, scarcityAngle: "" });
  const [tickerLookupLoading, setTickerLookupLoading] = useState(false);
  // inline editing state: { ticker: { field: value } }
  const [editingThreshold, setEditingThreshold] = useState({});

  useEffect(() => {
    try { localStorage.setItem("catalyst_config", JSON.stringify(config)); } catch {}
  }, [config]);

  // Auto-lookup company name when ticker is typed
  const handleTickerBlur = useCallback(async () => {
    if (!newStock.ticker || !config.polygonKey) return;
    setTickerLookupLoading(true);
    const details = await fetchTickerDetails(newStock.ticker.toUpperCase(), config.polygonKey);
    const priceData = await fetchPrice(newStock.ticker.toUpperCase(), config.polygonKey);
    setNewStock(s => ({
      ...s,
      ticker: s.ticker.toUpperCase(),
      name: details?.name || s.name,
      expectedMove: priceData ? parseFloat((Math.abs(priceData.changePct) * 3).toFixed(1)) : s.expectedMove,
    }));
    setTickerLookupLoading(false);
  }, [newStock.ticker, config.polygonKey]);

  const refreshPrices = useCallback(async () => {
    if (!config.polygonKey) return;
    setLoading(Object.fromEntries(watchlist.map(s => [s.ticker, true])));
    const newPrices = {};
    for (const stock of watchlist) {
      const p = await fetchPrice(stock.ticker, config.polygonKey);
      if (p) {
        newPrices[stock.ticker] = p;
        if (Math.abs(p.changePct) >= stock.alertThreshold) {
          const msg = `⚡ ${stock.ticker} moved ${formatPct(p.changePct)} — exceeds ${stock.alertThreshold}% threshold. Catalyst: ${stock.catalyst}`;
          setAlertLog(prev => [{ id: Date.now() + Math.random(), ticker: stock.ticker, message: msg, changePct: p.changePct, time: new Date().toLocaleTimeString() }, ...prev.slice(0, 49)]);
          if (config.twilioSid) sendSMS(config, msg);
        }
      }
      setLoading(prev => ({ ...prev, [stock.ticker]: false }));
    }
    setPrices(newPrices);
  }, [config, watchlist]);

  const addStock = () => {
    if (!newStock.ticker) return;
    setWatchlist(prev => [...prev, { ...newStock, ticker: newStock.ticker.toUpperCase() }]);
    setNewStock({ ticker: "", name: "", type: "earnings", catalyst: "", catalystDate: "", expectedMove: 10, thesis: "", alertThreshold: 2.0, scarcityAngle: "" });
    setShowAddForm(false);
  };

  const updateThreshold = (ticker, value) => {
    setWatchlist(prev => prev.map(s => s.ticker === ticker ? { ...s, alertThreshold: parseFloat(value) } : s));
  };

  const inputStyle = {
    background: "#0a0a0f", border: "1px solid #1e1e2e", borderRadius: "5px",
    color: "#bbb", padding: "7px 10px", fontFamily: "inherit", fontSize: "11px",
    width: "100%", boxSizing: "border-box",
  };

  const filtered = watchlist.filter(s => activeTab === "all" || s.type === activeTab);

  return (
    <div style={{ minHeight: "100vh", background: "#06060a", color: "#bbb", fontFamily: "'Courier New', monospace", padding: 0 }}>
      <style>{`
        @keyframes slideIn { from { opacity:0; transform:translateY(-6px); } to { opacity:1; transform:translateY(0); } }
        .slide-in { animation: slideIn 0.25s ease forwards; }
        .card { transition: border-color 0.2s; }
        .card:hover { border-color: #222230 !important; }
        .del { opacity:0; transition:opacity 0.2s; }
        .card:hover .del { opacity:1; }
        ::-webkit-scrollbar { width: 3px; }
        ::-webkit-scrollbar-thumb { background: #1a1a2a; }
        .threshold-input { background: transparent; border: none; border-bottom: 1px solid #3333aa; color: #7777ff; font-family: inherit; font-size: 10px; width: 40px; text-align: center; outline: none; }
        .threshold-input:focus { border-bottom-color: #7777ff; }
      `}</style>

      {/* HEADER */}
      <div style={{ background: "#08080d", borderBottom: "1px solid #111", padding: "14px 22px", display: "flex", justifyContent: "space-between", alignItems: "center", position: "sticky", top: 0, zIndex: 100 }}>
        <div>
          <div style={{ fontSize: "20px", fontWeight: "bold", letterSpacing: "4px", color: "#fff" }}>CATALYST RADAR</div>
          <div style={{ fontSize: "9px", letterSpacing: "3px", color: "#333", marginTop: "1px" }}>EARNINGS · SCARCITY · EVENT-DRIVEN</div>
        </div>
        <div style={{ display: "flex", gap: "8px" }}>
          <button onClick={refreshPrices} style={{ padding: "6px 14px", background: "transparent", border: "1px solid #1a2a1a", borderRadius: "5px", color: "#3a8a5a", cursor: "pointer", fontSize: "10px", fontFamily: "inherit", letterSpacing: "1px" }}>↻ REFRESH</button>
          <button onClick={() => setShowConfig(c => !c)} style={{ padding: "6px 14px", background: showConfig ? "#10102a" : "transparent", border: `1px solid ${showConfig ? "#3a3aaa" : "#1a1a2a"}`, borderRadius: "5px", color: showConfig ? "#7a7aff" : "#444", cursor: "pointer", fontSize: "10px", fontFamily: "inherit", letterSpacing: "1px" }}>⚙ KEYS</button>
        </div>
      </div>

      <div style={{ padding: "18px 22px", maxWidth: "860px", margin: "0 auto" }}>

        {/* CONFIG */}
        {showConfig && (
          <div className="slide-in" style={{ background: "#0a0a14", border: "1px solid #22224a", borderRadius: "10px", padding: "18px", marginBottom: "18px" }}>
            <div style={{ fontSize: "9px", letterSpacing: "3px", color: "#444", marginBottom: "14px" }}>API CONFIGURATION</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
              {[["polygonKey","POLYGON.IO KEY","polygon.io free key"],["twilioSid","TWILIO ACCOUNT SID","twilio.com console"],["twilioToken","TWILIO AUTH TOKEN","twilio.com console"],["twilioFrom","TWILIO FROM NUMBER","+15551234567"],["twilioTo","YOUR PHONE NUMBER","+15559876543"]].map(([k,l,p]) => (
                <div key={k}>
                  <div style={{ fontSize: "9px", color: "#333", letterSpacing: "2px", marginBottom: "4px" }}>{l}</div>
                  <input type={k.includes("Token")||k.includes("Key")?"password":"text"} placeholder={p} value={config[k]} onChange={e => setConfig(c => ({ ...c, [k]: e.target.value }))} style={inputStyle} />
                </div>
              ))}
            </div>
            <div style={{ marginTop: "12px", fontSize: "10px", color: "#444", padding: "8px 12px", background: "#0d0d08", border: "1px solid #222218", borderRadius: "5px", lineHeight: "1.7" }}>
              ⚠ SMS runs through your Vercel proxy at catalyst-sms-proxy.vercel.app — credentials stay server-side.
            </div>
          </div>
        )}

        {/* STATS */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: "16px", marginBottom: "16px", padding: "12px 16px", background: "#09090e", border: "1px solid #111", borderRadius: "8px", fontSize: "10px" }}>
          {[["TRACKING",`${watchlist.length} stocks`],["EARNINGS",`${watchlist.filter(s=>s.type==="earnings").length}`],["SCARCITY",`${watchlist.filter(s=>s.type==="scarcity").length}`],["ALERTS",`${alertLog.length}`],["DATA",config.polygonKey?"● LIVE":"○ NO KEY"],["SMS",config.twilioSid?"● ARMED":"○ NOT SET"]].map(([l,v]) => (
            <div key={l}>
              <div style={{ color: "#2a2a2a", fontSize: "8px", letterSpacing: "2px" }}>{l}</div>
              <div style={{ color: v.includes("●")?"#44dd77":"#777", marginTop: "2px" }}>{v}</div>
            </div>
          ))}
        </div>

        {/* TABS */}
        <div style={{ display: "flex", gap: "6px", marginBottom: "14px" }}>
          {[["all","ALL"],["earnings","EARNINGS"],["scarcity","SCARCITY"]].map(([v,l]) => (
            <button key={v} onClick={() => setActiveTab(v)} style={{ padding: "5px 14px", background: activeTab===v?"#0f0f20":"transparent", border: `1px solid ${activeTab===v?"#3333aa":"#161616"}`, borderRadius: "4px", color: activeTab===v?"#6666ff":"#444", cursor: "pointer", fontSize: "9px", fontFamily: "inherit", letterSpacing: "2px" }}>{l}</button>
          ))}
          <button onClick={() => setShowAddForm(f => !f)} style={{ marginLeft: "auto", padding: "5px 14px", background: showAddForm?"#0a180a":"transparent", border: `1px solid ${showAddForm?"#2a5a2a":"#161616"}`, borderRadius: "4px", color: showAddForm?"#44aa44":"#333", cursor: "pointer", fontSize: "9px", fontFamily: "inherit", letterSpacing: "2px" }}>+ ADD STOCK</button>
        </div>

        {/* ADD FORM */}
        {showAddForm && (
          <div className="slide-in" style={{ background: "#09090e", border: "1px solid #1a1a2a", borderRadius: "10px", padding: "16px", marginBottom: "14px" }}>
            <div style={{ fontSize: "9px", letterSpacing: "3px", color: "#333", marginBottom: "12px" }}>NEW CATALYST</div>

            {/* Ticker with autofill */}
            <div style={{ marginBottom: "10px" }}>
              <div style={{ fontSize: "8px", color: "#2a2a2a", letterSpacing: "2px", marginBottom: "3px" }}>
                TICKER {tickerLookupLoading && <span style={{ color: "#7777ff" }}>— looking up…</span>}
                {!config.polygonKey && <span style={{ color: "#666" }}> — add Polygon key for autofill</span>}
              </div>
              <input
                placeholder="e.g. NVDA"
                value={newStock.ticker}
                onChange={e => setNewStock(s => ({ ...s, ticker: e.target.value.toUpperCase() }))}
                onBlur={handleTickerBlur}
                style={{ ...inputStyle, width: "120px", textTransform: "uppercase" }}
              />
              {newStock.name && <span style={{ marginLeft: "10px", fontSize: "11px", color: "#44aa77" }}>✓ {newStock.name}</span>}
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "8px", marginBottom: "8px" }}>
              {[["name","COMPANY NAME","Auto-filled from ticker"],["catalyst","CATALYST EVENT","Q2 Earnings"]].map(([k,l,p]) => (
                <div key={k}>
                  <div style={{ fontSize: "8px", color: "#2a2a2a", letterSpacing: "2px", marginBottom: "3px" }}>{l}</div>
                  <input placeholder={p} value={newStock[k]} onChange={e => setNewStock(s => ({ ...s, [k]: e.target.value }))} style={inputStyle} />
                </div>
              ))}
              <div>
                <div style={{ fontSize: "8px", color: "#2a2a2a", letterSpacing: "2px", marginBottom: "3px" }}>TYPE</div>
                <select value={newStock.type} onChange={e => setNewStock(s => ({ ...s, type: e.target.value }))} style={inputStyle}>
                  <option value="earnings">Earnings</option>
                  <option value="scarcity">Scarcity</option>
                </select>
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "8px", marginBottom: "8px" }}>
              <div>
                <div style={{ fontSize: "8px", color: "#2a2a2a", letterSpacing: "2px", marginBottom: "3px" }}>CATALYST DATE</div>
                <input type="date" value={newStock.catalystDate} onChange={e => setNewStock(s => ({ ...s, catalystDate: e.target.value }))} style={inputStyle} />
              </div>
              <div>
                <div style={{ fontSize: "8px", color: "#2a2a2a", letterSpacing: "2px", marginBottom: "3px" }}>EXP MOVE % <span style={{ color: "#333" }}>(auto-estimated)</span></div>
                <input type="number" placeholder="10" step="0.1" value={newStock.expectedMove} onChange={e => setNewStock(s => ({ ...s, expectedMove: parseFloat(e.target.value) }))} style={inputStyle} />
              </div>
              <div>
                <div style={{ fontSize: "8px", color: "#2a2a2a", letterSpacing: "2px", marginBottom: "3px" }}>ALERT AT %</div>
                <input type="number" placeholder="2.0" step="0.1" value={newStock.alertThreshold} onChange={e => setNewStock(s => ({ ...s, alertThreshold: parseFloat(e.target.value) }))} style={inputStyle} />
              </div>
            </div>

            <div style={{ marginBottom: "10px" }}>
              <div style={{ fontSize: "8px", color: "#2a2a2a", letterSpacing: "2px", marginBottom: "3px" }}>YOUR THESIS</div>
              <input placeholder="Why will this move?" value={newStock.thesis} onChange={e => setNewStock(s => ({ ...s, thesis: e.target.value }))} style={inputStyle} />
            </div>
            <button onClick={addStock} style={{ padding: "7px 18px", background: "#0a180a", border: "1px solid #2a5a2a", borderRadius: "5px", color: "#44aa44", cursor: "pointer", fontSize: "10px", fontFamily: "inherit", letterSpacing: "2px" }}>ADD TO WATCHLIST</button>
          </div>
        )}

        {/* CARDS */}
        <div style={{ display: "flex", flexDirection: "column", gap: "8px", marginBottom: "20px" }}>
          {filtered.map(stock => {
            const price = prices[stock.ticker];
            const days = daysUntil(stock.catalystDate);
            const isEditingThreshold = editingThreshold[stock.ticker];

            return (
              <div key={stock.ticker} className="card" style={{ background: "#09090e", border: "1px solid #131320", borderRadius: "10px", padding: "14px 16px", position: "relative" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "5px", flexWrap: "wrap" }}>
                      <span style={{ fontSize: "18px", fontWeight: "bold", letterSpacing: "2px", color: "#fff" }}>{stock.ticker}</span>
                      <span style={{ fontSize: "10px", color: "#444" }}>{stock.name}</span>
                      <span style={{ fontSize: "8px", letterSpacing: "2px", padding: "2px 7px", background: stock.type==="earnings"?"#18180a":"#0a1018", border: `1px solid ${stock.type==="earnings"?"#383818":"#182030"}`, borderRadius: "10px", color: stock.type==="earnings"?"#aaaa44":"#4488aa" }}>{stock.type.toUpperCase()}</span>
                    </div>
                    <div style={{ fontSize: "11px", color: "#555", marginBottom: "8px", lineHeight: "1.5", maxWidth: "560px" }}>{stock.thesis}</div>
                    {stock.scarcityAngle && (
                      <div style={{ fontSize: "9px", color: "#446688", background: "#0a1018", border: "1px solid #162030", borderRadius: "4px", padding: "3px 8px", display: "inline-block", marginBottom: "8px" }}>⬡ {stock.scarcityAngle}</div>
                    )}
                    <div style={{ display: "flex", flexWrap: "wrap", gap: "16px", fontSize: "10px", alignItems: "center" }}>
                      <span><span style={{ color: "#2a2a2a" }}>CATALYST </span><span style={{ color: "#777" }}>{stock.catalyst}</span></span>
                      <span><span style={{ color: "#2a2a2a" }}>DATE </span><span style={{ color: urgencyColor(days) }}>{stock.catalystDate} ({days > 0 ? `${days}d` : "PAST"})</span></span>
                      <span><span style={{ color: "#2a2a2a" }}>EXP </span><span style={{ color: "#ffaa44" }}>±{stock.expectedMove}%</span></span>
                      {/* INLINE EDITABLE THRESHOLD */}
                      <span style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                        <span style={{ color: "#2a2a2a" }}>ALERT </span>
                        {isEditingThreshold ? (
                          <input
                            className="threshold-input"
                            type="number"
                            step="0.1"
                            value={stock.alertThreshold}
                            onChange={e => updateThreshold(stock.ticker, e.target.value)}
                            onBlur={() => setEditingThreshold(prev => ({ ...prev, [stock.ticker]: false }))}
                            autoFocus
                          />
                        ) : (
                          <span
                            style={{ color: "#7777ff", cursor: "pointer", borderBottom: "1px dashed #3333aa" }}
                            onClick={() => setEditingThreshold(prev => ({ ...prev, [stock.ticker]: true }))}
                            title="Click to edit"
                          >{stock.alertThreshold}%</span>
                        )}
                        <span style={{ color: "#1a1a1a", fontSize: "8px" }}>✎</span>
                      </span>
                    </div>
                  </div>

                  {/* PRICE */}
                  <div style={{ textAlign: "right", minWidth: "90px", paddingLeft: "14px" }}>
                    {loading[stock.ticker] ? (
                      <div style={{ fontSize: "10px", color: "#222" }}>loading…</div>
                    ) : price ? (
                      <>
                        <div style={{ fontSize: "20px", fontWeight: "500", color: "#fff" }}>${price.close.toFixed(2)}</div>
                        <div style={{ fontSize: "11px", color: price.changePct >= 0 ? "#44dd77" : "#ff4444", marginTop: "2px" }}>{formatPct(price.changePct)}</div>
                        <div style={{ fontSize: "8px", color: "#222", marginTop: "3px" }}>PREV CLOSE</div>
                      </>
                    ) : (
                      <div style={{ fontSize: "9px", color: "#1e1e1e", lineHeight: "1.6" }}>add API key<br />for live price</div>
                    )}
                  </div>
                </div>
                <button className="del" onClick={() => setWatchlist(w => w.filter(s => s.ticker !== stock.ticker))} style={{ position: "absolute", top: "8px", right: "8px", background: "transparent", border: "none", color: "#2a2a2a", cursor: "pointer", fontSize: "16px", lineHeight: 1 }}>×</button>
              </div>
            );
          })}
        </div>

        {/* ALERT LOG */}
        <div style={{ background: "#08080d", border: "1px solid #111", borderRadius: "10px", overflow: "hidden", marginBottom: "18px" }}>
          <div style={{ padding: "10px 16px", borderBottom: "1px solid #0e0e0e", display: "flex", justifyContent: "space-between" }}>
            <span style={{ fontSize: "9px", letterSpacing: "3px", color: "#2a2a2a" }}>ALERT HISTORY</span>
            {alertLog.length > 0 && <button onClick={() => setAlertLog([])} style={{ background: "transparent", border: "none", color: "#2a2a2a", cursor: "pointer", fontSize: "9px", fontFamily: "inherit", letterSpacing: "1px" }}>CLEAR</button>}
          </div>
          <div style={{ maxHeight: "160px", overflowY: "auto" }}>
            {alertLog.length === 0 ? (
              <div style={{ padding: "18px", textAlign: "center", color: "#1a1a1a", fontSize: "10px", letterSpacing: "2px" }}>NO ALERTS YET · HIT REFRESH TO CHECK THRESHOLDS</div>
            ) : alertLog.map(a => (
              <div key={a.id} style={{ padding: "9px 16px", borderBottom: "1px solid #0d0d0d", display: "flex", gap: "12px", alignItems: "center", fontSize: "10px" }}>
                <span style={{ color: "#2a2a2a", minWidth: "60px" }}>{a.time}</span>
                <span style={{ color: "#ffaa33", fontWeight: "bold", minWidth: "40px" }}>{a.ticker}</span>
                <span style={{ color: "#444", flex: 1 }}>{a.message}</span>
                <span style={{ color: a.changePct >= 0 ? "#44dd77" : "#ff4444" }}>{formatPct(a.changePct)}</span>
              </div>
            ))}
          </div>
        </div>

        <div style={{ marginTop: "12px", fontSize: "8px", color: "#141414", letterSpacing: "1px", textAlign: "center" }}>
          FOR EDUCATIONAL PURPOSES ONLY · NOT FINANCIAL ADVICE · YOUR CAPITAL IS AT RISK
        </div>
      </div>
    </div>
  );
}
