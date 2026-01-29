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

   function fetchIllust(id, done) {
        request({
            url: "https://www.pixiv.net/ajax/illust/" + id,
            headers: {
                'Referer': "https://www.pixiv.net/artworks/" + id,
                'User-Agent': "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                'Cookie': cookie || ""
            },
            jar: jar,
            timeout: 10000
        }, function(err, res, body) {
            if (err) return done(err);
            try {
                var json = JSON.parse(body || "{}");
                var b = json.body; // 確保這裡定義了 b
                
                if (!b) return done(new Error("無法取得作品內容 (Body is null)"));

                // 篩選邏輯
                if (options) {
                    var typeMap = { 0: "illust", 1: "manga", 2: "ugoira" };
                    if (options.type && options.type !== "all" && typeMap[b.illustType] !== options.type) {
                        return done(new Error("type filtered"));
                    }
                    if (options.orientation && options.orientation !== "any") {
                        if (options.orientation === "landscape" && b.width <= b.height) return done(new Error("orientation filtered"));
                        if (options.orientation === "portrait" && b.height <= b.width) return done(new Error("orientation filtered"));
                    }
                }

                if (b.pageCount > 1) {
                    fetchPages(id, done);
                } else {
                    // 這裡修復了變數 b 的調用
                    var url = b.urls.original || b.urls.regular || b.urls.small;
                    done(null, [url]);
                }
            } catch (e) { done(e); }
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