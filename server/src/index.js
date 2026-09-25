'use strict';

const path = require('path');
const fs = require('fs');
const express = require('express');
const { cutBoards, recutBoards, UserError } = require('./cutting');

const app = express();
const PORT = Number(process.env.PORT) || 8080;

app.use(express.json({ limit: '1mb' }));

// 健康检查（供 compose healthcheck 使用）
app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});

// 排料计算
app.post('/api/cut', (req, res) => {
  try {
    const result = cutBoards(req.body);
    res.json({ ok: true, result });
  } catch (err) {
    if (err instanceof UserError) {
      return res.status(err.statusCode).json({ ok: false, error: err.message });
    }
    console.error('排料计算失败：', err);
    res.status(500).json({ ok: false, error: '服务器内部错误' });
  }
});

// 缺件补切：以当前排料输入重算原方案并校验所选损坏件，仅重排所选件为独立补切方案
app.post('/api/recut', (req, res) => {
  try {
    const result = recutBoards(req.body);
    res.json({ ok: true, result });
  } catch (err) {
    if (err instanceof UserError) {
      return res.status(err.statusCode).json({ ok: false, error: err.message });
    }
    console.error('补切计算失败：', err);
    res.status(500).json({ ok: false, error: '服务器内部错误' });
  }
});

// 生产环境托管前端构建产物（client/dist）
const distDir = path.join(__dirname, '..', '..', 'client', 'dist');
if (fs.existsSync(distDir)) {
  app.use(express.static(distDir));
  app.get(/^(?!\/api\/).*/, (_req, res) => {
    res.sendFile(path.join(distDir, 'index.html'));
  });
}

app.listen(PORT, () => {
  console.log(`板材下料服务已启动：http://0.0.0.0:${PORT}`);
});
