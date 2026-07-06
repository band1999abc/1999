/**
 * Vercel Serverless Function: /api/weather
 * Proxies OpenWeatherMap so the API key stays server-side.
 * Mirrors the behavior of the server.py endpoint on Replit.
 */
export default async function handler(req, res) {
  const { lat, lon } = req.query;

  // Validate: must be a pure numeric string (no trailing garbage like "12abc")
  // String(Number(x)) round-trips cleanly only for valid numerics.
  const latNum = Number(lat);
  const lonNum = Number(lon);
  if (
    typeof lat !== 'string' || typeof lon !== 'string' ||
    lat.trim() === '' || lon.trim() === '' ||
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
