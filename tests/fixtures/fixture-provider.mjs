// Local OpenAI-compatible SSE provider fixture for Aster host/UI checks.
// Loopback only: it never contacts a model provider and never reads credentials.
import { createServer } from 'node:http';

export const FIXTURE_MARKERS = {
  toolPrompt: 'ASTER_HOST_TOOL_FIXTURE',
  cancelPrompt: 'ASTER_HOST_CANCEL_FIXTURE',
  answer: 'ASTER_HOST_ANSWER',
  readDone: 'ASTER_HOST_READ_OK',
  writeDone: 'ASTER_HOST_WRITE_OK',
  editPrompt: 'ASTER_HOST_EDIT_FIXTURE',
  editDone: 'ASTER_HOST_EDIT_OK',
  previewPrompt: 'ASTER_HOST_PREVIEW_FIXTURE',
  cancelBegin: 'ASTER_HOST_CANCEL_BEGIN',
  skillExpanded: 'ASTER_SKILL_FIXTURE_MARKER',
  questionPrompt: 'ASTER_HOST_QUESTION_FIXTURE',
  questionDone: 'ASTER_HOST_QUESTION_DONE',
  failurePrompt: 'ASTER_HOST_FAIL_FIXTURE',
  failureDone: 'ASTER_HOST_FAIL_DONE',
  slowPrompt: 'ASTER_HOST_SLOW_FIXTURE',
  longPrompt: 'ASTER_HOST_LONG_FIXTURE',
  longDone: 'ASTER_HOST_LONG_DONE',
  alignPrompt: 'ASTER_HOST_ALIGN_FIXTURE',
  interleavePrompt: 'ASTER_HOST_INTERLEAVE_FIXTURE',
  interleaveFirst: 'ASTER_INTERLEAVE_TEXT_1',
  interleaveSecond: 'ASTER_INTERLEAVE_TEXT_2',
  interleaveSummary: 'ASTER_INTERLEAVE_SUMMARY',
  interleaveThoughtOne: 'ASTER_INTERLEAVE_THOUGHT_1',
  interleaveThoughtTwo: 'ASTER_INTERLEAVE_THOUGHT_2',
  imageSeen: 'ASTER_HOST_IMAGE_SEEN',
  imageHoldPrompt: 'ASTER_HOST_IMAGE_HOLD_FIXTURE',
  imageHoldDone: 'ASTER_HOST_IMAGE_HOLD_DONE',
  imageReadPrompt: 'ASTER_HOST_IMAGE_READ_FIXTURE',
  imageReadDone: 'ASTER_HOST_IMAGE_READ_DONE',
};

const READ_FILE = 'fixture-read.txt';
const WRITE_FILE = 'fixture-write.md';
const QUESTION_TEXT = 'Which fixture option should the regression pick?';
const QUESTION_HEADER = 'Fixture pick';

function lastUserText(messages) {
  for (let index = (messages?.length ?? 0) - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role !== 'user') continue;
    if (typeof message.content === 'string') return message.content;
    if (Array.isArray(message.content)) {
      return message.content
        .filter(part => part?.type === 'text' && typeof part.text === 'string')
        .map(part => part.text)
        .join('\n');
    }
  }
  return '';
}

function hasToolResults(messages) {
  const list = messages ?? [];
  let lastUser = -1;
  for (let index = list.length - 1; index >= 0; index -= 1) {
    if (list[index]?.role === 'user') { lastUser = index; break; }
  }
  return lastUser >= 0 && list.slice(lastUser + 1).some(message => message?.role === 'tool');
}

/** Image parts of the most recent user message, as the provider actually received them. */
function lastUserImages(messages) {
  const list = messages ?? [];
  for (let index = list.length - 1; index >= 0; index -= 1) {
    const message = list[index];
    if (message?.role !== 'user') continue;
    if (!Array.isArray(message.content)) return [];
    return message.content.filter(part => part?.type === 'image_url' || part?.type === 'image');
  }
  return [];
}

function sseEvents() {
  const model = 'fixture-model';
  const id = `chatcmpl-fixture-${Math.random().toString(36).slice(2, 10)}`;
  const created = Math.floor(Date.now() / 1000);
  const frame = payload => `data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created, model, ...payload })}\n\n`;
  return {
    delta(delta, finish = null, usage) {
      return frame({
        choices: [{ index: 0, delta, finish_reason: finish }],
        ...(usage ? { usage } : {}),
      });
    },
    done: () => 'data: [DONE]\n\n',
  };
}

const USAGE = { prompt_tokens: 128, completion_tokens: 64, total_tokens: 192 };

function writeToolCalls(events) {
  const readArgs = JSON.stringify({ path: READ_FILE });
  const writeArgs = JSON.stringify({
    path: WRITE_FILE,
    content: `# Fixture document\n\n${FIXTURE_MARKERS.writeDone}\n\n- written by a real Pi write tool\n`,
  });
  return [
    events.delta({
      role: 'assistant',
      tool_calls: [
        { index: 0, id: 'call_read_fixture', type: 'function', function: { name: 'read', arguments: readArgs.slice(0, 8) } },
        { index: 1, id: 'call_write_fixture', type: 'function', function: { name: 'write', arguments: writeArgs.slice(0, 12) } },
      ],
    }),
    events.delta({
      tool_calls: [
        { index: 0, function: { arguments: readArgs.slice(8) } },
        { index: 1, function: { arguments: writeArgs.slice(12) } },
      ],
    }),
    events.delta({}, 'tool_calls', USAGE),
  ].join('');
}

function previewAnswer(events) {
  return [
    events.delta({ role: 'assistant', content: 'Preview fixtures for the details panel:\n\n- [preview-image.svg](preview-image.svg)\n- [preview-doc.pdf](preview-doc.pdf)\n- [preview-page.html](preview-page.html)\n' }),
    events.delta({}, 'stop', USAGE),
  ].join('');
}

function editToolCalls(events) {
  const args = JSON.stringify({
    path: WRITE_FILE,
    edits: [{ oldText: FIXTURE_MARKERS.writeDone, newText: FIXTURE_MARKERS.editDone }],
  });
  return [
    events.delta({
      role: 'assistant',
      tool_calls: [{
        index: 0,
        id: 'call_edit_fixture',
        type: 'function',
        function: { name: 'edit', arguments: args.slice(0, 16) },
      }],
    }),
    events.delta({ tool_calls: [{ index: 0, function: { arguments: args.slice(16) } }] }),
    events.delta({}, 'tool_calls', USAGE),
  ].join('');
}

const CHINESE_ANSWER = [
  '这是用于核对中文正文换行、字重和段落节奏的固定段落。它不来自模型，而是 Aster 的本地 fixture；每一轮视觉验收都用同一段文字，避免因为内容变化而误判排版。这里继续补充一些句子，让这一段在常见窗口宽度下至少换行三到四次，并包含 English words、数字 0123456789，以及标点：逗号、句号、顿号、括号（示例）与引号“测试”。',
  '',
  '- 中文列表项一：检查段落间距与行高。',
  '- 中文列表项二：检查 `inline code` 的等宽字体与底色。',
  '- 中文列表项三：打开 [fixture-read.txt](fixture-read.txt) 验证本地文件链接。',
  '',
  '**加粗的中文句子**与 *斜体说明* 放在同一段里，用来检查字重切换后是否仍然保持同一基线。下面是一段较长的中文，故意包含多个分句，让换行发生在词组之间，而不是每个字都单独断行；同时保留百分号 23%、时间 10:25、版本 v0.1.0 与路径 `src/renderer/styles.css`。',
  '',
  '| 项目 | 含义 | 来源 |',
  '| --- | --- | --- |',
  '| Context | 上下文占用 | Pi session.getStats |',
  '| API usage | 本会话累计 | Pi session.getStats |',
].join('\n');

// Mirrors the visible assistant text of the reference conversation capture so the
// alignment run compares the same Chinese content instead of different prose. The
// reference interleaves one collapsed tool row after the first paragraph, so the
// fixture uses a real read tool call at that same point.
const ALIGN_FIRST = '明白：学校和日期上移到顶部基本信息区（给照片让路），下面的列表符号换成更合适的标记。列表点我改用小琥珀方块——和栏目色条同一视觉语言，且用 CSS 绘制不依赖字体字形，打印和各家 PDF 阅读器里都不会变形。';

const ALIGN_REST = [
  '同步 cv.md 并出预览检查。',
  '',
  '改版完成，成品已更新：[吴问寒-智能体应用-校招-2026-10-24.pdf](output/吴问寒-智能体应用-校招-2026-10-24.pdf)。',
  '',
  '**这版的结构梳理**',
  '',
  '1. **学校 + 日期上移到顶部基本信息区**——现在紧跟姓名和求职意图，第二行是「教育 安徽工业大学·人工智能（本科）·2023.09 - 2027.07」。原来单独的「学历 本科」并进了「（本科）」不再单列，电话/邮箱/ GitHub 合成一行。照片右侧完全让开，不再有横线顶到照片下的拥挤感。',
  '2. **教育背景栏只留干货**——CET-4 与课程一行、技术博客一行，栏目标题恢复全宽细线（没有单位可挂横线了，全宽线反而干净）。',
  '3. **列表符号**——换成了 3.5px 的琥珀小方块：它是栏目色条的缩小版，整套版式有统一的视觉语言；比圆点更利落，比三角形更稳重。关键是用 CSS 绘制而不是字体字形，所以在任何 PDF 阅读器、打印或转 Word 时形状都不会走样。',
  '4. **实习经历的信息轨保留**——你上次的效果很好，且它在页面中部不碰照片；两个信息轨高低错落正是这版的版面节奏。',
  '',
  '结构层次现在是三层：**顶部身份块**（姓名/意图/联系方式/教育）→ **信息轨条目**（实习单位挂横线）→ **项目块**（琥珀项目名 + 灰色技术栈 + 方块要点）。cv.md 与 output 镜像稿已同步，仍为一页 A4。',
  '',
  '如果方块的观感还想调（比如改成短横线【■】或空心方块），说一声就换。',
].join('\n');

function alignAnswer(events, afterTool) {
  if (!afterTool) {
    const args = JSON.stringify({ path: 'cv.md' });
    return [
      events.delta({ role: 'assistant', content: `${ALIGN_FIRST}\n\n` }),
      events.delta({
        tool_calls: [{
          index: 0,
          id: 'call_align_fixture',
          type: 'function',
          function: { name: 'read', arguments: args.slice(0, 10) },
        }],
      }),
      events.delta({ tool_calls: [{ index: 0, function: { arguments: args.slice(10) } }] }),
      events.delta({}, 'tool_calls', USAGE),
    ].join('');
  }
  return [
    events.delta({ role: 'assistant', content: ALIGN_REST }),
    events.delta({}, 'stop', USAGE),
  ].join('');
}

function imageAnswer(events, count) {
  return [
    events.delta({ role: 'assistant', content: `${FIXTURE_MARKERS.imageSeen} ${count}\n\nThe provider received ${count} image${count === 1 ? '' : 's'} in this request.\n` }),
    events.delta({}, 'stop', USAGE),
  ].join('');
}

function imageHoldToolCall(events) {
  const args = JSON.stringify({ command: 'node -e "setTimeout(()=>{}, 3000)"' });
  return [
    events.delta({
      role: 'assistant',
      content: `${FIXTURE_MARKERS.imageHoldDone}\n\nHolding the turn open for a queued follow-up.\n\n`,
      tool_calls: [{ index: 0, id: 'call_image_hold', type: 'function', function: { name: 'bash', arguments: args.slice(0, 14) } }],
    }),
    events.delta({ tool_calls: [{ index: 0, function: { arguments: args.slice(14) } }] }),
    events.delta({}, 'tool_calls', USAGE),
  ].join('');
}

function imageHoldAnswer(events) {
  return [
    events.delta({ role: 'assistant', content: `${FIXTURE_MARKERS.imageHoldDone}\n\nThe held turn settled after the tool finished.\n` }),
    events.delta({}, 'stop', USAGE),
  ].join('');
}

function imageReadToolCalls(events) {
  const args = JSON.stringify({ path: 'shot.png' });
  return [
    events.delta({
      role: 'assistant',
      content: 'Reading the workspace image with the real read tool.\n\n',
      tool_calls: [{ index: 0, id: 'call_image_read', type: 'function', function: { name: 'read', arguments: args.slice(0, 11) } }],
    }),
    events.delta({ tool_calls: [{ index: 0, function: { arguments: args.slice(11) } }] }),
    events.delta({}, 'tool_calls', USAGE),
  ].join('');
}

function imageReadAnswer(events) {
  return [
    events.delta({ role: 'assistant', content: `${FIXTURE_MARKERS.imageReadDone}\n\nThe tool result carried the image back to the model.\n` }),
    events.delta({}, 'stop', USAGE),
  ].join('');
}

function finalAnswer(events) {
  return [
    events.delta({ role: 'assistant', reasoning_content: 'Fixture reasoning: composing the final answer.' }),
    events.delta({ content: `# Fixture answer\n\n${FIXTURE_MARKERS.answer}\n\n- ` }),
    events.delta({ content: 'read and write tools ran through Pi\n- ' }),
    events.delta({ content: 'streamed Markdown, thinking and tool cards\n- ' }),
    events.delta({ content: 'open [fixture-read.txt](fixture-read.txt) locally\n- ' }),
    events.delta({ content: 'open [fixture-write.md](fixture-write.md) after the write\n- ' }),
    events.delta({ content: 'open [sample.pdf](sample.pdf) locally\n' }),
    events.delta({ content: `\n${CHINESE_ANSWER}\n` }),
    events.delta({ content: '\n```ts\n// 中文注释：用于检查代码字号、行高与横向溢出\nconst labels = ["首页", "会话", "工具", "右栏", "终端"];\nconst answer = "ASTER_HOST_ANSWER";\n```\n' }),
    events.delta({}, 'stop', USAGE),
  ].join('');
}

function failureAnswer(events) {
  return [
    events.delta({ role: 'assistant', content: `${FIXTURE_MARKERS.failureDone}\n\nThe missing fixture file produced a real failed tool result.\n` }),
    events.delta({}, 'stop', USAGE),
  ].join('');
}

function longAnswer(events) {
  return [
    events.delta({ role: 'assistant', content: `${FIXTURE_MARKERS.longDone}\n\nThe long command completed and its output is above.\n` }),
    events.delta({}, 'stop', USAGE),
  ].join('');
}

function failingToolCalls(events) {
  const args = JSON.stringify({ path: 'fixture-missing.txt' });
  return [
    events.delta({
      role: 'assistant',
      tool_calls: [{
        index: 0,
        id: 'call_failure_fixture',
        type: 'function',
        function: { name: 'read', arguments: args.slice(0, 9) },
      }],
    }),
    events.delta({ tool_calls: [{ index: 0, function: { arguments: args.slice(9) } }] }),
    events.delta({}, 'tool_calls', USAGE),
  ].join('');
}

function commandToolCalls(events, id, command) {
  const args = JSON.stringify({ command });
  return [
    events.delta({
      role: 'assistant',
      tool_calls: [{
        index: 0,
        id,
        type: 'function',
        function: { name: 'bash', arguments: args.slice(0, 14) },
      }],
    }),
    events.delta({ tool_calls: [{ index: 0, function: { arguments: args.slice(14) } }] }),
    events.delta({}, 'tool_calls', USAGE),
  ].join('');
}

/** Text and a tool call in one assistant message, so the card must render inside that message. */
function interleaveToolCalls(events, id, command, thought, text) {
  const args = JSON.stringify({ command });
  return [
    events.delta({ role: 'assistant', reasoning_content: `${thought}\n\n` }),
    events.delta({ content: `${text}\n\n` }),
    events.delta({
      tool_calls: [{
        index: 0,
        id,
        type: 'function',
        function: { name: 'bash', arguments: args.slice(0, 14) },
      }],
    }),
    events.delta({ tool_calls: [{ index: 0, function: { arguments: args.slice(14) } }] }),
    events.delta({}, 'tool_calls', USAGE),
  ].join('');
}

function interleaveSummary(events) {
  return [
    events.delta({ role: 'assistant', content: `${FIXTURE_MARKERS.interleaveSummary}\n\n两段文字与两次工具调用都按原生顺序保留。\n` }),
    events.delta({}, 'stop', USAGE),
  ].join('');
}

/** Tool results that belong to the current user turn; the model sees one more after each step. */
function toolResultsSinceUser(messages) {
  const list = messages ?? [];
  let lastUser = -1;
  for (let index = list.length - 1; index >= 0; index -= 1) {
    if (list[index]?.role === 'user') { lastUser = index; break; }
  }
  return lastUser < 0 ? 0 : list.slice(lastUser + 1).filter(message => message?.role === 'tool').length;
}

function questionToolCalls(events) {
  const args = JSON.stringify({
    questions: [{
      question: QUESTION_TEXT,
      header: QUESTION_HEADER,
      multiSelect: true,
      options: [
        { label: '选项A', description: 'Check this option and type the free-text answer.' },
        { label: '选项B', description: 'Unused distractor option.' },
      ],
    }],
  });
  return [
    events.delta({
      role: 'assistant',
      tool_calls: [{
        index: 0,
        id: 'call_question_fixture',
        type: 'function',
        function: { name: 'ask_user_question', arguments: args.slice(0, 24) },
      }],
    }),
    events.delta({ tool_calls: [{ index: 0, function: { arguments: args.slice(24) } }] }),
    events.delta({}, 'tool_calls', USAGE),
  ].join('');
}

function questionAnswer(events) {
  return [
    events.delta({ role: 'assistant', content: `${FIXTURE_MARKERS.questionDone}\n\nThe questionnaire result came back as a real tool result.\n` }),
    events.delta({}, 'stop', USAGE),
  ].join('');
}

function messageText(message) {
  if (typeof message?.content === 'string') return message.content;
  if (Array.isArray(message?.content)) {
    return message.content.filter(part => part?.type === 'text').map(part => part.text).join('\n');
  }
  return '';
}

function questionResultSeen(messages) {
  return (messages ?? []).some(message => message?.role === 'tool' && (
    messageText(message).includes('User has answered your questions:')
    || messageText(message).includes('User declined to answer questions')
  ));
}

function streamFrames(res, frames) {
  let index = 0;
  const timer = setInterval(() => {
    if (res.writableEnded || res.destroyed) {
      clearInterval(timer);
      return;
    }
    if (index >= frames.length) {
      clearInterval(timer);
      res.end();
      return;
    }
    res.write(`${frames[index]}\n\n`);
    index += 1;
  }, 40);
  res.on('close', () => clearInterval(timer));
}

/**
 * Starts a loopback OpenAI-compatible chat-completions server.
 * Returns the base URL (append `/v1` in models.json), captured requests and events.
 */
export async function startFixtureProvider() {
  const requests = [];
  const events = [];
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    if (req.method !== 'POST' || url.pathname !== '/v1/chat/completions') {
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('not found');
      return;
    }
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => {
      let body;
      try {
        body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      } catch {
        res.writeHead(400, { 'content-type': 'text/plain' });
        res.end('invalid json');
        return;
      }
      const prompt = lastUserText(body.messages);
      const entry = {
        at: Date.now(),
        model: body.model,
        stream: body.stream === true,
        toolNames: Array.isArray(body.tools) ? body.tools.map(tool => tool?.function?.name).filter(Boolean) : [],
        messages: body.messages,
        prompt,
      };
      requests.push(entry);
      const sse = sseEvents();
      res.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
      });
      // Pi's compaction/dialog summarization request carries no tools; answer it
      // with plain text so a real compaction can complete against this fixture.
      if (!Array.isArray(body.tools) || body.tools.length === 0) {
        events.push({ type: 'summarization-request', at: Date.now() });
        const frames = (`${sse.delta({ role: 'assistant', content: 'Fixture compaction summary: the user requested a tool-check turn and then asked to continue.' })}\n\n${sse.delta({}, 'stop', USAGE)}\n\n${sse.done()}`).split('\n\n').filter(Boolean);
        streamFrames(res, frames);
        return;
      }
      if (prompt.includes(FIXTURE_MARKERS.cancelPrompt)) {
        events.push({ type: 'cancel-request', at: Date.now() });
        res.write(sse.delta({ role: 'assistant', reasoning_content: 'Waiting for cancellation.' }));
        res.write(sse.delta({ content: `${FIXTURE_MARKERS.cancelBegin}\n\nstill waiting\n` }));
        let ticks = 0;
        const timer = setInterval(() => {
          ticks += 1;
          if (res.writableEnded || res.destroyed) return;
          res.write(sse.delta({ content: `\n- tick ${ticks}` }));
        }, 120);
        const stop = () => {
          clearInterval(timer);
          events.push({ type: 'cancel-stream-closed', at: Date.now() });
        };
        res.on('close', stop);
        return;
      }
      if (body.messages?.some(message => message?.role === 'user' && messageText(message).includes(FIXTURE_MARKERS.questionPrompt))) {
        const answered = questionResultSeen(body.messages);
        events.push({ type: answered ? 'question-result-seen' : 'question-requested', at: Date.now() });
        const frames = ((answered ? questionAnswer(sse) : questionToolCalls(sse)) + sse.done()).split('\n\n').filter(Boolean);
        streamFrames(res, frames);
        return;
      }
      const imageCount = lastUserImages(body.messages).length;
      if (imageCount > 0) {
        events.push({ type: 'image-request', count: imageCount, at: Date.now() });
        const frames = (imageAnswer(sse, imageCount) + sse.done()).split('\n\n').filter(Boolean);
        streamFrames(res, frames);
        return;
      }
      if (prompt.includes(FIXTURE_MARKERS.imageHoldPrompt)) {
        const frames = ((hasToolResults(body.messages) ? imageHoldAnswer(sse) : imageHoldToolCall(sse)) + sse.done()).split('\n\n').filter(Boolean);
        streamFrames(res, frames);
        return;
      }
      if (prompt.includes(FIXTURE_MARKERS.imageReadPrompt)) {
        const frames = ((hasToolResults(body.messages) ? imageReadAnswer(sse) : imageReadToolCalls(sse)) + sse.done()).split('\n\n').filter(Boolean);
        streamFrames(res, frames);
        return;
      }
      const toolDone = hasToolResults(body.messages);
      if (prompt.includes(FIXTURE_MARKERS.failurePrompt)) {
        const frames = ((toolDone ? failureAnswer(sse) : failingToolCalls(sse)) + sse.done()).split('\n\n').filter(Boolean);
        streamFrames(res, frames);
        return;
      }
      if (prompt.includes(FIXTURE_MARKERS.slowPrompt)) {
        const frames = ((toolDone ? finalAnswer(sse) : commandToolCalls(sse, 'call_slow_fixture', 'node -e "setTimeout(()=>{}, 45000)"')) + sse.done()).split('\n\n').filter(Boolean);
        streamFrames(res, frames);
        return;
      }
      if (prompt.includes(FIXTURE_MARKERS.interleavePrompt)) {
        const results = toolResultsSinceUser(body.messages);
        const payload = results === 0
          ? interleaveToolCalls(sse, 'call_interleave_one', "node -e \"console.log('ASTER_INTERLEAVE_TOOL_1')\"", FIXTURE_MARKERS.interleaveThoughtOne, `${FIXTURE_MARKERS.interleaveFirst}\n\n先检查第一个真实工具结果。`)
          : results === 1
            ? interleaveToolCalls(sse, 'call_interleave_two', "node -e \"console.log('ASTER_INTERLEAVE_TOOL_2')\"", FIXTURE_MARKERS.interleaveThoughtTwo, `${FIXTURE_MARKERS.interleaveSecond}\n\n再运行第二个命令，最后给出总结。`)
            : interleaveSummary(sse);
        const frames = (payload + sse.done()).split('\n\n').filter(Boolean);
        streamFrames(res, frames);
        return;
      }
      if (prompt.includes(FIXTURE_MARKERS.alignPrompt) || prompt.includes('不用三角形')) {
        const frames = (alignAnswer(sse, hasToolResults(body.messages)) + sse.done()).split('\n\n').filter(Boolean);
        streamFrames(res, frames);
        return;
      }
      if (prompt.includes(FIXTURE_MARKERS.previewPrompt)) {
        const frames = (previewAnswer(sse) + sse.done()).split('\n\n').filter(Boolean);
        streamFrames(res, frames);
        return;
      }
      if (prompt.includes(FIXTURE_MARKERS.editPrompt)) {
        const payload = hasToolResults(body.messages) ? finalAnswer(sse) : editToolCalls(sse);
        const frames = (payload + sse.done()).split('\n\n').filter(Boolean);
        streamFrames(res, frames);
        return;
      }
      if (prompt.includes(FIXTURE_MARKERS.longPrompt)) {
        const frames = ((toolDone ? longAnswer(sse) : commandToolCalls(sse, 'call_long_fixture', 'node -e "for (let i=1;i<=120;i++) console.log(\'line \'+i)"')) + sse.done()).split('\n\n').filter(Boolean);
        streamFrames(res, frames);
        return;
      }
      const payload = toolDone ? finalAnswer(sse) : writeToolCalls(sse);
      const frames = (payload + sse.done()).split('\n\n').filter(Boolean);
      streamFrames(res, frames);
    });
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Fixture provider did not bind a TCP port.');
  return {
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    requests,
    events,
    close: () => new Promise(resolve => server.close(() => resolve())),
    readFile: READ_FILE,
    writeFile: WRITE_FILE,
  };
}

export function fixtureModelsJson(baseUrl) {
  return {
    providers: {
      fixture: {
        name: 'Aster fixture',
        baseUrl,
        apiKey: 'fixture-not-a-secret',
        api: 'openai-completions',
        models: [
          {
            id: 'fixture-model',
            name: 'Fixture model',
            api: 'openai-completions',
            reasoning: true,
            input: ['text', 'image'],
            contextWindow: 128000,
            maxTokens: 4096,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          },
        ],
      },
    },
  };
}
