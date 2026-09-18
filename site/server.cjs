"use strict";
// Dependency-free static file server for WebVM (32-bit Debian in the browser).
// Serves index.html + welcome.avif on 0.0.0.0 so the VM's Tailscale IP can reach it.
//
// Binding can fail right after boot (e.g. EADDRINUSE before the Tailscale
// network interface is up — CheerpX's lwIP behaves oddly with no network, see
// leaningtech/webvm#228). Instead of crashing (WebVM restarts CMD on exit,
// producing a crash loop), we wait and retry, and fall back to other ports.
const http = require("http");
const fs = require("fs");
const path = require("path");
const os = require("os");

var ROOT = __dirname;
var HOST = "0.0.0.0";
var PORTS = [Number(process.env.PORT || 3000), 5000, 8000, 8080];
var RETRY_MS = 5000;

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

// ---- diagnostics -----------------------------------------------------------

// List TCP listeners from /proc (state 0A = LISTEN) to see who holds a port.
function dumpListeners() {
	["/proc/net/tcp", "/proc/net/tcp6"].forEach(function (f) {
		try {
			var lines = fs.readFileSync(f, "utf8").trim().split("\n").slice(1);
			lines.forEach(function (line) {
				var cols = line.trim().split(/\s+/);
				if (cols[3] !== "0A") return;
				var local = cols[1].split(":");
				var port = parseInt(local[1], 16);
				console.log("  listener: " + f + " port " + port + " (local " + local[0] + ")");
			});
		} catch (err) {
			console.log("  cannot read " + f + ": " + err.code);
		}
	});
	try {
		console.log("  networkInterfaces: " + JSON.stringify(os.networkInterfaces()));
	} catch (err) {
		console.log("  networkInterfaces() failed: " + err.message);
	}
}

// ---- tailscale address announcer -------------------------------------------

var boundPort = 0;
function tailscaleUrls() {
	var urls = [];
	var ifaces = os.networkInterfaces();
	Object.keys(ifaces).forEach(function (name) {
		(ifaces[name] || []).forEach(function (addr) {
			if (addr.family === "IPv4" && /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(addr.address)) {
				urls.push("http://" + addr.address + ":" + boundPort + "/");
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

// ---- resilient listen ------------------------------------------------------

var diagnosed = false;
function tryListen(index) {
	if (index >= PORTS.length) {
		console.log("retrying in " + RETRY_MS / 1000 + "s...");
		setTimeout(function () { tryListen(0); }, RETRY_MS);
		return;
	}
	var port = PORTS[index];
	var onError = function (err) {
		cleanup();
		console.log("listen :" + port + " failed: " + err.code);
		if (!diagnosed) {
			diagnosed = true;
			console.log("current TCP listeners:");
			dumpListeners();
		}
		tryListen(index + 1);
	};
	var onListening = function () {
		cleanup();
		boundPort = port;
		console.log("welcome.avif site serving on port " + port);
		console.log("");
		console.log("To view it:");
		console.log("  1. In the WebVM sidebar, open Networking and click 'Connect to Tailscale'.");
		console.log("  2. Make sure the device you browse from is on the same tailnet.");
		console.log("  3. Open the http://100.x.x.x:" + port + " URL printed here once connected.");
		announce();
	};
	var cleanup = function () {
		server.removeListener("error", onError);
		server.removeListener("listening", onListening);
	};
	server.once("error", onError);
	server.once("listening", onListening);
	server.listen(port, HOST);
}

tryListen(0);

var timer = setInterval(announce, 5000);
timer.unref();
