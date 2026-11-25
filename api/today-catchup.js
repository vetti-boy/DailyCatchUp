const { getTodayStatusData, syncTodayFromSheet } = require("../storage");

function escapeXml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

module.exports = async (req, res) => {
  if (req.method !== "GET") {
    res.setHeader("Allow", ["GET"]);
    return res.status(405).json({ error: "Method not allowed." });
  }

  const url = req.url || "";
  const isNotFilledFeed = url.includes("today-not-filled-feed") || req.query?.type === "not-filled";
  const isCatchupFeed =
    url.includes("today-catchup-feed") ||
    req.query?.type === "catchup-feed" ||
    req.query?.format === "rss" ||
    (req.headers?.accept && req.headers.accept.includes("application/rss+xml"));

  try {
    if (req.query?.sync === "true" || req.query?.force === "true") {
      await syncTodayFromSheet(req.query?.date);
    }
    const data = await getTodayStatusData(req.query?.date);
    const now = new Date().toUTCString();

    // 1. RSS Feed for people who have NOT filled yet
    if (isNotFilledFeed) {
      const items = data.notFilled
        .map(
          (person) => `
    <item>
      <title>${escapeXml(person.name)}</title>
      <description>${escapeXml(person.email || "")}</description>
      <category>${escapeXml(person.team || "CBE")}</category>
      <pubDate>${now}</pubDate>
      <guid isPermaLink="false">dailycatchup-notfilled-${escapeXml(person.name)}-${escapeXml(data.date)}</guid>
    </item>`
        )
        .join("");

      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Daily Catch Up - People Not Filled</title>
    <description>Team members who have not filled daily catch up today</description>
    <link>https://daily-catch-up.vercel.app/</link>
    <lastBuildDate>${now}</lastBuildDate>${items}
  </channel>
</rss>`;

      res.setHeader("Content-Type", "application/rss+xml; charset=utf-8");
      res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate, max-age=0");
      res.setHeader("Pragma", "no-cache");
      res.setHeader("Expires", "0");
      return res.status(200).send(xml);
    }

    // 2. RSS Feed for formatted Catch-Up text ready for Teams
    if (isCatchupFeed) {
      const isPlainTextRequested = req.query?.format === "raw" || req.query?.format === "text";
      const formattedContent = isPlainTextRequested
        ? data.report
        : (data.copyHtml || data.report.replace(/\n/g, "<br/>\n"));

      const item = data.report
        ? `
    <item>
      <title>${escapeXml("🟡 IP Team Daily Status " + data.displayDate)}</title>
      <description>${escapeXml(formattedContent)}</description>
      <link>https://daily-catch-up.vercel.app/</link>
      <pubDate>${now}</pubDate>
      <guid isPermaLink="false">dailycatchup-report-${escapeXml(data.date)}</guid>
    </item>`
        : "";

      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Daily Catch Up - Today CatchUp Text</title>
    <description>Formatted Daily Catch Up text ready for Teams</description>
    <link>https://daily-catch-up.vercel.app/</link>
    <lastBuildDate>${now}</lastBuildDate>${item}
  </channel>
</rss>`;

      res.setHeader("Content-Type", "application/rss+xml; charset=utf-8");
      res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate, max-age=0");
      res.setHeader("Pragma", "no-cache");
      res.setHeader("Expires", "0");
      return res.status(200).send(xml);
    }

    // 3. JSON response
    return res.status(200).json(data);
  } catch (error) {
    console.error("Today catchup API error:", error);
    return res.status(500).json({ error: error.message || "Unable to load today catchup." });
  }
};
