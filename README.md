# webm_welcome

`welcome.avif` served from a full Debian Linux VM running in your browser, via
[WebVM](https://github.com/leaningtech/webvm).

![welcome](site/welcome.avif)

## ▶ Run it

**[https://shoutmarble.github.io/webm_welcome/](https://shoutmarble.github.io/webm_welcome/)**

That link boots WebVM straight into a Node.js server running *inside* the
browser VM. To see the page it serves:

1. Wait for the VM to boot — the terminal prints `welcome.avif site serving on port 3000`.
2. In the WebVM sidebar, open **Networking** and click **Connect to Tailscale**
   (a free tailnet; the VM joins it as an ephemeral node).
3. Make sure the device you are browsing from is also on that tailnet
   (e.g. the Tailscale app on your machine).
4. The terminal prints `http://100.x.x.x:3000/` — open it in your browser.
   You can also copy the IP from the Networking button.

WebVM has no localhost port-forwarding into the VM; Tailscale is the
(supported) way to reach servers running inside it. You can optionally append
`#authKey=<ephemeral-tailscale-key>` to the URL to skip the interactive login.

## Why Node.js and not Bun?

CheerpX, WebVM's virtualization engine, emulates **32-bit x86 only**, and Bun
ships no 32-bit Linux builds — so Bun cannot run inside WebVM at all. The disk
image bundles the unofficial Node.js `linux-x86` build (v20.19.5) instead.
The server is dependency-free (`site/server.cjs`), serving `site/index.html`
and `site/welcome.avif` with the correct `image/avif` MIME type.

## How it works / deploying your own

This repo is the WebVM source plus:

- `dockerfiles/webm_welcome` — i386 Debian image with Node + the site baked in;
  its `CMD` boots the VM directly into the server.
- `site/` — `index.html`, `welcome.avif`, `server.cjs`.
- `.github/workflows/deploy.yml` — upstream WebVM workflow (defaults pointed at
  the above Dockerfile) that builds the ext2 disk image, builds the WebVM app,
  and deploys it to GitHub Pages.

To activate deployment for this repo (one time):

1. **Settings → Pages → Source: "GitHub Actions"**.
2. **Actions → Deploy → Run workflow** (defaults are already correct).
3. When it finishes, the site URL appears in the `deploy_to_github_pages` job —
   that is the deep link above.

## Credits & license

Built on [WebVM](https://github.com/leaningtech/webvm) by Leaning Technologies
(Apache License 2.0, see `LICENSE.txt`; upstream readme kept as
`README.webvm.md`). The CheerpX engine is loaded from LeaningTech's hosted
build, free for individual use — see the upstream readme for licensing details.
