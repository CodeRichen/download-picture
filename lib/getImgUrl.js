const request = require("request");
const save = require("./save");
const counter = require("./requestCounter.js");
const path = require("path");
const fs = require("fs");

function getImgUrl(content, cookie, date, options) {
    var img_url = [];
    const FAILED_LOG = "./picture/failed_ids.txt";

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
                    
                    var tags = [];
                    if (b.tags && b.tags.tags) {
                        tags = b.tags.tags.map(t => t.tag); 
                    }

                    if (options.one && b.pageCount > 1) {
                        console.log(`[${date}] 作品 ${id} 是多圖作品 (${b.pageCount}張)，已跳過 (--one 模式)`);
                        return done(null, null, tags, true);
                    }

                    if (b.pageCount > 1) {
                        fetchPages(id, function(err, urls) {
                            if (err) return done(err);
                            if (!options.downloadAll) {
                                console.log(`[${date}] 作品 ${id} 是多圖作品 (${b.pageCount}張)，僅下載第一張`);
                                done(null, [urls[0]], tags, false);
                            } else {
                                done(null, urls, tags, false);
                            }
                        });
                    } else {
                        var url = b.urls.original || b.urls.regular;
                        done(null, [url], tags, false);
                    }
                } catch (e) {
                    done(new Error("解析失敗"));
                }
            });
        });
    }

    // fetchPages 部分保持不變，但同樣會受到隊列管理
    function fetchPages(id, done) {
        counter.enqueue(function(currentCount) {
            request({
                url: `https://www.pixiv.net/ajax/illust/${id}/pages`,
                headers: { 
                    'Referer': `https://www.pixiv.net/artworks/${id}`, 
                    'Cookie': cookie || "" 
                },
                jar: jar
            }, function(err, res, body) {
                if (res && res.statusCode === 429) return done(new Error("HTTP 429"));
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
        if (index >= img_url.length || isStopped) return;
        processNext();
    }

    function processNext() {
        if (index >= img_url.length || isStopped) return;

        var id = img_url[index].id;
        // console.log(`[${date}] 处理中 ${index + 1}/${img_url.length} - ID: ${id}`);

        fetchIllust(id, function(err, urls, tags, skippedByOne) {
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
                    save(urls, id, date, urls.length > 1 ? 1 : 0, options, tags);
                }
            } else if (!skippedByOne && !(err && err.message === "HTTP 429")) {
                // 排除 429 以外的錯誤提示
                // console.log(`[${date}] 作品 ${id} 解析失敗，可能遭攔截或不存在。記錄至失敗清單。`);
                    fs.appendFileSync(FAILED_LOG, id + "\n", "utf8");

            }

            index++;
            httprequest(); 
        });
    }

    httprequest();
}

module.exports = getImgUrl;