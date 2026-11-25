const { getTodayStatusData, syncTodayFromSheet } = require("../storage");

module.exports = async (req, res) => {
  if (req.method !== "GET" && req.method !== "POST") {
    res.setHeader("Allow", ["GET", "POST"]);
    return res.status(405).json({ error: "Method not allowed." });
  }

  try {
    const shouldSync =
      req.query?.sync === "true" ||
      req.query?.force === "true" ||
      req.body?.sync === true ||
      req.body?.force === true;

    if (shouldSync) {
      await syncTodayFromSheet(req.query?.date || req.body?.date);
    }

    const data = await getTodayStatusData(req.query?.date || req.body?.date);
    return res.status(200).json({
      report: data.report,
      htmlReport: data.htmlReport,
      copyHtml: data.copyHtml,
      allFilled: data.allFilled,
      notFilled: data.notFilled,
      filled: data.filled,
      entries: data.entries,
      synced: shouldSync,
    });
  } catch (err) {
    console.error("Error generating daily status report:", err);
    return res.status(500).json({ error: err.message || "Unable to generate daily status." });
  }
};
