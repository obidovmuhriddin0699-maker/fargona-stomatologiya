const express = require("express");
const dotenv = require("dotenv");
const { Pool } = require("pg");
const { Bot, longPoll } = require("node-telegram-bot-api");

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(__dirname));

// =====================
// POSTGRESQL
// =====================

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL
    ? { rejectUnauthorized: false }
    : false
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
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  console.log("PostgreSQL: bookings jadvali tayyor");
}

// =====================
// TELEGRAM BOT
// =====================

const bot = new Bot(process.env.BOT_TOKEN);

const ADMIN_CHAT_ID = String(process.env.CHAT_ID);

// =====================
// TELEGRAM XABAR YUBORISH
// =====================

async function sendTelegramMessage(chatId, text) {
  await bot.api.sendMessage({
    chat_id: chatId,
    text
  });
}

// =====================
// YANGI NAVBAT
// =====================

app.post("/api/bookings", async (req, res) => {
  try {
    const {
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
    } = req.body;

    if (!id || !name || !phone || !serviceTitle || !dayLabel || !slot) {
      return res.status(400).json({
        ok: false,
        message: "Ma'lumotlar to'liq emas"
      });
    }

    // 1. PostgreSQL'ga saqlash

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
        slot
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      ON CONFLICT (id) DO NOTHING
      `,
      [
        id,
        name,
        phone,
        serviceTitle,
        tariffName || null,
        tariffPrice || null,
        doctorId || null,
        dayLabel || null,
        dateISO || null,
        slot || null
      ]
    );

    // 2. Telegramga xabar

    const message = `🦷 YANGI NAVBAT

👤 Bemor: ${name}
📞 Telefon: ${phone}

🦷 Xizmat: ${serviceTitle}
💳 Tarif: ${tariffName || "-"}
💰 Narx: ${tariffPrice || "-"}

👨‍⚕️ Shifokor: ${doctorId || "-"}

📅 Sana: ${dayLabel}
📆 Sana ISO: ${dateISO || "-"}
🕐 Vaqt: ${slot}

🆔 ID: ${id}`;

    await sendTelegramMessage(ADMIN_CHAT_ID, message);

    res.json({
      ok: true,
      message: "Navbat saqlandi va Telegramga yuborildi"
    });

  } catch (error) {
    console.error("Booking xatosi:", error);

    res.status(500).json({
      ok: false,
      message: "Serverda xatolik yuz berdi"
    });
  }
});

// =====================
// NAVBATLAR RO'YXATI
// =====================

async function sendBookingList(
  chatId,
  title,
  where = "",
  params = []
) {
  try {

    const result = await pool.query(
      `
      SELECT
        name,
        phone,
        service_title,
        tariff_name,
        tariff_price,
        doctor_id,
        day_label,
        date_iso,
        slot,
        created_at
      FROM bookings
      ${where}
      ORDER BY
        date_iso ASC NULLS LAST,
        slot ASC NULLS LAST,
        created_at DESC
      LIMIT 30
      `,
      params
    );

    if (result.rows.length === 0) {

      await sendTelegramMessage(
        chatId,
        `${title}

📭 Hozircha navbatlar yo‘q.`
      );

      return;
    }

    let message = `${title}\n\n`;

    result.rows.forEach((b, index) => {

      message += `${index + 1}. 👤 ${b.name}
📞 ${b.phone}
🦷 ${b.service_title}
💳 ${b.tariff_name || "-"} — ${b.tariff_price || "-"}
👨‍⚕️ ${b.doctor_id || "-"}
📅 ${b.day_label || b.date_iso || "-"}
🕐 ${b.slot || "-"}
────────────

`;
    });

    await sendTelegramMessage(chatId, message);

  } catch (error) {

    console.error("Ro'yxat xatosi:", error);

    await sendTelegramMessage(
      chatId,
      "❌ Navbatlarni olishda xatolik yuz berdi."
    );
  }
}

// =====================
// ADMIN TEKSHIRISH
// =====================

function isAdmin(msg) {
  return String(msg.chat.id) === ADMIN_CHAT_ID;
}

// =====================
// TELEGRAM UPDATE'LAR
// =====================

async function handleTelegramUpdate(update) {

  if (!update.message || !update.message.text) {
    return;
  }

  const msg = update.message;
  const text = msg.text.trim();

  if (!isAdmin(msg)) {
    return;
  }

  // =====================
  // /navbatlar
  // =====================

  if (text === "/navbatlar") {

    await sendBookingList(
      String(msg.chat.id),
      "📋 BARCHA NAVBATLAR"
    );

    return;
  }

  // =====================
  // /bugun
  // =====================

  if (text === "/bugun") {

    const today = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Tashkent"
    }).format(new Date());

    await sendBookingList(
      String(msg.chat.id),
      `📅 BUGUNGI NAVBATLAR — ${today}`,
      `WHERE date_iso = $1`,
      [today]
    );

    return;
  }

  // =====================
  // /ertaga
  // =====================

  if (text === "/ertaga") {

    const now = new Date();

    const tomorrow = new Date(
      now.getTime() + 24 * 60 * 60 * 1000
    );

    const tomorrowDate = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Tashkent"
    }).format(tomorrow);

    await sendBookingList(
      String(msg.chat.id),
      `📅 ERTANGI NAVBATLAR — ${tomorrowDate}`,
      `WHERE date_iso = $1`,
      [tomorrowDate]
    );

    return;
  }

  // =====================
  // /yordam
  // =====================

  if (text === "/yordam") {

    await sendTelegramMessage(
      String(msg.chat.id),
      `🦷 ADMIN PANEL

📋 /navbatlar — barcha navbatlar
📅 /bugun — bugungi navbatlar
📅 /ertaga — ertangi navbatlar
❓ /yordam — buyruqlar ro‘yxati`
    );

    return;
  }
}

// =====================
// TELEGRAM POLLING
// =====================

async function startTelegramBot() {

  console.log("Telegram bot polling ishga tushmoqda...");

  try {

    const updates = await longPoll(
      bot,
      async (update) => {
        try {
          await handleTelegramUpdate(update);
        } catch (error) {
          console.error(
            "Telegram update xatosi:",
            error
          );
        }
      }
    );

    console.log("Telegram polling tugadi:", updates);

  } catch (error) {

    console.error(
      "Telegram polling xatosi:",
      error
    );
  }
}

// =====================
// SERVER
// =====================

async function startServer() {

  try {

    await initDatabase();

    app.listen(PORT, () => {

      console.log(
        `Server ishga tushdi: http://localhost:${PORT}`
      );

    });

    startTelegramBot();

  } catch (error) {

    console.error(
      "Serverni ishga tushirishda xatolik:",
      error
    );

    process.exit(1);
  }
}

startServer();