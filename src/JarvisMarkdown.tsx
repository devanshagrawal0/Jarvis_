import { useEffect } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

// Renders the assistant's reply as real markdown so the owner never sees literal asterisks,
// backticks, or `- ` bullets. Styled for the dark Jarvis response panel; inherits the panel's
// font-size/color. Streams safely — react-markdown re-parses the partial string each render.
const MD_CSS = `
.jr-md { line-height: 1.55; color: inherit; overflow-wrap: anywhere; }
.jr-md > *:first-child { margin-top: 0; }
.jr-md > *:last-child { margin-bottom: 0; }
.jr-md p { margin: 0 0 10px; }
.jr-md strong { font-weight: 650; color: rgba(255,255,255,.98); }
.jr-md em { font-style: italic; color: rgba(235,242,252,.95); }
.jr-md a { color: #8fd0ff; text-decoration: none; border-bottom: 1px solid rgba(140,208,255,.35); }
.jr-md a:hover { border-bottom-color: rgba(140,208,255,.85); }
.jr-md ul, .jr-md ol { margin: 6px 0 10px; padding-left: 20px; }
.jr-md li { margin: 3px 0; }
.jr-md li::marker { color: rgba(140,190,240,.75); }
.jr-md code { font-family: "JetBrains Mono", ui-monospace, "SFMono-Regular", monospace; font-size: .9em;
  background: rgba(140,190,255,.12); border: 1px solid rgba(140,190,255,.14); border-radius: 5px; padding: 1px 5px; }
.jr-md pre { margin: 8px 0 12px; padding: 12px 14px; border-radius: 10px;
  background: rgba(8,12,20,.72); border: 1px solid rgba(120,160,220,.18); overflow-x: auto; }
.jr-md pre code { background: none; border: none; padding: 0; font-size: 12.5px; line-height: 1.5; display: block; color: #cfe6ff; }
.jr-md h1, .jr-md h2, .jr-md h3, .jr-md h4 { margin: 13px 0 6px; font-weight: 650; line-height: 1.3; color: rgba(255,255,255,.96); }
.jr-md h1 { font-size: 1.16em; } .jr-md h2 { font-size: 1.09em; } .jr-md h3 { font-size: 1.02em; } .jr-md h4 { font-size: .98em; }
.jr-md blockquote { margin: 8px 0; padding: 2px 0 2px 12px; border-left: 2px solid rgba(140,190,255,.32); color: rgba(220,230,245,.82); }
.jr-md table { border-collapse: collapse; margin: 8px 0; font-size: .92em; display: block; overflow-x: auto; }
.jr-md th, .jr-md td { border: 1px solid rgba(140,170,220,.2); padding: 5px 9px; text-align: left; }
.jr-md th { background: rgba(140,170,220,.08); font-weight: 600; }
.jr-md hr { border: none; border-top: 1px solid rgba(140,170,220,.18); margin: 12px 0; }
`;

// While a reply streams, a markdown marker can arrive before its closing pair — react-markdown then
// shows the raw `**`, `` ` `` or ```` ``` ```` for a beat (the "flickering asterisk"). Temporarily
// close any unpaired code fence / backtick / bold so the partial always renders clean. On a complete
// reply the counts are even, so this is a no-op.
function repairStreamingMarkdown(text: string): string {
  let t = text;
  const fences = (t.match(/```/g) || []).length;
  if (fences % 2 === 1) {
    t += "\n```";
  } else {
    const ticks = (t.replace(/```/g, "").match(/`/g) || []).length;
    if (ticks % 2 === 1) t += "`";
  }
  const bolds = (t.match(/\*\*/g) || []).length;
  if (bolds % 2 === 1) t += "**";
  return t;
}

export function JarvisMarkdown({ text }: { text: string }) {
  useEffect(() => {
    const id = "jr-md-styles";
    if (!document.getElementById(id)) {
      const el = document.createElement("style");
      el.id = id;
      el.textContent = MD_CSS;
      document.head.appendChild(el);
    }
  }, []);
  return (
    <div className="jr-md">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          // Links always open in a new tab and never trust javascript: URLs.
          a: ({ href, children, ...rest }) => (
            <a href={/^https?:\/\//i.test(String(href || "")) ? href : undefined} target="_blank" rel="noreferrer" {...rest}>{children}</a>
          ),
        }}
      >
        {repairStreamingMarkdown(text)}
      </ReactMarkdown>
    </div>
  );
}
