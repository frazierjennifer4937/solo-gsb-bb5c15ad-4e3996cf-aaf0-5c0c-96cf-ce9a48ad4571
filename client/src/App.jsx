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

// 三元身份键：订单号 + 零件名 + 件号（跨订单同名零件以此区分）
const pieceKey = (order, part, index) => `${order}⟂${part}⟂${index}`;

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
  // 缺件补切：勾选的损坏件（三元身份键集合）与补切结果
  const [damaged, setDamaged] = useState(() => new Set());
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

  const loadSample = () => {
    setBoardWidth(String(SAMPLE_BOARD.boardWidth));
    setBoardHeight(String(SAMPLE_BOARD.boardHeight));
    setKerf(String(SAMPLE_BOARD.kerf));
    setBoardPrice(String(SAMPLE_BOARD.boardPrice));
    setOrders(SAMPLE_ORDERS.map((o) => ({ orderNo: o.orderNo, parts: o.parts.map((p) => ({ ...p })) })));
    setResult(null);
    setError('');
    setDamaged(new Set());
    setRecut(null);
    setRecutError('');
  };

  // 当前排料输入（排料与补切共用同一份请求体）
  const buildPayload = () => ({
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
    setLoading(true);
    setDamaged(new Set());
    setRecut(null);
    setRecutError('');
    try {
      const res = await fetch('/api/cut', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildPayload()),
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
  const toggleDamaged = (order, it) => {
    const key = pieceKey(order, it.part, it.index);
    setDamaged((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const submitRecut = async () => {
    if (!result || damaged.size === 0) return;
    // 按三元身份从当前取件清单还原所选件（避免解析键串）
    const selected = [];
    for (const pl of result.pickList) {
      for (const it of pl.items) {
        if (damaged.has(pieceKey(pl.order, it.part, it.index))) {
          selected.push({ order: pl.order, part: it.part, index: it.index });
        }
      }
    }
    setRecutError('');
    setRecut(null);
    setRecutLoading(true);
    try {
      const res = await fetch('/api/recut', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...buildPayload(), recut: selected }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setRecutError(data.error || '补切计算失败，请检查输入');
      } else {
        setRecut(data.result);
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
        <p>多张订单混合拼版：按订单与零件行顺序断头切割，结果保留订单归属，按单取件并分摊材料费；损坏件可勾选后一键生成独立补切方案</p>
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
              <b>不同订单允许使用同名零件</b>（系统按“订单号 + 零件名”区分）。
              严格按订单顺序、订单内零件行顺序切割，不做大小重排。
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
                <li>取件清单中勾选损坏件，可一键生成独立补切方案（原方案不变）</li>
              </ul>
            </div>
          )}

          {result && (
            <ResultView
              result={result}
              damaged={damaged}
              onToggleDamaged={toggleDamaged}
              onRecut={submitRecut}
              recut={recut}
              recutError={recutError}
              recutLoading={recutLoading}
            />
          )}
        </section>
      </main>

      <footer className="site-footer">
        断头切割规则：每一刀都贯穿当前所在矩形区域 · 允许零件旋转 90° · 按订单与零件行固定顺序排料 · 补切仅重排所选损坏件
      </footer>
    </div>
  );
}

function ResultView({ result, damaged, onToggleDamaged, onRecut, recut, recutError, recutLoading }) {
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
      <p className="hint">
        发现损坏件时，在「损坏」列勾选对应零件（按订单号 + 零件名 + 件号区分，跨订单同名零件互不影响），
        再点击下方按钮生成独立补切方案；原方案落位与分摊保持不变。
      </p>
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
                    <th className="damaged-col">损坏</th><th>零件件号</th><th>所在板号</th>
                    <th>位置 x,y</th><th>占位 长×宽</th><th>旋转</th>
                  </tr>
                </thead>
                <tbody>
                  {pl.items.map((it, i) => {
                    const checked = damaged.has(pieceKey(pl.order, it.part, it.index));
                    return (
                      <tr key={i}
                        className={`${i > 0 && it.board !== pl.items[i - 1].board ? 'board-start' : ''} ${checked ? 'damaged' : ''}`}>
                        <td className="damaged-col">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => onToggleDamaged(pl.order, it)}
                            aria-label={`标记订单 ${pl.order} ${it.part} 第 ${it.index} 件为损坏`}
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

      {/* 缺件补切提交栏 */}
      <div className="recut-bar">
        <span>已选损坏件 <b>{damaged.size}</b> 件</span>
        <button
          type="button"
          className="btn warn"
          onClick={onRecut}
          disabled={damaged.size === 0 || recutLoading}
        >
          {recutLoading ? '正在计算补切方案…' : '生成缺件补切方案'}
        </button>
      </div>
      {recutError && (
        <div className="alert" role="alert">
          <strong>无法补切：</strong>{recutError}
        </div>
      )}
      {recut && <RecutView recut={recut} />}

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
      <Legend boards={result.boards} />

      {/* 逐板图与刀序 */}
      {result.boards.map((b) => (
        <BoardCard
          key={b.index}
          board={b}
          boardWidth={result.boardWidth}
          boardHeight={result.boardHeight}
          title={`第 ${b.index} 张板 / 共 ${result.boardsCount} 张`}
        />
      ))}
    </>
  );
}

/** 缺件补切结果：补切清单（原板号 → 新板号）、新增板数与材料费、补切板图与刀序 */
function RecutView({ recut }) {
  return (
    <div className="recut-panel">
      <h3 className="recut-title">缺件补切方案（独立重排 · 原方案落位与分摊不变）</h3>
      <div className="stat-grid">
        <div className="stat"><b>{recut.selectedCount}</b><span>补切件数</span></div>
        <div className="stat accent"><b>{recut.boardsCount}</b><span>新增板数</span></div>
        <div className="stat accent"><b>¥{yuan(recut.totalMaterialCents)}</b><span>补切材料费</span></div>
        <div className="stat"><b>{recut.utilization}%</b><span>补切利用率</span></div>
      </div>
      <p className="hint">
        仅所选损坏件按原始尺寸与原输入顺序重排；补切新板从 1 起独立编号，
        补切材料费 = 新增板数 × 单板价 ¥{yuan(recut.boardPrice * 100)}，
        并按各订单在新板上的零件面积比例分摊（最大余数法）。
      </p>

      {/* 补切清单：逐件 原板号 → 新板号 */}
      {recut.pickList.map((pl) => (
        <div className="pick-order" key={pl.order}>
          <div className="pick-order-head">
            <span className="pick-order-name">订单 {pl.order}</span>
            <span className="pick-order-meta">{pl.items.length} 件待补切</span>
          </div>
          <table className="detail-table pick-table">
            <thead>
              <tr>
                <th>零件件号</th><th>原板号</th><th>新板号</th>
                <th>位置 x,y</th><th>占位 长×宽</th><th>旋转</th>
              </tr>
            </thead>
            <tbody>
              {pl.items.map((it, i) => (
                <tr key={i} className={i > 0 && it.newBoard !== pl.items[i - 1].newBoard ? 'board-start' : ''}>
                  <td>{it.part} #{it.index}</td>
                  <td><span className="board-num">{it.originalBoard}</span></td>
                  <td><span className="board-num new">{it.newBoard}</span></td>
                  <td>{strip(it.x)}, {strip(it.y)}</td>
                  <td>{strip(it.w)} × {strip(it.h)}</td>
                  <td>{it.rotated ? '是' : '否'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}

      {/* 补切订单材料费汇总 */}
      <table className="detail-table cost-table">
        <thead>
          <tr><th>订单号</th><th>补切件数</th><th>零件面积</th><th>新板号</th><th>补切分摊（元）</th></tr>
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
            <td>{recut.selectedCount}</td>
            <td>{fmt(recut.partsArea)}</td>
            <td>{recut.boardsCount} 张新板</td>
            <td>¥{yuan(recut.totalMaterialCents)}</td>
          </tr>
        </tbody>
      </table>

      {/* 图例 */}
      <Legend boards={recut.boards} />

      {/* 补切板图与刀序 */}
      {recut.boards.map((b) => (
        <BoardCard
          key={b.index}
          board={b}
          boardWidth={recut.boardWidth}
          boardHeight={recut.boardHeight}
          title={`补切第 ${b.index} 张板 / 共 ${recut.boardsCount} 张`}
        />
      ))}
    </div>
  );
}

/** 单张板：裁切图、面积统计、材料费分摊、零件落位与刀序明细 */
function BoardCard({ board: b, boardWidth, boardHeight, title }) {
  return (
    <div className="board-card">
      <h3>
        {title}
        <span className="board-price">板价 ¥{yuan(b.cost.priceCents)}</span>
      </h3>
      <BoardDiagram board={b} boardWidth={boardWidth} boardHeight={boardHeight} />
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
  );
}

function Legend({ boards }) {
  const seen = new Set();
  const keys = [];
  boards.forEach((b) => b.placements.forEach((p) => {
    const k = `${p.order}⟂${p.part}`;
    if (!seen.has(k)) {
      seen.add(k);
      keys.push({ order: p.order, part: p.part });
    }
  }));
  return (
    <div className="legend">
      <span><i className="sw remainder" />余料</span>
      <span><i className="sw kerf" />锯缝（虚线为刀刃，数字为下刀次序）</span>
      {keys.map(({ order, part }) => (
        <span key={`${order}⟂${part}`}>
          <i className="sw" style={{ background: partColor(part, order) }} />
          {order} · {part}
        </span>
      ))}
    </div>
  );
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
