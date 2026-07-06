/**
 * Vercel Serverless Function: /api/weather
 *
 * When called without lat/lon, resolves the client's location from their IP
 * address via ip-api.com (free, no API key, server-side HTTP is fine).
 * Then fetches the weather condition from OpenWeatherMap.
 *
 * Timing is logged for each stage (visible in Vercel Function logs):
 *   [weather/geo]   Xms  lat=Y lon=Z
 *   [weather/owm]   Xms  condition=Y
 *   [weather/total] Xms
 */
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  const apiKey = process.env.OPENWEATHERMAP_API_KEY;
  if (!apiKey) {
    return res.status(200).json({ condition: null });
  }

  const tTotal = Date.now();
  const { lat, lon } = req.query;
  let latNum, lonNum;

  /* ── Resolve coordinates ──────────────────────────────────── */
  if (
    typeof lat === 'string' && lat.trim() !== '' &&
    typeof lon === 'string' && lon.trim() !== ''
  ) {
    // Explicit coords provided (kept for backwards-compat / debug)
    latNum = Number(lat);
    lonNum = Number(lon);
    if (
      !isFinite(latNum) || !isFinite(lonNum) ||
      latNum < -90  || latNum > 90 ||
      lonNum < -180 || lonNum > 180
    ) {
      return res.status(400).json({ condition: null });
    }
    console.log('[weather/coords] using explicit lat=' + latNum + ' lon=' + lonNum);
  } else {
    // IP-based geolocation — city-level accuracy, sufficient for weather
    const forwarded = req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || '';
    const ip = forwarded.split(',')[0].trim();

    const tGeo = Date.now();
    try {
      // ipapi.co: free tier (30k/month), HTTPS, no API key required
      const geoAbort = new AbortController();
      const geoTimer = setTimeout(() => geoAbort.abort(), 3000);
      const geoRes = await fetch(
        'https://ipapi.co/' + (ip || 'json') + '/json/',
        { signal: geoAbort.signal }
      );
      clearTimeout(geoTimer);
      const geo    = await geoRes.json();
      const geoMs  = Date.now() - tGeo;

      if (!geo.latitude || !geo.longitude) {
        console.log('[weather/geo] ' + geoMs + 'ms  no coords (fallback null)');
        return res.status(200).json({ condition: null });
      }

      latNum = geo.latitude;
      lonNum = geo.longitude;
      console.log('[weather/geo] ' + geoMs + 'ms  lat=' + latNum + ' lon=' + lonNum);
    } catch (err) {
      const geoMs = Date.now() - tGeo;
      console.log('[weather/geo] ' + geoMs + 'ms  error: ' + err.message);
      return res.status(200).json({ condition: null });
    }
  }

  /* ── Fetch OpenWeatherMap ─────────────────────────────────── */
  const tOwm = Date.now();
  try {
    const url = new URL('https://api.openweathermap.org/data/2.5/weather');
    url.searchParams.set('lat', latNum);
    url.searchParams.set('lon', lonNum);
    url.searchParams.set('appid', apiKey);

    const upstream  = await fetch(url.toString());
    const data      = await upstream.json();
    const condition = data?.weather?.[0]?.main ?? null;
    const owmMs     = Date.now() - tOwm;

    console.log('[weather/owm]   ' + owmMs + 'ms  condition=' + condition);
    console.log('[weather/total] ' + (Date.now() - tTotal) + 'ms');

    return res.status(200).json({ condition });
  } catch (err) {
    console.log('[weather/owm]   ' + (Date.now() - tOwm) + 'ms  error: ' + err.message);
    return res.status(200).json({ condition: null });
  }
}
