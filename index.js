var fs = require("fs");
var request = require("request");
var path = require("path");

var daily_rank = require("./lib/daily_rank.js");

var pixiv_url = "https://www.pixiv.net/";

// 統計資料夾中的檔案數量
function countFilesInDirectory(dirPath) {
    if (!fs.existsSync(dirPath)) {
        return { files: 0, folders: 0, multiImageFolders: 0 };
    }
    
    var stats = { files: 0, folders: 0, multiImageFolders: 0 };
    var items = fs.readdirSync(dirPath);
    
    items.forEach(function(item) {
        var itemPath = path.join(dirPath, item);
        try {
            var stat = fs.statSync(itemPath);
            if (stat.isDirectory()) {
                stats.folders++;
                // 檢查是否為多圖資料夾（格式: ID(count)）
                if (/^\d+\(\d+\)$/.test(item)) {
                    stats.multiImageFolders++;
                }
                // 遞迴統計資料夾內的檔案
                var subStats = countFilesInDirectory(itemPath);
                stats.files += subStats.files;
            } else if (stat.isFile()) {
                stats.files++;
            }
        } catch (err) {
            // 忽略錯誤（如權限問題）
        }
    });
    
    return stats;
}

// 移除資料夾名稱中的數量後綴
function removeFolderCountSuffix(baseDir) {
    var parentDir = path.dirname(baseDir);
    var folderName = path.basename(baseDir);
    
    // 如果資料夾本身存在，遞迴處理其子資料夾
    if (fs.existsSync(baseDir)) {
        removeAllCountSuffixesInDir(baseDir);
        return baseDir;
    }
    
    // 檢查是否有帶數量後綴的版本
    if (!fs.existsSync(parentDir)) {
        return baseDir;
    }
    
    var items = fs.readdirSync(parentDir);
    for (var i = 0; i < items.length; i++) {
        var item = items[i];
        // 檢查是否為 "baseName(數字)" 格式
        var pattern = new RegExp(`^${folderName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\(\\d+\\)$`);
        if (pattern.test(item)) {
            var fullPath = path.join(parentDir, item);
            if (fs.statSync(fullPath).isDirectory()) {
                // 移除數量後綴，方便下載使用
                var cleanPath = path.join(parentDir, folderName);
                try {
                    fs.renameSync(fullPath, cleanPath);
                    // 遞迴處理子資料夾
                    removeAllCountSuffixesInDir(cleanPath);
                    return cleanPath;
                } catch (err) {
                    return fullPath;
                }
            }
        }
    }
    
    return baseDir;
}

// 遞迴移除資料夾內所有子資料夾的數量後綴
function removeAllCountSuffixesInDir(dirPath) {
    if (!fs.existsSync(dirPath)) {
        return;
    }
    
    try {
        var items = fs.readdirSync(dirPath);
        items.forEach(function(item) {
            var itemPath = path.join(dirPath, item);
            try {
                if (fs.statSync(itemPath).isDirectory()) {
                    // 檢查是否有數量後綴
                    var baseName = item.replace(/\(\d+\)$/, '');
                    if (baseName !== item) {
                        // 有後綴，移除它
                        var newPath = path.join(dirPath, baseName);
                        if (!fs.existsSync(newPath)) {
                            fs.renameSync(itemPath, newPath);
                            itemPath = newPath;
                        }
                    }
                    // 遞迴處理子資料夾
                    removeAllCountSuffixesInDir(itemPath);
                }
            } catch (err) {
                // 忽略錯誤
            }
        });
    } catch (err) {
        // 忽略錯誤
    }
}

// 只統計當前資料夾的檔案數（不遞迴）
function countFilesInFolder(dirPath) {
    if (!fs.existsSync(dirPath)) {
        return 0;
    }
    
    try {
        var items = fs.readdirSync(dirPath);
        var count = 0;
        items.forEach(function(item) {
            var itemPath = path.join(dirPath, item);
            if (fs.statSync(itemPath).isFile()) {
                count++;
            }
        });
        return count;
    } catch (err) {
        return 0;
    }
}

// 批量重命名所有子資料夾（包括 _black 等特殊資料夾）
function renameAllFoldersRecursively(rootPath) {
    if (!fs.existsSync(rootPath)) {
        return;
    }
    
    var renamedCount = 0;
    
    // 使用遞迴從最深層開始處理
    function processDir(dirPath) {
        var items;
        try {
            items = fs.readdirSync(dirPath);
        } catch (err) {
            return;
        }
        
        var subDirs = [];
        
        // 先收集所有子資料夾
        items.forEach(function(item) {
            var itemPath = path.join(dirPath, item);
            try {
                if (fs.statSync(itemPath).isDirectory()) {
                    subDirs.push(itemPath);
                }
            } catch (err) {
                // 忽略錯誤
            }
        });
        
        // 遞迴處理子資料夾
        subDirs.forEach(function(subDir) {
            processDir(subDir);
        });
        
        // 處理當前資料夾的所有子資料夾（重命名）
        subDirs.forEach(function(itemPath) {
            var item = path.basename(itemPath);
            try {
                if (fs.existsSync(itemPath) && fs.statSync(itemPath).isDirectory()) {
                    var fileCount = countFilesInFolder(itemPath);
                    var baseName = item.replace(/\(\d+\)$/, '');
                    var newName = `${baseName}(${fileCount})`;
                    
                    if (item !== newName) {
                        var newPath = path.join(dirPath, newName);
                        if (!fs.existsSync(newPath)) {
                            fs.renameSync(itemPath, newPath);
                            renamedCount++;
                        }
                    }
                }
            } catch (err) {
                // 忽略錯誤
            }
        });
    }
    
    processDir(rootPath);
    
    if (renamedCount > 0) {
        // console.log(`\n[完成] 已重命名 ${renamedCount} 個子資料夾`);
    }
    
    // 註冊退出時處理主資料夾重命名
    registerExitRename(rootPath);
}

// 待重命名的主資料夾列表
var pendingRenames = [];

function registerExitRename(dirPath) {
    if (!pendingRenames.includes(dirPath)) {
        pendingRenames.push(dirPath);
    }
}

// 在程式退出前處理主資料夾重命名
process.on('beforeExit', function() {
    pendingRenames.forEach(function(rootPath) {
        try {
            var parentDir = path.dirname(rootPath);
            var folderName = path.basename(rootPath);
            
            // 檢查資料夾是否還存在（可能已被重命名）
            if (!fs.existsSync(rootPath)) {
                return;
            }
            
            var stats = countFilesInDirectory(rootPath);
            var totalFileCount = stats.files;
            var baseName = folderName.replace(/\(\d+\)$/, '');
            var newFolderName = `${baseName}(${totalFileCount})`;
            
            if (folderName !== newFolderName) {
                var newRootPath = path.join(parentDir, newFolderName);
                if (!fs.existsSync(newRootPath)) {
                    fs.renameSync(rootPath, newRootPath);
                    // console.log(`[主資料夾] ${folderName} → ${newFolderName}`);
                }
            }
        } catch (err) {
            // 靜默失敗，不影響程式退出
        }
    });
});

// 支援環境變數設定下載路徑
// 如果是打包後的執行檔，下載到執行檔所在目錄的 picture 資料夾
// 如果是用 node 執行，下載到當前目錄的 picture 資料夾
var BASE_DOWNLOAD_DIR;
if (process.env.DOWNLOAD_DIR) {
    BASE_DOWNLOAD_DIR = process.env.DOWNLOAD_DIR;
} else if (process.pkg) {
    // 打包後的執行檔：使用執行檔所在目錄
    BASE_DOWNLOAD_DIR = path.join(path.dirname(process.execPath), "picture");
} else {
    // 正常 node 執行：使用當前目錄
    BASE_DOWNLOAD_DIR = "./picture";
}

var cookie;

// 顯示幫助信息
function showHelp() {
    console.log(`\n=== Pixiv 圖片下載器 ===\n`);
    console.log(`用法: node index.js [日期/選項]\n`);
    
    console.log(`基本下載模式:`);
    console.log(`  node index.js 20240315                    # 下載指定日期`);
    console.log(`  node index.js --month=202403              # 下載整月`);
    console.log(`  node index.js --year=2024                 # 下載整年`);
    console.log(`  node index.js --id=141449024              # 下載單個作品`);
    console.log(`  node index.js --id-range=125000-125100   # 下載ID範圍\n`);
    
    console.log(`篩選參數:`);
    console.log(`  --tag=標籤1,標籤2         # 必須包含的標籤 (OR邏輯)`);
    console.log(`  --block=標籤1,標籤2       # 排除的標籤`);
    console.log(`  --noword=關鍵字1,關鍵字2   # 排除含特定關鍵字的作品`);
    console.log(`  --folder=資料夾名稱        # 自訂資料夾名稱`);
    console.log(`  --max=數量               # 最大下載數量`);
    
    console.log(`  --orientation=方向        # 圖片方向篩選:`);
    console.log(`    landscape               #   橫向`);
    console.log(`    portrait                #   直向`);
    console.log(`    desktop                 #   桌面比例`);
    console.log(`    nomanga                 #   排除長條漫畫`);
    
    console.log(`  --type=類型              # 作品類型:`);
    console.log(`    illust                  #   插畫`);
    console.log(`    manga                   #   漫畫`);
    console.log(`    ugoira                  #   動圖`);
    console.log(`    all                     #   全部類型\n`);
    
    console.log(`高級篩選:`);
    console.log(`  --block-group="[標籤A,標籤B]"              # AND群組黑名單`);
    console.log(`  --block-group="[標籤A,標籤B)"              # 條件式黑名單\n`);
    
    console.log(`其他選項:`);
    console.log(`  --pages=頁數             # 排行榜頁數 (每頁約50張)`);
    console.log(`  --mode=daily/weekly/monthly # 排行榜類型`);
    console.log(`  --content=illust/all     # 內容類型`);
    console.log(`  --interval=毫秒          # 請求間隔時間`);
    console.log(`  --debug, -d              # 啟用詳細錯誤輸出模式`);
    console.log(`  --help, -h               # 顯示此幫助信息\n`);
    
    console.log(`範例:`);
    console.log(`  # 下載初音未來橫向插畫，最多50張`);
    console.log(`  node index.js --id-range=125000000-125001000 --tag=初音ミク --orientation=landscape --max=50`);
    
    console.log(`  # 下載女孩子原創作品，排除R-18`);
    console.log(`  node index.js 20240315 --tag=女の子,オリジナル --block=R-18 --folder=girls`);
    
    console.log(`  # 下載單個作品並啟用詳細錯誤輸出`);
    console.log(`  node index.js --id=141449024 --folder=single --debug\n`);
}

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
    idRange: null,
    singleId: null,
    debug: false,
    block: null,    debug: false,    nowordBlock: null,
    association: [],
    folder: null,
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
    if (arg.indexOf("--folder=") === 0) {
        options.folder = arg.split("=")[1];
        console.log(`[DEBUG] 解析到 folder 參數: ${options.folder}`);
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

    if (arg === "--debug" || arg === "-d") {
        options.debug = true;
        console.log("[DEBUG] 已啟用詳細錯誤輸出模式");
    }
    if (arg.indexOf("--id=") === 0) {
        var singleId = parseInt(arg.split("=")[1], 10);
        if (!isNaN(singleId) && singleId > 0) {
            options.singleId = singleId;
        } else {
            console.log("[錯誤] ID 格式不正確，格式: --id=141449024");
            process.exit(1);
        }
    }
    if (arg === "--help" || arg === "-h") {
        showHelp();
        process.exit(0);
    }
    if (arg.indexOf("--id-range=") === 0) {
        var rangeValue = arg.split("=")[1];
        var rangeParts = rangeValue.split("-");
        if (rangeParts.length === 2) {
            var startId = parseInt(rangeParts[0], 10);
            var endId = parseInt(rangeParts[1], 10);
            if (!isNaN(startId) && !isNaN(endId) && endId >= startId) {
                options.idRange = { start: startId, end: endId };
            } else {
                console.log("[錯誤] ID 範圍格式不正確，格式: --id-range=125000000-125001000");
            }
        } else {
            console.log("[錯誤] ID 範圍格式不正確，格式: --id-range=125000000-125001000");
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
if (options.folder) {
    console.log(`--folder: ${options.folder}`);
}

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
        console.log("無 Cookie 或未登入（缺少 PHPSESSID）");
    }

    var picture_path = fs.existsSync(BASE_DOWNLOAD_DIR);
    if (!picture_path) {
        fs.mkdirSync(BASE_DOWNLOAD_DIR, { recursive: true });
    }

    // 單個 ID 下載模式
    if (options.singleId) {
        var downloadOptions = Object.assign({}, options);
        downloadOptions.baseDir = BASE_DOWNLOAD_DIR;
        
        daily_rank.downloadSingleId(
            options.singleId,
            cookie,
            downloadOptions,
            function(result) {
                if (result.error) {
                    if (options.debug) {
                        console.log(`[DEBUG] 詳細錯誤信息: ${result.error}`);
                        if (result.stack) {
                            console.log(`[DEBUG] 錯誤堆疊:\n${result.stack}`);
                        }
                    }
                    console.log(`[錯誤] ${result.error}`);
                    process.exit(1);
                }
            }
        );
        return;
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
        
        options.baseDir = BASE_DOWNLOAD_DIR + "/" + tagPrefix + yearArg;
        options.baseDir = removeFolderCountSuffix(options.baseDir);
        
        var months = [];
        for (var m = 1; m <= 12; m++) {
            var monthStr = String(m).padStart(2, "0");
            months.push(yearArg + monthStr);
        }
        
        var currentMonthIndex = 0;
        
        function processNextMonth() {
            if (currentMonthIndex >= months.length) {
                // 批量重命名所有資料夾
                renameAllFoldersRecursively(options.baseDir);
                return;
            }
            
            var currentMonth = months[currentMonthIndex];
            var monthDates = getDatesInMonth(currentMonth);
            
            if (monthDates.length === 0) {
                console.log(`月份 ${currentMonth} 格式錯誤，跳過`);
                currentMonthIndex++;
                processNextMonth();
                return;
            }
            
            var monthOptions = Object.assign({}, options);
            monthOptions.baseDir = BASE_DOWNLOAD_DIR + "/" + tagPrefix + yearArg;
            monthOptions.baseDir = removeFolderCountSuffix(monthOptions.baseDir);
            
     
            daily_rank.processBatchFast(cookie, monthDates, monthOptions, function(result) {
                currentMonthIndex++;
                processNextMonth();
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
        
        options.baseDir = BASE_DOWNLOAD_DIR + "/" + tagPrefix + monthArg;
        options.baseDir = removeFolderCountSuffix(options.baseDir);
        
        
        daily_rank.processBatchFast(cookie, monthDates, options, function(result) {
            // 批量重命名所有資料夾
            renameAllFoldersRecursively(options.baseDir);
        });
        
        return;
    }

    // 單日下載
    if (date.length == 8) {
        options.baseDir = BASE_DOWNLOAD_DIR + "/" + tagPrefix + date;
        options.baseDir = removeFolderCountSuffix(options.baseDir);
        daily_rank(cookie, date, options, function(result) {
            // 批量重命名所有資料夾
            renameAllFoldersRecursively(options.baseDir);
        });
    } else {
        console.log("输入的日期格式不正确");
    }

    // ID 範圍下載模式
    if (options.idRange) {
        var downloadOptions = Object.assign({}, options);
        downloadOptions.baseDir = BASE_DOWNLOAD_DIR;
        
        daily_rank.downloadByIdRange(
            options.idRange.start,
            options.idRange.end,
            cookie,
            downloadOptions
        );
        return;
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
        // 如果是打包後的執行檔，Cookie 路徑也要相對於執行檔目錄
        var actualPath = filePath;
        if (process.pkg && !path.isAbsolute(filePath)) {
            actualPath = path.join(path.dirname(process.execPath), filePath);
        }
        
        let rawContent = fs.readFileSync(actualPath, "utf-8").trim();

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
cookie = "";

if (fs.existsSync(cookiePath)) {
    let convertedCookie = loadAndConvertCookie(cookiePath);
    if (convertedCookie && convertedCookie.trim() !== "" && !convertedCookie.startsWith("#")) {
        cookie = convertedCookie;
    } else {
        cookie = "";
    }
} else {
    cookie = "";
}

// 全域錯誤處理 - 根據 debug 模式決定錯誤輸出詳細程度
if (options.debug) {
    process.on('uncaughtException', function(err) {
        console.log('\n[DEBUG - 嚴重錯誤] 程式遇到未處理的異常:');
        console.log('錯誤類型:', err.name || 'Unknown');
        console.log('錯誤訊息:', err.message || 'No message available');
        if (err.stack) {
            console.log('錯誤堆疊:\n', err.stack);
        }
        console.log('錯誤代碼:', err.code || 'N/A');
        console.log('錯誤來源:', err.fileName || 'Unknown');
        console.log('錯誤行號:', err.lineNumber || 'Unknown');
        console.log('\n請檢查以上詳細錯誤信息並報告此問題。');
        process.exit(1);
    });

    process.on('unhandledRejection', function(reason, promise) {
        console.log('\n[DEBUG - 未處理的Promise拒絕] 於:', promise);
        console.log('原因:', reason);
        if (reason && typeof reason === 'object') {
            console.log('詳細信息:', JSON.stringify(reason, null, 2));
            if (reason.stack) {
                console.log('錯誤堆疊:\n', reason.stack);
            }
        }
    });
} else {
    // 簡化版錯誤處理
    process.on('uncaughtException', function(err) {
        console.log(`\n[錯誤] ${err.message || '程式發生未知錯誤'}`);
        console.log('提示：使用 --debug 參數可查看詳細錯誤信息');
        process.exit(1);
    });

    process.on('unhandledRejection', function(reason, promise) {
        console.log(`\n[錯誤] ${typeof reason === 'string' ? reason : (reason.message || '未處理的Promise錯誤')}`);
        console.log('提示：使用 --debug 參數可查看詳細錯誤信息');
    });
}

startWithCookie(cookie); 