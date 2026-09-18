"use strict";
// Dependency-free static file server for WebVM (32-bit Debian in the browser).
// Serves index.html + welcome.avif on 0.0.0.0 so the VM's Tailscale IP can reach it.
const http = require("http");
const fs = require("fs");
const path = require("path");
const os = require("os");

var ROOT = __dirname;
var PORT = Number(process.env.PORT || 3000);
var HOST = "0.0.0.0";

var MIME = {
	".html": "text/html; charset=utf-8",
	".avif": "image/avif",
	".css": "text/css; charset=utf-8",
	".js": "text/javascript; charset=utf-8",
	".json": "application/json; charset=utf-8",
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".webp": "image/webp",
	".svg": "image/svg+xml",
	".ico": "image/x-icon",
	".txt": "text/plain; charset=utf-8",
	".woff2": "font/woff2"
};

var server = http.createServer(function (req, res) {
	var urlPath;
	try {
		urlPath = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
	} catch (err) {
		res.writeHead(400);
		res.end("Bad request");
		return;
	}
	if (urlPath.endsWith("/")) urlPath += "index.html";
	var filePath = path.normalize(path.join(ROOT, urlPath));
	if (filePath !== ROOT && filePath.indexOf(ROOT + path.sep) !== 0) {
		res.writeHead(403);
		res.end("Forbidden");
		return;
	}
	fs.stat(filePath, function (err, st) {
		if (err || !st.isFile()) {
			res.writeHead(404);
			res.end("Not found");
			return;
		}
		res.writeHead(200, {
			"Content-Type": MIME[path.extname(filePath).toLowerCase()] || "application/octet-stream",
			"Content-Length": st.size,
			"Cache-Control": "no-cache"
		});
		fs.createReadStream(filePath).pipe(res);
	});
});

// Tailscale addresses live in 100.64.0.0/10. WebVM gets one after
// "Connect to Tailscale" is clicked in the sidebar.
function tailscaleUrls() {
	var urls = [];
	var ifaces = os.networkInterfaces();
	Object.keys(ifaces).forEach(function (name) {
		(ifaces[name] || []).forEach(function (addr) {
			if (addr.family === "IPv4" && /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(addr.address)) {
				urls.push("http://" + addr.address + ":" + PORT + "/");
			}
		});
	});
	return urls;
}

var announced = false;
function announce() {
	var urls = tailscaleUrls();
	if (urls.length > 0 && !announced) {
		announced = true;
		console.log("\nTailscale is up. Open this on any machine in your tailnet:");
		urls.forEach(function (u) { console.log("  " + u); });
	}
	if (urls.length === 0) announced = false;
}

server.listen(PORT, HOST, function () {
	console.log("welcome.avif site serving on port " + PORT);
	console.log("");
	console.log("To view it:");
	console.log("  1. In the WebVM sidebar, open Networking and click 'Connect to Tailscale'.");
	console.log("  2. Make sure the device you browse from is on the same tailnet.");
	console.log("  3. Open the http://100.x.x.x:" + PORT + " URL printed here once connected.");
	announce();
});

var timer = setInterval(announce, 5000);
timer.unref();
