const https = require('https');
const fs = require('fs');
const path = require('path');

// 读取 data.js 提取前500字
const data = fs.readFileSync(path.join(__dirname, '..', 'data.js'), 'utf8');
const chars = [];
const re = /"c":\s*"([^"]+)"/g;
let m;
while ((m = re.exec(data)) !== null) chars.push(m[1]);
const top500 = chars.slice(0, 500);

console.log(`开始下载 ${top500.length} 个字的音频...`);

let done = 0, fail = 0;
const audioDir = path.join(__dirname, '..', 'audio');

function downloadOne(char) {
  return new Promise((resolve) => {
    const code = char.charCodeAt(0);
    const filePath = path.join(audioDir, code + '.mp3');
    if (fs.existsSync(filePath) && fs.statSync(filePath).size > 1000) {
      done++; resolve(); return;
    }
    const url = 'https://fanyi.baidu.com/gettts?lan=zh&text=' + encodeURIComponent(char) + '&spd=3&source=web';
    const file = fs.createWriteStream(filePath);
    https.get(url, (res) => {
      if (res.statusCode === 200 && (res.headers['content-type'] || '').includes('audio')) {
        res.pipe(file);
        file.on('finish', () => { file.close(); done++; resolve(); });
      } else {
        file.close();
        fs.unlinkSync(filePath);
        fail++; resolve();
      }
    }).on('error', () => { try { fs.unlinkSync(filePath); } catch(e){} fail++; resolve(); });
  });
}

async function main() {
  const batchSize = 10;
  for (let i = 0; i < top500.length; i += batchSize) {
    const batch = top500.slice(i, i + batchSize);
    await Promise.all(batch.map(downloadOne));
    process.stdout.write(`\r进度: ${done + fail}/${top500.length} (成功${done} 失败${fail})`);
  }
  console.log(`\n完成！成功 ${done}，失败 ${fail}`);
  // 检查文件数
  const files = fs.readdirSync(audioDir).filter(f => f.endsWith('.mp3'));
  console.log(`audio目录共 ${files.length} 个mp3文件`);
}
main();
