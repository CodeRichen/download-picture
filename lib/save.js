const request = require("request");
const fs = require("fs");
const path = require("path");
const counter = require("./requestCounter.js");

function save(urls, name, date, isMulti, options, tags) {
    
    var baseDir = (options && options.baseDir) ? options.baseDir : ("./picture/" + date);
    
    // 判斷是否為被擋掉的圖片
    var isBlocked = options.isBlocked || false;
    var blockReason = options.blockReason || "";
    
    // 如果是被擋掉的圖片，存到 black 資料夾
    if (isBlocked) {
        baseDir = path.join(baseDir, "_black");
        // console.log(`[被擋] ${name} 將存到 black 資料夾 (原因: ${blockReason})`);
    }
    
    var tagsTxtPath = path.join(baseDir, "_tags.txt");

    // 1. 建立資料夾
    if (!fs.existsSync(baseDir)) {
        fs.mkdirSync(baseDir, { recursive: true });
    }
    
    // 檢查是否為 split 模式
    var isSplit = options && options.split;
    
    // 只有在非 split 模式且為多圖時才建立子資料夾
    if (isMulti && !isSplit && !fs.existsSync(path.join(baseDir, name))) {
        fs.mkdirSync(path.join(baseDir, name), { recursive: true });
    }

    let downloadedCount = 0; // 用於追蹤多圖下載進度
    let hasError = false; // 追蹤是否有下載錯誤
    const totalUrls = urls.length; // 快取長度避免重複計算
    
    // 從 pageMap 獲取頁面和排名資訊（每個日期有獨立的 options）
    var pageInfo = options.pageMap ? options.pageMap[name] : null;
    var p = pageInfo ? pageInfo.page : 0;
    var r = pageInfo ? pageInfo.rank : 0;

    urls.forEach((url, index) => {
        counter.enqueueDownload(function(currentCount) {
            var ext = url.split('.').pop().split('?')[0]; 
            // split 模式：多圖直接存在主目錄，檔名為 name_index.ext
            // 正常模式：多圖存在子資料夾中，檔名為 name/name_index.ext
            // 單圖：直接存為 name.ext
            var fileName;
            if (isMulti) {
                if (isSplit) {
                    fileName = `${name}_${index}.${ext}`;
                } else {
                    fileName = `${name}/${name}_${index}.${ext}`;
                }
            } else {
                fileName = `${name}.${ext}`;
            }
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
                    hasError = true;
                    // 中止寫入並刪除不完整檔案
                    res.resume(); // 停止消費回應資料
                    fileStream.destroy(new Error(`HTTP status ${res.statusCode}`));
                    fs.unlink(filePath, function(unlinkErr) {
                        if (unlinkErr && unlinkErr.code !== 'ENOENT') {
                            console.log(`[刪除失敗] ${name}: ${unlinkErr.message}`);
                        }
                    });
                    return;
                }
            })
            .on('error', function(err) {
                console.log(`[錯誤] ${name} 下載失敗: ${err.message}`);
                hasError = true;
            })
            .pipe(fileStream);

            // 3. 確保圖片完全寫入硬碟後才觸發
            fileStream.on('finish', function() {
                downloadedCount++;
                
                console.log(`[${date}/${p}] ${name} DL `);

                // 4. 當所有圖片都下載完成（或單圖下載完成）才寫入 tags.txt 和更新緩存
                if (downloadedCount === totalUrls) {
                    // 寫入標籤記錄（被擋的圖片也寫入，但會寫到 black 資料夾的 _tags.txt）
                    writeTagRecord(tagsTxtPath, name, date, tags, p, r, isBlocked, blockReason);
                    
                    // 通知下載成功回調
                    if (options.onDownloadSuccess && typeof options.onDownloadSuccess === 'function') {
                        var status = hasError ? "failed" : "finish";
                        options.onDownloadSuccess(name, status, tags, {
                            page: p,
                            rank: r,
                            isBlocked: isBlocked
                        });
                    }
                }
            });

            fileStream.on('error', function(err) {
                console.log(`[寫入錯誤] ${name}: ${err.message}`);
                hasError = true;
                downloadedCount++;
                
                // 如果所有請求都完成了，通知失敗
                if (downloadedCount === totalUrls) {
                    if (options.onDownloadSuccess && typeof options.onDownloadSuccess === 'function') {
                        options.onDownloadSuccess(name, "failed", tags, {
                            page: p,
                            rank: r,
                            isBlocked: isBlocked
                        });
                    }
                }
            });
        });
    });
}

// 輔助函式：寫入標籤資訊
function writeTagRecord(filePath, name, date, tags, page, rank, isBlocked, blockReason) {
    // 優化: 減少字串拼接次數
    const tagStr = (tags && tags.length > 0) ? tags.join(", ") : "無標籤";
    
    const logEntry = isBlocked && blockReason
        ? `[${date}/${page}] RANK: ${rank} ID: ${name} | 被擋原因: ${blockReason} | Tags: ${tagStr}\n`
        : `[${date}/${page}] RANK: ${rank} ID: ${name} | Tags: ${tagStr}\n`;

    fs.appendFile(filePath, logEntry, (err) => {
        if (err) {
            console.log(`[標籤寫入錯誤] ${name}: ${err.message}`);
        } else {
            // console.log(`[成功] ${name} 資訊已加入 tags.txt`);
        }
    });
}

module.exports = save;