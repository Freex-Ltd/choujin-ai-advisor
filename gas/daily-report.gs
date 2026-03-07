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
 * 5. トリガーを設定: sendDailyReport を毎日9:00に実行
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

  // 今日と昨日の日付
  const today = new Date();
  const yesterday = getDateString(today, -1);
  const dayBefore = getDateString(today, -2);
  const sevenDaysAgo = getDateString(today, -7);

  // GA4データ取得
  const todayData = fetchGA4Data(propertyId, yesterday, yesterday);
  const prevData = fetchGA4Data(propertyId, dayBefore, dayBefore);
  const weekData = fetchGA4Data(propertyId, sevenDaysAgo, yesterday);

  // レポート組み立て
  const report = buildReport(yesterday, todayData, prevData, weekData);

  // AI分析（Claude APIキーがあれば）
  let aiAnalysis = '';
  if (claudeApiKey) {
    aiAnalysis = getAIAnalysis(claudeApiKey, yesterday, todayData, prevData, weekData);
  } else {
    aiAnalysis = getRuleBasedAnalysis(todayData, prevData);
  }

  // Slackに送信
  const message = report + '\n' + aiAnalysis;
  postToSlack(slackWebhookUrl, message);
}

// ============================================================
// GA4 Data API
// ============================================================

function fetchGA4Data(propertyId, startDate, endDate) {
  const request = AnalyticsData.newRunReportRequest();

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
    const response = AnalyticsData.Properties.runReport(request, 'properties/' + propertyId);
    return parseGA4Response(response);
  } catch (e) {
    Logger.log('GA4 API Error: ' + e.message);
    return getEmptyData();
  }
}

function parseGA4Response(response) {
  const data = {
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
    const channel = row.dimensionValues[0].value;
    const device = row.dimensionValues[1].value;
    const users = parseInt(row.metricValues[0].value) || 0;
    const newUsers = parseInt(row.metricValues[1].value) || 0;
    const sessions = parseInt(row.metricValues[2].value) || 0;
    const pageviews = parseInt(row.metricValues[3].value) || 0;
    const duration = parseFloat(row.metricValues[4].value) || 0;
    const bounce = parseFloat(row.metricValues[5].value) || 0;
    const events = parseInt(row.metricValues[6].value) || 0;

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

  // 加重平均ではなく全体の直帰率を再計算
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
// レポート組み立て
// ============================================================

function buildReport(dateStr, todayData, prevData, weekData) {
  var lines = [];
  var formattedDate = formatDateJP(dateStr);

  lines.push(':bar_chart: *デイリーアクセスレポート（' + formattedDate + '）*');
  lines.push('━━━━━━━━━━━━━━━━━━');

  // ユーザー数
  var userDiff = todayData.users - prevData.users;
  var userSign = userDiff >= 0 ? '+' : '';
  lines.push(':busts_in_silhouette: *ユーザー数:* ' + todayData.users + '（前日比 ' + userSign + userDiff + '）');

  // 新規ユーザー
  lines.push(':new: *新規ユーザー:* ' + todayData.newUsers);

  // セッション数
  lines.push(':footprints: *セッション数:* ' + todayData.sessions);

  // 平均滞在時間
  var avgTime = formatDuration(todayData.avgEngagementTime || 0);
  lines.push(':stopwatch: *平均滞在時間:* ' + avgTime);

  // 直帰率
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

  // 流入元別
  lines.push('');
  lines.push(':link: *流入元:*');
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

  lines.push('━━━━━━━━━━━━━━━━━━');

  return lines.join('\n');
}

// ============================================================
// AI分析（Claude API）
// ============================================================

function getAIAnalysis(apiKey, dateStr, todayData, prevData, weekData) {
  var prompt = 'あなたはWebマーケティングの専門家です。以下はランディングページ（1ページのみの構成）のGA4アクセスデータです。\n\n'
    + '## 当日データ（' + dateStr + '）\n'
    + '- ユーザー数: ' + todayData.users + '（前日: ' + prevData.users + '）\n'
    + '- 新規ユーザー: ' + todayData.newUsers + '\n'
    + '- セッション数: ' + todayData.sessions + '\n'
    + '- 平均滞在時間: ' + formatDuration(todayData.avgEngagementTime || 0) + '\n'
    + '- 直帰率: ' + (todayData.bounceRate * 100).toFixed(1) + '%\n'
    + '- 流入元: ' + JSON.stringify(todayData.channels) + '\n'
    + '- デバイス: ' + JSON.stringify(todayData.devices) + '\n'
    + '\n## 直近7日間\n'
    + '- ユーザー: ' + weekData.users + ' / セッション: ' + weekData.sessions + '\n'
    + '- 流入元: ' + JSON.stringify(weekData.channels) + '\n'
    + '\nこのデータを分析して、以下の観点から3〜4行で簡潔にコメントしてください：\n'
    + '1. 数値の変化で注目すべき点\n'
    + '2. 流入元やデバイスの傾向\n'
    + '3. LPの改善につながる具体的なアクション提案\n'
    + '\n箇条書き（・で始める）で、Slackに投稿するのでシンプルに。';

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
    return getRuleBasedAnalysis(todayData, prevData);
  }
}

// ============================================================
// ルールベース分析（Claude APIがない場合のフォールバック）
// ============================================================

function getRuleBasedAnalysis(todayData, prevData) {
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
