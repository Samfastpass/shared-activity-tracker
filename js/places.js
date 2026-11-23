// Place search and "use my location" via OpenStreetMap (Nominatim). Only what you type or the point
// you share is sent, and only when you press Search / Use my location (no search-as-you-type).
const BASE = 'https://nominatim.openstreetmap.org';
let last = 0;

const round5 = (n) => Math.round(n * 1e5) / 1e5;           // ~1 metre is plenty

async function politely() {                                // Nominatim asks for at most 1 request a second
  const wait = 1100 - (Date.now() - last);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  last = Date.now();
}

// "Borough Market, Southwark, London": the place, its area and its town (not a 9-part postal address).
function shortName(r) {
  const a = r.address || {};
  const town = a.city || a.town || a.village || a.hamlet || a.municipality;
  const area = a.suburb || a.neighbourhood || a.city_district || a.quarter;
  const display = (r.display_name || '').split(',').map((x) => x.trim()).filter(Boolean);
  const first = r.name || a.road || display[0] || 'Somewhere';
  let parts = [first, area, town].filter(Boolean).filter((v, i, all) => all.indexOf(v) === i);
  if (parts.length < 2) {                                   // nothing structured to add: use the region, or the display name
    const more = a.county || a.state || display.filter((x) => x !== first && !/^\d/.test(x))[0];
    parts = [first, more].filter(Boolean).filter((v, i, all) => all.indexOf(v) === i);
  }
  return parts.join(', ').slice(0, 200);
}

async function getJson(url) {
  let res;
  try { res = await fetch(url, { headers: { Accept: 'application/json' } }); } catch { throw new Error("Couldn't reach the place search. Check your connection."); }
  if (!res.ok) throw new Error('Place search is unavailable right now.');
  return res.json();
}

export async function searchPlaces(query) {
  await politely();
  const data = await getJson(`${BASE}/search?format=jsonv2&addressdetails=1&limit=5&q=${encodeURIComponent(query)}`);
  return data.map((r) => ({ name: shortName(r), lat: round5(Number(r.lat)), lng: round5(Number(r.lon)) }));
}

export async function reverseGeocode(lat, lng) {
  await politely();
  const data = await getJson(`${BASE}/reverse?format=jsonv2&addressdetails=1&zoom=16&lat=${lat}&lon=${lng}`);
  return data && !data.error ? shortName(data) : null;
}

export function currentPosition() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error("This device can't share its location."));
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: round5(p.coords.latitude), lng: round5(p.coords.longitude) }),
      (e) => reject(new Error(e.code === 1 ? 'Location permission was denied.' : "Couldn't get your location.")),
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 });
  });
}
