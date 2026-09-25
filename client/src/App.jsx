import React, { useState } from 'react';
import BoardDiagram, { partColor } from './BoardDiagram.jsx';

const SAMPLE_BOARD = { boardWidth: 2440, boardHeight: 1220, kerf: 3, boardPrice: 180 };

const SAMPLE_ORDERS = [
  {
    orderNo: 'SO-1001',
    parts: [
      { name: '柜门', width: 600, height: 400, quantity: 8 },
      { name: '侧板', width: 800, height: 350, quantity: 3 },
      { name: '抽屉面', width: 500, height: 200, quantity: 6 },
    ],
  },
  {
    orderNo: 'SO-1002',
    parts: [
      { name: '柜门', width: 600, height: 400, quantity: 4 }, // 与 SO-1001 同名零件
      { name: '背板条', width: 1000, height: 120, quantity: 2 },
      { name: '层板', width: 700, height: 300, quantity: 2 },
    ],
  },
];

const EMPTY_PART = { name: '', width: '', height: '', quantity: 1 };
const emptyOrder = (i) => ({ orderNo: '', parts: [{ ...EMPTY_PART }] });

// 损坏件三元身份：订单号 + 零件名 + 件号（跨订单同名零件互不影响）
const itemKey = (order, part, index) => JSON.stringify([order, part, index]);

export default function App() {
  const [boardWidth, setBoardWidth] = useState(String(SAMPLE_BOARD.boardWidth));
  const [boardHeight, setBoardHeight] = useState(String(SAMPLE_BOARD.boardHeight));
  const [kerf, setKerf] = useState(String(SAMPLE_BOARD.kerf));
  const [boardPrice, setBoardPrice] = useState(String(SAMPLE_BOARD.boardPrice));
  const [orders, setOrders] = useState(SAMPLE_ORDERS.map((o) => ({
    orderNo: o.orderNo,
    parts: o.parts.map((p) => ({ ...p })),
  })));
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  // 缺件补切：选中的损坏件（Set of itemKey）、补切结果与状态
  const [selected, setSelected] = useState(new Set());
  const [recut, setRecut] = useState(null);
  const [recutError, setRecutError] = useState('');
  const [recutLoading, setRecutLoading] = useState(false);

  // ---- 订单 / 零件行编辑 ----
  const updateOrder = (oi, key, value) => {
    setOrders((prev) => prev.map((o, idx) => (idx === oi ? { ...o, [key]: value } : o)));
  };
  const updatePart = (oi, pi, key, value) => {
    setOrders((prev) => prev.map((o, oidx) => {
      if (oidx !== oi) return o;
      return { ...o, parts: o.parts.map((p, pidx) => (pidx === pi ? { ...p, [key]: value } : p)) };
    }));
  };
  const addOrder = () => setOrders((prev) => [...prev, emptyOrder(prev.length)]);
  const removeOrder = (oi) => setOrders((prev) => prev.filter((_, idx) => idx !== oi));
  const addPart = (oi) => {
    setOrders((prev) => prev.map((o, idx) => (
      idx === oi ? { ...o, parts: [...o.parts, { ...EMPTY_PART }] } : o
    )));
  };
  const removePart = (oi, pi) => {
    setOrders((prev) => prev.map((o, oidx) => {
      if (oidx !== oi || o.parts.length <= 1) return o;
      return { ...o, parts: o.parts.filter((_, pidx) => pidx !== pi) };
    }));
  };

  const resetRecut = () => {
    setSelected(new Set());
    setRecut(null);
    setRecutError('');
  };

  const loadSample = () => {
    setBoardWidth(String(SAMPLE_BOARD.boardWidth));
    setBoardHeight(String(SAMPLE_BOARD.boardHeight));
    setKerf(String(SAMPLE_BOARD.kerf));
    setBoardPrice(String(SAMPLE_BOARD.boardPrice));
    setOrders(SAMPLE_ORDERS.map((o) => ({ orderNo: o.orderNo, parts: o.parts.map((p) => ({ ...p })) })));
    setResult(null);
    setError('');
    resetRecut();
  };

  const currentPayload = () => ({
    boardWidth: Number(boardWidth),
    boardHeight: Number(boardHeight),
    kerf: kerf === '' ? 0 : Number(kerf),
    boardPrice: boardPrice === '' ? 0 : Number(boardPrice),
    orders: orders.map((o) => ({
      orderNo: o.orderNo,
      parts: o.parts.map((p) => ({
        name: p.name,
        width: Number(p.width),
        height: Number(p.height),
        quantity: Number(p.quantity),
      })),
    })),
  });

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setResult(null);
    resetRecut();
    setLoading(true);
    try {
      const res = await fetch('/api/cut', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(currentPayload()),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setError(data.error || '计算失败，请检查输入');
      } else {
        setResult(data.result);
      }
    } catch (err) {
      setError('无法连接排料服务，请确认后端已启动');
    } finally {
      setLoading(false);
    }
  };

  // ---- 缺件补切 ----
  const toggleDamaged = (key) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const submitRecut = async () => {
    if (!result || selected.size === 0) return;
    setRecutError('');
    setRecut(null);
    setRecutLoading(true);
    // 按分单取件清单顺序收集选中的损坏件（三元身份）
    const damaged = [];
    for (const pl of result.pickList) {
      for (const it of pl.items) {
        if (selected.has(itemKey(pl.order, it.part, it.index))) {
          damaged.push({ order: pl.order, part: it.part, index: it.index });
        }
      }
    }
    try {
      // 提交时以当前排料输入为准，后端重新计算原方案并校验所选件
      const res = await fetch('/api/recut', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...currentPayload(), damaged }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setRecutError(data.error || '补切计算失败，请检查所选损坏件');
      } else {
        setRecut(data.result.recut);
      }
    } catch (err) {
      setRecutError('无法连接排料服务，请确认后端已启动');
    } finally {
      setRecutLoading(false);
    }
  };

  return (
    <div className="page">
      <header className="site-header">
        <h1>矩形板材下料 · 多订单拼版断头切割排料</h1>
        <p>多张订单混合拼版：按订单与零件行顺序断头切割，结果保留订单归属，按单取件并分摊材料费；损坏件可勾选后生成独立补切方案</p>
      </header>

      <main className="layout">
        <section className="panel form-panel">
          <form onSubmit={submit}>
            <h2>原板参数</h2>
            <div className="grid-4">
              <label>
                原板长度
                <input type="number" step="any" min="0" value={boardWidth}
                  onChange={(e) => setBoardWidth(e.target.value)} required />
              </label>
              <label>
                原板宽度
                <input type="number" step="any" min="0" value={boardHeight}
                  onChange={(e) => setBoardHeight(e.target.value)} required />
              </label>
              <label>
                锯缝宽度
                <input type="number" step="any" min="0" value={kerf}
                  onChange={(e) => setKerf(e.target.value)} />
              </label>
              <label>
                单板材料价（元）
                <input type="number" step="0.01" min="0" value={boardPrice}
                  onChange={(e) => setBoardPrice(e.target.value)} />
              </label>
            </div>
            <p className="hint">
              长度 / 宽度单位保持一致即可（通常为 mm）；材料价非负、最多两位小数，
              每张开料板均按此价计费，再按各订单在该板的零件面积比例分摊。
            </p>

            <div className="parts-head">
              <h2>订单清单（{orders.length}）</h2>
              <button type="button" className="btn ghost" onClick={loadSample}>载入示例</button>
            </div>
            <p className="hint">
              订单号在本次任务中唯一（留空自动编号）；同一订单内零件名不可重复，
              <b>不同订单允许使用同名零件</b>。严格按订单顺序、订单内零件行顺序切割，不做大小重排。
            </p>

            <div className="orders-list">
              {orders.map((o, oi) => (
                <div className="order-card" key={oi}>
                  <div className="order-head">
                    <span className="order-badge">{oi + 1}</span>
                    <input
                      className="order-no-input"
                      type="text"
                      value={o.orderNo}
                      placeholder={`订单${oi + 1}（留空自动编号）`}
                      onChange={(e) => updateOrder(oi, 'orderNo', e.target.value)}
                    />
                    <button type="button" className="btn icon op-col" title="删除该订单"
                      onClick={() => removeOrder(oi)} disabled={orders.length <= 1}>✕</button>
                  </div>
                  <div className="part-row part-row-head">
                    <span>零件名称</span>
                    <span>长度</span>
                    <span>宽度</span>
                    <span>数量</span>
                    <span className="op-col"></span>
                  </div>
                  {o.parts.map((p, pi) => (
                    <div className="part-row" key={pi}>
                      <input value={p.name} placeholder={`零件${pi + 1}`}
                        onChange={(e) => updatePart(oi, pi, 'name', e.target.value)} />
                      <input type="number" step="any" min="0" value={p.width} required
                        onChange={(e) => updatePart(oi, pi, 'width', e.target.value)} />
                      <input type="number" step="any" min="0" value={p.height} required
                        onChange={(e) => updatePart(oi, pi, 'height', e.target.value)} />
                      <input type="number" step="1" min="1" value={p.quantity} required
                        onChange={(e) => updatePart(oi, pi, 'quantity', e.target.value)} />
                      <button type="button" className="btn icon op-col" title="删除该零件"
                        onClick={() => removePart(oi, pi)} disabled={o.parts.length <= 1}>✕</button>
                    </div>
                  ))}
                  <button type="button" className="btn ghost wide" onClick={() => addPart(oi)}>
                    ＋ 添加零件行
                  </button>
                </div>
              ))}
            </div>
            <button type="button" className="btn ghost wide" onClick={addOrder}>＋ 添加订单</button>

            <button type="submit" className="btn primary wide" disabled={loading}>
              {loading ? '正在排料…' : '生成多订单裁切方案'}
            </button>
          </form>
        </section>

        <section className="panel result-panel">
          {error && (
            <div className="alert" role="alert">
              <strong>无法排料：</strong>{error}
            </div>
          )}

          {!result && !error && (
            <div className="empty">
              <p>填写左侧订单与零件后点击「生成多订单裁切方案」。</p>
              <ul>
                <li>多个订单的零件混合拼版，按订单 / 零件行输入顺序断头切割</li>
                <li>逐板裁切图、零件落位表与刀序继续可用，色块左上角标注订单号</li>
                <li>结果按订单列出跨板件号、所在板号与坐标，方便分单取件</li>
                <li>每板材料费按订单零件面积比例分摊（最大余数法分配分位尾差）</li>
                <li>在分单取件清单勾选损坏件，可生成独立的缺件补切方案</li>
              </ul>
            </div>
          )}

          {result && (
            <>
              <ResultView result={result} selected={selected} onToggleDamaged={toggleDamaged} />
              <RecutSection
                selectedCount={selected.size}
                recut={recut}
                error={recutError}
                loading={recutLoading}
                onSubmit={submitRecut}
              />
            </>
          )}
        </section>
      </main>

      <footer className="site-footer">
        断头切割规则：每一刀都贯穿当前所在矩形区域 · 允许零件旋转 90° · 按订单与零件行固定顺序排料 · 补切仅重排所选损坏件，原方案不变
      </footer>
    </div>
  );
}

function ResultView({ result, selected, onToggleDamaged }) {
  return (
    <>
      <h2>排料结果</h2>
      <div className="stat-grid">
        <div className="stat"><b>{result.boardsCount}</b><span>用板数</span></div>
        <div className="stat"><b>{fmt(result.totalParts)}</b><span>零件总数</span></div>
        <div className="stat"><b>{fmt(result.partsArea)}</b><span>零件总面积</span></div>
        <div className="stat"><b>{fmt(result.kerfArea)}</b><span>锯缝损耗面积</span></div>
        <div className="stat accent"><b>{fmt(result.remainderArea)}</b><span>余料总面积</span></div>
        <div className="stat"><b>{result.utilization}%</b><span>总利用率</span></div>
        <div className="stat accent"><b>¥{yuan(result.totalMaterialCents)}</b><span>材料费合计（{result.orders.length} 单）</span></div>
      </div>
      <p className="hint">
        原板 {strip(result.boardWidth)} × {strip(result.boardHeight)}，
        单板材料价 ¥{yuan(result.boardPrice * 100)}；
        每板按各订单零件实际面积比例分摊，分位尾差用最大余数法（同余按订单输入顺序）。
      </p>

      {/* 分单取件 */}
      <h2 className="section-title">分单取件清单</h2>
      <p className="hint">勾选「补切」列标记损坏件（按订单号 + 零件名 + 件号区分），然后在页面底部生成补切方案。</p>
      <div className="pick-list">
        {result.pickList.map((pl) => {
          const summary = result.orders.find((o) => o.order === pl.order);
          const boards = summary ? summary.boardIndices : [];
          const crossBoard = boards.length > 1;
          return (
            <div className="pick-order" key={pl.order}>
              <div className="pick-order-head">
                <span className="pick-order-name">订单 {pl.order}</span>
                <span className="pick-order-meta">
                  {pl.items.length} 件 · 面积 {fmt(summary && summary.partsArea)} ·
                  材料费 <b>¥{yuan(summary && summary.materialCents)}</b>
                </span>
                <span className={crossBoard ? 'board-badge cross' : 'board-badge'}>
                  {crossBoard ? `跨 ${boards.length} 板：${boards.join('、')} 号` : `仅 ${boards.join('、')} 号板`}
                </span>
              </div>
              <table className="detail-table pick-table">
                <thead>
                  <tr>
                    <th className="sel-col">补切</th><th>零件件号</th><th>所在板号</th><th>位置 x,y</th>
                    <th>占位 长×宽</th><th>旋转</th>
                  </tr>
                </thead>
                <tbody>
                  {pl.items.map((it, i) => {
                    const key = itemKey(pl.order, it.part, it.index);
                    const checked = selected.has(key);
                    return (
                      <tr key={i}
                        className={`${i > 0 && it.board !== pl.items[i - 1].board ? 'board-start' : ''} ${checked ? 'row-selected' : ''}`}>
                        <td className="sel-col">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => onToggleDamaged(key)}
                            title="标记为损坏件，纳入补切"
                          />
                        </td>
                        <td>{it.part} #{it.index}</td>
                        <td><span className="board-num">{it.board}</span></td>
                        <td>{strip(it.x)}, {strip(it.y)}</td>
                        <td>{strip(it.w)} × {strip(it.h)}</td>
                        <td>{it.rotated ? '是' : '否'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          );
        })}
      </div>

      {/* 订单材料费汇总 */}
      <h2 className="section-title">订单材料费汇总</h2>
      <table className="detail-table">
        <thead>
          <tr><th>订单号</th><th>零件数</th><th>零件面积</th><th>所在板号</th><th>材料费（元）</th></tr>
        </thead>
        <tbody>
          {result.orders.map((o) => (
            <tr key={o.order}>
              <td>{o.order}</td>
              <td>{o.partsCount}</td>
              <td>{fmt(o.partsArea)}</td>
              <td>{o.boardIndices.join('、')}</td>
              <td>¥{yuan(o.materialCents)}</td>
            </tr>
          ))}
          <tr className="sum-row">
            <td>合计</td>
            <td>{result.totalParts}</td>
            <td>{fmt(result.partsArea)}</td>
            <td>{result.boardsCount} 张板</td>
            <td>¥{yuan(result.totalMaterialCents)}</td>
          </tr>
        </tbody>
      </table>

      {/* 图例 */}
      <div className="legend">
        <span><i className="sw remainder" />余料</span>
        <span><i className="sw kerf" />锯缝（虚线为刀刃，数字为下刀次序）</span>
        {legendKeys(result).map(({ order, part }) => (
          <span key={`${order}⟂${part}`}>
            <i className="sw" style={{ background: partColor(part, order) }} />
            {order} · {part}
          </span>
        ))}
      </div>

      {/* 逐板图与刀序 */}
      {result.boards.map((b) => (
        <div className="board-card" key={b.index}>
          <h3>
            第 {b.index} 张板 / 共 {result.boardsCount} 张
            <span className="board-price">板价 ¥{yuan(b.cost.priceCents)}</span>
          </h3>
          <BoardDiagram board={b} boardWidth={result.boardWidth} boardHeight={result.boardHeight} />
          <div className="board-stats">
            <span>零件 {fmt(b.partsArea)}</span>
            <span>锯缝 {fmt(b.kerfArea)}</span>
            <span>余料 {fmt(b.remainderArea)}</span>
            <span>利用率 {b.utilization}%</span>
            <span>{b.cuts.length} 刀</span>
          </div>

          {b.cost.shares.length > 0 && (
            <table className="detail-table cost-table">
              <thead>
                <tr><th>本板材料费分摊</th><th>零件面积</th><th>面积占比</th><th>分摊额（元）</th></tr>
              </thead>
              <tbody>
                {b.cost.shares.map((s) => (
                  <tr key={s.order}>
                    <td>订单 {s.order}</td>
                    <td>{fmt(s.area)}</td>
                    <td>{s.ratio}%</td>
                    <td>¥{yuan(s.cents)}</td>
                  </tr>
                ))}
                <tr className="sum-row">
                  <td>合计</td>
                  <td>{fmt(b.partsArea)}</td>
                  <td>100%</td>
                  <td>¥{yuan(b.cost.priceCents)}</td>
                </tr>
              </tbody>
            </table>
          )}

          <details>
            <summary>查看零件落位与切割次序明细</summary>
            <table className="detail-table">
              <thead>
                <tr><th>订单</th><th>零件</th><th>件号</th><th>位置 x,y</th><th>占位 长×宽</th><th>旋转</th></tr>
              </thead>
              <tbody>
                {b.placements.map((p, i) => (
                  <tr key={i}>
                    <td>{p.order}</td>
                    <td>{p.part}</td>
                    <td>#{p.index}</td>
                    <td>{strip(p.x)}, {strip(p.y)}</td>
                    <td>{strip(p.w)} × {strip(p.h)}</td>
                    <td>{p.rotated ? '是' : '否'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <table className="detail-table">
              <thead>
                <tr><th>刀序</th><th>方向</th><th>起点 x1,y1</th><th>终点 x2,y2</th><th>贯穿长度</th></tr>
              </thead>
              <tbody>
                {b.cuts.map((c) => (
                  <tr key={c.seq}>
                    <td>{c.seq}</td>
                    <td>{c.type === 'v' ? '竖切' : '横切'}</td>
                    <td>{strip(c.x1)}, {strip(c.y1)}</td>
                    <td>{strip(c.x2)}, {strip(c.y2)}</td>
                    <td>{strip(c.length)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        </div>
      ))}
    </>
  );
}

/**
 * 缺件补切区块：提交选中损坏件 → 展示补切清单（原板号 → 新板号）、
 * 新增板数与材料费、补切板图与刀序。原方案落位与分摊不受影响。
 */
function RecutSection({ selectedCount, recut, error, loading, onSubmit }) {
  return (
    <div className="recut-section">
      <h2 className="section-title">缺件补切</h2>
      <p className="hint">
        在上方「分单取件清单」勾选损坏件（按订单号 + 零件名 + 件号三元身份区分，跨订单同名零件互不影响）。
        提交时以当前排料输入重新计算原方案并校验所选件；仅所选件按原始尺寸与原输入顺序
        合并重排为独立补切方案，<b>原方案落位与材料费分摊保持不变</b>。
      </p>
      <button
        type="button"
        className="btn primary"
        disabled={selectedCount === 0 || loading}
        onClick={onSubmit}
      >
        {loading ? '正在计算补切方案…' : `生成补切方案（已选 ${selectedCount} 件）`}
      </button>

      {error && (
        <div className="alert" role="alert">
          <strong>无法补切：</strong>{error}
        </div>
      )}

      {recut && <RecutResult recut={recut} />}
    </div>
  );
}

function RecutResult({ recut }) {
  return (
    <div className="recut-result">
      <div className="stat-grid">
        <div className="stat"><b>{recut.damagedCount}</b><span>补切件数</span></div>
        <div className="stat accent"><b>{recut.addedBoards}</b><span>新增板数</span></div>
        <div className="stat accent"><b>¥{yuan(recut.addedMaterialCents)}</b><span>新增材料费</span></div>
        <div className="stat"><b>{fmt(recut.partsArea)}</b><span>补切零件面积</span></div>
        <div className="stat"><b>{recut.utilization}%</b><span>补切利用率</span></div>
      </div>

      {/* 补切清单：逐件关联原板号与新板号 */}
      <h3 className="recut-subtitle">补切清单（逐件关联原板号 → 新板号）</h3>
      <table className="detail-table">
        <thead>
          <tr>
            <th>订单</th><th>零件件号</th><th>原板号</th><th>新板号</th>
            <th>位置 x,y</th><th>占位 长×宽</th><th>旋转</th>
          </tr>
        </thead>
        <tbody>
          {recut.items.map((it, i) => (
            <tr key={i} className={i > 0 && it.board !== recut.items[i - 1].board ? 'board-start' : ''}>
              <td>{it.order}</td>
              <td>{it.part} #{it.index}</td>
              <td><span className="board-num old">{it.srcBoard}</span></td>
              <td><span className="board-num">{it.board}</span></td>
              <td>{strip(it.x)}, {strip(it.y)}</td>
              <td>{strip(it.w)} × {strip(it.h)}</td>
              <td>{it.rotated ? '是' : '否'}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* 补切材料费按订单分摊 */}
      {recut.orders.length > 0 && (
        <>
          <h3 className="recut-subtitle">补切材料费分摊</h3>
          <table className="detail-table">
            <thead>
              <tr><th>订单号</th><th>补切件数</th><th>零件面积</th><th>所在新板号</th><th>分摊（元）</th></tr>
            </thead>
            <tbody>
              {recut.orders.map((o) => (
                <tr key={o.order}>
                  <td>{o.order}</td>
                  <td>{o.partsCount}</td>
                  <td>{fmt(o.partsArea)}</td>
                  <td>{o.boardIndices.join('、')}</td>
                  <td>¥{yuan(o.materialCents)}</td>
                </tr>
              ))}
              <tr className="sum-row">
                <td>合计</td>
                <td>{recut.damagedCount}</td>
                <td>{fmt(recut.partsArea)}</td>
                <td>{recut.addedBoards} 张新板</td>
                <td>¥{yuan(recut.addedMaterialCents)}</td>
              </tr>
            </tbody>
          </table>
        </>
      )}

      {/* 补切板图与刀序 */}
      {recut.boards.map((b) => (
        <div className="board-card recut-board" key={b.index}>
          <h3>
            补切新板 第 {b.index} 张 / 共 {recut.addedBoards} 张
            <span className="board-price">板价 ¥{yuan(b.cost.priceCents)}</span>
          </h3>
          <BoardDiagram board={b} boardWidth={recut.boardWidth} boardHeight={recut.boardHeight} />
          <div className="board-stats">
            <span>零件 {fmt(b.partsArea)}</span>
            <span>锯缝 {fmt(b.kerfArea)}</span>
            <span>余料 {fmt(b.remainderArea)}</span>
            <span>利用率 {b.utilization}%</span>
            <span>{b.cuts.length} 刀</span>
          </div>

          {b.cost.shares.length > 0 && (
            <table className="detail-table cost-table">
              <thead>
                <tr><th>本板材料费分摊</th><th>零件面积</th><th>面积占比</th><th>分摊额（元）</th></tr>
              </thead>
              <tbody>
                {b.cost.shares.map((s) => (
                  <tr key={s.order}>
                    <td>订单 {s.order}</td>
                    <td>{fmt(s.area)}</td>
                    <td>{s.ratio}%</td>
                    <td>¥{yuan(s.cents)}</td>
                  </tr>
                ))}
                <tr className="sum-row">
                  <td>合计</td>
                  <td>{fmt(b.partsArea)}</td>
                  <td>100%</td>
                  <td>¥{yuan(b.cost.priceCents)}</td>
                </tr>
              </tbody>
            </table>
          )}

          <details>
            <summary>查看补切落位与切割次序明细</summary>
            <table className="detail-table">
              <thead>
                <tr><th>订单</th><th>零件</th><th>件号</th><th>原板号</th><th>位置 x,y</th><th>占位 长×宽</th><th>旋转</th></tr>
              </thead>
              <tbody>
                {b.placements.map((p, i) => (
                  <tr key={i}>
                    <td>{p.order}</td>
                    <td>{p.part}</td>
                    <td>#{p.index}</td>
                    <td>{p.srcBoard}</td>
                    <td>{strip(p.x)}, {strip(p.y)}</td>
                    <td>{strip(p.w)} × {strip(p.h)}</td>
                    <td>{p.rotated ? '是' : '否'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <table className="detail-table">
              <thead>
                <tr><th>刀序</th><th>方向</th><th>起点 x1,y1</th><th>终点 x2,y2</th><th>贯穿长度</th></tr>
              </thead>
              <tbody>
                {b.cuts.map((c) => (
                  <tr key={c.seq}>
                    <td>{c.seq}</td>
                    <td>{c.type === 'v' ? '竖切' : '横切'}</td>
                    <td>{strip(c.x1)}, {strip(c.y1)}</td>
                    <td>{strip(c.x2)}, {strip(c.y2)}</td>
                    <td>{strip(c.length)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        </div>
      ))}
    </div>
  );
}

function legendKeys(result) {
  const seen = new Set();
  const keys = [];
  result.boards.forEach((b) => b.placements.forEach((p) => {
    const k = `${p.order}⟂${p.part}`;
    if (!seen.has(k)) {
      seen.add(k);
      keys.push({ order: p.order, part: p.part });
    }
  }));
  return keys;
}

// 后端金额以整数“分”返回
function yuan(cents) {
  return (Number(cents || 0) / 100).toLocaleString('zh-CN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}
function fmt(n) {
  return Number(n).toLocaleString('zh-CN', { maximumFractionDigits: 2 });
}
function strip(n) {
  return Number(n).toLocaleString('zh-CN', { maximumFractionDigits: 3 });
}
