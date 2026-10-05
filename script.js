let questionsData = [];
let googleSheetWebhookUrl = "";
let selectedChipForSwap = null;
let startTime = Date.now();

// 辅助提示函数
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
  await loadWebhookUrl();
  await loadStudentNames();
  await loadSentences();
}

// 1. 读取 score.txt 获得 Webhook 链接
async function loadWebhookUrl() {
  try {
    const res = await fetch(`./score.txt?t=${Date.now()}`);
    if (res.ok) {
      const text = await res.text();
      googleSheetWebhookUrl = text.trim();
    }
  } catch (e) {
    console.warn("未能读取到 score.txt，将仅在前端做正误检验。");
  }
}

// 2. 读取 namelist.txt 填充下拉菜单
async function loadStudentNames() {
  const select = document.getElementById('student-select');
  if (!select) return;
  try {
    const res = await fetch(`./namelist.txt?t=${Date.now()}`);
    if (res.ok) {
      const text = await res.text();
      const names = text.split('\n').map(n => n.trim()).filter(Boolean);
      names.forEach(name => {
        const opt = document.createElement('option');
        opt.value = name;
        opt.textContent = name;
        select.appendChild(opt);
      });
    }
  } catch (e) {
    console.error("加载名单失败:", e);
  }
}

// 3. 读取 sentences.txt 并解析多解与词块
async function loadSentences() {
  try {
    const res = await fetch(`./sentences.txt?t=${Date.now()}`);
    if (!res.ok) throw new Error("无法读取 sentences.txt");
    const text = await res.text();
    parseAndRenderSentences(text);
  } catch (e) {
    document.getElementById('questions-list').innerHTML = `
      <div style="text-align:center; padding: 40px; color:#ef4444;">
        未找到 sentences.txt 文件，请确保文件存在于根目录。
      </div>`;
  }
}

/**
 * 解析 sentences.txt 并动态渲染题目
 * 支持格式示例：
 * 1. 我 会 扫地 ， 也 会 抹 桌子 。 | 我 会 抹 桌子 ， 也 会 扫地 。
 */
function parseAndRenderSentences(rawText) {
  const lines = rawText.split('\n').map(l => l.trim()).filter(Boolean);
  questionsData = [];
  const listContainer = document.getElementById('questions-list');
  listContainer.innerHTML = '';

  lines.forEach((line, idx) => {
    // 1. 分离行首题号（如 "1. " 或 "1、"）
    let numStr = (idx + 1) + ".";
    let restOfLine = line;
    const numMatch = line.match(/^(\d+[\.、\s])\s*/);
    if (numMatch) {
      numStr = numMatch[1].trim();
      restOfLine = line.substring(numMatch[0].length).trim();
    }

    // 2. 按竖线 '|' 切割出所有可能的多解句子
    const rawAnswers = restOfLine.split('|').map(s => s.trim()).filter(Boolean);
    if (rawAnswers.length === 0) return;

    // 存储当前题目的所有有效排列方案（词语及句中标点的字符串数组）
    const validSolutions = [];
    let endPunctuation = "。"; // 默认句末终结标点

    rawAnswers.forEach((ansStr, aIdx) => {
      // 按空格切割所有词块与标点
      let tokens = ansStr.split(/\s+/).filter(Boolean);
      if (tokens.length === 0) return;

      // 提取句末终结标点（句号、问号、感叹号等），句中标点（逗号、顿号）不剥离
      const lastToken = tokens[tokens.length - 1];
      if (/^[。？！?!]$/.test(lastToken)) {
        endPunctuation = tokens.pop();
      }

      // 将该答案记录为一种标准解
      validSolutions.push(tokens);
    });

    if (validSolutions.length === 0) return;

    // 以第一个答案方案为基准，提取要打乱的方块（包括词语、逗号、顿号等）
    const tokensToShuffle = [...validSolutions[0]];
    const shuffledTokens = shuffleArray(tokensToShuffle);

    questionsData.push({
      id: idx,
      number: numStr,
      solutions: validSolutions, // 支持的所有合法排列方案
      punctuation: endPunctuation // 句末固定标点
    });

    // 3. 构建题目卡片 DOM
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
          ${shuffledTokens.map((token, tIdx) => `
            <div class="word-chip ${/^[，、；;]$/.test(token) ? 'punct-chip' : ''}" data-word="${escapeHtml(token)}">
              ${escapeHtml(token)}
            </div>
          `).join('')}
        </div>
        <div class="punctuation-badge" title="句末标点固定在此">${endPunctuation}</div>
      </div>
    `;
    listContainer.appendChild(card);

    // 4. 绑定拖曳排序 (SortableJS)
    const wordsEl = card.querySelector(`#words-container-${idx}`);
    new Sortable(wordsEl, {
      animation: 150,
      ghostClass: 'sortable-ghost',
      chosenClass: 'sortable-chosen'
    });

    // 5. 绑定点击两词互换（辅助低年级触屏设备操作）
    wordsEl.addEventListener('click', (e) => {
      const chip = e.target.closest('.word-chip');
      if (!chip) return;
      handleChipTap(chip, wordsEl);
    });
  });
}

// 数组随机乱序（Fisher-Yates 算法）
function shuffleArray(arr) {
  const result = [...arr];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

// 避免 XSS
function escapeHtml(str) {
  return str.replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
}

// 点击互换处理逻辑
function handleChipTap(chip, container) {
  if (!selectedChipForSwap) {
    selectedChipForSwap = chip;
    chip.classList.add('selected-swap');
  } else if (selectedChipForSwap === chip) {
    chip.classList.remove('selected-swap');
    selectedChipForSwap = null;
  } else {
    if (selectedChipForSwap.parentElement === container) {
      // 仅在同一个题目容器内互换
      const next1 = selectedChipForSwap.nextSibling;
      const next2 = chip.nextSibling;
      container.insertBefore(selectedChipForSwap, next2);
      container.insertBefore(chip, next1);
    }
    selectedChipForSwap.classList.remove('selected-swap');
    selectedChipForSwap = null;
  }
}

// 检查所有题目并提交成绩
async function submitExam() {
  const studentSelect = document.getElementById('student-select');
  const studentName = studentSelect ? studentSelect.value : "";
  
  if (!studentName) {
    alert("请先在页面右上角选择你的名字！");
    if (studentSelect) studentSelect.focus();
    return;
  }

  let correctCount = 0;

  questionsData.forEach(q => {
    const card = document.getElementById(`q-card-${q.id}`);
    const badge = document.getElementById(`badge-${q.id}`);
    const container = document.getElementById(`words-container-${q.id}`);
    
    // 获取学生当前排好的词语与句中标点序列
    const currentWords = Array.from(container.children).map(c => c.dataset.word);
    const currentKey = currentWords.join('___');

    // 对比所有可接受的可能解法（多解支持 & 同字等价支持）
    const isCorrect = q.solutions.some(sol => sol.join('___') === currentKey);

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

  // 全对时触发纸屑特效
  if (correctCount === total && total > 0 && typeof confetti === 'function') {
    confetti({ particleCount: 80, spread: 70, origin: { y: 0.6 } });
  }

  // 如果配有 Google Sheet Webhook，推送到云端表格
  if (googleSheetWebhookUrl) {
    const btn = document.getElementById('submit-btn');
    if (btn) {
      btn.disabled = true;
      btn.textContent = "正在提交成绩到教师表格...";
    }

    const payload = {
      time: new Date().toLocaleString(),
      student: studentName,
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
      showToast(`已提交！得分：${correctCount}/${total}，成绩已保存至教师表格。`, 4000);
      if (btn) btn.textContent = "成绩已提交完成";
    } catch (err) {
      showToast(`检查完成！得分：${correctCount}/${total}（网络提交失败，请联系老师）`, 4000);
      if (btn) {
        btn.disabled = false;
        btn.textContent = "重新提交成绩";
      }
    }
  } else {
    showToast(`练习完成！答对：${correctCount}/${total}`, 4000);
  }
}

// 页面加载完成后启动
window.addEventListener('DOMContentLoaded', init);
