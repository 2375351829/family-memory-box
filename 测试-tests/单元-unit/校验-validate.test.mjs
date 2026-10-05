// 校验模块单元测试（对照 app.py _validate_member_fields / api_topics_create /
// _validate_story_fields / api_capsules_create / _magic_ok 的行为）
import { describe, it, expect } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import {
  cleanStr,
  codePointLength,
  pyInt,
  validateMemberFields,
  validateTopicFields,
  validateStoryFields,
  validateCapsuleFields,
  parseLocalDate,
  magicOk,
  fixOriginalname,
} from '../../模块-node-校验-validate.mjs';
import { ApiError } from '../../模块-node-响应-response.mjs';

// 内存库：仅建 topics/members 最小表，供 validateStoryFields 的引用存在性判断
function memConn() {
  const conn = new DatabaseSync(':memory:');
  conn.exec('CREATE TABLE topics(id INTEGER PRIMARY KEY); CREATE TABLE members(id INTEGER PRIMARY KEY);');
  conn.exec('INSERT INTO topics(id) VALUES (1); INSERT INTO members(id) VALUES (1);');
  return conn;
}

const errCode = (fn) => {
  try {
    fn();
    return null;
  } catch (e) {
    return e instanceof ApiError ? { code: e.code, message: e.message, status: e.status } : { code: 'THROW', message: String(e) };
  }
};

describe('members 字段校验', () => {
  it('name 长度边界 0/1/20/21 与 relation 1/10/11', () => {
    expect(errCode(() => validateMemberFields({ name: '', relation: '我' }, false)).message).toBe('name 长度须为 1–20');
    expect(validateMemberFields({ name: '甲', relation: '我' }, false).name).toBe('甲');
    expect(validateMemberFields({ name: 'x'.repeat(20), relation: '我' }, false).name.length).toBe(20);
    expect(errCode(() => validateMemberFields({ name: 'x'.repeat(21), relation: '我' }, false)).message).toBe('name 长度须为 1–20');

    expect(validateMemberFields({ name: '甲', relation: 'y' }, false).relation).toBe('y');
    expect(validateMemberFields({ name: '甲', relation: 'y'.repeat(10) }, false).relation.length).toBe(10);
    expect(errCode(() => validateMemberFields({ name: '甲', relation: 'y'.repeat(11) }, false)).message).toBe('relation 长度须为 1–10');
  });

  it('emoji 按码点计数（20 个 emoji 通过，21 个拒绝）', () => {
    const twenty = '😀'.repeat(20); // JS .length = 40，码点 = 20
    expect('😀'.length).toBe(2); // 证明不是按 UTF-16 长度
    expect(codePointLength(twenty)).toBe(20);
    expect(validateMemberFields({ name: twenty, relation: '我' }, false).name).toBe(twenty);
    expect(errCode(() => validateMemberFields({ name: '😀'.repeat(21), relation: '我' }, false)).message).toBe('name 长度须为 1–20');
  });

  it('avatar_color 仅在字段出现时处理（缺省回退 #C0392B）；name 自动去空白', () => {
    // 未传 avatar_color → 不落该字段，交由数据库 DEFAULT('#C0392B') 兜底
    expect(validateMemberFields({ name: ' 甲 ', relation: ' 我 ' }, false)).toEqual({ name: '甲', relation: '我' });
    expect(validateMemberFields({ name: '甲', relation: '我', avatar_color: '#000' }, false).avatar_color).toBe('#000');
    expect(validateMemberFields({ name: '甲', relation: '我', avatar_color: '  ' }, false).avatar_color).toBe('#C0392B');
  });

  it('partial=true 仅校验出现的字段，空对象返回 {}', () => {
    expect(validateMemberFields({}, true)).toEqual({});
  });
});

describe('topics 字段校验', () => {
  it('text 长度边界 1/60/61，category 必填', () => {
    expect(validateTopicFields({ category: '童年糗事', text: 'x' }).text).toBe('x');
    expect(validateTopicFields({ category: '童年糗事', text: 'x'.repeat(60) }).text.length).toBe(60);
    expect(errCode(() => validateTopicFields({ category: '童年糗事', text: 'x'.repeat(61) })).message).toBe('text 长度须为 1–60');
    expect(errCode(() => validateTopicFields({ text: 'x' })).message).toBe('category 必填');
  });

  it('follow_ups 非字符串数组被拒绝；字符串数组去空白过滤空项', () => {
    expect(errCode(() => validateTopicFields({ category: 'c', text: 'x', follow_ups: [1, 2] })).message).toBe('follow_ups 须为字符串数组');
    expect(errCode(() => validateTopicFields({ category: 'c', text: 'x', follow_ups: ['a', 2] })).message).toBe('follow_ups 须为字符串数组');
    expect(validateTopicFields({ category: 'c', text: 'x', follow_ups: [' a ', '  ', 'b'] }).follow_ups).toEqual(['a', 'b']);
    expect(validateTopicFields({ category: 'c', text: 'x' }).follow_ups).toEqual([]);
  });
});

describe('stories.story_date 格式校验', () => {
  const conn = memConn();
  const base = { topic_id: 1, member_id: 1, content: '内容' };

  it('接受 1985 / 1985-06-01', () => {
    expect(validateStoryFields({ ...base, story_date: '1985' }, conn, true).story_date).toBe('1985');
    expect(validateStoryFields({ ...base, story_date: '1985-06-01' }, conn, true).story_date).toBe('1985-06-01');
  });

  it('拒绝 1985-6-1 / 85（抛 BAD_REQUEST）', () => {
    expect(errCode(() => validateStoryFields({ ...base, story_date: '1985-6-1' }, conn, true)).message).toBe('story_date 格式须为 YYYY 或 YYYY-MM-DD');
    expect(errCode(() => validateStoryFields({ ...base, story_date: '85' }, conn, true)).message).toBe('story_date 格式须为 YYYY 或 YYYY-MM-DD');
  });

  it('空串/缺省落 NULL', () => {
    expect(validateStoryFields({ ...base, story_date: '' }, conn, true).story_date).toBe(null);
    expect(validateStoryFields({ ...base, story_date: null }, conn, true).story_date).toBe(null);
  });
});

describe('capsules.open_date 格式校验', () => {
  it('拒绝 2024-02-30（不存在日期）与 2024-2-1（非零填充）', () => {
    const dummy = {}; // 此分支在访问 conn 前抛错
    expect(errCode(() => validateCapsuleFields({ title: 't', open_date: '2024-02-30' }, dummy)).message).toBe('open_date 不是合法日期');
    expect(errCode(() => validateCapsuleFields({ title: 't', open_date: '2024-2-1' }, dummy)).message).toBe('open_date 必填且格式须为 YYYY-MM-DD');
    expect(errCode(() => validateCapsuleFields({ title: 't', open_date: '' }, dummy)).message).toBe('open_date 必填且格式须为 YYYY-MM-DD');
  });

  it('接受合法日期 2024-12-31', () => {
    const fields = validateCapsuleFields({ title: 't', content: 'c', open_date: '2024-12-31' }, {});
    expect(fields).toEqual({ member_id: null, title: 't', content: 'c', open_date: '2024-12-31' });
  });

  it('parseLocalDate 本地时区解析，闰年 2024-02-29 合法 / 2023-02-29 非法', () => {
    expect(parseLocalDate('2024-02-29')).toBeInstanceOf(Date);
    expect(parseLocalDate('2023-02-29')).toBe(null);
    expect(parseLocalDate('2024-13-01')).toBe(null);
  });
});

describe('魔数校验', () => {
  const pad = (arr) => Buffer.concat([Buffer.from(arr), Buffer.alloc(12)]);

  it('正例：jpg/png/gif/webp 头部识别通过', () => {
    expect(magicOk('jpg', pad([0xff, 0xd8, 0xff]))).toBe(true);
    expect(magicOk('jpeg', pad([0xff, 0xd8, 0xff]))).toBe(true);
    expect(magicOk('png', pad([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe(true);
    expect(magicOk('gif', pad([...Buffer.from('GIF89a')]))).toBe(true);
    expect(magicOk('webp', pad([...Buffer.from('RIFF'), 0, 0, 0, 0, ...Buffer.from('WEBP')]))).toBe(true);
  });

  it('反例：文本内容伪装 .png / 白名单外扩展名 / 错误头', () => {
    const text = pad([...Buffer.from('not an image')]);
    expect(magicOk('png', text)).toBe(false); // 伪装 .png
    expect(magicOk('txt', text)).toBe(false); // 白名单外
    expect(magicOk('jpg', pad([0x00, 0x00, 0x00]))).toBe(false); // 错误魔数
  });
});

describe('通用辅助', () => {
  it('cleanStr 去空白、非字符串返回 null', () => {
    expect(cleanStr('  a ')).toBe('a');
    expect(cleanStr(1)).toBe(null);
    expect(cleanStr(undefined)).toBe(null);
  });

  it('pyInt 等价 Python isinstance(int)（布尔视为 int）', () => {
    expect(pyInt(1)).toBe(true);
    expect(pyInt(1.5)).toBe(false);
    expect(pyInt('1')).toBe(false);
    expect(pyInt(true)).toBe(true);
  });

  it('fixOriginalname 还原 multer latin1 误解码的中文文件名', () => {
    const mojibake = Buffer.from('中文照片.jpg', 'utf8').toString('latin1');
    expect(fixOriginalname(mojibake)).toBe('中文照片.jpg');
  });
});