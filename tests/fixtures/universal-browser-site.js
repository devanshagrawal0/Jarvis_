"use strict";

const http = require("http");

const port = Number(process.env.PORT || 43177);
const sent = [];

function page(body, script = "") {
  return `<!doctype html><html><head><meta charset="utf-8"><title>Unknown Collaboration Portal</title><style>body{font:16px system-ui;max-width:760px;margin:40px auto}button,input{font:inherit;margin:6px;padding:10px}.hidden{display:none}.card{border:1px solid #aaa;padding:12px;margin:8px}</style></head><body>${body}<script>${script}</script></body></html>`;
}

const server = http.createServer((request, response) => {
  if (request.url === "/_state") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ sent }));
    return;
  }
  if (request.url === "/source") {
    response.writeHead(200, { "content-type": "text/plain", "content-disposition": 'attachment; filename="market-source.txt"' });
    response.end("Dataset: 420 observations. Market signal: momentum weakens when volatility exceeds 2.4%.");
    return;
  }
  if (request.method === "POST" && request.url === "/send") {
    let raw = "";
    request.on("data", (chunk) => { raw += chunk; });
    request.on("end", () => {
      const data = new URLSearchParams(raw);
      sent.push({ recipient: data.get("recipient"), message: data.get("message"), at: new Date().toISOString() });
      response.writeHead(200, { "content-type": "text/html" });
      response.end(page(`<h1>Delivery verified</h1><p id="proof">Message sent to ${data.get("recipient")}: ${data.get("message")}</p>`));
    });
    return;
  }
  response.writeHead(200, { "content-type": "text/html" });
  response.end(page(`
    <h1>Collaboration Portal</h1>
    <p>This fixture deliberately has no website-specific automation adapter.</p>
    <button id="messages" onclick="openInbox()">Open conversations</button>
    <a id="source" href="/source" download>Download evidence dataset</a>
    <section id="inbox" class="hidden">
      <h2>Find a conversation</h2>
      <input id="person" aria-label="Search people" placeholder="Type a name" oninput="findPerson()">
      <div id="results"></div>
    </section>
    <form id="composer" class="hidden" method="post" action="/send">
      <h2 id="selected"></h2>
      <input type="hidden" id="recipient" name="recipient">
      <label>Message <input id="message" name="message" aria-label="Message"></label>
      <button id="send" type="submit">Send message</button>
    </form>`, `
    const people=['Raghav Mittal','Raghav Mehta','AJ Sharma'];
    function openInbox(){document.querySelector('#inbox').classList.remove('hidden')}
    function findPerson(){
      const q=document.querySelector('#person').value.toLowerCase();
      const results=document.querySelector('#results');
      results.innerHTML='';
      people.filter(p=>p.toLowerCase().includes(q)).forEach(p=>{
        const button=document.createElement('button');
        button.type='button';button.className='card';button.textContent=p;button.onclick=()=>choose(p);
        results.appendChild(button);
      });
    }
    function choose(name){document.querySelector('#recipient').value=name;document.querySelector('#selected').textContent='Conversation with '+name;document.querySelector('#composer').classList.remove('hidden')}
  `));
});

server.listen(port, "127.0.0.1", () => console.log(`fixture:${port}`));

for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => server.close(() => process.exit(0)));
