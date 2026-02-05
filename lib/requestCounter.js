// requestCounter.js - 全局请求计数器模块（统一队列管理）
// 所有網路請求（探索API + 下載圖片）都經過這個佇列

var globalRequestCount = 0;      // 全局請求計數（用於暫停判斷）
var requestQueue = [];           // 統一請求佇列
var isProcessing = false;        // 是否正在處理請求
var isPaused = false;            // 全局暫停標誌
var nextPauseAt = 50;            // 下次暫停的請求數
var PAUSE_THRESHOLD = 50;        // 每50次請求暫停一次
var PAUSE_DURATION = 10000;      // 暫停時間 10 秒
var REQUEST_INTERVAL = 300;      // 請求間隔 300ms

// 將請求加入統一佇列
function enqueue(requestFn) {
    requestQueue.push({ fn: requestFn, type: 'api' });
    processQueue();
}

// 將下載請求加入統一佇列
function enqueueDownload(requestFn) {
    requestQueue.push({ fn: requestFn, type: 'download' });
    processQueue();
}

// 處理佇列
function processQueue() {
    if (isProcessing || isPaused || requestQueue.length === 0) {
        return;
    }
    
    isProcessing = true;
    
    // 檢查是否需要暫停（使用下次暫停點判斷）
    if (globalRequestCount >= nextPauseAt) {
        console.log(`\n已處理 ${globalRequestCount} 次請求，暫停 ${PAUSE_DURATION/1000} 秒...\n`);
        isPaused = true;
        nextPauseAt = globalRequestCount + PAUSE_THRESHOLD; // 設定下次暫停點
        
        setTimeout(function() {
            console.log(`繼續處理請求(佇列剩餘: ${requestQueue.length})\n`);
            isPaused = false;
            isProcessing = false;
            processQueue();
        }, PAUSE_DURATION);
        return;
    }
    
    // 取出下一個請求
    var item = requestQueue.shift();
    
    setTimeout(function() {
        globalRequestCount++;
        try {
            item.fn(globalRequestCount);
        } catch (e) {
            console.log('[請求錯誤]', e.message);
        }
        isProcessing = false;
        processQueue(); // 繼續處理下一個請求
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
