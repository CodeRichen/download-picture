const request = require("request");
const fs = require("fs");
const path = require("path");

function save(urls, name, date, isMulti, options) {
    var baseDir = (options && options.baseDir) ? options.baseDir : ("./picture/" + date);
    
    // 建立資料夾
    if (!fs.existsSync(baseDir)) {
        fs.mkdirSync(baseDir, { recursive: true });
    }
    if (isMulti) {
        fs.mkdirSync(path.join(baseDir, name), { recursive: true });
    }

    urls.forEach((url, index) => {
        // 從網址自動取得副檔名 (jpg/png/gif)
        var ext = url.split('.').pop().split('?')[0]; 
        var fileName = isMulti ? `${name}/${name}_${index}.${ext}` : `${name}_${index}.${ext}`;
        var filePath = path.join(baseDir, fileName);

        request({
            url: url,
            headers: {
                'Referer': "https://www.pixiv.net/", // 必須是 https
                'User-Agent': "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            },
            timeout: 20000
        })
        .on('response', function(res) {
            if (res.statusCode !== 200) {
                console.log(`[失敗] ${name}_${index} 伺服器回傳 ${res.statusCode}`);
            }
        })
        .on('error', function(err) {
            console.log(`[錯誤] ${name}_${index} 下載失敗: ${err.message}`);
        })
        .pipe(fs.createWriteStream(filePath))
        .on('close', function() {
            console.log(`${name}_${index} save complete!`);
        });
    });
}

module.exports = save;