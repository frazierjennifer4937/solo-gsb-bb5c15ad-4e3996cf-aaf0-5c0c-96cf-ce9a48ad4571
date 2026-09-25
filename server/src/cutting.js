'use strict';

/**
 * 断头切割 (guillotine cut) 排料算法 —— 多订单拼版 & 缺件补切
 *
 * 规则：
 *  - 坐标原点在左上角，x 向右、y 向下，单位与输入一致（通常为 mm）。
 *  - 零件按“订单输入顺序 → 订单内零件行顺序 → 数量 n 连续 n 件”展开，不做大小重排；
 *    不同订单允许使用同名零件，落位结果保留订单归属。
 *  - 每件零件允许旋转 90°；在余量相同的情况下优先不旋转。
 *  - 每件零件放入某个当前可用矩形区域的左上角，释放该零件需要：
 *      * 竖切方案：先沿零件右边竖切一刀（贯穿该区域全高），再在左侧余料上横切一刀；
 *      * 横切方案：先沿零件下边横切一刀（贯穿该区域全宽），再在上侧余料上竖切一刀。
 *    两种方案中，锯缝宽度均从“余料一侧”扣除，选择锯缝损失更小的方案，平局取竖切。
 *  - 每一刀都贯穿其所在的当前矩形区域；沿板材边缘的修整切也会被记录（缝宽可能小于
 *    标准锯缝，因为余边不足一条完整锯缝）。零件恰好占满方向时不产生该方向的刀。
 *  - 零件在所有已开板材上都放不下时才开启新板；全部板材均无法容纳的零件直接报错。
 *
 * 材料费分摊：
 *  - 输入每张原板材料价 boardPrice（非负、最多两位小数，内部按“分”整数计算）。
 *  - 每张板按“各订单在该板上的零件实际面积”比例分摊该板板价：
 *    先各订单取 floor（分），尾差按最大余数法逐分补入；余数相同按订单输入顺序。
 *  - 因此每板各订单分摊额之和严格等于该板板价，订单汇总严格等于总板价。
 *
 * 缺件补切（recutBoards）：
 *  - 以当前排料输入重新计算原方案（落位与分摊保持原样输出，不受补切影响）；
 *  - 按“订单号 + 零件名 + 件号”三元身份选择损坏件（跨订单同名零件互不影响），
 *    校验所选件存在且无重复；
 *  - 仅将所选件按原始尺寸与原输入顺序（订单 → 零件行 → 件号）合并，
 *    重排为独立的补切方案（新增板单独计费），不改动原方案任何落位；
 *  - 补切清单逐件关联原板号与新板号，并给出新增板数与新增材料费。
 */

const EPS = 1e-9;

class UserError extends Error {
  constructor(message) {
    super(message);
    this.name = 'UserError';
    this.statusCode = 400;
  }
}

function num(value, field) {
  const n = Number(value);
  if (!Number.isFinite(n)) {
    throw new UserError(`${field} 必须是数字`);
  }
  return n;
}

function positiveInt(value, field) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) {
    throw new UserError(`${field} 必须是不小于 1 的整数`);
  }
  return n;
}

/**
 * 解析每张原板材料价：非负、最多两位小数，返回整数“分”。
 */
function priceToCents(value) {
  if (value === undefined || value === null || value === '') return 0;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) {
    throw new UserError('每张原板材料价必须是非负数字，最多两位小数');
  }
  const cents = Math.round(n * 100);
  if (Math.abs(cents / 100 - n) > 1e-7) {
    throw new UserError('每张原板材料价最多保留两位小数');
  }
  return cents;
}

/**
 * 计算一次左上角落料后产生的刀路与两个余料矩形。
 * 区域 fr 左上角 (x,y)，宽 frW、高 frH；零件占位 w×h；锯缝 k。
 * verticalFirst=true 时先竖切，否则先横切。
 */
function buildSplit(fr, w, h, k, verticalFirst) {
  const { x, y, w: frW, h: frH } = fr;
  const rw = Math.max(0, frW - w);
  const rh = Math.max(0, frH - h);
  const cuts = [];
  const rects = [];

  if (verticalFirst) {
    // A：竖切，贯穿区域全高；右侧有余量才需要分离（锯缝为 0 时缝带宽度为 0，刀仍记录）
    const hasV = rw > EPS;
    const bA = hasV ? Math.min(k, rw) : 0;
    if (hasV) {
      cuts.push({
        type: 'v',
        band: { x: x + w, y, w: bA, h: frH },
      });
    }
    // B：在左侧（宽度恰好为 w 的）料块上横切；若没有竖切，则横切贯穿整板宽
    const spanW = hasV ? w : frW;
    const hasH = rh > EPS;
    const bB = hasH ? Math.min(k, rh) : 0;
    if (hasH) {
      cuts.push({
        type: 'h',
        band: { x, y: y + h, w: spanW, h: bB },
      });
    }
    // 右余料（竖切右侧，全高）
    if (rw - bA > EPS && frH > EPS) {
      rects.push({ x: x + w + bA, y, w: rw - bA, h: frH });
    }
    // 下余料（横切下方）
    if (rh - bB > EPS && spanW > EPS) {
      rects.push({ x, y: y + h + bB, w: spanW, h: rh - bB });
    }
  } else {
    // A：横切，贯穿区域全宽；下方有余量才需要分离
    const hasH = rh > EPS;
    const bA = hasH ? Math.min(k, rh) : 0;
    if (hasH) {
      cuts.push({
        type: 'h',
        band: { x, y: y + h, w: frW, h: bA },
      });
    }
    // B：在上侧（高度恰好为 h 的）料块上竖切；若没有横切，则竖切贯穿整板高
    const spanH = hasH ? h : frH;
    const hasV = rw > EPS;
    const bB = hasV ? Math.min(k, rw) : 0;
    if (hasV) {
      cuts.push({
        type: 'v',
        band: { x: x + w, y, w: bB, h: spanH },
      });
    }
    // 下余料（横切下方，全宽）
    if (rh - bA > EPS && frW > EPS) {
      rects.push({ x, y: y + h + bA, w: frW, h: rh - bA });
    }
    // 右余料（竖切右侧）
    if (rw - bB > EPS && spanH > EPS) {
      rects.push({ x: x + w + bB, y, w: rw - bB, h: spanH });
    }
  }

  const freeArea = rects.reduce((s, rect) => s + rect.w * rect.h, 0);
  return { cuts, rects, freeArea };
}

function makeBoard(width, height) {
  return {
    width,
    height,
    free: [{ x: 0, y: 0, w: width, h: height }],
    placements: [],
    cuts: [],
    partsArea: 0,
    kerfArea: 0,
    orderAreas: new Map(), // 订单号 -> 该板上该订单零件实际面积
  };
}

/**
 * 单张板的材料费分摊（最大余数法）。
 *  - priceCents：该板板价（整数分）
 *  - entries：[{ order, area, seq }]，seq 为订单输入顺序（从 0 起）
 * 返回 [{ order, area, ratio, cents }]（仅含有零件的订单，按订单输入顺序），
 * cents 之和严格等于 priceCents；余数相同时按 seq 升序补尾差。
 */
function apportionBoardCost(priceCents, entries) {
  const rows = entries
    .filter((e) => e.area > EPS)
    .sort((a, b) => a.seq - b.seq);
  const totalArea = rows.reduce((s, e) => s + e.area, 0);

  if (priceCents === 0 || rows.length === 0 || totalArea <= EPS) {
    return rows.map((e) => ({
      order: e.order,
      area: e.area,
      ratio: 0,
      cents: 0,
    }));
  }

  const exactNum = rows.map((e) => priceCents * e.area); // 精确份额 = num / totalArea
  // floor 拆分：用小容差吸收浮点误差，保证份额之和守恒
  const FEPS = 1e-9 * Math.max(1, priceCents);
  const floorVals = exactNum.map((num) => {
    const v = num / totalArea;
    const f = Math.floor(v);
    const rem = Math.max(0, v - f);
    if (rem > 1 - FEPS) return { base: f + 1, remNum: 0 };
    // 份额接近整数时余数归零（浮点误差），否则保留精确余数分子
    const remNum = rem < FEPS ? 0 : num - f * totalArea;
    return { base: Math.max(0, f), remNum: remNum < 1e-6 ? 0 : remNum };
  });
  const base = floorVals.map((x) => x.base);
  let left = priceCents - base.reduce((s, v) => s + v, 0);

  // 余数 = remNum / totalArea（分母相同，直接比较分子即可，避免除法浮点误差）。
  // 余数相同（含同余）时按订单输入顺序补尾差。
  const ranked = floorVals
    .map((x, i) => ({ i, remNum: x.remNum, seq: rows[i].seq }))
    .sort((a, b) => {
      // 余数大的排前面；remNum 与面积同量纲（mm²·分），绝对误差远小于 1 时视为同余
      if (a.remNum - b.remNum > 1e-6) return -1;
      if (b.remNum - a.remNum > 1e-6) return 1;
      return a.seq - b.seq;
    });

  const cents = base.slice();
  let k = 0;
  while (left > 0) {
    cents[ranked[k % ranked.length].i] += 1;
    left -= 1;
    k += 1;
  }

  return rows.map((e, i) => ({
    order: e.order,
    area: e.area,
    ratio: Math.round((e.area / totalArea) * 10000) / 100, // 百分比，保留两位
    cents: cents[i],
  }));
}

/**
 * 解析并校验排料输入（多订单 / 旧版单订单），返回归一化参数与展平的零件行。
 * groups：[{ order, seq(订单顺序), name, width, height, quantity }]，按输入顺序排列；
 * ordersList：[{ order, seq }]，按订单输入顺序去重。
 */
function parseInput(input) {
  if (!input || typeof input !== 'object') {
    throw new UserError('请求体格式不正确');
  }

  const boardWidth = num(input.boardWidth, '原板长度');
  const boardHeight = num(input.boardHeight, '原板宽度');
  const kerf = input.kerf === undefined || input.kerf === null || input.kerf === ''
    ? 0
    : num(input.kerf, '锯缝宽度');
  const boardPriceCents = priceToCents(input.boardPrice);

  if (boardWidth <= 0) throw new UserError('原板长度必须大于 0');
  if (boardHeight <= 0) throw new UserError('原板宽度必须大于 0');
  if (kerf < 0) throw new UserError('锯缝宽度不能为负数');

  // 归一化订单：旧版顶层 parts → 单个订单
  let rawOrders;
  if (Array.isArray(input.orders)) {
    rawOrders = input.orders;
  } else if (Array.isArray(input.parts)) {
    rawOrders = [{ orderNo: '', parts: input.parts }];
  } else {
    rawOrders = [];
  }
  if (rawOrders.length === 0) {
    throw new UserError('请至少添加一个订单');
  }
  if (rawOrders.length > 200) {
    throw new UserError('订单数量过多（最多 200 个）');
  }

  // 展平后的排料序列：[{ order, seq(订单顺序), name, width, height, quantity }]
  const groups = [];
  const ordersList = [];
  const usedOrderNos = new Set();
  let totalRows = 0;
  let totalQty = 0;

  rawOrders.forEach((o, oi) => {
    if (!o || typeof o !== 'object') {
      throw new UserError(`第 ${oi + 1} 个订单格式不正确`);
    }
    const orderNo = (o.orderNo === undefined || o.orderNo === null || String(o.orderNo).trim() === '')
      ? `订单${oi + 1}`
      : String(o.orderNo).trim();
    if (usedOrderNos.has(orderNo)) {
      throw new UserError(`订单号重复：${orderNo}`);
    }
    usedOrderNos.add(orderNo);
    ordersList.push({ order: orderNo, seq: oi });

    const rawParts = Array.isArray(o.parts) ? o.parts : [];
    if (rawParts.length === 0) {
      throw new UserError(`订单「${orderNo}」至少需要一种零件`);
    }

    const usedNames = new Set();
    rawParts.forEach((p, pi) => {
      if (!p || typeof p !== 'object') {
        throw new UserError(`订单「${orderNo}」第 ${pi + 1} 行零件格式不正确`);
      }
      const name = (p.name === undefined || p.name === null || String(p.name).trim() === '')
        ? `零件${pi + 1}`
        : String(p.name).trim();
      if (usedNames.has(name)) {
        throw new UserError(`订单「${orderNo}」内零件名称重复：${name}（不同订单允许同名）`);
      }
      usedNames.add(name);

      const w = num(p.width, `订单「${orderNo}」零件「${name}」的长度`);
      const h = num(p.height, `订单「${orderNo}」零件「${name}」的宽度`);
      const q = positiveInt(p.quantity, `订单「${orderNo}」零件「${name}」的数量`);
      if (w <= 0) throw new UserError(`订单「${orderNo}」零件「${name}」的长度必须大于 0`);
      if (h <= 0) throw new UserError(`订单「${orderNo}」零件「${name}」的宽度必须大于 0`);

      // 旋转后仍无法放入整板，直接报错
      const fitsNormal = w <= boardWidth + EPS && h <= boardHeight + EPS;
      const fitsRotated = h <= boardWidth + EPS && w <= boardHeight + EPS;
      if (!fitsNormal && !fitsRotated) {
        throw new UserError(
          `订单「${orderNo}」零件「${name}」尺寸 ${w} × ${h} 旋转后仍无法放入原板 ${boardWidth} × ${boardHeight}`
        );
      }

      totalRows += 1;
      if (totalRows > 500) {
        throw new UserError('零件行数过多（所有订单合计最多 500 行）');
      }
      totalQty += q;
      if (totalQty > 10000) {
        throw new UserError('零件总数量过多（最多 10000 件）');
      }

      groups.push({ order: orderNo, seq: oi, name, width: w, height: h, quantity: q });
    });
  });

  return {
    boardWidth,
    boardHeight,
    kerf,
    boardPriceCents,
    groups,
    ordersList,
    totalQty,
    legacy: !Array.isArray(input.orders),
  };
}

/**
 * 核心排料：按 groups 顺序（订单 → 零件行 → 数量）逐件断头切割落料。
 * 每个 group 可带 tag = { index, srcBoard }（缺件补切场景）：
 * 落位件号取 tag.index（原件号），并在落位上记录 srcBoard（原板号）。
 */
function layoutParts(boardWidth, boardHeight, kerf, groups) {
  const boards = [];

  for (const part of groups) {
    for (let q = 1; q <= part.quantity; q++) {
      const orientations = [{ w: part.width, h: part.height, rotated: false }];
      if (Math.abs(part.width - part.height) > EPS) {
        orientations.push({ w: part.height, h: part.width, rotated: true });
      }

      let best = null; // { boardIndex, freeIndex, ori, split, fr, score }

      const betterScore = (a, b) => {
        for (let idx = 0; idx < a.length; idx++) {
          if (a[idx] < b[idx] - EPS) return true;
          if (a[idx] > b[idx] + EPS) return false;
        }
        return false; // 完全相同，保留先出现的候选
      };

      for (let bi = 0; bi < boards.length; bi++) {
        const board = boards[bi];
        for (let fi = 0; fi < board.free.length; fi++) {
          const fr = board.free[fi];
          for (const ori of orientations) {
            if (ori.w > fr.w + EPS || ori.h > fr.h + EPS) continue;
            const w = Math.min(ori.w, fr.w);
            const h = Math.min(ori.h, fr.h);

            const vSplit = buildSplit(fr, w, h, kerf, true);
            const hSplit = buildSplit(fr, w, h, kerf, false);
            // 锯缝损失更小（余料面积更大）的方案优先，平局取竖切
            const split = hSplit.freeArea > vSplit.freeArea + EPS ? hSplit : vSplit;

            // 评分：最紧凑的可用区域 → 余料损失最小 → 靠上 → 靠左 → 已开板 → 不旋转
            const score = [
              fr.w * fr.h,
              -split.freeArea,
              fr.y,
              fr.x,
              bi,
              ori.rotated ? 1 : 0,
            ];
            if (!best || betterScore(score, best.score)) {
              best = { boardIndex: bi, freeIndex: fi, ori, split, fr, score };
            }
          }
        }
      }

      // 现有板材均放不下 → 开新板
      if (!best) {
        const board = makeBoard(boardWidth, boardHeight);
        boards.push(board);
        const fr = board.free[0];
        // 取能放入整板的第一个朝向（非旋转优先，正方形只有一个朝向）
        const ori0 = orientations.find((o) => o.w <= fr.w + EPS && o.h <= fr.h + EPS);
        if (!ori0) {
          // 理论上不会发生：入参校验阶段已拦截
          throw new UserError(
            `订单「${part.order}」零件「${part.name}」尺寸 ${part.width} × ${part.height} 无法放入原板 ${boardWidth} × ${boardHeight}`
          );
        }
        const w = Math.min(ori0.w, fr.w);
        const h = Math.min(ori0.h, fr.h);
        const vSplit = buildSplit(fr, w, h, kerf, true);
        const hSplit = buildSplit(fr, w, h, kerf, false);
        const split = hSplit.freeArea > vSplit.freeArea + EPS ? hSplit : vSplit;
        best = { boardIndex: boards.length - 1, freeIndex: 0, ori: ori0, split, fr };
      }

      const board = boards[best.boardIndex];
      const fr = best.fr;
      const { ori, split } = best;
      const w = Math.min(ori.w, fr.w);
      const h = Math.min(ori.h, fr.h);
      const area = w * h;

      board.placements.push({
        order: part.order,
        part: part.name,
        index: part.tag ? part.tag.index : q,
        x: fr.x,
        y: fr.y,
        w,
        h,
        rotated: ori.rotated,
        ...(part.tag && part.tag.srcBoard !== undefined ? { srcBoard: part.tag.srcBoard } : {}),
      });
      board.partsArea += area;
      board.orderAreas.set(part.order, (board.orderAreas.get(part.order) || 0) + area);
      for (const c of split.cuts) {
        board.cuts.push(c);
        board.kerfArea += c.band.w * c.band.h;
      }
      board.free.splice(best.freeIndex, 1, ...split.rects);
    }
  }

  return boards;
}

// 输出统一保留 3 位小数，0 归一
const round3 = (v) => Math.abs(v) < EPS ? 0 : Math.round(v * 1000) / 1000;

/**
 * 输出整理：逐板编号、刀路端点、面积统计与逐板材料费分摊（最大余数法），
 * 同时按订单汇总件数 / 面积 / 分摊额 / 所在板号。
 * ordersList：[{ order, seq }]，决定汇总与分摊的订单顺序。
 */
function summarizeBoards(boards, boardPriceCents, ordersList) {
  const orderSeq = new Map(ordersList.map((o) => [o.order, o.seq]));
  const orderSummary = new Map();
  ordersList.forEach((o) => {
    orderSummary.set(o.order, {
      order: o.order,
      partsArea: 0,
      partsCount: 0,
      materialCents: 0,
      boardIndices: new Set(),
    });
  });

  const resultBoards = boards.map((b, bi) => {
    const cuts = b.cuts.map((c, i) => {
      const seq = i + 1;
      const { band } = c;
      const base = { seq, type: c.type, band: { x: round3(band.x), y: round3(band.y), w: round3(band.w), h: round3(band.h) } };
      if (c.type === 'v') {
        const cx = band.x + band.w / 2;
        return { ...base, x1: round3(cx), y1: round3(band.y), x2: round3(cx), y2: round3(band.y + band.h), length: round3(band.h) };
      }
      const cy = band.y + band.h / 2;
      return { ...base, x1: round3(band.x), y1: round3(cy), x2: round3(band.x + band.w), y2: round3(cy), length: round3(band.w) };
    });

    const boardArea = b.width * b.height;
    const remainderArea = boardArea - b.partsArea - b.kerfArea;

    // 逐板按订单面积比例分摊板价（最大余数法，同余按订单输入顺序）
    const shareRows = apportionBoardCost(
      boardPriceCents,
      [...b.orderAreas.entries()].map(([order, area]) => ({
        order,
        area,
        seq: orderSeq.get(order),
      }))
    );
    const shares = shareRows.map((s) => {
      const summary = orderSummary.get(s.order);
      summary.materialCents += s.cents;
      summary.partsArea += s.area; // 使用未舍入面积，最后统一 round
      summary.boardIndices.add(bi + 1);
      return {
        order: s.order,
        area: round3(s.area),
        ratio: s.ratio,
        cents: s.cents,
      };
    });

    for (const p of b.placements) {
      orderSummary.get(p.order).partsCount += 1;
    }

    return {
      index: bi + 1,
      width: round3(b.width),
      height: round3(b.height),
      placements: b.placements.map((p) => ({
        order: p.order,
        part: p.part,
        index: p.index,
        x: round3(p.x),
        y: round3(p.y),
        w: round3(p.w),
        h: round3(p.h),
        rotated: p.rotated,
        ...(p.srcBoard !== undefined ? { srcBoard: p.srcBoard } : {}),
      })),
      cuts,
      partsArea: round3(b.partsArea),
      kerfArea: round3(b.kerfArea),
      remainderArea: round3(remainderArea),
      utilization: Math.round((b.partsArea / boardArea) * 1000) / 10,
      cost: {
        priceCents: boardPriceCents,
        shares,
      },
    };
  });

  return { resultBoards, orderSummary };
}

/**
 * 订单汇总行（按订单输入顺序）：件数、面积、分摊额（分）、所在板号（升序去重）。
 */
function orderSummaryRows(orderSummary) {
  return [...orderSummary.values()].map((s) => ({
    order: s.order,
    partsCount: s.partsCount,
    partsArea: round3(s.partsArea),
    materialCents: s.materialCents,
    boardIndices: [...s.boardIndices].sort((a, b) => a - b),
  }));
}

/**
 * 多订单拼版主入口。
 * 多订单输入：
 *   {
 *     boardWidth, boardHeight, kerf, boardPrice,
 *     orders: [{ orderNo, parts: [{ name, width, height, quantity }] }]
 *   }
 * 兼容旧版单订单输入（顶层 parts，无 orders）：整体视为一个订单。
 * 返回逐板裁切方案与按订单的取件清单 / 材料费分摊；输入不合法时抛 UserError。
 */
function cutBoards(input) {
  const parsed = parseInput(input);
  const { boardWidth, boardHeight, kerf, boardPriceCents } = parsed;

  const boards = layoutParts(boardWidth, boardHeight, kerf, parsed.groups);
  const { resultBoards, orderSummary } = summarizeBoards(boards, boardPriceCents, parsed.ordersList);

  // 分单取件清单：按订单输入顺序，件内按零件行 / 件号（即切割输入顺序）
  const pickList = [...orderSummary.values()].map((summary) => {
    const items = [];
    for (const b of resultBoards) {
      for (const p of b.placements) {
        if (p.order === summary.order) {
          items.push({
            part: p.part,
            index: p.index,
            board: b.index,
            x: p.x,
            y: p.y,
            w: p.w,
            h: p.h,
            rotated: p.rotated,
          });
        }
      }
    }
    // boards 已按板号升序遍历；同板内 placements 即落料（输入）顺序
    return { order: summary.order, items };
  });

  const orders = orderSummaryRows(orderSummary);

  const totalArea = boards.length * boardWidth * boardHeight;
  const partsArea = resultBoards.reduce((s, b) => s + b.partsArea, 0);
  const kerfArea = resultBoards.reduce((s, b) => s + b.kerfArea, 0);
  const remainderArea = totalArea - partsArea - kerfArea;
  const totalMaterialCents = boards.length * boardPriceCents;

  return {
    mode: parsed.legacy ? 'single' : 'orders',
    boardWidth: round3(boardWidth),
    boardHeight: round3(boardHeight),
    kerf: round3(kerf),
    boardPrice: round3(boardPriceCents / 100),
    boardsCount: boards.length,
    totalParts: parsed.totalQty,
    totalArea: round3(totalArea),
    partsArea: round3(partsArea),
    kerfArea: round3(kerfArea),
    remainderArea: round3(remainderArea),
    utilization: Math.round((partsArea / totalArea) * 1000) / 10,
    totalMaterialCents,
    orders,
    pickList,
    boards: resultBoards,
  };
}

/**
 * 缺件补切。
 * 输入 = 排料输入（同 cutBoards）+ damaged: [{ order, part, index }]，
 * 以“订单号 + 零件名 + 件号”三元身份标识损坏件（跨订单同名零件互不影响）。
 *
 * 流程：以当前排料输入重新计算原方案 → 校验所选件存在且无重复 →
 * 仅将所选件按原始尺寸与原输入顺序（订单 → 零件行 → 件号）合并，
 * 重排为独立的补切方案；原方案落位与材料费分摊保持不变。
 *
 * 返回 { original, recut }：
 *  - original：与 cutBoards 完全相同的原方案输出；
 *  - recut.items：补切清单，逐件关联原板号（srcBoard）与新板号（board）；
 *  - recut.addedBoards / addedMaterialCents：新增板数与新增材料费（分）；
 *  - recut.boards：补切新板的落位、刀序与逐板分摊。
 */
function recutBoards(input) {
  if (!input || typeof input !== 'object') {
    throw new UserError('请求体格式不正确');
  }
  const parsed = parseInput(input);
  const { boardWidth, boardHeight, kerf, boardPriceCents } = parsed;

  // 以当前排料输入重新计算原方案（原样输出，落位与分摊不受补切影响）
  const original = cutBoards(input);

  // ---- 校验损坏件选择 ----
  const damaged = input.damaged;
  if (!Array.isArray(damaged) || damaged.length === 0) {
    throw new UserError('请至少选择一件需要补切的损坏件');
  }
  if (damaged.length > 1000) {
    throw new UserError('单次补切件数过多（最多 1000 件）');
  }

  // 零件行索引：订单号 + 零件名 → 原始尺寸 / 数量 / 输入顺序
  const lineMap = new Map();
  parsed.groups.forEach((g, pos) => {
    lineMap.set(JSON.stringify([g.order, g.name]), {
      width: g.width,
      height: g.height,
      quantity: g.quantity,
      pos,
      orderSeq: g.seq,
    });
  });

  // 原方案落位索引：订单号 + 零件名 + 件号 → 原板号
  const placedBoard = new Map();
  for (const b of original.boards) {
    for (const p of b.placements) {
      placedBoard.set(JSON.stringify([p.order, p.part, p.index]), b.index);
    }
  }

  const seen = new Set();
  const selected = [];
  damaged.forEach((d, i) => {
    if (!d || typeof d !== 'object') {
      throw new UserError(`第 ${i + 1} 条损坏件格式不正确`);
    }
    const order = d.order === undefined || d.order === null ? '' : String(d.order).trim();
    const part = d.part === undefined || d.part === null ? '' : String(d.part).trim();
    if (!order) throw new UserError(`第 ${i + 1} 条损坏件缺少订单号`);
    if (!part) throw new UserError(`第 ${i + 1} 条损坏件缺少零件名`);
    const index = Number(d.index);
    if (!Number.isInteger(index) || index < 1) {
      throw new UserError(`损坏件「${order} / ${part}」的件号必须是不小于 1 的整数`);
    }
    const key = JSON.stringify([order, part, index]);
    if (seen.has(key)) {
      throw new UserError(`损坏件重复选择：订单「${order}」零件「${part}」第 ${index} 件`);
    }
    seen.add(key);
    const line = lineMap.get(JSON.stringify([order, part]));
    const srcBoard = placedBoard.get(key);
    if (!line || index > line.quantity || srcBoard === undefined) {
      throw new UserError(`损坏件不存在：订单「${order}」零件「${part}」第 ${index} 件`);
    }
    selected.push({
      order,
      part,
      index,
      width: line.width,
      height: line.height,
      pos: line.pos,
      orderSeq: line.orderSeq,
      srcBoard,
    });
  });

  // 按原输入顺序（订单 → 零件行 → 件号）排序后合并重排
  selected.sort((a, b) => (a.pos - b.pos) || (a.index - b.index));

  // 每件独立成行（保留三元身份：订单归属、原件号、原板号），按原始尺寸排料
  const recutGroups = selected.map((s) => ({
    order: s.order,
    seq: s.orderSeq,
    name: s.part,
    width: s.width,
    height: s.height,
    quantity: 1,
    tag: { index: s.index, srcBoard: s.srcBoard },
  }));

  const boards = layoutParts(boardWidth, boardHeight, kerf, recutGroups);

  // 补切订单汇总仅含涉及订单，顺序仍按原订单输入顺序
  const recutOrdersList = [];
  const seenOrders = new Set();
  for (const s of selected) {
    if (!seenOrders.has(s.order)) {
      seenOrders.add(s.order);
      recutOrdersList.push({ order: s.order, seq: s.orderSeq });
    }
  }
  const { resultBoards, orderSummary } = summarizeBoards(boards, boardPriceCents, recutOrdersList);

  // 补切清单：逐件关联原板号与新板号（新板号升序，同板按落料顺序）
  const items = [];
  for (const b of resultBoards) {
    for (const p of b.placements) {
      items.push({
        order: p.order,
        part: p.part,
        index: p.index,
        srcBoard: p.srcBoard,
        board: b.index,
        x: p.x,
        y: p.y,
        w: p.w,
        h: p.h,
        rotated: p.rotated,
      });
    }
  }

  const addedBoards = resultBoards.length;
  const addedMaterialCents = addedBoards * boardPriceCents;
  const totalArea = addedBoards * boardWidth * boardHeight;
  const partsArea = resultBoards.reduce((s, b) => s + b.partsArea, 0);
  const kerfArea = resultBoards.reduce((s, b) => s + b.kerfArea, 0);

  return {
    original,
    recut: {
      boardWidth: round3(boardWidth),
      boardHeight: round3(boardHeight),
      kerf: round3(kerf),
      boardPrice: round3(boardPriceCents / 100),
      damagedCount: selected.length,
      addedBoards,
      addedMaterialCents,
      partsArea: round3(partsArea),
      kerfArea: round3(kerfArea),
      remainderArea: round3(totalArea - partsArea - kerfArea),
      utilization: addedBoards ? Math.round((partsArea / totalArea) * 1000) / 10 : 0,
      items,
      orders: orderSummaryRows(orderSummary),
      boards: resultBoards,
    },
  };
}

module.exports = { cutBoards, recutBoards, UserError };
