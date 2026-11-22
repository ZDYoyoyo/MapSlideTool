/**
 * install.js — 一鍵下載/更新 map_scan.js 與樣板圖（Autox.js）
 * 下載清單放在 GitHub 的 manifest.json，之後新增檔案不用改這支。
 * 注意：會覆蓋手機上的 map_scan.js，在手機上改過的 CONFIG 請先記下來。
 */
var BASE = "https://raw.githubusercontent.com/ZDYoyoyo/MapSlideTool/ccr-5cbad84b-dt0jwx/";
console.show();
function get(path) {
    var res = http.get(BASE + encodeURI(path) + "?t=" + Date.now());
    if (res.statusCode !== 200) throw new Error(path + " HTTP " + res.statusCode);
    return res.body;
}
var list = JSON.parse(get("manifest.json").string()).files;
var ok = 0;
list.forEach(function (f) {
    try {
        var bytes = get(f[0]).bytes();
        files.ensureDir(f[1]);
        files.writeBytes(f[1], bytes);
        log("✔ " + f[1] + "（" + bytes.length + " bytes）");
        ok++;
    } catch (e) {
        console.error("✘ " + f[0] + " 下載失敗：" + e);
    }
});
log(ok === list.length ? "全部完成！" : "有檔案失敗，請截圖給我");
