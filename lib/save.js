const request = require("request");
const fs = require("fs");
const path = require("path");
const counter = require("./requestCounter.js");

// 動圖處理相關模組
let AdmZip, Jimp, GifEncoder;
let modulesLoaded = false;
try {
    AdmZip = require('adm-zip');
    Jimp = require('jimp');
    GifEncoder = require('gif-encoder-2');
    modulesLoaded = true;
    console.log('[調試] 動圖處理模組加載成功');
} catch (error) {
    console.log('[警告] 動圖處理模組未安裝，請執行: npm install adm-zip jimp gif-encoder-2');
    console.log(`[調試] 模組加載錯誤: ${error.message}`);
}

function save(urls, name, date, isMulti, options, tags) {
    
    var baseDir = (options && options.baseDir) ? options.baseDir : ("./picture/" + date);
    
    // 判斷是否為被擋掉的圖片
    var isBlocked = options.isBlocked || false;
    var blockReason = options.blockReason || "";
    
    // 檢查是否為動圖 (ugoira)
    var isUgoira = options && options.isUgoira || false;
    console.log(`[DEBUG] save函數 - isUgoira: ${isUgoira}, options.isUgoira: ${options && options.isUgoira}, options存在: ${!!options}`);
    
    if (isUgoira) {
        console.log(`[動圖下載] 準備下載 ugoira 作品: ${name}`);
        saveUgoira(urls[0], name, date, baseDir, isBlocked, blockReason, options, tags);
        return;
    }
    
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

// 處理動圖 (ugoira) 下載並重組為 GIF
function saveUgoira(zipUrl, name, date, baseDir, isBlocked, blockReason, options, tags) {
    // 檢查必要模組
    if (!modulesLoaded || !AdmZip || !Jimp || !GifEncoder) {
        console.log(`[動圖錯誤] ${name} 缺少必要模組，請執行: npm install adm-zip jimp gif-encoder-2`);
        console.log(`[調試] 模組狀態 - AdmZip: ${!!AdmZip}, Jimp: ${!!Jimp}, GifEncoder: ${!!GifEncoder}, modulesLoaded: ${modulesLoaded}`);
        if (options.onDownloadSuccess && typeof options.onDownloadSuccess === 'function') {
            options.onDownloadSuccess(name, "failed", tags, { error: "缺少動圖處理模組" });
        }
        return;
    }
    
    // 如果是被擋掉的動圖，存到 black 資料夾
    if (isBlocked) {
        baseDir = path.join(baseDir, "_black");
    }
    
    var tagsTxtPath = path.join(baseDir, "_tags.txt");
    
    // 建立資料夾
    if (!fs.existsSync(baseDir)) {
        fs.mkdirSync(baseDir, { recursive: true });
    }
    
    // 從 pageMap 獲取頁面和排名資訊
    var pageInfo = options.pageMap ? options.pageMap[name] : null;
    var p = pageInfo ? pageInfo.page : 0;
    var r = pageInfo ? pageInfo.rank : 0;
    
    // 獲取幀信息
    var frames = (options.frames || []);
    if (frames.length === 0) {
        console.log(`[動圖警告] ${name} 沒有幀信息，將嘗試下載 ZIP 檔案`);
    }
    
    counter.enqueueDownload(function(currentCount) {
        // 臨時 ZIP 文件路徑
        var tempZipPath = path.join(baseDir, `${name}_temp.zip`);
        // 最終 GIF 文件路徑
        var gifPath = path.join(baseDir, `${name}.gif`);
        
        console.log(`[動圖下載] 開始下載並重組: ${name}.gif`);
        
        const fileStream = fs.createWriteStream(tempZipPath);
        let downloadAborted = false;
        let expectedSize = 0;
        let downloadedSize = 0;
        
        const req = request({
            url: zipUrl,
            headers: {
                'Referer': "https://www.pixiv.net/",
                'User-Agent': "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            },
            timeout: 120000
        })
        .on('response', function(res) {
            if (res.statusCode !== 200) {
                console.log(`[動圖失敗] ${name} 伺服器回傳 ${res.statusCode}`);
                downloadAborted = true;
                res.resume();
                fileStream.destroy(new Error(`HTTP status ${res.statusCode}`));
                cleanupTempFiles();
                reportFailure();
                return;
            }
            
            expectedSize = parseInt(res.headers['content-length']) || 0;
        })
        .on('data', function(chunk) {
            downloadedSize += chunk.length;
        })
        .on('error', function(err) {
            if (!downloadAborted) {
                console.log(`[動圖錯誤] ${name} 下載失敗: ${err.message}`);
                cleanupTempFiles();
                reportFailure();
            }
        })
        .pipe(fileStream);
        
        fileStream.on('finish', function() {
            if (!downloadAborted) {
                // 檢查檔案完整性
                if (expectedSize > 0) {
                    const actualSize = fs.statSync(tempZipPath).size;
                    if (actualSize < expectedSize * 0.95) {
                        console.log(`[動圖不完整] ${name} ZIP 下載不完整`);
                        cleanupTempFiles();
                        reportFailure();
                        return;
                    }
                }
                
                console.log(`[動圖處理] ${name} ZIP 下載完成，開始重組動圖...`);
                
                // 重組為 GIF
                processUgoiraToGif(tempZipPath, gifPath, frames, function(success, error) {
                    cleanupTempFiles();
                    
                    if (success) {
                        console.log(`[動圖完成] ${name}.gif 重組完成`);
                        writeTagRecord(tagsTxtPath, name, date, tags, p, r, isBlocked, blockReason);
                        reportSuccess();
                    } else {
                        console.log(`[動圖失敗] ${name} 重組失敗: ${error}`);
                        reportFailure();
                    }
                });
            }
        });
        
        fileStream.on('error', function(err) {
            if (!downloadAborted) {
                console.log(`[動圖寫入錯誤] ${name}: ${err.message}`);
                cleanupTempFiles();
                reportFailure();
            }
        });
        
        function cleanupTempFiles() {
            try {
                if (fs.existsSync(tempZipPath)) {
                    fs.unlinkSync(tempZipPath);
                }
            } catch (err) {
                // 靜默失敗
            }
        }
        
        function reportSuccess() {
            if (options.onDownloadSuccess && typeof options.onDownloadSuccess === 'function') {
                options.onDownloadSuccess(name, "finish", tags, {
                    page: p,
                    rank: r,
                    isBlocked: isBlocked
                });
            }
        }
        
        function reportFailure() {
            if (options.onDownloadSuccess && typeof options.onDownloadSuccess === 'function') {
                options.onDownloadSuccess(name, "failed", tags, {
                    page: p,
                    rank: r,
                    isBlocked: isBlocked
                });
            }
        }
    });
}

// 將 ugoira ZIP 重組為 GIF
function processUgoiraToGif(zipPath, gifPath, frames, callback) {
    try {
        // 解壓 ZIP 文件
        const zip = new AdmZip(zipPath);
        const zipEntries = zip.getEntries();
        
        if (zipEntries.length === 0) {
            return callback(false, "ZIP 檔案為空");
        }
        
        console.log(`[動圖重組] 解壓得到 ${zipEntries.length} 個幀文件`);
        
        // 按文件名排序（通常為 000000.jpg, 000001.jpg 等）
        zipEntries.sort((a, b) => a.entryName.localeCompare(b.entryName));
        
        // 處理幀圖片
        const framePromises = zipEntries.map((entry, index) => {
            return new Promise((resolve, reject) => {
                const frameData = entry.getData();
                
                Jimp.read(frameData, (err, image) => {
                    if (err) {
                        console.log(`[動圖錯誤] 無法讀取幀 ${index}: ${err.message}`);
                        return reject(err);
                    }
                    
                    // 獲取幀的延遲時間（毫秒）
                    let delay = 100; // 默認 100ms
                    if (frames && frames[index] && frames[index].delay) {
                        delay = frames[index].delay;
                    }
                    
                    resolve({
                        image: image,
                        delay: delay,
                        index: index
                    });
                });
            });
        });
        
        Promise.all(framePromises)
            .then((processedFrames) => {
                if (processedFrames.length === 0) {
                    return callback(false, "沒有有效的幀圖片");
                }
                
                // 獲取第一幀的尺寸
                const firstFrame = processedFrames[0].image;
                const width = firstFrame.bitmap.width;
                const height = firstFrame.bitmap.height;
                
                console.log(`[動圖重組] 創建 ${width}x${height} GIF，共 ${processedFrames.length} 幀`);
                
                // 創建 GIF 編碼器
                const encoder = new GifEncoder(width, height);
                encoder.setRepeat(0); // 0 = 無限循環
                encoder.setQuality(10); // 品質設置 (1-20, 數字越小品質越好)
                
                // 寫入 GIF 文件
                const writeStream = fs.createWriteStream(gifPath);
                encoder.createReadStream().pipe(writeStream);
                
                encoder.start();
                
                // 添加每一幀
                processedFrames.forEach((frame, index) => {
                    encoder.setDelay(frame.delay);
                    
                    // 將 JIMP 圖片轉換為像素數據
                    const pixels = new Uint8Array(width * height * 4);
                    let pixelIndex = 0;
                    
                    frame.image.scan(0, 0, width, height, (x, y, idx) => {
                        pixels[pixelIndex++] = frame.image.bitmap.data[idx + 0]; // R
                        pixels[pixelIndex++] = frame.image.bitmap.data[idx + 1]; // G  
                        pixels[pixelIndex++] = frame.image.bitmap.data[idx + 2]; // B
                        pixels[pixelIndex++] = frame.image.bitmap.data[idx + 3]; // A
                    });
                    
                    encoder.addFrame(pixels);
                });
                
                encoder.finish();
                
                writeStream.on('finish', () => {
                    callback(true, null);
                });
                
                writeStream.on('error', (err) => {
                    callback(false, `寫入 GIF 失敗: ${err.message}`);
                });
                
            })
            .catch((err) => {
                callback(false, `處理幀圖片失敗: ${err.message}`);
            });
            
    } catch (err) {
        callback(false, `ZIP 解壓失敗: ${err.message}`);
    }
}

module.exports = save;