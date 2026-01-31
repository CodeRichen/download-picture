const request = require("request");
const fs = require("fs");
const path = require("path");
const io = require("cheerio");

const getImgUrl = require("./getImgUrl.js");
const counter = require("./requestCounter.js");

// 缓存文件路径
const CACHE_FILE = "./picture/all.json";

// 读取缓存
function loadCache() {
    try {
        if (fs.existsSync(CACHE_FILE)) {
            const data = fs.readFileSync(CACHE_FILE, "utf-8");
            return JSON.parse(data);
        }
    } catch (err) {
        console.log("读取缓存失败:", err.message);
    }
    return {};
}

// 保存缓存
function saveCache(cache) {
    try {
        const dir = path.dirname(CACHE_FILE);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2), "utf-8");
    } catch (err) {
        console.log("保存缓存失败:", err.message);
    }
}

// 获取缓存键
function getCacheKey(date, mode, content, page) {
    return `${date}_${mode}_${content}_p${page}`;
}

function daily_rank(cookie, date, options) {
    var jar = request.jar();
    if (cookie) {
        jar.setCookie(cookie, "https://www.pixiv.net/");
    }

    var mode = (options && options.mode) || "daily";
    var content = (options && options.content) || "illust";
    var pages = (options && options.pages) ? options.pages : 1;
    
    // 處理 block 標籤列表
    var blockTags = [];
    if (options && options.block) {
        blockTags = options.block.split(",").map(tag => tag.trim().toLowerCase());
        console.log("設定屏蔽標籤為:", blockTags.join(", "));
    }
    
    var allIds = [];
    
    // 加载缓存
    var cache = loadCache();
    var cacheUpdated = false;

    function fetchPage(page, done) {
        var cacheKey = getCacheKey(date, mode, content, page);
        
        // 检查缓存
        if (cache[cacheKey]) {
            console.log(`[${date}] 第 ${page} 页：使用缓存数据`);
            // 使用缓存数据
            processPageData(cache[cacheKey], page, done);
            return;
        }
        
        // 缓存不存在，发起请求
        counter.enqueue(function(currentCount) {
            var url = "https://www.pixiv.net/ranking.php?mode=" + mode + "&content=" + content + "&date=" + date + "&format=json";
            if (page > 1) {
                url += "&p=" + page;
            }

            console.log(`[${date}] 获取排行榜第 ${page} 页 (全局累计: ${currentCount})`);

            request({
                url: url,
                headers: {
                    'Referer': "https://www.pixiv.net/ranking.php",
                    'User-Agent': "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                    'Cookie': cookie || ""
                },
                jar: jar,
                json: true
            }, function(err, res, data) {
                if (err) return done(err);

                if (!data || !data.contents) {
                    console.log(`[${date}] 第 ${page} 頁無內容，可能未登入或達到限制`);
                    return done(null, []);
                }
                
                // 保存到缓存
                cache[cacheKey] = data;
                cacheUpdated = true;
                console.log(`[${date}] 第 ${page} 页数据已保存到缓存`);
                
                processPageData(data, page, done);
            });
        });
    }
    
    function processPageData(data, page, done) {
        var ids = [];
     
        data.contents.forEach(function(item) {
            var tagsStr = item.tags.join(" ").toLowerCase();
            
            // 1. 檢查標籤匹配：只要滿足任意一個 tag 即可
            var tagMatch = true;
            if (options.tag) {
                var targetTags = options.tag.split(",").map(tag => tag.trim().toLowerCase());
                tagMatch = false; // 預設為 false，只要找到一個匹配就設為 true
                for (var i = 0; i < targetTags.length; i++) {
                    if (tagsStr.indexOf(targetTags[i]) !== -1) {
                        tagMatch = true;
                        break;
                    }
                }
            }
            
            // 檢查是否包含屏蔽標籤
            var isBlocked = false;
            if (blockTags.length > 0) {
                for (var i = 0; i < blockTags.length; i++) {
                    if (tagsStr.indexOf(blockTags[i]) !== -1) {
                        isBlocked = true;
                        break;
                    }
                }
            }
            
            // 2. 檢查橫直向
            var orientationMatch = true;
            if (options.orientation === "landscape") {
                orientationMatch = parseInt(item.width) > parseInt(item.height);
            } else if (options.orientation === "desktop") {
                const width = parseInt(item.width);
                const height = parseInt(item.height);
                const aspectRatio = width / height;
                orientationMatch = (aspectRatio >= 1.5 && aspectRatio <= 1.85);
            } else if (options.orientation === "portrait") {
                orientationMatch = parseInt(item.height) > parseInt(item.width);
            }

            // 3. 檢查類型
            var typeMatch = true;
            if (options.type && options.type !== "all") {
                var typeMap = { "0": "illust", "1": "manga", "2": "ugoira" };
                typeMatch = typeMap[String(item.illust_type)] === options.type;
            }

            // 只有全部符合且不在屏蔽列表中，才加入下載清單
            if (tagMatch && orientationMatch && typeMatch && !isBlocked) {
                ids.push(String(item.illust_id));
            }
        });

        console.log(`[${date}] 頁面 ${page}: 找到 ${data.contents.length} 件作品，篩選後剩餘 ${ids.length} 件`);
        done(null, ids);
    }

    function fetchNext(page) {
        if (page > pages) {
            // 保存缓存（如果有更新）
            if (cacheUpdated) {
                console.log(`\n[缓存] 保存新数据到 ${CACHE_FILE}...`);
                saveCache(cache);
                console.log("[缓存] 保存完成 ✓\n");
            }
            
            var finalIds = [...new Set(allIds)]; 
            
            if (finalIds.length === 0) {
                console.log(`[${date}] 篩選條件匹配結果為 0，跳過。`);
                return;
            }

            console.log(`[${date}] 準備下載 ${finalIds.length} 件符合條件的作品...`);

            var baseDir = (options && options.baseDir) ? options.baseDir : ("./picture/" + date);
            if (!fs.existsSync(baseDir)) {
                fs.mkdirSync(baseDir, { recursive: true });
            }

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