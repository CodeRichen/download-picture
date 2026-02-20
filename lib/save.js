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
    // 資料夾名稱格式: {id}({count})，例如: 133083424(12)
    var folderName = isMulti && !isSplit ? `${name}(${urls.length})` : name;
    if (isMulti && !isSplit) {
        // 偵測是否已有相同 ID 開頭的資料夾（數量可能不同）
        var existingFolder = null;
        if (fs.existsSync(baseDir)) {
            var items = fs.readdirSync(baseDir);
            for (var i = 0; i < items.length; i++) {
                var item = items[i];
                var itemPath = path.join(baseDir, item);
                if (fs.statSync(itemPath).isDirectory()) {
                    // 檢查是否以 "ID(" 開頭
                    var pattern = new RegExp(`^${name}\\(\\d+\\)$`);
                    if (pattern.test(item)) {
                        existingFolder = item;
                        break;
                    }
                }
            }
        }
        
        // 如果找到現有資料夾，使用現有名稱；否則建立新資料夾
        if (existingFolder) {
            folderName = existingFolder;
            console.log(`[偵測] 使用現有資料夾: ${existingFolder}`);
        } else if (!fs.existsSync(path.join(baseDir, folderName))) {
            fs.mkdirSync(path.join(baseDir, folderName), { recursive: true });
        }
    }

    let downloadedCount = 0; // 用於追蹤多圖下載進度
    let hasError = false; // 追蹤是否有下載錯誤
    const totalUrls = urls.length; // 快取長度避免重複計算
    let completedFiles = new Set(); // 追蹤已完成的檔案索引，防止重複計數
    
    // 從 pageMap 獲取頁面和排名資訊（每個日期有獨立的 options）
    var pageInfo = options.pageMap ? options.pageMap[name] : null;
    var p = pageInfo ? pageInfo.page : 0;
    var r = pageInfo ? pageInfo.rank : 0;

    urls.forEach((url, index) => {
        counter.enqueueDownload(function(currentCount) {
            var ext = url.split('.').pop().split('?')[0]; 
            // split 模式：多圖直接存在主目錄，檔名為 name_index.ext
            // 正常模式：多圖存在子資料夾中，檔名為 name(count)/name_index.ext
            // 單圖：直接存為 name.ext
            var fileName;
            if (isMulti) {
                if (isSplit) {
                    fileName = `${name}_${index}.${ext}`;
                } else {
                    fileName = `${folderName}/${name}_${index}.${ext}`;
                }
            } else {
                fileName = `${name}.${ext}`;
            }
            var filePath = path.join(baseDir, fileName);
            
            // 顯示名稱（多圖顯示序號）
            var displayName = isMulti ? `${name}_${index}` : name;
            
            let fileCompleted = false; // 追蹤此檔案是否已完成（成功或失敗）
            let retryCount = 0; // 重試次數（每張圖片獨立計算）
            const maxRetries = 3; // 最多重試 3 次
            
            // 統一的完成處理函數
            function markAsCompleted(success) {
                if (fileCompleted) return; // 防止重複調用
                fileCompleted = true;
                
                if (!completedFiles.has(index)) {
                    completedFiles.add(index);
                    downloadedCount++;
                    
                    if (success) {
                        console.log(`[${date}/${p}] ${displayName} DL `);
                    }
                    
                    // 當所有圖片都處理完成時
                    if (downloadedCount === totalUrls) {
                        // 只有全部成功才寫入 tags.txt
                        if (!hasError) {
                            writeTagRecord(tagsTxtPath, name, date, tags, p, r, isBlocked, blockReason);
                        }
                        
                        if (options.onDownloadSuccess && typeof options.onDownloadSuccess === 'function') {
                            var status = hasError ? "failed" : "finish";
                            options.onDownloadSuccess(name, status, tags, {
                                page: p,
                                rank: r,
                                isBlocked: isBlocked
                            });
                        }
                    }
                }
            }
            
            // 下載函數（支援重試）
            function attemptDownload() {
                const fileStream = fs.createWriteStream(filePath);
                let downloadAborted = false;
                let expectedSize = 0; // 預期文件大小
                let downloadedSize = 0; // 實際下載大小
                
                const req = request({
                    url: url,
                    headers: {
                        'Referer': "https://www.pixiv.net/",
                        'User-Agent': "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                    },
                    timeout: 60000 
                })
                .on('response', function(res) {
                    if (res.statusCode !== 200) {
                        console.log(`[失敗] ${displayName} 伺服器回傳 ${res.statusCode}`);
                        hasError = true;
                        downloadAborted = true;
                        res.resume();
                        fileStream.destroy(new Error(`HTTP status ${res.statusCode}`));
                        fs.unlink(filePath, function(unlinkErr) {
                            if (unlinkErr && unlinkErr.code !== 'ENOENT') {
                                console.log(`[刪除失敗] ${displayName}: ${unlinkErr.message}`);
                            }
                        });
                        markAsCompleted(false);
                        return;
                    }
                    
                    // 記錄預期文件大小
                    expectedSize = parseInt(res.headers['content-length'] || '0', 10);
                    
                    // 追蹤實際下載大小
                    res.on('data', function(chunk) {
                        downloadedSize += chunk.length;
                    });
                })
                .on('error', function(err) {
                    if (downloadAborted) return; // 避免重複處理
                    downloadAborted = true;
                    
                    // 檢查是否為可重試的錯誤
                    const retryableErrors = ['ESOCKETTIMEDOUT', 'ETIMEDOUT', 'ECONNRESET', 'ENOTFOUND', 'aborted', 'socket hang up'];
                    const isRetryable = retryableErrors.some(errType => err.message.includes(errType));
                    
                    if (isRetryable && retryCount < maxRetries) {
                        retryCount++;
                        console.log(`[RE${retryCount}/${maxRetries}] ${displayName} - ${err.message}`);
                        fileStream.destroy();
                        fs.unlink(filePath, function() {
                            setTimeout(attemptDownload, 2000 * retryCount); // 遞增延遲：2s, 4s, 6s
                        });
                    } else {
                        console.log(`[錯誤] ${displayName} 下載失敗: ${err.message}${retryCount > 0 ? ` (已重試${retryCount}次)` : ''}`);
                        hasError = true;
                        fileStream.destroy(err);
                        markAsCompleted(false);
                    }
                })
                .pipe(fileStream);

                fileStream.on('finish', function() {
                    if (!downloadAborted) {
                        // 驗證文件大小是否完整
                        if (expectedSize > 0 && downloadedSize < expectedSize) {
                            const percentage = Math.round((downloadedSize / expectedSize) * 100);
                            console.log(`[不完整] ${displayName} 只下載了 ${percentage}% (${downloadedSize}/${expectedSize} bytes)`);
                            
                            // 視為下載失敗，嘗試重試
                            if (retryCount < maxRetries) {
                                retryCount++;
                                console.log(`[重試${retryCount}/${maxRetries}] ${displayName} - 文件不完整`);
                                fs.unlink(filePath, function() {
                                    setTimeout(attemptDownload, 2000 * retryCount);
                                });
                            } else {
                                console.log(`[錯誤] ${displayName} 下載失敗: 文件不完整 (已重試${retryCount}次)`);
                                hasError = true;
                                fs.unlink(filePath, function() {
                                    markAsCompleted(false);
                                });
                            }
                        } else {
                            // 文件完整，標記為成功
                            markAsCompleted(true);
                        }
                    }
                });

                fileStream.on('error', function(err) {
                    if (downloadAborted) return; // 避免重複處理
                    console.log(`[寫入錯誤] ${displayName}: ${err.message}`);
                    hasError = true;
                    markAsCompleted(false);
                });
            }
            
            // 開始下載
            attemptDownload();
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