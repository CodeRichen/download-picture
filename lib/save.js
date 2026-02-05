const request = require("request");
const fs = require("fs");
const path = require("path");
const counter = require("./requestCounter.js");

function save(urls, name, date, isMulti, options, tags) {
    var baseDir = (options && options.baseDir) ? options.baseDir : ("./picture/" + date);
    
    // 建立資料夾
    if (!fs.existsSync(baseDir)) {
        fs.mkdirSync(baseDir, { recursive: true });
    }
    if (isMulti) {
        fs.mkdirSync(path.join(baseDir, name), { recursive: true });
    }
    
    // 將標籤資訊寫入到資料夾的 tags.txt 中（追加模式）
    if (tags && tags.length > 0) {
        var tagsTxtPath = path.join(baseDir, "tags.txt");
        var tagContent = `${name}: ${tags.join(", ")}\n`;
        
        fs.appendFile(tagsTxtPath, tagContent, (err) => {
            if (err) console.log(`[標籤寫入錯誤] ${name}: ${err.message}`);
        });
    }
    
    urls.forEach((url, index) => {
        // 將下載請求加入統一佇列
        counter.enqueueDownload(function(currentCount) {
            // 從網址自動取得副檔名 (jpg/png/gif)
            var ext = url.split('.').pop().split('?')[0]; 
            
            // 避免重複下載同樣的圖片(不能使用日期命名)
            var fileName = isMulti ? `${name}/${name}_${index}.${ext}` : `${name}.${ext}`;
            
            var filePath = path.join(baseDir, fileName);
            
            console.log(`[${date}] 下載圖片 ${name}_${index}... (全局累計: ${currentCount})`);
            
            request({
                url: url,
                headers: {
                    'Referer': "https://www.pixiv.net/",
                    'User-Agent': "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                },
                timeout: 20000
            })
            .on('response', function(res) {
                if (res.statusCode !== 200) {
                    console.log(`[失敗] ${name}_${date}_${index} 伺服器回傳 ${res.statusCode}`);
                }
            })
            .on('error', function(err) {
                console.log(`[錯誤] ${name}_${date}_${index} 下載失敗: ${err.message}`);
            })
            .pipe(fs.createWriteStream(filePath))
            .on('close', function() {
                console.log(`${name}_${date}_${index} save complete!`);
            });
        });
    });
}

module.exports = save;