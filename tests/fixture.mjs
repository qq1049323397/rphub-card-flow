#!/usr/bin/env node
/**
 * fixture.mjs — 合成测试卡
 *
 * 为什么需要它：原先自检依赖一张外部真实卡，那张卡一被删/改名，自检就红。
 * 测试的基准物不该长在别人的工作产物上。这里现场合成一张 PNG 卡，
 * 既自足，又能比真实卡更精确地构造「解包优先级」的三个分支。
 *
 * 不依赖任何图像库：手写 PNG 块（签名 + IHDR + IDAT + tEXt* + IEND）。
 * 读取端 readPngTextChunks 只检查签名与块结构，不校验 CRC。
 */
import zlib from 'node:zlib';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, 'latin1');
  const crc = Buffer.alloc(4); crc.writeUInt32BE(0, 0); // 读取端不校验
  return Buffer.concat([len, t, data, crc]);
}

/** 极简合法 1x1 PNG 图像数据 */
function imageChunks() {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(1, 0); ihdr.writeUInt32BE(1, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const raw = Buffer.from([0, 0, 0, 0, 0]);
  return [chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw))];
}

/** 按 chara 的存储约定编码：base64 文本 */
function b64(obj) {
  return Buffer.from(JSON.stringify(obj), 'utf8').toString('base64');
}

/** tEXt 块：keyword \0 text */
function textChunk(kw, text) {
  // 必须用 utf8：嗅探分支的原文里含中文，latin1 会逐字节截断导致 JSON 解析失败。
  // base64（chara/ccv3）是纯 ASCII，utf8 与 latin1 等价，故统一用 utf8。
  return chunk('tEXt', Buffer.concat([Buffer.from(kw, 'latin1'), Buffer.from([0]), Buffer.from(text, 'utf8')]));
}

/**
 * 造一张卡。
 * @param {object} card   角色卡本体
 * @param {object} opts   { chunks: ['chara','ccv3','sniff'], sniffAs: 'json'|'base64' }
 */
export function makeCardPng(card, opts = {}) {
  const which = opts.chunks || ['chara'];
  const parts = [SIG, ...imageChunks()];
  if (which.includes('chara')) parts.push(textChunk('chara', b64(card)));
  if (which.includes('ccv3')) parts.push(textChunk('ccv3', b64(opts.ccv3Card || card)));
  if (which.includes('sniff')) {
    // 嗅探块：不以 chara/ccv3 命名，靠内容像 JSON 被认出
    const payload = opts.sniffAs === 'base64' ? b64(card) : JSON.stringify(card);
    parts.push(textChunk(opts.sniffKey || 'Comment', payload));
  }
  parts.push(chunk('IEND', Buffer.alloc(0)));
  return Buffer.concat(parts);
}

/** 写入临时文件并返回路径 */
export function writeCardPng(card, opts = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rphubfix-'));
  const p = path.join(dir, 'card.png');
  fs.writeFileSync(p, makeCardPng(card, opts));
  return p;
}

/** 一张最小的、结构完整的卡（用于解包/闸门类测试） */
export function minimalCard(over = {}) {
  const data = {
    name: '测试卡',
    description: 'desc',
    first_mes: '开场白 [STAT_SET|hp=1]',
    character_book: {
      entries: [
        { comment: '① 常驻契约', keys: [], content: '正文契约 [STAT_SET|hp=1]', constant: true, order: 10 },
        { comment: '② 直接命中', keys: ['STAT_SET'], content: '面板内容', order: 20 },
      ],
    },
    ...over.data,
  };
  const extensions = { regex_scripts: [], ...over.extensions };
  return { spec: 'chara_card_v2', data: { ...data, extensions } };
}

/**
 * 一张「干净卡」：gate.mjs 应当 exit 0。
 * 要满足 gate 的硬项，必须真的写出索引结构，不能靠调参糊弄：
 *   · 死键率 0        —— 12 个字面键全部出现在常驻索引正文里
 *   · 常驻索引覆盖 100% —— 全部字面 key 都被常驻条目点名（≥0.6 才算 pass）
 *   · 索引条目存在     —— 常驻正文点名 ≥10 个条目（gate 认为这才叫「在干活」）
 * 条目正文刻意写得短：低于同类中位 50% 的过薄检查有 med>=40 的门槛，
 * 短正文不会进入过薄统计。
 */
export function cleanCard() {
  const names = Array.from({ length: 12 }, (_, i) => `人物${String(i + 1).padStart(2, '0')}`);
  const entries = names.map((k, i) => ({
    comment: `人物·${String(i + 1).padStart(2, '0')}`,
    keys: [k],
    content: `<${k}>\n短正文`,   // 标签 = 裸名 = 键 → 裸名保底通过（v0.7.0）
    order: 100 + i,
  }));
  entries.push({
    comment: '索引·人物总表',
    keys: [],
    content: `本卡人物：${names.join('、')}`,
    constant: true,
    order: 10,
  });
  return {
    spec: 'chara_card_v2',
    data: {
      name: '干净卡',
      description: 'desc',
      first_mes: '开场白提到了人物01。',
      character_book: { entries },
      extensions: { regex_scripts: [] },
    },
  };
}
