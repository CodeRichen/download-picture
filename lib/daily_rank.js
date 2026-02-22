const request = require("request");
const fs = require("fs");
const path = require("path");

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
        
        // 等待重試（非阻塞）
        retries++;
        const waitTime = 100 * retries;
        // 使用同步延遲以保持當前流程簡單，但這裡應該重構為 async/await
        const endTime = Date.now() + waitTime;
        while (Date.now() < endTime) {
            // 允許事件循環處理其他任務
            if (Date.now() % 10 === 0) {
                // 每10ms讓出控制權
                process.nextTick(() => {});
            }
        }
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


function loadDownloadedIllustIds(baseDir, folderName) {
    const downloadedIds = new Set();
    
    // 通用檢查函數
    const checkTagsFile = (filePath) => {
        if (fs.existsSync(filePath)) {
            const content = fs.readFileSync(filePath, 'utf8');
            const lines = content.split('\n');
            lines.forEach(line => {
                const match = line.match(/ID:\s*(\d+)\s*\|/);
                if (match) {
                    downloadedIds.add(match[1]);
                }
            });
        }
    };
    
    // 檢查資料夾中的圖片文件，從文件名提取ID
    const checkImageFiles = (dirPath) => {
        if (fs.existsSync(dirPath)) {
            try {
                const files = fs.readdirSync(dirPath);
                files.forEach(file => {
                    const filePath = path.join(dirPath, file);
                    try {
                        const stat = fs.statSync(filePath);
                        if (stat.isFile()) {
                            // 匹配pixiv圖片文件名格式: {id}_p{page}.ext, {id}_{page}.ext, {id}.ext
                            const match = file.match(/^(\d+)(?:_p?\d+)?\.(?:jpg|jpeg|png|gif|webp)$/i);
                            if (match) {
                                downloadedIds.add(match[1]);
                            }
                        } else if (stat.isDirectory()) {
                            // 檢查多圖作品子資料夾 (格式: {id}({count}))
                            const folderMatch = file.match(/^(\d+)\(\d+\)$/);
                            if (folderMatch) {
                                downloadedIds.add(folderMatch[1]);
                            }
                        }
                    } catch (statErr) {
                        // 忽略單個文件錯誤
                    }
                });
            } catch (readErr) {
                // 忽略讀取錯誤
            }
        }
    };
    
    // 1. 檢查根目錄的 tags 文件（原先不指定資料夾的）
    checkTagsFile(path.join(baseDir, "_tags.txt"));
    checkTagsFile(path.join(baseDir, "_black", "_tags.txt"));
    
    // 2. 檢查根目錄中的圖片文件
    checkImageFiles(baseDir);
    
    // 3. 檢查所有以底線開頭的資料夾
    try {
        if (fs.existsSync(baseDir)) {
            const files = fs.readdirSync(baseDir);
            files.forEach(file => {
                const fullPath = path.join(baseDir, file);
                try {
                    if (fs.statSync(fullPath).isDirectory() && file.startsWith('_')) {
                        // 檢查該資料夾中的 _tags.txt
                        checkTagsFile(path.join(fullPath, "_tags.txt"));
                        
                        // 檢查該資料夾中的 _black/_tags.txt  
                        checkTagsFile(path.join(fullPath, "_black", "_tags.txt"));
                        
                        // 檢查該資料夾中的圖片文件
                        checkImageFiles(fullPath);
                        
                        // 檢查該資料夾中的_black子資料夾的圖片文件
                        checkImageFiles(path.join(fullPath, "_black"));
                    }
                } catch (statErr) {
                    // 單個檔案統計失敗，忽略
                }
            });
        }
    } catch (err) {
        // 忽略讀取錯誤
    }
    
    // 4. 檢查根目錄的_black子資料夾的圖片文件
    checkImageFiles(path.join(baseDir, "_black"));
    
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
    
    // 建立已知ID的集合，用於快速檢查重複
    var knownIllustIds = new Set();
    for (var existingKey in cache) {
        if (cache[existingKey] && cache[existingKey].contents) {
            cache[existingKey].contents.forEach(function(item) {
                if (item.illust_id) {
                    knownIllustIds.add(String(item.illust_id));
                }
            });
        }
    }

    var cacheUpdated = false;
    var updatedKeys = {};
    
    var totalIllusts = 0;
    var completedIllusts = 0;
    var failedIllusts = 0;


    var baseDir = (options && options.baseDir) ? options.baseDir : ("./picture/" + date);
    
    // 處理 folder 參數：如果沒有底線開頭就加上
    var folderName = null;
    if (options && options.folder) {
        folderName = options.folder.startsWith('_') ? options.folder : '_' + options.folder;
    }
    
    // 如果 options 中已經有 downloadedIds，就使用它，否則重新載入
    var downloadedIds = options.downloadedIds || loadDownloadedIllustIds(baseDir, folderName);

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
                
                // 高效過濾重複ID，使用Set進行 O(1) 檢查
                var filteredContents = [];
                data.contents.forEach(function(item) {
                    var illustId = String(item.illust_id);
                    
                    if (!knownIllustIds.has(illustId)) {
                        if (!item.status) {
                            item.status = "undownload";
                        }
                        filteredContents.push(item);
                        // 將新ID加入已知集合
                        knownIllustIds.add(illustId);
                    }
                });
                
                // 使用過濾後的內容
                var filteredData = Object.assign({}, data);
                filteredData.contents = filteredContents;
                
                cache[cacheKey] = filteredData;
                updatedKeys[cacheKey] = filteredData;
                cacheUpdated = true;
                
                processPageData(filteredData, page, done);
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
            if (item.status === "failed") {
                return; // 跳過失敗的作品
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
            
            // 應用 max 限制
            if (options.max && options.max > 0 && finalIds.length > options.max) {
                finalIds = finalIds.slice(0, options.max);
            }
            
            totalIllusts = finalIds.length;
            
            if (finalIds.length === 0) {
                // 檢查是否有已失敗的作品被跳過
    
                console.log(`[${date}] fin`);
                
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
            var actualDownloadDir = baseDir;
            
               
            // 如果指定了子資料夾，創建並使用該路徑
            if (folderName) {
                actualDownloadDir = path.join(baseDir, folderName);
            }
            
            if (!fs.existsSync(actualDownloadDir)) {
                try {
                    fs.mkdirSync(actualDownloadDir, { recursive: true });
                } catch (err) {
                    console.log(`[錯誤] 創建目錄失敗: ${err.message}`);
                }
            }
            
            // 更新 options 中的 baseDir 為實際下載目錄
            var downloadOptions = Object.assign({}, options);
            downloadOptions.baseDir = actualDownloadDir;
            downloadOptions.pageMap = pageMap;
            downloadOptions.onFailure = failureCallback;
            downloadOptions.onDownloadSuccess = downloadSuccessCallback;

            getImgUrl(finalIds, cookie, date, downloadOptions);
            
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

    // 檢查該日期的所有需要的頁面是否都已經在 cache 中
    function checkAllPagesInCache() {
        for (var p = 1; p <= pages; p++) {
            var cacheKey = getCacheKey(date, mode, content, p);
            if (!cache[cacheKey] || !cache[cacheKey].contents) {
                return false; // 有頁面不在 cache 中
            }
        }
        return true; // 所有頁面都在 cache 中
    }

    // 如果所有頁面都在 cache 中，直接處理，不發送 API 請求
    if (checkAllPagesInCache()) {
        
        // 使用現有的 processPageData 函數確保過濾邏輯一致
        var processedPages = 0;
        
        function processNextCachedPage(pageNum) {
            if (pageNum > pages) {
                // 所有頁面處理完成，執行最終處理
                var finalIds = [...new Set(allIds)];
                
                if (options.max && options.max > 0 && finalIds.length > options.max) {
                    finalIds = finalIds.slice(0, options.max);
                }
                
                totalIllusts = finalIds.length;
                
                if (finalIds.length === 0) {
                    console.log(`[${date}] fin`);
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
                var actualDownloadDir = baseDir;
                
                if (folderName) {
                    actualDownloadDir = path.join(baseDir, folderName);
                }
                
                if (!fs.existsSync(actualDownloadDir)) {
                    try {
                        fs.mkdirSync(actualDownloadDir, { recursive: true });
                        console.log(`[已創建] ${actualDownloadDir}`);
                    } catch (err) {
                        console.log(`[錯誤] 創建目錄失敗: ${err.message}`);
                    }
                }
                
                var downloadOptions = Object.assign({}, options);
                downloadOptions.baseDir = actualDownloadDir;
                downloadOptions.pageMap = pageMap;
                downloadOptions.onFailure = failureCallback;
                downloadOptions.onDownloadSuccess = downloadSuccessCallback;

                getImgUrl(finalIds, cookie, date, downloadOptions);
                return;
            }
            
            var cacheKey = getCacheKey(date, mode, content, pageNum);
            var cachedData = cache[cacheKey];
            
            // 使用現有的 processPageData 函數
            processPageData(cachedData, pageNum, function(err, ids) {
                if (!err) {
                    allIds.push(...ids);
                }
                processNextCachedPage(pageNum + 1);
            });
        }
        
        processNextCachedPage(1);
        return;
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
    

    const folderName = options.folder ? (options.folder.startsWith('_') ? options.folder : '_' + options.folder) : null;
    const downloadedIds = loadDownloadedIllustIds(baseDir, folderName);

    

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
        // 傳遞預先載入的 downloadedIds，避免重複載入
        dailyOptions.downloadedIds = downloadedIds;
        
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

/**
 * 根據 ID 區間下載圖片
 * @param {number} startId - 起始ID
 * @param {number} endId - 結束ID  
 * @param {string} cookie - pixiv cookie
 * @param {object} options - 下載選項
 * @param {function} onComplete - 完成回調
 */
function downloadByIdRange(startId, endId, cookie, options, onComplete) {
    if (!startId || !endId || startId > endId) {
        console.log("[錯誤] 無效的ID範圍");
        if (onComplete) onComplete({ total: 0, completed: 0, failed: 0 });
        return;
    }
    
    var jar = request.jar();
    if (cookie) {
        jar.setCookie(cookie, "https://www.pixiv.net/");
    }
    
    // 處理 folder 參數
    var folderName = null;
    if (options && options.folder) {
        folderName = options.folder.startsWith('_') ? options.folder : '_' + options.folder;
    }
    
    var currentDate = new Date().toISOString().substring(0, 10).replace(/-/g, '');
    var baseDir = (options && options.baseDir) ? options.baseDir : ("./picture/" + currentDate + "_idrange_" + startId + "-" + endId);
    
    // 確保基礎資料夾存在
    if (!fs.existsSync(baseDir)) {
        try {
            fs.mkdirSync(baseDir, { recursive: true });
        } catch (err) {
            console.log(`[錯誤] 創建基礎資料夾失敗: ${err.message}`);
        }
    }
    
    // 如果指定了 folder，同時創建子資料夾
    if (folderName) {
        var fullFolderPath = path.join(baseDir, folderName);
        if (!fs.existsSync(fullFolderPath)) {
            try {
                fs.mkdirSync(fullFolderPath, { recursive: true });
            } catch (err) {
                console.log(`[錯誤] 創建子資料夾失敗: ${err.message}`);
            }
        }
    }
    
    // 如果有downloadedIds就使用，否則載入
    var downloadedIds = options.downloadedIds || loadDownloadedIllustIds(baseDir, folderName);
    
    var totalIllusts = 0;
    var completedIllusts = 0; 
    var failedIllusts = 0;
    var validIds = [];
    var pageMap = {};
    var currentId = startId;
    
    var failureCallback = function(illustId, errorMsg) {
        failedIllusts++;
        checkIfAllComplete();
    };
    
    var downloadSuccessCallback = function(illustId, status, tags, metadata) {
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
            if (onComplete && typeof onComplete === 'function') {
                onComplete({
                    startId: startId,
                    endId: endId,
                    total: totalIllusts,
                    completed: completedIllusts,
                    failed: failedIllusts
                });
            }
        }
    }
    
    function fetchNextId() {
        if (currentId > endId) {
            // 所有ID檢查完成，開始下載
            if (validIds.length === 0) {
                if (onComplete && typeof onComplete === 'function') {
                    onComplete({
                        startId: startId,
                        endId: endId,
                        total: 0,
                        completed: 0,
                        failed: 0
                    });
                }
                return;
            }
            
            // 應用 max 限制
            if (options.max && options.max > 0 && validIds.length > options.max) {
                validIds = validIds.slice(0, options.max);
            }
            
            totalIllusts = validIds.length;
            
            var actualDownloadDir = baseDir;
            if (folderName) {
                actualDownloadDir = path.join(baseDir, folderName);
            }
            
            // 資料夾已在函數開始時創建，這裡只需確保路徑正確
            var downloadOptions = Object.assign({}, options);
            downloadOptions.baseDir = actualDownloadDir;
            downloadOptions.pageMap = pageMap;
            downloadOptions.onFailure = failureCallback;
            downloadOptions.onDownloadSuccess = downloadSuccessCallback;
            
            // ID範圍下載使用特殊的日期標識
            var idRangeLabel = `ID範圍${startId}-${endId}`;
            getImgUrl(validIds, cookie, idRangeLabel, downloadOptions);
            return;
        }
        
        var illustId = String(currentId);
        
        // 檢查是否已下載
        if (downloadedIds.has(illustId)) {
            currentId++;
            setImmediate(fetchNextId);
            return;
        }
        
        counter.enqueue(function(currentCount) {
            request({
                url: "https://www.pixiv.net/ajax/illust/" + illustId,
                headers: {
                    'Referer': "https://www.pixiv.net/artworks/" + illustId,
                    'User-Agent': "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                    'Cookie': cookie || ""
                },
                jar: jar,
                json: true
            }, function(err, res, data) {
                currentId++;
                
                if (err || !data || data.error || !data.body) {
                    // ID無效或請求失敗，跳過
                    setImmediate(fetchNextId);
                    return;
                }
                
                var illust = data.body;
                if (!illust || !illust.id) {
                    setImmediate(fetchNextId);
                    return;
                }
                
                // 應用過濾條件
                var shouldInclude = true;
                var blockReason = "";
                
                // 標籤過濾
                if (options && options.tag) {
                    var targetTags = options.tag.split(",").map(tag => tag.trim().toLowerCase());
                    var tagsArray = [];
                    if (illust.tags && illust.tags.tags) {
                        tagsArray = illust.tags.tags.map(tagObj => tagObj.tag.toLowerCase());
                    }
                    
                    var tagMatch = false;
                    for (var i = 0; i < targetTags.length; i++) {
                        if (tagsArray.includes(targetTags[i])) {
                            tagMatch = true;
                            break;
                        }
                    }
                    if (!tagMatch) {
                        shouldInclude = false;
                    }
                }
                
                // 屏蔽標籤過濾
                if (shouldInclude && options && options.block) {
                    var blockTags = options.block.split(",").map(tag => tag.trim().toLowerCase());
                    var tagsStr = "";
                    if (illust.tags && illust.tags.tags) {
                        tagsStr = illust.tags.tags.map(tagObj => tagObj.tag.toLowerCase()).join(" ");
                    }
                    
                    for (var i = 0; i < blockTags.length; i++) {
                        var blockTag = blockTags[i];
                        if (tagsStr.includes(blockTag)) {
                            shouldInclude = false;
                            blockReason = `block:${blockTag}`;
                            break;
                        }
                    }
                }
                
                // 尺寸過濾
                if (shouldInclude && options.orientation) {
                    var orientationMatch = true;
                    if (options.orientation === "landscape") {
                        orientationMatch = parseInt(illust.width) > parseInt(illust.height);
                    } else if (options.orientation === "desktop") {
                        const width = parseInt(illust.width);
                        const height = parseInt(illust.height);
                        const aspectRatio = width / height;
                        orientationMatch = (aspectRatio >= 1.5 && aspectRatio <= 1.85);
                    } else if (options.orientation === "portrait") {
                        orientationMatch = parseInt(illust.height) > parseInt(illust.width);
                    } else if (options.orientation === "nomanga") {
                        const ratio = Math.max(illust.width, illust.height) / Math.min(illust.width, illust.height);  
                        orientationMatch = ratio <= 10;
                    }
                    if (!orientationMatch) {
                        shouldInclude = false;
                    }
                }
                
                // 類型過濾
                if (shouldInclude && options.type && options.type !== "all") {
                    var typeMap = { "0": "illust", "1": "manga", "2": "ugoira" };
                    var typeMatch = typeMap[String(illust.illustType)] === options.type;
                    if (!typeMatch) {
                        shouldInclude = false;
                    }
                }
                
                if (shouldInclude) {
                    validIds.push(illustId);
                    pageMap[illustId] = {
                        page: 1,
                        rank: currentId - startId + 1,
                        isBlocked: false,
                        blockReason: ""
                    };
                }
                
                setImmediate(fetchNextId);
            });
        });
    }
    
    fetchNextId();
}

/**
 * 下載單個作品 ID
 * @param {number} illustId - 作品ID
 * @param {string} cookie - pixiv cookie
 * @param {object} options - 下載選項
 * @param {function} onComplete - 完成回調
 */
function downloadSingleId(illustId, cookie, options, onComplete) {
    if (!illustId) {
        console.log("[錯誤] 無效的作品ID");
        if (onComplete) onComplete({ total: 0, completed: 0, failed: 1, error: "無效的作品ID" });
        return;
    }
    
    var jar = request.jar();
    if (cookie) {
        jar.setCookie(cookie, "https://www.pixiv.net/");
    }
    
    // 處理 folder 參數
    var folderName = null;
    if (options && options.folder) {
        folderName = options.folder.startsWith('_') ? options.folder : '_' + options.folder;
    }
    
    var currentDate = new Date().toISOString().substring(0, 10).replace(/-/g, '');
    var baseDir = (options && options.baseDir) ? options.baseDir : ("./picture/" + currentDate + "_single_" + illustId);
    
    // 確保基礎資料夾存在
    if (!fs.existsSync(baseDir)) {
        try {
            fs.mkdirSync(baseDir, { recursive: true });
        } catch (err) {
            console.log(`[錯誤] 創建基礎資料夾失敗: ${err.message}`);
            if (onComplete) onComplete({ total: 0, completed: 0, failed: 1, error: err.message });
            return;
        }
    }
    
    // 如果指定了 folder，同時創建子資料夾
    if (folderName) {
        var fullFolderPath = path.join(baseDir, folderName);
        if (!fs.existsSync(fullFolderPath)) {
            try {
                fs.mkdirSync(fullFolderPath, { recursive: true });
            } catch (err) {
                console.log(`[錯誤] 創建子資料夾失敗: ${err.message}`);
            }
        }
    }
    
    var actualDownloadDir = baseDir;
    if (folderName) {
        actualDownloadDir = path.join(baseDir, folderName);
    }
    
    var completedIllusts = 0;
    var failedIllusts = 0;
    
    var failureCallback = function(illustId, errorMsg) {
        failedIllusts++;
        var debugInfo = '';
        if (options.debug) {
            debugInfo = ' [DEBUG模式已啟用 - 詳細錯誤已記錄]';
        }
        console.log(`[失敗] 作品 ${illustId}: ${errorMsg}${debugInfo}`);
        
        if (onComplete && typeof onComplete === 'function') {
            onComplete({
                illustId: illustId,
                total: 1,
                completed: completedIllusts,
                failed: failedIllusts,
                error: errorMsg
            });
        }
    };
    
    var downloadSuccessCallback = function(illustId, status, tags, metadata) {
        if (status === "finish") {
            completedIllusts++;
            console.log(`[成功] 作品 ${illustId} 下載完成`);
        } else if (status === "failed") {
            failedIllusts++;
            console.log(`[失敗] 作品 ${illustId} 下載失敗`);
        }
        
        if (onComplete && typeof onComplete === 'function') {
            onComplete({
                illustId: illustId,
                total: 1,
                completed: completedIllusts,
                failed: failedIllusts,
                status: status
            });
        }
    };
    
    // 直接請求單個作品詳情
    counter.enqueue(function(currentCount) {
        request({
            url: "https://www.pixiv.net/ajax/illust/" + illustId,
            headers: {
                'Referer': "https://www.pixiv.net/artworks/" + illustId,
                'User-Agent': "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                'Cookie': cookie || ""
            },
            jar: jar,
            json: true
        }, function(err, res, data) {
            if (err) {
                failureCallback(illustId, `網路請求錯誤: ${err.message}`);
                return;
            }
            
            if (!data || data.error || !data.body) {
                var errorMsg = data && data.message ? data.message : "作品不存在或無權限訪問";
                failureCallback(illustId, errorMsg);
                return;
            }
            
            var illust = data.body;
            if (!illust || !illust.id) {
                failureCallback(illustId, "作品數據無效");
                return;
            }
            
            console.log(`[找到] 作品 ${illustId}: ${illust.title} by ${illust.userName}`);
            
            var downloadOptions = Object.assign({}, options);
            downloadOptions.baseDir = actualDownloadDir;
            downloadOptions.pageMap = {};
            downloadOptions.pageMap[illustId] = {
                page: 1,
                rank: 1,
                isBlocked: false,
                blockReason: ""
            };
            downloadOptions.onFailure = failureCallback;
            downloadOptions.onDownloadSuccess = downloadSuccessCallback;
            
            var singleIdLabel = `單個作品${illustId}`;
            getImgUrl([String(illustId)], cookie, singleIdLabel, downloadOptions);
        });
    });
}

module.exports = daily_rank;
module.exports.processBatchFast = processBatchFast;
module.exports.downloadByIdRange = downloadByIdRange;
module.exports.downloadSingleId = downloadSingleId;