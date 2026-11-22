/**
 * install.js — 一鍵下載/更新 map_scan.js 與樣板圖（Autox.js）
 *
 * 用法：在 Autox.js 新增一個 Js 文件，貼上這段，執行即可。
 * 之後腳本有更新，再執行一次這支就會覆蓋成最新版。
 * 注意：會覆蓋手機上的 map_scan.js，如果你在手機上改過 CONFIG，請先記下來。
 */
var BASE = "https://raw.githubusercontent.com/ZDYoyoyo/MapSlideTool/ccr-5cbad84b-dt0jwx/";

// [GitHub 上的路徑, 手機上的存放位置]
var FILES = [
    ["map_scan.js", "/sdcard/脚本/map_scan.js"],
    ["templates/map_anchor.png", "/sdcard/MapScan/templates/map_anchor.png"],
    ["templates/targets/glowing_mushroom.png", "/sdcard/MapScan/templates/targets/glowing_mushroom.png"]
];

console.show();
var ok = 0;
FILES.forEach(function (f) {
    try {
        var res = http.get(BASE + encodeURI(f[0]));
        if (res.statusCode !== 200) throw new Error("HTTP " + res.statusCode);
        var bytes = res.body.bytes();
        files.ensureDir(f[1]);
        files.writeBytes(f[1], bytes);
        log("✔ " + f[1] + "（" + bytes.length + " bytes）");
        ok++;
    } catch (e) {
        console.error("✘ " + f[0] + " 下載失敗：" + e);
    }
});
log(ok === FILES.length ? "全部完成！回 Autox.js 主頁下拉重新整理即可看到 map_scan" : "有檔案失敗，請截圖給我");
