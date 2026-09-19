require("dotenv").config();

const express = require("express");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const { Pool } = require("pg");

const app = express();

const PORT = Number(process.env.PORT || 10000);
const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_CHAT_ID = String(process.env.CHAT_ID || "");
const ADMIN_USER_ID = String(
  process.env.ADMIN_USER_ID || process.env.CHAT_ID || ""
);
const DATABASE_URL = process.env.DATABASE_URL;

if (!BOT_TOKEN) {
  console.error("XATO: BOT_TOKEN Render Environment Variables ichida topilmadi.");
  process.exit(1);
}

if (!ADMIN_CHAT_ID) {
  console.error("XATO: CHAT_ID Render Environment Variables ichida topilmadi.");
  process.exit(1);
}

if (!ADMIN_USER_ID) {
  console.error(
    "XATO: ADMIN_USER_ID Render Environment Variables ichida topilmadi."
  );
  process.exit(1);
}

if (!DATABASE_URL) {
  console.error(
    "XATO: DATABASE_URL Render Environment Variables ichida topilmadi."
  );
  process.exit(1);
}

/* ===================== SECURITY ===================== */

app.disable("x-powered-by");

app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false
  })
);

app.use(express.json({ limit: "20kb" }));

const bookingLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: {
    ok: false,
    error:
      "Juda ko'p so'rov yuborildi. Iltimos, birozdan keyin qayta urinib ko'ring."
  }
});

/* ===================== DATABASE ===================== */

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 5,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000
});

async function initDatabase() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS bookings (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      phone TEXT NOT NULL,
      service_title TEXT NOT NULL,
      tariff_name TEXT,
      tariff_price NUMERIC,
      doctor_id TEXT,
      day_label TEXT,
      date_iso DATE,
      slot TEXT,
      status TEXT DEFAULT 'Kutilmoqda',
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await pool.query(`
    ALTER TABLE bookings
    ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'Kutilmoqda'
  `);

  console.log("PostgreSQL: bookings jadvali tayyor");
}

/* ===================== TELEGRAM ===================== */

async function telegram(method, body = {}) {
  const response = await fetch(
    `https://api.telegram.org/bot${BOT_TOKEN}/${method}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body)
    }
  );

  const data = await response.json();

  if (!data.ok) {
    throw new Error(
      data.description || `Telegram API xatosi: ${method}`
    );
  }

  return data.result;
}

async function sendTelegramMessage(chatId, text, extra = {}) {
  return telegram("sendMessage", {
    chat_id: chatId,
    text,
    ...extra
  });
}

async function answerCallbackQuery(callbackQueryId, text = "") {
  return telegram("answerCallbackQuery", {
    callback_query_id: callbackQueryId,
    text
  });
}

async function editTelegramMessage(
  chatId,
  messageId,
  text,
  extra = {}
) {
  return telegram("editMessageText", {
    chat_id: chatId,
    message_id: messageId,
    text,
    ...extra
  });
}

async function deleteTelegramMessage(chatId, messageId) {
  return telegram("deleteMessage", {
    chat_id: chatId,
    message_id: messageId
  });
}

function bookingButtons(id) {
  return {
    inline_keyboard: [
      [
        {
          text: "✅ Tasdiqlash",
          callback_data: `confirm:${id}`
        },
        {
          text: "❌ Bekor qilish",
          callback_data: `cancel:${id}`
        }
      ],
      [
        {
          text: "🗑️ O‘chirish",
          callback_data: `delete:${id}`
        }
      ]
    ]
  };
}

/* ===================== VALIDATION ===================== */

const ALLOWED_DOCTORS = new Set([
  "karimov",
  "aliyeva",
  "rahimov",
  "yusupova",
  "nazarov"
]);

const ALLOWED_SERVICES = new Set([
  "Terapevtik davolash",
  "Professional tozalash",
  "Implantatsiya",
  "Ortopediya (protez, vinir)",
  "Ortodontiya",
  "Bolalar stomatologiyasi"
]);

const ALLOWED_TARIFFS = {
  Standart: new Set([
    150000,
    180000,
    250000,
    900000,
    3500000,
    4000000
  ]),

  Komfort: new Set([
    220000,
    280000,
    380000,
    1400000,
    5200000,
    6500000
  ]),

  Premium: new Set([
    320000,
    400000,
    550000,
    2100000,
    7800000,
    9000000
  ])
};

const ALLOWED_SLOTS = new Set([
  "09:00",
  "10:00",
  "11:00",
  "12:00",
  "14:00",
  "15:00",
  "16:00",
  "17:00",
  "18:00",
  "19:00"
]);

function isValidId(value) {
  return (
    typeof value === "string" &&
    value.length >= 10 &&
    value.length <= 100 &&
    /^[a-zA-Z0-9_-]+$/.test(value)
  );
}

function cleanText(value, max = 200) {
  if (typeof value !== "string") return "";

  return value
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, max);
}

function isValidName(name) {
  if (!name || name.length < 2 || name.length > 100) {
    return false;
  }

  return /^[\p{L}\p{M}0-9 .'-]+$/u.test(name);
}

function isValidPhone(phone) {
  return /^\+998\d{9}$/.test(phone);
}

function isValidDateISO(value) {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value)
  ) {
    return false;
  }

  const date = new Date(`${value}T00:00:00Z`);

  return (
    !Number.isNaN(date.getTime()) &&
    date.toISOString().slice(0, 10) === value
  );
}

function isValidDayLabel(value) {
  return (
    typeof value === "string" &&
    value.length >= 3 &&
    value.length <= 50 &&
    /^[\p{L}\p{M}0-9., :'-]+$/u.test(value)
  );
}

/* ===================== HEALTH ===================== */

app.get("/health", async (req, res) => {
  try {
    await pool.query("SELECT 1");

    res.json({
      ok: true,
      database: "ok"
    });
  } catch (error) {
    console.error("Health database error:", error.message);

    res.status(503).json({
      ok: false,
      database: "error"
    });
  }
});

/* ===================== BOOKING API ===================== */

app.post(
  "/api/bookings",
  bookingLimiter,
  async (req, res) => {
    try {
      const body = req.body || {};

      const id = cleanText(body.id, 100);
      const name = cleanText(body.name, 100);
      const phone = cleanText(body.phone, 30);
      const serviceTitle = cleanText(
        body.serviceTitle,
        100
      );
      const tariffName = cleanText(
        body.tariffName,
        30
      );
      const doctorId = cleanText(
        body.doctorId,
        30
      );
      const dayLabel = cleanText(
        body.dayLabel,
        50
      );
      const dateISO = cleanText(
        body.dateISO,
        10
      );
      const slot = cleanText(
        body.slot,
        10
      );

      const tariffPrice = Number(body.tariffPrice);

      if (!isValidId(id)) {
        return res.status(400).json({
          ok: false,
          error: "Booking ID noto'g'ri."
        });
      }

      if (!isValidName(name)) {
        return res.status(400).json({
          ok: false,
          error: "Ism noto'g'ri."
        });
      }

      if (!isValidPhone(phone)) {
        return res.status(400).json({
          ok: false,
          error:
            "Telefon raqami +998XXXXXXXXX formatida bo'lishi kerak."
        });
      }

      if (!ALLOWED_SERVICES.has(serviceTitle)) {
        return res.status(400).json({
          ok: false,
          error: "Xizmat turi noto'g'ri."
        });
      }

      if (!ALLOWED_DOCTORS.has(doctorId)) {
        return res.status(400).json({
          ok: false,
          error: "Shifokor noto'g'ri."
        });
      }

      if (
        !Object.prototype.hasOwnProperty.call(
          ALLOWED_TARIFFS,
          tariffName
        )
      ) {
        return res.status(400).json({
          ok: false,
          error: "Tarif noto'g'ri."
        });
      }

      if (
        !Number.isSafeInteger(tariffPrice) ||
        !ALLOWED_TARIFFS[tariffName].has(tariffPrice)
      ) {
        return res.status(400).json({
          ok: false,
          error: "Tarif narxi noto'g'ri."
        });
      }

      if (!isValidDayLabel(dayLabel)) {
        return res.status(400).json({
          ok: false,
          error: "Sana ma'lumoti noto'g'ri."
        });
      }

      if (!isValidDateISO(dateISO)) {
        return res.status(400).json({
          ok: false,
          error: "Sana formati noto'g'ri."
        });
      }

      if (!ALLOWED_SLOTS.has(slot)) {
        return res.status(400).json({
          ok: false,
          error: "Vaqt noto'g'ri."
        });
      }

      const existing = await pool.query(
        "SELECT id FROM bookings WHERE id = $1 LIMIT 1",
        [id]
      );

      if (existing.rowCount > 0) {
        return res.status(409).json({
          ok: false,
          error: "Bu booking allaqachon mavjud."
        });
      }

      await pool.query(
        `
        INSERT INTO bookings
        (
          id,
          name,
          phone,
          service_title,
          tariff_name,
          tariff_price,
          doctor_id,
          day_label,
          date_iso,
          slot,
          status
        )
        VALUES
        (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'Kutilmoqda'
        )
        `,
        [
          id,
          name,
          phone,
          serviceTitle,
          tariffName,
          tariffPrice,
          doctorId,
          dayLabel,
          dateISO,
          slot
        ]
      );

      const telegramText =
        `🦷 YANGI NAVBAT\n\n` +
        `👤 Ism: ${name}\n` +
        `📞 Telefon: ${phone}\n` +
        `🩺 Xizmat: ${serviceTitle}\n` +
        `💳 Tarif: ${tariffName}\n` +
        `💰 Narx: ${tariffPrice.toLocaleString(
          "ru-RU"
        )} so'm\n` +
        `👨‍⚕️ Shifokor: ${doctorId}\n` +
        `📅 Sana: ${dayLabel}\n` +
        `⏰ Vaqt: ${slot}\n\n` +
        `🆔 ID: ${id}\n` +
        `📌 Status: Kutilmoqda`;

      try {
        await sendTelegramMessage(
          ADMIN_CHAT_ID,
          telegramText,
          {
            reply_markup: bookingButtons(id)
          }
        );
      } catch (telegramError) {
        console.error(
          "Telegram xatosi:",
          telegramError.message
        );
      }

      return res.status(201).json({
        ok: true,
        id
      });
    } catch (error) {
      console.error(
        "Booking API error:",
        error.message
      );

      return res.status(500).json({
        ok: false,
        error:
          "Server xatosi. Iltimos, keyinroq qayta urinib ko'ring."
      });
    }
  }
);

/* ===================== ADMIN SECURITY ===================== */

function isAdmin(chatId, userId) {
  return (
    String(chatId || "") === ADMIN_CHAT_ID &&
    String(userId || "") === ADMIN_USER_ID
  );
}

/* ===================== CALLBACK ===================== */

async function handleCallbackQuery(
  callbackQuery
) {
  const chatId = String(
    callbackQuery.message?.chat?.id || ""
  );

  const userId = String(
    callbackQuery.from?.id || ""
  );

  const messageId =
    callbackQuery.message?.message_id;

  const data =
    callbackQuery.data || "";

  if (!isAdmin(chatId, userId)) {
    await answerCallbackQuery(
      callbackQuery.id,
      "Sizda bu amalni bajarish huquqi yo'q."
    );

    return;
  }

  const match =
    /^(confirm|cancel|delete):([a-zA-Z0-9_-]+)$/
      .exec(data);

  if (!match) {
    await answerCallbackQuery(
      callbackQuery.id,
      "Noma'lum amal."
    );

    return;
  }

  const action = match[1];
  const bookingId = match[2];

  try {
    const result = await pool.query(
      `
      SELECT
        id,
        name,
        phone,
        service_title,
        tariff_name,
        tariff_price,
        doctor_id,
        day_label,
        slot,
        status
      FROM bookings
      WHERE id = $1
      `,
      [bookingId]
    );

    if (result.rowCount === 0) {
      await answerCallbackQuery(
        callbackQuery.id,
        "Navbat topilmadi."
      );

      return;
    }

    const booking = result.rows[0];

    if (action === "delete") {
      await pool.query(
        "DELETE FROM bookings WHERE id = $1",
        [bookingId]
      );

      try {
        await deleteTelegramMessage(
          chatId,
          messageId
        );
      } catch (_) {
        await editTelegramMessage(
          chatId,
          messageId,
          `${messageText(
            booking
          )}\n\n🗑️ O‘chirildi.`
        );
      }

      await answerCallbackQuery(
        callbackQuery.id,
        "Navbat o‘chirildi."
      );

      return;
    }

    const newStatus =
      action === "confirm"
        ? "Tasdiqlangan"
        : "Bekor qilingan";

    await pool.query(
      `
      UPDATE bookings
      SET status = $1
      WHERE id = $2
      `,
      [newStatus, bookingId]
    );

    await editTelegramMessage(
      chatId,
      messageId,
      `${messageText(
        booking
      )}\n\n📌 Status: ${newStatus}`
    );

    await answerCallbackQuery(
      callbackQuery.id,
      action === "confirm"
        ? "Navbat tasdiqlandi."
        : "Navbat bekor qilindi."
    );
  } catch (error) {
    console.error(
      "Callback error:",
      error.message
    );

    await answerCallbackQuery(
      callbackQuery.id,
      "Amalni bajarishda xatolik yuz berdi."
    );
  }
}

function messageText(booking) {
  return (
    `🦷 NAVBAT\n\n` +
    `👤 Ism: ${booking.name}\n` +
    `📞 Telefon: ${booking.phone}\n` +
    `🩺 Xizmat: ${booking.service_title}\n` +
    `💳 Tarif: ${booking.tariff_name}\n` +
    `💰 Narx: ${Number(
      booking.tariff_price
    ).toLocaleString("ru-RU")} so'm\n` +
    `👨‍⚕️ Shifokor: ${booking.doctor_id}\n` +
    `📅 Sana: ${booking.day_label}\n` +
    `⏰ Vaqt: ${booking.slot}\n` +
    `🆔 ID: ${booking.id}`
  );
}

/* ===================== LIST COMMANDS ===================== */

async function sendBookingList(
  chatId,
  userId,
  whereSql = "",
  params = [],
  title = "NAVBATLAR"
) {
  if (!isAdmin(chatId, userId)) {
    return;
  }

  const result = await pool.query(
    `
    SELECT
      id,
      name,
      phone,
      service_title,
      tariff_name,
      tariff_price,
      doctor_id,
      day_label,
      slot,
      status
    FROM bookings
    ${whereSql}
    ORDER BY
      date_iso ASC NULLS LAST,
      slot ASC NULLS LAST,
      created_at DESC
    `,
    params
  );

  if (result.rowCount === 0) {
    await sendTelegramMessage(
      chatId,
      `📭 ${title}\n\nHozircha navbatlar yo'q.`
    );

    return;
  }

  const lines = [
    `📋 ${title}`,
    `Jami: ${result.rowCount}`,
    ""
  ];

  for (const b of result.rows) {
    lines.push(
      `👤 ${b.name}`,
      `📞 ${b.phone}`,
      `🩺 ${b.service_title}`,
      `💳 ${b.tariff_name} — ${Number(
        b.tariff_price
      ).toLocaleString("ru-RU")} so'm`,
      `👨‍⚕️ ${b.doctor_id}`,
      `📅 ${b.day_label} — ${b.slot}`,
      `📌 ${b.status}`,
      `🆔 ${b.id}`,
      "────────────"
    );
  }

  await sendLongTelegramMessage(
    chatId,
    lines.join("\n")
  );
}

async function sendLongTelegramMessage(
  chatId,
  text
) {
  const maxLength = 3800;

  for (
    let i = 0;
    i < text.length;
    i += maxLength
  ) {
    await sendTelegramMessage(
      chatId,
      text.slice(i, i + maxLength)
    );
  }
}

/* ===================== STATISTICS ===================== */

async function sendStatistics(
  chatId,
  userId
) {
  if (!isAdmin(chatId, userId)) {
    return;
  }

  const result = await pool.query(`
    SELECT
      COUNT(*)::int AS total,

      COUNT(*) FILTER (
        WHERE status = 'Kutilmoqda'
      )::int AS pending,

      COUNT(*) FILTER (
        WHERE status = 'Tasdiqlangan'
      )::int AS confirmed,

      COUNT(*) FILTER (
        WHERE status = 'Bekor qilingan'
      )::int AS cancelled,

      COUNT(*) FILTER (
        WHERE date_iso =
        (
          CURRENT_TIMESTAMP
          AT TIME ZONE 'Asia/Tashkent'
        )::date
      )::int AS today,

      COUNT(*) FILTER (
        WHERE date_iso >=
        date_trunc(
          'month',
          CURRENT_TIMESTAMP
          AT TIME ZONE 'Asia/Tashkent'
        )::date

        AND date_iso <
        (
          date_trunc(
            'month',
            CURRENT_TIMESTAMP
            AT TIME ZONE 'Asia/Tashkent'
          ) + INTERVAL '1 month'
        )::date
      )::int AS month

    FROM bookings
  `);

  const s = result.rows[0];

  await sendTelegramMessage(
    chatId,
    `📊 STATISTIKA\n\n` +
      `📋 Jami: ${s.total}\n` +
      `⏳ Kutilmoqda: ${s.pending}\n` +
      `✅ Tasdiqlangan: ${s.confirmed}\n` +
      `❌ Bekor qilingan: ${s.cancelled}\n` +
      `📅 Bugun: ${s.today}\n` +
      `🗓️ Shu oy: ${s.month}`
  );
}

async function sendDoctorsStatistics(
  chatId,
  userId
) {
  if (!isAdmin(chatId, userId)) {
    return;
  }

  const result = await pool.query(`
    SELECT
      COALESCE(
        NULLIF(doctor_id, ''),
        'Noma'lum'
      ) AS doctor,

      COUNT(*)::int AS total,

      COUNT(*) FILTER (
        WHERE status = 'Kutilmoqda'
      )::int AS pending,

      COUNT(*) FILTER (
        WHERE status = 'Tasdiqlangan'
      )::int AS confirmed,

      COUNT(*) FILTER (
        WHERE status = 'Bekor qilingan'
      )::int AS cancelled

    FROM bookings

    GROUP BY doctor_id

    ORDER BY
      total DESC,
      doctor ASC
  `);

  if (result.rowCount === 0) {
    await sendTelegramMessage(
      chatId,
      "👨‍⚕️ Shifokorlar bo'yicha hali ma'lumot yo'q."
    );

    return;
  }

  const lines = [
    "👨‍⚕️ SHIFOKORLAR BO‘YICHA STATISTIKA",
    ""
  ];

  for (const row of result.rows) {
    lines.push(
      `👨‍⚕️ ${row.doctor}`,
      `📋 Jami: ${row.total}`,
      `⏳ Kutilmoqda: ${row.pending}`,
      `✅ Tasdiqlangan: ${row.confirmed}`,
      `❌ Bekor: ${row.cancelled}`,
      "────────────"
    );
  }

  await sendLongTelegramMessage(
    chatId,
    lines.join("\n")
  );
}

/* ===================== TELEGRAM POLLING ===================== */

let telegramOffset = 0;
let pollingRunning = false;

async function handleTelegramUpdate(update) {
  if (update.callback_query) {
    await handleCallbackQuery(
      update.callback_query
    );

    return;
  }

  const message = update.message;

  if (!message?.text) {
    return;
  }

  const chatId = String(
    message.chat.id
  );

  const userId = String(
    message.from?.id || ""
  );

  const text = message.text.trim();

  /*
    MUHIM:
    Endi faqat chat ID emas,
    chat ID + user ID birgalikda tekshiriladi.
  */
  if (!isAdmin(chatId, userId)) {
    await sendTelegramMessage(
      chatId,
      "⛔ Bu bot faqat administrator uchun."
    );

    return;
  }

  const command = text
    .split(/\s+/)[0]
    .toLowerCase();

  if (command === "/start") {
    await sendTelegramMessage(
      chatId,
      `🦷 Farg‘ona stomatologiya admin botiga xush kelibsiz!\n\n` +
        `/yordam — buyruqlar ro‘yxati\n` +
        `/navbatlar — barcha navbatlar\n` +
        `/bugun — bugungi navbatlar\n` +
        `/ertaga — ertangi navbatlar\n` +
        `/oy — shu oydagi navbatlar\n` +
        `/statistika — umumiy statistika\n` +
        `/shifokorlar — shifokorlar statistikasi`
    );

    return;
  }

  if (command === "/yordam") {
    await sendTelegramMessage(
      chatId,
      `📚 BUYRUQLAR\n\n` +
        `/navbatlar — barcha navbatlar\n` +
        `/bugun — bugungi navbatlar\n` +
        `/ertaga — ertangi navbatlar\n` +
        `/oy — shu oydagi navbatlar\n` +
        `/statistika — umumiy statistika\n` +
        `/shifokorlar — shifokorlar statistikasi`
    );

    return;
  }

  if (command === "/navbatlar") {
    await sendBookingList(
      chatId,
      userId,
      "",
      [],
      "BARCHA NAVBATLAR"
    );

    return;
  }

  if (command === "/bugun") {
    await sendBookingList(
      chatId,
      userId,
      `
      WHERE date_iso =
        (
          CURRENT_TIMESTAMP
          AT TIME ZONE 'Asia/Tashkent'
        )::date
      `,
      [],
      "BUGUNGI NAVBATLAR"
    );

    return;
  }

  if (command === "/ertaga") {
    await sendBookingList(
      chatId,
      userId,
      `
      WHERE date_iso =
        (
          (
            CURRENT_TIMESTAMP
            AT TIME ZONE 'Asia/Tashkent'
          )::date
          + INTERVAL '1 day'
        )::date
      `,
      [],
      "ERTANGI NAVBATLAR"
    );

    return;
  }

  if (command === "/oy") {
    await sendBookingList(
      chatId,
      userId,
      `
      WHERE date_iso >=
        date_trunc(
          'month',
          CURRENT_TIMESTAMP
          AT TIME ZONE 'Asia/Tashkent'
        )::date

      AND date_iso <
        (
          date_trunc(
            'month',
            CURRENT_TIMESTAMP
            AT TIME ZONE 'Asia/Tashkent'
          ) + INTERVAL '1 month'
        )::date
      `,
      [],
      "SHU OYDAGI NAVBATLAR"
    );

    return;
  }

  if (command === "/statistika") {
    await sendStatistics(
      chatId,
      userId
    );

    return;
  }

  if (command === "/shifokorlar") {
    await sendDoctorsStatistics(
      chatId,
      userId
    );

    return;
  }

  await sendTelegramMessage(
    chatId,
    "Noma'lum buyruq. /yordam ni yuboring."
  );
}

/* ===================== POLLING ===================== */

async function startTelegramPolling() {
  if (pollingRunning) {
    return;
  }

  pollingRunning = true;

  console.log(
    "Telegram bot polling ishga tushmoqda..."
  );

  try {
    const me = await telegram("getMe");

    console.log(
      `Telegram bot ulandi: @${me.username}`
    );
  } catch (error) {
    console.error(
      "Telegram botga ulanish xatosi:",
      error.message
    );
  }

  while (true) {
    try {
      const updates = await telegram(
        "getUpdates",
        {
          offset: telegramOffset,
          timeout: 25,
          allowed_updates: [
            "message",
            "callback_query"
          ]
        }
      );

      for (const update of updates) {
        telegramOffset =
          update.update_id + 1;

        try {
          await handleTelegramUpdate(
            update
          );
        } catch (error) {
          console.error(
            "Telegram update error:",
            error.message
          );
        }
      }
    } catch (error) {
      console.error(
        "Telegram polling xatosi:",
        error.message
      );

      await new Promise(
        resolve => setTimeout(resolve, 5000)
      );
    }
  }
}

/* ===================== WEBSITE ===================== */

app.use(express.static(__dirname));

/* ===================== START ===================== */

async function startServer() {
  try {
    await initDatabase();

    app.listen(PORT, () => {
      console.log(
        `Server ishga tushdi: http://localhost:${PORT}`
      );
    });

    startTelegramPolling();
  } catch (error) {
    console.error(
      "Server ishga tushmadi:",
      error.message
    );

    process.exit(1);
  }
}

startServer();