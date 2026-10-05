let questionsData = [];
let googleSheetWebhookUrl = "";
let selectedChipForSwap = null;
let startTime = Date.now();

// 浮层提示信息
function showToast(msg, duration = 3000) {
  const toast = document.getElementById('status-toast');
  toast.textContent = msg;
  toast.style.display = 'block';
  setTimeout(() => {
    toast.style.display = 'none';
  }, duration);
}

// 页面初始化入口：智能判断是否带有教师专属链接
async function init() {
  startTime = Date.now();

  // 1. 检查网址 Hash 是否含有教师生成的 #data= 压缩参数
  const hash = window.location.hash;
  let customData = null;

  if (hash && hash.includes('data=')) {
    try {
      const encoded = hash.split('data=')[1];
      const decompressed = LZString.decompressFromEncodedURIComponent(encoded);
      if (decompressed) {
        customData = JSON.parse(decompressed);
      }
    } catch (e) {
      console.warn("解析自定义数据失败，降级回退到默认 txt 文件:", e);
    }
  }

  // 2. 如果是专属链接，使用同事自定义的数据；否则读取根目录的默认 txt
  if (customData) {
    googleSheetWebhookUrl = customData.w || "";
    renderStudentNames(customData.n || "");
    parseAndRenderSentences(customData.s || "");
  } else {
    await loadWebhookUrl();
    await loadStudentNames();
    await loadSentences();
  }
}

// 辅助函数：根据换行文本渲染姓名下拉菜单
function renderStudentNames(rawText) {
  const select = document.getElementById('student-select');
  select.innerHTML = '<option value="">-- 请选择姓名 --</option>';
  const names = rawText.split('\n').map(n => n.trim()).filter(Boolean);
  names.forEach(name => {
    const opt = document.createElement('option');
    opt.value = name;
    opt.textContent = name;
    select.appendChild(opt);
  });
}

// 1. 读取 score.txt 获取 Google Sheet Webhook 链接 (默认模式)
async function loadWebhookUrl() {
  try {
    const res = await fetch(`./score.txt?t=${Date.now()}`);
    if (res.ok) {
      const text = await res.text();
      googleSheetWebhookUrl = text.trim();
    }
  } catch (e) {
    console.warn("未能读取到 score.txt，将仅在前端做正误核对。");
  }
}

// 2. 读取 namelist.txt 获取学生名单 (默认模式)
async function loadStudentNames() {
  try {
    const res = await fetch(`./namelist.txt?t=${Date.now()}`);
    if (res.ok) {
      const text = await res.text();
      renderStudentNames(text);
    }
  } catch (e) {
    console.error("加载名单失败:", e);
  }
}

// 3. 读取 sentences.txt 并解析渲染题目 (默认模式)
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

// 解析句子格式并渲染卡片
function parseAndRenderSentences(rawText) {
  const lines = rawText.split('\n').map(l => l.trim()).filter(Boolean);
  questionsData = [];
  const listContainer = document.getElementById('questions-list');
  listContainer.innerHTML = '';

  lines.forEach((line, idx) => {
    // 匹配行首题号（如 "1. " 或 "1、"）
    let numStr = (idx + 1) + ".";
    let rest = line;
    const numMatch = line.match(/^(\d+[\.、\s])\s*/);
    if (numMatch) {
      numStr = numMatch[1].trim();
      rest = line.substring(numMatch[0].length).trim();
    }

    // 分割词语与标点符号
    const tokens = rest.split(/\s+/).filter(Boolean);
    if (tokens.length === 0) return;

    let punct = "。";
    const lastToken = tokens[tokens.length - 1];
    if (/^[。？！?!,，、]$/.test(lastToken)) {
      punct = tokens.pop();
    }

    const correctWords = [...tokens];
    const shuffledWords = shuffleArray([...tokens]);

    questionsData.push({
      id: idx,
      number: numStr,
      correctOrder: correctWords,
      punctuation: punct
    });

    // 渲染题目结构
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
          ${shuffledWords.map(w => `<div class="word-chip" data-word="${w}">${w}</div>`).join('')}
        </div>
        <div class="punctuation-badge">${punct}</div>
      </div>
    `;
    listContainer.appendChild(card);

    // 启用 SortableJS 拖动排序
    const wordsEl = card.querySelector(`#words-container-${idx}`);
    new Sortable(wordsEl, {
      animation: 150,
      ghostClass: 'sortable-ghost',
      chosenClass: 'sortable-chosen'
    });

    // 点击互换监听（方便触屏/平板操作）
    wordsEl.addEventListener('click', (e) => {
      const chip = e.target.closest('.word-chip');
      if (!chip) return;
      handleChipTap(chip, wordsEl);
    });
  });
}

// Fisher-Yates 随机打乱算法
function shuffleArray(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// 点击两个词块进行对调
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

// 检查答案并提交成绩到 Google Sheet
async function submitExam() {
  const studentName = document.getElementById('student-select').value;
  if (!studentName) {
    alert("请先在页面右上角选择你的名字！");
    document.getElementById('student-select').focus();
    return;
  }

  let correctCount = 0;
  questionsData.forEach(q => {
    const card = document.getElementById(`q-card-${q.id}`);
    const badge = document.getElementById(`badge-${q.id}`);
    const container = document.getElementById(`words-container-${q.id}`);
    const currentWords = Array.from(container.children).map(c => c.dataset.word);

    const isCorrect = currentWords.join('') === q.correctOrder.join('');
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

  // 全对时触发烟花庆祝
  if (correctCount === total && total > 0) {
    confetti({ particleCount: 80, spread: 70, origin: { y: 0.6 } });
  }

  // 发送数据到对应的 Google Sheet Webhook
  if (googleSheetWebhookUrl) {
    const btn = document.getElementById('submit-btn');
    btn.disabled = true;
    btn.textContent = "正在提交成绩到教师表格...";

    // 使用已验证稳定的 URL 编码表单参数
    const formData = new URLSearchParams();
    formData.append('time', new Date().toLocaleString());
    formData.append('student', studentName);
    formData.append('total', total);
    formData.append('correct', correctCount);
    formData.append('duration', durationSec);
    formData.append('accuracy', accuracy);

    try {
      await fetch(googleSheetWebhookUrl, {
        method: 'POST',
        mode: 'no-cors',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: formData.toString()
      });

      showToast(`已提交！得分：${correctCount}/${total}，成绩已保存至教师表格。`, 4000);
      btn.textContent = "成绩已提交完成";
    } catch (err) {
      console.error("提交异常:", err);
      showToast(`检查完成！得分：${correctCount}/${total}（成绩上传异常，请联系老师）`, 4000);
      btn.disabled = false;
      btn.textContent = "重新提交成绩";
    }
  } else {
    showToast(`练习完成！答对：${correctCount}/${total}`, 4000);
  }
}

// 页面加载触发
window.addEventListener('DOMContentLoaded', init);
