/**
 * GA4 Daily Report to Slack with AI Analysis
 *
 * Setup:
 * 1. Google Apps Script (https://script.google.com) で新規プロジェクトを作成
 * 2. このコードを貼り付け
 * 3. スクリプトプロパティに以下を設定（設定 > スクリプトプロパティ）:
 *    - GA4_PROPERTY_ID: GA4のプロパティID（数字のみ、例: 123456789）
 *    - SLACK_WEBHOOK_URL: SlackのWebhook URL
 *    - CLAUDE_API_KEY: Anthropic APIキー
 * 4. Google Analytics Data API を有効化（サービス > Google Analytics Data API を追加）
 * 5. トリガーを設定: setupDailyTrigger() を一度実行（毎朝3:45に自動実行されるようになります）
 */

// ============================================================
// メイン関数
// ============================================================

function sendDailyReport() {
  const props = PropertiesService.getScriptProperties();
  const propertyId = props.getProperty('GA4_PROPERTY_ID');
  const slackWebhookUrl = props.getProperty('SLACK_WEBHOOK_URL');
  const claudeApiKey = props.getProperty('CLAUDE_API_KEY');

  if (!propertyId || !slackWebhookUrl) {
    throw new Error('GA4_PROPERTY_ID and SLACK_WEBHOOK_URL must be set in script properties');
  }

  // 日付の計算
  const today = new Date();
  const yesterday = getDateString(today, -1);
  const dayBefore = getDateString(today, -2);
  const sevenDaysAgo = getDateString(today, -7);

  // GA4データ取得
  const todayData = fetchGA4Data(propertyId, yesterday, yesterday);
  const prevData = fetchGA4Data(propertyId, dayBefore, dayBefore);
  const weekData = fetchGA4Data(propertyId, sevenDaysAgo, yesterday);

  // 集客詳細データ取得（source / medium 別）
  const acquisitionData = fetchAcquisitionDetail(propertyId, yesterday, yesterday);
  const prevAcquisitionData = fetchAcquisitionDetail(propertyId, dayBefore, dayBefore);

  // コンバージョンデータ取得（generate_lead イベント）
  const convData = fetchConversionData(propertyId, yesterday, yesterday);
  const prevConvData = fetchConversionData(propertyId, dayBefore, dayBefore);

  // レポート組み立て
  const report = buildReport(yesterday, todayData, prevData, weekData, acquisitionData, convData, prevConvData);

  // AI分析（Claude APIキーがあれば）
  var aiAnalysis = '';
  if (claudeApiKey) {
    aiAnalysis = getAIAnalysis(claudeApiKey, yesterday, todayData, prevData, weekData, acquisitionData, convData);
  } else {
    aiAnalysis = getRuleBasedAnalysis(todayData, prevData, convData);
  }

  // Slackに送信
  const message = report + '\n' + aiAnalysis;
  postToSlack(slackWebhookUrl, message);
}

// ============================================================
// トリガー設定（初回のみ実行）
// ============================================================

function setupDailyTrigger() {
  // 既存のsendDailyReportトリガーを削除
  var triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(function(trigger) {
    if (trigger.getHandlerFunction() === 'sendDailyReport') {
      ScriptApp.deleteTrigger(trigger);
    }
  });

  // 毎日3:45頃に実行するトリガーを作成
  ScriptApp.newTrigger('sendDailyReport')
    .timeBased()
    .everyDays(1)
    .atHour(3)
    .nearMinute(45)
    .create();

  Logger.log('トリガーを設定しました: 毎日 3:45 頃に sendDailyReport を実行');
}

// ============================================================
// GA4 Data API — 基本データ（チャネル × デバイス）
// ============================================================

function fetchGA4Data(propertyId, startDate, endDate) {
  var request = AnalyticsData.newRunReportRequest();

  request.dateRanges = [{ startDate: startDate, endDate: endDate }];

  request.metrics = [
    { name: 'activeUsers' },
    { name: 'newUsers' },
    { name: 'sessions' },
    { name: 'screenPageViews' },
    { name: 'userEngagementDuration' },
    { name: 'bounceRate' },
    { name: 'eventCount' }
  ];

  request.dimensions = [
    { name: 'sessionDefaultChannelGroup' },
    { name: 'deviceCategory' }
  ];

  try {
    var response = AnalyticsData.Properties.runReport(request, 'properties/' + propertyId);
    return parseGA4Response(response);
  } catch (e) {
    Logger.log('GA4 API Error: ' + e.message);
    return getEmptyData();
  }
}

function parseGA4Response(response) {
  var data = {
    users: 0,
    newUsers: 0,
    sessions: 0,
    pageviews: 0,
    engagementDuration: 0,
    bounceRate: 0,
    eventCount: 0,
    channels: {},
    devices: {}
  };

  if (!response.rows || response.rows.length === 0) {
    return data;
  }

  response.rows.forEach(function(row) {
    var channel = row.dimensionValues[0].value;
    var device = row.dimensionValues[1].value;
    var users = parseInt(row.metricValues[0].value) || 0;
    var newUsers = parseInt(row.metricValues[1].value) || 0;
    var sessions = parseInt(row.metricValues[2].value) || 0;
    var pageviews = parseInt(row.metricValues[3].value) || 0;
    var duration = parseFloat(row.metricValues[4].value) || 0;
    var events = parseInt(row.metricValues[6].value) || 0;

    data.users += users;
    data.newUsers += newUsers;
    data.sessions += sessions;
    data.pageviews += pageviews;
    data.engagementDuration += duration;
    data.eventCount += events;

    // チャネル別
    if (!data.channels[channel]) data.channels[channel] = 0;
    data.channels[channel] += sessions;

    // デバイス別
    if (!data.devices[device]) data.devices[device] = 0;
    data.devices[device] += sessions;
  });

  // 直帰率の加重平均を再計算
  if (data.sessions > 0) {
    data.bounceRate = response.rows.reduce(function(sum, row) {
      var sessions = parseInt(row.metricValues[2].value) || 0;
      var bounce = parseFloat(row.metricValues[5].value) || 0;
      return sum + (bounce * sessions);
    }, 0) / data.sessions;
    data.avgEngagementTime = data.engagementDuration / data.sessions;
  } else {
    data.bounceRate = 0;
    data.avgEngagementTime = 0;
  }

  return data;
}

function getEmptyData() {
  return {
    users: 0, newUsers: 0, sessions: 0, pageviews: 0,
    engagementDuration: 0, bounceRate: 0, eventCount: 0,
    avgEngagementTime: 0, channels: {}, devices: {}
  };
}

// ============================================================
// GA4 Data API — 集客詳細（source / medium 別）
// ============================================================

function fetchAcquisitionDetail(propertyId, startDate, endDate) {
  var request = AnalyticsData.newRunReportRequest();

  request.dateRanges = [{ startDate: startDate, endDate: endDate }];

  request.metrics = [
    { name: 'sessions' },
    { name: 'activeUsers' },
    { name: 'newUsers' },
    { name: 'userEngagementDuration' },
    { name: 'bounceRate' }
  ];

  request.dimensions = [
    { name: 'sessionSource' },
    { name: 'sessionMedium' }
  ];

  request.orderBys = [{ metric: { metricName: 'sessions' }, desc: true }];
  request.limit = 10;

  try {
    var response = AnalyticsData.Properties.runReport(request, 'properties/' + propertyId);
    return parseAcquisitionResponse(response);
  } catch (e) {
    Logger.log('Acquisition API Error: ' + e.message);
    return [];
  }
}

function parseAcquisitionResponse(response) {
  var results = [];

  if (!response.rows || response.rows.length === 0) {
    return results;
  }

  response.rows.forEach(function(row) {
    results.push({
      source: row.dimensionValues[0].value,
      medium: row.dimensionValues[1].value,
      sessions: parseInt(row.metricValues[0].value) || 0,
      users: parseInt(row.metricValues[1].value) || 0,
      newUsers: parseInt(row.metricValues[2].value) || 0,
      engagementDuration: parseFloat(row.metricValues[3].value) || 0,
      bounceRate: parseFloat(row.metricValues[4].value) || 0
    });
  });

  return results;
}

// ============================================================
// GA4 Data API — コンバージョン（generate_lead イベント）
// ============================================================

function fetchConversionData(propertyId, startDate, endDate) {
  var request = AnalyticsData.newRunReportRequest();

  request.dateRanges = [{ startDate: startDate, endDate: endDate }];

  request.metrics = [
    { name: 'eventCount' }
  ];

  request.dimensions = [
    { name: 'sessionDefaultChannelGroup' }
  ];

  request.dimensionFilter = {
    filter: {
      fieldName: 'eventName',
      stringFilter: { value: 'generate_lead', matchType: 'EXACT' }
    }
  };

  try {
    var response = AnalyticsData.Properties.runReport(request, 'properties/' + propertyId);
    return parseConversionResponse(response);
  } catch (e) {
    Logger.log('Conversion API Error: ' + e.message);
    return { total: 0, byChannel: {} };
  }
}

function parseConversionResponse(response) {
  var data = { total: 0, byChannel: {} };

  if (!response.rows || response.rows.length === 0) {
    return data;
  }

  response.rows.forEach(function(row) {
    var channel = row.dimensionValues[0].value;
    var count = parseInt(row.metricValues[0].value) || 0;
    data.total += count;
    data.byChannel[channel] = count;
  });

  return data;
}

// ============================================================
// レポート組み立て
// ============================================================

function buildReport(dateStr, todayData, prevData, weekData, acquisitionData, convData, prevConvData) {
  var lines = [];
  var formattedDate = formatDateJP(dateStr);

  lines.push(':bar_chart: *デイリーアクセスレポート（' + formattedDate + '）*');
  lines.push('━━━━━━━━━━━━━━━━━━');

  // 基本指標
  var userDiff = todayData.users - prevData.users;
  var userSign = userDiff >= 0 ? '+' : '';
  lines.push(':busts_in_silhouette: *ユーザー数:* ' + todayData.users + '（前日比 ' + userSign + userDiff + '）');
  lines.push(':new: *新規ユーザー:* ' + todayData.newUsers);
  lines.push(':footprints: *セッション数:* ' + todayData.sessions);

  var avgTime = formatDuration(todayData.avgEngagementTime || 0);
  lines.push(':stopwatch: *平均滞在時間:* ' + avgTime);
  lines.push(':door: *直帰率:* ' + (todayData.bounceRate * 100).toFixed(1) + '%');

  // デバイス別
  lines.push('');
  lines.push(':iphone: *デバイス別:*');
  var totalDeviceSessions = todayData.sessions || 1;
  Object.keys(todayData.devices).sort().forEach(function(device) {
    var count = todayData.devices[device];
    var pct = ((count / totalDeviceSessions) * 100).toFixed(0);
    lines.push('    ' + deviceLabel(device) + ': ' + count + '（' + pct + '%）');
  });

  // 集客元 TOP5（source / medium）
  lines.push('');
  lines.push(':mag: *集客元 TOP5:*');
  if (acquisitionData.length > 0) {
    var top5 = acquisitionData.slice(0, 5);
    top5.forEach(function(item, i) {
      var avgTime = item.sessions > 0 ? formatDuration(item.engagementDuration / item.sessions) : '0分0秒';
      lines.push('    ' + (i + 1) + '. ' + item.source + ' / ' + item.medium + ': ' + item.sessions + 'セッション（滞在 ' + avgTime + '）');
    });
  } else {
    lines.push('    データなし');
  }

  // チャネル別
  lines.push('');
  lines.push(':link: *チャネル別:*');
  var sortedChannels = Object.keys(todayData.channels).sort(function(a, b) {
    return todayData.channels[b] - todayData.channels[a];
  });
  sortedChannels.forEach(function(channel) {
    var count = todayData.channels[channel];
    var prevCount = prevData.channels[channel] || 0;
    var diff = count - prevCount;
    var diffStr = diff !== 0 ? '（前日比 ' + (diff >= 0 ? '+' : '') + diff + '）' : '';
    lines.push('    ' + channel + ': ' + count + diffStr);
  });

  // 週間サマリー
  lines.push('');
  lines.push(':calendar: *直近7日間:* ユーザー ' + weekData.users + ' / セッション ' + weekData.sessions);

  // コンバージョン
  lines.push('');
  lines.push(':dart: *コンバージョン（フォーム送信）:*');
  var convDiff = convData.total - prevConvData.total;
  var convDiffStr = convDiff !== 0 ? '（前日比 ' + (convDiff >= 0 ? '+' : '') + convDiff + '）' : '';
  lines.push('    送信数: ' + convData.total + convDiffStr);

  if (todayData.sessions > 0) {
    var cvRate = (convData.total / todayData.sessions * 100).toFixed(1);
    lines.push('    CV率: ' + cvRate + '%');
  }

  var cvChannels = Object.keys(convData.byChannel);
  if (cvChannels.length > 0) {
    var cvParts = cvChannels.map(function(ch) {
      return ch + ': ' + convData.byChannel[ch];
    });
    lines.push('    チャネル別: ' + cvParts.join(' / '));
  }

  lines.push('━━━━━━━━━━━━━━━━━━');

  return lines.join('\n');
}

// ============================================================
// AI分析（Claude API）
// ============================================================

function getAIAnalysis(apiKey, dateStr, todayData, prevData, weekData, acquisitionData, convData) {
  var cvRate = todayData.sessions > 0 ? (convData.total / todayData.sessions * 100).toFixed(1) : '0';

  var acquisitionSummary = acquisitionData.slice(0, 5).map(function(item) {
    return item.source + '/' + item.medium + ': ' + item.sessions + 'セッション';
  }).join(', ');

  var cvByChannelStr = Object.keys(convData.byChannel).map(function(ch) {
    return ch + ': ' + convData.byChannel[ch] + '件';
  }).join(', ') || 'なし';

  var prompt = 'あなたはWebマーケティングの専門家です。以下はAI顧問サービスのランディングページ（1ページ構成、お問い合わせフォーム付き）のGA4アクセスデータです。\n\n'
    + '## 当日データ（' + dateStr + '）\n'
    + '- ユーザー数: ' + todayData.users + '（前日: ' + prevData.users + '）\n'
    + '- 新規ユーザー: ' + todayData.newUsers + '\n'
    + '- セッション数: ' + todayData.sessions + '\n'
    + '- 平均滞在時間: ' + formatDuration(todayData.avgEngagementTime || 0) + '\n'
    + '- 直帰率: ' + (todayData.bounceRate * 100).toFixed(1) + '%\n'
    + '- チャネル別: ' + JSON.stringify(todayData.channels) + '\n'
    + '- デバイス別: ' + JSON.stringify(todayData.devices) + '\n'
    + '\n## 集客元詳細（source / medium）\n'
    + '- ' + acquisitionSummary + '\n'
    + '\n## コンバージョン（フォーム送信）\n'
    + '- フォーム送信数: ' + convData.total + '件\n'
    + '- CV率: ' + cvRate + '%\n'
    + '- チャネル別CV: ' + cvByChannelStr + '\n'
    + '\n## 直近7日間\n'
    + '- ユーザー: ' + weekData.users + ' / セッション: ' + weekData.sessions + '\n'
    + '- チャネル別: ' + JSON.stringify(weekData.channels) + '\n'
    + '\nこのデータを分析して、以下の観点から簡潔にコメントしてください：\n'
    + '1. 数値の変化で注目すべき点\n'
    + '2. 集客元の傾向（どこからのアクセスが質が高いか）\n'
    + '3. コンバージョン改善につながる具体的なアクション提案\n'
    + '\n4〜5行の箇条書き（・で始める）で、Slackに投稿するのでシンプルに。';

  try {
    var response = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', {
      method: 'post',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      payload: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 500,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    var result = JSON.parse(response.getContentText());
    var analysis = result.content[0].text;
    return ':bulb: *AI分析*\n' + analysis;
  } catch (e) {
    Logger.log('Claude API Error: ' + e.message);
    return getRuleBasedAnalysis(todayData, prevData, convData);
  }
}

// ============================================================
// ルールベース分析（Claude APIがない場合のフォールバック）
// ============================================================

function getRuleBasedAnalysis(todayData, prevData, convData) {
  var insights = [];

  // ユーザー数の変化
  if (prevData.users > 0) {
    var changeRate = ((todayData.users - prevData.users) / prevData.users * 100).toFixed(0);
    if (changeRate > 50) {
      insights.push(':arrow_up: ユーザー数が前日比+' + changeRate + '%と大幅増。流入元を確認して再現性を探りましょう');
    } else if (changeRate < -50) {
      insights.push(':arrow_down: ユーザー数が前日比' + changeRate + '%と大幅減。一時的な減少か、流入元の変化を確認');
    }
  }

  // 滞在時間
  if (todayData.avgEngagementTime > 60) {
    insights.push(':white_check_mark: 平均滞在時間が1分超え。コンテンツがしっかり読まれています');
  } else if (todayData.avgEngagementTime > 0 && todayData.avgEngagementTime < 20) {
    insights.push(':warning: 平均滞在時間が短め。ファーストビューの訴求力を見直す余地あり');
  }

  // モバイル比率
  var mobileCount = todayData.devices['mobile'] || 0;
  if (todayData.sessions > 0 && (mobileCount / todayData.sessions) > 0.7) {
    insights.push(':iphone: モバイル比率が70%超。スマホでのCTA導線を最優先で最適化しましょう');
  }

  // コンバージョン分析
  if (convData.total > 0) {
    var cvRate = (convData.total / todayData.sessions * 100).toFixed(1);
    insights.push(':dart: フォーム送信' + convData.total + '件（CV率 ' + cvRate + '%）。CVにつながったチャネルの集客を強化しましょう');
  } else if (todayData.sessions >= 10) {
    insights.push(':thinking_face: セッションはあるもののフォーム送信ゼロ。CTAの視認性やフォームまでの導線を見直しましょう');
  }

  // アクセスゼロ
  if (todayData.users === 0) {
    insights.push(':zzz: アクセスがありませんでした。SNS投稿や告知でサイトへの誘導を検討しましょう');
  }

  if (insights.length === 0) {
    insights.push(':ok: 大きな変動はありません。安定した状態です');
  }

  return ':bulb: *分析*\n' + insights.join('\n');
}

// ============================================================
// Slack送信
// ============================================================

function postToSlack(webhookUrl, message) {
  UrlFetchApp.fetch(webhookUrl, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify({ text: message })
  });
}

// ============================================================
// ユーティリティ
// ============================================================

function getDateString(baseDate, offsetDays) {
  var d = new Date(baseDate);
  d.setDate(d.getDate() + offsetDays);
  return Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM-dd');
}

function formatDateJP(dateStr) {
  var parts = dateStr.split('-');
  return parts[0] + '/' + parseInt(parts[1]) + '/' + parseInt(parts[2]);
}

function formatDuration(seconds) {
  var min = Math.floor(seconds / 60);
  var sec = Math.round(seconds % 60);
  return min + '分' + sec + '秒';
}

function deviceLabel(device) {
  var labels = { 'desktop': 'PC', 'mobile': 'モバイル', 'tablet': 'タブレット' };
  return labels[device] || device;
}
