/**
 * Read-only Music storage connectivity diagnostic.
 *
 * This endpoint intentionally bypasses the Music storage helper so it can
 * distinguish transport/API/JSON failures without changing any data.
 * It never returns the value stored in music:records:v1.
 */

const MUSIC_RECORDS_KEY = 'music:records:v1';
const UPSTASH_TIMEOUT_MS = 5000;

function environmentStatus() {
    return {
        urlPresent: Boolean(process.env.UPSTASH_REDIS_REST_URL),
        tokenPresent: Boolean(process.env.UPSTASH_REDIS_REST_TOKEN),
    };
}

function baseResult(environment, classification) {
    return {
        ok: classification === 'success',
        classification,
        environment,
        http: {
            connected: false,
            responseReceived: false,
            status: null,
            statusClass: null,
        },
        json: {
            responseParsed: false,
            musicRecordsParsed: null,
            musicRecordsIsArray: null,
        },
    };
}

function statusClass(status) {
    if (!Number.isInteger(status)) return null;
    return `${Math.floor(status / 100)}xx`;
}

function classifyNetworkError(error, timedOut) {
    if (timedOut || error?.name === 'AbortError') return 'timeout';

    const code = String(error?.code || '').toUpperCase();
    if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return 'dns';
    if (
        code.includes('TLS') ||
        code.includes('CERT') ||
        code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE'
    ) return 'tls';
    if (code === 'ECONNREFUSED') return 'connection_refused';
    return 'network';
}

function classifyHttpStatus(status) {
    if (status === 401 || status === 403) return 'authentication';
    return 'upstash_api';
}

async function readUpstash() {
    const environment = environmentStatus();
    if (!environment.urlPresent || !environment.tokenPresent) {
        return baseResult(environment, 'configuration');
    }

    const base = process.env.UPSTASH_REDIS_REST_URL.replace(/\/$/, '');
    const token = process.env.UPSTASH_REDIS_REST_TOKEN;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), UPSTASH_TIMEOUT_MS);

    let response;
    try {
        response = await fetch(`${base}/get/${encodeURIComponent(MUSIC_RECORDS_KEY)}`, {
            method: 'GET',
            headers: { Authorization: `Bearer ${token}` },
            signal: controller.signal,
        });
    } catch (error) {
        clearTimeout(timeout);
        return {
            ...baseResult(environment, classifyNetworkError(error, controller.signal.aborted)),
            network: {
                errorType: classifyNetworkError(error, controller.signal.aborted),
            },
        };
    }
    clearTimeout(timeout);

    const httpClassification = classifyHttpStatus(response.status);
    const result = baseResult(environment, httpClassification);
    result.http = {
        connected: true,
        responseReceived: true,
        status: response.status,
        statusClass: statusClass(response.status),
    };

    let payload;
    try {
        payload = await response.json();
        result.json.responseParsed = true;
    } catch {
        result.classification = httpClassification;
        return result;
    }

    if (!response.ok) return result;
    if (!payload || typeof payload !== 'object' ||
        !Object.prototype.hasOwnProperty.call(payload, 'result')) {
        result.classification = 'upstash_api';
        return result;
    }

    if (payload.result === null) {
        result.classification = 'success';
        return result;
    }
    if (typeof payload.result !== 'string') {
        result.classification = 'json_app';
        result.json.musicRecordsParsed = false;
        result.json.musicRecordsIsArray = false;
        return result;
    }

    try {
        const records = JSON.parse(payload.result);
        result.json.musicRecordsParsed = true;
        result.json.musicRecordsIsArray = Array.isArray(records);
        result.classification = Array.isArray(records) ? 'success' : 'json_app';
    } catch {
        result.classification = 'json_app';
        result.json.musicRecordsParsed = false;
    }
    return result;
}

export default async function handler(req, res) {
    res.setHeader('Cache-Control', 'no-store');
    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const result = await readUpstash();
    return res.status(200).json(result);
}