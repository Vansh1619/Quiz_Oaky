/* QuizOaky_Final.js
   Drop-in replacement.
   - Preserves all original strings and UI behavior.
   - Fixes: single-copy popup, robust collectResults(), clipboard fallback, anti-cheat (alt+tab visibility).
   - Do NOT add extra event listeners to copy buttons (avoids duplicate messages).
*/

(function() {
  'use strict';

  // --- App state (same names as original) ---
  let questions = [];
  let currentQuestionIndex = 0;
  let studentAnswers = {};
  let currentRole = null;
  let currentStudentName = null;
  let quizId = null;
  let collectedResults = [];
  let questionTimerInterval = null;
  let violationCount = 0;
  let isLocked = false;

  // constants
  const QUESTION_TIME = 60;

  // small helper
  const $ = id => document.getElementById(id);
  const safe = v => typeof v === 'string' ? v : (v == null ? '' : String(v));

  // showAlert: use your same messages (keeps original style)
  function showAlert(message, type) {
    // type strings used in HTML: 'success','warning','danger'
    try {
      const alertDiv = document.createElement('div');
      alertDiv.className = `alert alert-${type || 'success'}`;
      alertDiv.textContent = message;
      // insert at top of content (same as original)
      const content = document.querySelector('.content') || document.body;
      content.insertBefore(alertDiv, content.firstChild);
      setTimeout(() => { try { alertDiv.remove(); } catch (e) {} }, 4000);
    } catch (e) {
      // fallback
      try { alert(message); } catch (err) { console.log(message); }
    }
  }

  // --- Storage helpers (same keys) ---
  function saveQuizData() {
    if (!quizId) quizId = 'QUIZ_' + Date.now();
    try {
      localStorage.setItem('quiz_questions', JSON.stringify(questions));
      localStorage.setItem('quiz_id', quizId);
    } catch (e) {}
  }

  function loadTeacherData() {
    try {
      const savedQuestions = localStorage.getItem('quiz_questions');
      const savedQuizId = localStorage.getItem('quiz_id');
      const savedResults = localStorage.getItem('collected_results');

      if (savedQuestions) questions = JSON.parse(savedQuestions);
      if (savedQuizId) quizId = savedQuizId;
      if (savedResults) collectedResults = JSON.parse(savedResults);

      loadQuestions();
      updateShareLink();
      displayCollectedResults();
    } catch (e) {
      console.error('loadTeacherData error', e);
    }
  }

  // --- Question management (keeps original UI text exactly) ---
  function loadQuestions() {
    const questionsList = $('questionsList');
    const questionCount = $('questionCount');

    if (questionCount) questionCount.textContent = questions.length;
    if (!questionsList) return;

    questionsList.innerHTML = '';

    if (questions.length === 0) {
      questionsList.innerHTML = '<p style="text-align: center; color: #666; padding: 20px;">No questions created yet. Add your first question above!</p>';
      return;
    }

    questions.forEach((q, index) => {
      const questionDiv = document.createElement('div');
      questionDiv.className = 'question-item';
      questionDiv.innerHTML = `
        <div class="question-text">${index + 1}. ${escapeHtml(q.question)}</div>
        <div class="options-list">
          ${q.options.map((option, optIndex) =>
            `<div class="option-display ${optIndex === q.correctAnswer ? 'correct-option' : ''}">${String.fromCharCode(65 + optIndex)}. ${escapeHtml(option)}</div>`
          ).join('')}
        </div>
        <button class="btn btn-danger" data-id="${q.id}">🗑️ Delete</button>
      `;
      questionsList.appendChild(questionDiv);
      const delBtn = questionDiv.querySelector('button[data-id]');
      if (delBtn) delBtn.addEventListener('click', () => {
        if (confirm('Are you sure you want to delete this question?')) {
          questions = questions.filter(x => x.id !== q.id);
          saveQuizData();
          loadQuestions();
          updateShareLink();
          showAlert('Question deleted successfully!', 'success');
        }
      });
    });
  }

  function clearAllQuestions() {
    if (confirm('Are you sure you want to delete ALL questions? This cannot be undone!')) {
      questions = [];
      saveQuizData();
      loadQuestions();
      updateShareLink();
      showAlert('All questions cleared!', 'success');
    }
  }

  // --- Share link (keeps original message strings) ---
  function updateShareLink() {
    const shareSection = $('shareSection');
    const quizLinkElement = $('quizLink');
    const displayQuizIdElement = $('displayQuizId');

    if (!quizLinkElement) return;

    if (questions.length > 0) {
      if (shareSection) shareSection.style.display = 'block';

      if (!quizId) {
        quizId = 'QUIZ_' + Date.now();
        try { localStorage.setItem('quiz_id', quizId); } catch (e) {}
      }

      if (displayQuizIdElement) displayQuizIdElement.textContent = quizId;

      const quizData = { id: quizId, questions: questions, version: '7.0' };
      try {
        const encoded = btoa(JSON.stringify(quizData));
        // use encodeURIComponent to be safe
        const safe = encodeURIComponent(encoded);
        const currentUrl = window.location.href.split('#')[0];
        const quizLink = `${currentUrl}#quiz=${safe}`;
        quizLinkElement.textContent = quizLink;
      } catch (e) {
        quizLinkElement.textContent = 'Generating quiz link...';
      }
    } else {
      if (shareSection) shareSection.style.display = 'none';
      quizLinkElement.textContent = 'Generating quiz link...';
    }
  }

  // --- Export questions (unchanged text) ---
  function exportQuestions() {
    if (questions.length === 0) {
      showAlert('No questions to export!', 'warning');
      return;
    }

    try {
      const data = [
        ['Quiz ID', quizId || 'Not generated', '', '', '', ''],
        ['Question', 'Option A', 'Option B', 'Option C', 'Option D', 'Correct Answer']
      ];

      questions.forEach(q => {
        data.push([q.question, ...q.options, q.options[q.correctAnswer]]);
      });

      const worksheet = XLSX.utils.aoa_to_sheet(data);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, "Questions");
      XLSX.writeFile(workbook, `Quiz_Questions_${quizId || 'EXPORT'}_${new Date().toISOString().split('T')[0]}.xlsx`);
    } catch (e) {
      console.error('exportQuestions failed', e);
      showAlert('Export failed!', 'warning');
    }
  }

  // -------------------------
  // Robust result-decoding helpers
  // -------------------------
  function extractResultPayloadFromText(text) {
    if (!text) return null;
    text = text.trim();
    if (text.startsWith('<') && text.endsWith('>')) text = text.slice(1, -1).trim();
    const m = text.match(/#result=([^"'<>\s]+)/);
    if (m && m[1]) return m[1];
    const hrefMatch = text.match(/href=["']([^"']+)["']/);
    if (hrefMatch && hrefMatch[1]) {
      const mm = hrefMatch[1].match(/#result=([^"&\s]+)/);
      if (mm && mm[1]) return mm[1];
    }
    const base64like = text.match(/([A-Za-z0-9\-_=%]{8,})/);
    if (base64like) return base64like[1];
    return null;
  }

  function fixUrlSafeBase64(s) {
    let str = s.replace(/-/g, '+').replace(/_/g, '/');
    const pad = str.length % 4;
    if (pad === 2) str += '==';
    else if (pad === 3) str += '=';
    else if (pad === 1) str += '===';
    return str;
  }

  function tryDecodeBase64ToJson(payload) {
    if (!payload) return null;
    const attempts = [
      p => { try { return JSON.parse(atob(p)); } catch (e) { return null; } },
      p => { try { return JSON.parse(atob(decodeURIComponent(p))); } catch (e) { return null; } },
      p => { try { return JSON.parse(atob(p.replace(/\s+/g, ''))); } catch (e) { return null; } },
      p => { try { return JSON.parse(atob(fixUrlSafeBase64(p))); } catch (e) { return null; } },
      p => { try { return JSON.parse(atob(fixUrlSafeBase64(decodeURIComponent(p)))); } catch (e) { return null; } }
    ];
    for (let fn of attempts) {
      try {
        const res = fn(payload);
        if (res) return res;
      } catch (e) {}
    }
    return null;
  }

  function decodeResultFromUrl(text) {
    try {
      const encoded = extractResultPayloadFromText(text);
      if (!encoded) return null;
      const parsed = tryDecodeBase64ToJson(encoded);
      return parsed;
    } catch (e) {
      return null;
    }
  }

  // -------------------------
  // collectResults(): improved but preserves original messages
  // -------------------------
  async function collectResults() {
    // Try textarea first
    let raw = '';
    const ta = $('resultUrls');
    if (ta) raw = safe(ta.value).trim();

    // If textarea is empty, try clipboard (browser permission required)
    if ((!raw || raw.length === 0) && navigator.clipboard && navigator.clipboard.readText) {
      try {
        const clip = await navigator.clipboard.readText();
        if (clip && clip.trim().length > 0) {
          raw = clip.trim();
          // Also put it in textarea for teacher visibility
          if (ta) ta.value = raw;
        }
      } catch (err) {
        // permission blocked — ignore silently
      }
    }

    // strip zero-width and invisible characters
    raw = raw.replace(/[\u200B-\u200D\uFEFF]/g, '').trim();

    if (!raw) {
      showAlert('Please paste student result links!', 'warning');
      return;
    }

    const urls = raw.split(/\r?\n|,|;/).map(s => s.trim()).filter(Boolean);
    let successCount = 0;
    let errorCount = 0;

    urls.forEach(url => {
      try {
        const result = decodeResultFromUrl(url);
        if (result && result.studentName && result.quizId) {
          const existingIndex = collectedResults.findIndex(r =>
            r.studentName === result.studentName && r.quizId === result.quizId
          );

          if (existingIndex >= 0) {
            collectedResults[existingIndex] = result;
          } else {
            collectedResults.push(result);
          }
          successCount++;
        } else {
          errorCount++;
        }
      } catch (error) {
        errorCount++;
      }
    });

    try { localStorage.setItem('collected_results', JSON.stringify(collectedResults)); } catch (e) {}

    displayCollectedResults();

    if (successCount > 0) {
      showAlert(`✅ Successfully collected ${successCount} student results!`, 'success');
    }
    if (errorCount > 0) {
      showAlert(`⚠️ ${errorCount} links were invalid or couldn't be processed.`, 'warning');
    }

    if (ta) ta.value = '';
  }

  function displayCollectedResults() {
    const resultsList = $('collectedResultsList');
    if (!resultsList) return;
    resultsList.innerHTML = '';

    if (!collectedResults || collectedResults.length === 0) {
      resultsList.innerHTML = '<p style="text-align: center; color: #666; padding: 20px;">No results collected yet. Results will appear here when you paste student result links above.</p>';
      return;
    }

    collectedResults.forEach((result, index) => {
      const resultDiv = document.createElement('div');
      resultDiv.className = 'result-item';
      const percentage = Math.round((result.score / result.totalQuestions) * 100);
      resultDiv.innerHTML = `
        <div class="student-result">
            <div class="name">${index + 1}. ${escapeHtml(result.studentName)}</div>
            <div class="score">Score: ${result.score}/${result.totalQuestions} (${percentage}%)</div>
            <div class="date">Completed: ${new Date(result.completedAt).toLocaleString()}</div>
        </div>
      `;
      resultsList.appendChild(resultDiv);
    });
  }

  function downloadAllResults() {
    if (!collectedResults || collectedResults.length === 0) {
      showAlert('No student results collected yet! Ask students to share their result links with you.', 'warning');
      return;
    }

    try {
      const data = [
        ['Quiz ID', quizId || 'Unknown', '', '', ''],
        ['Export Date', new Date().toLocaleString(), '', '', ''],
        ['Student Name', 'Score', 'Total Questions', 'Percentage', 'Completed At']
      ];

      collectedResults.forEach(result => {
        const percentage = Math.round((result.score / result.totalQuestions) * 100);
        data.push([
          result.studentName,
          result.score,
          result.totalQuestions,
          `${percentage}%`,
          new Date(result.completedAt).toLocaleString()
        ]);
      });

      const totalStudents = collectedResults.length;
      const averageScore = collectedResults.reduce((sum, r) => sum + r.score, 0) / totalStudents;
      const averagePercentage = Math.round((averageScore / (questions.length || 1)) * 100);

      data.push([]);
      data.push(['Summary Statistics', '', '', '', '']);
      data.push(['Total Students', totalStudents, '', '', '']);
      data.push(['Average Score', averageScore.toFixed(1), questions.length, `${averagePercentage}%`, '']);
      data.push(['Highest Score', Math.max(...collectedResults.map(r => r.score)), questions.length, '', '']);
      data.push(['Lowest Score', Math.min(...collectedResults.map(r => r.score)), questions.length, '', '']);

      const worksheet = XLSX.utils.aoa_to_sheet(data);
      const workbook = XLSX.utils.book_new();
      worksheet['!cols'] = [{wch: 25}, {wch: 10}, {wch: 15}, {wch: 15}, {wch: 20}];

      XLSX.utils.book_append_sheet(workbook, worksheet, "Student Results");
      XLSX.writeFile(workbook, `ALL_STUDENT_RESULTS_${quizId || 'QUIZ'}_${new Date().toISOString().split('T')[0]}.xlsx`);

      showAlert('Excel file downloaded successfully!', 'success');
    } catch (e) {
      console.error('downloadAllResults error', e);
      showAlert('Failed to download Excel', 'warning');
    }
  }

  function clearCollectedResults() {
    if (confirm('Are you sure you want to clear all collected results?')) {
      collectedResults = [];
      try { localStorage.removeItem('collected_results'); } catch (e) {}
      displayCollectedResults();
      showAlert('All collected results cleared!', 'success');
    }
  }

  // --- Student join & quiz functions (keeps original messages) ---
  function joinQuiz() {
    const studentName = $('studentName') ? $('studentName').value.trim() : '';
    const joinInput = $('joinCode') ? $('joinCode').value.trim() : '';

    if (!studentName) { showAlert('Please enter your name!', 'warning'); return; }
    if (!joinInput) { showAlert('Please paste the quiz link!', 'warning'); return; }

    if (joinInput.includes('#quiz=')) {
      try {
        const hashIndex = joinInput.indexOf('#quiz=');
        const encodedData = joinInput.substring(hashIndex + 6);

        const quizData = JSON.parse(atob(decodeURIComponent(encodedData)));

        if (quizData.questions && quizData.questions.length > 0) {
          questions = quizData.questions;
          quizId = quizData.id;
          currentStudentName = studentName;

          if ($('roleSelection')) $('roleSelection').style.display = 'none';
          if ($('studentJoin')) $('studentJoin').style.display = 'none';
          if ($('studentPanel')) $('studentPanel').style.display = 'block';
          if ($('currentStudentName')) $('currentStudentName').textContent = studentName;
          if ($('studentQuizId')) $('studentQuizId').textContent = quizId;
          initializeStudentPanel();
          showAlert(`✅ Welcome ${studentName}! Quiz loaded successfully!`, 'success');
          return;
        }
      } catch (error) {
        showAlert('❌ Invalid quiz link. Please check with your teacher.', 'danger');
        return;
      }
    }

    showAlert('❌ Invalid quiz link format. Please paste the complete link from your teacher.', 'danger');
  }

  function initializeStudentPanel() {
    const quizInfo = $('quizInfo');
    const startQuizBtn = $('startQuizBtn');

    if (!questions || questions.length === 0) {
      if (quizInfo) quizInfo.innerHTML = `<div class="alert alert-warning">⚠️ No questions available! Please check the quiz link.</div>`;
      if (startQuizBtn) startQuizBtn.disabled = true;
    } else {
      if (quizInfo) quizInfo.innerHTML = `
          <div class="alert alert-success">✅ Quiz loaded! There are <strong>${questions.length}</strong> questions waiting for you.</div>
          <p><strong>Instructions:</strong></p>
          <ul style="text-align: left; margin: 15px 0; padding-left: 20px;">
              <li>Each question has a <strong>1 minute timer</strong>.</li>
              <li>The quiz will automatically move to the next question if time runs out.</li>
              <li><strong>Do not switch tabs or windows</strong>, or the quiz will be blurred.</li>
              <li>After completing, share the result link with your teacher!</li>
          </ul>
      `;
      if (startQuizBtn) startQuizBtn.disabled = false;
    }
  }

  // --- Privacy & Timer Functions (stronger: lock after 2-3 violations) ---
  function handleScreenshotAttempt(e) {
    if (isLocked) return;
    if (e.key === 'PrintScreen' || (e.ctrlKey && e.shiftKey) || (e.metaKey && e.shiftKey)) {
      // treat as screenshot attempt
      violationCount++;
      showAlert('Screenshots are disabled during the quiz.', 'danger');
      escalateViolation();
    }
  }

  function disableContextMenu(e) {
    e.preventDefault();
    showAlert('Right-clicking is disabled during the quiz.', 'danger');
  }

  function handleVisibilityChange() {
    const quizInterface = $('quizInterface');
    // If tab hidden or window blurred, count violation
    if (document.hidden || !document.hasFocus()) {
      violationCount++;
      if (quizInterface) quizInterface.classList.add('blurred');
      showAlert('Please stay on the quiz page.', 'warning');
      escalateViolation();
    } else {
      // regained focus
      if (quizInterface) quizInterface.classList.remove('blurred');
    }
  }

  function escalateViolation() {
    if (violationCount >= 3) {
      // lock and auto-submit
      lockQuizAndSubmit();
    } else if (violationCount === 2) {
      // stricter: block UI briefly
      const quizInterface = $('quizInterface');
      if (quizInterface) quizInterface.classList.add('blurred');
      showAlert('Second violation: quiz temporarily disabled', 'danger');
      setTimeout(() => { if (quizInterface) quizInterface.classList.remove('blurred'); }, 2000);
    } else {
      // first violation warning already shown
    }
  }

  function lockQuizAndSubmit() {
    isLocked = true;
    // remove listeners to avoid repeat actions
    try {
      window.removeEventListener('contextmenu', disableContextMenu);
      window.removeEventListener('keyup', handleScreenshotAttempt);
      window.removeEventListener('blur', handleVisibilityChange);
      window.removeEventListener('focus', handleVisibilityChange);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    } catch (e) {}
    showAlert('Too many violations: quiz locked and auto-submitted', 'danger');
    // auto-submit (finish)
    finishQuiz();
  }

  function startQuestionTimer() {
    let timeLeft = QUESTION_TIME;
    const timerElement = $('questionTimer');
    if (!timerElement) return;
    timerElement.textContent = timeLeft;
    questionTimerInterval = setInterval(() => {
      timeLeft--;
      timerElement.textContent = timeLeft;
      if (timeLeft <= 0) {
        clearInterval(questionTimerInterval);
        nextQuestion();
      }
    }, 1000);
  }

  // --- start quiz (wires original inline messages) ---
  function startQuiz() {
    // show/hide
    $('quizStart').style.display = 'none';
    $('quizInterface').style.display = 'block';
    currentQuestionIndex = 0;
    studentAnswers = {};

    // privacy listeners
    window.addEventListener('contextmenu', disableContextMenu);
    window.addEventListener('keyup', handleScreenshotAttempt);
    window.addEventListener('blur', handleVisibilityChange);
    window.addEventListener('focus', handleVisibilityChange);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    const quizInterfaceEl = $('quizInterface');
    if (quizInterfaceEl) quizInterfaceEl.classList.add('secure-content');

    showCurrentQuestion();
  }

  function showCurrentQuestion() {
    if (questions.length === 0) return;

    clearInterval(questionTimerInterval);

    const question = questions[currentQuestionIndex];
    const currentQuestionDiv = $('currentQuestion');

    currentQuestionDiv.innerHTML = `
      <div class="timer-container">Time Left: <span id="questionTimer">60</span>s</div>
      <div class="question-number">Question ${currentQuestionIndex + 1} of ${questions.length}</div>
      <div class="question">${escapeHtml(question.question)}</div>
      <div class="quiz-options">
          ${question.options.map((option, index) => `
              <div class="quiz-option" data-index="${index}">
                  ${String.fromCharCode(65 + index)}. ${escapeHtml(option)}
              </div>
          `).join('')}
      </div>
    `;

    // attach click handlers to options (local)
    const optionElements = currentQuestionDiv.querySelectorAll('.quiz-option');
    optionElements.forEach((optionEl) => {
      optionEl.addEventListener('click', function() {
        if (isLocked) return;
        const idx = parseInt(this.getAttribute('data-index'), 10);
        studentAnswers[currentQuestionIndex] = idx;
        optionElements.forEach((op, i) => op.classList.toggle('selected', i === idx));
      });
    });

    startQuestionTimer();
    updateProgress();
    updateNavigationButtons();
    if ($('nextBtn')) $('nextBtn').disabled = false;
  }

  function selectAnswer(optionIndex) {
    // Keep this function for compatibility if HTML calls it (but our options use local handlers)
    studentAnswers[currentQuestionIndex] = optionIndex;
    const optionElements = document.querySelectorAll('.quiz-option');
    optionElements.forEach((option, index) => {
      option.classList.toggle('selected', index === optionIndex);
    });
  }
  // expose selectAnswer globally to match original inline usage
  window.selectAnswer = selectAnswer;

  function updateProgress() {
    const progress = ((currentQuestionIndex + 1) / (questions.length || 1)) * 100;
    const bar = $('progressBar');
    if (bar) bar.style.width = progress + '%';
  }

  function updateNavigationButtons() {
    const nextBtn = $('nextBtn');
    if (nextBtn) nextBtn.textContent = currentQuestionIndex === questions.length - 1 ? 'Finish Quiz' : 'Next';
  }

  function nextQuestion() {
    clearInterval(questionTimerInterval);
    const userAnswerIndex = studentAnswers[currentQuestionIndex];
    const correctIndex = questions[currentQuestionIndex].correctAnswer;

    const optionElements = document.querySelectorAll('.quiz-option');
    const optionsContainer = document.querySelector('.quiz-options');
    if (optionsContainer) optionsContainer.classList.add('answered');

    if (userAnswerIndex === undefined) {
      showAlert('Time is up! Here is the correct answer.', 'warning');
      if (optionElements[correctIndex]) optionElements[correctIndex].classList.add('correct');
    } else {
      if (optionElements[correctIndex]) optionElements[correctIndex].classList.add('correct');
      if (userAnswerIndex !== correctIndex && optionElements[userAnswerIndex]) {
        optionElements[userAnswerIndex].classList.add('wrong');
      }
    }

    // move on after delay
    setTimeout(() => {
      if (currentQuestionIndex < questions.length - 1) {
        currentQuestionIndex++;
        showCurrentQuestion();
      } else {
        finishQuiz();
      }
    }, 2500);
  }

  function finishQuiz() {
    clearInterval(questionTimerInterval);

    try {
      window.removeEventListener('contextmenu', disableContextMenu);
      window.removeEventListener('keyup', handleScreenshotAttempt);
      window.removeEventListener('blur', handleVisibilityChange);
      window.removeEventListener('focus', handleVisibilityChange);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    } catch (e) {}

    const quizInterface = $('quizInterface');
    if (quizInterface) { quizInterface.classList.remove('secure-content', 'blurred'); }
    if (quizInterface) quizInterface.style.display = 'none';
    if ($('results')) $('results').style.display = 'block';

    calculateResults();
    generateResultUrl();
  }

  function calculateResults() {
    let score = 0;
    const totalQuestions = questions.length;

    for (let i = 0; i < totalQuestions; i++) {
      if (studentAnswers[i] === questions[i].correctAnswer) score++;
    }

    if ($('scoreCircle')) $('scoreCircle').textContent = `${score}/${totalQuestions}`;

    const percentage = Math.round((score / (totalQuestions || 1)) * 100);
    let title, message;

    if (percentage === 100) {
      title = "Perfect Score! 🎉";
      message = "Excellent! You got all questions right!";
    } else if (percentage >= 80) {
      title = "Great Job! 👏";
      message = `Very good! You scored ${percentage}%!`;
    } else if (percentage >= 60) {
      title = "Good Work! 👍";
      message = `Not bad! You scored ${percentage}%. Keep learning!`;
    } else {
      title = "Keep Learning! 📚";
      message = `You scored ${percentage}%. Don't worry, practice makes perfect!`;
    }

    if ($('resultTitle')) $('resultTitle').textContent = title;
    if ($('resultMessage')) $('resultMessage').textContent = message;
  }

  function generateResultUrl() {
    let score = 0;
    for (let i = 0; i < questions.length; i++) {
      if (studentAnswers[i] === questions[i].correctAnswer) score++;
    }

    const result = {
      studentName: currentStudentName,
      quizId: quizId,
      score: score,
      totalQuestions: questions.length,
      answers: studentAnswers,
      completedAt: new Date().toISOString()
    };

    try {
      const encodedResult = btoa(JSON.stringify(result));
      const currentUrl = window.location.href.split('#')[0];
      const resultUrl = `${currentUrl}#result=${encodeURIComponent(encodedResult)}`;

      const resultEl = $('resultUrl');
      if (resultEl) {
        resultEl.textContent = resultUrl;
        resultEl.setAttribute('data-result', resultUrl);
      }
    } catch (e) {
      console.error('generateResultUrl error', e);
    }
  }

  // COPY functions — ensure single popup per click (no duplicates)
  function copyQuizLink() {
    const quizLink = $('quizLink') ? $('quizLink').textContent : '';
    if (!quizLink) {
      showAlert('No quiz link available to copy!', 'warning');
      return;
    }

    // original message exactly as you had
    const teacherMessage = '📋 Quiz link copied! Share this with your students. They will send you result links after completing the quiz.';

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(quizLink).then(() => {
        showAlert(teacherMessage, 'success');
      }).catch(() => {
        // fallback
        fallbackCopy(quizLink);
        showAlert(teacherMessage, 'success');
      });
    } else {
      fallbackCopy(quizLink);
      showAlert(teacherMessage, 'success');
    }
  }

  function copyResultUrl() {
    const resultEl = $('resultUrl');
    if (!resultEl) {
      showAlert('No result link found to copy', 'warning');
      return;
    }
    let link = resultEl.getAttribute('data-result') || resultEl.textContent || '';
    link = link.trim();
    if (!link) { showAlert('No result link found to copy', 'warning'); return; }

    const studentMessage = '📋 Result link copied! Share this with your teacher so they can include your score in the Excel file.';

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(link).then(() => {
        showAlert(studentMessage, 'success');
      }).catch(() => {
        fallbackCopy(link);
        showAlert(studentMessage, 'success');
      });
    } else {
      fallbackCopy(link);
      showAlert(studentMessage, 'success');
    }
  }

  function fallbackCopy(text) {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    } catch (e) {
      console.error('fallbackCopy failed', e);
    }
  }

  // DOWNLOAD student results (same messages)
  function downloadResults() {
    try {
      const data = [
        ['Student Name', currentStudentName, '', ''],
        ['Quiz ID', quizId || 'Unknown', '', ''],
        ['Question', 'Your Answer', 'Correct Answer', 'Result']
      ];

      questions.forEach((question, index) => {
        const userAnswer = studentAnswers[index] !== undefined ? question.options[studentAnswers[index]] : 'Not answered';
        const correctAnswer = question.options[question.correctAnswer];
        const isCorrect = studentAnswers[index] === question.correctAnswer ? '✓ Correct' : '✗ Wrong';

        data.push([
          question.question,
          userAnswer,
          correctAnswer,
          isCorrect
        ]);
      });

      const score = Object.keys(studentAnswers).reduce((acc, key) => {
        return studentAnswers[key] === questions[key].correctAnswer ? acc + 1 : acc;
      }, 0);

      data.push([]);
      data.push(['Total Score', `${score}/${questions.length}`, '', `${Math.round((score/questions.length)*100)}%`]);
      data.push(['Date Taken', new Date().toLocaleString(), '', '']);

      const worksheet = XLSX.utils.aoa_to_sheet(data);
      const workbook = XLSX.utils.book_new();
      worksheet['!cols'] = [{wch: 50}, {wch: 20}, {wch: 20}, {wch: 15}];

      XLSX.utils.book_append_sheet(workbook, worksheet, "My Results");
      XLSX.writeFile(workbook, `${currentStudentName || 'student'}_Quiz_Results_${new Date().toISOString().split('T')[0]}.xlsx`);
    } catch (e) {
      console.error('downloadResults error', e);
      showAlert('Failed to download results', 'warning');
    }
  }

  function retakeQuiz() {
    if ($('results')) $('results').style.display = 'none';
    if ($('quizStart')) $('quizStart').style.display = 'block';
    studentAnswers = {};
    currentQuestionIndex = 0;
    initializeStudentPanel();
  }

  // small util to escape HTML
  function escapeHtml(unsafe) {
    return safe(unsafe)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  // --- init on load: only what is necessary, do NOT add duplicate listeners for copy buttons ---
  window.addEventListener('load', function() {
    try {
      // load saved data
      const savedQuestions = localStorage.getItem('quiz_questions');
      const savedQuizId = localStorage.getItem('quiz_id');
      const savedResults = localStorage.getItem('collected_results');
      if (savedQuestions) questions = JSON.parse(savedQuestions);
      if (savedQuizId) quizId = savedQuizId;
      if (savedResults) collectedResults = JSON.parse(savedResults);

      loadQuestions();
      updateShareLink();
      displayCollectedResults();

      // wire up the question form (original inline used addEventListener in your file)
      const qform = $('questionForm');
      if (qform) {
        qform.addEventListener('submit', function(e) {
          e.preventDefault();
          const questionText = $('questionText').value.trim();
          const option1 = $('optionText0').value.trim();
          const option2 = $('optionText1').value.trim();
          const option3 = $('optionText2').value.trim();
          const option4 = $('optionText3').value.trim();
          const chosen = document.querySelector('input[name="correctOption"]:checked');
          if (!chosen) { showAlert('Please select correct option', 'warning'); return; }
          const correctOptionIndex = parseInt(chosen.value);
          const options = [option1, option2, option3, option4];

          if (questionText && options.every(o => o)) {
            const newQuestion = {
              id: Date.now(),
              question: questionText,
              options: options,
              correctAnswer: correctOptionIndex
            };
            questions.push(newQuestion);
            saveQuizData();
            loadQuestions();
            updateShareLink();
            qform.reset();
            showAlert('Question added successfully!', 'success');
          } else {
            showAlert('Please fill all fields!', 'warning');
          }
        });
      }

      // If page loads with #quiz= then prefill joinCode like original
      const hash = window.location.hash;
      if (hash && hash.includes('#quiz=')) {
        if ($('roleSelection')) $('roleSelection').style.display = 'none';
        if ($('studentJoin')) $('studentJoin').style.display = 'block';
        if ($('joinCode')) $('joinCode').value = window.location.href;
      }
    } catch (e) {
      console.error('init error', e);
    }
  });

  // --- Expose functions used inline in your HTML exactly (no name changes) ---
  window.selectRole = function(role) {
    currentRole = role;
    if ($('roleSelection')) $('roleSelection').style.display = 'none';
    if (role === 'teacher') {
      if ($('teacherPanel')) $('teacherPanel').style.display = 'block';
      loadTeacherData();
    } else {
      if ($('studentJoin')) $('studentJoin').style.display = 'block';
    }
  };

  window.goHome = function() {
    if ($('roleSelection')) $('roleSelection').style.display = 'block';
    if ($('teacherPanel')) $('teacherPanel').style.display = 'none';
    if ($('studentJoin')) $('studentJoin').style.display = 'none';
    if ($('studentPanel')) $('studentPanel').style.display = 'none';
    if ($('quizInterface')) $('quizInterface').style.display = 'none';
    if ($('results')) $('results').style.display = 'none';
    currentRole = null;
    questions = [];
    currentStudentName = null;
    quizId = null;
  };

  window.goBackToJoin = function() {
    if ($('studentPanel')) $('studentPanel').style.display = 'none';
    if ($('studentJoin')) $('studentJoin').style.display = 'block';
    if ($('quizInterface')) $('quizInterface').style.display = 'none';
    if ($('results')) $('results').style.display = 'none';
    if ($('quizStart')) $('quizStart').style.display = 'block';
  };

  window.generateNewQuiz = function() {
    if (confirm('This will create a new quiz and clear existing questions and results. Continue?')) {
      questions = [];
      quizId = 'QUIZ_' + Date.now();
      collectedResults = [];
      try {
        localStorage.removeItem('quiz_questions');
        localStorage.removeItem('quiz_id');
        localStorage.removeItem('collected_results');
      } catch (e) {}
      try { localStorage.setItem('quiz_id', quizId); } catch (e) {}
      loadQuestions();
      updateShareLink();
      displayCollectedResults();
      showAlert('New quiz created! Add questions to generate shareable link.', 'success');
    }
  };

  // expose other functions (same names as original so HTML inline onclicks keep working)
  window.copyQuizLink = copyQuizLink;
  window.exportQuestions = exportQuestions;
  window.collectResults = collectResults;
  window.generateNewQuiz = window.generateNewQuiz;
  window.loadQuestions = loadQuestions;
  window.downloadAllResults = downloadAllResults;
  window.clearCollectedResults = clearCollectedResults;
  window.joinQuiz = joinQuiz;
  window.startQuiz = startQuiz;
  window.nextQuestion = nextQuestion;
  window.copyResultUrl = copyResultUrl;
  window.downloadResults = downloadResults;
  window.retakeQuiz = retakeQuiz;
  window.deleteQuestion = function(id){ /* unused: delete handled in list generation */ };

})();
