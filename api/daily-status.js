const { getTodayStatusData } = require("../storage");

module.exports = async (req, res) => {
  if (req.method !== "GET") {
    res.setHeader("Allow", ["GET"]);
    return res.status(405).json({ error: "Method not allowed." });
  }

  try {
    const data = await getTodayStatusData(req.query?.date);
    return res.status(200).json({
      report: data.report,
      htmlReport: data.htmlReport,
      copyHtml: data.copyHtml,
      allFilled: data.allFilled,
      notFilled: data.notFilled,
    });
  } catch (err) {
    console.error("Error generating daily status report:", err);
    return res.status(500).json({ error: err.message || "Unable to generate daily status." });
  }
};
