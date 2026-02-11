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
    interval: 10,
    tag: null,
    block: null,
    nowordBlock: null,
    tool: false,
    one: false,
    downloadAll: false,
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
            options.tag += "," + newTag;
        } else {
            options.tag = newTag;
        }
    }
    if (arg.indexOf("--block=") === 0) {
        var newBlock = arg.split("=")[1].replace(/\s/g, "");
        if (options.block) {
            options.block += "," + newBlock;
        } else {
            options.block = newBlock;
        }
    }
    if (arg.indexOf("--noword=") === 0) {
        var newNoword = arg.split("=")[1].replace(/\s/g, "");
        if (options.nowordBlock) {
            options.nowordBlock += "," + newNoword;
        } else {
            options.nowordBlock = newNoword;
        }
    }
 if (arg.indexOf("--block-group=") === 0) {

    // 取得原始字串並移除雙引號
    var rawGroups = arg.split("=")[1].replace(/\"/g, "");

    // 抓出所有 [ ... ] 或 [ ... )
    var allMatches = rawGroups.match(/\[[^\[\]]+?[\]\)]/g);

    if (allMatches) {

        allMatches.forEach(m => {

            // 判斷是否為 conditional (結尾是 ')')
            var isConditional = m.endsWith(")");

            // 去掉外層括號
            var inner = m.slice(1, -1);

            // 分割 tag
            var tags = inner
                .split(",")
                .map(t => t.trim())
                .filter(t => t);

            if (tags.length < 2) return;

            if (isConditional) {
                // ===== 條件式 If A then B =====
                if (!options.conditionalBlocks)
                    options.conditionalBlocks = [];

                options.conditionalBlocks.push({
                    ifExists: tags[0],   // 保留大小寫
                    mustHave: tags[1]
                });

            } else {
                // ===== 一般 AND block =====
                if (!options.blockGroups)
                    options.blockGroups = [];

                options.blockGroups.push(
                    tags.map(t => t.toLowerCase())
                );
            }

        });
    }
}

    if (arg === "--tool") {
        options.tool = true;
    }
    if (arg === "--one") {
        options.one = true;
    }
    if (arg === "--all") {
        options.downloadAll = true;
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

/**
 * 新增：月度批量處理函數
 * 一次性請求整個月的所有 API，然後並行下載
 */
function processMonthBatch(cookie, monthDates, options, onMonthComplete) {
    if (!monthDates || monthDates.length === 0) {
        if (onMonthComplete) onMonthComplete({ total: 0, completed: 0, failed: 0 });
        return;
    }
    
    var monthStr = monthDates[0].substring(0, 6); // 例如: "202501"

    
    var completedDays = 0;
    var totalMonthIllusts = 0;
    var completedMonthIllusts = 0;
    var failedMonthIllusts = 0;
    
    // 為每個日期創建獨立的 options
    var dailyOptionsList = monthDates.map(function(date) {
        return Object.assign({}, options);
    });
    
    // 第1階段：批量請求所有日期的 API（不下載）
    var dateIndex = 0;
    function requestNextDay() {
        if (dateIndex >= monthDates.length) {
            // API 請求完成，開始下載階段

            startDownloading();
            return;
        }
        
        var currentDate = monthDates[dateIndex];
        var dailyOpt = dailyOptionsList[dateIndex];
        
        // 使用 daily_rank 但設置特殊標記，只請求 API 不下載
        dailyOpt._apiOnlyMode = true;
        
        daily_rank(cookie, currentDate, dailyOpt, function(result) {
            completedDays++;
            // console.log(`[API請求] ${currentDate} 完成 (${completedDays}/${monthDates.length})`);
            dateIndex++;
            // 快速連續請求，因為只是 API 請求
            setTimeout(requestNextDay, 10);
        });
    }
    
    // 第2階段：並行下載所有作品
    function startDownloading() {
        var downloadIndex = 0;
        var downloadCompletedDays = 0;
        
        function downloadNextDay() {
            if (downloadIndex >= monthDates.length) {
                
                if (onMonthComplete) {
                    onMonthComplete({
                        month: monthStr,
                        total: totalMonthIllusts,
                        completed: completedMonthIllusts,
                        failed: failedMonthIllusts
                    });
                }
                return;
            }
            
            var currentDate = monthDates[downloadIndex];
            var dailyOpt = dailyOptionsList[downloadIndex];
            
            // 移除 API only 標記，啟動下載
            delete dailyOpt._apiOnlyMode;
            
            daily_rank(cookie, currentDate, dailyOpt, function(result) {
                totalMonthIllusts += result.total;
                completedMonthIllusts += result.completed;
                failedMonthIllusts += result.failed;
                downloadCompletedDays++;
                
                // console.log(`[下載] ${currentDate} 完成 (${downloadCompletedDays}/${monthDates.length})`);
                
                downloadIndex++;
                // 下載之間保持間隔
                var delay = (result.total === 0) ? 10 : options.interval;
                setTimeout(downloadNextDay, delay);
            });
        }
        
        downloadNextDay();
    }
    
    requestNextDay();
}

function startWithCookie(cookie) {
    if (cookie.indexOf("PHPSESSID") === -1) {
        console.log("警告：Cookie 可能未登入（缺少 PHPSESSID），若無法下載請改用瀏覽器 Cookie。");
    }

    var picture_path = fs.existsSync("./picture");
    if (!picture_path) {
        fs.mkdirSync("./picture");
    }

    var tagPrefix = "";
    if (options.tag) {
        var firstTag = options.tag.split(",")[0].replace(/[\\/:*?"<>|]/g, "_");
        tagPrefix = firstTag + "_";
    }
    
    // *** 極速處理年份：使用 processBatchFast ***
    if (yearArg) {
        if (!/^\d{4}$/.test(yearArg)) {
            console.log("输入的年份格式不正确，格式为 YYYY");
            return;
        }
        
        options.baseDir = "./picture/" + tagPrefix + yearArg;
        
        var months = [];
        for (var m = 1; m <= 12; m++) {
            var monthStr = String(m).padStart(2, "0");
            months.push(yearArg + monthStr);
        }
        
        var currentMonthIndex = 0;
        
        function processNextMonth() {
            if (currentMonthIndex >= months.length) {
                console.log(`\n=== 年份 ${yearArg} 處理完成 ===`);
                return;
            }
            
            var currentMonth = months[currentMonthIndex];
            var monthDates = getDatesInMonth(currentMonth);
            
            if (monthDates.length === 0) {
                console.log(`月份 ${currentMonth} 格式錯誤，跳過`);
                currentMonthIndex++;
                setTimeout(processNextMonth, 100);
                return;
            }
            
            var monthOptions = Object.assign({}, options);
            monthOptions.baseDir = "./picture/" + tagPrefix + yearArg;
            
            // *** 使用極速批量處理 ***
            daily_rank.processBatchFast(cookie, monthDates, monthOptions, function(result) {
                currentMonthIndex++;
                setTimeout(processNextMonth, 1000);
            });
        }
        
        processNextMonth();
        return;
    }

    // *** 極速處理月份：使用 processBatchFast ***
    if (monthArg) {
        var monthDates = getDatesInMonth(monthArg);
        if (monthDates.length === 0) {
            console.log("输入的月份格式不正确，格式为 YYYYMM");
            return;
        }
        
        options.baseDir = "./picture/" + tagPrefix + monthArg;
        
        // *** 使用極速批量處理 ***
        daily_rank.processBatchFast(cookie, monthDates, options, function(result) {
            // console.log("\n月份處理完成");
        });
        
        return;
    }

    // 單日下載
    if (date.length == 8) {
        options.baseDir = "./picture/" + tagPrefix + date;
        daily_rank(cookie, date, options, function(result) {
            // console.log(`單日下載完成: 總計 ${result.total}, 成功 ${result.completed}, 失敗 ${result.failed}`);
        });
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

        if (rawContent.startsWith("[")) {
            let cookieArray = JSON.parse(rawContent);
            rawContent = null;
            
            let finalCookie = cookieArray
                .map(item => `${item.name}=${item.value}`)
                .join("; ");
            
            cookieArray = null;
            return finalCookie;
        } else {
            let finalCookie = rawContent.replace(/[\r\n]/g, "");
            rawContent = null;
            return finalCookie;
        }
    } catch (err) {
        console.error("讀取或解析 Cookie 檔案失敗:", err.message);
        return null;
    }
}

let cookiePath = "cookie/pixiv.txt";
if (fs.existsSync(cookiePath)) {
    let convertedCookie = loadAndConvertCookie(cookiePath);
    if (convertedCookie) {
        cookie = convertedCookie;
        startWithCookie(cookie);
    }
}