const {
  getPostedStatus,
  setPostedStatus,
  resetPostedStatus,
  getZonedTodayDate,
} = require("../storage");

function escapeXml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function buildRssFeed({ isPosted, date, lastPostedTime, when = "posted" }) {
  const now = new Date().toUTCString();
  const shouldIncludeItem = when === "not-posted" || when === "unposted" ? !isPosted : isPosted;

  let item = "";
  if (shouldIncludeItem) {
    const title = isPosted ? "CatchUp Posted" : "CatchUp Pending";
    const desc = isPosted
      ? `Daily Catch Up for ${date} has already been posted to Teams.`
      : `Daily Catch Up for ${date} is pending and not yet posted to Teams.`;
    const guid = `dailycatchup-${isPosted ? "posted" : "pending"}-${date}`;
    const pubDate = lastPostedTime ? new Date(lastPostedTime).toUTCString() : now;

    item = `
    <item>
      <title>${escapeXml(title)}</title>
      <description>${escapeXml(desc)}</description>
      <pubDate>${pubDate}</pubDate>
      <guid isPermaLink="false">${escapeXml(guid)}</guid>
    </item>`;
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Daily Catch Up - Posted Status</title>
    <description>Teams CatchUp Posted Status for Daily Catch Up</description>
    <link>https://daily-catch-up.vercel.app/</link>
    <lastBuildDate>${now}</lastBuildDate>${item}
  </channel>
</rss>`;
}

module.exports = async (req, res) => {
  const url = req.url || "";
  const isFeedRequest =
    url.includes("today-posted-feed") ||
    req.query?.format === "rss" ||
    req.query?.feed === "true" ||
    (req.headers?.accept && req.headers.accept.includes("application/rss+xml"));

  try {
    const today = getZonedTodayDate();
    const targetDate = req.query?.date || req.body?.date || today;

    // Handle Quick Action on GET: ?action=mark or ?action=reset (works for both RSS connector and JSON)
    if (req.method === "GET" && req.query?.action) {
      const action = String(req.query.action).toLowerCase();
      if (action === "mark" || action === "post" || action === "set") {
        await setPostedStatus({
          date: targetDate,
          posted: true,
          by: req.query.by || (isFeedRequest ? "PowerAutomate-RSS" : "PowerAutomate-GET"),
        });
      } else if (action === "reset" || action === "unmark" || action === "clear") {
        await resetPostedStatus(targetDate);
      }

      // If called as JSON API (not RSS), return JSON directly
      if (!isFeedRequest) {
        const updated = await getPostedStatus(targetDate);
        return res.status(200).json({ success: true, ...updated });
      }
    }

    // Handle RSS Feed requests (Power Automate "List all RSS feed items")
    if (isFeedRequest && req.method === "GET") {
      const statusData = await getPostedStatus(targetDate);
      const when = req.query?.when || req.query?.mode || "posted";
      const xml = buildRssFeed({
        isPosted: statusData.isPosted,
        date: statusData.date,
        lastPostedTime: statusData.lastPostedTime,
        when,
      });

      res.setHeader("Content-Type", "application/rss+xml; charset=utf-8");
      res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate, max-age=0");
      res.setHeader("Pragma", "no-cache");
      res.setHeader("Expires", "0");
      return res.status(200).send(xml);
    }

    // Standard GET status (JSON)
    if (req.method === "GET") {
      const statusData = await getPostedStatus(targetDate);
      return res.status(200).json(statusData);
    }

    // POST status: mark as posted or update
    if (req.method === "POST") {
      const { date, posted = true, by = "PowerAutomate" } = req.body || {};
      if (posted === false || String(posted) === "false") {
        const result = await resetPostedStatus(date || targetDate);
        return res.status(200).json({ success: true, ...result });
      }
      const result = await setPostedStatus({
        date: date || targetDate,
        posted: true,
        by: by || "PowerAutomate",
      });
      return res.status(200).json({ success: true, ...result });
    }

    // DELETE status: reset posted status
    if (req.method === "DELETE") {
      const date = req.body?.date || req.query?.date || targetDate;
      const result = await resetPostedStatus(date);
      return res.status(200).json({ success: true, ...result });
    }

    res.setHeader("Allow", ["GET", "POST", "DELETE"]);
    return res.status(405).json({ error: "Method not allowed" });
  } catch (error) {
    console.error("Posted status API error:", error);
    if (isFeedRequest) {
      res.setHeader("Content-Type", "application/rss+xml; charset=utf-8");
      return res.status(500).send(
        `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>Daily Catch Up - Posted Status</title><description>${escapeXml(
          error.message || "Unable to check posted status"
        )}</description></channel></rss>`
      );
    }
    return res.status(500).json({ error: error.message || "Unable to process posted status." });
  }
};
