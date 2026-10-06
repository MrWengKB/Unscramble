let questionsData = [];
let googleSheetWebhookUrl = "";
let selectedChipForSwap = null;
let startTime = Date.now();

function showToast(msg, duration = 3000) {
  const toast = document.getElementById('status-toast');
  if (!toast) return;
  toast.textContent = msg;
  toast.style.display = 'block';
  setTimeout(() => { toast.style.display = 'none'; }, duration);
}

// 页面初始化
async function init() {
  startTime = Date.now();

  // 1. 优先从 URL Hash (#data=...) 或 URL Query (?data=...) 解析 LZString 压缩数据
  let hashData = "";
  const hash = window.location.hash;
  if (hash && hash.includes('data=')) {
    hashData = hash.substring(hash.indexOf('data=') + 5);
  } else {
    const params = new URLSearchParams(window.location.search);
    hashData = params.get('data') || "";
  }

  if (hashData && typeof LZString !== 'undefined') {
    try {
      const decompressed = LZString.decompressFromEncodedURIComponent(hashData);
      if (decompressed) {
        const payload = JSON.parse(decompressed);
        if (payload.n) {
          const names = payload.n.split('\n').map(x => x.trim()).filter(Boolean);
          renderStudentDropdown(names);
        }
        if (payload.w) {
          googleSheetWebhookUrl = payload.w.trim();
        }
        if (payload.s) {
          parseAndRenderSentences(payload.s);
          return;
        }
      }
    } catch (e) {
      console.warn("解析 URL 数据包失败:", e);
    }
  }

  // 2. 回退模式：若链接中无题目，读取根目录文件
  await tryLoadLocalFiles();
}

async function tryLoadLocalFiles() {
  try {
    const res = await fetch(`./score.txt?t=${Date.now()}`);
    if (res.ok) googleSheetWebhookUrl = (await res.text()).trim();
  } catch (e) {}

  try {
    const res = await fetch(`./namelist.txt?t=${Date.now()}`);
    if (res.ok) {
      const text = await res.text();
      const list = text.split('\n').map(n => n.trim()).filter(Boolean);
      if (list.length > 0) renderStudentDropdown(list);
    }
  } catch (e) {}

  try {
    const res = await fetch(`./sentences.txt?t=${Date.now()}`);
    if (res.ok) {
      const text = await res.text();
      if (text.trim()) {
        parseAndRenderSentences(text);
        return;
      }
    }
  } catch (e) {}

  // 默认兜底示例（含一题多解）
  parseAndRenderSentences(`1. 我们 今天 在 公园里 散步 。\n2. 我 会 扫地 ， 也 会 抹 桌子 。 | 我 会 抹 桌子 ， 也 会 扫地 。`);
}

function renderStudentDropdown(names) {
  const select = document.getElementById('student-select');
  if (!select) return;
  select.innerHTML = '<option value="">-- 请选择姓名 --</option>';
  names.forEach(name => {
    const opt = document.createElement('option');
    opt.value = name;
    opt.textContent = name;
    select.appendChild(opt);
  });
}

/**
 * 健壮的句子解析器：完美支持一题多解与句尾标点剥离
 */
function parseAndRenderSentences(rawText) {
  const lines = rawText.split('\n').map(l => l.trim()).filter(Boolean);
  questionsData = [];
  const listContainer = document.getElementById('questions-list');
  listContainer.innerHTML = '';

  lines.forEach((line, idx) => {
    // 1. 分离行首题号
    let numStr = (idx + 1) + ".";
    let restOfLine = line;
    const numMatch = line.match(/^(\d+[\.、\s])\s*/);
    if (numMatch) {
      numStr = numMatch[1].trim();
      restOfLine = line.substring(numMatch[0].length).trim();
    }

    // 2. 切分多解（竖线 '|'）
    const rawAnswers = restOfLine.split('|').map(s => s.trim()).filter(Boolean);
    if (rawAnswers.length === 0) return;

    const validSolutions = [];
    let endPunctuation = "。";

    rawAnswers.forEach((ansStr) => {
      // 容错：自动在句中逗号、顿号、句尾标点前后加上空格，防止老师输入时标点与汉字粘连
      let cleanStr = ansStr.replace(/([，、；;。？！\?!])/g, ' $1 ').trim();
      let tokens = cleanStr.split(/\s+/).map(t => t.trim()).filter(Boolean);
      if (tokens.length === 0) return;

      // 提取句末标点（句号、问号、感叹号及英文句点），句中逗号/顿号不剔除
      const lastToken = tokens[tokens.length - 1];
      if (/^[。？！\?!.]$/.test(lastToken)) {
        endPunctuation = tokens.pop();
        if (endPunctuation === '.') endPunctuation = '。'; // 英文句点转为中文句号
      }

      // 存储为一种合法的词语序列解法
      validSolutions.push(tokens);
    });

    if (validSolutions.length === 0) return;

    // 以第1种解法为基准生成打乱的方块（包括词语和句中逗号/顿号）
    const tokensToShuffle = [...validSolutions[0]];
    const shuffledTokens = shuffleArray(tokensToShuffle);

    questionsData.push({
      id: idx,
      number: numStr,
      solutions: validSolutions, // 包含所有解法：例如解法A与解法B
      punctuation: endPunctuation
    });

    // 3. 构建卡片
    const card = document.createElement('div');
    card.className = 'question-card';
    card.id = `q-card-${idx}`;
    card.innerHTML = `
      <div class="question-header">
        <span class="question-num">${numStr} 连词成句</span>
        <span class="status-badge" id="badge-${idx}"></span>
      </div>
      <div class="unscramble-lane">
        <div class="words-container" id="words-container-${idx}">
          ${shuffledTokens.map(token => `
            <div class="word-chip ${/^[，、；;]$/.test(token) ? 'punct-chip' : ''}" data-word="${escapeHtml(token)}">
              ${escapeHtml(token)}
            </div>
          `).join('')}
        </div>
        <div class="punctuation-badge" title="句末标点固定在此">${endPunctuation}</div>
      </div>
    `;
    listContainer.appendChild(card);

    // 拖曳与点击互换绑定
    const wordsEl = card.querySelector(`#words-container-${idx}`);
    if (typeof Sortable !== 'undefined') {
      new Sortable(wordsEl, {
        animation: 150,
        ghostClass: 'sortable-ghost',
        chosenClass: 'sortable-chosen'
      });
    }

    wordsEl.addEventListener('click', (e) => {
      const chip = e.target.closest('.word-chip');
      if (!chip) return;
      handleChipTap(chip, wordsEl);
    });
  });
}

function shuffleArray(arr) {
  const res = [...arr];
  for (let i = res.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [res[i], res[j]] = [res[j], res[i]];
  }
  return res;
}

function escapeHtml(str) {
  return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function handleChipTap(chip, container) {
  if (!selectedChipForSwap) {
    selectedChipForSwap = chip;
    chip.classList.add('selected-swap');
  } else if (selectedChipForSwap === chip) {
    chip.classList.remove('selected-swap');
    selectedChipForSwap = null;
  } else {
    if (selectedChipForSwap.parentElement === container) {
      const next1 = selectedChipForSwap.nextSibling;
      const next2 = chip.nextSibling;
      container.insertBefore(selectedChipForSwap, next2);
      container.insertBefore(chip, next1);
    }
    selectedChipForSwap.classList.remove('selected-swap');
    selectedChipForSwap = null;
  }
}

// 检查答案（支持多解匹配与相同汉字任意互换）
async function submitExam() {
  const studentSelect = document.getElementById('student-select');
  const studentName = studentSelect ? studentSelect.value : "";
  
  if (!studentName && studentSelect && studentSelect.children.length > 1) {
    alert("请先在页面右上角选择你的名字！");
    studentSelect.focus();
    return;
  }

  let correctCount = 0;

  questionsData.forEach(q => {
    const card = document.getElementById(`q-card-${q.id}`);
    const badge = document.getElementById(`badge-${q.id}`);
    const container = document.getElementById(`words-container-${q.id}`);
    
    // 提取当前学生拼出的词块文本序列
    const currentWords = Array.from(container.children).map(c => (c.dataset.word || c.textContent).trim());

    // 只要符合任何一种合法方案即可（多解的核心判定）
    const isCorrect = q.solutions.some(solution => {
      if (solution.length !== currentWords.length) return false;
      return solution.every((word, idx) => word.trim() === currentWords[idx]);
    });

    if (isCorrect) {
      correctCount++;
      card.className = 'question-card card-correct';
      badge.textContent = '✓ 正确';
    } else {
      card.className = 'question-card card-incorrect';
      badge.textContent = '✕ 语序需调整';
    }
  });

  const total = questionsData.length;
  const accuracy = total > 0 ? `${Math.round((correctCount / total) * 100)}%` : '0%';
  const durationSec = Math.round((Date.now() - startTime) / 1000);

  if (correctCount === total && total > 0 && typeof confetti === 'function') {
    confetti({ particleCount: 80, spread: 70, origin: { y: 0.6 } });
  }

  if (googleSheetWebhookUrl) {
    const btn = document.getElementById('submit-btn');
    if (btn) {
      btn.disabled = true;
      btn.textContent = "正在提交成绩到教师表格...";
    }

    const payload = {
      time: new Date().toLocaleString(),
      student: studentName || "匿名作答",
      total: total,
      correct: correctCount,
      duration: durationSec,
      accuracy: accuracy
    };

    try {
      await fetch(googleSheetWebhookUrl, {
        method: 'POST',
        mode: 'no-cors',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      showToast(`已提交！得分：${correctCount}/${total}，成绩已录入。`, 4000);
      if (btn) btn.textContent = "成绩已提交完成";
    } catch (err) {
      showToast(`检查完成！得分：${correctCount}/${total}（网络提交异常）`, 4000);
      if (btn) {
        btn.disabled = false;
        btn.textContent = "重新提交";
      }
    }
  } else {
    showToast(`练习完成！答对：${correctCount}/${total}`, 4000);
  }
}

window.addEventListener('DOMContentLoaded', init);
