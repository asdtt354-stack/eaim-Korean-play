// ══════════════════════════════════════════════════════════
// EAIM 활동 기록 시트 — Apps Script (v3: 이미지 드라이브 저장 포함)
// 1) doPost: 앱에서 보내는 활동 기록(+선택적 이미지)을 받아 저장
// 2) onOpen: 스프레드시트 메뉴에 "EAIM 도구" 추가
// 3) setGeminiKey: Gemini API 키를 안전하게 저장 (시트에 노출 안 됨)
// 4) generateAIComments: 학생별로 활동을 모아 생기부 참고 문구 자동 생성
// ══════════════════════════════════════════════════════════

const IMAGE_FOLDER_NAME = 'EAIM 활동 이미지';

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheets()[0];

    let imageUrl = '';
    if (data.image) {
      try {
        imageUrl = saveImageToDrive(data.image, data.name || '학생', data.title || '이미지');
      } catch (imgErr) {
        imageUrl = '(이미지 저장 실패)';
      }
    }

    sheet.appendRow([
      new Date(),
      data.name || '',
      data.group || '',
      data.app || '',
      data.activity || '',
      data.title || '',
      data.detail || '',
      imageUrl
    ]);

    return ContentService
      .createTextOutput(JSON.stringify({ result: 'success', imageUrl }))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ result: 'error', error: err.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// data:image/png;base64,.... 형태의 문자열을 받아 드라이브에 저장하고 공유 링크를 반환
function saveImageToDrive(dataUrl, name, title) {
  const match = String(dataUrl).match(/^data:(image\/\w+);base64,(.+)$/);
  if (!match) return '';
  const mimeType = match[1];
  const base64 = match[2];
  const bytes = Utilities.base64Decode(base64);

  const folders = DriveApp.getFoldersByName(IMAGE_FOLDER_NAME);
  const folder = folders.hasNext() ? folders.next() : DriveApp.createFolder(IMAGE_FOLDER_NAME);

  const safeTitle = String(title).replace(/[\\/:*?"<>|]/g, '').slice(0, 30);
  const ext = mimeType.split('/')[1] || 'png';
  const fileName = `${name}_${safeTitle}_${Date.now()}.${ext}`;

  const blob = Utilities.newBlob(bytes, mimeType, fileName);
  const file = folder.createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  return file.getUrl();
}

function testDoPost() {
  const fakeEvent = {
    postData: {
      contents: JSON.stringify({
        name: '테스트학생',
        group: '테스트반',
        app: '시 감상',
        activity: '완성',
        title: '테스트 제목',
        detail: '123자'
      })
    }
  };
  const result = doPost(fakeEvent);
  Logger.log(result.getContent());
}

// ── 스프레드시트를 열 때 메뉴 추가 ─────────────────────────
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('📋 EAIM 도구')
    .addItem('🔑 Gemini API 키 설정', 'setGeminiKey')
    .addSeparator()
    .addItem('🤖 AI 생기부 참고 문구 생성', 'generateAIComments')
    .addToUi();
}

function setGeminiKey() {
  const ui = SpreadsheetApp.getUi();
  const res = ui.prompt('Gemini API 키 입력', 'AIzaSy... 로 시작하는 키를 붙여넣어주세요.', ui.ButtonSet.OK_CANCEL);
  if (res.getSelectedButton() !== ui.Button.OK) return;
  const key = res.getResponseText().trim();
  if (!key) { ui.alert('키가 비어있어요.'); return; }
  PropertiesService.getScriptProperties().setProperty('GEMINI_API_KEY', key);
  ui.alert('✅ 저장됐어요!');
}

function generateAIComments() {
  const ui = SpreadsheetApp.getUi();
  const apiKey = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
  if (!apiKey) { ui.alert('먼저 "🔑 Gemini API 키 설정" 메뉴로 키를 등록해주세요.'); return; }

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const logSheet = ss.getSheets()[0];
  const lastRow = logSheet.getLastRow();
  if (lastRow < 2) { ui.alert('아직 기록된 활동이 없어요.'); return; }

  const rows = logSheet.getRange(2, 1, lastRow - 1, 7).getValues();
  const byStudent = {};
  rows.forEach(r => {
    const [ts, name, group, app, activity, title, detail] = r;
    if (!name) return;
    const key = name + '|||' + group;
    if (!byStudent[key]) byStudent[key] = { name, group, items: [] };
    const dateStr = (ts instanceof Date) ? Utilities.formatDate(ts, Session.getScriptTimeZone(), 'M/d') : String(ts);
    byStudent[key].items.push(`[${dateStr}] ${app} - ${activity}${title ? ' - ' + title : ''}${detail ? ' (' + detail + ')' : ''}`);
  });

  const students = Object.values(byStudent);
  if (students.length === 0) { ui.alert('학생 이름이 있는 활동이 없어요.'); return; }

  let summarySheet = ss.getSheetByName('학생별 요약');
  if (!summarySheet) summarySheet = ss.insertSheet('학생별 요약');
  else summarySheet.clear();
  summarySheet.getRange(1,1,1,5).setValues([['이름','반/모둠','활동 건수','AI 생기부 참고 문구','활동 상세 (원본)']]);
  summarySheet.getRange(1,1,1,5).setFontWeight('bold');

  ui.alert(`학생 ${students.length}명의 활동을 분석해서 문구를 생성해요...`);

  const outputRows = [];
  students.forEach(s => {
    let comment = '';
    try { comment = callGeminiForComment(apiKey, s.name, s.items); }
    catch (e) { comment = '(생성 실패: ' + e.toString() + ')'; }
    outputRows.push([s.name, s.group, s.items.length, comment, s.items.join('\n')]);
    Utilities.sleep(1200);
  });

  summarySheet.getRange(2,1,outputRows.length,5).setValues(outputRows);
  summarySheet.autoResizeColumns(1,5);
  summarySheet.setColumnWidth(4,420);
  summarySheet.setColumnWidth(5,300);
  ui.alert(`✅ 완료! "학생별 요약" 탭에서 확인하세요. (총 ${students.length}명)`);
}

function callGeminiForComment(apiKey, name, items) {
  const url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=' + apiKey;
  const prompt = `다음은 한 중학생이 국어 창작 플랫폼(시 감상·글쓰기·신문 만들기·어휘 게임)에서 수행한 활동 기록입니다.

학생 이름: ${name}
활동 내역:
${items.map(i => '- ' + i).join('\n')}

이 기록을 바탕으로, 생활기록부(교과세부능력 및 특기사항) 작성 시 교사가 참고할 수 있는 객관적인 서술형 문구를 한국어로 2~3문장, 150자 내외로 작성해주세요.
- 구체적인 활동명(시 감상, 글쓰기, 신문 제작 등)을 자연스럽게 포함하세요
- 과장하지 말고 사실 기반으로 담백하게 서술하세요
- "~함", "~보임" 같은 생기부 특유의 종결 어미를 사용하세요
- 문구만 출력하고 다른 설명은 붙이지 마세요`;

  const res = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.5, maxOutputTokens: 300, thinkingConfig: { thinkingBudget: 0 } }
    }),
    muteHttpExceptions: true
  });

  const data = JSON.parse(res.getContentText());
  if (data.error) throw new Error(data.error.message);
  const text = data.candidates && data.candidates[0] && data.candidates[0].content
    && data.candidates[0].content.parts && data.candidates[0].content.parts[0]
    ? data.candidates[0].content.parts[0].text : '';
  if (!text) throw new Error('빈 응답');
  return text.trim();
}
