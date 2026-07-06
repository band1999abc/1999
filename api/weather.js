/**
 * Vercel Serverless Function: /api/weather
 * Proxies OpenWeatherMap so the API key stays server-side.
 * Mirrors the behavior of the server.py endpoint on Replit.
 */
export default async function handler(req, res) {
  const { lat, lon } = req.query;

  // Validate lat/lon are finite numbers within geographic bounds
  const latNum = parseFloat(lat);
  const lonNum = parseFloat(lon);
  if (
    !isFinite(latNum) || !isFinite(lonNum) ||
    latNum < -90  || latNum > 90 ||
    lonNum < -180 || lonNum > 180
  ) {
    return res.status(400).json({ condition: null });
  }

  const apiKey = process.env.OPENWEATHERMAP_API_KEY;
  if (!apiKey) {
    return res.status(200).json({ condition: null });
  }

  try {
    const url = new URL('https://api.openweathermap.org/data/2.5/weather');
    url.searchParams.set('lat', latNum);
    url.searchParams.set('lon', lonNum);
    url.searchParams.set('appid', apiKey);

    const upstream = await fetch(url.toString());
    const data = await upstream.json();
    const condition = data?.weather?.[0]?.main ?? null;

    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({ condition });
  } catch {
    return res.status(200).json({ condition: null }); // silent fallback
  }
}
