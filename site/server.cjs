"use strict";
// Dependency-free static file server for WebVM (32-bit Debian in the browser).
// Serves index.html + welcome.avif on 0.0.0.0 so the VM's Tailscale IP can reach it.
//
// CheerpX quirks this works around (see leaningtech/webvm#228):
//  - bind() can fail right after boot, before Tailscale networking is up
//    (EADDRINUSE on the first listen). WebVM restarts CMD on exit, so crashing
//    produces a crash loop — instead we wait, retry, and fall back to other
//    ports until one binds.
//  - os.networkInterfaces() hangs forever (netlink is not implemented), so we
//    must not touch it; the tailnet IP is read from the WebVM sidebar instead.
const http = require("http");
const fs = require("fs");
const path = require("path");

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

// List TCP listeners from /proc (state 0A = LISTEN) to see who holds a port.
// Note: CheerpX does not implement /proc/net/tcp (ENOENT), kept for real Linux.
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
}

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
		console.log("welcome.avif site serving on port " + port);
		console.log("");
		console.log("To view it:");
		console.log("  1. In the WebVM sidebar, open Networking and click 'Connect to Tailscale'.");
		console.log("  2. Make sure the device you browse from is on the same tailnet.");
		console.log("  3. The Networking button then shows 'IP: 100.x.x.x' - open");
		console.log("     http://<that-IP>:" + port + "/ in your browser.");
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
