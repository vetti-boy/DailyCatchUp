const { Redis } = require("@upstash/redis");

const REDIS_PREFIX = "dailycatchup";
const REDIS_NAMES_KEY = `${REDIS_PREFIX}:options:names`;
const REDIS_PROJECTS_KEY = `${REDIS_PREFIX}:options:projects`;
const REDIS_PEOPLE_KEY = `${REDIS_PREFIX}:people`;
const REDIS_PEOPLE_TEAMS_KEY = `${REDIS_PREFIX}:people:teams`;
const REDIS_POSTED_STATUS_KEY = `${REDIS_PREFIX}:posted-status`;
const APP_TIME_ZONE = process.env.APP_TIME_ZONE || "Asia/Kolkata";

const redisUrl = process.env.UPSTASH_REDIS_REST_KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const redisToken = process.env.UPSTASH_REDIS_REST_KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const redis = redisUrl && redisToken ? new Redis({ url: redisUrl, token: redisToken }) : null;

const HYPHEN_REGEX = /[-–—−‑‒―\u2010-\u2015\u2212\uFE63\uFF0D]/;
const HYPHEN_GLOBAL_REGEX = /[-–—−‑‒―\u2010-\u2015\u2212\uFE63\uFF0D]/g;

function sortValues(values) {
  return [...new Set(values || [])].sort((a, b) =>
    String(a).localeCompare(String(b), undefined, { sensitivity: "base" })
  );
}

function sortOptions(data) {
  return { names: sortValues(data.names), projects: sortValues(data.projects) };
}

function requireRedis() {
  if (!redis) throw new Error("Persistent Redis storage is not configured on this deployment.");
}

async function ensureRedisInitialized() {
  requireRedis();
  const [names, teams, projects] = await Promise.all([
    redis.smembers(REDIS_NAMES_KEY),
    redis.hgetall(REDIS_PEOPLE_TEAMS_KEY),
    redis.smembers(REDIS_PROJECTS_KEY),
  ]);
  const missingMap = {};
  for (const name of names || []) {
    if (!teams || !teams[name]) {
      missingMap[name] = getDefaultTeam(name);
    }
  }
  if (Object.keys(missingMap).length > 0) {
    await redis.hset(REDIS_PEOPLE_TEAMS_KEY, missingMap);
  }

  // Automatically sanitize any existing project names in Redis that contain hyphens
  for (const proj of projects || []) {
    if (HYPHEN_REGEX.test(proj)) {
      const sanitized = proj.replace(HYPHEN_GLOBAL_REGEX, " ").replace(/\s+/g, " ").trim();
      await redis.srem(REDIS_PROJECTS_KEY, proj);
      if (sanitized) {
        await redis.sadd(REDIS_PROJECTS_KEY, sanitized);
      }
    }
  }

  // Ensure posted-status hash key exists so it is visible in Redis Data Browser
  const statusExists = await redis.exists(REDIS_POSTED_STATUS_KEY);
  if (!statusExists) {
    await redis.hset(REDIS_POSTED_STATUS_KEY, {
      initialized: "true",
      lastPostedDate: "",
    });
  }
}

async function getOptions() {
  requireRedis();
  await ensureRedisInitialized();
  const [names, projects] = await Promise.all([
    redis.smembers(REDIS_NAMES_KEY),
    redis.smembers(REDIS_PROJECTS_KEY),
  ]);
  return sortOptions({ names: names || [], projects: projects || [] });
}

async function addOption(type, value) {
  const normalized = String(value || "").trim();
  if (type === "project" && HYPHEN_REGEX.test(normalized)) {
    const err = new Error("Hyphens (-) are not allowed in project names.");
    err.status = 400;
    throw err;
  }
  if (!normalized) return getOptions();
  requireRedis();
  await ensureRedisInitialized();
  await redis.sadd(type === "name" ? REDIS_NAMES_KEY : REDIS_PROJECTS_KEY, normalized);
  return getOptions();
}

async function deleteOption(type, value) {
  const normalized = String(value || "").trim();
  requireRedis();
  await ensureRedisInitialized();
  await redis.srem(type === "name" ? REDIS_NAMES_KEY : REDIS_PROJECTS_KEY, normalized);
  if (type === "name") {
    await Promise.all([
      redis.hdel(REDIS_PEOPLE_KEY, normalized),
      redis.hdel(REDIS_PEOPLE_TEAMS_KEY, normalized),
    ]);
  }
  return getOptions();
}

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function getDefaultTeam(name) {
  const n = String(name || "").trim().toLowerCase();
  if (n === "manoj" || n === "sharath" || n.includes("sriram")) {
    return "BLR";
  }
  return "CBE";
}

function normalizeTeam(team, name) {
  const t = String(team || "").trim().toUpperCase();
  if (t === "BLR" || t === "CBE") return t;
  return getDefaultTeam(name);
}

function validatePerson(name, email, team) {
  const cleanName = String(name || "").trim();
  const cleanEmail = normalizeEmail(email);
  if (!cleanName) throw new Error("Name is required.");
  if (!/^\S+@\S+\.\S+$/.test(cleanEmail)) throw new Error("A valid email address is required.");
  const cleanTeam = normalizeTeam(team, cleanName);
  return { name: cleanName, email: cleanEmail, team: cleanTeam };
}

async function getPeople() {
  requireRedis();
  await ensureRedisInitialized();
  const [names, emails, teams] = await Promise.all([
    redis.smembers(REDIS_NAMES_KEY),
    redis.hgetall(REDIS_PEOPLE_KEY),
    redis.hgetall(REDIS_PEOPLE_TEAMS_KEY),
  ]);

  return sortValues(names || []).map((name) => {
    const rawTeam = teams && teams[name] ? String(teams[name]).trim().toUpperCase() : "";
    const team = rawTeam === "BLR" || rawTeam === "CBE" ? rawTeam : getDefaultTeam(name);
    return {
      name,
      email: emails && emails[name] ? String(emails[name]) : "",
      team,
    };
  });
}

async function upsertPerson(name, email, team) {
  const person = validatePerson(name, email, team);
  requireRedis();
  await ensureRedisInitialized();
  await Promise.all([
    redis.sadd(REDIS_NAMES_KEY, person.name),
    redis.hset(REDIS_PEOPLE_KEY, { [person.name]: person.email }),
    redis.hset(REDIS_PEOPLE_TEAMS_KEY, { [person.name]: person.team }),
  ]);
  return getPeople();
}

async function deletePerson(name) {
  const cleanName = String(name || "").trim();
  if (!cleanName) throw new Error("Name is required.");
  requireRedis();
  await ensureRedisInitialized();
  await Promise.all([
    redis.srem(REDIS_NAMES_KEY, cleanName),
    redis.hdel(REDIS_PEOPLE_KEY, cleanName),
    redis.hdel(REDIS_PEOPLE_TEAMS_KEY, cleanName),
  ]);
  return getPeople();
}

function holidayKey(year) {
  return `${REDIS_PREFIX}:holidays:${year}`;
}

function validateYear(year) {
  const y = String(year || "").trim();
  if (!/^\d{4}$/.test(y)) throw new Error("A valid 4-digit year is required.");
  return y;
}

function validateDate(date, year) {
  let d = String(date || "").trim();
  const y = validateYear(year);

  // Normalize YYYY-M-D, YYYY/MM/DD, DD-MM-YYYY to standard YYYY-MM-DD
  const parts = d.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (parts) {
    d = `${parts[1]}-${parts[2].padStart(2, "0")}-${parts[3].padStart(2, "0")}`;
  } else {
    const reverseParts = d.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
    if (reverseParts) {
      d = `${reverseParts[3]}-${reverseParts[2].padStart(2, "0")}-${reverseParts[1].padStart(2, "0")}`;
    }
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || d.slice(0, 4) !== y)
    throw new Error(`Holiday date must be YYYY-MM-DD for year ${y}. Got: "${date}"`);
  const parsed = new Date(`${d}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== d)
    throw new Error("Invalid holiday date.");
  return d;
}

function normalizeHoliday(raw, fieldDate) {
  if (raw == null && !fieldDate) return null;
  if (typeof raw === "object" && raw !== null) {
    const date = String(raw.date || fieldDate || "").trim();
    const name = String(raw.name || raw.title || "").trim();
    return date && name ? { date, name } : null;
  }
  if (fieldDate) {
    const value = String(raw || "").trim();
    if (!value) return null;
    try {
      const parsed = JSON.parse(value);
      if (parsed && typeof parsed === "object") return normalizeHoliday(parsed, fieldDate);
    } catch {}
    return { date: String(fieldDate), name: value };
  }
  return null;
}

function normalizeHolidayCollection(value) {
  if (value == null) return [];
  let parsed = value;
  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value);
    } catch {
      return [];
    }
  }
  if (Array.isArray(parsed)) return parsed.map((v) => normalizeHoliday(v)).filter(Boolean);
  if (parsed && typeof parsed === "object") {
    if (Array.isArray(parsed.holidays))
      return parsed.holidays.map((v) => normalizeHoliday(v)).filter(Boolean);
    return Object.entries(parsed)
      .map(([date, name]) => normalizeHoliday(name, date))
      .filter(Boolean);
  }
  return [];
}

async function getHolidays(year) {
  requireRedis();
  const y = validateYear(year);
  await ensureRedisInitialized();
  const key = holidayKey(y);
  const keyType = String((await redis.type(key)) || "none").toLowerCase();
  let holidays = [];
  if (keyType === "none") return [];
  if (keyType === "hash") {
    const hash = await redis.hgetall(key);
    holidays = Object.entries(hash || {})
      .map(([date, value]) => normalizeHoliday(value, date))
      .filter(Boolean);
  } else if (keyType === "set") {
    const values = await redis.smembers(key);
    holidays = (values || [])
      .map((v) => {
        try {
          return normalizeHoliday(JSON.parse(v));
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  } else if (keyType === "string") {
    holidays = normalizeHolidayCollection(await redis.get(key));
  } else if (keyType === "json") {
    holidays = normalizeHolidayCollection(await redis.json.get(key));
  } else {
    throw new Error(`Unsupported Redis type for ${key}: ${keyType}`);
  }
  return holidays.sort((a, b) => a.date.localeCompare(b.date));
}

async function addHoliday(year, date, name) {
  requireRedis();
  const y = validateYear(year);
  const d = validateDate(date, y);
  const n = String(name || "").trim();
  if (!n) throw new Error("Holiday name is required.");
  await ensureRedisInitialized();
  const key = holidayKey(y);
  const keyType = String((await redis.type(key)) || "none").toLowerCase();
  if (keyType === "none" || keyType === "hash") {
    await redis.hset(key, { [d]: n });
  } else {
    const existing = await getHolidays(y);
    await redis.del(key);
    const fields = {};
    for (const h of existing) fields[h.date] = h.name;
    fields[d] = n;
    await redis.hset(key, fields);
  }
  return getHolidays(y);
}

async function deleteHoliday(year, date) {
  requireRedis();
  const y = validateYear(year);
  const d = validateDate(date, y);
  await ensureRedisInitialized();
  const key = holidayKey(y);
  const keyType = String((await redis.type(key)) || "none").toLowerCase();
  if (keyType === "none") return [];
  if (keyType === "hash") {
    await redis.hdel(key, d);
  } else {
    const remaining = (await getHolidays(y)).filter((h) => h.date !== d);
    await redis.del(key);
    if (remaining.length) {
      const fields = {};
      for (const h of remaining) fields[h.date] = h.name;
      await redis.hset(key, fields);
    }
  }
  return getHolidays(y);
}

function getZonedTodayDate(timeZone = APP_TIME_ZONE) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());

  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function formatDisplayDate(dateStr) {
  if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return dateStr || "";
  const [y, m, d] = dateStr.split("-");
  const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const mIndex = parseInt(m, 10) - 1;
  return `${parseInt(d, 10)}-${monthNames[mIndex] || m}-${y.slice(-2)}`;
}

async function getPostedStatus(targetDate) {
  requireRedis();
  await ensureRedisInitialized();
  const today = getZonedTodayDate();
  const dateToCheck = targetDate ? String(targetDate).trim() : today;

  const hash = (await redis.hgetall(REDIS_POSTED_STATUS_KEY)) || {};
  const lastPostedDate = hash.lastPostedDate ? String(hash.lastPostedDate).trim() : null;
  const lastPostedTime = hash.lastPostedTime ? String(hash.lastPostedTime).trim() : null;
  const lastPostedBy = hash.lastPostedBy ? String(hash.lastPostedBy).trim() : null;

  let isPosted = false;
  let dateMeta = null;

  if (hash[dateToCheck]) {
    try {
      dateMeta = typeof hash[dateToCheck] === "string" ? JSON.parse(hash[dateToCheck]) : hash[dateToCheck];
      isPosted = Boolean(dateMeta && (dateMeta.posted === true || dateMeta.posted === "true"));
    } catch {
      isPosted = hash[dateToCheck] === "true" || hash[dateToCheck] === true || hash[dateToCheck] === "1";
    }
  } else if (lastPostedDate && lastPostedDate === dateToCheck) {
    isPosted = true;
  }

  return {
    date: dateToCheck,
    formattedDate: formatDisplayDate(dateToCheck),
    today,
    isPosted,
    status: isPosted ? "POSTED" : "NOT_POSTED",
    lastPostedDate,
    lastPostedTime: dateMeta?.timestamp || (isPosted ? lastPostedTime : null),
    lastPostedBy: dateMeta?.by || (isPosted ? lastPostedBy : null),
  };
}

async function setPostedStatus({ date, posted = true, by = "PowerAutomate" } = {}) {
  requireRedis();
  await ensureRedisInitialized();
  const today = getZonedTodayDate();
  const targetDate = date ? String(date).trim() : today;
  const now = new Date().toISOString();

  if (posted && String(posted) !== "false") {
    const meta = { posted: true, timestamp: now, by: by || "PowerAutomate" };
    await redis.hset(REDIS_POSTED_STATUS_KEY, {
      [targetDate]: JSON.stringify(meta),
      lastPostedDate: targetDate,
      lastPostedTime: now,
      lastPostedBy: by || "PowerAutomate",
    });
  } else {
    await redis.hdel(REDIS_POSTED_STATUS_KEY, targetDate);
    const lastDate = await redis.hget(REDIS_POSTED_STATUS_KEY, "lastPostedDate");
    if (lastDate === targetDate) {
      await redis.hdel(REDIS_POSTED_STATUS_KEY, "lastPostedDate", "lastPostedTime", "lastPostedBy");
    }
  }

  return getPostedStatus(targetDate);
}

async function resetPostedStatus(date) {
  return setPostedStatus({ date, posted: false });
}

module.exports = {
  getOptions,
  addOption,
  deleteOption,
  getPeople,
  upsertPerson,
  deletePerson,
  getHolidays,
  addHoliday,
  deleteHoliday,
  getDefaultTeam,
  getPostedStatus,
  setPostedStatus,
  resetPostedStatus,
  getZonedTodayDate,
  formatDisplayDate,
  isRedisConfigured: Boolean(redis),
};
