const request = require("request");
const save = require("./save");
const counter = require("./requestCounter.js");

function getImgUrl(content, cookie, date, options) {
    var img_url = [];
    if (Array.isArray(content)) {
        for (var i = 0; i < content.length; i++) {
            img_url.push({ id: String(content[i]) });
        }
    }

    var jar = request.jar();
    if (cookie) {
        jar.setCookie(cookie, "https://www.pixiv.net/");
    }

    var index = 0;


    function fetchIllust(id, done) {
        counter.enqueue(function(currentCount) {
            console.log(`[${date}] 获取作品 ${id} 详情... (全局累计: ${currentCount})`);
            
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
                if (res.statusCode !== 200) return done(new Error("HTTP " + res.statusCode));
                
                // 防止解析到 HTML 导致报错
                if (body.trim().startsWith("<!DOCTYPE")) {
                    return done(new Error("遭 Pixiv 拦截 (需要更新 Cookie)"));
                }

                try {
                    var json = JSON.parse(body);
                    var b = json.body;
                    
                    // 提取所有標籤
                    var tags = [];
                    if (b.tags && b.tags.tags) {
                        tags = b.tags.tags.map(t => t.tag); 
                    }

                    // 檢查 --one 參數：禁止多圖作品
                    if (options.one && b.pageCount > 1) {
                        console.log(`[${date}] 作品 ${id} 是多圖作品 (${b.pageCount}張)，已跳過 (--one 模式)`);
                        return done(null, null, tags, true); // 最後一個參數表示被 --one 跳過
                    }

                    if (b.pageCount > 1) {
                        // 多圖作品
                        fetchPages(id, function(err, urls) {
                            if (err) return done(err);
                            
                            // 如果沒有 --one 參數，預設只下載第一張
                            if (!options.downloadAll) {
                                console.log(`[${date}] 作品 ${id} 是多圖作品 (${b.pageCount}張)，僅下載第一張`);
                                done(null, [urls[0]], tags, false);
                            } else {
                                // 如果有 --downloadAll，下載全部
                                done(null, urls, tags, false);
                            }
                        });
                    } else {
                        // 單圖作品
                        var url = b.urls.original || b.urls.regular;
                        done(null, [url], tags, false);
                    }
                } catch (e) {
                    done(new Error("解析失敗"));
                }
            });
        });
    }

    function fetchPages(id, done) {
        counter.enqueue(function(currentCount) {
            console.log(`[${date}] 获取作品 ${id} 多页详情... (全局累计: ${currentCount})`);
            
            request({
                url: `https://www.pixiv.net/ajax/illust/${id}/pages`,
                headers: { 
                    'Referer': `https://www.pixiv.net/artworks/${id}`, 
                    'Cookie': cookie || "" 
                },
                jar: jar
            }, function(err, res, body) {
                try {
                    var json = JSON.parse(body);
                    var urls = json.body.map(img => img.urls.original || img.urls.regular);
                    done(null, urls);
                } catch (e) { 
                    done(e); 
                }
            });
        });
    }

    function httprequest() {
        if (index >= img_url.length) {
            return; // 全部處理完畢
        }
        
        // 直接處理，暫停由統一佇列管理
        processNext();
    }

    function processNext() {
        if (index >= img_url.length) {
            return;
        }

        var id = img_url[index].id;
        console.log(`[${date}] 处理中 ${index + 1}/${img_url.length} - ID: ${id}`);

        fetchIllust(id, function(err, urls, tags, skippedByOne) {
            if (!err && urls) {
                // 如果被 --one 跳過，不保存
                if (skippedByOne) {
                    // 不做任何事，繼續下一個
                } else {
                    save(urls, id, date, urls.length > 1 ? 1 : 0, options, tags);
                }
            } else if (skippedByOne) {
                // 被 --one 跳過，靜默處理
            } else if (err && (err.message.includes("filtered"))) {
                // 靜默跳過篩選掉的作品
            } else {
                console.log(`[${date}] 獲取作品 ${id} 失敗: `, err ? err.message : "未知錯誤");
            }

            index++;
            httprequest(); // 繼續處理下一個
        });
    }

    httprequest();
}

module.exports = getImgUrl;