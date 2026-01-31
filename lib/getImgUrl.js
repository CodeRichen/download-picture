const request = require("request");
const save = require("./save");
const counter = require("./requestCounter.js"); // 引入计数器模块

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

    // getImgUrl.js 核心过滤逻辑
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

          // lib/getImgUrl.js

                try {
                    var json = JSON.parse(body);
                    var b = json.body;
                    
                    // 提取所有標籤
                    var tags = [];
                    if (b.tags && b.tags.tags) {
                        // 提取標籤名（如果有譯名也會一併放入，或者只取原本標籤）
                        tags = b.tags.tags.map(t => t.tag); 
                    }

                    if (b.pageCount > 1) {
                        // 如果是多圖，傳遞 tags
                        fetchPages(id, function(err, urls) {
                            done(err, urls, tags); // 這裡多傳一個 tags
                        });
                    } else {
                        var url = b.urls.original || b.urls.regular;
                        done(null, [url], tags); // 這裡多傳一個 tags
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
                headers: { 'Referer': `https://www.pixiv.net/artworks/${id}`, 'Cookie': cookie || "" },
                jar: jar
            }, function(err, res, body) {
                try {
                    var json = JSON.parse(body);
                    var urls = json.body.map(img => img.urls.original || img.urls.regular);
                    done(null, urls);
                } catch (e) { done(e); }
            });
        });
    }

    function httprequest() {
        if (index < img_url.length) {
            var id = img_url[index].id;
            console.log(`[${date}] 处理中 ${index + 1}/${img_url.length} - ID: ${id}`);

            fetchIllust(id, function(err, urls,tags) {
                if (!err && urls) {

                    save(urls, id, date, urls.length > 1 ? 1 : 0, options, tags);
                } else if (err && (err.message.includes("filtered"))) {
                    // 静默跳过筛选掉的作品
                } else {
                    console.log(`[${date}] (敏感图片)获取作品 ${id} 失败: `, err ? err.message : "未知错误");
                }

                index++;
                httprequest(); // 立即处理下一个，不需要延迟（队列会控制）
            });
        }
    }

    httprequest();
}

module.exports = getImgUrl;
