const { getPeople } = require("../storage");
const {
  sheets,
  getCurrentSheetName,
  ensureSheetExists,
  getValidTodayKeys,
  getColumnLetter,
} = require("../sheet-helper");

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.setHeader("Allow", ["POST"]);
    return res.status(405).json({ error: "Method not allowed." });
  }

  try {
    const team = String(req.body?.team || "CBE").trim().toUpperCase();
    const action = String(req.body?.action || "mark").trim().toLowerCase();

    if (!["CBE", "BLR", "BOTH", "ALL"].includes(team)) {
      return res.status(400).json({ error: "Invalid team. Allowed: CBE, BLR, BOTH." });
    }
    if (!["mark", "unmark"].includes(action)) {
      return res.status(400).json({ error: "Invalid action. Allowed: mark, unmark." });
    }

    const allPeople = await getPeople();
    const targetPeople = allPeople.filter((p) => {
      if (team === "BOTH" || team === "ALL") return true;
      return (p.team || "CBE").toUpperCase() === team;
    });

    if (targetPeople.length === 0) {
      return res.status(400).json({ error: `No members found for team ${team}.` });
    }

    const spreadsheetId = process.env.SPREADSHEET_ID;
    if (!spreadsheetId) {
      return res.status(500).json({ error: "SPREADSHEET_ID environment variable is not configured." });
    }

    const sheetName = getCurrentSheetName();
    await ensureSheetExists(spreadsheetId, sheetName);

    const readRes = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${sheetName}!A1:ZZ1000`,
    });

    let rows = readRes.data.values || [];
    if (rows.length === 0) {
      return res.status(400).json({ error: "Sheet has no rows." });
    }

    let headers = rows[0] || ["Date"];
    const validTodayKeys = getValidTodayKeys();
    let targetRowIndex = -1;

    for (let i = 1; i < rows.length; i++) {
      const cellDate = String(rows[i][0] || "").trim().toLowerCase();
      if (validTodayKeys.includes(cellDate)) {
        targetRowIndex = i + 1; // 1-indexed for Sheets
        break;
      }
    }

    if (targetRowIndex === -1) {
      return res.status(400).json({
        error: `Today's date was not found in Column A for tab '${sheetName}'.`,
      });
    }

    // Ensure all target people exist in headers
    let headerUpdated = false;
    for (const person of targetPeople) {
      const colIdx = headers.findIndex(
        (h) => String(h || "").trim().toLowerCase() === person.name.toLowerCase()
      );
      if (colIdx === -1) {
        headers.push(person.name);
        headerUpdated = true;
      }
    }

    if (headerUpdated) {
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `${sheetName}!A1:${getColumnLetter(headers.length - 1)}1`,
        valueInputOption: "USER_ENTERED",
        requestBody: { values: [headers] },
      });
    }

    // Build batch updates
    const updates = [];
    const affectedNames = [];

    for (const person of targetPeople) {
      const colIdx = headers.findIndex(
        (h) => String(h || "").trim().toLowerCase() === person.name.toLowerCase()
      );
      if (colIdx === -1) continue;

      const colLetter = getColumnLetter(colIdx);
      const cellRange = `${sheetName}!${colLetter}${targetRowIndex}`;

      if (action === "unmark") {
        const currentVal = String(rows[targetRowIndex - 1]?.[colIdx] || "").trim().toLowerCase();
        // Only clear if cell is currently "holiday" to avoid erasing actual tasks
        if (currentVal === "holiday") {
          updates.push({
            range: cellRange,
            values: [[""]],
          });
          affectedNames.push(person.name);
        }
      } else {
        updates.push({
          range: cellRange,
          values: [["Holiday"]],
        });
        affectedNames.push(person.name);
      }
    }

    if (updates.length > 0) {
      await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId,
        requestBody: {
          valueInputOption: "USER_ENTERED",
          data: updates,
        },
      });
    }

    const teamLabel = team === "BOTH" || team === "ALL" ? "Both Locations (CBE & BLR)" : `${team} Team`;
    const message = action === "unmark"
      ? `Holiday status removed for ${affectedNames.length} member(s) of ${teamLabel}.`
      : `Marked today as Holiday for ${affectedNames.length} member(s) of ${teamLabel}.`;

    return res.status(200).json({
      success: true,
      message,
      team,
      action,
      count: affectedNames.length,
      people: affectedNames,
    });
  } catch (error) {
    console.error("Team holiday error:", error);
    return res.status(500).json({ error: error.message || "Unable to update team holiday." });
  }
};

