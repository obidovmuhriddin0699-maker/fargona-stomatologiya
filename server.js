const express = require("express");
const dotenv = require("dotenv");
const { Pool } = require("pg");

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(__dirname));

/* =========================
   POSTGRESQL
========================= */

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

/* =========================
   TELEGRAM
========================= */

const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_CHAT_ID = String(process.env.CHAT_ID || "");

if (!BOT_TOKEN) {
  console.error("BOT_TOKEN topilmadi!");
}

if (!ADMIN_CHAT_ID) {
  console.error("CHAT_ID topilmadi!");
}

async function telegram(method, body = {}) {
  const url = `https://api.telegram.org/bot${BOT_TOKEN}/${method}`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });

  return await response.json();
}

/* =========================
   TELEGRAM XABAR YUBORISH
========================= */

async function sendTelegramMessage(chatId, text) {
  const result = await telegram("sendMessage", {
    chat_id: chatId,
    text
  });

  if (!result.ok) {
    console.error("Telegram xatosi:", result);
  }

  return result;
}

/* =========================
   SAYTDAN NAVBAT QABUL QILISH
========================= */

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

    if (
      !name ||
      !phone ||
      !serviceTitle ||
      !dayLabel ||
      !slot
    ) {
      return res.status(400).json({
        ok: false,
        message: "Ma'lumotlar to'liq emas"
      });
    }

    const bookingId =
      id ||
      `bk_${Date.now()}_${Math.random()
        .toString(16)
        .slice(2)}`;

    /* PostgreSQL'ga saqlash */

    await pool.query(
      `
      INSERT INTO bookings (
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
        bookingId,
        name,
        phone,
        serviceTitle,
        tariffName || "",
        tariffPrice || 0,
        doctorId || "",
        dayLabel,
        dateISO || null,
        slot
      ]
    );

    /* Telegram xabari */

    const message =
`🦷 YANGI NAVBAT

👤 Bemor: ${name}
📞 Telefon: ${phone}

🦷 Xizmat: ${serviceTitle}
💳 Tarif: ${tariffName || "-"}
💰 Narx: ${tariffPrice || "-"}

👨‍⚕️ Shifokor: ${doctorId || "-"}

📅 Sana: ${dayLabel}
📆 Sana ISO: ${dateISO || "-"}
🕐 Vaqt: ${slot}

🆔 ID: ${bookingId}

✅ Sayt orqali yangi navbat olindi.`;

    const telegramResult = await sendTelegramMessage(
      ADMIN_CHAT_ID,
      message
    );

    if (!telegramResult.ok) {
      return res.status(500).json({
        ok: false,
        message: "Navbat saqlandi, lekin Telegramga yuborilmadi"
      });
    }

    res.json({
      ok: true,
      message: "Navbat saqlandi va Telegramga yuborildi",
      bookingId
    });

  } catch (error) {
    console.error("Booking xatosi:", error);

    res.status(500).json({
      ok: false,
      message: "Serverda xatolik yuz berdi"
    });
  }
});

/* =========================
   ADMIN TEKSHIRUVI
========================= */

function isAdmin(msg) {
  return String(msg.chat.id) === ADMIN_CHAT_ID;
}

/* =========================
   TELEGRAM UPDATE OLISH
========================= */

let telegramOffset = 0;
let pollingRunning = false;

async function startTelegramPolling() {
  if (pollingRunning) return;

  pollingRunning = true;

  console.log("Telegram bot polling ishga tushmoqda...");

  try {
    const me = await telegram("getMe");

    if (!me.ok) {
      console.error("Telegram BOT_TOKEN xatosi:", me);
      return;
    }

    console.log(
      `Telegram bot ulandi: @${me.result.username}`
    );

    while (true) {
      try {
        const result = await telegram("getUpdates", {
          offset: telegramOffset,
          timeout: 30,
          allowed_updates: ["message"]
        });

        if (!result.ok) {
          console.error(
            "Telegram getUpdates xatosi:",
            result
          );

          await new Promise(resolve =>
            setTimeout(resolve, 5000)
          );

          continue;
        }

        for (const update of result.result) {
          telegramOffset = update.update_id + 1;

          await handleTelegramUpdate(update);
        }

      } catch (error) {
        console.error(
          "Telegram polling xatosi:",
          error.message
        );

        await new Promise(resolve =>
          setTimeout(resolve, 5000)
        );
      }
    }

  } catch (error) {
    console.error(
      "Telegram bot ishga tushirish xatosi:",
      error.message
    );
  }
}

/* =========================
   TELEGRAM BUYRUQLARI
========================= */

async function handleTelegramUpdate(update) {
  const msg = update.message;

  if (!msg || !msg.text) {
    return;
  }

  const chatId = String(msg.chat.id);
  const text = msg.text.trim();

  console.log(
    `Telegram buyruq: ${text} | chat_id: ${chatId}`
  );

  /* Faqat admin */

  if (!isAdmin(msg)) {
    await sendTelegramMessage(
      chatId,
      "⛔ Sizda admin huquqi yo'q."
    );

    return;
  }

  /* /start */

  if (text === "/start") {
    await sendTelegramMessage(
      chatId,
`🦷 FARG'ONA STOMATOLOGIYA

Admin paneliga xush kelibsiz.

Buyruqlarni ko'rish uchun:
/yordam`
    );

    return;
  }

  /* /yordam */

  if (text === "/yordam") {
    await sendTelegramMessage(
      chatId,
`📋 ADMIN BUYRUQLARI

/navbatlar
➡️ Barcha navbatlar

/bugun
➡️ Bugungi navbatlar

/ertaga
➡️ Ertangi navbatlar

/oy
➡️ Shu oy navbatlari

/yordam
➡️ Buyruqlar ro'yxati`
    );

    return;
  }

  /* /navbatlar */

  if (text === "/navbatlar") {
    await sendBookingList(
      chatId,
      "BARCHA NAVBATLAR",
      ""
    );

    return;
  }

  /* /bugun */

  if (text === "/bugun") {
    await sendBookingList(
      chatId,
      "BUGUNGI NAVBATLAR",
      "today"
    );

    return;
  }

  /* /ertaga */

  if (text === "/ertaga") {
    await sendBookingList(
      chatId,
      "ERTANGI NAVBATLAR",
      "tomorrow"
    );

    return;
  }

  /* /oy */

  if (text === "/oy") {
    await sendBookingList(
      chatId,
      "SHU OY NAVBATLARI",
      "month"
    );

    return;
  }

  /* Noma'lum buyruq */

  if (text.startsWith("/")) {
    await sendTelegramMessage(
      chatId,
`❓ Bunday buyruq topilmadi.

Buyruqlar ro'yxati:
/yordam`
    );
  }
}

/* =========================
   NAVBATLARNI OLIB TELEGRAMGA YUBORISH
========================= */

async function sendBookingList(
  chatId,
  title,
  filter
) {
  try {
    let query = "";
    let params = [];

    /* Barcha navbatlar */

    if (filter === "") {
      query = `
        SELECT *
        FROM bookings
        ORDER BY date_iso ASC NULLS LAST, slot ASC NULLS LAST, created_at DESC
        LIMIT 100
      `;
    }

    /* Bugun */

    else if (filter === "today") {
      query = `
        SELECT *
        FROM bookings
        WHERE date_iso = CURRENT_DATE
        ORDER BY slot ASC NULLS LAST, created_at ASC
      `;
    }

    /* Ertaga */

    else if (filter === "tomorrow") {
      query = `
        SELECT *
        FROM bookings
        WHERE date_iso = CURRENT_DATE + INTERVAL '1 day'
        ORDER BY slot ASC NULLS LAST, created_at ASC
      `;
    }

    /* Shu oy */

    else if (filter === "month") {
      query = `
        SELECT *
        FROM bookings
        WHERE date_iso >= DATE_TRUNC('month', CURRENT_DATE)::date
          AND date_iso < (
            DATE_TRUNC('month', CURRENT_DATE)
            + INTERVAL '1 month'
          )::date
        ORDER BY date_iso ASC, slot ASC NULLS LAST
      `;
    }

    const result = await pool.query(
      query,
      params
    );

    if (result.rows.length === 0) {
      await sendTelegramMessage(
        chatId,
`${title}

📭 Hozircha navbatlar mavjud emas.`
      );

      return;
    }

    let message =
`${title}

📊 Jami: ${result.rows.length} ta

`;

    result.rows.forEach((booking, index) => {
      message +=
`${index + 1}. 👤 ${booking.name}
📞 ${booking.phone}
🦷 ${booking.service_title}
💳 ${booking.tariff_name || "-"}
💰 ${booking.tariff_price || "-"}
👨‍⚕️ ${booking.doctor_id || "-"}
📅 ${booking.day_label || booking.date_iso || "-"}
🕐 ${booking.slot || "-"}

`;
    });

    /*
      Telegram bitta xabarda 4096 belgigacha
      qabul qiladi. Uzun bo'lsa bo'lib yuboramiz.
    */

    await sendLongTelegramMessage(
      chatId,
      message
    );

  } catch (error) {
    console.error(
      "Navbatlarni olish xatosi:",
      error
    );

    await sendTelegramMessage(
      chatId,
      "❌ Navbatlarni olishda xatolik yuz berdi."
    );
  }
}

/* =========================
   UZUN TELEGRAM XABARINI BO'LISH
========================= */

async function sendLongTelegramMessage(
  chatId,
  text
) {
  const maxLength = 3800;

  if (text.length <= maxLength) {
    await sendTelegramMessage(
      chatId,
      text
    );

    return;
  }

  let current = "";

  const lines = text.split("\n");

  for (const line of lines) {
    if (
      current.length + line.length + 1 >
      maxLength
    ) {
      await sendTelegramMessage(
        chatId,
        current
      );

      current = "";
    }

    current += line + "\n";
  }

  if (current.trim()) {
    await sendTelegramMessage(
      chatId,
      current
    );
  }
}

/* =========================
   SERVERNI ISHGA TUSHIRISH
========================= */

async function startServer() {
  try {
    await initDatabase();

    app.listen(PORT, () => {
      console.log(
        `Server ishga tushdi: http://localhost:${PORT}`
      );

      startTelegramPolling();
    });

  } catch (error) {
    console.error(
      "Serverni ishga tushirishda xatolik:",
      error
    );

    process.exit(1);
  }
}

startServer();
