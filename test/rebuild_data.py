import re, json
from pypinyin import pinyin, Style

# 1. 读取义务教育字表
with open('D:/AI/workbuddy/shizi/edu_chars.txt', encoding='utf-8') as f:
    text = f.read()
edu_chars = re.findall(r'[\u4e00-\u9fff]', text)
edu_set = set(edu_chars)
print(f'义务教育字表: {len(edu_set)} 个唯一字')

# 2. 读取 data.js
with open('D:/AI/workbuddy/shizi/data.js', encoding='utf-8') as f:
    data_text = f.read()

entries = re.findall(r'\{"id":\s*\d+,[^}]+\}', data_text)
print(f'data.js 原始: {len(entries)} 个条目')

char_entry = {}
char_pinyin = {}
for e in entries:
    mc = re.search(r'"c":\s*"(.)"', e)
    if not mc: continue
    c = mc.group(1)
    char_entry[c] = e
    mp = re.search(r'"p":\s*"([^"]*)"', e)
    if mp: char_pinyin[c] = mp.group(1)

# 用 pypinyin 补充字表里有但 data.js 没有的字的拼音
def get_pinyin(c):
    if c in char_pinyin: return char_pinyin[c]
    try:
        py = pinyin(c, style=Style.TONE, heteronym=False)
        if py and py[0]: return py[0][0]
    except: pass
    return ''

# 3. 保留原 L1-L4 在字表里的字
l1_l4_chars = []
for e in entries:
    mc = re.search(r'"c":\s*"(.)"', e)
    mlv = re.search(r'"lv":\s*(\d+)', e)
    if mc and mlv and int(mlv.group(1)) <= 4:
        c = mc.group(1)
        if c in edu_set:
            l1_l4_chars.append(c)
print(f'L1-L4 保留: {len(l1_l4_chars)}')

# 4. 从字表取不在 L1-L4 的字，用 pypinyin 补拼音
l1_l4_set = set(l1_l4_chars)
l5_l6_chars = []
for c in edu_chars:
    if c not in l1_l4_set:
        p = get_pinyin(c)
        if p:
            l5_l6_chars.append(c)
            char_pinyin[c] = p  # 缓存拼音
print(f'L5-L6 新字: {len(l5_l6_chars)}')

# 5. 组合，取前 3000
all_chars = (l1_l4_chars + l5_l6_chars)[:3000]
print(f'总计: {len(all_chars)} 字')

# 6. 分级
def get_lv(idx):
    if idx < 100: return 1
    elif idx < 300: return 2
    elif idx < 800: return 3
    elif idx < 1500: return 4
    elif idx < 2500: return 5
    else: return 6

# 7. 生成新 data.js
new_entries = []
for i, c in enumerate(all_chars):
    idx = i + 1
    lv = get_lv(i)
    p = char_pinyin.get(c, '')
    sp = lv <= 2

    if c in char_entry:
        e = char_entry[c]
        e = re.sub(r'"id":\s*\d+', f'"id": {idx}', e)
        e = re.sub(r'"lv":\s*\d+', f'"lv": {lv}', e)
        new_entries.append(e)
    else:
        new_entries.append(json.dumps({
            "id": idx, "c": c, "p": p, "lv": lv, "sp": sp,
            "e": "📖", "w": [], "s": "", "st": ""
        }, ensure_ascii=False))

output = '// 趣味识字 - 汉字词库数据 v3.2\n'
output += '// 基于义务教育语文课程常用字表(3500字)重新整理\n'
output += '// 前500字隐藏拼音，501字起显示拼音\n'
output += '// 前144+字含emoji配图、组词、例句、趣味描述\n\n'
output += 'const CHARLIB = [\n'
output += ',\n'.join(new_entries)
output += '\n];\n\nif (typeof window !== "undefined") window.CHARLIB = CHARLIB;\n'

with open('D:/AI/workbuddy/shizi/data.js', 'w', encoding='utf-8') as f:
    f.write(output)

print(f'\n✅ 生成新 data.js: {len(new_entries)} 个字')
for lv in [1,2,3,4,5,6]:
    cnt = sum(1 for i in range(len(all_chars)) if get_lv(i) == lv)
    sample = [all_chars[i] for i in range(len(all_chars)) if get_lv(i) == lv][:12]
    print(f'  L{lv} ({cnt}字): {" ".join(sample)}')
