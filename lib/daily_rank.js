const request = require("request");
const fs = require("fs");
const path = require("path");
const io = require("cheerio");

const getImgUrl = require("./getImgUrl.js");
const counter = require("./requestCounter.js");

const CACHE_DIR = "./picture";
const LOCK_FILE = "./picture/cache.lock";

// 記憶體使用監控輔助函數（開發時使用）
function logMemoryUsage(label) {
    if (process.env.NODE_ENV === 'debug') {
        const used = process.memoryUsage();
        console.log(`[${label}] Memory: ${Math.round(used.heapUsed / 1024 / 1024 * 100) / 100} MB`);
    }
}

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
    // date 格式: "20250101" -> 年份: "2025"
    return date.substring(0, 4);
}

// 獲取年份緩存檔案路徑
function getYearCacheFile(year) {
    return path.join(CACHE_DIR, `${year}.json`);
}

// 獲取備份檔案路徑
function getYearBackupFile(year) {
    return path.join(CACHE_DIR, `${year}.json.backup`);
}

// 載入特定年份的緩存
function loadYearCache(year) {
    const cacheFile = getYearCacheFile(year);
    const backupFile = getYearBackupFile(year);
    
    try {
        if (fs.existsSync(cacheFile)) {
            const data = fs.readFileSync(cacheFile, "utf-8");
            const parsed = JSON.parse(data);
            if (typeof parsed === 'object' && parsed !== null) {
                return parsed;
            }
        }
    } catch (err) {
        // 嘗試從備份恢復
        if (fs.existsSync(backupFile)) {
            try {
                const backupData = fs.readFileSync(backupFile, "utf-8");
                const parsed = JSON.parse(backupData);
                return parsed;
            } catch (backupErr) {}
        }
    }
    return {};
}

// 載入特定鍵的緩存（自動判斷年份）
function loadCacheKey(key) {
    // 從鍵中提取日期: "20250101_daily_illust_p1" -> "20250101"
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
        // 明確清理大型物件
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
    const backupFile = getYearBackupFile(year);
    
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
                
                // 備份現有文件
                if (fs.existsSync(cacheFile)) {
                    fs.copyFileSync(cacheFile, backupFile);
                }
                
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

// 新增：更新緩存中的作品狀態
function updateIllustStatus(cache, date, mode, content, illustId, status, updatedKeys) {
    // 優化：預先構造搜索前綴，減少重複字串拼接
    const searchPrefix = `${date}_${mode}_${content}_p`;
    var updated = false;
    
    // 只遍歷符合格式的鍵，提早過濾
    for (var key in cache) {
        if (!key.startsWith(searchPrefix)) continue;
        
        var pageData = cache[key];
        if (!pageData || !pageData.contents || !Array.isArray(pageData.contents)) continue;
        
        // 使用 find 方法更簡潔，當找到時立即停止
        var targetItem = pageData.contents.find(item => 
            String(item.illust_id) === String(illustId)
        );
        
        if (targetItem) {
            // 找到了，更新狀態
            targetItem.status = status;
            updatedKeys[key] = pageData;
            updated = true;
            break; // 找到後立即退出
        }
    }
    
    return updated;
}

/**
 * 主要的排行榜下載函數 - 已優化記憶體使用並添加完成回調
 * 新增參數：
 * - onComplete: 當所有下載完成時的回調函數
 */
function daily_rank(cookie, date, options, onComplete) {
    logMemoryUsage("daily_rank 開始");
    
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
    
    // 預先轉換為小寫，減少重複處理
    var blockTags = [];
    if (options && options.block) {
        blockTags = options.block.split(",").map(tag => tag.trim().toLowerCase());
    }
    
    var nowordBlockTags = [];
    if (options && options.nowordBlock) {
        nowordBlockTags = options.nowordBlock.split(",").map(tag => tag.trim().toLowerCase());
    }
    
    // 預先轉換目標標籤為小寫
    var targetTags = [];
    if (options && options.tag) {
        targetTags = options.tag.split(",").map(tag => tag.trim().toLowerCase());
    }
    
    var allIds = [];
    var pageMap = {}; // 移到函數內部
    
    // 載入當前年份的緩存
    const year = getYearFromDate(date);
    var cache = loadYearCache(year);
    logMemoryUsage("載入緩存後");
    var cacheUpdated = false;
    var updatedKeys = {};
    
    // 新增：追蹤下載完成狀態
    var totalIllusts = 0;
    var completedIllusts = 0;
    var failedIllusts = 0;

    // 新增：失敗回調函數
    var failureCallback = function(illustId, errorMsg) {
        var updated = updateIllustStatus(cache, date, mode, content, illustId, "failed", updatedKeys);
        if (updated) {
            cacheUpdated = true;
        }
        failedIllusts++;
        checkIfAllComplete();
    };
    
    // 新增：下載成功回調函數
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
    
    // 新增：檢查是否所有下載都已完成
    function checkIfAllComplete() {
        var processed = completedIllusts + failedIllusts;
        if (processed >= totalIllusts && totalIllusts > 0) {
            // 保存更新的緩存
            if (cacheUpdated) {
                saveCacheKeys(updatedKeys);
            }
            
            console.log(`[${date}] 完成: ${completedIllusts}/${totalIllusts}, 失敗: ${failedIllusts}`);
            
            // 清理記憶體
            cache = null;
            updatedKeys = null;
            allIds = null;
            pageMap = null;
            
            // 調用完成回調
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
        
        // 檢查緩存 - 如果有緩存，直接同步處理，不經過 counter
        if (cache[cacheKey]) {
            // 立即同步處理，不延遲
            setImmediate(function() {
                processPageData(cache[cacheKey], page, done);
            });
            return;
        }
        
        // 緩存不存在，發起請求
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
                
                // 初始化所有作品的 status 欄位
                data.contents.forEach(function(item) {
                    if (!item.status) {
                        item.status = "undownload";
                    }
                });
                
                // 記錄更新的鍵
                cache[cacheKey] = data;
                updatedKeys[cacheKey] = data;
                cacheUpdated = true;
                
                processPageData(data, page, done);
            });
        });
    }
    
    function processPageData(data, page, done) {
        var ids = [];
        var baseDir = (options && options.baseDir) ? options.baseDir : ("./picture/" + date);
        var tagsTxtPath = path.join(baseDir, "_tags.txt");
        var blackTagsTxtPath = path.join(baseDir, "_black", "_tags.txt");
        
        var existingTagsContent = "";
        if (fs.existsSync(tagsTxtPath)) {
            existingTagsContent = fs.readFileSync(tagsTxtPath, 'utf8');
        }
        
        var existingBlackTagsContent = "";
        if (fs.existsSync(blackTagsTxtPath)) {
            existingBlackTagsContent = fs.readFileSync(blackTagsTxtPath, 'utf8');
        }

        data.contents.forEach(function(item) {
            var illustId = String(item.illust_id);
            
            // 初始化 status 欄位（如果還沒有）
            if (!item.status) {
                item.status = "undownload";
            }

            // 檢查是否已下載完成（根據 _tags.txt 或 black/_tags.txt）
            if (existingTagsContent && existingTagsContent.includes(`ID: ${illustId} |`)) {
                item.status = "finish";
            } else if (existingBlackTagsContent && existingBlackTagsContent.includes(`ID: ${illustId} |`)) {
                item.status = "finish";
            }
            
            // *** 關鍵修改：跳過已完成或已失敗的作品，不再重複嘗試 ***
            if (item.status === "finish") {
                // console.log(`[跳過] ${illustId} - 已下載完成`);
                return; // 跳過已下載完成的
            }
            
            if (item.status === "failed") {
                // console.log(`[跳過] ${illustId} - 之前下載失敗，不再重試`);
                failedIllusts++; // 計入失敗數，但不重試
                return; // 跳過之前失敗的
            }
            
            // 優化：一次性轉換標籤，減少重複處理
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
            var blockReason = ""; // 記錄被擋原因
            
            if (blockTags.length > 0) {
                for (var i = 0; i < blockTags.length; i++) {
                    var blockTag = blockTags[i];
                    // 使用 includes 代替 indexOf，更高效
                    if (tagsArray.includes(blockTag)) {
                        isBlocked = true;
                        blockReason = `含有屏蔽標籤: ${blockTag}`;
                        break;
                    }
                    if (blockTag.length >= 3 && tagsStr.includes(blockTag)) {
                        isBlocked = true;
                        blockReason = `含有屏蔽標籤: ${blockTag}`;
                        break;
                    }
                }
            }
            
            if (!isBlocked && nowordBlockTags.length > 0) {
                for (var i = 0; i < nowordBlockTags.length; i++) {
                    var nowordTag = nowordBlockTags[i];
                    if (tagsStr.includes(nowordTag)) {
                        isBlocked = true;
                        blockReason = `含有屏蔽標籤(部分匹配): ${nowordTag}`;
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
                        blockReason = `符合群組屏蔽條件: [${currentGroup.join(" & ")}]`;
                        break; 
                    }
                }
            }
            if (!isBlocked && options.conditionalBlocks && options.conditionalBlocks.length > 0) {
                for (var c = 0; c < options.conditionalBlocks.length; c++) {
                    var rule = options.conditionalBlocks[c];
                    // 將條件標籤轉為小寫進行比較
                    var ifExistsLower = rule.ifExists.toLowerCase();
                    var mustHaveLower = rule.mustHave.toLowerCase();
                    
                    var hasA = tagsStr.includes(ifExistsLower);
                    var hasB = tagsStr.includes(mustHaveLower);
                    
                    // 如果有 A 但沒有 B，則屏蔽
                    if (hasA && !hasB) {
                        isBlocked = true;
                        blockReason = `條件屏蔽: 有 [${rule.ifExists}] 但缺少 [${rule.mustHave}]`;
                        console.log(`[條件屏蔽] 作品 ${illustId}: 有 [${rule.ifExists}] 但缺少 [${rule.mustHave}]`);
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

            // 符合 tag、orientation、type 條件的圖片都要下載
            // 但被 block 的會存到 black 資料夾
            if (tagMatch && orientationMatch && typeMatch) {
                ids.push(String(item.illust_id));
                var illustId = String(item.illust_id);
                pageMap[illustId] = {
                    page: page,
                    rank: item.rank,
                    isBlocked: isBlocked,  // 標記是否被擋
                    blockReason: blockReason  // 記錄被擋原因
                };
                
                if (isBlocked) {
                    // console.log(`[屏蔽標記] ID: ${illustId} - 將存到 black 資料夾 (原因: ${blockReason})`);
                }
            }
        });

        done(null, ids);
    }

    function fetchNext(page) {
        if (page > pages) {
            // 只保存本次更新的鍵
            if (cacheUpdated) {
                saveCacheKeys(updatedKeys);
                validateCache(updatedKeys);
            }
            
            // 使用 Set 去重，減少記憶體使用
            var finalIds = [...new Set(allIds)]; 
            totalIllusts = finalIds.length;
            
            if (finalIds.length === 0) {
                // 檢查是否有已失敗的作品被跳過
                var skippedMessage = failedIllusts > 0 
                    ? `無需下載的作品（已跳過 ${failedIllusts} 個失敗作品）` 
                    : `無符合條件的作品`;
                console.log(`[${date}] ${skippedMessage}`);
                
                // 清理記憶體
                cache = null;
                updatedKeys = null;
                allIds = null;
                pageMap = null;
                
                // 即使沒有作品也要調用完成回調
                if (onComplete && typeof onComplete === 'function') {
                    onComplete({
                        date: date,
                        total: 0,
                        completed: 0,
                        failed: failedIllusts // 回報跳過的失敗數
                    });
                }
                return;
            }

            var baseDir = (options && options.baseDir) ? options.baseDir : ("./picture/" + date);
            if (!fs.existsSync(baseDir)) {
                fs.mkdirSync(baseDir, { recursive: true });
            }
            options.pageMap = pageMap;
            
            // 傳遞失敗回調和下載成功回調給 getImgUrl
            options.onFailure = failureCallback;
            options.onDownloadSuccess = downloadSuccessCallback;
            
            var skipMsg = failedIllusts > 0 ? ` (已跳過 ${failedIllusts} 個失敗作品)` : '';
            console.log(`[${date}] 開始下載 ${totalIllusts} 個作品${skipMsg}`);
            getImgUrl(finalIds, cookie, date, options);
            
            return;
        }

        fetchPage(page, function(err, ids) {
            if (err) {
                // 獲取失敗
            } else {
                // 使用 push 代替 concat 以減少記憶體分配
                allIds.push(...ids);
            }
            fetchNext(page + 1);
        });
    }

    fetchNext(1);
}

module.exports = daily_rank;
module.exports.loadYearCache = loadYearCache;
module.exports.loadCacheKey = loadCacheKey;
module.exports.loadCacheKeys = loadCacheKeys;
module.exports.saveCacheKeys = saveCacheKeys;
module.exports.saveYearCache = saveYearCache;
module.exports.validateCache = validateCache;
module.exports.cleanupStaleLocks = cleanupStaleLocks;
module.exports.updateIllustStatus = updateIllustStatus;
module.exports.getCacheKey = getCacheKey;