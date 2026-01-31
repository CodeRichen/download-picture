const request = require("request");
const fs = require("fs");
const io = require("cheerio"); // cheerio 已在這裡引入

const getImgUrl = require("./getImgUrl.js");
const counter = require("./requestCounter.js"); // 引入计数器模块

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
        // 将请求加入队列
        counter.enqueue(function(currentCount) {
            // 改用 JSON API 網址
            var url = "https://www.pixiv.net/ranking.php?mode=" + mode + "&content=" + content + "&date=" + date + "&format=json";
            if (page > 1) {
                url += "&p=" + page;
            }

            console.log(`[${date}] 获取排行榜第 ${page} 页 (全局累计: ${currentCount}`);

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
                    console.log(`[${date}] 第 ${page} 頁無內容，可能未登入或達到限制`);
                    return done(null, []);
                }

                var ids = [];
     
                data.contents.forEach(function(item) {
                    var tagsStr = item.tags.join(" ").toLowerCase();
                    var targetTag = options.tag ? options.tag.toLowerCase() : "";
                    
                    // 1. 檢查標籤
                    var tagMatch = !targetTag || tagsStr.indexOf(targetTag) !== -1;
                    
                    // 2. 檢查橫直向 (這裡直接利用 item.width 和 item.height)
                    var orientationMatch = true;
                    if (options.orientation === "landscape") {
                        orientationMatch = parseInt(item.width) > parseInt(item.height);
                    } if (options.orientation === "desktop") {
                        const width = parseInt(item.width);
                        const height = parseInt(item.height);
                        const aspectRatio = width / height;

                        // 判斷是否為橫向且比例接近電腦螢幕 (16:9 ≒ 1.77, 16:10 = 1.6)
                        // 這裡設定 1.5 到 1.8 之間，可以抓到主流的電腦桌布尺寸
                        orientationMatch = (aspectRatio >= 1.5 && aspectRatio <= 1.85);
                    }else if (options.orientation === "portrait") {
                        orientationMatch = parseInt(item.height) > parseInt(item.width);
                    }

                    // 3. 檢查類型
                    var typeMatch = true;
                    if (options.type && options.type !== "all") {
                        var typeMap = { "0": "illust", "1": "manga", "2": "ugoira" };
                        typeMatch = typeMap[String(item.illust_type)] === options.type;
                    }

                    // 只有全部符合，才把這個 ID 送去 getImgUrl
                    if (tagMatch && orientationMatch && typeMatch) {
                        ids.push(String(item.illust_id));
                    }
                });

                console.log(`[${date}] 頁面 ${page}: 找到 ${data.contents.length} 件作品，篩選後剩餘 ${ids.length} 件`);
                done(null, ids);
            });
        });
    }

    function fetchNext(page) {
        if (page > pages) {
            // 移除重複 ID
            var finalIds = [...new Set(allIds)]; 
            
            if (finalIds.length === 0) {
                // 只有當「這一天」完全沒圖時才印警告
                console.log(`[${date}] 關鍵字 "${options.tag}" 匹配結果為 0，跳過。`);
                return;
            }

            console.log(`[${date}] 準備下載 ${finalIds.length} 件符合條件的作品...`);

            var baseDir = (options && options.baseDir) ? options.baseDir : ("./picture/" + date);
            if (!fs.existsSync(baseDir)) {
                fs.mkdirSync(baseDir, { recursive: true });
            }

            // 確保這裡傳入的是過濾後的 finalIds
            getImgUrl(finalIds, cookie, date, options);
            return;
        }

        fetchPage(page, function(err, ids) {
            if (err) {
                console.log(`[${date}] 獲取排行榜失敗:`, err.message);
            } else {
                allIds = allIds.concat(ids);
            }
            fetchNext(page + 1);
        });
    }

    fetchNext(1);
}

module.exports = daily_rank;
