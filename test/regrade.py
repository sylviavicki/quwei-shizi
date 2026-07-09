import re, json
from pypinyin import pinyin, Style

# 一年级上册识字表（部编版，按教学顺序）
grade1 = '天地人你我他一二三四五上下口耳目手足站坐日月水火山石田禾对云雨风花鸟虫六七八九十爸妈马土不画打棋鸡字词语句子桌纸文数学音乐妹奶白皮小桥台雪儿草家是车羊走也秋气了树叶片大飞会个的船两头在里看见闪星江南可采莲鱼东西北尖说春青蛙夏弯地就冬男女开关正反远有色近听无衣服快蓝又笑向着和贝娃挂活金哥姐姐弟弟叔爷群竹牙用几步为参加洞着乌鸦处找办旁徐法放进高住孩玩吧发芽爬呀久回全变工厂医院生半空问到方没更绿出长睡那海真老师吗同什才亮时候觉得自己很穿衣右它好朋友比尾巴谁长短把伞兔最公写诗要点要过给当串们以成数彩国旗中红歌起么美丽立午晚昨今年影前后黑狗左声去还来多少黄牛只猫边鸭苹果杏桃书包尺作业本笔刀课早校明力尘从众双木林森条心升国'

# 义务教育字表
with open('D:/AI/claudecode/shizi/edu_chars.txt', encoding='utf-8') as f:
    edu_text = f.read()
edu_chars = []
seen = set()
for c in re.findall(r'[\u4e00-\u9fff]', edu_text):
    if c not in seen:
        seen.add(c); edu_chars.append(c)

# 读取 data.js 获取拼音
with open('D:/AI/claudecode/shizi/data.js', encoding='utf-8') as f:
    data_text = f.read()
entries = re.findall(r'\{"id":\s*\d+,[^}]+\}', data_text)
char_entry = {}
char_pinyin = {}
for e in entries:
    mc = re.search(r'"c":\s*"(.)"', e)
    if not mc: continue
    c = mc.group(1)
    char_entry[c] = e
    mp = re.search(r'"p":\s*"([^"]*)"', e)
    if mp: char_pinyin[c] = mp.group(1)

def get_pinyin(c):
    if c in char_pinyin: return char_pinyin[c]
    try:
        py = pinyin(c, style=Style.TONE, heteronym=False)
        if py and py[0]: return py[0][0]
    except: pass
    return ''

# 分级
g1_list = list(grade1)
g1_set = set(g1_list)
# L1: 一年级前100字
l1 = g1_list[:100]
# L2: 一年级101-280 + 义务教育字表补到300
l2_base = g1_list[100:]
l2_extra = [c for c in edu_chars if c not in g1_set and c not in set(l2_base)]
l2 = (l2_base + l2_extra)[:200]
# L3-L6: 义务教育字表剩余
used = set(l1) | set(l2)
remaining = [c for c in edu_chars if c not in used]
l3 = remaining[:500]
l4 = remaining[500:1200]
l5 = remaining[1200:2200]
l6 = remaining[2200:2700]

all_chars = l1 + l2 + l3 + l4 + l5 + l6
print(f'L1: {len(l1)} L2: {len(l2)} L3: {len(l3)} L4: {len(l4)} L5: {len(l5)} L6: {len(l6)} 总: {len(all_chars)}')

# 检查关键字
for c in ['我','你','他','前','林','姐','妹','鱼','爸','草']:
    for i, ch in enumerate(all_chars):
        if ch == c:
            lv = 1 if i<100 else 2 if i<300 else 3 if i<800 else 4 if i<1500 else 5 if i<2500 else 6
            print(f'  {c}: L{lv} (位置{i+1})')
            break

# 生成 data.js
def get_lv(idx):
    if idx < 100: return 1
    elif idx < 300: return 2
    elif idx < 800: return 3
    elif idx < 1500: return 4
    elif idx < 2500: return 5
    else: return 6

new_entries = []
for i, c in enumerate(all_chars):
    idx = i + 1
    lv = get_lv(i)
    p = get_pinyin(c)
    if not p: continue
    sp = lv <= 2
    if c in char_entry:
        e = char_entry[c]
        e = re.sub(r'"id":\s*\d+', f'"id": {idx}', e)
        e = re.sub(r'"lv":\s*\d+', f'"lv": {lv}', e)
        new_entries.append(e)
    else:
        new_entries.append(json.dumps({"id": idx, "c": c, "p": p, "lv": lv, "sp": sp, "e": "📖", "w": [], "s": "", "st": ""}, ensure_ascii=False))

output = '// 趣味识字 - 汉字词库数据 v3.3\n// 按教育大纲分级(一年级=L1-L2, 义务教育字表=L3-L6)\n\nconst CHARLIB = [\n'
output += ',\n'.join(new_entries)
output += '\n];\n\nif (typeof window !== "undefined") window.CHARLIB = CHARLIB;\n'
with open('D:/AI/claudecode/shizi/data.js', 'w', encoding='utf-8') as f:
    f.write(output)
print(f'\n✅ 生成 {len(new_entries)} 字')
for lv in [1,2,3,4,5,6]:
    cnt = sum(1 for i in range(min(len(all_chars),len(new_entries))) if get_lv(i)==lv)
    s = [all_chars[i] for i in range(len(all_chars)) if get_lv(i)==lv][:12]
    print(f'  L{lv} ({cnt}字): {" ".join(s)}')
