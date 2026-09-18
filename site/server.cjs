"use strict";
// Dependency-free static file server for WebVM (32-bit Debian in the browser).
// Serves index.html + welcome.avif on 0.0.0.0 so the VM's Tailscale IP can reach it.
//
// CheerpX quirks this works around (see leaningtech/webvm#228):
//  - bind() misbehaves before Tailscale networking is up (EADDRINUSE), and
//    WebVM restarts CMD on exit, so crashing = crash loop. We retry instead.
//  - Re-listening on the same http.Server after a failed bind hangs forever,
//    so each attempt uses a FRESH server object, with a timeout in case a
//    bind hangs without emitting 'error' or 'listening'.
//  - os.networkInterfaces() also hangs (no netlink), so don't add it back;
//    the tailnet IP is read from the WebVM sidebar's Networking button.
const http = require("http");
const fs = require("fs");
const path = require("path");

var ROOT = __dirname;
var HOST = "0.0.0.0";
var PORTS = [Number(process.env.PORT || 3000), 5000, 8000, 8080];
var RETRY_MS = 5000;
var LISTEN_TIMEOUT_MS = 8000;

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

function handleRequest(req, res) {
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
}

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
function diagnose(err) {
	console.log("listen failed: " + err.code);
	if (!diagnosed) {
		diagnosed = true;
		console.log("current TCP listeners:");
		dumpListeners();
	}
}

function banner(port) {
	console.log("welcome.avif site serving on port " + port);
	console.log("");
	console.log("To view it:");
	console.log("  1. In the WebVM sidebar, open Networking and click 'Connect to Tailscale'.");
	console.log("  2. Make sure the device you browse from is on the same tailnet.");
	console.log("  3. The Networking button then shows 'IP: 100.x.x.x' - open");
	console.log("     http://<that-IP>:" + port + "/ in your browser.");
}

// Probe each port with a fresh server. Ports that hang are skipped for the
// rest of the round-robin; EADDRINUSE ports stay in rotation (they may free
// up once networking changes state).
var hung = {};
var hangStrikes = 0;
function tryListen(round) {
	var candidates = PORTS.filter(function (p) { return !hung[p]; });
	if (candidates.length === 0) {
		hung = {};
		hangStrikes++;
		console.log("all ports hung; resetting probe (strike " + hangStrikes + ")");
		setTimeout(function () { tryListen(round + 1); }, 30000);
		return;
	}
	var port = candidates[round % candidates.length];
	var srv = http.createServer(handleRequest);
	var settled = false;
	var timer = setTimeout(function () {
		if (settled) return;
		settled = true;
		hung[port] = true;
		console.log("listen :" + port + " timed out (bind hang), skipping it");
		try { srv.close(); } catch (e) {}
		tryListen(round + 1);
	}, LISTEN_TIMEOUT_MS);
	srv.once("error", function (err) {
		if (settled) return;
		settled = true;
		clearTimeout(timer);
		console.log("listen :" + port + " failed: " + err.code);
		if (!diagnosed) {
			diagnosed = true;
			console.log("current TCP listeners:");
			dumpListeners();
		}
		setTimeout(function () { tryListen(round + 1); }, RETRY_MS);
	});
	srv.once("listening", function () {
		if (settled) return;
		settled = true;
		clearTimeout(timer);
		banner(port);
	});
	srv.listen(port, HOST);
}

tryListen(0);
