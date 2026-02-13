const request = require("request");
const save = require("./save");
const counter = require("./requestCounter.js");
const path = require("path");
const fs = require("fs");

// 記憶體使用監控
function logMemoryUsage(label) {
    if (process.env.NODE_ENV === 'debug') {
        const used = process.memoryUsage();
        console.log(`[getImgUrl-${label}] Memory: ${Math.round(used.heapUsed / 1024 / 1024 * 100) / 100} MB`);
    }
}

function getImgUrl(content, cookie, date, options) {
    logMemoryUsage("開始");
    
    // 優化: 直接使用字串陣列，減少物件創建
    var img_url = [];
    var tagPrefix = "";
    if (options.tag) {
        // 取得第一個標籤，並過濾掉資料夾不允許的特殊字元
        var firstTag = options.tag.split(",")[0].replace(/[\\/:*?"<>|]/g, "_");
        tagPrefix = firstTag + "_";
    }


    // 優化: 減少物件包裝，直接使用 ID 陣列
    if (Array.isArray(content)) {
        img_url = content.map(id => String(id));
    }

    // 失敗記錄回調函數
    var onFailureCallback = options.onFailure || null;
    
    // 下載成功回調函數
    var onDownloadSuccessCallback = options.onDownloadSuccess || null;

    var jar = request.jar();
    if (cookie) {
        jar.setCookie(cookie, "https://www.pixiv.net/");
    }

    var index = 0;
    // --- 新增：連續錯誤計數器 ---
    var continuous429Count = 0;
    var isStopped = false; 

    function fetchIllust(id, done) {
        if (isStopped) return; // 如果已停止則不再發起請求

        counter.enqueue(function(currentCount) {
            // console.log(`[${date}] 获取作品 ${id} 详情... (全局累计: ${currentCount})`);
            
            request({
                url: "https://www.pixiv.net/ajax/illust/" + id,
                headers: {
                    'Referer': "https://www.pixiv.net/artworks/" + id,
                    'User-Agent': "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                    'Cookie': cookie || ""
                },
                timeout: 10000
            }, function(err, res, body) {
                if (err) return done(err);
                
                // --- 檢查 429 錯誤 ---
                if (res.statusCode === 429) {
                    return done(new Error("HTTP 429"));
                }
                
                if (res.statusCode !== 200) return done(new Error("HTTP " + res.statusCode));
                
                if (body.trim().startsWith("<!DOCTYPE")) {
                    return done(new Error("遭 Pixiv 拦截 (需要更新 Cookie)"));
                }

                try {
                    var json = JSON.parse(body);
                    var b = json.body;
                    
                    // 優化: 減少中間變數
                    var tags = (b.tags && b.tags.tags) ? b.tags.tags.map(t => t.tag) : [];
                    
                    // 提取作品資訊
                    var illustTitle = b.title || "unknown";
                    var illustDate = b.createDate || b.uploadDate || new Date().toISOString();
                    
                    // 格式化日期: "2023-12-31T12:14:00+09:00" -> "2023年12月31日 12:14"
                    if (illustDate) {
                        var dateObj = new Date(illustDate);
                        var year = dateObj.getFullYear();
                        var month = String(dateObj.getMonth() + 1).padStart(2, '0');
                        var day = String(dateObj.getDate()).padStart(2, '0');
                        var hours = String(dateObj.getHours()).padStart(2, '0');
                        var minutes = String(dateObj.getMinutes()).padStart(2, '0');
                        illustDate = `${year}年${month}月${day}日 ${hours}:${minutes}`;
                    }

                    // 檢查是否要跳過多圖作品
                    if (options.skipMulti && b.pageCount > 1) {
                        return done(null, null, tags, true, null); // 跳過多圖作品
                    }

                    if (options.one && b.pageCount > 1) {
                        fetchPages(id, function(err, urls) {
                            if (err) return done(err);
                            done(null, [urls[0]], tags, false, { title: illustTitle, date: illustDate });
                        });
                        return;
                    }

                    if (b.pageCount > 1) {
                        // 預設下載所有頁面（與原版一致），除非設定--one
                        fetchPages(id, function(err, urls) {
                            if (err) return done(err);
                            done(null, urls, tags, false, { title: illustTitle, date: illustDate });
                        });
                    } else {
                        var url = b.urls.original || b.urls.regular;
                        done(null, [url], tags, false, { title: illustTitle, date: illustDate });
                    }
                } catch (e) {
                    done(new Error("解析失敗"));
                }
            });
        });
    }

    // fetchPages 部分保持不變，但同樣會受到隊列管理
    function fetchPages(id, done) {
        // console.log(`[${date}] 開始獲取作品 ${id} 的多頁圖片URL`);
        counter.enqueue(function(currentCount) {
            // 對於已登錄用戶，嘗試使用更完整的請求頭
            var headers = { 
                'Referer': `https://www.pixiv.net/artworks/${id}`, 
                'User-Agent': "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                'Accept': 'application/json',
                'Accept-Language': 'zh-TW,zh;q=0.9,en;q=0.8',
                'Cache-Control': 'no-cache',
                'Pragma': 'no-cache'
            };
            
            if (cookie) {
                headers['Cookie'] = cookie;
            }
            
            request({
                url: `https://www.pixiv.net/ajax/illust/${id}/pages`,
                headers: headers,
                jar: jar,
                timeout: 15000
            }, function(err, res, body) {
                if (err) {
                    // 如果是登錄cookie導致的403，嘗試無cookie請求
                    if (err.message.includes('403') || err.message.includes('Forbidden')) {
                        fetchPagesWithoutCookie(id, done);
                        return;
                    }
                    return done(err);
                }
                if (res && res.statusCode === 429) {
                    return done(new Error("HTTP 429"));
                }
                if (res.statusCode === 403) {
                    fetchPagesWithoutCookie(id, done);
                    return;
                }
                if (res.statusCode !== 200) {
                    return done(new Error(`HTTP ${res.statusCode}`));
                }
                try {
                    var json = JSON.parse(body);
                    if (!json.body || !Array.isArray(json.body)) {
                        return done(new Error('頁面資料格式錯誤'));
                    }
                    var urls = json.body.map(img => img.urls.original || img.urls.regular);
                    done(null, urls);
                } catch (e) { 
                    done(e); 
                }
            });
        });
    }
    
    // 備用方案：無cookie請求
    function fetchPagesWithoutCookie(id, done) {
        // console.log(`[${date}] 🔄 作品 ${id} 使用無cookie模式獲取多頁URL`);
        counter.enqueue(function(currentCount) {
            request({
                url: `https://www.pixiv.net/ajax/illust/${id}/pages`,
                headers: { 
                    'Referer': `https://www.pixiv.net/artworks/${id}`, 
                    'User-Agent': "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                    'Accept': 'application/json'
                },
                timeout: 15000
            }, function(err, res, body) {
                if (err) return done(err);
                if (res && res.statusCode === 429) {
                    return done(new Error("HTTP 429"));
                }
                if (res.statusCode === 403) {
                    return done(new Error("HTTP 403 - 受限內容"));
                }
                if (res.statusCode !== 200) {
                    return done(new Error(`HTTP ${res.statusCode}`));
                }
                try {
                    var json = JSON.parse(body);
                    if (!json.body || !Array.isArray(json.body)) {
                        return done(new Error('頁面資料格式錯誤'));
                    }
                    var urls = json.body.map(img => img.urls.original || img.urls.regular);
                    done(null, urls);
                } catch (e) { 
                    done(e); 
                }
            });
        });
    }

    function httprequest() {
        if (index >= img_url.length || isStopped) {
            // 清理記憶體
            img_url = null;
            logMemoryUsage("完成");
            return;
        }
        processNext();
    }

    function processNext() {
        if (index >= img_url.length || isStopped) return;

        var id = img_url[index]; // 優化: 直接使用字串 ID
        // console.log(`[${date}] 处理中 ${index + 1}/${img_url.length} - ID: ${id}`);

        fetchIllust(id, function(err, urls, tags, skippedByOne, illustInfo) {
            if (err && err.message === "HTTP 429") {
                continuous429Count++;
                console.log(`[${date}] 警告: 觸發 HTTP 429 (Too Many Requests) [${continuous429Count}/3]`);
                
                if (continuous429Count >= 3) {
                    console.log(`[${date}] 偵測到連續 3 次 429 錯誤，為了防止 IP 被封鎖，立即停止所有工作。`);
                    isStopped = true;
                    return; // 終止遞迴
                }
            } else {
                continuous429Count = 0; 
            }

            if (!err && urls) {
                if (!skippedByOne) {
                    // 優化: 減少物件複製，只傳遞必要屬性
                    var pageInfo = options.pageMap && options.pageMap[id] ? options.pageMap[id] : null;
                    var isBlocked = pageInfo ? (pageInfo.isBlocked || false) : false;
                    var blockReason = pageInfo ? (pageInfo.blockReason || "") : "";
                    
                    if (isBlocked) {
                        console.log(`[getImgUrl] ID: ${id} (${blockReason})`);
                    }
                    
                    // 優化: 使用淺拷貝並只添加必要屬性
                    var saveOptions = {
                        baseDir: options.baseDir,  // 傳遞 baseDir
                        pageMap: options.pageMap,
                        isBlocked: isBlocked,
                        blockReason: blockReason,
                        onDownloadSuccess: function(illustId, status, downloadTags, saveMetadata) {
                            if (onDownloadSuccessCallback && typeof onDownloadSuccessCallback === 'function') {
                                saveMetadata.title = illustInfo ? illustInfo.title : "unknown";
                                saveMetadata.date = illustInfo ? illustInfo.date : new Date().toISOString();
                                onDownloadSuccessCallback(illustId, status, downloadTags, saveMetadata);
                            }
                        }
                    };
                    
                    save(urls, id, date, urls.length > 1 ? 1 : 0, saveOptions, tags);
                    
                    // 清理臨時變數
                    pageInfo = null;
                }
            } else if (!skippedByOne && !(err && err.message === "HTTP 429")) {
                // 排除 429 以外的錯誤提示
                // console.log(`[${date}] 作品 ${id} 解析失敗，可能遭攔截或不存在。記錄至失敗清單。`);

                
                // 通知失敗回調，將失敗狀態寫入緩存
                if (onFailureCallback && typeof onFailureCallback === 'function') {
                    onFailureCallback(id, err ? err.message : "unknown error");
                }
            }

            index++;
            httprequest(); 
        });
    }

    httprequest();
}

module.exports = getImgUrl;