//get daily rank
const request = require("request");
const fs = require("fs");
const io = require("cheerio");

const getImgUrl = require("./getImgUrl.js")

function daily_rank(cookie, date, options) {

    var jar = request.jar();
    if (cookie) {
        jar.setCookie(cookie, "https://www.pixiv.net/");
    }

    var mode = (options && options.mode) || "daily";
    var content = (options && options.content) || "illust";

    var pages = (options && options.pages) ? options.pages : 1;
    var allIds = [];

    function fetchPage(page, done) {
        var url = "https://www.pixiv.net/ranking.php?mode=" + mode + "&content=" + content + "&date=" + date;
        if (page > 1) {
            url += "&p=" + page;
        }
        request({
            url: url,
            headers: {
                'Referer': "https://www.pixiv.net",
                'User-Agent': "Mozilla/5.0 (Windows NT 6.3; rv:27.0) Gecko/20100101 Firefox/27.0",
                'Cookie': cookie || ""
            },
            jar: jar
        }, function(err, res, body) {
            if (err) {
                return done(err);
            }

            if (!fs.existsSync("./log")) {
                fs.mkdirSync("./log");
            }
            if (page === 1) {
                fs.writeFile("./log/ranking.html", body, "utf-8", function() {});
            }

            var html = body || "";
            var ids = [];
            var seen = {};
            var match;
            var re = /\/artworks\/(\d+)/g;
            while ((match = re.exec(html)) !== null) {
                if (!seen[match[1]]) {
                    seen[match[1]] = true;
                    ids.push(match[1]);
                }
            }
            done(null, ids);
        });
    }

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
                console.log("未取得排行榜內容，請檢查登入 Cookie 或站點頁面是否變更。");
                return;
            }

            fs.exists("./picture/" + date, function(exists) {
                if (!exists) {
                    fs.mkdirSync("./picture/" + date, { recursive: true });
                }
            })

            getImgUrl(ids, cookie, date, options);
            return;
        }

        fetchPage(page, function(err, ids) {
            if (err) {
                console.log("获取排行榜失败:", err.message);
            } else {
                allIds = allIds.concat(ids);
            }
            fetchNext(page + 1);
        });
    }

    fetchNext(1);

}

module.exports = daily_rank;