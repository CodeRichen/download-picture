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
var _date = args.find(function(a) { return /^\d{8}$/.test(a); }); //自定义时间 20170101,长度为8
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
    tag: null
};

var monthArg = null;

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
    if (arg.indexOf("--interval=") === 0) {
        var itv = parseInt(arg.split("=")[1], 10);
        options.interval = isNaN(itv) || itv < 0 ? 1000 : itv;
    }
    if (arg.indexOf("--tag=") === 0) {
        options.tag = arg.split("=")[1]; // 例如 --tag=miku
        console.log("設定篩選標籤為:", options.tag);
    }
});

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

function startWithCookie(cookie) {
    console.log("Cookie loaded: " + cookie + "\n");

    if (cookie.indexOf("PHPSESSID") === -1) {
        console.log("警告：Cookie 可能未登入（缺少 PHPSESSID），若無法下載請改用瀏覽器 Cookie。");
    }

    var picture_path = fs.existsSync("./picture");
    if (!picture_path) {
        fs.mkdirSync("./picture");
    }

    if (monthArg) {
        var monthDates = getDatesInMonth(monthArg);
        if (monthDates.length === 0) {
            console.log("输入的月份格式不正确，格式为 YYYYMM");
            return;
        }
        options.baseDir = "./picture/" + monthArg;
        var i = 0;
        (function runNext() {
            if (i >= monthDates.length) {
                return;
            }
            daily_rank(cookie, monthDates[i], options);
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


    //test cookie 
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

// 讀取並轉換 Cookie 的函式
function loadAndConvertCookie(filePath) {
    try {
        let rawContent = fs.readFileSync(filePath, "utf-8").trim();
        let finalCookie = "";

        // 判斷是否為 JSON 格式 (以 [ 開頭通常是導出的 JSON 陣列)
        if (rawContent.startsWith("[")) {
            console.log("偵測到 JSON 格式 Cookie，正在自動轉換...");
            let cookieArray = JSON.parse(rawContent);
            
            // 將陣列轉換為 key=value; key=value 的格式
            finalCookie = cookieArray
                .map(item => `${item.name}=${item.value}`)
                .join("; ");
        } else {
            // 如果是普通字串，直接去處換行即可
            finalCookie = rawContent.replace(/[\r\n]/g, "");
        }

        return finalCookie;
    } catch (err) {
        console.error("讀取或解析 Cookie 檔案失敗:", err.message);
        return null;
    }
}

//set cookie and save it.when some page need cookie,use it.

let cookiePath = "cookie/pixiv.txt";
if (fs.existsSync(cookiePath)) {
    let convertedCookie = loadAndConvertCookie(cookiePath);
    if (convertedCookie) {
        console.log("Cookie 轉換成功！長度:", convertedCookie.length);
        // 這裡接你原本的 startWithCookie(convertedCookie)
        cookie = convertedCookie;
        startWithCookie(cookie);
    }
}