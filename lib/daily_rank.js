const request = require("request");
const fs = require("fs");
const path = require("path");
const io = require("cheerio");

const getImgUrl = require("./getImgUrl.js");
const counter = require("./requestCounter.js");

const CACHE_DIR = "./picture";
const LOCK_FILE = "./picture/cache.lock";



// 清理过期的锁文件
function cleanupStaleLocks() {
    if (fs.existsSync(LOCK_FILE)) {
        try {
            const lockTime = parseInt(fs.readFileSync(LOCK_FILE, "utf-8"));
            const now = Date.now();
            if (now - lockTime > 30000) {
                fs.unlinkSync(LOCK_FILE);
            }
        } catch (err) {
            try {
                fs.unlinkSync(LOCK_FILE);
            } catch (e) {}
        }
    }
}

cleanupStaleLocks();

// 從日期字串提取年份
function getYearFromDate(date) {
    return date.substring(0, 4);
}

// 獲取年份緩存檔案路徑
function getYearCacheFile(year) {
    return path.join(CACHE_DIR, `${year}.json`);
}

// 載入特定年份的緩存
function loadYearCache(year) {
    const cacheFile = getYearCacheFile(year);
    
    try {
        if (fs.existsSync(cacheFile)) {
            const data = fs.readFileSync(cacheFile, "utf-8");
            const parsed = JSON.parse(data);
            if (typeof parsed === 'object' && parsed !== null) {
                return parsed;
            }
        }
    } catch (err) {
        // 解析失敗，返回空對象
    }
    return {};
}

// 載入特定鍵的緩存（自動判斷年份）
function loadCacheKey(key) {
    const dateMatch = key.match(/^(\d{8})/);
    if (!dateMatch) {
        return null;
    }
    
    const date = dateMatch[1];
    const year = getYearFromDate(date);
    const yearCache = loadYearCache(year);
    
    return yearCache[key] || null;
}

// 批量載入多個鍵（按年份分組）
function loadCacheKeys(keys) {
    const result = {};
    
    // 按年份分組
    const yearGroups = {};
    keys.forEach(key => {
        const dateMatch = key.match(/^(\d{8})/);
        if (dateMatch) {
            const year = getYearFromDate(dateMatch[1]);
            if (!yearGroups[year]) {
                yearGroups[year] = [];
            }
            yearGroups[year].push(key);
        }
    });
    
    // 讀取每個年份的緩存並立即釋放記憶體
    for (const year in yearGroups) {
        const yearCache = loadYearCache(year);
        yearGroups[year].forEach(key => {
            if (yearCache[key]) {
                result[key] = yearCache[key];
            }
        });
        yearGroups[year] = null;
    }
    
    return result;
}

// 保存緩存鍵（按年份分組保存）
function saveCacheKeys(newKeys) {
    if (Object.keys(newKeys).length === 0) {
        return true;
    }
    
    // 按年份分組
    const yearGroups = {};
    for (const key in newKeys) {
        const dateMatch = key.match(/^(\d{8})/);
        if (dateMatch) {
            const year = getYearFromDate(dateMatch[1]);
            if (!yearGroups[year]) {
                yearGroups[year] = {};
            }
            yearGroups[year][key] = newKeys[key];
        }
    }
    
    // 保存每個年份的緩存
    for (const year in yearGroups) {
        saveYearCache(year, yearGroups[year]);
    }
    
    return true;
}

// 保存特定年份的緩存
function saveYearCache(year, newKeys) {
    const maxRetries = 10;
    let retries = 0;
    
    const cacheFile = getYearCacheFile(year);
    
    while (retries < maxRetries) {
        if (!fs.existsSync(LOCK_FILE)) {
            try {
                // 創建鎖文件
                fs.writeFileSync(LOCK_FILE, Date.now().toString());
                
                // 確保目錄存在
                if (!fs.existsSync(CACHE_DIR)) {
                    fs.mkdirSync(CACHE_DIR, { recursive: true });
                }
                
                // 讀取現有年份緩存
                let existingCache = {};
                if (fs.existsSync(cacheFile)) {
                    try {
                        const data = fs.readFileSync(cacheFile, "utf-8");
                        existingCache = JSON.parse(data);
                    } catch (err) {
                        // 檔案損壞，使用空物件
                    }
                }
                
                // 合併新鍵（新數據會覆蓋舊數據）
                const mergedCache = Object.assign({}, existingCache, newKeys);
                
                // 原子寫入
                const tempFile = cacheFile + ".tmp";
                const jsonStr = JSON.stringify(mergedCache, null, 2);
                fs.writeFileSync(tempFile, jsonStr, "utf-8");
                fs.renameSync(tempFile, cacheFile);
                
                // 刪除鎖文件
                fs.unlinkSync(LOCK_FILE);
                return true;
                
            } catch (err) {
                // 清理鎖文件
                if (fs.existsSync(LOCK_FILE)) {
                    try {
                        fs.unlinkSync(LOCK_FILE);
                    } catch (unlockErr) {}
                }
                return false;
            }
        }
        
        // 等待重試
        retries++;
        const waitTime = 100 * retries;
        const start = Date.now();
        while (Date.now() - start < waitTime) {}
    }
    
    return false;
}

// 驗證緩存完整性
function validateCache(cache) {
    let validCount = 0;
    let invalidCount = 0;
    
    for (const key in cache) {
        if (cache[key] && cache[key].contents && Array.isArray(cache[key].contents)) {
            validCount++;
        } else {
            invalidCount++;
        }
    }
    
    return invalidCount === 0;
}

// 獲取緩存鍵
function getCacheKey(date, mode, content, page) {
    return `${date}_${mode}_${content}_p${page}`;
}


function loadDownloadedIllustIds(baseDir) {
    const downloadedIds = new Set();
    
    // 檢查普通 tags 文件
    const tagsTxtPath = path.join(baseDir, "_tags.txt");
    if (fs.existsSync(tagsTxtPath)) {
        const content = fs.readFileSync(tagsTxtPath, 'utf8');
        const lines = content.split('\n');
        lines.forEach(line => {
            const match = line.match(/ID:\s*(\d+)\s*\|/);
            if (match) {
                downloadedIds.add(match[1]);
            }
        });
    }
    
    // 檢查 black tags 文件
    const blackTagsTxtPath = path.join(baseDir, "_black", "_tags.txt");
    if (fs.existsSync(blackTagsTxtPath)) {
        const content = fs.readFileSync(blackTagsTxtPath, 'utf8');
        const lines = content.split('\n');
        lines.forEach(line => {
            const match = line.match(/ID:\s*(\d+)\s*\|/);
            if (match) {
                downloadedIds.add(match[1]);
            }
        });
    }
    
    return downloadedIds;
}

// 更新緩存中的作品狀態
function updateIllustStatus(cache, date, mode, content, illustId, status, updatedKeys) {
    const searchPrefix = `${date}_${mode}_${content}_p`;
    var updated = false;
    
    for (var key in cache) {
        if (!key.startsWith(searchPrefix)) continue;
        
        var pageData = cache[key];
        if (!pageData || !pageData.contents || !Array.isArray(pageData.contents)) continue;
        
        var targetItem = pageData.contents.find(item => 
            String(item.illust_id) === String(illustId)
        );
        
        if (targetItem) {
            targetItem.status = status;
            updatedKeys[key] = pageData;
            updated = true;
            break;
        }
    }
    
    return updated;
}

/**
 * 檢查作品是否已在 tags 文件中記錄
 * @param {string} baseDir - 基礎目錄
 * @param {string} illustId - 作品 ID
 * @param {Array} itemTags - 作品標籤陣列
 * @returns {boolean} - 如果已記錄則返回 true
 */
function isIllustInTagsFile(baseDir, illustId, itemTags) {
    var tagsTxtPath = path.join(baseDir, "_tags.txt");
    var blackTagsTxtPath = path.join(baseDir, "_black", "_tags.txt");
    
    // 檢查普通 tags 文件
    if (fs.existsSync(tagsTxtPath)) {
        var content = fs.readFileSync(tagsTxtPath, 'utf8');
        var idPattern = `ID: ${illustId} |`;
        if (content.includes(idPattern)) {
            // 進一步檢查標籤是否匹配（防止誤判）
            var lines = content.split('\n');
            for (var i = 0; i < lines.length; i++) {
                if (lines[i].includes(idPattern)) {
                    return true; // 找到匹配的記錄
                }
            }
        }
    }
    
    // 檢查 black tags 文件
    if (fs.existsSync(blackTagsTxtPath)) {
        var blackContent = fs.readFileSync(blackTagsTxtPath, 'utf8');
        var idPattern = `ID: ${illustId} |`;
        if (blackContent.includes(idPattern)) {
            var lines = blackContent.split('\n');
            for (var i = 0; i < lines.length; i++) {
                if (lines[i].includes(idPattern)) {
                    return true;
                }
            }
        }
    }
    
    return false;
}

/**
 * 單日下載函數
 */
function daily_rank(cookie, date, options, onComplete) {

    
    var jar = request.jar();
    var tagPrefix = "";
    if (options.tag) {
        var firstTag = options.tag.split(",")[0].replace(/[\\/:*?"<>|]/g, "_");
        tagPrefix = firstTag + "_";
    }

    if (cookie) {
        jar.setCookie(cookie, "https://www.pixiv.net/");
    }

    var mode = (options && options.mode) || "daily";
    var content = (options && options.content) || "illust";
    var pages = (options && options.pages) ? options.pages : 1;
    
    // 預先轉換為小寫
    var blockTags = [];
    if (options && options.block) {
        blockTags = options.block.split(",").map(tag => tag.trim().toLowerCase());
    }
    
    var nowordBlockTags = [];
    if (options && options.nowordBlock) {
        nowordBlockTags = options.nowordBlock.split(",").map(tag => tag.trim().toLowerCase());
    }
    
    var targetTags = [];
    if (options && options.tag) {
        targetTags = options.tag.split(",").map(tag => tag.trim().toLowerCase());
    }
    
    var allIds = [];
    var pageMap = {};
    
    // 載入當前年份的緩存
    const year = getYearFromDate(date);
    var cache = loadYearCache(year);

    var cacheUpdated = false;
    var updatedKeys = {};
    
    var totalIllusts = 0;
    var completedIllusts = 0;
    var failedIllusts = 0;


    var baseDir = (options && options.baseDir) ? options.baseDir : ("./picture/" + date);
    var downloadedIds = loadDownloadedIllustIds(baseDir);

    var failureCallback = function(illustId, errorMsg) {
        var updated = updateIllustStatus(cache, date, mode, content, illustId, "failed", updatedKeys);
        if (updated) {
            cacheUpdated = true;
        }
        failedIllusts++;
        checkIfAllComplete();
    };
    
    var downloadSuccessCallback = function(illustId, status, tags, metadata) {
        var updated = updateIllustStatus(cache, date, mode, content, illustId, status, updatedKeys);
        if (updated) {
            cacheUpdated = true;
        }
        if (status === "finish") {
            completedIllusts++;
        } else if (status === "failed") {
            failedIllusts++;
        }
        checkIfAllComplete();
    };
    
    function checkIfAllComplete() {
        var processed = completedIllusts + failedIllusts;
        if (processed >= totalIllusts && totalIllusts > 0) {
            if (cacheUpdated) {
                saveCacheKeys(updatedKeys);
            }
            
            // console.log(`[${date}] status: ${completedIllusts}/${totalIllusts}`);
            
            cache = null;
            updatedKeys = null;
            allIds = null;
            pageMap = null;
            
            if (onComplete && typeof onComplete === 'function') {
                onComplete({
                    date: date,
                    total: totalIllusts,
                    completed: completedIllusts,
                    failed: failedIllusts
                });
            }
        }
    }

    function fetchPage(page, done) {
        var cacheKey = getCacheKey(date, mode, content, page);
        
        if (cache[cacheKey]) {
            setImmediate(function() {
                processPageData(cache[cacheKey], page, done);
            });
            return;
        }
        
        counter.enqueue(function(currentCount) {
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
                json: true
            }, function(err, res, data) {
                if (err) return done(err);

                if (!data || !data.contents) {
                    return done(null, []);
                }
                
                data.contents.forEach(function(item) {
                    if (!item.status) {
                        item.status = "undownload";
                    }
                });
                
                cache[cacheKey] = data;
                updatedKeys[cacheKey] = data;
                cacheUpdated = true;
                
                processPageData(data, page, done);
            });
        });
    }
    
    function processPageData(data, page, done) {
        var ids = [];

        data.contents.forEach(function(item) {
            var illustId = String(item.illust_id);
            
            if (!item.status) {
                item.status = "undownload";
            }


            if (downloadedIds.has(illustId)) {
                item.status = "finish";
                return; // 跳過
            }
            
            var tagsArray, tagsStr;
            if (item.tags) {
                tagsArray = item.tags.map(tag => tag.toLowerCase());
                tagsStr = tagsArray.join(" ");
            } else {
                tagsArray = [];
                tagsStr = "";
            }
            
            var tagMatch = true;
            if (targetTags.length > 0) {
                tagMatch = false;
                for (var i = 0; i < targetTags.length; i++) {
                    if (tagsArray.includes(targetTags[i])) {
                        tagMatch = true;
                        break;
                    }
                }
            }
            
            var isBlocked = false;
            var blockReason = "";
            
            if (blockTags.length > 0) {
                for (var i = 0; i < blockTags.length; i++) {
                    var blockTag = blockTags[i];
                    // 使用 includes 代替 indexOf，更高效
                    if (tagsArray.includes(blockTag)) {
                        isBlocked = true;
                        blockReason = `block:${blockTag}`;
                        break;
                    }
                    if (blockTag.length >= 3 && tagsStr.includes(blockTag)) {
                        isBlocked = true;
                        blockReason = `block:${blockTag}`;
                        break;
                    }
                }
            }
            
            if (!isBlocked && nowordBlockTags.length > 0) {
                for (var i = 0; i < nowordBlockTags.length; i++) {
                    var nowordTag = nowordBlockTags[i];
                    if (tagsStr.includes(nowordTag)) {
                        isBlocked = true;
                        blockReason = `block(part):${nowordTag}`;
                        break;
                    }
                }
            }
            
            if (!isBlocked && options.blockGroups && options.blockGroups.length > 0) {
                for (var g = 0; g < options.blockGroups.length; g++) {
                    var currentGroup = options.blockGroups[g];
                    var allMatch = currentGroup.every(function(memberTag) {
                        return tagsStr.includes(memberTag);
                    });
                    if (allMatch) {
                        isBlocked = true;
                        blockReason = `group: [${currentGroup.join(" & ")}]`;
                        break; 
                    }
                }
            }
            
            if (!isBlocked && options.conditionalBlocks && options.conditionalBlocks.length > 0) {
                for (var c = 0; c < options.conditionalBlocks.length; c++) {
                    var rule = options.conditionalBlocks[c];
                    var ifExistsLower = rule.ifExists.toLowerCase();
                    var mustHaveLower = rule.mustHave.toLowerCase();
                    
                    var hasA = tagsStr.includes(ifExistsLower);
                    var hasB = tagsStr.includes(mustHaveLower);
                    
                    if (hasA && !hasB) {
                        isBlocked = true;
                        blockReason = `have [${rule.ifExists}] less [${rule.mustHave}]`;
                        break;
                    }
                }
            }
            
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
            } else if (options.orientation === "nomanga") {
                const ratio = Math.max(item.width, item.height) / Math.min(item.width, item.height);  
                orientationMatch = ratio <= 10;
            }

            var typeMatch = true;
            if (options.type && options.type !== "all") {
                var typeMap = { "0": "illust", "1": "manga", "2": "ugoira" };
                typeMatch = typeMap[String(item.illust_type)] === options.type;
            }

            if (tagMatch && orientationMatch && typeMatch) {
                ids.push(String(item.illust_id));
                var illustId = String(item.illust_id);
                pageMap[illustId] = {
                    page: page,
                    rank: item.rank,
                    isBlocked: isBlocked,
                    blockReason: blockReason
                };
            }
        });

        done(null, ids);
    }

    function fetchNext(page) {
        if (page > pages) {
            if (cacheUpdated) {
                saveCacheKeys(updatedKeys);
                validateCache(updatedKeys);
            }
            
            var finalIds = [...new Set(allIds)]; 
            totalIllusts = finalIds.length;
            
            if (finalIds.length === 0) {
                // 檢查是否有已失敗的作品被跳過
    
                console.log(`[${date}] skip`);
                
                cache = null;
                updatedKeys = null;
                allIds = null;
                pageMap = null;
                
                if (onComplete && typeof onComplete === 'function') {
                    onComplete({
                        date: date,
                        total: 0,
                        completed: 0,
                        failed: 0
                    });
                }
                return;
            }

            var baseDir = (options && options.baseDir) ? options.baseDir : ("./picture/" + date);
            if (!fs.existsSync(baseDir)) {
                fs.mkdirSync(baseDir, { recursive: true });
            }
            options.pageMap = pageMap;
            options.onFailure = failureCallback;
            options.onDownloadSuccess = downloadSuccessCallback;

            getImgUrl(finalIds, cookie, date, options);
            
            return;
        }

        fetchPage(page, function(err, ids) {
            if (err) {
                // 獲取失敗
            } else {
                allIds.push(...ids);
            }
            fetchNext(page + 1);
        });
    }

    fetchNext(1);
}

function processBatchFast(cookie, dates, options, onBatchComplete) {
    if (!dates || dates.length === 0) {
        if (onBatchComplete) onBatchComplete({ total: 0, completed: 0, failed: 0 });
        return;
    }
    
    const batchId = dates[0].substring(0, 6);

    
    const mode = options.mode || "daily";
    const content = options.content || "illust";
    const pages = options.pages || 1;
    const baseDir = options.baseDir || `./picture/${batchId}`;
    

    const downloadedIds = loadDownloadedIllustIds(baseDir);

    

    const year = getYearFromDate(dates[0]);
    const cache = loadYearCache(year);

    let processedCount = 0;
    let skippedCount = 0;
    
    dates.forEach(date => {
        let hasNewWork = false;
        
        for (let page = 1; page <= pages; page++) {
            const cacheKey = getCacheKey(date, mode, content, page);
            const pageData = cache[cacheKey];
            
            // 如果緩存中沒有數據，說明需要重新請求 API
            if (!pageData || !pageData.contents) {
                hasNewWork = true;
                break;
            }
            
            // 快速檢查是否有未下載的作品
            for (let item of pageData.contents) {
                const illustId = String(item.illust_id);
                if (!downloadedIds.has(illustId)) {
                    hasNewWork = true;
                    break;
                }
            }
            
            if (hasNewWork) break;
        }
        
        if (!hasNewWork) {
            skippedCount++;
        } else {
            processedCount++;
        }
    });
    

    if (processedCount === 0) {

        if (onBatchComplete) {
            onBatchComplete({ total: 0, completed: 0, failed: 0 });
        }
        return;
    }
    
    // 正常處理流程
    let dateIndex = 0;
    let totalCompleted = 0;
    let totalFailed = 0;
    let totalDownloads = 0;
    
    function processNextDate() {
        if (dateIndex >= dates.length) {
            
            if (onBatchComplete) {
                onBatchComplete({
                    total: totalDownloads,
                    completed: totalCompleted,
                    failed: totalFailed
                });
            }
            return;
        }
        
        const currentDate = dates[dateIndex];
        const dailyOptions = Object.assign({}, options);
        
        daily_rank(cookie, currentDate, dailyOptions, function(result) {
            totalDownloads += result.total;
            totalCompleted += result.completed;
            totalFailed += result.failed;
            
            dateIndex++;
            
            // 無作品時立即處理下一天
            const delay = result.total === 0 ? 1 : options.interval;
            setTimeout(processNextDate, delay);
        });
    }
    
    processNextDate();
}

module.exports = daily_rank;
module.exports.processBatchFast = processBatchFast;
module.exports.loadYearCache = loadYearCache;
module.exports.loadCacheKey = loadCacheKey;
module.exports.loadCacheKeys = loadCacheKeys;
module.exports.saveCacheKeys = saveCacheKeys;
module.exports.saveYearCache = saveYearCache;
module.exports.validateCache = validateCache;
module.exports.cleanupStaleLocks = cleanupStaleLocks;
module.exports.updateIllustStatus = updateIllustStatus;
module.exports.getCacheKey = getCacheKey;
module.exports.loadDownloadedIllustIds = loadDownloadedIllustIds;