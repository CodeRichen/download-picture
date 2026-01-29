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

//set cookie and save it.when some page need cookie,use it.
fs.exists("cookie/pixiv.txt", function(exists) {
    if (exists) {
        //var cookie = fs.readFileSync("cookie/pixiv.txt", "utf-8");
      fs.readFile("cookie/pixiv.txt", "utf-8", function(err, res) {
    if (err) {
        console.error("讀取檔案失敗:", err);
        return;
    }
    // 使用 .trim() 刪除字串前後所有的空格與換行
    cookie = res.trim(); 
    console.log("讀取到的 Cookie 長度:", cookie.length); // 檢查長度是否符合預期
    startWithCookie(cookie);
});
    } else {
        console.log("Cookie file not found. Please log in first.");
        login(function(newCookie) {
            cookie = newCookie;
            if (cookie) {
                console.log("cookie已建立，再次运行开始正常操作XD");
                startWithCookie(cookie);
            } else {
                console.log("登录失败，请检查账号密码或网络");
            }
        });
    }
})

//get daily rank
function daily_rank() {
    https.get("https://www.pixiv.net/ranking.php?mode=daily&content=illust", function(res) {
        var html = "";
        res.on("data", function(chunk) {
            html += chunk;
        });
        res.on("end", function(res) {
            var $ = io.load(html);
            var content = $("section h2 a");
            getImgUrl($, content);
        })
    })
}

//
function getImgUrl($, content) {

    var img_url = {};
    var jar = request.jar();
    jar.setCookie(cookie, "https://www.pixiv.net/");
    content.each(function(index, title) {
        img_url[index] = title.attribs.href.match(/illust_id.[0-9]*/g);
        request({
            url: "https://www.pixiv.net/member_illust.php?mode=medium&" + img_url[index],
            headers: {
                'Referer': "https://www.pixiv.net",
                'User-Agent': "Mozilla/5.0 (Windows NT 6.3; rv:27.0) Gecko/20100101 Firefox/27.0",
            },
            jar: jar
        }, function(err, res, body) {
            fs.writeFile("./log/pixiv_" + index + ".html", body, "utf-8", function() {});
        });

        // https.get("https://www.pixiv.net/member_illust.php?mode=medium&" + img_url[index], function(res) {
        //     let _html = "";

        //     res.on("data", function(chunk) {
        //         _html += chunk;
        //     });
        //     res.on("end", function() {
        //         let $ = io.load(_html);
        //         let imgUrl = $(".img-container img").attr("src");
        //         let name = $(".img-container img").attr("src").match(/[0-9]*_[a-z][0-9]*/g);
        //         img_url[index] = imgHead + imgUrl.match(/\/img\/[0-9]*\/[0-9]*\/[0-9]*\/[0-9]*\/[0-9]*\/[0-9]*\/[0-9]*_[a-z][0-9]*/g) + ".png";
        //         console.log(img_url[index]);
        //         //save(img_url[index], name);
        //     })
        // })
    });
}