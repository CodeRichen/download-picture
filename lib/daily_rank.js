const request = require("request");
const fs = require("fs");
const io = require("cheerio"); // cheerio 已在這裡引入

const getImgUrl = require("./getImgUrl.js");

function daily_rank(cookie, date, options) {
    var jar = request.jar();
    if (cookie) {
        jar.setCookie(cookie, "https://www.pixiv.net/");
    }

    var mode = (options && options.mode) || "daily";
    var content = (options && options.content) || "illust";
    var pages = (options && options.pages) ? options.pages : 1;
    var targetTag = (options && options.tag) ? options.tag.toLowerCase() : null; // 取得篩選標籤
    var allIds = [];

function fetchPage(page, done) {
    // 改用 JSON API 網址
    var url = "https://www.pixiv.net/ranking.php?mode=" + mode + "&content=" + content + "&date=" + date + "&format=json";
    if (page > 1) {
        url += "&p=" + page;
    }

    request({
        url: url,
        headers: {
            'Referer': "https://www.pixiv.net/ranking.php",
            'User-Agent': "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            'Cookie': cookie || ""
        },
        jar: jar,
        json: true // 自動將回傳結果解析為 JSON 物件
    }, function(err, res, data) {
        if (err) return done(err);

        // Pixiv JSON API 的結構：data.contents 是一個陣列
        if (!data || !data.contents) {
            console.log(`第 ${page} 頁無內容，可能未登入或達到限制`);
            return done(null, []);
        }

        var ids = [];
        data.contents.forEach(function(item) {
            var workId = String(item.illust_id);
            // item.tags 是一個陣列，例如 ["miku", "初音ミク"]
            var tags = item.tags || []; 
            var tagsStr = tags.join(" ").toLowerCase();

            if (targetTag) {
                if (tagsStr.indexOf(targetTag) !== -1) {
                    ids.push(workId);
                }
            } else {
                ids.push(workId);
            }
        });

        console.log(`頁面 ${page}: 找到 ${data.contents.length} 件作品，篩選後剩餘 ${ids.length} 件`);
        done(null, ids);
    });
}

    // 下方 fetchNext 與原有邏輯相同 ...
    function fetchNext(page) {
        if (page > pages) {
            var uniq = {};
            var ids = [];
            for (var i = 0; i < allIds.length; i++) {
                if (!uniq[allIds[i]]) {
                    uniq[allIds[i]] = true;
                    ids.push(allIds[i]);
                }
            }
            if (options && options.max && ids.length > options.max) {
                ids = ids.slice(0, options.max);
            }
            if (ids.length === 0) {
                console.log("未取得符合標籤的作品，請檢查標籤名稱或登入狀態。");
                return;
            }

            var baseDir = (options && options.baseDir) ? options.baseDir : ("./picture/" + date);
            if (!fs.existsSync(baseDir)) {
                fs.mkdirSync(baseDir, { recursive: true });
            }

            getImgUrl(ids, cookie, date, options);
            return;
        }

        fetchPage(page, function(err, ids) {
            if (err) {
                console.log("獲取排行榜失敗:", err.message);
            } else {
                allIds = allIds.concat(ids);
            }
            fetchNext(page + 1);
        });
    }

    fetchNext(1);
}

module.exports = daily_rank;