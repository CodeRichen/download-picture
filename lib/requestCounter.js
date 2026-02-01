// requestCounter.js - 全局请求计数器模块（带队列管理）

var globalRequestCount = 0;
var requestQueue = [];
var isProcessing = false;
var isPaused = false;

// 将请求加入队列
function enqueue(requestFn) {
    requestQueue.push(requestFn);
    processQueue();
}

// 处理队列
function processQueue() {
    if (isProcessing || isPaused || requestQueue.length === 0) {
        return;
    }
    
    isProcessing = true;
    var requestFn = requestQueue.shift();
    
    // 检查是否需要暂停
    if (globalRequestCount >= 50) {
        console.log(`\n暂停\n`);
        globalRequestCount = 0;
        isPaused = true;
        
        setTimeout(function() {
            isPaused = false;
            isProcessing = false;
            executeRequest(requestFn);
        }, 3000);
    } else {
        setTimeout(function() {
            isProcessing = false;
            executeRequest(requestFn);
        }, 500);
    }
}

// 执行请求
function executeRequest(requestFn) {
    globalRequestCount++;
    requestFn(globalRequestCount);
    processQueue(); // 继续处理下一个请求
}

// 获取当前计数
function getCount() {
    return globalRequestCount;
}

// 获取队列长度
function getQueueLength() {
    return requestQueue.length;
}

module.exports = {
    enqueue: enqueue,
    getCount: getCount,
    getQueueLength: getQueueLength
};
