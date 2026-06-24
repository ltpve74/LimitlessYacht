// Fetches guest reviews from Click&Boat listing pages (server-side) and returns JSON.
// Configure extra listing URLs via CLICKANDBOAT_LISTING_URLS (comma-separated).

const DEFAULT_LISTINGS = [
  "https://www.clickandboat.com/en/activities/mallorca/half-day-mallorca-yacht-cruise-with-swim-stops-sea-toys-18390",
  "https://www.clickandboat.com/en/activities/mallorca/mallorca-yacht-experience-full-day-coastal-escape-with-water-toys-18387",
];

const UA = "LimitlessYacht/1.0 (+https://limitlessyachtcharter.com)";
const SOURCE_PAGE =
  "https://www.clickandboat.com/en/activities/mallorca/half-day-mallorca-yacht-cruise-with-swim-stops-sea-toys-18390";

export async function handler() {
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "public, max-age=3600",
  };

  const listingUrls = (process.env.CLICKANDBOAT_LISTING_URLS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const urls = listingUrls.length ? listingUrls : DEFAULT_LISTINGS;

  try {
    const payloads = await Promise.all(urls.map((url) => fetchListing(url)));
    const merged = mergeReviews(payloads);
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        ...merged,
        sourcePage: SOURCE_PAGE,
        generatedAt: new Date().toISOString(),
      }),
    };
  } catch (err) {
    return {
      statusCode: 200,
      headers: { ...headers, "Cache-Control": "public, max-age=300" },
      body: JSON.stringify({
        ratingValue: 5,
        reviewCount: 1,
        reviews: [FALLBACK_REVIEW],
        sourcePage: SOURCE_PAGE,
        fallback: true,
        error: String(err),
        generatedAt: new Date().toISOString(),
      }),
    };
  }
}

const FALLBACK_REVIEW = {
  author: "Tony",
  date: "Aug 2025",
  rating: 5,
  text:
    "Our group of six had a fantastic day on Limitless, which was spacious, comfortable, and spotless. Paul was highly responsive and organized our charter with less than a day's notice. Once on board, we found Captain Luigi to be both knowledgeable and humorous, and he seamlessly mapped out a smooth itinerary with several fun stops. Throughout the charter, the attentive stewardess made sure we were well taken care of, whether it was bringing us a (very well-stocked) basket of sunscreen and towels or keeping our drinks topped off and bringing them to us wherever we went. Highly recommend!",
};

async function fetchListing(url) {
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`Fetch failed ${url}: ${res.status}`);
  const html = await res.text();
  const product = parseProductJsonLd(html);
  const reviews = parseReviewItems(html);
  return {
    url,
    ratingValue: product?.aggregateRating?.ratingValue ?? 5,
    reviewCount: product?.aggregateRating?.reviewCount ?? reviews.length,
    reviews,
  };
}

function parseProductJsonLd(html) {
  const re = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/g;
  let m;
  while ((m = re.exec(html))) {
    try {
      const data = JSON.parse(m[1]);
      if (data["@type"] === "Product") return data;
    } catch {
      /* skip invalid JSON-LD */
    }
  }
  return null;
}

function parseReviewItems(html) {
  const reviews = [];
  const blockRe = /aria-label="Review #(\d+)"[\s\S]*?<\/li>/g;
  const textRe = /line-clamp-4[^>]*>\s*([\s\S]*?)\s*<\/div>/;
  let m;
  while ((m = blockRe.exec(html))) {
    const block = m[0];
    const authorMatch = block.match(/font-medium text-neutral-800">\s*([^<]+?)\s*<\/div>/);
    const dateMatch = block.match(/Date of the review\s*([^<]+)/);
    const textMatch = block.match(textRe);
    const text = textMatch
      ? decodeHtml(textMatch[1].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim())
      : "";
    if (!text || text.length < 80) continue;
    reviews.push({
      author: authorMatch ? authorMatch[1].trim() : "Guest",
      date: formatReviewDate(dateMatch ? dateMatch[1].trim() : ""),
      rating: 5,
      text,
    });
  }
  return reviews;
}

function mergeReviews(payloads) {
  const seen = new Set();
  const reviews = [];
  let ratingValue = 5;
  let reviewCount = 0;

  for (const p of payloads) {
    ratingValue = Math.max(ratingValue, Number(p.ratingValue) || 5);
    reviewCount = Math.max(reviewCount, Number(p.reviewCount) || 0);
    for (const r of p.reviews) {
      const key = r.text.slice(0, 80);
      if (seen.has(key)) continue;
      seen.add(key);
      reviews.push(r);
    }
  }

  if (!reviews.length) reviews.push(FALLBACK_REVIEW);
  if (!reviewCount) reviewCount = reviews.length;

  reviews.sort((a, b) => parseReviewSort(b.date) - parseReviewSort(a.date));

  return { ratingValue, reviewCount, reviews };
}

function formatReviewDate(raw) {
  const cleaned = raw.replace(/\s+/g, " ").trim();
  if (!cleaned) return "";
  const m = cleaned.match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (!m) return cleaned;
  const months = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];
  const month = months[parseInt(m[1], 10) - 1] || m[1];
  const year = m[3].length === 2 ? `20${m[3]}` : m[3];
  return `${month} ${year}`;
}

function parseReviewSort(dateStr) {
  const m = dateStr.match(/([A-Za-z]+)\s+(\d{4})/);
  if (!m) return 0;
  const months = {
    Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5,
    Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11,
  };
  return new Date(parseInt(m[2], 10), months[m[1]] ?? 0, 1).getTime();
}

function decodeHtml(s) {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}