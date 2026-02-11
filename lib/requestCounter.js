// requestCounter.js - 全局請求計數器模塊（統一佇列管理）
// 所有網路請求（探索API + 下載圖片）都經過這個佇列

var globalRequestCount = 0;      // 全局請求計數（用於暫停判斷）
var requestQueue = [];           // 統一請求佇列
var isProcessing = false;        // 是否正在處理請求
var isPaused = false;            // 全局暫停標誌
var nextPauseAt = 50;            // 下次暫停的請求數
var gap=1000;
var PAUSE_THRESHOLD = 50;        // 每50次請求暫停一次
var PAUSE_DURATION = 8000;      // 暫停時間 
var REQUEST_INTERVAL = 300;      // 請求間隔 300ms

// 記憶體使用監控
function logMemoryUsage(label) {
    if (process.env.NODE_ENV === 'debug') {
        const used = process.memoryUsage();
        console.log(`[queue-${label}] Memory: ${Math.round(used.heapUsed / 1024 / 1024 * 100) / 100} MB, Queue: ${requestQueue.length}`);
    }
}

// 將請求加入統一佇列 (API 權重設為 1)
function enqueue(requestFn) {
    requestQueue.push({ fn: requestFn, type: 'api', weight: 1 });
    processQueue();
}

// 將下載請求加入統一佇列
function enqueueDownload(requestFn) {
    requestQueue.push({ fn: requestFn, type: 'download', weight: 2 });
    processQueue();
}

// 處理佇列
function processQueue() {
    if (isProcessing || isPaused || requestQueue.length === 0) {
        return;
    }
    
    // 優化: 減少佇列讀取次數
    logMemoryUsage("處理前");
    
    isProcessing = true;

    // --- 檢查是否需要暫停 ---
    // 改用「預判」邏輯：如果下一個請求的權重加下去會超過暫停點，就先暫停
    var nextItem = requestQueue[0];
    if (globalRequestCount + nextItem.weight > nextPauseAt) {
        console.log(`(${globalRequestCount})break(${PAUSE_DURATION/1000}s)`);
        isPaused = true;
        
        // 更新下一次暫停的目標點
        nextPauseAt = globalRequestCount + PAUSE_THRESHOLD;
        
        // 動態增加暫停時間邏輯（每 1000 點增加 0.3 秒）
        if (nextPauseAt > gap){
            PAUSE_DURATION += 300;
            gap+=1000;
        }

        setTimeout(function() {
            console.log(`continue(queue:${requestQueue.length})`);
            isPaused = false;
            isProcessing = false;
            logMemoryUsage("暫停後");
            processQueue();
        }, PAUSE_DURATION);
        return;
    }
    
    // 優化: 取出請求後立即清理引用
    var item = requestQueue.shift();
    var itemFn = item.fn;
    var itemWeight = item.weight;
    item = null; // 清理引用
    
    setTimeout(function() {
        // --- 根據類型增加不同權重 ---
        globalRequestCount += itemWeight;
        
        try {
            itemFn(globalRequestCount);
        } catch (e) {
            console.log('[請求錯誤]', e.message);
        } finally {
            itemFn = null; // 清理引用
        }
        
        isProcessing = false;
        processQueue(); 
    }, REQUEST_INTERVAL);
}

// 獲取當前計數
function getCount() {
    return globalRequestCount;
}

// 獲取佇列長度
function getQueueLength() {
    return requestQueue.length;
}

// 檢查是否暫停中
function isPausedNow() {
    return isPaused;
}

// 設置暫停閾值
function setPauseThreshold(n) {
    PAUSE_THRESHOLD = n;
}

// 設置暫停時間
function setPauseDuration(ms) {
    PAUSE_DURATION = ms;
}

// 設置請求間隔
function setRequestInterval(ms) {
    REQUEST_INTERVAL = ms;
}

module.exports = {
    enqueue: enqueue,
    enqueueDownload: enqueueDownload,
    getCount: getCount,
    getQueueLength: getQueueLength,
    isPausedNow: isPausedNow,
    setPauseThreshold: setPauseThreshold,
    setPauseDuration: setPauseDuration,
    setRequestInterval: setRequestInterval
};
