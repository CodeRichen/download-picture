const request = require("request");
const save = require("./save");

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

   // getImgUrl.js 核心過濾邏輯
function fetchIllust(id, done) {
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
        
        // 防止解析到 HTML 導致報錯
        if (body.trim().startsWith("<!DOCTYPE")) {
            return done(new Error("遭 Pixiv 攔截 (需要更新 Cookie)"));
        }

        try {
            var json = JSON.parse(body);
            var b = json.body;

            // --- 嚴格過濾開始 ---
            // 1. 類型檢查 (illust/manga)
            if (options.type && options.type !== "all") {
                var typeMap = { 0: "illust", 1: "manga", 2: "ugoira" };
                if (typeMap[b.illustType] !== options.type) {
                    return done(new Error("SKIP: 類型不符"));
                }
            }

            // 2. 橫直向檢查 (Landscape)
            if (options.orientation === "landscape") {
                // 如果寬度小於等於高度，就是直圖或方圖，必須刪除
                if (parseInt(b.width) <= parseInt(b.height)) {
                    return done(new Error("SKIP: 非橫圖"));
                }
            } else if (options.orientation === "portrait") {
                if (parseInt(b.height) <= parseInt(b.width)) {
                    return done(new Error("SKIP: 非直圖"));
                }
            }
            // --- 嚴格過濾結束 ---

            // 通過所有條件，準備下載
            if (b.pageCount > 1) {
                fetchPages(id, done);
            } else {
                done(null, [b.urls.original || b.urls.regular]);
            }
        } catch (e) {
            done(new Error("解析失敗"));
        }
    });
}

    function fetchPages(id, done) {
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
    }

    function httprequest() {
        if (index < img_url.length) {
            var id = img_url[index].id;
            console.log(`[處理中] ${index + 1}/${img_url.length} - ID: ${id}`);

            fetchIllust(id, function(err, urls) {
                if (!err && urls) {
                    save(urls, id, date, urls.length > 1 ? 1 : 0, options);
                } else if (err && (err.message.includes("filtered"))) {
                    // 靜默跳過篩選掉的作品
                } else {
                    console.log(`獲取作品 ${id} 失敗:`, err ? err.message : "未知錯誤");
                }

                index++;
                // 重要：加入 500ms 延遲，防止被 Pixiv 封鎖
                setTimeout(httprequest, 500); 
            });
        }
    }

    httprequest();
}

module.exports = getImgUrl;