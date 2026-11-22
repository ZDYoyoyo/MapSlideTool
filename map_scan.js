/******************************************************************************
 * map_scan.js — 遊戲地圖蛇形掃描 + 目標怪經緯度記錄（AutoX.js）
 *
 * ============================== 使用說明 ==============================
 * 【需要安裝】
 *   1. AutoX.js（建議 v6.5 以上；內建 gmlkit / paddle OCR 的版本 OCR 才能用）
 *   2. 在 AutoX.js 中開啟「無障礙服務」，並允許「懸浮窗」權限
 *      （懸浮窗用於 Android 10+ 讀剪貼簿的變通做法）
 *   3. 第一次執行時會跳「截圖權限（螢幕錄製）」對話框，按「立即開始」
 *   4. （選用）想用音量下鍵停止腳本：AutoX 設定裡開啟「音量鍵停止」或
 *      「按鍵監聽」相關權限
 *
 * 【放樣板圖】
 *   1. 在遊戲地圖上手動截一張含目標怪的全螢幕圖（用手機截圖即可）
 *   2. 用修圖 App 只裁出「怪物本體」一小塊（建議 60~150 px 見方，
 *      盡量不要包含地圖背景），存成 PNG
 *   3. 放到手機 /sdcard/MapScan/templates/target.png
 *      （可放多張：不同姿勢/外觀，填進 CONFIG.match.templates 陣列）
 *   4. （強烈建議）再裁一張「只有在地圖主畫面才會出現的 UI 元件」
 *      （例如地圖右下角的指南針按鈕）存成 map_anchor.png，
 *      腳本會用它確認是否已回到地圖畫面
 *   ※ 樣板圖必須在「同一支手機、同一解析度」下截取，否則比對會失敗。
 *
 * 【一定要先改的參數】（都在下方 CONFIG 區塊，標有「★這裡要換」）
 *   - CONFIG.gamePackage           遊戲套件名（可用 AutoX「布局分析」或
 *                                  在腳本中 log(currentPackage()) 取得）
 *   - CONFIG.screen.designWidth/Height  你量測座標時的螢幕解析度
 *   - CONFIG.taps.*                「開啟 Google Map」按鈕、複製連結、返回等座標
 *   - CONFIG.swipe.*               滑動中心點與距離
 *   - CONFIG.match.region          地圖可比對範圍（排除上下 UI 列）
 *   - CONFIG.ocr.*Region           OCR 要辨識的區域
 *   - CONFIG.grid.cols / rows      要掃幾格
 *
 * 【輸出】
 *   /sdcard/MapScan/found.csv        timestamp,lat,lng,screenshot_path
 *   /sdcard/MapScan/unresolved.csv   找到怪但拿不到經緯度的（含 OCR 原文）
 *   /sdcard/MapScan/errors.log       錯誤紀錄
 *   /sdcard/MapScan/progress.json    續跑進度
 *   /sdcard/MapScan/shots/           截圖
 *
 * 【停止】按音量下鍵（若有開按鍵監聽），或在 AutoX 裡直接停止腳本。
 *         進度每格都會存檔，下次執行會從斷點接著跑。
 ******************************************************************************/

// ============================================================================
// =                                CONFIG                                    =
// ============================================================================
// 所有「座標」都以 designWidth x designHeight 這個解析度為準，
// 腳本會自動依實際螢幕比例換算。你用哪支手機截圖量測，就填那支的解析度。
var CONFIG = {
    // ★這裡要換成遊戲實際的套件名
    gamePackage: "com.nianticlabs.pikmin",
    // Google Maps 的套件名（一般不用改）
    googleMapsPackages: ["com.google.android.apps.maps"],

    screen: {
        designWidth: 1080,   // ★這裡要換成你量測座標時的螢幕寬（px）
        designHeight: 2460,  // ★這裡要換成你量測座標時的螢幕高（px）
        landscape: false     // 遊戲若是橫向，改 true
    },

    paths: {
        baseDir: "/sdcard/MapScan/",
        shotsDir: "/sdcard/MapScan/shots/",
        logCsv: "/sdcard/MapScan/found.csv",
        unresolvedCsv: "/sdcard/MapScan/unresolved.csv",
        errorLog: "/sdcard/MapScan/errors.log",
        progressFile: "/sdcard/MapScan/progress.json"
    },

    // ---------------- 目標怪樣板比對 ----------------
    match: {
        // 可放多張樣板（同一隻怪不同外觀），任一張比對到就算
        templates: [
            "/sdcard/MapScan/templates/target.png"
        ],
        threshold: 0.80,            // matchTemplate 相似度門檻（0~1）。誤判多就調高，漏抓多就調低
        // 比對範圍 [x, y, w, h]（design 座標）。★這裡要換：排除上方狀態列/下方按鈕列
        region: [0, 250, 1080, 1850],
        maxPerCapture: 5,           // 單張截圖最多取幾個符合點
        clickOffset: { x: 0, y: 0 },// 點擊位置相對於樣板中心的偏移（design px）
        sameTargetRadius: 80,       // 同一格內，距離小於此值（design px）視為同一隻，不重點
        maxTargetsPerCell: 3        // 每格最多處理幾隻
    },

    // ---------------- 地圖畫面確認（選用但強烈建議） ----------------
    mapAnchor: {
        template: "/sdcard/MapScan/templates/map_anchor.png", // 不用就設成 ""
        threshold: 0.80,
        region: null,               // [x,y,w,h] design 座標；null = 全螢幕
        maxBackPresses: 4           // 找不到 anchor 時最多按幾次返回
    },

    // ---------------- 網格（蛇形）掃描 ----------------
    // 第 0 列：往右掃 cols 格 → 往下 1 格 → 第 1 列：往左掃回來 → 往下 …
    grid: {
        cols: 5,
        rows: 5,
        resume: true,               // 有 progress.json 時從斷點續跑
        // 若遊戲每次從 Google Maps 返回都會「自動回到玩家位置」，設 true：
        // 回來後會快速重播滑動，回到目前這一格
        recenterOnReturn: false,
        fastForwardWait: 700        // 快轉（不比對）時每次滑動後的等待 ms
    },

    // ---------------- 滑動參數 ----------------
    swipe: {
        centerX: 540,               // ★這裡要換：滑動中心點（地圖中央、避開按鈕）
        centerY: 1250,              // ★這裡要換
        distanceX: 700,             // 每次水平滑動距離（建議 < 螢幕寬，保留重疊避免漏抓）
        distanceY: 1100,            // 每次垂直滑動距離（建議 < 地圖可視高度）
        duration: 700,              // 滑動耗時 ms（越慢越不會甩出慣性）
        holdAtEnd: true,            // 結尾停住手指，抑制地圖慣性滑動
        waitAfter: 2500             // 滑動後等怪物刷出的時間 ms
    },

    // ---------------- 各種點擊位置 ----------------
    taps: {
        // 詳情頁「開啟 Google Map」按鈕：先用文字找（無障礙節點），找不到才用座標
        openMapButton: {
            texts: ["開啟 Google Map", "開啟Google Map", "Google Map", "Google 地圖"],
            x: 540, y: 1950         // ★這裡要換成你手機實際的座標
        },
        // 詳情頁若有「複製連結/分享」按鈕，enabled 設 true 並填座標（方法 A 最準）
        copyLinkButton: {
            enabled: false,
            texts: ["複製連結", "複製座標", "複製", "Copy link"],
            x: 960, y: 320          // ★這裡要換成你手機實際的座標
        },
        // 返回：useSystemBack=true 用系統返回鍵；false 則點下面座標（遊戲內返回鈕）
        backButton: {
            useSystemBack: true,
            x: 80, y: 160           // ★這裡要換成你手機實際的座標
        },
        detailCloseBackPresses: 1,  // 回到遊戲後，要按幾次返回才能關閉詳情頁（沒有 anchor 時使用）
        // 點「開啟 Google Map」後若跳出「選擇開啟方式」對話框
        chooser: {
            appTexts: ["Google 地圖", "地圖", "Maps", "Google Maps"],
            onceTexts: ["只限一次", "僅此一次", "Just once"]
        }
    },

    // ---------------- 方法 A：Google Maps 內的分享 → 複製連結 ----------------
    mapsShare: {
        enabled: false,             // 想在 Google Maps 裡按分享複製連結再解析，設 true
        shareTexts: ["分享", "Share"],
        shareButton: { x: 800, y: 1600 },   // ★這裡要換：找不到文字時點這裡
        copyTexts: ["複製連結", "複製", "Copy link", "Copy"],
        copyButton: { x: 540, y: 2100 },    // ★這裡要換
        resolveShortLinks: true     // maps.app.goo.gl 短網址是否連網展開取得座標
    },

    // ---------------- 方法 B：OCR 備援 ----------------
    ocr: {
        enabled: true,
        engine: "auto",             // "auto" | "gmlkit" | "paddle" | "custom"
        language: "zh",             // gmlkit 語言：zh / la(拉丁) / ja / ko ...
        // 要辨識的區域 [x,y,w,h]（design 座標）。★這裡要換
        detailRegion: [0, 400, 1080, 900],  // 遊戲詳情頁上座標/地名所在區域
        mapsRegion: [0, 150, 1080, 350],    // Google Maps 上方搜尋列/底部資訊卡區域
        // engine="custom" 時呼叫此函式：function(img) { return "辨識文字"; }
        // 例如接 Tesseract 外掛時在這裡實作
        customOcr: null
    },

    // ---------------- 等待時間（ms） ----------------
    timing: {
        afterTapMonster: 2500,      // 點怪後等詳情頁
        afterOpenMap: 4000,         // 點「開啟 Google Map」後等 Maps 載入
        waitMapsTimeout: 12000,     // 等 Google Maps 進前景的最長時間
        afterBack: 1500,
        afterLaunchGame: 4000,
        betweenActions: 700,
        clipboardWait: 900
    },

    // ---------------- 重試 ----------------
    retry: {
        perCell: 2,                 // 單格整體失敗重試次數
        perAction: 3                // 單一動作（截圖/點擊等）重試次數
    },

    // ---------------- 去重 ----------------
    // 在 windowMinutes 分鐘內、距離小於 distanceMeters 公尺的座標視為重複
    // windowMinutes = 0 表示不限時間（同一點永遠只記一次）
    dedupe: {
        distanceMeters: 15,
        windowMinutes: 120
    },

    debug: {
        showConsole: true,          // 顯示懸浮 console
        saveDetailShots: false,     // 額外保存詳情頁截圖
        saveMapsShots: false        // 額外保存 Google Maps 截圖
    }
};

// ============================================================================
// =                              全域狀態                                     =
// ============================================================================
var STOP = new java.util.concurrent.atomic.AtomicBoolean(false);
var REAL_W = 0, REAL_H = 0;       // 實際截圖解析度
var TEMPLATES = [];               // [{path, img}]
var ANCHOR_IMG = null;
var RECORDS = [];                 // 已記錄座標 [{t(ms), lat, lng}]，用於去重

// ============================================================================
// =                              小工具                                       =
// ============================================================================
function pad2(n) { return (n < 10 ? "0" : "") + n; }

function fmtTime(d) {
    d = d || new Date();
    return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()) + " " +
        pad2(d.getHours()) + ":" + pad2(d.getMinutes()) + ":" + pad2(d.getSeconds());
}

function fmtFileTime(d) {
    d = d || new Date();
    return d.getFullYear() + pad2(d.getMonth() + 1) + pad2(d.getDate()) + "_" +
        pad2(d.getHours()) + pad2(d.getMinutes()) + pad2(d.getSeconds());
}

/** 解析本腳本寫出的 "yyyy-MM-dd HH:mm:ss"，回傳 ms；失敗回傳 NaN */
function parseTime(s) {
    var m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(String(s).trim());
    if (!m) return NaN;
    return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]).getTime();
}

function info(msg) { console.log("[" + fmtTime() + "] " + msg); }
function warn(msg) { console.warn("[" + fmtTime() + "] " + msg); }

function logError(where, e) {
    var msg = "[" + fmtTime() + "] " + where + ": " + (e && e.stack ? e + "\n" + e.stack : e);
    console.error(msg);
    try { files.append(CONFIG.paths.errorLog, msg + "\n"); } catch (ignore) { }
}

/** 可被停止旗標中斷的 sleep */
function nap(ms) {
    var end = Date.now() + ms;
    while (Date.now() < end) {
        if (STOP.get()) throw new Error("STOP_REQUESTED");
        sleep(Math.min(200, end - Date.now()));
    }
}

/** design 座標 → 實際螢幕座標 */
function sx(v) { return Math.round(v * REAL_W / CONFIG.screen.designWidth); }
function sy(v) { return Math.round(v * REAL_H / CONFIG.screen.designHeight); }

/** 把 design 區域 [x,y,w,h] 換算並夾在截圖範圍內 */
function scaleRegion(r) {
    if (!r) return null;
    var x = Math.max(0, sx(r[0])), y = Math.max(0, sy(r[1]));
    var w = Math.min(sx(r[2]), REAL_W - x), h = Math.min(sy(r[3]), REAL_H - y);
    if (w <= 0 || h <= 0) return null;
    return [x, y, w, h];
}

/** 執行 fn，失敗重試 */
function withRetry(name, times, fn) {
    var lastErr = null;
    for (var i = 1; i <= times; i++) {
        try {
            return fn(i);
        } catch (e) {
            if (String(e).indexOf("STOP_REQUESTED") >= 0) throw e;
            lastErr = e;
            warn(name + " 第 " + i + "/" + times + " 次失敗：" + e);
            nap(800);
        }
    }
    throw lastErr || new Error(name + " failed");
}

function tap(x, y, label) {
    var rx = sx(x), ry = sy(y);
    info("點擊 " + (label || "") + " (" + rx + "," + ry + ")");
    click(rx, ry);
}

/** 嘗試用文字找無障礙節點並點擊；找到回傳 true */
function tapByTexts(texts, timeoutMs) {
    if (!texts || !texts.length) return false;
    var deadline = Date.now() + (timeoutMs || 1500);
    while (Date.now() < deadline) {
        for (var i = 0; i < texts.length; i++) {
            var n = null;
            try {
                n = text(texts[i]).findOnce() || desc(texts[i]).findOnce() ||
                    textContains(texts[i]).findOnce() || descContains(texts[i]).findOnce();
            } catch (e) { n = null; }
            if (n) {
                var b = n.bounds();
                if (b && b.width() > 0 && b.height() > 0) {
                    info("以文字點擊「" + texts[i] + "」(" + b.centerX() + "," + b.centerY() + ")");
                    click(b.centerX(), b.centerY());
                    return true;
                }
            }
        }
        nap(250);
    }
    return false;
}

function pressBack() {
    var bb = CONFIG.taps.backButton;
    if (bb.useSystemBack) { back(); } else { tap(bb.x, bb.y, "返回鈕"); }
    nap(CONFIG.timing.afterBack);
}

function waitForPackage(pkgs, timeoutMs) {
    var end = Date.now() + timeoutMs;
    while (Date.now() < end) {
        var p = currentPackage();
        if (pkgs.indexOf(p) >= 0) return p;
        nap(300);
    }
    return null;
}

/** 截圖（含重試）。注意：captureScreen 回傳的圖會被重複利用，要長期保存請 images.copy */
function grab() {
    return withRetry("截圖", CONFIG.retry.perAction, function () {
        var img = captureScreen();
        if (!img) throw new Error("captureScreen 回傳 null");
        return img;
    });
}

function saveShot(img, name) {
    var p = CONFIG.paths.shotsDir + name + ".jpg";
    try {
        images.save(img, p, "jpg", 85);
        return p;
    } catch (e) {
        logError("saveShot", e);
        return "";
    }
}

// ============================================================================
// =                          經緯度解析                                       =
// ============================================================================
function validLatLng(lat, lng) {
    return isFinite(lat) && isFinite(lng) &&
        lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180 &&
        !(lat === 0 && lng === 0);
}

/**
 * 從任意文字（URL、剪貼簿、OCR 結果、節點文字）抽出經緯度。
 * 支援：geo:lat,lng / ?q=lat,lng / ?ll= / !3dlat!4dlng / @lat,lng /
 *       純文字 "25.03361, 121.56500" / 度分秒 25°02'01.0"N 121°33'54.0"E
 * 回傳 {lat, lng} 或 null
 */
function parseCoords(raw) {
    if (!raw) return null;
    var s = String(raw);
    try { s = decodeURIComponent(s.replace(/\+/g, " ")); } catch (e) { /* 非合法編碼就用原字串 */ }
    // OCR 常見誤判修正：全形符號
    s = s.replace(/，/g, ",").replace(/．/g, ".").replace(/－/g, "-");

    var NUM = "(-?\\d{1,3}\\.\\d{3,})";
    var patterns = [
        new RegExp("geo:" + NUM + "\\s*,\\s*" + NUM),
        new RegExp("!3d" + NUM + "!4d" + NUM),                     // 地點實際座標（優先於 @ 視角中心）
        new RegExp("[?&](?:q|query|ll|sll|center|daddr|destination|loc)=(?:loc:)?\\s*" + NUM + "\\s*,\\s*" + NUM),
        new RegExp("/place/" + NUM + "\\s*,\\s*" + NUM),
        new RegExp("@" + NUM + "\\s*,\\s*" + NUM),
        new RegExp(NUM + "\\s*,\\s*" + NUM)                        // 純文字
    ];
    for (var i = 0; i < patterns.length; i++) {
        var m = patterns[i].exec(s);
        if (m) {
            var lat = parseFloat(m[1]), lng = parseFloat(m[2]);
            if (validLatLng(lat, lng)) return { lat: lat, lng: lng };
        }
    }

    // 度分秒
    var dms = /(\d{1,3})\s*°\s*(\d{1,2})\s*['′’]\s*(\d{1,2}(?:\.\d+)?)\s*["″”]?\s*([NS北南])[\s,]*(\d{1,3})\s*°\s*(\d{1,2})\s*['′’]\s*(\d{1,2}(?:\.\d+)?)\s*["″”]?\s*([EW東西])/i.exec(s);
    if (dms) {
        var la = (+dms[1]) + (+dms[2]) / 60 + (+dms[3]) / 3600;
        var lo = (+dms[5]) + (+dms[6]) / 60 + (+dms[7]) / 3600;
        if (/[S南]/i.test(dms[4])) la = -la;
        if (/[W西]/i.test(dms[8])) lo = -lo;
        if (validLatLng(la, lo)) return { lat: +la.toFixed(6), lng: +lo.toFixed(6) };
    }
    return null;
}

/** 展開短網址（maps.app.goo.gl / goo.gl），沿 Location 轉址直到能解析出座標 */
function resolveShortUrl(url, maxHops) {
    var cur = url;
    for (var i = 0; i < (maxHops || 6); i++) {
        var conn = null;
        try {
            conn = new java.net.URL(cur).openConnection();
            conn.setInstanceFollowRedirects(false);
            conn.setConnectTimeout(8000);
            conn.setReadTimeout(8000);
            conn.setRequestProperty("User-Agent", "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Mobile");
            var code = conn.getResponseCode();
            var loc = conn.getHeaderField("Location");
            if (code >= 300 && code < 400 && loc) {
                cur = String(new java.net.URL(new java.net.URL(cur), loc).toString());
                if (parseCoords(cur)) return cur;
            } else {
                break;
            }
        } catch (e) {
            logError("resolveShortUrl", e);
            break;
        } finally {
            try { if (conn) conn.disconnect(); } catch (ignore) { }
        }
    }
    return cur;
}

/** 從一段文字（可能含網址）解析座標；必要時展開短網址 */
function coordsFromShareText(txt) {
    if (!txt) return null;
    var c = parseCoords(txt);
    if (c) return c;
    if (!CONFIG.mapsShare.resolveShortLinks) return null;
    var urls = String(txt).match(/https?:\/\/[^\s"'<>]+/g) || [];
    for (var i = 0; i < urls.length; i++) {
        info("展開短網址：" + urls[i]);
        var finalUrl = resolveShortUrl(urls[i], 6);
        c = parseCoords(finalUrl);
        if (c) return c;
    }
    return null;
}

// ============================================================================
// =                           剪貼簿                                          =
// ============================================================================
function safeSetClip(s) { try { setClip(s); } catch (e) { } }

/**
 * 讀剪貼簿。Android 10+ 只有前景 App 能讀剪貼簿，
 * 因此失敗時建立 1x1 可取得焦點的懸浮窗再讀一次。
 */
function readClipboard() {
    var clip = "";
    try { clip = getClip() || ""; } catch (e) { clip = ""; }
    if (clip) return String(clip);

    var w = null;
    try {
        w = floaty.rawWindow(<frame />);
        w.setSize(1, 1);
        w.setTouchable(false);
        ui.run(function () { w.requestFocus(); });
        sleep(300);
        var result = threads.disposable();
        ui.run(function () {
            try { result.setAndNotify(String(getClip() || "")); } catch (e) { result.setAndNotify(""); }
        });
        clip = result.blockedGet();
    } catch (e) {
        logError("readClipboard(floaty)", e);
    } finally {
        try { if (w) w.close(); } catch (ignore) { }
    }
    return clip || "";
}

// ============================================================================
// =                    方法 A2：掃描無障礙節點文字                             =
// ============================================================================
/** 掃描目前畫面所有 text / desc，找出含經緯度的那一個 */
function coordsFromScreenNodes() {
    var re = /.*(\d+\.\d{3,}|°|geo:|maps).*/;
    var sources = [];
    try { sources.push(textMatches(re).find()); } catch (e) { }
    try { sources.push(descMatches(re).find()); } catch (e) { }
    for (var s = 0; s < sources.length; s++) {
        var col = sources[s];
        if (!col) continue;
        for (var i = 0; i < col.size(); i++) {
            var n = col.get(i);
            var t = (n.text() || "") + " " + (n.desc() || "");
            var c = parseCoords(t);
            if (c) { info("從畫面節點文字取得座標：" + t.trim()); return c; }
        }
    }
    return null;
}

// ============================================================================
// =                           方法 B：OCR                                     =
// ============================================================================
/** 將各家 OCR 結果統一轉成字串 */
function ocrResultToText(r) {
    if (r == null) return "";
    if (typeof r === "string") return r;
    if (r.text !== undefined && typeof r.text !== "function") return String(r.text);
    // 陣列（paddle.ocr 回傳 [{text,...}]、paddle.ocrText 回傳 [string]）
    var arr = [];
    try {
        var len = r.length !== undefined ? r.length : (r.size ? r.size() : 0);
        for (var i = 0; i < len; i++) {
            var it = r[i] !== undefined ? r[i] : r.get(i);
            arr.push(typeof it === "string" ? it : (it && it.text ? String(it.text) : String(it)));
        }
    } catch (e) { }
    return arr.join("\n");
}

function runOcr(img) {
    var cfg = CONFIG.ocr;
    var engine = cfg.engine;
    if (engine === "custom" || (engine === "auto" && typeof cfg.customOcr === "function")) {
        if (typeof cfg.customOcr === "function") return String(cfg.customOcr(img) || "");
    }
    if ((engine === "auto" || engine === "gmlkit") && typeof gmlkit !== "undefined" && gmlkit.ocr) {
        return ocrResultToText(gmlkit.ocr(img, cfg.language));
    }
    if ((engine === "auto" || engine === "paddle") && typeof paddle !== "undefined") {
        if (paddle.ocrText) return ocrResultToText(paddle.ocrText(img));
        if (paddle.ocr) return ocrResultToText(paddle.ocr(img));
    }
    throw new Error("找不到可用的 OCR 引擎（請升級 AutoX.js 或設定 CONFIG.ocr.customOcr）");
}

/** 對 img 的指定 design 區域做 OCR，回傳 {text, coords} */
function ocrRegion(img, designRegion) {
    var r = scaleRegion(designRegion);
    var sub = null;
    try {
        sub = r ? images.clip(img, r[0], r[1], r[2], r[3]) : img;
        var txt = runOcr(sub);
        info("OCR 結果：" + txt.replace(/\n/g, " | ").substr(0, 200));
        return { text: txt, coords: parseCoords(txt) };
    } finally {
        if (sub && sub !== img) { try { sub.recycle(); } catch (e) { } }
    }
}

// ============================================================================
// =                     樣板比對 / 地圖畫面確認                               =
// ============================================================================
function loadTemplates() {
    CONFIG.match.templates.forEach(function (p) {
        if (!files.exists(p)) throw new Error("樣板圖不存在：" + p);
        var img = images.read(p);
        if (!img) throw new Error("樣板圖讀取失敗：" + p);
        TEMPLATES.push({ path: p, img: img });
        info("載入樣板 " + p + "（" + img.getWidth() + "x" + img.getHeight() + "）");
    });
    var ap = CONFIG.mapAnchor.template;
    if (ap) {
        if (files.exists(ap)) {
            ANCHOR_IMG = images.read(ap);
            info("載入地圖 anchor 樣板 " + ap);
        } else {
            warn("找不到地圖 anchor 樣板 " + ap + "，將改用固定次數返回");
        }
    }
}

/**
 * 在截圖中找出所有目標怪，回傳 [{x, y, sim, tpl}]（實際螢幕座標 = 樣板中心）
 * 已依相似度排序並合併過近的點
 */
function findTargets(img) {
    var region = scaleRegion(CONFIG.match.region);
    var hits = [];
    TEMPLATES.forEach(function (t) {
        var opt = { threshold: CONFIG.match.threshold, max: CONFIG.match.maxPerCapture };
        if (region) opt.region = region;
        var res = images.matchTemplate(img, t.img, opt);
        if (!res || !res.matches) return;
        res.matches.forEach(function (m) {
            hits.push({
                x: m.point.x + t.img.getWidth() / 2,
                y: m.point.y + t.img.getHeight() / 2,
                sim: m.similarity,
                tpl: t.path
            });
        });
    });
    hits.sort(function (a, b) { return b.sim - a.sim; });
    // 合併重疊點（多張樣板命中同一隻）
    var merged = [];
    var r = sx(CONFIG.match.sameTargetRadius);
    hits.forEach(function (h) {
        for (var i = 0; i < merged.length; i++) {
            if (Math.abs(merged[i].x - h.x) < r && Math.abs(merged[i].y - h.y) < r) return;
        }
        merged.push(h);
    });
    return merged;
}

function isOnMap() {
    if (!ANCHOR_IMG) return null; // 未設定，無法判斷
    var img = grab();
    var opt = { threshold: CONFIG.mapAnchor.threshold };
    var reg = scaleRegion(CONFIG.mapAnchor.region);
    if (reg) opt.region = reg;
    return !!images.findImage(img, ANCHOR_IMG, opt);
}

/** 確保回到遊戲地圖畫面 */
function ensureOnMap() {
    if (currentPackage() !== CONFIG.gamePackage) {
        info("目前前景：" + currentPackage() + "，切回遊戲");
        app.launch(CONFIG.gamePackage);
        if (!waitForPackage([CONFIG.gamePackage], 15000)) throw new Error("無法切回遊戲");
        nap(CONFIG.timing.afterLaunchGame);
    }
    if (ANCHOR_IMG) {
        for (var i = 0; i <= CONFIG.mapAnchor.maxBackPresses; i++) {
            if (isOnMap()) { info("已確認回到地圖畫面"); return true; }
            info("尚未回到地圖，按返回（" + (i + 1) + "）");
            pressBack();
            if (currentPackage() !== CONFIG.gamePackage) {   // 按過頭跳出遊戲
                app.launch(CONFIG.gamePackage);
                waitForPackage([CONFIG.gamePackage], 15000);
                nap(CONFIG.timing.afterLaunchGame);
            }
        }
        throw new Error("多次返回仍找不到地圖 anchor");
    }
    return true;
}

// ============================================================================
// =                          滑動 / 網格                                      =
// ============================================================================
/**
 * 依方向平移「視野」：
 *   right = 看右邊的地圖 → 手指由右往左滑
 *   left  = 看左邊      → 手指由左往右滑
 *   down  = 看下面      → 手指由下往上滑
 */
function panView(dir) {
    var c = CONFIG.swipe;
    var cx = c.centerX, cy = c.centerY, hx = c.distanceX / 2, hy = c.distanceY / 2;
    var x1 = cx, y1 = cy, x2 = cx, y2 = cy;
    if (dir === "right") { x1 = cx + hx; x2 = cx - hx; }
    else if (dir === "left") { x1 = cx - hx; x2 = cx + hx; }
    else if (dir === "down") { y1 = cy + hy; y2 = cy - hy; }
    else if (dir === "up") { y1 = cy - hy; y2 = cy + hy; }
    var p1 = [sx(x1), sy(y1)], p2 = [sx(x2), sy(y2)];
    if (c.holdAtEnd) {
        // 最後一段停在終點不動，讓地圖不會甩出慣性
        gesture(c.duration, p1, p2, p2);
    } else {
        swipe(p1[0], p1[1], p2[0], p2[1], c.duration);
    }
}

/** 蛇形網格：第 i 格（0 起算）的列/行 */
function cellOf(i) {
    var cols = CONFIG.grid.cols;
    var r = Math.floor(i / cols);
    var k = i % cols;
    var c = (r % 2 === 0) ? k : (cols - 1 - k);
    return { row: r, col: c };
}

/** 從第 i-1 格移到第 i 格需要的方向 */
function moveBefore(i) {
    var cols = CONFIG.grid.cols;
    if (i % cols === 0) return "down";
    return (Math.floor(i / cols) % 2 === 0) ? "right" : "left";
}

/** 不比對、快速把地圖從起點滑到第 target 格 */
function fastForwardTo(target) {
    if (target <= 0) return;
    info("快轉滑動至第 " + target + " 格 …");
    for (var i = 1; i <= target; i++) {
        panView(moveBefore(i));
        nap(CONFIG.grid.fastForwardWait);
    }
}

// ============================================================================
// =                           紀錄 / 去重 / 進度                              =
// ============================================================================
function haversine(a, b) {
    var R = 6371000, toRad = Math.PI / 180;
    var dLat = (b.lat - a.lat) * toRad, dLng = (b.lng - a.lng) * toRad;
    var s = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(a.lat * toRad) * Math.cos(b.lat * toRad) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return 2 * R * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
}

function loadExistingRecords() {
    var p = CONFIG.paths.logCsv;
    if (!files.exists(p)) {
        files.write(p, "timestamp,lat,lng,screenshot_path\n");
        return;
    }
    var lines = String(files.read(p)).split(/\r?\n/);
    for (var i = 1; i < lines.length; i++) {
        var f = lines[i].split(",");
        if (f.length < 3) continue;
        var t = parseTime(f[0]), lat = parseFloat(f[1]), lng = parseFloat(f[2]);
        if (validLatLng(lat, lng)) RECORDS.push({ t: isNaN(t) ? 0 : t, lat: lat, lng: lng });
    }
    info("已載入既有紀錄 " + RECORDS.length + " 筆（用於去重）");
}

function isDuplicate(c, nowMs) {
    var win = CONFIG.dedupe.windowMinutes * 60000;
    for (var i = 0; i < RECORDS.length; i++) {
        var r = RECORDS[i];
        if (win > 0 && Math.abs(nowMs - r.t) > win) continue;
        if (haversine(r, c) <= CONFIG.dedupe.distanceMeters) return true;
    }
    return false;
}

function csvEscape(s) {
    s = String(s == null ? "" : s);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

/** 寫入 found.csv；重複則略過。回傳 true=已寫入 */
function recordCoords(c, shotPath) {
    var now = new Date();
    if (isDuplicate(c, now.getTime())) {
        info("座標 " + c.lat + "," + c.lng + " 與近期紀錄重複，略過");
        return false;
    }
    var line = [fmtTime(now), c.lat.toFixed(6), c.lng.toFixed(6), csvEscape(shotPath)].join(",");
    files.append(CONFIG.paths.logCsv, line + "\n");
    RECORDS.push({ t: now.getTime(), lat: c.lat, lng: c.lng });
    info("★ 已記錄：" + line);
    return true;
}

function recordUnresolved(shotPath, note) {
    var p = CONFIG.paths.unresolvedCsv;
    if (!files.exists(p)) files.write(p, "timestamp,screenshot_path,note\n");
    files.append(p, [fmtTime(), csvEscape(shotPath), csvEscape(note)].join(",") + "\n");
    warn("找到目標但無法取得座標，已寫入 unresolved.csv");
}

function loadProgress() {
    try {
        var p = CONFIG.paths.progressFile;
        if (!files.exists(p)) return null;
        var o = JSON.parse(files.read(p));
        // 網格尺寸改過就不續跑
        if (o.cols !== CONFIG.grid.cols || o.rows !== CONFIG.grid.rows) return null;
        return o;
    } catch (e) { logError("loadProgress", e); return null; }
}

function saveProgress(nextIndex) {
    try {
        files.write(CONFIG.paths.progressFile, JSON.stringify({
            nextIndex: nextIndex, cols: CONFIG.grid.cols, rows: CONFIG.grid.rows, updated: fmtTime()
        }));
    } catch (e) { logError("saveProgress", e); }
}

// ============================================================================
// =                     核心：處理一隻目標怪                                  =
// ============================================================================
/**
 * 點怪 → 詳情 → (A)複製/節點文字 → 開 Google Map → (A)節點/分享 → (B)OCR → 記錄 → 回地圖
 * @return true=成功取得座標（含重複略過）
 */
function handleTarget(hit, cellShotPath, label) {
    var coords = null, ocrNotes = [];
    var detailImg = null;

    try {
        // ---- 1. 點擊怪物 ----
        var ox = sx(CONFIG.match.clickOffset.x), oy = sy(CONFIG.match.clickOffset.y);
        info(label + " 點擊目標怪 (" + Math.round(hit.x + ox) + "," + Math.round(hit.y + oy) + ") 相似度 " + hit.sim.toFixed(3));
        click(Math.round(hit.x + ox), Math.round(hit.y + oy));
        nap(CONFIG.timing.afterTapMonster);

        // 詳情頁截圖先存一份（之後已離開此頁，OCR 時要用）
        detailImg = images.copy(grab());
        if (CONFIG.debug.saveDetailShots) saveShot(detailImg, "detail_" + fmtFileTime() + "_" + label);

        // ---- 2. 方法 A：詳情頁「複製連結」→ 剪貼簿 ----
        if (CONFIG.taps.copyLinkButton.enabled) {
            safeSetClip("");
            var cb = CONFIG.taps.copyLinkButton;
            if (!tapByTexts(cb.texts, 1200)) tap(cb.x, cb.y, "複製連結");
            nap(CONFIG.timing.clipboardWait);
            var clip = readClipboard();
            info("剪貼簿內容：" + clip.substr(0, 150));
            coords = coordsFromShareText(clip);
            if (coords) info("方法 A（詳情頁剪貼簿）成功");
        }

        // ---- 3. 方法 A2：詳情頁上的節點文字 ----
        if (!coords) {
            coords = coordsFromScreenNodes();
            if (coords) info("方法 A2（詳情頁節點文字）成功");
        }

        // ---- 4. 點「開啟 Google Map」 ----
        if (!coords) {
            var om = CONFIG.taps.openMapButton;
            if (!tapByTexts(om.texts, 1500)) tap(om.x, om.y, "開啟 Google Map");
            nap(CONFIG.timing.betweenActions);

            // 若跳出「開啟方式」選擇器
            if (currentPackage() !== CONFIG.gamePackage &&
                CONFIG.googleMapsPackages.indexOf(currentPackage()) < 0) {
                if (tapByTexts(CONFIG.taps.chooser.appTexts, 1500)) {
                    nap(500);
                    tapByTexts(CONFIG.taps.chooser.onceTexts, 1000);
                }
            }

            var pkg = waitForPackage(CONFIG.googleMapsPackages, CONFIG.timing.waitMapsTimeout);
            if (!pkg) {
                warn("Google Maps 未開啟（前景：" + currentPackage() + "）");
            } else {
                nap(CONFIG.timing.afterOpenMap);

                // ---- 5. 方法 A2：Google Maps 畫面文字（以座標開啟時搜尋列通常就是 lat,lng）----
                coords = coordsFromScreenNodes();
                if (coords) info("方法 A2（Google Maps 節點文字）成功");

                // ---- 6. 方法 A：Google Maps 分享 → 複製連結 ----
                if (!coords && CONFIG.mapsShare.enabled) {
                    var ms = CONFIG.mapsShare;
                    safeSetClip("");
                    if (!tapByTexts(ms.shareTexts, 1500)) tap(ms.shareButton.x, ms.shareButton.y, "Maps 分享");
                    nap(CONFIG.timing.betweenActions + 500);
                    if (!tapByTexts(ms.copyTexts, 2000)) tap(ms.copyButton.x, ms.copyButton.y, "複製連結");
                    nap(CONFIG.timing.clipboardWait);
                    var clip2 = readClipboard();
                    info("剪貼簿內容：" + clip2.substr(0, 150));
                    coords = coordsFromShareText(clip2);
                    if (coords) info("方法 A（Maps 分享連結）成功");
                }

                // ---- 7. 方法 B：OCR Google Maps 畫面 ----
                if (!coords && CONFIG.ocr.enabled) {
                    try {
                        var mapsImg = grab();
                        if (CONFIG.debug.saveMapsShots) saveShot(mapsImg, "maps_" + fmtFileTime() + "_" + label);
                        var o1 = ocrRegion(mapsImg, CONFIG.ocr.mapsRegion);
                        ocrNotes.push("maps:" + o1.text);
                        coords = o1.coords;
                        if (coords) info("方法 B（OCR Google Maps）成功");
                    } catch (e) { logError("OCR maps", e); }
                }
            }
        }

        // ---- 8. 方法 B：OCR 詳情頁截圖 ----
        if (!coords && CONFIG.ocr.enabled && detailImg) {
            try {
                var o2 = ocrRegion(detailImg, CONFIG.ocr.detailRegion);
                ocrNotes.push("detail:" + o2.text);
                coords = o2.coords;
                if (coords) info("方法 B（OCR 詳情頁）成功");
            } catch (e) { logError("OCR detail", e); }
        }

        // ---- 9. 寫紀錄 ----
        if (coords) {
            recordCoords(coords, cellShotPath);
        } else {
            recordUnresolved(cellShotPath, ocrNotes.join(" || ").replace(/\s+/g, " ").substr(0, 500));
        }
        return !!coords;
    } finally {
        if (detailImg) { try { detailImg.recycle(); } catch (e) { } }
        // ---- 10. 回到遊戲地圖 ----
        returnToGameMap();
    }
}

function returnToGameMap() {
    try {
        var leftGame = currentPackage() !== CONFIG.gamePackage;
        if (leftGame) {
            // 從 Google Maps 回來：直接啟動遊戲（比狂按返回可靠）
            app.launch(CONFIG.gamePackage);
            waitForPackage([CONFIG.gamePackage], 15000);
            nap(CONFIG.timing.afterLaunchGame);
        }
        if (ANCHOR_IMG) {
            ensureOnMap();
        } else {
            for (var i = 0; i < CONFIG.taps.detailCloseBackPresses; i++) pressBack();
        }
    } catch (e) {
        if (String(e).indexOf("STOP_REQUESTED") >= 0) throw e;
        logError("returnToGameMap", e);
    }
}

// ============================================================================
// =                       核心：掃描一格                                      =
// ============================================================================
function scanCell(index, total) {
    var cell = cellOf(index);
    var label = "r" + cell.row + "c" + cell.col;
    var handled = [];      // 本格已處理過的螢幕位置
    var count = 0;

    for (var round = 0; round < CONFIG.match.maxTargetsPerCell; round++) {
        var img = grab();
        var hits = findTargets(img).filter(function (h) {
            var r = sx(CONFIG.match.sameTargetRadius);
            return !handled.some(function (p) { return Math.abs(p.x - h.x) < r && Math.abs(p.y - h.y) < r; });
        });
        if (round === 0) {
            info("格 " + (index + 1) + "/" + total + " [" + label + "] 比對到 " + hits.length + " 個目標");
        }
        if (!hits.length) break;

        var hit = hits[0];
        handled.push(hit);
        var shotPath = saveShot(img, "target_" + fmtFileTime() + "_" + label + "_" + round);

        try {
            withRetry("處理目標 " + label + "#" + round, 2, function (attempt) {
                if (attempt > 1) ensureOnMap();
                handleTarget(hit, shotPath, label + "#" + round);
            });
            count++;
        } catch (e) {
            if (String(e).indexOf("STOP_REQUESTED") >= 0) throw e;
            logError("處理目標 " + label + "#" + round, e);
            ensureOnMap();
        }

        // 遊戲回來後若會自動置中，重播到目前這格
        if (CONFIG.grid.recenterOnReturn) {
            fastForwardTo(index);
            nap(CONFIG.swipe.waitAfter);
        }
    }
    return count;
}

// ============================================================================
// =                              主流程                                       =
// ============================================================================
function setup() {
    if (CONFIG.debug.showConsole) { try { console.show(); } catch (e) { } }

    auto.waitFor();   // 等無障礙服務
    [CONFIG.paths.baseDir, CONFIG.paths.shotsDir].forEach(function (d) { files.ensureDir(d); });
    files.ensureDir(CONFIG.paths.logCsv);

    // 截圖權限；自動點「立即開始」
    threads.start(function () {
        for (var i = 0; i < 10; i++) {
            var b = textMatches(/(立即開始|立即开始|開始|开始|Start now|START NOW|允許|允许)/).findOne(1000);
            if (b) { try { b.click() || click(b.bounds().centerX(), b.bounds().centerY()); } catch (e) { } break; }
        }
    });
    if (!requestScreenCapture(CONFIG.screen.landscape)) throw new Error("未取得截圖權限");
    sleep(1000);

    // 以實際截圖尺寸作為座標換算基準
    var probe = captureScreen();
    REAL_W = probe.getWidth();
    REAL_H = probe.getHeight();
    info("實際螢幕 " + REAL_W + "x" + REAL_H + "，設定基準 " +
        CONFIG.screen.designWidth + "x" + CONFIG.screen.designHeight);

    loadTemplates();
    loadExistingRecords();
}

function mainLoop() {
    setup();

    var total = CONFIG.grid.cols * CONFIG.grid.rows;
    var start = 0;
    if (CONFIG.grid.resume) {
        var prog = loadProgress();
        if (prog && prog.nextIndex > 0 && prog.nextIndex < total) {
            start = prog.nextIndex;
            info("偵測到續跑進度：從第 " + (start + 1) + " 格開始（上次 " + prog.updated + "）");
        }
    }

    // 確認在遊戲地圖畫面（地圖應位於起點，例如以玩家為中心）
    app.launch(CONFIG.gamePackage);
    waitForPackage([CONFIG.gamePackage], 15000);
    nap(CONFIG.timing.afterLaunchGame);
    ensureOnMap();

    if (start > 0) fastForwardTo(start - 1);   // 先快轉到上一格，下面迴圈會再滑一次到 start

    var found = 0;
    for (var i = start; i < total; i++) {
        if (STOP.get()) break;
        var cell = cellOf(i);
        try {
            if (i > 0) {
                var dir = moveBefore(i);
                info("→ 滑動 " + dir + "，前往格 " + (i + 1) + "/" + total + " [r" + cell.row + "c" + cell.col + "]");
                withRetry("滑動", CONFIG.retry.perAction, function () { panView(dir); });
                nap(CONFIG.swipe.waitAfter);
            }
            var ok = false;
            for (var t = 0; t <= CONFIG.retry.perCell && !ok; t++) {
                try {
                    found += scanCell(i, total);
                    ok = true;
                } catch (e) {
                    if (String(e).indexOf("STOP_REQUESTED") >= 0) throw e;
                    logError("掃描格 " + (i + 1) + " 第 " + (t + 1) + " 次", e);
                    try { ensureOnMap(); } catch (e2) { logError("ensureOnMap", e2); }
                }
            }
            if (!ok) warn("格 " + (i + 1) + " 失敗，跳過");
        } catch (e) {
            if (String(e).indexOf("STOP_REQUESTED") >= 0) { saveProgress(i); throw e; }
            logError("格 " + (i + 1), e);   // 單格失敗不中斷整體
        }
        saveProgress(i + 1);
    }

    if (!STOP.get()) {
        files.remove(CONFIG.paths.progressFile);
        info("===== 掃描完成，本次處理目標 " + found + " 隻 =====");
    }
}

// ---- 入口：工作執行緒跑掃描，主執行緒負責監聽停止鍵 ----
var worker = threads.start(function () {
    try {
        mainLoop();
    } catch (e) {
        if (String(e).indexOf("STOP_REQUESTED") >= 0) info("已依要求停止，進度已保存");
        else logError("FATAL", e);
    } finally {
        TEMPLATES.forEach(function (t) { try { t.img.recycle(); } catch (e) { } });
        if (ANCHOR_IMG) { try { ANCHOR_IMG.recycle(); } catch (e) { } }
    }
});

try {
    events.observeKey();
    events.onKeyDown("volume_down", function () {
        info("收到音量下鍵，將在安全點停止 …");
        STOP.set(true);
    });
} catch (e) {
    warn("無法監聽按鍵（未開啟按鍵監聽權限），請直接在 AutoX 中停止腳本");
}

// 工作執行緒結束後結束腳本
var watcher = setInterval(function () {
    if (!worker.isAlive()) { clearInterval(watcher); exit(); }
}, 1000);
