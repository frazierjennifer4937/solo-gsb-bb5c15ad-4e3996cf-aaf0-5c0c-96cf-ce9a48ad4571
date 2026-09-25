/* 排料算法自检：面积守恒、刀路几何、多板、旋转与报错路径 */
'use strict';
const assert = require('assert');
const { cutBoards, recutBoards, UserError } = require('./src/cutting');

// 1) 示例数据：面积守恒 + 基本字段
const r = cutBoards({
  boardWidth: 2440, boardHeight: 1220, kerf: 3,
  parts: [
    { name: '柜门', width: 600, height: 400, quantity: 4 },
    { name: '侧板', width: 800, height: 350, quantity: 3 },
    { name: '抽屉面', width: 500, height: 200, quantity: 6 },
    { name: '背板条', width: 1000, height: 120, quantity: 2 },
  ],
});
assert.ok(r.boardsCount >= 1);
for (const b of r.boards) {
  const boardArea = b.width * b.height;
  assert(Math.abs(boardArea - b.partsArea - b.kerfArea - b.remainderArea) < 0.01,
    `板 ${b.index} 面积不守恒`);
  // 零件不得超出原板
  for (const p of b.placements) {
    assert(p.x >= -1e-6 && p.y >= -1e-6, '零件起点越界');
    assert(p.x + p.w <= b.width + 1e-6 && p.y + p.h <= b.height + 1e-6, '零件越界');
  }
  // 零件两两不重叠
  const ps = b.placements;
  for (let i = 0; i < ps.length; i++) {
    for (let j = i + 1; j < ps.length; j++) {
      const a = ps[i], c = ps[j];
      const overlap = a.x < c.x + c.w - 1e-6 && c.x < a.x + a.w - 1e-6 &&
        a.y < c.y + c.h - 1e-6 && c.y < a.y + a.h - 1e-6;
      assert(!overlap, `板 ${b.index} 零件重叠：${a.part}/${c.part}`);
    }
  }
  // 刀序从 1 连续，每刀端点在板内
  b.cuts.forEach((cut, i) => {
    assert.strictEqual(cut.seq, i + 1);
    assert(cut.x1 >= -1e-6 && cut.x2 <= b.width + 1e-6);
    assert(cut.y1 >= -1e-6 && cut.y2 <= b.height + 1e-6);
  });
}
assert.strictEqual(r.totalParts, 15);
assert.strictEqual(r.boards[0].cuts.length > 0, true, '应有刀路');
console.log('用板数:', r.boardsCount, '| 余料:', r.remainderArea, '| 锯缝:', r.kerfArea, '| 利用率:', r.utilization + '%');

// 2) 零件恰好铺满：无刀、余料 0
const full = cutBoards({
  boardWidth: 1000, boardHeight: 600, kerf: 2,
  parts: [{ name: '整板', width: 1000, height: 600, quantity: 1 }],
});
assert.strictEqual(full.boardsCount, 1);
assert.strictEqual(full.boards[0].cuts.length, 0);
assert.strictEqual(full.remainderArea, 0);

// 3) 锯缝为 0：仍记录刀序，仍有余料矩形
const k0 = cutBoards({
  boardWidth: 1000, boardHeight: 500, kerf: 0,
  parts: [{ name: 'A', width: 400, height: 300, quantity: 2 }],
});
assert.ok(k0.boards[0].cuts.length >= 2, '零锯缝也应有切割刀路');
assert.strictEqual(k0.kerfArea, 0);
assert.strictEqual(k0.partsArea + k0.remainderArea, 500000);

// 4) 必须旋转才能放下
const rot = cutBoards({
  boardWidth: 500, boardHeight: 300, kerf: 0,
  parts: [{ name: '横条', width: 280, height: 400, quantity: 1 }], // 正向 280x400 放不下，旋转后 400x280 可以
});
assert.strictEqual(rot.boards[0].placements[0].rotated, true);

// 5) 旋转后仍放不下 → 报错
assert.throws(() => cutBoards({
  boardWidth: 500, boardHeight: 300, kerf: 0,
  parts: [{ name: '大块', width: 400, height: 400, quantity: 1 }],
}), UserError);

// 6) 多板：每件 600x400，板 1200x800 恰好 2x2 放 4 件，9 件需要 3 张
const multi = cutBoards({
  boardWidth: 1200, boardHeight: 800, kerf: 0,
  parts: [{ name: '块', width: 600, height: 400, quantity: 9 }],
});
assert.strictEqual(multi.boardsCount, 3);
assert.deepStrictEqual(multi.boards.map((b) => b.placements.length), [4, 4, 1]);

// 7) 锯缝计入：600x400 两件并排放在 1203 宽板上（600+3+600），宽度刚好
const kerfFit = cutBoards({
  boardWidth: 1203, boardHeight: 400, kerf: 3,
  parts: [{ name: '条', width: 600, height: 400, quantity: 2 }],
});
assert.strictEqual(kerfFit.boardsCount, 1);
assert.strictEqual(kerfFit.boards[0].cuts.length, 1); // 只有竖切一刀
assert.strictEqual(kerfFit.kerfArea, 3 * 400);

// 8) 锯缝挤压：1202 宽放不下两件 → 第二件开新板
const noFit = cutBoards({
  boardWidth: 1202, boardHeight: 400, kerf: 3,
  parts: [{ name: '条', width: 600, height: 400, quantity: 2 }],
});
assert.strictEqual(noFit.boardsCount, 2);

// 9) 输入校验
assert.throws(() => cutBoards({ boardWidth: 0, boardHeight: 10, kerf: 0, parts: [{ name: 'a', width: 1, height: 1, quantity: 1 }] }), UserError);
assert.throws(() => cutBoards({ boardWidth: 10, boardHeight: 10, kerf: -1, parts: [{ name: 'a', width: 1, height: 1, quantity: 1 }] }), UserError);
assert.throws(() => cutBoards({ boardWidth: 10, boardHeight: 10, kerf: 0, parts: [] }), UserError);
assert.throws(() => cutBoards({ boardWidth: 10, boardHeight: 10, kerf: 0, parts: [{ name: 'a', width: 5, height: 5, quantity: 0 }] }), UserError);

// 10) 多订单拼版：跨板、订单归属、同名零件允许、按输入顺序切割
const mo = cutBoards({
  boardWidth: 1200, boardHeight: 800, kerf: 0, boardPrice: 10,
  orders: [
    { orderNo: 'A', parts: [{ name: '块', width: 600, height: 400, quantity: 5 }] },
    { orderNo: 'B', parts: [{ name: '块', width: 600, height: 400, quantity: 5 }] },
  ],
});
assert.strictEqual(mo.boardsCount, 3);
assert.strictEqual(mo.mode, 'orders');
// 顺序：先 A×5 再 B×5，每板 4 件 → 板1 A×4，板2 A×1+B×3，板3 B×2
const counts = (b, order) => b.placements.filter((p) => p.order === order).length;
assert.strictEqual(counts(mo.boards[0], 'A'), 4);
assert.strictEqual(counts(mo.boards[0], 'B'), 0);
assert.strictEqual(counts(mo.boards[1], 'A'), 1);
assert.strictEqual(counts(mo.boards[1], 'B'), 3);
assert.strictEqual(counts(mo.boards[2], 'B'), 2);
assert.ok(mo.boards[1].placements[0].order === 'A', '板2 首件应为先输入的订单 A');
assert.strictEqual(mo.boards[1].placements[0].part, '块'); // 不同订单同名零件

// 逐板分摊额之和 = 板价
for (const b of mo.boards) {
  const sum = b.cost.shares.reduce((s, x) => s + x.cents, 0);
  assert.strictEqual(sum, b.cost.priceCents, `板 ${b.index} 分摊额不等于板价`);
}
// 订单汇总 = 总板价（A: 1000 + 250 = 1250；B: 750 + 1000 = 1750）
assert.strictEqual(mo.totalMaterialCents, 3000);
const sumOrders = mo.orders.reduce((s, o) => s + o.materialCents, 0);
assert.strictEqual(sumOrders, mo.totalMaterialCents, '订单汇总额不等于总板价');
const oA = mo.orders.find((o) => o.order === 'A');
const oB = mo.orders.find((o) => o.order === 'B');
assert.strictEqual(oA.materialCents, 1250);
assert.strictEqual(oB.materialCents, 1750);
assert.deepStrictEqual(oA.boardIndices, [1, 2]);
assert.deepStrictEqual(oB.boardIndices, [2, 3]);
assert.strictEqual(oA.partsCount, 5);
assert.strictEqual(oB.partsCount, 5);

// 分单取件清单：按订单列出件号 / 板号 / 坐标，板号升序且不重复
for (const pl of mo.pickList) {
  const boards = pl.items.map((it) => it.board);
  assert.deepStrictEqual(boards, [...boards].sort((a, b) => a - b), `订单 ${pl.order} 取件清单未按板号排序`);
  assert.strictEqual(pl.items.length, 5);
  for (const it of pl.items) {
    assert.ok(Number.isFinite(it.x) && Number.isFinite(it.y), '取件清单缺少坐标');
  }
}
const plA = mo.pickList.find((p) => p.order === 'A');
assert.deepStrictEqual(plA.items.map((it) => it.board), [1, 1, 1, 1, 2]);
assert.deepStrictEqual(plA.items.map((it) => it.index), [1, 2, 3, 4, 5]);

// 11) 最大余数法：同余时按订单输入顺序补尾差
const tie = cutBoards({
  boardWidth: 1000, boardHeight: 1000, kerf: 0, boardPrice: 10.01, // 1001 分
  orders: [
    { orderNo: '甲', parts: [{ name: 'a', width: 250, height: 1000, quantity: 2 }] }, // 500000
    { orderNo: '乙', parts: [{ name: 'b', width: 250, height: 1000, quantity: 2 }] }, // 500000
  ],
});
assert.strictEqual(tie.boardsCount, 1);
const tieShares = tie.boards[0].cost.shares;
assert.strictEqual(tieShares.reduce((s, x) => s + x.cents, 0), 1001);
assert.strictEqual(tieShares[0].order, '甲');
assert.strictEqual(tieShares[0].cents, 501); // 500.5 同余，输入顺序在先者得尾差
assert.strictEqual(tieShares[1].cents, 500);

// 12) 最大余数法：余数不同，大者优先
const lr = cutBoards({
  boardWidth: 1000, boardHeight: 1000, kerf: 0, boardPrice: 0.03, // 3 分
  orders: [
    { orderNo: '甲', parts: [{ name: 'a', width: 600, height: 1000, quantity: 1 }] }, // 60% → 1.8 分
    { orderNo: '乙', parts: [{ name: 'b', width: 400, height: 1000, quantity: 1 }] }, // 40% → 1.2 分
  ],
});
const lrShares = lr.boards[0].cost.shares;
assert.strictEqual(lrShares.find((x) => x.order === '甲').cents, 2);
assert.strictEqual(lrShares.find((x) => x.order === '乙').cents, 1);

// 13) 多订单输入校验
assert.throws(() => cutBoards({
  boardWidth: 1000, boardHeight: 1000,
  orders: [
    { orderNo: 'X1', parts: [{ name: 'a', width: 10, height: 10, quantity: 1 }] },
    { orderNo: 'X1', parts: [{ name: 'b', width: 10, height: 10, quantity: 1 }] },
  ],
}), UserError, '订单号重复应报错');

assert.throws(() => cutBoards({
  boardWidth: 1000, boardHeight: 1000,
  orders: [{ orderNo: 'X', parts: [
    { name: '同', width: 10, height: 10, quantity: 1 },
    { name: '同', width: 10, height: 10, quantity: 1 },
  ] }],
}), UserError, '同订单内零件同名应报错');

assert.throws(() => cutBoards({
  boardWidth: 1000, boardHeight: 1000, boardPrice: -1,
  orders: [{ orderNo: 'X', parts: [{ name: 'a', width: 10, height: 10, quantity: 1 }] }],
}), UserError, '负板价应报错');

assert.throws(() => cutBoards({
  boardWidth: 1000, boardHeight: 1000, boardPrice: 1.234,
  orders: [{ orderNo: 'X', parts: [{ name: 'a', width: 10, height: 10, quantity: 1 }] }],
}), UserError, '超过两位小数应报错');

assert.doesNotThrow(() => cutBoards({
  boardWidth: 1000, boardHeight: 1000, boardPrice: 0,
  orders: [{ orderNo: 'X', parts: [{ name: 'a', width: 10, height: 10, quantity: 1 }] }],
}), '零板价应允许');

// 无订单号 / 无零件名自动补默认值
const def = cutBoards({
  boardWidth: 1000, boardHeight: 1000,
  orders: [{ parts: [{ width: 10, height: 10, quantity: 1 }] }],
});
assert.strictEqual(def.orders[0].order, '订单1');
assert.strictEqual(def.boards[0].placements[0].part, '零件1');

// 旧版顶层 parts 仍然兼容
const legacy = cutBoards({
  boardWidth: 1000, boardHeight: 1000,
  parts: [{ name: 'a', width: 10, height: 10, quantity: 2 }],
});
assert.strictEqual(legacy.mode, 'single');
assert.strictEqual(legacy.boards[0].placements[0].order, '订单1');
assert.strictEqual(legacy.boardPrice, 0);

// 14) 缺件补切：三元身份、原板号 → 新板号、新增板数与材料费
const recutInput = {
  boardWidth: 1200, boardHeight: 800, kerf: 0, boardPrice: 10,
  orders: [
    { orderNo: 'A', parts: [{ name: '块', width: 600, height: 400, quantity: 5 }] },
    { orderNo: 'B', parts: [{ name: '块', width: 600, height: 400, quantity: 5 }] }, // 跨订单同名零件
  ],
};
// 原方案：板1 A#1-4，板2 A#5 + B#1-3，板3 B#4-5（与第 10 组用例一致）
const rc = recutBoards({
  ...recutInput,
  recut: [
    { order: 'B', part: '块', index: 4 }, // 故意乱序提交，应按原输入顺序归并
    { order: 'A', part: '块', index: 5 },
    { order: 'B', part: '块', index: 1 },
  ],
});
assert.strictEqual(rc.mode, 'recut');
assert.strictEqual(rc.selectedCount, 3);
assert.strictEqual(rc.totalParts, 3);
assert.strictEqual(rc.boardsCount, 1, '3 件 600x400 应拼进 1 张新板');
assert.strictEqual(rc.totalMaterialCents, 1000, '补切材料费 = 新增板数 × 单板价');
// 补切清单：逐件关联原板号与新板号，保留原始件号
const rcItems = rc.pickList.flatMap((pl) => pl.items.map((it) => ({ order: pl.order, ...it })));
assert.strictEqual(rcItems.length, 3);
const itemOf = (order, index) => rcItems.find((it) => it.order === order && it.index === index);
assert.deepStrictEqual(
  { originalBoard: itemOf('A', 5).originalBoard, newBoard: itemOf('A', 5).newBoard },
  { originalBoard: 2, newBoard: 1 }
);
assert.strictEqual(itemOf('B', 1).originalBoard, 2);
assert.strictEqual(itemOf('B', 4).originalBoard, 3);
assert.strictEqual(itemOf('B', 1).newBoard, 1);
assert.strictEqual(itemOf('B', 4).newBoard, 1);
// 补切板落位：原始件号、原始尺寸，且按原输入顺序（A 先于 B）切割
assert.strictEqual(rc.boards[0].placements.length, 3);
assert.deepStrictEqual(
  rc.boards[0].placements.map((p) => `${p.order}#${p.index}`),
  ['A#5', 'B#1', 'B#4']
);
for (const p of rc.boards[0].placements) {
  assert.strictEqual(p.w, 600);
  assert.strictEqual(p.h, 400);
}
// 补切订单汇总：仅涉及订单，分摊额之和 = 补切材料费
assert.deepStrictEqual(rc.orders.map((o) => o.order), ['A', 'B']);
const rcA = rc.orders.find((o) => o.order === 'A');
const rcB = rc.orders.find((o) => o.order === 'B');
assert.strictEqual(rcA.partsCount, 1);
assert.strictEqual(rcB.partsCount, 2);
assert.strictEqual(rcA.materialCents + rcB.materialCents, rc.totalMaterialCents);
assert.deepStrictEqual(rcA.boardIndices, [1]);
// 补切板面积守恒与刀序连续
for (const b of rc.boards) {
  const boardArea = b.width * b.height;
  assert(Math.abs(boardArea - b.partsArea - b.kerfArea - b.remainderArea) < 0.01, '补切板面积不守恒');
  b.cuts.forEach((cut, i) => assert.strictEqual(cut.seq, i + 1));
}

// 补切重算原方案：原方案落位与分摊不变（与直接 /api/cut 结果一致）
const again = cutBoards(recutInput);
assert.strictEqual(again.boardsCount, 3);
assert.strictEqual(again.totalMaterialCents, 3000);
assert.deepStrictEqual(again.orders.map((o) => o.materialCents), [1250, 1750]);

// 15) 补切校验：重复 / 不存在 / 空选择 / 非法件号
assert.throws(() => recutBoards({
  ...recutInput,
  recut: [
    { order: 'A', part: '块', index: 5 },
    { order: 'A', part: '块', index: 5 },
  ],
}), UserError, '重复选择应报错');
assert.throws(() => recutBoards({
  ...recutInput,
  recut: [{ order: 'A', part: '块', index: 6 }],
}), UserError, '件号超出范围应报错');
assert.throws(() => recutBoards({
  ...recutInput,
  recut: [{ order: 'A', part: '不存在', index: 1 }],
}), UserError, '零件名不存在应报错');
assert.throws(() => recutBoards({
  ...recutInput,
  recut: [{ order: 'C', part: '块', index: 1 }],
}), UserError, '订单号不存在应报错');
assert.throws(() => recutBoards({ ...recutInput, recut: [] }), UserError, '空选择应报错');
assert.throws(() => recutBoards({ ...recutInput }), UserError, '缺少 recut 字段应报错');
assert.throws(() => recutBoards({
  ...recutInput,
  recut: [{ order: 'A', part: '块', index: 0 }],
}), UserError, '件号必须为正整数');

// 16) 补切按原始尺寸重排：旋转件以原始尺寸参与补切
const rotRecut = recutBoards({
  boardWidth: 500, boardHeight: 300, kerf: 0, boardPrice: 0,
  orders: [{ orderNo: 'R', parts: [{ name: '横条', width: 280, height: 400, quantity: 2 }] }],
  recut: [{ order: 'R', part: '横条', index: 2 }],
});
assert.strictEqual(rotRecut.boardsCount, 1);
assert.strictEqual(rotRecut.boards[0].placements[0].rotated, true, '补切仍允许旋转');
assert.strictEqual(rotRecut.boards[0].placements[0].index, 2, '补切落位保留原始件号');
assert.strictEqual(rotRecut.pickList[0].items[0].originalBoard, 2, '第 2 件在原方案第 2 张板');

// 17) 补切跨订单同名零件：仅所选订单的件进入补切方案
const crossRecut = recutBoards({
  ...recutInput,
  recut: [{ order: 'B', part: '块', index: 2 }],
});
assert.strictEqual(crossRecut.selectedCount, 1);
assert.strictEqual(crossRecut.boards[0].placements.length, 1);
assert.strictEqual(crossRecut.boards[0].placements[0].order, 'B');
assert.strictEqual(crossRecut.boards[0].placements[0].index, 2);
assert.strictEqual(crossRecut.orders.length, 1, '补切汇总只含涉及订单');

console.log('全部算法自检通过 ✔');
