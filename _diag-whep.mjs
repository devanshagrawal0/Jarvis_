import { chromium } from "playwright";
// Diagnose the takeover video: start the stream, connect WHEP, and dump the RAW inbound-rtp +
// candidate-pair + codec stats so we know which layer fails (no RTP = transport/firewall; RTP but
// framesDecoded 0 = codec). Runs against the tailnet build; the browser here is on the PC itself.
const base = "https://nucbox-k8-plus.tail6f924a.ts.net";
const b = await chromium.launch({ channel: "msedge", headless: true, args: ["--headless=new", "--use-angle=d3d11", "--use-gl=angle", "--enable-gpu", "--ignore-gpu-blocklist", "--autoplay-policy=no-user-gesture-required"] });
const ctx = await b.newContext({ ignoreHTTPSErrors: true });
const page = await ctx.newPage();
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
await page.goto(`${base}/app.html`, { waitUntil: "domcontentloaded" });

const result = await page.evaluate(async () => {
  const out = { steps: [] };
  const start = await (await fetch("/api/device-mesh/stream/start", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })).json();
  out.start = { ok: start.ok, err: start.stream?.error?.slice(0, 120) };
  await new Promise((r) => setTimeout(r, 1500));
  const pc = new RTCPeerConnection({ iceServers: [], bundlePolicy: "max-bundle" });
  pc.addTransceiver("video", { direction: "recvonly" });
  const video = document.createElement("video"); video.autoplay = true; video.muted = true; video.playsInline = true; document.body.appendChild(video);
  pc.ontrack = (e) => { video.srcObject = e.streams[0]; out.steps.push("ontrack " + e.track.kind); video.play().catch(() => {}); };
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  await new Promise((done) => { if (pc.iceGatheringState === "complete") return done(); const t = setTimeout(done, 1500); pc.onicegatheringstatechange = () => { if (pc.iceGatheringState === "complete") { clearTimeout(t); done(); } }; });
  out.offerHasH264 = /H264/i.test(pc.localDescription.sdp);
  const res = await fetch("/api/device-mesh/stream/whep", { method: "POST", headers: { "content-type": "application/sdp" }, body: pc.localDescription.sdp });
  out.whepStatus = res.status;
  const answer = await res.text();
  out.answerCodecs = [...answer.matchAll(/a=rtpmap:\d+ ([A-Za-z0-9-]+)/g)].map((m) => m[1]);
  out.answerProfile = (/profile-level-id=([0-9a-fA-F]+)/.exec(answer) || [])[1] || "";
  if (res.status === 201) await pc.setRemoteDescription({ type: "answer", sdp: answer });
  await new Promise((r) => setTimeout(r, 7000));
  out.ice = pc.iceConnectionState; out.conn = pc.connectionState;
  const stats = await pc.getStats();
  stats.forEach((s) => {
    if (s.type === "inbound-rtp" && s.kind === "video") out.inbound = { bytes: s.bytesReceived, packets: s.packetsReceived, framesDecoded: s.framesDecoded, framesReceived: s.framesReceived, framesDropped: s.framesDropped, frameWidth: s.frameWidth, frameHeight: s.frameHeight, pli: s.pliCount, nack: s.nackCount, decoder: s.decoderImplementation, codecId: s.codecId };
    if (s.type === "candidate-pair" && s.state === "succeeded") out.pair = { state: s.state, bytesRecv: s.bytesReceived, bytesSent: s.bytesSent };
    if (s.type === "codec" && /video|H264/i.test(s.mimeType || "")) out.codec = { mimeType: s.mimeType, sdpFmtpLine: s.sdpFmtpLine };
  });
  out.videoWH = video.videoWidth + "x" + video.videoHeight;
  await fetch("/api/device-mesh/stream/stop", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  return out;
});
log(JSON.stringify(result, null, 1));
await b.close();
