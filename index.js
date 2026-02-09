var https = require("https");
var fs = require("fs");
var path = require("path");
var request = require("request");

var login = require("./lib/login.js");
var save = require("./lib/save.js");

var imgHead = "https://i.pximg.net/img-original";

var pixiv_url = "https://www.pixiv.net/";

var cookie;

var args = process.argv.slice(2);
var _date = args.find(function(a) { return /^\d{8}$/.test(a); });
var today = new Date();
today.setTime(today - 24 * 60 * 60 * 1000);
var day = JSON.stringify(today.getDate()).length < 2 ? "0" + today.getDate() : today.getDate();
var month = JSON.stringify(today.getMonth() + 1).length < 2 ? "0" + (today.getMonth() + 1) : today.getMonth() + 1;
var year = today.getFullYear();
var date = _date || year + month + day;

var options = {
    max: null,
    orientation: "any",
    type: "all",
    mode: "daily",
    content: "illust",
    pages: 1,
    baseDir: null,
    interval: 1000,
    tag: null,
    block: null,      // 屏蔽標籤（智能匹配）
    nowordBlock: null, // --noword 後的屏蔽標籤（強制部分匹配）
    tool: false,      // 是否記錄標籤到 txt 檔案
    one: false,       // 禁止多圖作品（--one）
    downloadAll: false, // 下載多圖的所有圖片

};

var monthArg = null;
var yearArg = null;

args.forEach(function(arg) {
    if (arg.indexOf("--max=") === 0) {
        var v = parseInt(arg.split("=")[1], 10);
        options.max = isNaN(v) ? null : v;
    }
    if (arg.indexOf("--orientation=") === 0) {
        options.orientation = arg.split("=")[1];
    }
    if (arg.indexOf("--type=") === 0) {
        options.type = arg.split("=")[1];
    }
    if (arg.indexOf("--mode=") === 0) {
        options.mode = arg.split("=")[1];
    }
    if (arg.indexOf("--content=") === 0) {
        options.content = arg.split("=")[1];
    }
    if (arg.indexOf("--pages=") === 0) {
        var p = parseInt(arg.split("=")[1], 10);
        options.pages = isNaN(p) || p < 1 ? 1 : p;
    }
    if (arg.indexOf("--month=") === 0) {
        monthArg = arg.split("=")[1];
    }
    if (arg.indexOf("--year=") === 0) {
        yearArg = arg.split("=")[1];
    }
    if (arg.indexOf("--interval=") === 0) {
        var itv = parseInt(arg.split("=")[1], 10);
        options.interval = isNaN(itv) || itv < 0 ? 1000 : itv;
    }
    if (arg.indexOf("--tag=") === 0) {
        var newTag = arg.split("=")[1].replace(/\s/g, "");
        if (options.tag) {
            options.tag += "," + newTag; // 累加，不覆蓋
        } else {
            options.tag = newTag;
        }
    }
    // 新增：解析 --block 參數（去除所有空格，支持多次使用）
    if (arg.indexOf("--block=") === 0) {
        var newBlock = arg.split("=")[1].replace(/\s/g, "");
        if (options.block) {
            options.block += "," + newBlock; // 累加，不覆蓋
        } else {
            options.block = newBlock;
        }

    }
    // 新增：解析 --noword 參數（強制部分匹配，支持多次使用）
    if (arg.indexOf("--noword=") === 0) {
        var newNoword = arg.split("=")[1].replace(/\s/g, "");
        if (options.nowordBlock) {
            options.nowordBlock += "," + newNoword; // 累加，不覆蓋
        } else {
            options.nowordBlock = newNoword;
        }

    }
if (arg.indexOf("--block-group=") === 0) {
    // 1. 取得原始字串並去掉引號
    var rawGroups = arg.split("=")[1].replace(/\"/g, "");

    // 2. 先處理特殊格式 [ A, B ) -> 條件屏蔽
    // 使用正則匹配 [ ... )，避免受到 [ ... ] 的干擾
    var condMatches = rawGroups.match(/\[[^\]]*\)/g);
    if (condMatches) {
        if (!options.conditionalBlocks) options.conditionalBlocks = [];
        condMatches.forEach(m => {
            var tags = m.replace(/[\[\)]/g, "").split(",").map(t => t.trim()).filter(t => t);
            if (tags.length >= 2) {
                options.conditionalBlocks.push({
                    ifExists: tags[0],
                    mustHave: tags[1]
                });
            }
        });
    }

    // 3. 再處理普通格式 [ A, B ] -> 群組屏蔽
    var normalMatches = rawGroups.match(/\[[^\]]*\]/g);
    if (normalMatches) {
        if (!options.blockGroups) options.blockGroups = [];
        normalMatches.forEach(m => {
            var tags = m.replace(/[\[\]]/g, "").split(",").map(t => t.trim().toLowerCase()).filter(t => t);
            options.blockGroups.push(tags);
        });
    }
}

    // 新增：解析 --tool 參數
    if (arg === "--tool") {
        options.tool = true;
        // console.log("已啟用標籤記錄功能");
    }
    // 新增：解析 --one 參數
    if (arg === "--one") {
        options.one = true;
        // console.log("已啟用單圖模式（禁止多圖作品）");
    }
    // 新增：解析 --all 參數（下載多圖的所有圖片）
    if (arg === "--all") {
        options.downloadAll = true;
        // console.log("已啟用多圖完整下載模式");
    }

});

// 顯示篩選標籤彙總
if (options.tag) {
    var tagCount = options.tag.split(",").length;
    console.log(`--tag: ${tagCount} `);
    console.log(`  ${options.tag}`);
}


if (options.block || options.nowordBlock) {

    if (options.block) {
        var blockCount = options.block.split(",").length;
        console.log(`--block: ${blockCount}`);
        console.log(`  ${options.block}`);
    }
    if (options.nowordBlock) {
        var nowordCount = options.nowordBlock.split(",").length;
        console.log(`--noword: ${nowordCount} `);
        console.log(`  ${options.nowordBlock}`);
    }
if (options.blockGroups && options.blockGroups.length > 0) {
    console.log(`--block-group (AND Block): ${options.blockGroups.length}`);
    options.blockGroups.forEach((g, index) => {
        // 在每組之間加上空格
        process.stdout.write(`[${g.join(" & ")}] `);
    });
    console.log(); 
}

if (options.conditionalBlocks && options.conditionalBlocks.length > 0) {
    console.log(`--conditional-blocks (If A then B): ${options.conditionalBlocks.length}`);
    options.conditionalBlocks.forEach(r => {
        console.log(`  若作品有 [${r.ifExists}] 則必須包含 [${r.mustHave}]`);
    });
}
}

function getDatesInMonth(ym) {
    if (!/^\d{6}$/.test(ym)) {
        return [];
    }
    var y = parseInt(ym.slice(0, 4), 10);
    var m = parseInt(ym.slice(4, 6), 10) - 1;
    var d = new Date(y, m, 1);
    var dates = [];
    while (d.getMonth() === m) {
        var day = String(d.getDate()).padStart(2, "0");
        var month = String(d.getMonth() + 1).padStart(2, "0");
        dates.push(String(d.getFullYear()) + month + day);
        d.setDate(d.getDate() + 1);
    }
    return dates;
}

function getDatesInYear(y) {
    if (!/^\d{4}$/.test(y)) {
        return [];
    }
    var year = parseInt(y, 10);
    var dates = [];
    
    // 遍歷 12 個月
    for (var month = 0; month < 12; month++) {
        var d = new Date(year, month, 1);
        while (d.getMonth() === month) {
            var day = String(d.getDate()).padStart(2, "0");
            var monthStr = String(d.getMonth() + 1).padStart(2, "0");
            dates.push(String(d.getFullYear()) + monthStr + day);
            d.setDate(d.getDate() + 1);
        }
    }
    
    return dates;
}

function startWithCookie(cookie) {
    // console.log("Cookie loaded: " + cookie + "\n");

    if (cookie.indexOf("PHPSESSID") === -1) {
        console.log("警告：Cookie 可能未登入（缺少 PHPSESSID），若無法下載請改用瀏覽器 Cookie。");
    }

    var picture_path = fs.existsSync("./picture");
    if (!picture_path) {
        fs.mkdirSync("./picture");
    }

    var tagPrefix = "";
    if (options.tag) {
        // 取得第一個標籤，並過濾掉資料夾不允許的特殊字元
        var firstTag = options.tag.split(",")[0].replace(/[\\/:*?"<>|]/g, "_");
        tagPrefix = firstTag + "_";
    }
    // 處理 --year 參數
    if (yearArg) {
        var yearDates = getDatesInYear(yearArg);
        if (yearDates.length === 0) {
            console.log("输入的年份格式不正确，格式为 YYYY");
            return;
        }
    
        
        // 加載共享緩存

        var sharedCache = daily_rank.loadCache();

        
        options.baseDir = "./picture/" + tagPrefix + yearArg;
        var i = 0;
        (function runNext() {
            if (i >= yearDates.length) {

                daily_rank.saveCache(sharedCache);
                
                // console.log("cycle complete");

                return;
            }
            // console.log(`\n--- 開始處理第 ${i + 1}/${yearDates.length} 天: ${yearDates[i]} ---`);
            daily_rank(cookie, yearDates[i], options, sharedCache);
            i++;
            setTimeout(runNext, options.interval);
        })();
        return;
    }

    if (monthArg) {
        var monthDates = getDatesInMonth(monthArg);
        if (monthDates.length === 0) {
            console.log("输入的月份格式不正确，格式为 YYYYMM");
            return;
        }

        
        // 加載共享緩存
        // console.log("[緩存] 加載共享緩存...");
        var sharedCache = daily_rank.loadCache();
        // console.log("[緩存] 共享緩存加載完成\n");
        
        options.baseDir = "./picture/" + tagPrefix + monthArg;
        var i = 0;
        (function runNext() {
            if (i >= monthDates.length) {

                // console.log("cycle complete");
                return;
            }
            // console.log(`\n--- 開始處理第 ${i + 1}/${monthDates.length} 天: ${monthDates[i]} ---`);
            daily_rank(cookie, monthDates[i], options, sharedCache);
            i++;
            setTimeout(runNext, options.interval);
        })();
        return;
    }

    if (date.length == 8) {
        daily_rank(cookie, date, options);
    } else {
        console.log("输入的日期格式不正确");
    }

    // test cookie 
    var jar = request.jar();
    jar.setCookie(cookie, pixiv_url);
    request({
        url: pixiv_url,
        headers: {
            'Referer': pixiv_url,
            'User-Agent': "Mozilla/5.0 (Windows NT 6.3; rv:27.0) Gecko/20100101 Firefox/27.0",
        },
        jar: jar
    }, function(err, res, body) {
        if (!fs.existsSync("./log")) {
            fs.mkdirSync("./log");
        }
        fs.writeFile("./log/pixiv.html", body, "utf-8", function() {});
    });
}

function loadAndConvertCookie(filePath) {
    try {
        let rawContent = fs.readFileSync(filePath, "utf-8").trim();
        let finalCookie = "";

        if (rawContent.startsWith("[")) {
            // console.log("偵測到 JSON 格式 Cookie，正在自動轉換...");
            let cookieArray = JSON.parse(rawContent);
            
            finalCookie = cookieArray
                .map(item => `${item.name}=${item.value}`)
                .join("; ");
        } else {
            finalCookie = rawContent.replace(/[\r\n]/g, "");
        }

        return finalCookie;
    } catch (err) {
        console.error("讀取或解析 Cookie 檔案失敗:", err.message);
        return null;
    }
}

let cookiePath = "cookie/pixiv.txt";
if (fs.existsSync(cookiePath)) {
    let convertedCookie = loadAndConvertCookie(cookiePath);
    if (convertedCookie) {
        // console.log("Cookie 轉換成功！長度:", convertedCookie.length);
        cookie = convertedCookie;
        startWithCookie(cookie);
    }
}