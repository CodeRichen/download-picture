var fs = require("fs");
var request = require("request");

var daily_rank = require("./lib/daily_rank.js");

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
    association: [],
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

    if (arg.indexOf("--association=") === 0) {
        var associationValue = arg.split("=")[1];
        if (associationValue) {
            options.association = associationValue.split(",").map(function(item) {
                return item.trim();
            });
        }
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
                console.log(`-fin(y)`);
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
            
     
            daily_rank.processBatchFast(cookie, monthDates, monthOptions, function(result) {
                currentMonthIndex++;
                setTimeout(processNextMonth, 1000);
            });
        }
        
        processNextMonth();
        return;
    }

    if (monthArg) {
        var monthDates = getDatesInMonth(monthArg);
        if (monthDates.length === 0) {
            console.log("输入的月份格式不正确，格式为 YYYYMM");
            return;
        }
        
        options.baseDir = "./picture/" + tagPrefix + monthArg;
        
        
        daily_rank.processBatchFast(cookie, monthDates, options, function(result) {
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
    } else {
        console.error("Cookie 檔案格式錯誤或為空，請檢查 cookie/pixiv.txt 內容。");
    }
} else {
    console.error("找不到 cookie 檔案 (cookie/pixiv.txt)。請參考 README 說明建立 Cookie 檔案。");
}