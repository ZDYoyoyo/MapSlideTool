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
 * 【放樣板圖】（目標換了只要換這個資料夾裡的圖，不用改程式）
 *   1. 在遊戲地圖上截一張含目標的全螢幕圖（用手機截圖即可）
 *   2. 用相簿的「裁切」只框出目標本體一小塊（約 80~150 px 見方），
 *      不要框到上面會變動的數字/計時圈，也盡量少框地圖背景
 *   3. 放進 /sdcard/MapScan/templates/targets/（png 或 jpg 都可）
 *      資料夾裡「所有圖片」都會被當成目標，任一張比對到就算：
 *        - 換目標：刪掉舊圖、放新圖
 *        - 同時找多種目標：放多張
 *   4. map_anchor.png 放在 /sdcard/MapScan/templates/（地圖模式底部
 *      中間那顆「地圖」切換按鈕），用來確認已回到地圖畫面
 *   5. popup_arrow.png 放在 /sdcard/MapScan/templates/（點蘑菇後出現的
 *      黑色名稱泡泡右邊的「>」），用來找泡泡並點進詳情頁
 *   ※ 樣板圖必須在「同一支手機、同一解析度、差不多的地圖縮放」下截取。
 *
 * 【參數】（CONFIG 區塊）
 *   已依 Pikmin Bloom + 1080x2460 螢幕的截圖量好，通常只需要調：
 *   - CONFIG.grid.cols / rows      要掃幾格
 *   - CONFIG.match.threshold       漏抓→調低、誤判→調高
 *   - CONFIG.swipe.waitAfter       物件刷出慢就調長
 *   換手機或遊戲改版時，再重量 taps / region 相關座標。
 *
 * 【輸出】
 *   /sdcard/MapScan/found.csv        timestamp,lat,lng,screenshot_path,players,updated_at
 *                                    每顆目標一行；players = 人頭圖案旁的參加人數（讀不到留空），
 *                                    再次掃到同一顆會更新 players 與 updated_at（最後看到的時間）
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
    // 遊戲套件名（Pikmin Bloom）
    gamePackage: "com.nianticlabs.pikmin",
    // Google Maps 的套件名（一般不用改）
    googleMapsPackages: ["com.google.android.apps.maps"],

    screen: {
        designWidth: 1080,   // 量測座標時的螢幕寬（px）
        designHeight: 2460,  // 量測座標時的螢幕高（px）
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

    // ---------------- 目標樣板比對 ----------------
    match: {
        // 這個資料夾裡所有 png/jpg 都會載入當樣板（換目標只要換圖）
        templateDir: "/sdcard/MapScan/templates/targets/",
        // 也可以另外指定個別檔案（可留空陣列）
        templates: [],
        // matchTemplate 相似度門檻（0~1）。漏抓就調低（0.7），誤判就調高（0.85）
        threshold: 0.75,
        // 比對範圍 [x, y, w, h]：排除上方 console 視窗(實測到 ~390px)與底部按鈕列(~2200px 起)
        // 依你 1080x2460 的截圖量測，畫面改版再調
        region: [0, 400, 1080, 1800],
        maxPerCapture: 5,           // 單張截圖最多取幾個符合點
        clickOffset: { x: 0, y: 30 },// 點擊位置相對於樣板中心的偏移（樣板是蘑菇傘，往下點一點較穩）
        sameTargetRadius: 120,      // 同一格內，距離小於此值（px）視為同一隻，不重點
        maxTargetsPerCell: 3        // 每格最多處理幾隻
    },

    // ---------------- 加速 ①：推算位置，已記錄的目標不再點進去 ----------------
    // 每次點進去拿到精確座標時，會用「目標在畫面上的位置 + 比例尺」校正地圖基準點；
    // 之後滑動就依滑動距離推算畫面上每個目標的大概經緯度。
    // 推算位置附近已有紀錄 → 只更新人數（約 1 秒），不開 Google Maps（約 10~20 秒）
    fastSkip: {
        enabled: true,
        radiusMeters: 60,           // 推算位置與已記錄目標距離在此內 → 視為同一顆
        maxSwipesSinceCalib: 40     // 距上次校正超過幾次滑動，就不信任推算（強制點進去重新校正）
    },

    // ---------------- 加速 ②：空地（沒有道路）快速略過 ----------------
    // 菇只長在地標附近，沒有道路的空地/海面不會有菇。
    // 滑動後先檢查畫面上「道路（亮色線條）」的比例，太低就直接跳下一格，不等物件刷出
    emptySkip: {
        enabled: true,
        brightThreshold: 200,       // 灰階亮度高於此值視為道路像素（草地約 150、道路約 220）
        minRoadRatio: 0.01,         // 道路像素比例低於此值 → 空地（市區實測 6~12%，無路草地約 0.2%）
        confirmMs: 1500             // 最多等多久確認是空地（等地圖圖磚載入，網路慢就調長）
    },

    // ---------------- 參加人數（人頭圖案旁的數字） ----------------
    // 在地圖截圖上，以「目標樣板中心」為基準，往右上方框出數字所在區域做 OCR
    players: {
        enabled: true,
        // [dx, dy, w, h]：相對於樣板中心的偏移與大小（依你 5 張截圖量測，人頭在蘑菇傘右上方）
        region: [36, -98, 88, 52],
        scale: 3,                   // 放大幾倍再辨識（數字很小，放大較準）
        language: "la"              // gmlkit 用拉丁字母模型辨識數字較準
    },

    // ---------------- 點目標後的名稱泡泡 ----------------
    // Pikmin Bloom：點蘑菇後上方會出現「巨大 輝煌蘑菇 / 地名 >」的黑色泡泡，要再點泡泡才進詳情頁
    popup: {
        enabled: true,
        template: "/sdcard/MapScan/templates/popup_arrow.png", // 泡泡右側的「>」
        threshold: 0.85,
        // 找不到泡泡時的備援：點「目標中心 + 這個偏移」（泡泡約在蘑菇傘上方 165px）
        fallbackOffset: { x: 0, y: -165 },
        waitAfterTapTarget: 2500,   // 點蘑菇後最多等多久讓泡泡出現（一出現就點，不會等滿）
        retries: 2                  // 點完泡泡仍停在地圖上時，重試幾次
    },

    // ---------------- 地圖畫面確認（選用但強烈建議） ----------------
    mapAnchor: {
        template: "/sdcard/MapScan/templates/map_anchor.png", // 不用就設成 ""
        threshold: 0.80,
        region: [380, 2180, 320, 240], // 只在底部中間找，比較快也不易誤判
        maxBackPresses: 4           // 找不到 anchor 時最多按幾次返回
    },

    // ---------------- 網格（蛇形）掃描 ----------------
    // 第 0 列：往右掃 cols 格 → 往下 1 格 → 第 1 列：往左掃回來 → 往下 …
    grid: {
        // 想直接用「公里」指定範圍就填這裡：10（= 往東 10km、往南 10km），
        // 或 { east: 20, south: 5 }（東西 20km、南北 5km），
        // 會自動算出 cols/rows；設成 null 則使用下面的 cols/rows
        sizeKm: null,
        // 地圖比例尺：1 px ≈ 幾公尺（依兩顆菇座標實測：712 px ≈ 386 m）
        // 地圖有透視傾斜，垂直方向尚未實測，暫用相同數值
        metersPerPixelX: 0.542,
        metersPerPixelY: 0.542,
        cols: 5,
        rows: 5,
        resume: true,               // 有 progress.json 時，啟動會跳視窗問你要不要接續
        // 若遊戲每次從 Google Maps 返回都會「自動回到玩家位置」，設 true：
        // 回來後會快速重播滑動，回到目前這一格
        recenterOnReturn: false,
        fastForwardWait: 700        // 快轉（不比對）時每次滑動後的等待 ms
    },

    // ---------------- 滑動參數 ----------------
    swipe: {
        centerX: 540,               // 滑動中心點（地圖中央，避開右上頭像與底部按鈕）
        centerY: 1200,
        distanceX: 800,             // 每次水平滑動距離（螢幕寬 1080，約留 25% 重疊）
        distanceY: 1400,            // 每次垂直滑動距離（比對高度 1800，約留 20% 重疊）
        duration: 700,              // 滑動耗時 ms（越慢越不會甩出慣性）
        holdAtEnd: true,            // 結尾停住手指，抑制地圖慣性滑動
        waitAfter: 3000             // 滑動後等地圖物件刷出的時間 ms
    },

    // ---------------- 各種點擊位置 ----------------
    // 座標依你 1080x2460 的截圖量測
    taps: {
        // 從詳情頁開啟 Google Maps 要依序點的按鈕（Pikmin Bloom：前往這裡 → 在地圖應用程式開啟）
        // 遊戲是 Unity 製作，按鈕多半讀不到文字，所以主要靠座標；texts 只是先試一下
        openMapSteps: [
            { name: "前往這裡",           texts: ["前往這裡"],           x: 870, y: 2308, wait: 1500 },
            { name: "在地圖應用程式開啟", texts: ["在地圖應用程式開啟"], x: 540, y: 2118, wait: 800 }
        ],
        textSearchTimeout: 600,     // 每個按鈕用文字找的時間 ms（Unity 畫面找不到，設短一點）
        // 詳情頁若有「複製連結/分享」按鈕，enabled 設 true 並填座標（Pikmin Bloom 沒有，保持 false）
        copyLinkButton: {
            enabled: false,
            texts: ["複製連結", "複製座標", "複製", "Copy link"],
            x: 960, y: 320
        },
        // 返回：useSystemBack=true 用系統返回鍵；false 則點遊戲左下角的「<」
        backButton: {
            useSystemBack: true,
            x: 105, y: 2310
        },
        detailCloseBackPresses: 1,  // 回到遊戲後，要按幾次返回才能關閉詳情頁（沒有 anchor 時使用）
        // 若跳出「選擇開啟方式」對話框（有設預設 App 就不會出現）
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
        // 要辨識的區域 [x,y,w,h]
        detailRegion: [300, 120, 480, 150], // 詳情頁頂端地名（如「王公廟」），只能記到 unresolved 當參考
        mapsRegion: [0, 110, 1080, 160],    // Google Maps 頂端搜尋列（顯示 "22.506671,120.386556"）
        // engine="custom" 時呼叫此函式：function(img) { return "辨識文字"; }
        // 例如接 Tesseract 外掛時在這裡實作
        customOcr: null
    },

    // ---------------- 等待時間（ms） ----------------
    // 標「最多」的是上限：條件一達成就繼續，不會等滿
    timing: {
        pollInterval: 300,          // 偵測畫面變化的間隔
        detailMaxWait: 4000,        // 點泡泡後，最多等多久進入詳情頁
        detailSettle: 700,          // 進入詳情頁後等動畫結束（按鈕才點得到）
        mapsReadTimeout: 7000,      // Google Maps 開啟後，最多等多久讀到座標文字
        mapReturnMaxWait: 5000,     // 切回遊戲後，最多等多久出現地圖畫面
        afterTapMonster: 3000,      // 點泡泡後等詳情頁（含進場動畫）
        waitMapsTimeout: 12000,     // 等 Google Maps 進前景的最長時間
        afterBack: 1500,
        afterLaunchGame: 3500,
        betweenActions: 700,
        clipboardWait: 900
    },

    // ---------------- 重試 ----------------
    retry: {
        perCell: 2,                 // 單格整體失敗重試次數
        perAction: 3,               // 單一動作（截圖/點擊等）重試次數
        // 連續幾格都失敗就自動停止（多半是遊戲重開、地圖跳回玩家位置，繼續跑只是浪費時間）
        maxConsecutiveFailedCells: 3
    },

    // ---------------- 去重 ----------------
    // 「上次看到」在 windowMinutes 分鐘內、距離小於 distanceMeters 公尺 → 視為同一顆，更新人數
    // 超過時間窗才出現 → 當成新的一顆（新的一行）
    // windowMinutes = 0 表示不限時間（同一點永遠只記一次）
    dedupe: {
        distanceMeters: 15,
        windowMinutes: 120
    },

    debug: {
        showConsole: true,          // 顯示懸浮 console
        // console 視窗位置 [x,y,w,h]：放在左上角，不擋地圖比對範圍和底部按鈕
        // （截圖會拍到 console，點擊也會被它擋住，所以要放在 match.region 以外）
        consoleRect: [0, 60, 860, 280],
        // 懸浮「停止」按鈕位置 [x,y,w,h]（放右上角狀態列附近，不擋地圖比對範圍）；不要就設 null
        stopButton: [870, 40, 190, 110],
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
var POPUP_IMG = null;
var GEO_REF = null;               // 推算用基準點 {lat, lng, px, py, swipes}：(px,py) 是該經緯度目前在螢幕上的位置
var RECORDS = [];                 // found.csv 全部紀錄 [{t(上次看到 ms), lat, lng, row[欄位]}]

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

/** 每隔 interval 呼叫 fn，直到回傳 truthy 值或逾時；回傳該值或 null */
function waitUntil(fn, timeoutMs, interval) {
    var end = Date.now() + timeoutMs;
    interval = interval || CONFIG.timing.pollInterval;
    while (true) {
        var v = fn();
        if (v) return v;
        if (Date.now() >= end) return null;
        nap(interval);
    }
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
function parseCoords(raw, allowDms) {
    if (allowDms === undefined) allowDms = true;
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

    if (!allowDms) return null;
    // 度分秒（精度只到 0.1 秒 ≈ 3 公尺，所以排在小數格式之後）
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
        w = floaty.rawWindow("<frame/>");   // 用字串，Autox.js v7 不支援 XML 字面語法
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
    var texts = [];
    for (var s = 0; s < sources.length; s++) {
        var col = sources[s];
        if (!col) continue;
        for (var i = 0; i < col.size(); i++) {
            var n = col.get(i);
            texts.push(((n.text() || "") + " " + (n.desc() || "")).trim());
        }
    }
    // 先找小數格式（22.5066710, 120.3865560，最精確），找不到才接受度分秒
    var passes = [false, true];
    for (var p = 0; p < passes.length; p++) {
        for (var k = 0; k < texts.length; k++) {
            var c = parseCoords(texts[k], passes[p]);
            if (c) { info("從畫面節點文字取得座標：" + texts[k]); return c; }
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

function runOcr(img, lang) {
    var cfg = CONFIG.ocr;
    lang = lang || cfg.language;
    var engine = cfg.engine;
    if (engine === "custom" || (engine === "auto" && typeof cfg.customOcr === "function")) {
        if (typeof cfg.customOcr === "function") return String(cfg.customOcr(img) || "");
    }
    if ((engine === "auto" || engine === "gmlkit") && typeof gmlkit !== "undefined" && gmlkit.ocr) {
        return ocrResultToText(gmlkit.ocr(img, lang));
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
function listTemplateFiles() {
    var list = (CONFIG.match.templates || []).slice();
    var dir = CONFIG.match.templateDir;
    if (dir) {
        files.ensureDir(dir + "x");
        files.listDir(dir, function (name) { return /\.(png|jpe?g)$/i.test(name); })
            .forEach(function (name) { list.push(files.join(dir, name)); });
    }
    if (!list.length) throw new Error("沒有任何目標樣板圖，請放到 " + dir);
    return list;
}

function loadTemplates() {
    listTemplateFiles().forEach(function (p) {
        if (!files.exists(p)) throw new Error("樣板圖不存在：" + p);
        var img = images.read(p);
        if (!img) throw new Error("樣板圖讀取失敗：" + p);
        TEMPLATES.push({ path: p, img: img });
        info("載入樣板 " + p + "（" + img.getWidth() + "x" + img.getHeight() + "）");
    });
    if (CONFIG.popup.enabled && CONFIG.popup.template) {
        if (files.exists(CONFIG.popup.template)) {
            POPUP_IMG = images.read(CONFIG.popup.template);
            info("載入泡泡樣板 " + CONFIG.popup.template);
        } else {
            warn("找不到泡泡樣板 " + CONFIG.popup.template + "，將改用固定偏移點擊");
        }
    }
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

function isOnMap(img) {
    if (!ANCHOR_IMG) return null; // 未設定，無法判斷
    img = img || grab();
    var opt = { threshold: CONFIG.mapAnchor.threshold };
    var reg = scaleRegion(CONFIG.mapAnchor.region);
    if (reg) opt.region = reg;
    return !!images.findImage(img, ANCHOR_IMG, opt);
}

/** 切回遊戲並等它進前景 */
function bringGameToFront() {
    info("目前前景：" + currentPackage() + "，切回遊戲");
    app.launch(CONFIG.gamePackage);
    if (!waitForPackage([CONFIG.gamePackage], 15000)) throw new Error("無法切回遊戲");
}

/** 確保回到遊戲地圖畫面（偵測到地圖就立刻繼續，不等滿） */
function ensureOnMap() {
    var launched = false;
    if (currentPackage() !== CONFIG.gamePackage) { bringGameToFront(); launched = true; }
    if (!ANCHOR_IMG) { if (launched) nap(CONFIG.timing.afterLaunchGame); return true; }

    // 剛切回來畫面可能還在轉場，先等一下看會不會自己出現地圖
    if (waitUntil(function () { return isOnMap(); }, CONFIG.timing.mapReturnMaxWait / 2)) {
        info("已確認回到地圖畫面");
        return true;
    }
    for (var i = 0; i < CONFIG.mapAnchor.maxBackPresses; i++) {
        info("尚未回到地圖，按返回（" + (i + 1) + "）");
        var bb = CONFIG.taps.backButton;
        if (bb.useSystemBack) back(); else tap(bb.x, bb.y, "返回鈕");
        if (currentPackage() !== CONFIG.gamePackage) bringGameToFront();   // 按過頭跳出遊戲
        if (waitUntil(function () { return isOnMap(); }, CONFIG.timing.mapReturnMaxWait / 2)) {
            info("已確認回到地圖畫面");
            return true;
        }
    }
    throw new Error("多次返回仍找不到地圖 anchor");
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
    // 地圖跟著手指移動：基準點在螢幕上的位置也跟著位移
    if (GEO_REF) {
        GEO_REF.px += p2[0] - p1[0];
        GEO_REF.py += p2[1] - p1[1];
        GEO_REF.swipes++;
    }
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

// found.csv：每顆目標只有一行；再次掃到同一顆時更新 players 與 updated_at
var CSV_HEADER = "timestamp,lat,lng,screenshot_path,players,updated_at";

function csvEscape(s) {
    s = String(s == null ? "" : s);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

/** 解析一行 CSV（支援雙引號欄位） */
function csvSplit(line) {
    var out = [], cur = "", q = false;
    for (var i = 0; i < line.length; i++) {
        var ch = line.charAt(i);
        if (q) {
            if (ch === '"' && line.charAt(i + 1) === '"') { cur += '"'; i++; }
            else if (ch === '"') q = false;
            else cur += ch;
        } else if (ch === '"') q = true;
        else if (ch === ",") { out.push(cur); cur = ""; }
        else cur += ch;
    }
    out.push(cur);
    return out;
}

/** 把記憶體中的所有紀錄整份寫回 found.csv（先寫暫存檔再取代，避免中途被中斷而損毀） */
function rewriteCsv() {
    var p = CONFIG.paths.logCsv, tmp = p + ".tmp";
    var body = [CSV_HEADER].concat(RECORDS.map(function (r) {
        return r.row.map(csvEscape).join(",");
    })).join("\n") + "\n";
    files.write(tmp, body);
    var dst = new java.io.File(p);
    if (!new java.io.File(tmp).renameTo(dst)) {   // 少數機型 rename 不能覆蓋，改為直接寫
        files.write(p, body);
        files.remove(tmp);
    }
}

function loadExistingRecords() {
    var p = CONFIG.paths.logCsv;
    if (!files.exists(p)) {
        files.write(p, CSV_HEADER + "\n");
        return;
    }
    var content = String(files.read(p));
    var lines = content.split(/\r?\n/);
    var oldFormat = lines[0].trim() !== CSV_HEADER;
    for (var i = 1; i < lines.length; i++) {
        if (!lines[i].trim()) continue;
        var f = csvSplit(lines[i]);
        if (f.length < 3) continue;
        var lat = parseFloat(f[1]), lng = parseFloat(f[2]);
        if (!validLatLng(lat, lng)) continue;
        // 舊格式自動轉換：補上 players / updated_at 欄位
        var row = [f[0], f[1], f[2], f[3] || "", f[4] || "", f[5] || f[0]];
        var t = parseTime(row[5]);
        RECORDS.push({ t: isNaN(t) ? 0 : t, lat: lat, lng: lng, row: row });
    }
    if (oldFormat) {
        var bak = p.replace(/\.csv$/, "") + "_old_" + fmtFileTime() + ".csv";
        files.write(bak, content);
        rewriteCsv();
        info("found.csv 已轉成新格式（舊檔備份為 " + bak + "）");
    }
    info("已載入既有紀錄 " + RECORDS.length + " 筆");
}

/** 找出同一顆目標的既有紀錄（距離 radius 內，且上次看到的時間在 windowMinutes 內）；radius 預設 dedupe.distanceMeters */
function findDuplicate(c, nowMs, radius) {
    radius = radius || CONFIG.dedupe.distanceMeters;
    var win = CONFIG.dedupe.windowMinutes * 60000;
    var best = null, bestD = 1e9;
    for (var i = 0; i < RECORDS.length; i++) {
        var r = RECORDS[i];
        if (win > 0 && Math.abs(nowMs - r.t) > win) continue;
        var d = haversine(r, c);
        if (d <= radius && d < bestD) { best = r; bestD = d; }
    }
    return best;
}

/** 只更新既有紀錄的人數與最後看到時間（快速略過時使用） */
function touchRecord(rec, players) {
    var now = new Date();
    rec.t = now.getTime();
    var old = rec.row[4];
    if (players !== null && players !== undefined) rec.row[4] = String(players);
    rec.row[5] = fmtTime(now);
    rewriteCsv();
    return old;
}

/**
 * 寫入 found.csv。
 * 新目標 → 新增一行；已記錄過的同一顆 → 更新該行的人數與 updated_at。
 */
function recordCoords(c, shotPath, players) {
    var now = new Date(), nowStr = fmtTime(now);
    var pl = (players === null || players === undefined) ? "" : String(players);
    var dup = findDuplicate(c, now.getTime());
    if (dup) {
        dup.t = now.getTime();               // 以「最後看到的時間」計算去重時間窗
        var old = dup.row[4];
        if (pl !== "") dup.row[4] = pl;      // 這次讀不到人數就保留舊值
        dup.row[5] = nowStr;
        rewriteCsv();
        info("已記錄過 " + dup.row[1] + "," + dup.row[2] + "，更新人數 " +
            (old === "" ? "?" : old) + " → " + (dup.row[4] === "" ? "?" : dup.row[4]));
        return false;
    }
    var row = [nowStr, c.lat.toFixed(6), c.lng.toFixed(6), shotPath || "", pl, nowStr];
    files.append(CONFIG.paths.logCsv, row.map(csvEscape).join(",") + "\n");
    RECORDS.push({ t: now.getTime(), lat: c.lat, lng: c.lng, row: row });
    info("★ 已記錄：" + row.join(","));
    return true;
}

function recordUnresolved(shotPath, note, players) {
    var p = CONFIG.paths.unresolvedCsv;
    if (!files.exists(p)) files.write(p, "timestamp,screenshot_path,note\n");
    var pl = (players === null || players === undefined) ? "" : "players=" + players + " ";
    files.append(p, [fmtTime(), csvEscape(shotPath), csvEscape(pl + note)].join(",") + "\n");
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

/** nextIndex = 下一格要掃的編號；mapAt = 地圖目前停在第幾格 */
function saveProgress(nextIndex, mapAt) {
    try {
        files.write(CONFIG.paths.progressFile, JSON.stringify({
            nextIndex: nextIndex, mapAt: mapAt, cols: CONFIG.grid.cols, rows: CONFIG.grid.rows, updated: fmtTime()
        }));
    } catch (e) { logError("saveProgress", e); }
}

// ============================================================================
// =                    加速：位置推算 / 空地判斷                              =
// ============================================================================
/** 每個「實際螢幕像素」代表幾公尺 */
function metersPerRealPx() {
    var g = CONFIG.grid;
    return {
        x: g.metersPerPixelX * CONFIG.screen.designWidth / REAL_W,
        y: g.metersPerPixelY * CONFIG.screen.designHeight / REAL_H
    };
}

/** 依基準點推算螢幕上 (px,py) 的經緯度；沒有可信的基準點回傳 null */
function estimateGeo(px, py) {
    if (!GEO_REF || GEO_REF.swipes > CONFIG.fastSkip.maxSwipesSinceCalib) return null;
    var m = metersPerRealPx();
    var east = (px - GEO_REF.px) * m.x;
    var north = -(py - GEO_REF.py) * m.y;      // 螢幕往下 = 往南
    return {
        lat: GEO_REF.lat + north / 111320,
        lng: GEO_REF.lng + east / (111320 * Math.cos(GEO_REF.lat * Math.PI / 180))
    };
}

/** 用一個「精確經緯度 + 它目前在螢幕上的位置」校正基準點 */
function calibrate(coords, px, py) {
    var est = estimateGeo(px, py);
    if (est) info("位置推算誤差 " + Math.round(haversine(est, coords)) + " m（距上次校正 " + GEO_REF.swipes + " 次滑動）");
    GEO_REF = { lat: coords.lat, lng: coords.lng, px: px, py: py, swipes: 0 };
}

/** 畫面比對範圍內的「道路（亮色像素）」比例，用來判斷空地；失敗回傳 1（當作非空地） */
function roadRatio(img) {
    var r = scaleRegion(CONFIG.match.region);
    var sub = null, gray = null, bin = null;
    try {
        sub = images.clip(img, r[0], r[1], r[2], r[3]);
        gray = images.grayscale(sub);
        bin = images.threshold(gray, CONFIG.emptySkip.brightThreshold, 255, "BINARY");
        var n = org.opencv.core.Core.countNonZero(bin.getMat());
        return n / (r[2] * r[3]);
    } catch (e) {
        logError("roadRatio", e);
        return 1;
    } finally {
        [sub, gray, bin].forEach(function (im) { if (im) { try { im.recycle(); } catch (e) { } } });
    }
}

/**
 * 滑動後等地圖載入。空地（道路很少）回傳 true，呼叫端可直接跳過這格。
 * 非空地則等滿 swipe.waitAfter 讓目標刷出。
 */
function waitAfterSwipe() {
    var es = CONFIG.emptySkip, t0 = Date.now();
    if (!es.enabled) { nap(CONFIG.swipe.waitAfter); return false; }
    var maxRatio = 0;
    var hasRoad = waitUntil(function () {
        var ratio = roadRatio(grab());
        maxRatio = Math.max(maxRatio, ratio);
        return ratio >= es.minRoadRatio;
    }, es.confirmMs, 400);
    if (!hasRoad) {
        info("空地（道路比例 " + (maxRatio * 100).toFixed(2) + "%），略過");
        return true;
    }
    var left = CONFIG.swipe.waitAfter - (Date.now() - t0);
    if (left > 0) nap(left);
    return false;
}

/** 把 OCR 常見誤認的字母轉回數字，取第一組數字 */
function digitsFromOcr(txt) {
    var t = String(txt || "")
        .replace(/[Oo]/g, "0").replace(/[lI|i!]/g, "1").replace(/[B]/g, "8")
        .replace(/[Ss]/g, "5").replace(/[Zz]/g, "2").replace(/[q]/g, "9");
    var m = /\d{1,3}/.exec(t);
    return m ? parseInt(m[0], 10) : null;
}

/**
 * 讀取目標旁人頭圖案的參加人數。img 必須是「點擊前」的地圖截圖。
 * 讀不到回傳 null（例如還沒人參加時沒有人頭標籤）
 */
function readPlayerCount(img, hit) {
    var pc = CONFIG.players;
    if (!pc || !pc.enabled) return null;
    var x = Math.round(hit.x + sx(pc.region[0])), y = Math.round(hit.y + sy(pc.region[1]));
    var w = sx(pc.region[2]), h = sy(pc.region[3]);
    // 人數標籤若落在 console 視窗底下，讀到的會是 log 文字，直接放棄
    if (CONFIG.debug.showConsole && y < sy(CONFIG.match.region[1]) - 10) return null;
    x = Math.max(0, x); y = Math.max(0, y);
    w = Math.min(w, REAL_W - x); h = Math.min(h, REAL_H - y);
    if (w <= 4 || h <= 4) return null;

    var sub = null, big = null, bin = null;
    try {
        sub = images.clip(img, x, y, w, h);
        big = images.scale(sub, pc.scale, pc.scale);
        var n = digitsFromOcr(runOcr(big, pc.language));
        if (n === null) {
            // 第二次：只留白色像素（數字是白色）再辨識
            try {
                bin = images.inRange(big, "#c0c0c0", "#ffffff");
                n = digitsFromOcr(runOcr(bin, pc.language));
            } catch (e) { }
        }
        return n;
    } catch (e) {
        logError("readPlayerCount", e);
        return null;
    } finally {
        [sub, big, bin].forEach(function (im) { if (im) { try { im.recycle(); } catch (e) { } } });
    }
}

/** 在目前畫面找離 (x,y) 最近的目標，找不到回傳 null */
function findNearestTarget(img, x, y) {
    var hits = findTargets(img);
    var best = null, bd = 1e9;
    hits.forEach(function (h) {
        var d = Math.abs(h.x - x) + Math.abs(h.y - y);
        if (d < bd) { bd = d; best = h; }
    });
    return best;
}

/**
 * 點目標 → 等泡泡 → 點泡泡 → 進詳情頁（每一步偵測到就繼續，不等滿）。
 * 成功回傳 true；若一直停在地圖上回傳 false。
 */
function enterDetail(hit, label) {
    var pc = CONFIG.popup, tm = CONFIG.timing;
    var ox = sx(CONFIG.match.clickOffset.x), oy = sy(CONFIG.match.clickOffset.y);
    var tx = Math.round(hit.x + ox), ty = Math.round(hit.y + oy);

    for (var attempt = 0; attempt <= (pc.enabled ? pc.retries : 0); attempt++) {
        info(label + " 點擊目標 (" + tx + "," + ty + ") 相似度 " + hit.sim.toFixed(3));
        click(tx, ty);

        if (pc.enabled) {
            var last = null;
            var p = POPUP_IMG ? waitUntil(function () {
                last = grab();
                return images.findImage(last, POPUP_IMG, { threshold: pc.threshold });
            }, pc.waitAfterTapTarget) : null;
            var bx, by;
            if (p) {
                bx = p.x + POPUP_IMG.getWidth() / 2;
                by = p.y + POPUP_IMG.getHeight() / 2;
                info("找到名稱泡泡，點擊 (" + Math.round(bx) + "," + Math.round(by) + ")");
            } else {
                // 地圖可能被移動過，重新找目標位置再用固定偏移
                var again = findNearestTarget(last || grab(), hit.x, hit.y) || hit;
                bx = again.x + sx(pc.fallbackOffset.x);
                by = again.y + sy(pc.fallbackOffset.y);
                warn("沒找到泡泡，改點目標上方 (" + Math.round(bx) + "," + Math.round(by) + ")");
                tx = Math.round(again.x + ox); ty = Math.round(again.y + oy);
            }
            click(Math.round(bx), Math.round(by));
        }

        // 等到離開地圖畫面（= 進入詳情頁）
        if (!ANCHOR_IMG) { nap(tm.afterTapMonster); return true; }
        var left = waitUntil(function () { return isOnMap() === false; }, tm.detailMaxWait);
        if (left) { nap(tm.detailSettle); return true; }
        if (!pc.enabled) return false;
        warn("仍在地圖畫面，重試進入詳情頁（" + (attempt + 1) + "）");
    }
    return false;
}

// ============================================================================
// =                     核心：處理一隻目標怪                                  =
// ============================================================================
/**
 * 點怪 → 詳情 → (A)複製/節點文字 → 開 Google Map → (A)節點/分享 → (B)OCR → 記錄 → 回地圖
 * @return 取得的座標 {lat,lng}，失敗回傳 null
 */
function handleTarget(hit, cellShotPath, label, players) {
    var coords = null, ocrNotes = [];
    var detailImg = null;

    try {
        // ---- 1. 點擊目標 → 點名稱泡泡 → 進詳情頁 ----
        if (!enterDetail(hit, label)) throw new Error("無法進入詳情頁");

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

        // ---- 4. 依序點按鈕開啟 Google Maps（前往這裡 → 在地圖應用程式開啟） ----
        if (!coords) {
            CONFIG.taps.openMapSteps.forEach(function (st) {
                if (!tapByTexts(st.texts, CONFIG.taps.textSearchTimeout)) tap(st.x, st.y, st.name);
                nap(st.wait || CONFIG.timing.betweenActions);
            });

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
                // ---- 5. 方法 A2：Google Maps 畫面文字（以座標開啟時搜尋列就是 lat,lng）----
                // 座標文字一出現就讀，不用等地圖整個載入
                coords = waitUntil(coordsFromScreenNodes, CONFIG.timing.mapsReadTimeout, 400);
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
            recordCoords(coords, cellShotPath, players);
        } else {
            recordUnresolved(cellShotPath, ocrNotes.join(" || ").replace(/\s+/g, " ").substr(0, 500), players);
        }
        return coords;
    } finally {
        if (detailImg) { try { detailImg.recycle(); } catch (e) { } }
        // ---- 10. 回到遊戲地圖 ----
        returnToGameMap();
    }
}

function returnToGameMap() {
    try {
        var leftGame = currentPackage() !== CONFIG.gamePackage;
        if (leftGame) {   // 從 Google Maps 回來：直接啟動遊戲（比狂按返回可靠）
            bringGameToFront();
            if (!ANCHOR_IMG) nap(CONFIG.timing.afterLaunchGame);
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
    var clicks = 0, quick = 0;
    var near = sx(CONFIG.match.sameTargetRadius);
    var isHandled = function (h) {
        return handled.some(function (p) { return Math.abs(p.x - h.x) < near && Math.abs(p.y - h.y) < near; });
    };

    for (var round = 0; ; round++) {
        var img = grab();
        var hits = findTargets(img).filter(function (h) { return !isHandled(h); });
        if (round === 0) info("格 " + (index + 1) + "/" + total + " [" + label + "] 比對到 " + hits.length + " 個目標");
        if (!hits.length) break;

        // ---- 先把「推算為已記錄」的目標快速處理掉（不點擊、地圖不會動）----
        var unknown = null;
        for (var k = 0; k < hits.length; k++) {
            var h = hits[k];
            var est = CONFIG.fastSkip.enabled ? estimateGeo(h.x, h.y) : null;
            var rec = est ? findDuplicate(est, Date.now(), CONFIG.fastSkip.radiusMeters) : null;
            if (rec) {
                var pl = readPlayerCount(img, h);
                var old = touchRecord(rec, pl);
                info("快速略過：推定為已記錄的 " + rec.row[1] + "," + rec.row[2] +
                    "（距推算 " + Math.round(haversine(rec, est)) + " m），人數 " +
                    (old === "" ? "?" : old) + " → " + (pl === null ? "讀不到" : pl));
                handled.push(h);
                quick++;
            } else if (!unknown) {
                unknown = h;
            }
        }
        if (!unknown || clicks >= CONFIG.match.maxTargetsPerCell) break;

        // ---- 新目標：點進去拿精確座標 ----
        var hit = unknown;
        handled.push(hit);
        var shotPath = saveShot(img, "target_" + fmtFileTime() + "_" + label + "_" + clicks);
        var players = readPlayerCount(img, hit);   // 點擊前先讀人數（點下去後地圖會移動）
        info("參加人數：" + (players === null ? "讀不到" : players));
        var coords = null;
        try {
            withRetry("處理目標 " + label + "#" + clicks, 2, function (attempt) {
                if (attempt > 1) ensureOnMap();
                coords = handleTarget(hit, shotPath, label + "#" + clicks, players);
            });
        } catch (e) {
            if (String(e).indexOf("STOP_REQUESTED") >= 0) throw e;
            logError("處理目標 " + label + "#" + clicks, e);
            ensureOnMap();
        }
        clicks++;

        // 遊戲回來後若會自動置中，重播到目前這格
        if (CONFIG.grid.recenterOnReturn) {
            fastForwardTo(index);
            nap(CONFIG.swipe.waitAfter);
        }

        // ---- 校正推算基準：點擊後地圖會稍微移動，重新找到這顆在畫面上的新位置 ----
        if (coords) {
            var after = findNearestTarget(grab(), hit.x, hit.y);
            if (after && Math.abs(after.x - hit.x) + Math.abs(after.y - hit.y) < sx(250)) {
                calibrate(coords, after.x, after.y);
                // 已處理清單改用新位置，避免地圖移動後同一顆被當成新的
                handled[handled.length - 1] = after;
            }
        }
    }
    return clicks + quick;
}

// ============================================================================
// =                              主流程                                       =
// ============================================================================
function setup() {
    if (CONFIG.debug.showConsole) {
        try {
            console.show();
            sleep(300);
            var cr = CONFIG.debug.consoleRect;
            var dm = context.getResources().getDisplayMetrics();
            var fx = dm.widthPixels / CONFIG.screen.designWidth, fy = dm.heightPixels / CONFIG.screen.designHeight;
            console.setSize(Math.round(cr[2] * fx), Math.round(cr[3] * fy));
            console.setPosition(Math.round(cr[0] * fx), Math.round(cr[1] * fy));
        } catch (e) { }
    }

    auto.waitFor();   // 等無障礙服務
    showStopButton();
    // 長時間掃描：保持螢幕常亮（腳本結束後自動恢復）
    try { device.keepScreenOn(24 * 3600 * 1000); } catch (e) { warn("無法保持螢幕常亮：" + e); }
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

/** 右上角懸浮「停止」按鈕：按下後在安全點停止並保存進度 */
var STOP_BTN = null;
function showStopButton() {
    var b = CONFIG.debug.stopButton;
    if (!b) return;
    try {
        STOP_BTN = floaty.rawWindow(
            '<frame><button id="stop" text="停止" textSize="14sp" bg="#cc3333" textColor="#ffffff" w="*" h="*"/></frame>');
        var dm = context.getResources().getDisplayMetrics();
        var fx = dm.widthPixels / CONFIG.screen.designWidth, fy = dm.heightPixels / CONFIG.screen.designHeight;
        STOP_BTN.setSize(Math.round(b[2] * fx), Math.round(b[3] * fy));
        STOP_BTN.setPosition(Math.round(b[0] * fx), Math.round(b[1] * fy));
        STOP_BTN.stop.click(function () {
            STOP.set(true);
            toast("收到停止，處理完目前步驟就停（進度會保存）");
            ui.run(function () { STOP_BTN.stop.setText("停止中…"); });
        });
    } catch (e) {
        warn("無法顯示停止按鈕：" + e + "（請用 Autox.js 管理頁停止）");
    }
}

/**
 * 決定從哪一格開始、地圖目前停在哪一格。
 * 回傳 {start, mapAt}；mapAt = start - 1 表示迴圈第一步要先滑一次
 */
function decideStart(total) {
    var fresh = { start: 0, mapAt: 0 };
    if (!CONFIG.grid.resume) return fresh;
    var prog = loadProgress();
    if (!prog || !(prog.nextIndex > 0) || prog.nextIndex >= total) return fresh;

    var mapAt = (prog.mapAt === undefined) ? prog.nextIndex - 1 : prog.mapAt;
    var choice = dialogs.select(
        "上次掃到第 " + prog.nextIndex + "/" + total + " 格（" + prog.updated + "），要怎麼做？",
        [
            "接續：地圖還停在上次的位置（停止後沒動過地圖）",
            "接續：地圖已回到當初的起點，自動快轉過去",
            "從頭開始（新區域）"
        ]);
    if (choice === 0) {
        info("接續：從第 " + (prog.nextIndex + 1) + " 格開始，地圖停在第 " + (mapAt + 1) + " 格");
        return { start: prog.nextIndex, mapAt: mapAt };
    }
    if (choice === 1) {
        info("接續：從起點快轉到第 " + prog.nextIndex + " 格");
        return { start: prog.nextIndex, mapAt: -1 };   // -1 = 需要快轉
    }
    files.remove(CONFIG.paths.progressFile);
    info("從頭開始：以目前地圖畫面為左上角（第 1 格）");
    return fresh;
}

function mainLoop() {
    setup();

    var g = CONFIG.grid;
    var sk = g.sizeKm;
    if (typeof sk === "number") sk = { east: sk, south: sk };   // sizeKm: 10 → 10x10 km
    if (sk) {
        if (!(sk.east > 0 && sk.south > 0)) throw new Error("grid.sizeKm 格式錯誤，請填數字（如 10）或 { east: 10, south: 10 }");
        g.cols = Math.max(1, Math.ceil(sk.east * 1000 / (CONFIG.swipe.distanceX * g.metersPerPixelX)) + 1);
        g.rows = Math.max(1, Math.ceil(sk.south * 1000 / (CONFIG.swipe.distanceY * g.metersPerPixelY)) + 1);
        info("範圍 " + sk.east + "km(東) x " + sk.south + "km(南) → " + g.cols + " x " + g.rows + " 格");
    }
    if (!(g.cols > 0 && g.rows > 0)) throw new Error("請設定 grid.sizeKm，或 grid.cols / grid.rows（正整數）");
    var total = g.cols * g.rows;
    var plan = decideStart(total);
    var start = plan.start;

    // 確認在遊戲地圖畫面。注意：腳本「不會」自己移動到起點，
    // 會以你開始時看到的畫面當作網格左上角（第 1 格）
    app.launch(CONFIG.gamePackage);
    waitForPackage([CONFIG.gamePackage], 15000);
    nap(CONFIG.timing.afterLaunchGame);
    ensureOnMap();

    var mapAt = plan.mapAt;
    if (mapAt === -1) { fastForwardTo(start - 1); mapAt = start - 1; }
    info("網格 " + CONFIG.grid.cols + "x" + CONFIG.grid.rows + "，共 " + total + " 格，從第 " + (start + 1) + " 格開始");

    var found = 0, failStreak = 0;
    for (var i = start; i < total; i++) {
        if (STOP.get()) break;
        var cell = cellOf(i);
        var ok = false;
        try {
            if (mapAt < i) {
                var dir = moveBefore(i);
                info("→ 滑動 " + dir + "，前往格 " + (i + 1) + "/" + total + " [r" + cell.row + "c" + cell.col + "]");
                withRetry("滑動", CONFIG.retry.perAction, function () { panView(dir); });
                mapAt = i;
            }
            if (waitAfterSwipe()) ok = true;          // 空地：直接跳下一格
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
            if (String(e).indexOf("STOP_REQUESTED") >= 0) { saveProgress(i, mapAt); throw e; }
            logError("格 " + (i + 1), e);   // 單格失敗不中斷整體
        }
        saveProgress(i + 1, mapAt);

        failStreak = ok ? 0 : failStreak + 1;
        if (failStreak >= CONFIG.retry.maxConsecutiveFailedCells) {
            var msg = "連續 " + failStreak + " 格失敗，自動停止（進度已保存在第 " + (i + 2) + " 格）";
            logError("mainLoop", msg);
            try { device.vibrate(1500); toast(msg); } catch (e) { }
            return;
        }
    }

    if (!STOP.get()) {
        files.remove(CONFIG.paths.progressFile);
        info("===== 掃描完成，本次處理目標 " + found + " 隻 =====");
        try { device.vibrate(800); } catch (e) { }
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
        try { device.cancelKeepingAwake(); } catch (e) { }
        try { if (STOP_BTN) STOP_BTN.close(); } catch (e) { }
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
