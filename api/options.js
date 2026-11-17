const { getOptions, addOption, deleteOption } = require("../storage");

const HYPHEN_REGEX = /[-–—−‑‒―\u2010-\u2015\u2212\uFE63\uFF0D]/;

module.exports = async (req, res) => {
  try {
    if (req.method === "GET") {
      return res.status(200).json(await getOptions());
    }

    const { type, value } = req.body || {};
    if (!type || !value || !["name", "project"].includes(type)) {
      return res.status(400).json({ error: "A valid type (name or project) and value are required." });
    }

    if (type === "project" && HYPHEN_REGEX.test(value)) {
      return res.status(400).json({ error: "Hyphens (-) are not allowed in project names." });
    }

    if (req.method === "POST") {
      return res.status(200).json({ success: true, data: await addOption(type, value) });
    }

    if (req.method === "DELETE") {
      return res.status(200).json({ success: true, data: await deleteOption(type, value) });
    }

    res.setHeader("Allow", ["GET", "POST", "DELETE"]);
    return res.status(405).json({ error: "Method not allowed." });
  } catch (error) {
    console.error("Options storage error:", error);
    return res.status(error.status || 500).json({ error: error.message || "Unable to update persistent options storage." });
  }
};
