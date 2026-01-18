//get the pictures' url
const request = require("request");

const save = require("./save");

function getImgUrl(content, cookie, date, options) {

    var img_url = [];
    if (Array.isArray(content)) {
        for (var i = 0; i < content.length; i++) {
            img_url.push({ id: String(content[i]) });
        }
    } else {
        for (var j = 0; j < content.length; j++) {
            var href = content[j].attribs && content[j].attribs.href;
            if (!href) {
                continue;
            }
            var m = /illust_id=(\d+)/.exec(href) || /\/artworks\/(\d+)/.exec(href);
            if (m) {
                img_url.push({ id: m[1] });
            }
        }
    }

    var jar = request.jar();
    if (cookie) {
        jar.setCookie(cookie, "https://www.pixiv.net/");
    }

    var index = 0;

    function fetchPages(id, done) {
        request({
            url: "https://www.pixiv.net/ajax/illust/" + id + "/pages",
            headers: {
                'Referer': "https://www.pixiv.net/artworks/" + id,
                'User-Agent': "Mozilla/5.0 (Windows NT 6.3; rv:27.0) Gecko/20100101 Firefox/27.0",
                'Cookie': cookie || ""
            },
            jar: jar
        }, function(err, res, body) {
            if (err) {
                return done(err);
            }
            try {
                var json = JSON.parse(body || "{}");
                if (json && json.body && Array.isArray(json.body)) {
                    var urls = json.body.map(function(item) {
                        return item.urls && (item.urls.original || item.urls.regular || item.urls.small);
                    }).filter(Boolean);
                    return done(null, urls);
                }
            } catch (e) {}
            done(new Error("pages parse failed"));
        });
    }

    function fetchIllust(id, done) {
        request({
            url: "https://www.pixiv.net/ajax/illust/" + id,
            headers: {
                'Referer': "https://www.pixiv.net/artworks/" + id,
                'User-Agent': "Mozilla/5.0 (Windows NT 6.3; rv:27.0) Gecko/20100101 Firefox/27.0",
                'Cookie': cookie || ""
            },
            jar: jar
        }, function(err, res, body) {
            if (err) {
                return done(err);
            }
            try {
                var json = JSON.parse(body || "{}");
                var pageCount = json && json.body && json.body.pageCount;
                var width = json && json.body && json.body.width;
                var height = json && json.body && json.body.height;
                var illustType = json && json.body && json.body.illustType;
                var typeMap = { 0: "illust", 1: "manga", 2: "ugoira" };
                var resolvedType = typeof illustType === "number" ? typeMap[illustType] : "unknown";

                if (options) {
                    var wantType = options.type || "all";
                    if (wantType !== "all" && resolvedType !== wantType) {
                        return done(new Error("type filtered"));
                    }
                    var orientation = options.orientation || "any";
                    if (width && height) {
                        if (orientation === "landscape" && width <= height) {
                            return done(new Error("orientation filtered"));
                        }
                        if (orientation === "portrait" && height <= width) {
                            return done(new Error("orientation filtered"));
                        }
                        if (orientation === "square" && width !== height) {
                            return done(new Error("orientation filtered"));
                        }
                    }
                }
                if (pageCount && pageCount > 1) {
                    return fetchPages(id, done);
                }
                var url = json && json.body && json.body.urls && (json.body.urls.original || json.body.urls.regular || json.body.urls.small);
                if (url) {
                    return done(null, [url]);
                }
            } catch (e) {}
            done(new Error("illust parse failed"));
        });
    }

    function httprequest() {
        if (index < img_url.length) {
            var id = img_url[index].id;
            fetchIllust(id, function(err, urls) {
                if (!err && urls && urls.length) {
                    save(urls, id, date, urls.length > 1 ? 1 : 0);
                } else {
                    if (err && (err.message === "type filtered" || err.message === "orientation filtered")) {
                        // filtered out
                    } else {
                        console.log("获取作品失败:", id);
                    }
                }
                index++;
                return httprequest();
            });
        } else {
            return false;
        }
    }
    httprequest();
}

module.exports = getImgUrl;