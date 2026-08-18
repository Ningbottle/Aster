// 轻量安全 Markdown 渲染器：支持标题、粗体、行内代码、代码块、列表、引用、分割线

function mdInline(t: string): string {
  return t
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
}

export function renderMarkdown(src: string): string {
  if (!src) return "";
  const lines = src.split("\n");
  const out: string[] = [];
  let inCode = false;
  let codeBuf: string[] = [];
  let listTag: "ul" | "ol" | null = null;

  function closeList() {
    if (listTag) {
      out.push("</" + listTag + ">");
      listTag = null;
    }
  }

  function esc(t: string): string {
    return t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i];
    if (/^\s*```/.test(ln)) {
      if (inCode) {
        out.push("<pre><code>" + codeBuf.join("\n") + "</code></pre>");
        codeBuf = [];
        inCode = false;
      } else {
        closeList();
        inCode = true;
      }
      continue;
    }
    if (inCode) {
      codeBuf.push(esc(ln));
      continue;
    }
    if (/^\s*$/.test(ln)) {
      closeList();
      continue;
    }
    const mHeading = ln.match(/^(#{1,3})\s+(.*)/);
    if (mHeading) {
      closeList();
      const level = mHeading[1].length;
      out.push(`<h${level}>${mdInline(mHeading[2])}</h${level}>`);
      continue;
    }
    if (/^\s*---+\s*$/.test(ln)) {
      closeList();
      out.push("<hr>");
      continue;
    }
    const mQuote = ln.match(/^>\s?(.*)/);
    if (mQuote) {
      closeList();
      out.push("<blockquote>" + mdInline(mQuote[1]) + "</blockquote>");
      continue;
    }
    const mUl = ln.match(/^\s*[-*]\s+(.*)/);
    if (mUl) {
      if (listTag !== "ul") {
        closeList();
        out.push("<ul>");
        listTag = "ul";
      }
      out.push("<li>" + mdInline(mUl[1]) + "</li>");
      continue;
    }
    const mOl = ln.match(/^\s*\d+[.)]\s+(.*)/);
    if (mOl) {
      if (listTag !== "ol") {
        closeList();
        out.push("<ol>");
        listTag = "ol";
      }
      out.push("<li>" + mdInline(mOl[1]) + "</li>");
      continue;
    }
    closeList();
    out.push("<p>" + mdInline(ln) + "</p>");
  }
  closeList();
  if (inCode) {
    out.push("<pre><code>" + codeBuf.join("\n") + "</code></pre>");
  }
  return out.join("");
}
