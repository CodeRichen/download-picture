const request = require("request");
const fs = require("fs");
const path = require("path");
const counter = require("./requestCounter.js");

function save(urls, name, date, isMulti, options, tags) {
    var baseDir = (options && options.baseDir) ? options.baseDir : ("./picture/" + date);
    var tagsTxtPath = path.join(baseDir, "_tags.txt");

    // 1. 建立資料夾
    if (!fs.existsSync(baseDir)) {
        fs.mkdirSync(baseDir, { recursive: true });
    }
    if (isMulti && !fs.existsSync(path.join(baseDir, name))) {
        fs.mkdirSync(path.join(baseDir, name), { recursive: true });
    }


    let downloadedCount = 0; // 用於追蹤多圖下載進度

    urls.forEach((url, index) => {
        counter.enqueueDownload(function(currentCount) {
            var ext = url.split('.').pop().split('?')[0]; 
            var fileName = isMulti ? `${name}/${name}_${index}.${ext}` : `${name}.${ext}`;
            var filePath = path.join(baseDir, fileName);
            
            // console.log(`[${date}] 準備下載 ${name}_${index}...`);
            
            const fileStream = fs.createWriteStream(filePath);
            
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
                    console.log(`[失敗] ${name} 伺服器回傳 ${res.statusCode}`);
                }
            })
            .on('error', function(err) {
                console.log(`[錯誤] ${name} 下載失敗: ${err.message}`);
            })
            .pipe(fileStream);

            // 3. 確保圖片完全寫入硬碟後才觸發
            fileStream.on('finish', function() {
                downloadedCount++;
                
                var info = options.pageMap[name];
                var p = info.page;
                var r = info.rank;
                console.log(`[${date}/${p}] ${name}_${index} 下載完成 `);

                // 4. 當所有圖片都下載完成（或單圖下載完成）才寫入 tags.txt
                if (downloadedCount === urls.length) {
                    
                    writeTagRecord(tagsTxtPath, name, date, tags,p,r);
                }
            });
        });
    });
}

// 輔助函式：寫入標籤資訊
function writeTagRecord(filePath, name, date, tags,page,rank) {
    const tagStr = (tags && tags.length > 0) ? tags.join(", ") : "無標籤";
    // 格式：日期 | ID: 名稱 | Tags: 標籤
    const logEntry = `[${date}/${page}] RANK: ${rank} ID: ${name} | Tags: ${tagStr}\n`;

    fs.appendFile(filePath, logEntry, (err) => {
        if (err) {
            console.log(`[標籤寫入錯誤] ${name}: ${err.message}`);
        } else {
            // console.log(`[成功] ${name} 資訊已加入 tags.txt`);
        }
    });
}

module.exports = save;